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

## 当前开发状态 (2026-08-02)

| 模块 | 状态 | 说明 |
|------|------|------|
| 仪表盘 | ✅ 运行中 | 实时/历史快照、7 项 KPI、招聘诊断、全链路漏斗、事业部与 HRBP 效能、岗位明细、只读分享 |
| 简历管理 | ✅ 运行中 | 飞书导入、BOSS 导入、异步上传、字段提取、AI 初筛与能力维度评分 |
| 岗位管理 | ✅ 运行中 | 飞书同步、能力维度定义（AI 初筛依据）、AI 生成 JD |
| 面试管理 | ✅ 运行中 | 飞书同步、一面/二面面试官、提醒、评价流转 |
| 面试官管理 | ✅ 运行中 | 手动添加 open_id，飞书搜索（待权限审批） |
| 入职管理 | ✅ 运行中 | 飞书同步 |
| 试用期管理 | ✅ 运行中 | |
| 招聘日报 | ✅ 运行中 | Workers AI 自动生成摘要，字段映射已修复 |
| 需求管理 | ✅ 运行中 | |
| **AI 能力维度初筛** | ✅ 已完成 | 批量自动初筛，按岗位能力维度逐项 0-5 打分，卡片联动展示 |
| **D1 ↔ 飞书联动** | ✅ 已修复 | 列表/详情页合并 D1 AI 初筛数据，卡片显示维度标签 + 匹配度 |
| 飞书集成 | ✅ 已接入 | 多维表格数据同步 + 机器人卡片消息、token D1 缓存 |
| 飞书 OAuth 绑定 | ✅ 运行中 | 登录用户绑定飞书身份，本地自动判断回调地址 |
| AI 三层降级 | ✅ 已启用 | DeepSeek V4 Flash → Workers AI Llama 3.3 70B → Llama 3.1 8B |
| MinerU OCR | ✅ 已接入 | 飞书 PDF → MinerU API → Markdown 文本提取 |
| 安全加固 | ✅ 已完成 | 明文密码移除、timing-safe 比较、CORS 白名单、DOMPurify、密钥 Pages Secrets |
| 性能优化 | ✅ 已完成 | N+1 修复、静态资源缓存、图片压缩、chunk 拆分、D1 索引 |
| 日志审计 | ✅ 已完成 | operation_logs 表 8 处核心埋点，上线自检 5 项全绿 |

### 最近更新 (2026-08-02)

**招聘运营看板实时与快照能力：**

- `/dashboard` 支持最新实时数据与按日期保存的不可变快照；切换版本后，KPI、招聘诊断、全局漏斗、事业部、HRBP 和岗位明细使用同一份聚合数据。
- 管理员可保存当日快照，系统也会按上海时区每日自动留存；已保存快照不会随简历、面试或入职数据的后续变化而改变。
- 分享链接可选择实时模式或固定快照模式，并支持有效期与撤销；匿名访问复用完整招聘运营看板，但不展示筛选、刷新、保存快照、分享等内部操作。
- 公共接口只返回聚合后的 v2 看板字段。固定快照链接直接读取已存 JSON，实时链接在访问时重新汇总，二者均执行负责人/事业部范围限制与候选人字段白名单过滤。

### 历史更新 (2026-08-01)

**简历异步处理与前端展示：**

- 上传后先创建 D1 简历记录，再投递至 Cloudflare Queue；关闭或刷新页面不会中断 OCR、字段提取和 AI 初筛。
- 队列消费者按 `resumeId` 完成文本/OCR 解析、标准字段提取和人岗初筛；并发上限为 3。
- 解析字段统一为 `highest_degree`、`school`、`major`、`years_of_experience`、`gender`、`birthday`、`skills` 等标准键，同时兼容历史中文字段。
- 简历卡片按 D1 `created_at` 倒序，刚上传的简历立即在最前；AI 评分显示为能力维度累计的“总分 X/Y”。
- 若初筛模型遗漏已配置的能力维度，消费者会自动补做一次仅针对缺失维度的评分，避免卡片没有维度结果。
- 详情页兼容 AI 将优势、风险、建议问题返回为字符串或数组，避免不规范模型输出造成页面崩溃。

