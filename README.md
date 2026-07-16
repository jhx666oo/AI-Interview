# AI Interview - 智能招聘管理系统

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Frontend](https://img.shields.io/badge/frontend-React%2019%20%2B%20Vite-646CFF.svg)
![Backend](https://img.shields.io/badge/backend-Python%20FastAPI%20%2B%20Cloudflare%20Workers-009688.svg)
![Database](https://img.shields.io/badge/database-PostgreSQL%20%2B%20Cloudflare%20D1-336791.svg)
![AI](https://img.shields.io/badge/AI-DeepSeek%20%2F%20Qwen%20%2F%20Workers%20AI-7C3AED.svg)
![Status](https://img.shields.io/badge/status-active%20development-brightgreen.svg)

> 🚀 线上地址: https://ai-interview-22u.pages.dev

AI Interview 是一个面向招聘团队的全链路智能招聘管理系统，覆盖从岗位发布、简历收集、AI 解析匹配、面试评估、Offer 发放到入职跟踪的完整招聘流程。

---

## 当前开发状态

| 组件 | 状态 | 说明 |
|------|------|------|
| 前端 (React 19 + Vite 7) | ✅ 正常运行 | `http://localhost:5173` |
| 后端 (Python FastAPI) | ✅ 正常运行 | `http://localhost:8000` |
| PostgreSQL 15 (Docker) | ✅ 正常运行 | 端口 `5433` |
| 数据库迁移 (Alembic) | ✅ 已完成 | 20 个迁移全部执行 |
| 管理员账户 | ✅ 已创建 | `admin@example.com` / `admin123` |
| 演示种子数据 | ⚠️ 部分 | schema 差异需手动修复 |
| 飞书集成 | ⚠️ 需配置 | 需要飞书应用凭证 |
| AI 引擎 | ✅ 已配置 | DeepSeek V4 Flash via OpenAI Compatible API |

### 最近修复项 (2026-07-16)

- Python 3.14 兼容：升级 `psycopg2-binary` → 2.9.12，安装 `audioop-lts`
- `docker-compose.yml` 改为读取 `.env` 变量（修复密码硬编码）
- 修复 2 个 Alembic 迁移脚本顺序问题
- 补齐数据库缺失列（`resumes.stage`, `positions.*`, `interviews.*` 等）
- 对齐模型枚举值与数据库枚举类型（大小写一致）
- 修复 macOS 下 `node_modules/.bin` 权限和 quarantine 隔离问题

---

## 技术架构

系统采用 **双后端架构**：

| 环境 | 前端 | 后端 | 数据库 |
|------|------|------|--------|
| **本地开发** | React 19 + Vite 7 | Python 3.11+ FastAPI | PostgreSQL 15 (Docker) |
| **生产环境** | Cloudflare Pages | Cloudflare Workers (Hono) | Cloudflare D1 (SQLite) |

| 层 | 技术选型 |
|---|---|
| 前端框架 | React 19, TypeScript 5.9, Ant Design 6, React Router 7 |
| 可视化 | Recharts (图表), React Flow (工作流编排) |
| 状态管理 | Zustand 5 |
| HTTP 客户端 | Axios |
| 本地后端 | Python 3.11+, FastAPI, SQLAlchemy 2.0, Alembic |
| 生产后端 | Cloudflare Workers, Hono, TypeScript, esbuild |
| 本地数据库 | PostgreSQL 15 (Docker) |
| 生产数据库 | Cloudflare D1 (SQLite) |
| AI 引擎 | DeepSeek / Qwen (DashScope) / OpenAI Compatible / Cloudflare Workers AI |
| 认证 | JWT (Bearer Token) |
| 部署 | Cloudflare Pages + GitHub Actions |

---

## 功能模块

| 模块 | 路由 | 说明 |
|------|------|------|
| 仪表盘 | `/dashboard` | 招聘漏斗、岗位分析、面试官分析 |
| 需求管理 | `/requisitions` | 招聘需求创建、审批、状态流转 |
| 岗位管理 | `/positions` | 岗位创建、JD AI 生成、公开发布 |
| 渠道管理 | `/channels` | 招聘渠道维护、效果分析 |
| 简历管理 | `/resumes` | 简历上传、PDF 预览、AI 解析、匹配评分 |
| 人才库 | `/talent-pool` | 入库候选人管理、标签、状态跟踪 |
| 面试管理 | `/interviews` | 多轮面试、面试小组、AI 出题与评分 |
| 笔试管理 | `/coding-tests` | 算法题、选择题、问答题、AI 评测 |
| 背调管理 | `/background-checks` | 背景调查记录与状态 |
| Offer 管理 | `/offers` | Offer 发送、确认、模板管理 |
| 入职管理 | `/onboarding` | 入职记录与状态跟踪 |
| 试用期管理 | `/probation` | 试用期跟踪、转正评估 |
| 简历初筛 | `/resume-screening` | 小七 AI 引擎 - 简历自动筛选 |
| 招聘日报 | `/daily-reports` | AI 生成日报/周报 |
| 题库管理 | `/question-banks` | 题库上传、分类管理 |
| 工作流 | `/workflows` | React Flow 可视化编排 |
| 系统设置 | `/settings/*` | 用户、岗位映射、能力维度等配置 |

---

## 快速开始

### 环境要求

- Node.js 20+ / npm 10+
- Python 3.11+
- Docker Desktop

### 1. 启动 PostgreSQL

```bash
docker compose up -d postgres
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env 填入数据库密码、LLM API Key 等
```

### 3. 安装依赖

```bash
# 前端
cd frontend && npm install

# 后端 (Python 虚拟环境)
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Worker
cd worker && npm install
```

### 4. 数据库迁移

```bash
cd backend
source venv/bin/activate
alembic upgrade head
```

### 5. 启动服务

```bash
# 方式一：一键启动
./start.sh

# 方式二：分步启动
make dev-backend   # 后端 :8000
make dev-frontend  # 前端 :5173
```

### 6. 登录

打开 http://localhost:5173

| 角色 | 邮箱 | 密码 |
|------|------|------|
| 管理员 | `admin@example.com` | `admin123` |

---

## API 接口

API 文档：http://localhost:8000/docs

所有 API 需携带 `Authorization: Bearer <token>`。

### 认证

| 方法 | 路径 | 功能 |
|------|------|------|
| POST | `/api/auth/login` | 登录，返回 JWT |

### 核心 CRUD (17 个模块)

`/api/requisitions`, `/api/positions`, `/api/resumes`, `/api/talent-pool`, `/api/interviews`, `/api/coding-tests`, `/api/offers`, `/api/offer-templates`, `/api/onboarding-records`, `/api/probation-records`, `/api/background-checks`, `/api/channels`, `/api/question-banks`, `/api/workflows`, `/api/users`, `/api/system-configs`, `/api/position-mappings`

### AI 端点

| 方法 | 路径 | 功能 |
|------|------|------|
| POST | `/api/resumes/:id/parse` | AI 简历解析 |
| POST | `/api/resumes/:id/match` | AI 岗位匹配评分 |
| POST | `/api/positions/:id/generate-jd-stream` | AI 生成 JD |
| POST | `/api/interviews/:id/ai-analysis` | AI 面试分析 |
| POST | `/api/resume-screening/:id/ai-analyze` | 小七 AI 初筛分析 |
| POST | `/api/daily-reports/generate` | AI 生成日报 |

---

## 项目结构

```text
ai-interview/
├── frontend/                    # React 19 + Vite 7 + TypeScript + Ant Design 6
│   ├── src/
│   │   ├── pages/               # 15 个页面模块
│   │   ├── components/          # 通用组件 (Layout, PdfViewer, CodeEditor...)
│   │   ├── contexts/            # AuthContext
│   │   ├── router/              # 路由配置 (懒加载)
│   │   └── utils/               # request.ts, pdfPreview.ts
│   └── functions/               # Cloudflare Pages Functions
│
├── backend/                     # Python FastAPI + SQLAlchemy 2.0
│   ├── app/
│   │   ├── main.py              # FastAPI 入口
│   │   ├── models/              # 数据模型 (models.py, hr_models.py, workflow_models.py)
│   │   ├── routes/              # 17 个路由模块
│   │   ├── services/            # 18 个业务服务
│   │   ├── schemas/             # Pydantic 请求/响应模型
│   │   ├── config/              # database.py, prompt_variables.py
│   │   ├── core/security.py     # JWT / 密码安全
│   │   ├── utils/               # prompt_manager, file_storage
│   │   └── templates/           # 邮件/通知 HTML 模板
│   ├── alembic/                 # 数据库迁移 (19 个版本)
│   └── tests/                   # pytest 测试文件
│
├── worker/                      # Cloudflare Workers (Hono + TypeScript + D1)
│   ├── src/index.ts             # Worker 入口
│   └── wrangler.toml            # Cloudflare 配置
│
├── xiaoqi/                      # 小七 AI Agent (飞书机器人 + 简历初筛)
│   ├── bot/                     # 飞书机器人
│   └── handler.js               # 消息处理器
│
├── scripts/                     # 迁移/运维/调试脚本 (50+)
├── docs/                        # 文档与截图
├── docker-compose.yml           # 本地 PostgreSQL
├── Makefile                     # 开发命令
├── start.sh                     # 一键启动脚本
└── .env.example                 # 环境变量模板
```

---

## 数据库结构

共 28 张表，涵盖招聘全链路：

- **核心业务**: users, positions, resumes, interviews, offers, coding_tests
- **流程管理**: requisitions, onboarding_records, probation_records, background_checks
- **AI 初筛**: resume_screening_queue, position_mappings, capability_dimensions
- **工作流**: workflows, workflow_nodes, workflow_edges, workflow_executions
- **辅助**: talent_pool, channels, question_banks, offer_templates, daily_reports

---

## License

MIT
