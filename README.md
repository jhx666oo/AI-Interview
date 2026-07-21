# AI Interview - 智能招聘管理系统

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Frontend](https://img.shields.io/badge/frontend-React%2019%20%2B%20Vite%207-646CFF.svg)
![Backend](https://img.shields.io/badge/backend-Cloudflare%20Workers%20(Hono)-F48120.svg)
![Database](https://img.shields.io/badge/database-Cloudflare%20D1%20(SQLite)-F48120.svg)
![AI](https://img.shields.io/badge/AI-DeepSeek%20V4%20Flash-7C3AED.svg)
![Status](https://img.shields.io/badge/status-active%20development-brightgreen.svg)

> 🚀 线上地址: https://ai-interview-88r.pages.dev

AI Interview 是一个面向招聘团队的全链路智能招聘管理系统，覆盖从岗位发布、简历收集、AI 解析匹配、面试评估、Offer 发放到入职跟踪的完整招聘流程。集成飞书多维表格与机器人，实现数据同步、面试提醒、评价流转。

---

## 当前开发状态 (2026-07-21)

| 模块 | 状态 | 说明 |
|------|------|------|
| 仪表盘 | ✅ 运行中 | 三大事业部看板、招聘漏斗、KPI |
| 简历管理 | ✅ 运行中 | 飞书导入、AI 解析、BOSS 导入、上传 |
| 岗位管理 | ✅ 运行中 | 飞书同步、一面/二面负责人 |
| **面试管理** | ✅ **新版上线** | 飞书同步、一面/二面面试官、提醒、评价流转 |
| 面试官管理 | ✅ 运行中 | 手动添加 open_id，飞书搜索（待权限审批） |
| 入职管理 | ✅ 运行中 | 飞书同步 |
| 试用期管理 | ✅ 运行中 | |
| 招聘日报 | ✅ 运行中 | |
| 需求管理 | ✅ 运行中 | |
| 飞书集成 | ✅ 已接入 | 多维表格数据同步 + 机器人卡片消息 |
| 飞书 OAuth 绑定 | ✅ 运行中 | 登录用户绑定飞书身份 |
| 飞书搜索 open_id | ⚠️ 等待审批 | `contact:contact:readonly` 权限需管理员在后台审批 |

### 最近更新 (2026-07-21)

**面试管理重构：**
- 接入飞书面试候选人表 `tblsKkEvvxYssrvB`，同步一面/二面负责人
- 面试官列拆分为「一面面试官」「二面面试官」两列
- 简历管理 + 面试管理新增「飞书导入」按钮
- 提醒面试官全链路打通：点击提醒 → 飞书卡片消息 → 面试官收到
- 支持一面/二面独立提醒、独立评价、状态流转
- 通知优先用登录用户身份发送，失败自动回退 bot

**关键修复：**
- 移除跨应用硬编码 open_id（不同飞书应用 id 不能互通）
- 修复 schema.sql 语法错误（`background_checks` 表定义残缺）
- 修复简历同步 SQL 参数绑定错误（500）
- 补全 interviews 表 `feishu_record_id`、`primary_interviewer`、`secondary_interviewer` 列

**权限配置：**
- 本地环境应用：`cli_aad2cb7fab385cb6`（`.dev.vars` 配置）
- 硬编码备用应用：`cli_aace77019aba9cdb`
- 需要在飞书管理后台 `admin.feishu.cn` 将应用可用范围改为「全员」

---

## 部署

```bash
# 编译 Worker（esbuild Node API，沙箱拦截 CLI 必须用此方式）
cd ai-interview && node -e "const e=require('./worker/node_modules/esbuild'); \
  e.build({entryPoints:['worker/src/index.ts'],bundle:true,outfile:'frontend/dist/_worker.js',\
  format:'esm',platform:'browser',target:'es2021',minify:true,external:['__STATIC_CONTENT_MANIFEST']})"

# 编译前端
cd frontend && npm run build

# 部署到 Cloudflare Pages
cd frontend && CLOUDFLARE_ACCOUNT_ID=ed758fc82ca4400593ddb447d3db57a4 \
  wrangler pages deploy dist --project-name=ai-interview
```

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
| AI 引擎 | DeepSeek V4 Flash |
| 认证 | JWT (Bearer Token) |
| 外部集成 | 飞书 Bitable API、飞书 IM API、飞书 OAuth |
| 部署 | Cloudflare Pages + wrangler CLI |

---

## 功能模块

| 模块 | 路由 | 说明 |
|------|------|------|
| 仪表盘 | `/dashboard` | 三大事业部看板、招聘漏斗、KPI |
| 需求管理 | `/requisitions` | 招聘需求管理 |
| 岗位管理 | `/positions` | 岗位创建、一面/二面负责人 |
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
│   ├── src/index.ts             # Worker 入口（~6500 行，所有 API 端点）
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

## 飞书集成

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