### 历史更新 (2026-07-29)

**AI 能力维度初筛 — 全链路落地：**
- **`POST /api/resumes/batch-auto-screen`**：批量 AI 初筛，每次处理 5 条 `pending_screening` 简历
  - 两次 callAI：①字段解析（从 OCR 文本提取学历/学校/专业/技能）②能力维度评分（按岗位定义的维度逐项 0-5 打分）
  - 三级文本降级：`ocr_markdown` → `raw_text` → 飞书下载 PDF + MinerU OCR → `parsed_data` 摘要兜底
  - `sync-from-feishu` 自动检测缺失 AI 评估的简历，标记 `parse_status='pending_screening'`
- **`POST /api/resumes/:id/ai-screen`**：单条 AI 初筛（编辑页按钮触发）
  - 自动查找候选人岗位的能力维度 → 按维度匹配评分
  - 结果写入 D1 并回写飞书 Bitable
- **`getPositionContext` 多表查询**：
  - 先查 `positions.capability_dimensions`，再查 `capability_dimensions` 独立表
  - 修复维度 JSON 解析 bug + 独立表查询被跳过的守卫问题
- **`callAI` 推理模型兼容**：`deepseek-v4-flash` 返回空 `content` 时 fallback 到 `reasoning_content`
- **D1 数据合并 — 列表/详情 API**：飞书 Bitable 记录 + D1 的 `match_score / ai_review / ai_evaluation / screening_result / parsed_data`
- **卡片联动展示**：列表卡片新增 `AI通过/存疑/淘汰` 标签 + 维度评分标签；详情页按岗位维度逐项展示

**MinerU OCR 接入：**
- `batch-ocr-mineru` 路由：飞书下载 PDF → MinerU API OCR → Markdown 文本，缓存至 `ocr_markdown` 列
- 与 batch-auto-screen 组合使用：先 OCR 提取文本 → 再 auto-screen 解析字段 + 评分

**本地开发修复：**
- `vite.config.ts` proxy 端口 8000 → 8788
- `getLLMConfig` 恢复 `env.AI_API_KEY` fallback（本地 dev 可用）
- 飞书 token D1 缓存过期自动清理

**安全与运维：**
- 密钥管理改造：生产密钥全迁入 Cloudflare Pages Secrets
- cron 鉴权：`/api/cron/*` 需 `X-Cron-Secret` header
- `scripts/pre-deploy-check.mjs`：上线前 5 项自检
- `GET /health` 增加 `ai_binding` 诊断字段

### 历史更新 (2026-07-23)

**安全修复（第二批）：**
- 移除明文密码存储（DB 不再保留 plain_password）
- verifyPassword 改为常量时间比较（防时序侧信道攻击）
- CORS 从 `*` 改为白名单模式
- 前端引入 DOMPurify，邮件预览 HTML 净化

**性能优化（第三批）：**
- Dashboard 3 处 N+1 查询修复
- 静态资源缓存（assets 1年 immutable）+ SPA 路由回退
- D1 新增 38 个索引覆盖高频查询表
- login-bg.jpg 755K → 194K（74% 减少）
- Vite manualChunks 拆分

**JD 生成修复（2026-07-24）：**
- JD 编辑页接入 AI 生成 JD（JDGeneratorModal）
- 需求/岗位管理 AI 生成 JD 静默写空修复
- PUT /api/requisitions/:id 崩溃修复（D1 优先保存）

---

## 部署

### GitHub Actions 自动部署

推送到 `main` 会自动运行 `.github/workflows/deploy.yml`：先构建并自检前端，再部署 `ai-interview` Pages 和 `resume-consumer` Queue Worker，最后请求生产 `/health` 做冒烟检查。Pull Request 和其他分支只运行 CI，不会发布生产。

