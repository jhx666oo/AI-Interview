# AI-Interview 系统事故响应报告

**事故编号**: INC-2025-0722-001
**报告人**: Rex (SRE Engineer)
**报告时间**: 2025-07-22
**系统**: ai-interview (https://ai-interview-88r.pages.dev)
**技术栈**: React 19 + Vite 7 / Cloudflare Workers (Hono) / D1 (SQLite)

---

## 1. 事故分诊

### 1.1 严重性评级

| 维度 | 评估 |
|------|------|
| **SEV 等级** | **SEV2** — 主要功能严重降级 |
| 判定依据 | 页面打开慢、API 响应超时、资源加载失败，核心招聘流程（简历上传→AI解析→人才库查看）全部受影响 |
| 用户影响 | 所有 HR 用户、面试官无法正常使用系统；简历上传和查看流程可能完全阻塞 |
| 降级而非 SEV1 原因 | 系统未完全宕机——登录、静态资源仍可访问；飞书多维表格数据未被破坏；非实时关键路径系统 |

### 1.2 受影响系统与用户

| 系统组件 | 影响程度 | 说明 |
|----------|----------|------|
| 前端页面加载 | 🔴 严重 | 首屏加载 4.7MB+ JS 资源，无缓存头，冷加载 5-15 秒 |
| 简历列表 API | 🔴 严重 | `/api/resumes` 每次全量拉取飞书 Bitable 数据，2-10 秒响应 |
| 简历上传 API | 🔴 严重 | 同步等待 2 次 AI 调用，10-30 秒阻塞 |
| 仪表盘 API | 🟡 中等 | N+1 查询导致 50 个岗位时 350 次 D1 查询，3-8 秒 |
| 飞书消息推送 | 🟡 中等 | 无超时控制，飞书 API 慢时阻塞整个请求 |
| AI 筛选/解析 | 🟡 中等 | 无超时无重试，DeepSeek API 抖动直接失败 |

### 1.3 角色分配

| 角色 | 负责人 | 职责 |
|------|--------|------|
| 事故指挥官 (IC) | Rex (SRE) | 统筹响应、优先级决策、状态更新 |
| 响应者-后端 | 待分配 | 修复 Worker 瓶颈（缓存、超时、分页） |
| 响应者-前端 | 待分配 | 优化前端构建、资源加载、缓存策略 |
| 沟通负责人 | 待分配 | 向用户同步状态、预期恢复时间 |

---

## 2. 事故时间线（基于代码分析的推测性时间线）

```
T+0s     用户打开 https://ai-interview-88r.pages.dev
         ├── 浏览器请求 index.html (Cloudflare Pages)
         ├── 下载 login-bg.jpg (755KB, 无优化, 无缓存头)
         └── 下载 vendor-BAQpnXD7.js (1.4MB, antd+react 全家桶)

T+1-3s   前端 JS 解析执行
         ├── vendor chunk 1.4MB 解析耗时
         ├── 无 _headers 文件 → 浏览器无法缓存, 每次重新下载
         └── 首屏可交互

T+3s     用户登录 → POST /api/auth/token
         ├── Worker 冷启动 (6881行单体, 编译后 213KB)
         ├── D1 查询 users 表 (无索引优化, 但 users 表小, ~0.1s)
         └── 返回 JWT token

T+3.5s   用户进入仪表盘 → GET /api/dashboard/overview
         ├── 10 个并行 D1 COUNT 查询 (无索引, ~0.5-1s)
         └── 同时触发 GET /api/dashboard/positions
             └── N+1: 先 SELECT * FROM positions, 再对每个 position 做 7 次查询
                 ├── 50 个岗位 = 350 次 D1 查询
                 └── D1 串行处理 → 3-8 秒

T+4-8s   仪表盘渲染中，用户点击「简历管理」
         └── GET /api/resumes
             ├── bitableCache.get(tableId) → 缓存未命中 (Workers 无状态!)
             ├── getFeishuToken() → POST 飞书 auth API (无缓存, 无超时)
             │   └── 飞书 API 响应 200-800ms
             ├── 循环分页拉取 Bitable records (page_size=500)
             │   └── 多页时串行, 每页 200-500ms
             ├── 写入 bitableCache (但下次请求可能是新 isolate, 缓存丢失)
             ├── SELECT * FROM resume_extras (全表扫描)
             ├── buildPositionMapping → SELECT * FROM position_mappings (全表扫描)
             └── 内存中过滤 (无服务端分页)
             → 总耗时 2-10 秒

T+8-10s  用户上传简历 → POST /api/resumes
         ├── 接收 PDF 文件 (可能 1-5MB)
         ├── 创建 Bitable 记录 (飞书 API, ~500ms)
         ├── callAI #1: PDF→文本提取 (DeepSeek, 无超时)
         │   └── 发送 base64 PDF (截断至 32KB) → 等待 AI 响应
         │   └── 耗时 5-15 秒 (取决于 DeepSeek 负载)
         ├── callAI #2: 文本→结构化解析 (DeepSeek, 无超时)
         │   └── 耗时 3-10 秒
         ├── bitableUpdateRecord (飞书 API, ~500ms)
         └── bitableGetRecord (飞书 API, ~300ms)
         → 总耗时 10-30 秒
         → 前端 axios timeout=30s → 临界超时!

T+30s    ⚠️ 前端 axios 超时触发
         ├── 抛出 timeout error
         ├── 无重试机制 → 用户看到 "请求超时"
         └── 无降级 UI → 用户刷新页面, 重新触发整个流程
```

---

## 3. 影响范围评估

### 3.1 直接影响

| 影响面 | 量化评估 |
|--------|----------|
| 页面首次加载 | 4.7MB JS + 755KB 图片, 无缓存头 → 首屏 5-15 秒 |
| 简历列表加载 | 2-10 秒 (飞书 API 全量拉取 + 内存过滤) |
| 简历上传 | 10-30 秒 (2 次同步 AI 调用), 30 秒超时临界 |
| 仪表盘加载 | 3-8 秒 (N+1 查询, 岗位数多时更严重) |
| 飞书 API 调用 | 每次 getFeishuToken() 重复请求, 无缓存 |
| AI 调用 | 22 处同步 await callAI(), 无超时无重试 |

### 3.2 间接影响

- **用户体验**: 频繁超时导致用户重复刷新, 形成恶性循环（更多请求→更多飞书 API 压力→更慢）
- **飞书 API 配额**: token 重复获取 + 全量拉取, 消耗飞书 API 调用配额
- **DeepSeek 成本**: 无 token 级别超时, 慢请求长时间占用 Worker CPU 时间
- **Cloudflare 成本**: Worker CPU 时间累积 (免费版限制 10ms/请求, 付费版 30s)
- **数据一致性**: 缓存失效导致用户看到过期数据, 但新 isolate 无缓存导致频繁打飞书 API

### 3.3 未受影响

- D1 数据库本身 (SQLite 性能足够, 问题在查询模式而非引擎)
- 前端代码逻辑 (功能正确, 问题在性能)
- 飞书多维表格数据 (数据未损坏)

---

## 4. 根因分析（5 Why 分析法）

### Why 1: 为什么页面打开慢？

**因为前端首次加载 4.7MB+ JS 资源，且无 Cloudflare Pages 缓存头配置。**

- `vendor-BAQpnXD7.js` (1.4MB) — antd 6 + react 19 全家桶
- `Result-DOmX5OV8.js` (962KB) — 面试结果页面，疑似包含 xlsx + codemirror + reactflow
- `xlsx-CNerDvZX.js` (419KB) — Excel 导出库
- `pdf-YdsSBgYL.js` (303KB) — PDF.js
- `login-bg.jpg` (755KB) — 未压缩的登录背景图
- 无 `_headers` 文件 → 浏览器无法缓存静态资源 → 每次访问重新下载

### Why 2: 为什么 API 响应超时？

**因为后端 Worker 存在多个性能瓶颈：**

1. **内存缓存在 Cloudflare Workers 中无效** — `bitableCache` (Map) 和 `getFeishuToken()` 使用内存变量, 但 Workers 是无状态的, 每个请求可能运行在新 isolate 中, 缓存几乎永远不命中
2. **AI 调用同步阻塞** — 简历上传路由串行执行 2 次 `await callAI()`, 每次等待 DeepSeek API 5-15 秒, 总计 10-30 秒, 达到前端 30 秒超时临界点
3. **飞书 API 无超时控制** — 所有 `fetch()` 调用未使用 `AbortController`, 飞书 API 响应慢时无限等待
4. **N+1 查询** — 仪表盘对每个岗位执行 7 次独立 D1 查询, 50 个岗位 = 350 次查询
5. **无服务端分页** — `/api/resumes` 全量拉取飞书 Bitable 数据后在内存中过滤

### Why 3: 为什么内存缓存在 Workers 中不生效？

**因为 Cloudflare Workers 采用 isolate 模型, 请求间不保证复用同一个 isolate。**

```typescript
// worker/src/index.ts:75-77
const BITABLE_CACHE_TTL = 30_000;
const bitableCache = new Map<string, { data: any[]; expiry: number }>();
```

- Workers isolate 可能在任意请求后被回收
- 新请求可能创建新 isolate → Map 为空 → 缓存永远未命中
- 即使 isolate 复用, 在低流量时也容易超时回收
- `getFeishuToken()` (line 5232) 同样无缓存 → 每次飞书 API 调用都重新获取 token

### Why 4: 为什么没有超时和重试机制？

**因为代码设计时未考虑外部依赖的不可靠性。**

- `callAI()` (line 213) — `fetch()` 无 `signal` 参数, 无 timeout
- `getFeishuToken()` (line 5232) — 无 timeout, 无 token 缓存
- 所有飞书 `fetch()` 调用 — 无 timeout, 无 retry, 部分甚至未检查 `resp.ok`
- 前端 `request.ts` — 30 秒超时但无重试, 无指数退避

### Why 5: 为什么没有监控和告警？

**因为项目缺乏可观测性基础设施。**

- 无 Cloudflare Analytics Engine 配置
- 无自定义指标 (请求延迟、错误率、AI 调用耗时)
- 无告警规则 (无 Slack/飞书 webhook 告警)
- 无 SLO 定义
- `console.log` 日志在 Workers 中无法持久化, 无法回溯
- `wrangler.toml` 中无 observability 配置

### 根因总结

> **根本原因**: 系统在从开发原型向生产系统演进过程中, 未进行 Cloudflare Workers 平台特性的适配（无状态隔离、CPU 限制）和外部依赖的可靠性治理（超时、重试、熔断），同时缺乏可观测性基础设施来发现和响应性能退化。

---

## 5. 性能瓶颈清单

### 瓶颈 #1: 内存缓存在 Workers 中完全失效

| 维度 | 详情 |
|------|------|
| **位置** | `worker/src/index.ts:75-77` (bitableCache), `:5232-5245` (getFeishuToken) |
| **描述** | `bitableCache` 使用模块级 `Map` 做 30 秒 TTL 缓存; `getFeishuToken()` 每次调用都 POST 飞书 auth API 获取新 token, 无任何缓存 |
| **影响** | 每个请求都重新获取飞书 token (+200-800ms) + 全量拉取 Bitable 数据 (+500-2000ms); 缓存命中率 ≈ 0% |
| **修复方案** | 1. 使用 Cloudflare KV 缓存飞书 token (TTL 2h, 飞书 token 有效期 2h)<br>2. 使用 KV 或 D1 缓存 Bitable 全量数据 (TTL 5min)<br>3. 或使用 Workers Cache API (caches.default) 缓存响应 |
| **预估工作量** | 3-4 小时 |
| **优先级** | 🔴 P0 |

### 瓶颈 #2: AI 调用同步阻塞，无超时无重试

| 维度 | 详情 |
|------|------|
| **位置** | `worker/src/index.ts:213-288` (callAI), 22 处 `await callAI()` 调用 |
| **描述** | `callAI()` 使用 `fetch()` 调用 DeepSeek API, 无 `AbortController` 超时控制; 简历上传路由串行执行 2 次 AI 调用 (PDF提取 + 结构化解析) |
| **影响** | 单次 AI 调用 5-15 秒, 串行 2 次 = 10-30 秒; DeepSeek API 慢或无响应时请求无限阻塞; 22 个调用点全部有此风险 |
| **修复方案** | 1. 添加 `AbortController` + 30 秒超时<br>2. 添加 1 次重试 + 指数退避<br>3. 简历上传改为异步: 先返回 "processing", AI 结果通过轮询或飞书消息通知<br>4. 使用 `c.executionCtx.waitUntil()` 将 AI 调用移到后台 |
| **预估工作量** | 6-8 小时 |
| **优先级** | 🔴 P0 |

### 瓶颈 #3: 飞书 API 调用无超时、无重试、无错误处理

| 维度 | 详情 |
|------|------|
| **位置** | 15+ 处 `fetch('https://open.feishu.cn/...')` 调用, 关键函数: `getFeishuToken` (L5232), `bitableListRecords` (L1404), `downloadFeishuAttachment` (L5248), `sendFeishuMessageToUser` (L6181) 等 |
| **描述** | 所有飞书 API 调用无 `AbortController` 超时, 无重试逻辑; `downloadFeishuAttachment` 有 5 种下载方法, 串行尝试, 最坏情况 5 次超时; 部分调用未检查 `resp.ok` |
| **影响** | 飞书 API 慢时 (网络抖动、限流) → 请求无限阻塞 → Worker CPU 时间耗尽 → 502/504 |
| **修复方案** | 1. 封装 `feishuFetch()` 统一加 10 秒超时 + 2 次重试<br>2. `getFeishuToken()` 使用 KV 缓存 (TTL 110min, 留 10min buffer)<br>3. `downloadFeishuAttachment` 并行尝试而非串行<br>4. 添加飞书 API 限流检测 (429 状态码) + 退避 |
| **预估工作量** | 4-6 小时 |
| **优先级** | 🔴 P0 |

### 瓶颈 #4: N+1 查询问题

| 维度 | 详情 |
|------|------|
| **位置** | `dashboardPositionsHandler` (L697-752): 每个 position 执行 7 次 D1 查询; `dashboard/interviewers` (L822-840): 每个 interviewer 执行 3 次查询 (且串行) |
| **描述** | 仪表盘岗位列表先 `SELECT * FROM positions` 获取全部岗位, 再对每个岗位分别查询 resumes/interviews/offers/onboarding 的 COUNT; 面试官统计同理 |
| **影响** | 50 个岗位 = 350 次 D1 查询; 20 个面试官 = 60 次串行查询; 仪表盘加载 3-8 秒 |
| **修复方案** | 1. 使用 SQL JOIN + GROUP BY 合并为 1-2 个查询<br>2. 或使用子查询: `SELECT p.*, (SELECT COUNT(*) FROM resumes WHERE position_id=p.id) as resume_count, ...`<br>3. `dashboard/interviewers` 的 for 循环改为 `Promise.all` 并行 |
| **预估工作量** | 2-3 小时 |
| **优先级** | 🟡 P1 |

### 瓶颈 #5: 简历列表无服务端分页

| 维度 | 详情 |
|------|------|
| **位置** | `worker/src/index.ts:2710-2774` (GET /api/resumes) |
| **描述** | 调用 `bitableListRecords()` 全量拉取飞书 Bitable 数据 (page_size=500, 分页串行), 然后在内存中做 nameFilter/statusFilter/ownerFilter 过滤, 无分页参数支持 |
| **影响** | 500+ 条简历时: 飞书 API 多页拉取 2-5 秒 + 内存过滤 + 全量 JSON 序列化返回 → 响应 3-10 秒 |
| **修复方案** | 1. 在 `bitableListRecords()` 中使用飞书 API 的 `filter` 参数做服务端过滤<br>2. 前端分页: 后端支持 `page` + `pageSize` 参数, 使用飞书 API 的 `page_size` + `page_token`<br>3. 将 Bitable 数据同步到 D1, 在 D1 上做分页查询 (已有 `sync-from-feishu` 接口基础) |
| **预估工作量** | 4-6 小时 |
| **优先级** | 🟡 P1 |

### 瓶颈 #6: D1 数据库索引严重不足

| 维度 | 详情 |
|------|------|
| **位置** | `worker/schema.sql` — 20+ 张表, 仅 2 个索引 (`idx_resumes_email`, `idx_resumes_position`) |
| **描述** | interviews 表按 `position_id`、`interviewer_id`、`status`、`round` 频繁查询但无索引; offers 表按 `position_id`、`status` 查询无索引; onboarding_records 按 `position_id`、`status` 查询无索引; `created_at` 排序字段无索引 |
| **影响** | 随数据量增长, COUNT 查询和 ORDER BY 性能线性退化; 当前小数据量影响有限, 但是定时炸弹 |
| **修复方案** | 添加以下索引:<br>`CREATE INDEX idx_interviews_position ON interviews(position_id);`<br>`CREATE INDEX idx_interviews_interviewer ON interviews(interviewer_id);`<br>`CREATE INDEX idx_interviews_status_round ON interviews(status, round);`<br>`CREATE INDEX idx_offers_position ON offers(position_id);`<br>`CREATE INDEX idx_offers_status ON offers(status);`<br>`CREATE INDEX idx_onboarding_position ON onboarding_records(position_id);`<br>`CREATE INDEX idx_onboarding_status ON onboarding_records(status);`<br>`CREATE INDEX idx_resumes_stage ON resumes(stage);`<br>`CREATE INDEX idx_resumes_status ON resumes(status);`<br>`CREATE INDEX idx_resumes_created ON resumes(created_at DESC);`<br>各通用表 `created_at DESC` 排序索引 |
| **预估工作量** | 1-2 小时 |
| **优先级** | 🟡 P1 |

### 瓶颈 #7: 通用 CRUD 列表无分页

| 维度 | 详情 |
|------|------|
| **位置** | `worker/src/index.ts:971-1000` (makeListHandler) |
| **描述** | `SELECT * FROM ${table} ORDER BY created_at DESC` 无 LIMIT/OFFSET, 返回全部记录 |
| **影响** | interviews、offers、onboarding_records 等表数据增长后, 单次请求返回数千条记录 |
| **修复方案** | 添加 `page` + `pageSize` 查询参数支持, 默认 pageSize=50, SQL 添加 `LIMIT ? OFFSET ?` |
| **预估工作量** | 1 小时 |
| **优先级** | 🟡 P1 |

### 瓶颈 #8: 前端构建产物过大

| 维度 | 详情 |
|------|------|
| **位置** | `frontend/vite.config.ts` (manualChunks 配置), `frontend/dist/assets/` |
| **描述** | `Result-DOmX5OV8.js` 962KB (面试结果页, 疑似包含 xlsx/codemirror/reactflow); `vendor-BAQpnXD7.js` 1.4MB; `login-bg.jpg` 755KB 未压缩; 总 JS 资源 4.7MB |
| **影响** | 首次加载 5-15 秒 (3G/4G 网络); 弱网用户完全无法使用 |
| **修复方案** | 1. 将 xlsx 拆为独立 chunk (当前混入 Result 页面)<br>2. 将 @codemirror/* 拆为独立 chunk<br>3. 将 reactflow 拆为独立 chunk<br>4. 压缩 login-bg.jpg (755KB → 100KB, 使用 WebP)<br>5. 考虑 antd 按需引入 (tree-shaking)<br>6. 添加 gzip/brotli 压缩 (Cloudflare Pages 默认支持) |
| **预估工作量** | 2-3 小时 |
| **优先级** | 🟡 P1 |

### 瓶颈 #9: 无 Cloudflare Pages 缓存头

| 维度 | 详情 |
|------|------|
| **位置** | 项目根目录无 `_headers` 文件, 无 `_redirects` 文件 |
| **描述** | Cloudflare Pages 未配置缓存策略, 静态资源无 `Cache-Control` 头; SPA 路由无 fallback 配置 |
| **影响** | 浏览器无法缓存 JS/CSS/图片 → 每次访问重新下载 4.7MB+ 资源; 路由刷新可能 404 |
| **修复方案** | 创建 `frontend/public/_headers`:<br>`/assets/*`<br>`  Cache-Control: public, max-age=31536000, immutable`<br>`/*.jpg`<br>`  Cache-Control: public, max-age=86400`<br>`/index.html`<br>`  Cache-Control: no-cache`<br><br>创建 `frontend/public/_redirects`:<br>`/*  /index.html  200` |
| **预估工作量** | 0.5 小时 |
| **优先级** | 🟡 P1 |

### 瓶颈 #10: 前端请求策略薄弱

| 维度 | 详情 |
|------|------|
| **位置** | `frontend/src/utils/request.ts` |
| **描述** | axios 全局 timeout=30s, 无重试, 无指数退避, 无请求取消, 无离线检测; 401/403 错误处理有但无网络错误/超时的用户友好提示 |
| **影响** | 后端慢时用户等待 30 秒后才看到错误; 无重试导致偶发网络抖动直接失败; 用户反复刷新加重后端负载 |
| **修复方案** | 1. 按请求类型设置不同超时 (列表 10s, 上传 60s, AI 操作 120s)<br>2. 添加 axios-retry 或自定义重试 (GET 请求重试 2 次)<br>3. 添加全局 loading + 错误边界<br>4. 添加请求取消 (AbortController) 防止竞态 |
| **预估工作量** | 2-3 小时 |
| **优先级** | 🟢 P2 |

### 瓶颈 #11: Worker 单体文件过大

| 维度 | 详情 |
|------|------|
| **位置** | `worker/src/index.ts` — 6881 行, 编译后 213KB (55.6KB gzipped) |
| **描述** | 所有路由、中间件、工具函数、飞书 API 封装、AI 调用、Bitable CRUD 全部在一个文件中 |
| **影响** | 冷启动时需解析/编译整个文件; 可维护性极差; 无法独立部署/扩缩容不同模块; 代码审查困难 |
| **修复方案** | 1. 拆分为模块: `routes/`, `middleware/`, `utils/`, `services/feishu.ts`, `services/ai.ts`, `services/bitable.ts`<br>2. 使用 Workers 的 ES module 导入 (Wrangler 原生支持)<br>3. 考虑将 AI 重计算操作拆分为独立 Worker (Queue + Consumer 模式) |
| **预估工作量** | 8-16 小时 (重构) |
| **优先级** | 🟢 P2 |

### 瓶颈 #12: 无限流、无熔断

| 维度 | 详情 |
|------|------|
| **位置** | 全局 — 无任何限流中间件 |
| **描述** | 无 API 限流; 无飞书 API 熔断 (飞书 API 连续失败时仍继续调用); 无 AI API 熔断; 无并发控制 |
| **影响** | 恶意/误操作可耗尽飞书 API 配额; 外部依赖故障时级联失败; 无过载保护 |
| **修复方案** | 1. 添加限流中间件 (基于 IP/userId, 使用 KV 计数)<br>2. 添加熔断器 (飞书 API 连续 5 次失败 → 暂停 30 秒)<br>3. 添加 AI API 并发限制 (同时最多 2 个 AI 请求) |
| **预估工作量** | 3-4 小时 |
| **优先级** | 🟢 P2 |

---

## 6. 行动项（按优先级排序）

### P0 — 立即执行（24 小时内）

| # | 行动项 | 负责人 | 预估工时 | 状态 |
|---|--------|--------|----------|------|
| 1 | 创建 `_headers` 和 `_redirects` 文件, 配置静态资源缓存 | 前端 | 0.5h | ⏳ |
| 2 | `getFeishuToken()` 使用 KV 缓存 (TTL 110min) | 后端 | 1.5h | ⏳ |
| 3 | `bitableListRecords` 使用 KV 缓存 Bitable 数据 (TTL 5min) | 后端 | 2h | ⏳ |
| 4 | `callAI()` 添加 AbortController + 30s 超时 | 后端 | 1h | ⏳ |
| 5 | 飞书 API 调用封装统一超时 (10s) + 重试 (2次) | 后端 | 2h | ⏳ |
| 6 | 简历上传 AI 解析改为异步 (waitUntil + 轮询) | 后端 | 4h | ⏳ |

### P1 — 本周内（7 天内）

| # | 行动项 | 负责人 | 预估工时 | 状态 |
|---|--------|--------|----------|------|
| 7 | 添加 D1 数据库索引 (interviews, offers, onboarding 等) | 后端 | 1.5h | ⏳ |
| 8 | 修复 N+1 查询 (dashboardPositionsHandler + interviewers) | 后端 | 2h | ⏳ |
| 9 | `makeListHandler` 添加分页支持 | 后端 | 1h | ⏳ |
| 10 | `/api/resumes` 添加服务端分页 | 后端 | 4h | ⏳ |
| 11 | 前端构建优化: 拆分 xlsx/codemirror/reactflow chunk | 前端 | 2h | ⏳ |
| 12 | 压缩 login-bg.jpg (755KB → 100KB WebP) | 前端 | 0.5h | ⏳ |
| 13 | 前端请求策略优化 (分级超时 + GET 重试) | 前端 | 2h | ⏳ |

### P2 — 中期改进（30 天内）

| # | 行动项 | 负责人 | 预估工时 | 状态 |
|---|--------|--------|----------|------|
| 14 | Worker 代码模块化拆分 | 后端 | 16h | ⏳ |
| 15 | 添加 API 限流中间件 | 后端 | 2h | ⏳ |
| 16 | 添加飞书 API / AI API 熔断器 | 后端 | 2h | ⏳ |
| 17 | 部署 Cloudflare Analytics Engine 监控 | SRE | 4h | ⏳ |
| 18 | 定义并实施 SLO + 告警 | SRE | 4h | ⏳ |

---

## 7. 预防措施建议

### 7.1 SLO 定义

| 指标 | SLO 目标 | 测量方法 |
|------|----------|----------|
| 页面首次加载 (FCP) | P95 < 2s | Cloudflare Web Analytics / RUM |
| API 响应延迟 (列表类) | P95 < 1s | Workers Analytics Engine |
| API 响应延迟 (AI 操作类) | P95 < 15s | Workers Analytics Engine |
| API 错误率 (5xx) | < 1% | Workers Analytics Engine |
| 飞书 API 调用成功率 | > 98% | 自定义日志 |
| AI API 调用成功率 | > 95% | 自定义日志 |
| Worker 冷启动时间 | P95 < 50ms | Cloudflare Dashboard |

### 7.2 监控告警方案

```
┌─────────────────────────────────────────────────────────────┐
│                    Cloudflare 监控架构                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  [Workers] ──→ Analytics Engine ──→ [Grafana Cloud]         │
│      │           (自定义指标)            (Dashboard + Alert)  │
│      │                                                      │
│      ├──→ console.log ──→ [Workers Logpush] ──→ [R2/Datadog]│
│      │                    (日志持久化)                        │
│      │                                                      │
│      └──→ KV (token缓存/限流计数)                            │
│                                                             │
│  [Pages] ──→ Web Analytics ──→ [Core Web Vitals]            │
│                                                             │
│  [D1] ──→ Query Stats ──→ [Dashboard]                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**建议实施步骤:**

1. **wrangler.toml 添加可观测性配置:**
```toml
[observability]
enabled = true

[[analytics_engine_datasets]]
binding = "ANALYTICS"
dataset = "ai-interview-metrics"
```

2. **关键指标埋点 (Worker 中间件):**
```typescript
// 记录每个请求的: 路由、方法、状态码、耗时、是否命中缓存
app.use('*', async (c, next) => {
  const start = Date.now();
  await next();
  const duration = Date.now() - start;
  c.env.ANALYTICS?.writeDataPoint({
    blobs: [c.req.method, c.req.path, c.res.status.toString()],
    doubles: [duration],
  });
});
```

3. **告警规则:**
   - API 5xx 错误率 > 5% 持续 5 分钟 → 飞书群告警
   - API P95 延迟 > 5s 持续 10 分钟 → 飞书群告警
   - 飞书 API 连续失败 3 次 → 飞书群告警
   - AI API 日 token 消耗 > 限额 80% → 飞书群告警

### 7.3 部署检查清单

**部署前:**
- [ ] D1 迁移脚本已验证 (索引创建)
- [ ] KV namespace 已创建并绑定
- [ ] _headers / _redirects 文件已就位
- [ ] 构建产物大小检查 (总 JS < 3MB, 单 chunk < 500KB)
- [ ] 图片资源已压缩 (单张 < 200KB)

**部署中:**
- [ ] Cloudflare Pages 预览部署验证
- [ ] API 烟雾测试 (登录、列表、上传)
- [ ] 前端页面加载性能检查 (Lighthouse)

**部署后:**
- [ ] 监控 Dashboard 确认指标正常
- [ ] 无 5xx 错误持续 10 分钟
- [ ] 回滚预案就绪 (git revert + redeploy)

**回滚触发条件:**
- API 5xx 错误率 > 10% 持续 5 分钟
- 页面完全无法加载
- 数据丢失或损坏

### 7.4 架构改进路线图

```
Phase 1 (1周):   缓存修复 + 超时控制 + 索引优化
Phase 2 (2周):   分页支持 + 前端优化 + 监控部署
Phase 3 (1月):   代码模块化 + 限流熔断 + SLO 落地
Phase 4 (2月):   异步 AI 处理 (Queue + Consumer) + D1 数据同步层
```

---

## 附录 A: 关键代码位置索引

| 问题 | 文件 | 行号 | 代码片段 |
|------|------|------|----------|
| 内存缓存失效 | index.ts | 75-77 | `const bitableCache = new Map<...>()` |
| 飞书 token 无缓存 | index.ts | 5232-5245 | `async function getFeishuToken(env)` |
| AI 调用无超时 | index.ts | 227-241 | `const resp = await fetch(...)` (无 signal) |
| AI 同步阻塞 | index.ts | 2602, 2655 | `extractedText = await callAI(...)` + `aiResp = await callAI(...)` |
| N+1 查询 | index.ts | 697-752 | `Promise.all(positions.results.map(...7 queries...))` |
| 无分页 | index.ts | 971-1000 | `SELECT * FROM ${table} ORDER BY created_at DESC` |
| 简历全量拉取 | index.ts | 2710-2774 | `bitableListRecords(c.env, tableId)` → 全量 + 内存过滤 |
| 前端 30s 超时 | request.ts | 6 | `timeout: 30000` |
| 无缓存头 | 项目根 | - | 无 `_headers` 文件 |
| 索引不足 | schema.sql | 85-86 | 仅 2 个索引 (20+ 张表) |

## 附录 B: 构建产物大小清单

| 文件 | 大小 | 说明 |
|------|------|------|
| vendor-BAQpnXD7.js | 1.4MB | antd 6 + react 19 + react-router 7 |
| pdf.worker.min-DKQKFyKK.js | 1.0MB | PDF.js worker |
| Result-DOmX5OV8.js | 962KB | 面试结果页 (疑似含 xlsx/codemirror/reactflow) |
| xlsx-CNerDvZX.js | 419KB | Excel 导出 |
| pdf-YdsSBgYL.js | 303KB | PDF.js 主线程 |
| _worker.js | 213KB | Worker 后端 (55.6KB gzipped) |
| login-bg.jpg | 755KB | 未压缩登录背景图 |
| **总计** | **5.6MB** | 含图片、JS、HTML |

---

*报告结束 — Rex (SRE Engineer) — 2025-07-22*
