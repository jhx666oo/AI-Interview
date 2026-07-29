# AI Interview - 智能招聘管理系统

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Frontend](https://img.shields.io/badge/frontend-React%2019%20%2B%20Vite%207-646CFF.svg)
![Backend](https://img.shields.io/badge/backend-Cloudflare%20Workers%20(Hono)-F48120.svg)
![Database](https://img.shields.io/badge/database-Cloudflare%20D1%20(SQLite)-F48120.svg)
![AI](https://img.shields.io/badge/AI-DeepSeek%20%7C%20Workers%20AI%20(Llama)-7C3AED.svg)
![Status](https://img.shields.io/badge/status-active%20development-brightgreen.svg)

> 🚀 线上地址: https://ai-interview-88r.pages.dev

AI Interview 是一个面向招聘团队的全链路智能招聘管理系统，覆盖从岗位发布、简历收集、AI 解析匹配、面试评估、Offer 发放到入职跟踪的完整招聘流程。集成飞书多维表格与机器人，实现数据同步、面试提醒、评价流转。

---

## 当前开发状态 (2026-07-29)

| 模块 | 状态 | 说明 |
|------|------|------|
| 仪表盘 | ✅ 运行中 | 三大事业部看板、招聘漏斗、KPI、N+1 查询已优化 |
| 简历管理 | ✅ 运行中 | 飞书导入、AI 解析、BOSS 导入、上传、DOMPurify XSS 防护 |
| 岗位管理 | ✅ 运行中 | 飞书同步、一面/二面负责人 |
| 面试管理 | ✅ 运行中 | 飞书同步、一面/二面面试官、提醒、评价流转 |
| 面试官管理 | ✅ 运行中 | 手动添加 open_id，飞书搜索（待权限审批） |
| 入职管理 | ✅ 运行中 | 飞书同步 |
| 试用期管理 | ✅ 运行中 | |
| 招聘日报 | ✅ 运行中 | Workers AI 自动生成��要，字段映射已修复 |
| 需求管理 | ✅ 运行中 | |
| 飞书集成 | ✅ 已接入 | 多维表格数据同步 + 机器人卡片消息、token D1 缓存 |
| 飞书 OAuth 绑定 | ✅ 运行中 | 登录用户绑定飞书身份，本地自动判断回调地址 |
| AI 三层降级 | ✅ 已启用 | DeepSeek API → Workers AI Llama 3.3 70B → Llama 3.1 8B |
| 安全加固 | ✅ 已完成 | 明文密码移除、timing-safe 比较、CORS 白名单、DOMPurify、密钥迁移到 Pages Secrets |
| 性能优化 | ✅ 已完成 | N+1 修复、静态资源缓存、图片压缩、chunk 拆分、D1 索引 |
| 日志审计 | ✅ 已完成 | operation_logs 表 8 处核心埋点，上线自检 5 项全绿 |

### 最近更新 (2026-07-29)

**AI 三层降级启用：**
- `callAI()` 逻辑改为：**用户在前端配置了 API Key → 走自定义模型；未配置 → 默认走 Cloudflare Workers AI（免费）**
- 移除 `getLLMConfig` 中对 `env.AI_API_KEY` 的 fallback，只为 DB 中用户显式配置的 Key 生效
- Workers AI 降级链路：`@cf/meta/llama-3.3-70b-instruct-fp8-fast` → `@cf/meta/llama-3.1-8b-instruct`
- `frontend/wrangler.toml` 启用 `[ai] binding = "AI"`，生产确认 `ai_binding: true`
- `frontend/Settings/System.tsx`：API Key 改为可选，未填时提示"将降级使用 Workers AI"

**日报功能修复：**
- `daily_reports` 表新增 `stats` 列（远程 ALTER TABLE）
- INSERT 字段名从不存在列（`report_type/title/content/status`）修正为实际列
- 前端日报页字段映射对齐：`record.ai_summary`（AI 摘要）/ `record.stats`（统计数据对象）
- 发送端点字段引用修复（`r.content/r.stats/r.title` → `r.ai_summary/r.stats/r.report_date`）

**安全与运维：**
- 密钥管理改造：生产密钥全迁入 Cloudflare Pages Secrets，源码/wrangler.toml 禁止明文
- cron 鉴权：`/api/cron/*` 需 `X-Cron-Secret` header
- `scripts/pre-deploy-check.mjs`：上线前 5 项自检（产物新鲜度/路由完整性/密钥扫描/wrangler/旧URL）
- `GET /health` 增加 `ai_binding` 诊断字段
- 冗余脚本归档至 `_archive_20260729/`

### 历史更新 (2026-07-23)

**安全修复（第二批）：**
- 移除明文密码存储（DB 不再保留 plain_password）
- verifyPassword 改为常量时间比较（防时序侧信道攻击）
- CORS 从 `*` 改为白名单模式（localhost:5173/4173/8000 + 生产域名）
- 前端引入 DOMPurify，邮件预览 HTML 内容经净化
- CONTRIBUTING.md / SECURITY.md 重写为 Workers/D1/Vite 实际技术栈

**性能优化（第三批）：**
- Dashboard 3 处 N+1 查询修复（funnel/positions/interviewers 改为聚合查询）
- 静态资源缓存（assets 1年 immutable）+ SPA 路由回退
- D1 新增 38 个索引覆盖高频查询表
- login-bg.jpg 755K → 194K（74% 减少）
- Vite manualChunks 拆分（react-core 99KB / antd 1.4MB / xlsx 429KB 独立缓存）
- 面试列表新增可选服务端分页

**其他修复：**
- 飞书 OAuth redirect_uri 本地开发自动用 localhost:5173
- 飞书 appId/appSecret 更新为新应用 cli_aad2cb7fab385cb6
- 飞书 token 缓存到 D1 settings 表（110min TTL）
- AI API 调用加 30s AbortController 超时
- 新增 GET /health 健康检查端点
- 前端按钮防重复提交全面修复（15 个文件，8 个高风险项消除）

**JD 生成修复（2026-07-24）：**
- **JD 编辑页接入 AI 生成 JD**：`JDManagement/Editor.tsx` 此前从未接入 `JDGeneratorModal`（对比 `Positions/Form.tsx` 已正常），现已复用该组件，新增「AI 生成 JD」按钮、采纳回填闭环（回填 description/requirements 后保存为新版本）。
- **需求/岗位管理 AI 生成 JD 静默写空修复**：根因为生产 `system_configs.llm_api_key` 是失效的 DeepSeek key，旧 `ai-jd` 代码在 `callAI` 失败时静默返回空内容（HTTP 200），前端「显示成功实际未生成」。现已增加空结果检测，明确返回 500 报错。
- **PUT /api/requisitions/:id 崩溃修复**：旧逻辑在飞书 Bitable 同步失败时整体抛 500 且不保存 D1 本地数据，导致「显示成功实际未保存」。现已改为 **D1 优先保存、飞书同步失败仅降级告警**，并返回 `feishu_synced` 标志。
- **AI 配置降级机制**：撤销失效 key 后 `callAI` 自动走 Cloudflare Pages 已配置的 Workers AI（`env.AI` binding）正常生成。详见下方「AI 模型配置」。

---

## 部署

```bash
# 构建（tsc + vite + esbuild Worker 编译，一步到位）
cd frontend && rm -rf dist node_modules/.vite && npm run build

# 上线前自检（失败禁止部署）
node ../scripts/pre-deploy-check.mjs

# 部署到 Cloudflare Pages
cd frontend && CLOUDFLARE_ACCOUNT_ID=ed758fc82ca4400593ddb447d3db57a4 \
  npx wrangler pages deploy dist
```

> ⚠️ **部署缓存坑**：若只改源码重新 `wrangler pages deploy` 却提示 `0 files uploaded (N already uploaded)`，是 Vite 构建缓存（`node_modules/.vite`）导致产物 hash 不变。先 `rm -rf dist node_modules/.vite` 再 `npm run build` 即可强制生成新 hash。
>
> ⚠️ **账号坑**：`wrangler` 可能从缓存解析到错误 Cloudflare 账号，必须显式传 `CLOUDFLARE_ACCOUNT_ID=ed758fc82ca4400593ddb447d3db57a4`（即 `ai-interview-88r` Pages 项目所属账号）。

---

## 技术架构

| 环境 | 前端 | 后端 | 数据库 |
|------|------|------|--------|
| **本地开发** | React 19 + Vite 7 | Cloudflare Workers (wrangler dev) | D1 (本地 SQLite) |
| **生产环境** | Cloudflare Pages | Cloudflare Workers (Hono) | Cloudflare D1 |

| 层 | 技术选型 |
|---|---|
| 前端框架 | React 19, TypeScript 5.9, Ant Design 6, React Router 7 |
| 可视化 | Recharts (图表) |
| 状态管理 | React Context (AuthContext) |
| HTTP 客户端 | Axios |
| 后端 | Cloudflare Workers, Hono, TypeScript, esbuild |
| 数据库 | Cloudflare D1 (SQLite) |
| AI 引擎 | DeepSeek V4 Flash（可降级 Workers AI） |
| 认证 | JWT (Bearer Token) |
| 外部集成 | 飞书 Bitable API、飞书 IM API、飞书 OAuth |
| 部署 | Cloudflare Pages + wrangler CLI |

---

## 功能模块

| 模块 | 路由 | 说明 |
|------|------|------|
| 仪表盘 | `/dashboard` | 三大事业部看板、招聘漏斗、KPI |
| 需求管理 | `/requisitions` | 招聘需求管理 |
| 岗位管理 | `/positions` | 岗位创建、一面/二面负责人、AI 生成 JD |
| JD 管理 | `/jd-management` | JD 版本管理、AI 生成 JD（Editor 已接入 JDGeneratorModal） |
| 简历管理 | `/resumes` | 飞书导入、上传、BOSS 导入、AI 解析 |
| **面试管理** | `/interviews` | 面试同步、一面/二面面试官、提醒、评价流转 |
| 入职管理 | `/onboarding` | 入职记录与状态跟踪 |
| 试用期管理 | `/probation` | 试用期跟踪、转正评估 |
| 招聘日报 | `/daily-reports` | AI 生成日报/周报 |
| 岗位映射 | `/settings/position-mappings` | 岗位名称映射管理 |
| 面试官管理 | `/settings/interviewer-mappings` | 面试官 open_id 管理 |
| 用户管理 | `/users` | 系统用户管理 |
| 邮件设置 | `/settings/mail` | 邮件配置 |
| 工作流 | `/workflows` | React Flow 可视化编排 |
| 笔试管理 | `/coding-tests` | 算法题、AI 评测 |
| 背调管理 | `/background-checks` | 背景调查 |
| Offer 管理 | `/offers` | Offer 发送与模板 |
| 题库管理 | `/question-banks` | 题库管理 |
| 系统设置 | `/settings/*` | 能力维度、系统参数等 |

---

## 本地开发

```bash
# 环境要求: Node.js 20+

# 安装依赖
cd frontend && npm install
cd worker && npm install

# 配置环境变量
cp worker/.dev.vars.example worker/.dev.vars
# 编辑填入 SECRET_KEY, FEISHU_APP_ID, FEISHU_APP_SECRET, AI_API_KEY 等

# 启动 Worker (D1 本地模式)
cd worker && wrangler dev --port 8000

# 启动前端
cd frontend && npx vite --port 5173

# 飞书数据同步（需先登录）
# 简历管理 / 面试管理 页面点击「飞书导入」
```

---

## 数据库结构 (D1 - 38 张表)

核心业务表：

- **users** — 用户、角色、飞书 OAuth 绑定
- **positions** — 岗位、负责人、能力维度
- **resumes** — 简历、AI 解析、匹配评分、筛选状态
- **interviews** — 面试记录、一面/二面面试官、评价、状态
- **interviewer_mappings** — 面试官姓名 → 飞书 open_id 映射
- **position_mappings** — 岗位名称映射
- **offers / offer_templates** — Offer 管理
- **coding_tests / coding_submissions** — 笔试管理
- **workflows / workflow_nodes / workflow_edges / workflow_executions** — 工作流引擎
- **daily_reports** — 招聘日报
- **job_requisitions** — 招聘需求
- **talent_pool** — 人才库
- **onboarding_records** — 入职记录
- **probation_records** — 试用期记录
- **background_checks** — 背景调查
- **jd_versions** — JD 版本管理
- **capability_dimensions** — 能力维度

---

## 项目结构

```text
ai-interview/
├── frontend/                    # React 19 + Vite 7 + TypeScript + Ant Design 6
│   ├── src/
│   │   ├── pages/               # 18 个页面模块
│   │   │   ├── Dashboard/       # 仪表盘
│   │   │   ├── Interviews/      # 面试管理（飞书同步、提醒、评价）
│   │   │   ├── Resumes/         # 简历管理（飞书导入、AI 解析）
│   │   │   ├── Positions/       # 岗位管理
│   │   │   ├── Settings/        # 系统设置（面试官管理、岗位映射等）
│   │   │   └── ...
│   │   ├── components/          # Layout, PdfViewer, CodeEditor
│   │   ├── contexts/            # AuthContext, OwnerContext
│   │   ├── router/              # 路由配置（懒加载）
│   │   └── utils/               # request.ts, pdfPreview.ts
│   └── dist/                    # 构建产物 + _worker.js
│
├── worker/                      # Cloudflare Workers (Hono + TypeScript + D1)
│   ├── src/index.ts             # Worker 入口（所有 API 端点，随迭代增长）
│   ├── schema.sql               # D1 数据库 schema
│   ├── .dev.vars                # 本地环境变量
│   └── wrangler.toml            # Cloudflare 配置
│
├── xiaoqi/                      # 小七 AI Agent（飞书机器人）
│   ├── bot/                     # 飞书机器人
│   └── handler.js               # 消息处理器
│
└── docs/                        # 文档与截图
```

---

## AI 模型配置

AI 调用统一走 `worker/src/index.ts` 的 `getLLMConfig()` + `callAI()`：

| 优先级 | 配置来源 | 说明 |
|--------|----------|------|
| 1 | **系统设置页配置**（D1 `system_configs` 表） | 用户在「系统设置 → AI 模型配置」页填写 API Key / Base URL / Model，填写后生效 |
| 2 | **Workers AI 降级**（`env.AI` binding） | 未配置 API Key 时，自动使用 Cloudflare Workers AI（免费），无需额外密钥 |

**降级链路**：`DeepSeek/自定义 API` → `Llama 3.3 70B (Workers AI)` → `Llama 3.1 8B (Workers AI)`

> ✅ **建议**：日常使用无需配置 API Key，系统自动使用 Workers AI 免费通��。如需更高质量的模型（如 DeepSeek），在前端系统设置页填写 Key 即可切换。

---

### 数据同步

| 飞书表 | 用途 | 同步 API |
|--------|------|----------|
| 人才库 (`tblWkwsoTIPhzusI`) | 简历数据 | `POST /api/resumes/sync-from-feishu` |
| 进入面试候选人 (`tblsKkEvvxYssrvB`) | 面试记录 + 一面/二面面试官 | `POST /api/interviews/sync-from-feishu` |
| 面试跟进总表 (`tblprJUznWG3UnSA`) | 面试进度跟踪（待接入） | — |

### 飞书消息

- **提醒面试官**：`POST /api/interviews/:id/notify-interviewer`
  - 优先使用登录用户 OAuth token（以用户身份），失败回退 bot
  - 卡片消息包含候选人、岗位、城市、面试时间
- **面试官 open_id 来源**：`interviewer_mappings` 表 + `users` 表 OAuth 绑定
  - 旧版硬编码 open_id 已移除（跨应用不可用）

---

## License

MIT