本仓库不再部署旧的 `hiring-platform` Pages 项目；该同构项目已迁移到 [AI-interview-plus](https://github.com/jhx666oo/AI-interview-plus)。

仓库需要配置以下 GitHub Actions 配置：

- Secret：`CLOUDFLARE_API_TOKEN`
- Repository Variable：`CLOUDFLARE_ACCOUNT_ID`

定时任务（日报、面试提醒、邮箱同步、飞书 token 刷新）仍由各自的 schedule workflow 独立运行。

```bash
# 构建（tsc + vite + esbuild Worker 编译，一步到位）
cd frontend && rm -rf dist node_modules/.vite && npm run build

# 上线前自检（失败禁止部署）
node ../scripts/pre-deploy-check.mjs

# 部署到 Cloudflare Pages
cd frontend && CLOUDFLARE_ACCOUNT_ID=ed758fc82ca4400593ddb447d3db57a4 \
  npx wrangler pages deploy dist --project-name ai-interview --branch main

# 若修改 worker/src/resume-consumer.ts 或 worker/src/resume-processing/，
# 还必须部署 Queue 消费者（新上传简历的异步解析与评分由它执行）
cd ../worker && npx wrangler deploy --config wrangler.resume-consumer.toml
```

> ⚠️ **部署缓存坑**：若只改源码重新 `wrangler pages deploy` 却提示 `0 files uploaded`，是 Vite 构建缓存（`node_modules/.vite`）导致产物 hash 不变。先 `rm -rf dist node_modules/.vite` 再 `npm run build` 即可强制生成新 hash。
>
> ⚠️ **账号坑**：`wrangler` 可能从缓存解析到错误 Cloudflare ��号，必须显式传 `CLOUDFLARE_ACCOUNT_ID=ed758fc82ca4400593ddb447d3db57a4`。

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
| AI 引擎 | DeepSeek V4 Flash / DeepSeek Chat（可降级 Workers AI Llama） |
| OCR | MinerU API |
| 认证 | JWT (Bearer Token) |
| 外部集成 | 飞书 Bitable API、飞书 IM API、飞书 OAuth |
| 部署 | Cloudflare Pages + wrangler CLI |

---

## 功能模块

| 模块 | 路由 | 说明 |
|------|------|------|
| 仪表盘 | `/dashboard` | 实时/快照招聘运营看板、聚合分析、版本切换与只读分享 |
| 匿名看板 | `/shared/dashboard/:token` | 完整聚合看板；支持实时或固定快照，不含内部操作与候选人明细 |
| 需求管理 | `/requisitions` | 招聘需求管理 |
| 岗位管理 | `/positions` | 岗位创建、能力维度定义 |
| JD 管理 | `/jd-management` | JD 版本管理、AI 生成 JD |
| 简历管理 | `/resumes` | 飞书导入、上传、BOSS 导入、AI 初筛 |
| 面试管理 | `/interviews` | 面试同步、面试官、提醒、评价流转 |
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
| 系统设置 | `/settings/*` | 能力维度、AI 模型、系统参数等 |

---

## AI 初筛流程

```
飞书同步 (sync-from-feishu)
  └─ 飞书缺 AI 评估 → parse_status = 'pending_screening'
       └─ batch-auto-screen (批量 5 条/次)
            ├─ getResumeTextForScreening (三级降级获取文本)
            ├─ callAI #1: 字段解析 (学校/专业/技能等) → 更新 parsed_data
            └─ callAI #2: 能力维度评分
                 ├─ getPositionContext (查 positions + capability_dimensions 表)
                 ├─ 按岗位定义维度逐项 0-5 打分
                 ├─ 写 D1 (match_score / ai_evaluation / screening_result)
                 └─ 回写飞书 Bitable
```

**编辑页按钮** (`POST /api/resumes/:id/ai-screen`) 流程相同，单条触发。

**数据联动**：列表/详情 API 合并 D1 数据 → 卡片实时展示 AI 初筛结果。

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

# 启动 Worker (Pages dev 模式，端口 8788)
cd frontend && CLOUDFLARE_ACCOUNT_ID=ed758fc82ca4400593ddb447d3db57a4 \
  npx wrangler pages dev dist --port 8788

# 启动前端 (Vite dev，端口 5173，自动代理 API 到 8788)
cd frontend && npx vite --port 5173

# 飞书数据同步（需先登录）
# 简历管理 / 面试管理 页面点击「飞书导入」
```

---

## 数据库结构 (D1)

核心业务表：

- **users** — 用户、角色、飞书 OAuth 绑定
- **positions** — 岗位、负责人、能力维度
- **resumes** — 简历、AI 解析、匹配评分、OCR 文本、筛选状态
- **interviews** — 面试记录、一面/二面面试官、评价、状态
- **capability_dimensions** — 能力维度独立表（岗位管理页写入，AI 初筛依据）
- **position_mappings** — 岗位名称映射
- **interviewer_mappings** — 面试官姓名 → 飞书 open_id 映射
- **offers / offer_templates** — Offer 管理
- **coding_tests / coding_submissions** — 笔试管理
- **workflows / workflow_nodes / workflow_edges / workflow_executions** — 工作流引擎
- **daily_reports** — 招聘日报
- **system_configs** — 系统配置（LLM API Key、模型等）
- **operation_logs** — 操作日志审计
- **dashboard_snapshots** — 按上海日期写入且不可变的招聘看板聚合快照
- **dashboard_share_links** — 可过期/撤销的实时或固定快照分享链接
- 其他：`job_requisitions`, `talent_pool`, `onboarding_records`, `probation_records`, `background_checks`, `jd_versions`

---

## 项目结构

```text
ai-interview/
├── frontend/                    # React 19 + Vite 7 + TypeScript + Ant Design 6
│   ├── src/
│   │   ├── pages/               # 18 个页面模块
│   │   │   ├── Dashboard/       # 仪表盘
│   │   │   ├── Interviews/      # 面试管理（飞书同步、提醒、评价）
│   │   │   ├── Resumes/         # 简历管理（飞书导入、AI 初筛）
│   │   │   ├── Positions/       # 岗位管理 + 能力维度
│   │   │   ├── Settings/        # 系统设置（面试官管理、岗位映射等）
│   │   │   └── ...
│   │   ├── components/          # Layout, PdfViewer, CodeEditor
│   │   ├── contexts/            # AuthContext, OwnerContext
│   │   ├── router/              # 路由配置（懒加载）
│   │   └── utils/               # request.ts, pdfPreview.ts
│   ├── dist/                    # 构建产物 + _worker.js
│   └── wrangler.toml            # Cloudflare Pages 配置
│
├── worker/                      # Cloudflare Workers (Hono + TypeScript + D1)
│   ├── src/index.ts             # Worker 入口（所有 API 端点）
│   ├── schema.sql               # D1 数据库 schema
│   ├── .dev.vars                # 本地环境变量
│   └── wrangler.toml            # Cloudflare Workers 配置
│
├── scripts/                     # 构建脚本 + 部署自检
├── deliverables/                # 审计报告、改进总结
│
└── docs/                        # 文档与截图
```

---

## AI 模型配置

AI 调用统一走 `worker/src/index.ts` 的 `getLLMConfig()` + `callAI()`：

| 优先级 | 配置来源 | 说明 |
|--------|----------|------|
| 1 | **系统设置页配置**（D1 `system_configs` 表） | 用户在「系统设置 → AI 模型配置」填写 API Key / Base URL / Model |
| 2 | **环境变量**（`env.AI_API_KEY`） | Pages Secret 或 .dev.vars，本地开发适用 |
| 3 | **Workers AI 降级**（`env.AI` binding） | 未配置任何 Key 时，自动使用 Cloudflare Workers AI（免费） |

**降级链路**：`DeepSeek/自定义 API` → `Workers AI Llama 3.3 70B` → `Workers AI Llama 3.1 8B`

**推理模型兼容**：`deepseek-v4-flash` 可能只返回 `reasoning_content` 不含 `content`，callAI 自动 fallback。

---

### 数据同步

| 飞书表 | 用途 | 同步 API |
|--------|------|----------|
| 人才库 (`tblWkwsoTIPhzusI`) | 简历数据 | `POST /api/resumes/sync-from-feishu` |
| 进入面试候选人 (`tblsKkEvvxYssrvB`) | 面试记录 + 面试官 | `POST /api/interviews/sync-from-feishu` |

### 飞书消息

- **提醒面试官**：`POST /api/interviews/:id/notify-interviewer`
  - 优先使用登录用户 OAuth token（以用户身份），失败回退 bot
  - 卡片消息包含候选人、岗位、城市、面试时间

---

## License

MIT
