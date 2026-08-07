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

## 当前开发状态 (2026-08-07)

| 模块 | 状态 | 说明 |
|------|------|------|
| 仪表盘 | ✅ 运行中 | 实时/历史快照、7 项 KPI、招聘诊断、全链路漏斗、事业部与 HRBP 效能、岗位明细、只读分享 |
| 简历管理 | ✅ 运行中 | 飞书导入、BOSS 导入、邮箱同步、异步上传（队列并发）、字段提取、AI 初筛与能力维度评分、Excel 导出、学历/专业/年龄/性别/岗位筛选 |
| 岗位管理 | ✅ 运行中 | 飞书同步、能力维度定义（AI 初筛依据）、AI 生成 JD |
| 面试管理 | ✅ 运行中 | 飞书同步、一面/二面面试官、提醒、评价流转 |
| 面试官管理 | ✅ 运行中 | 手动添加 open_id，飞书搜索（待权限审批） |
| 入职管理 | ✅ 运行中 | 飞书同步 |
| 试用期管理 | ✅ 运行中 | |
| 招聘日报 | ✅ 运行中 | Workers AI 自动生成摘要，字段映射已修复 |
| 需求管理 | ✅ 运行中 | |
| **AI 能力维度初筛** | ✅ 已完成 | 批量自动初筛，按岗位能力维度逐项 0-5 打分，卡片联动展示 |
| **D1 独立运行** | ✅ 已完成 | 简历管理、面试管理、淘汰/入库等操作完全脱离飞书，飞书同步仅保留手动触发 |
| 飞书集成 | ✅ 已接入 | 多维表格数据同步（手动触发）+ 机器人卡片消息、token D1 缓存 |
| 飞书 OAuth 绑定 | ✅ 运行中 | 登录用户绑定飞书身份，本地自动判断回调地址 |
| AI 三层降级 | ✅ 已启用 | DeepSeek V4 Flash → Workers AI Llama 3.3 70B → Llama 3.1 8B |
| 系统设置 | ✅ 已完善 | AI 提示词模板（JD/简历分析/字段提取/初筛/补充评分/招聘日报）可在线编辑，AI 模型配置前后端打通 |
| 提示词管理 | ✅ 已完成 | 所有提示词通过 getAIPrompt 统一管理，系统设置修改即时生效 |
| MinerU OCR | ✅ 已接入 | 飞书 PDF → MinerU Agent API → Markdown 文本提取，队列异步处理 |
| 安全加固 | ✅ 已完成 | 明文密码移除、timing-safe 比较、CORS 白名单、DOMPurify、密钥 Pages Secrets |
| 性能优化 | ✅ 已完成 | N+1 修复、静态资源缓存、图片压缩、chunk 拆分、D1 索引 |
| 日志审计 | ✅ 已完成 | operation_logs 表 8 处核心埋点，上线自检 5 项全绿 |

### 最近更新 (2026-08-07)

**飞书妙搭邮箱简历同步：**

- 集成飞书妙搭邮箱简历同步，支持多邮箱管理。
- 外部邮箱拉取的简历自动进入队列处理流程：OCR 文本提取 → 字段提取 → AI 初筛 → 能力维度评分。
- 简历管理页完全脱离飞书依赖，淘汰/入库/重置等操作只操作 D1 数据库。

**AI 提示词系统完善：**

- 系统设置页可编辑所有 AI 提示词模板：JD 生成、简历分析、PDF 简历解析、简历 Markdown 生成、简历字段提取、简历初筛、简历初筛补充评分、招聘日报。
- 提示词通过 `getAIPrompt()` 统一管理，修改保存后下次调用对应功能即时生效。
- 删除冗余提示词（面试题目/评价/转写/笔试代码），合并旧 `analyze_resume` 路径到新提示词体系。
- 变量名与实际代码统一：`{position}`, `{resume_text}`, `{fields}`, `{capability_dimensions}`, `{job_description}`, `{personalized_requirements}`。

**简历管理增强：**

- 新增学历筛选条件，筛选条件持久化到 URL/`sessionStorage`，跨页面导航后自动保留。
- 岗位筛选使用标准岗位名（岗位映射），年龄/专业/性别/岗位筛选移到服务端支持跨页。
- SQL 分页查询优化加载速度，入库按钮点击后立即更新卡片状态（异步）。
- 移除简历卡片冗余按钮（硬性要求检查/能力维度评分）。
- 导出 Excel 支持，HR 复合结果基于 status 映射（通过/不通过/0）。

**修复：**

- 修复重新评估时无法重新 OCR 的问题。
- 修复 AI 模型配置前后端打通（GET 不返回完整 key）。
- 修复 talent-pool 按 `updated_at` 排序、education 数组回退。
- 修复淘汰/重置/清除已淘汰接口不再依赖飞书 Bitable。
- 修复简历岗位显示/筛选用标准岗位名。
- 修复年龄筛选兼容多种日期格式。
- 修复筛选条件持久化。
- 修复妙搭 API 代理 JSON 解析错误。

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
