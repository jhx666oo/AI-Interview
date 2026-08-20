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

## 当前开发状态 (2026-08-19)

| 模块 | 状态 | 说明 |
|------|------|------|
| 仪表盘 | 🟡 产品联调中 | 现有实时/历史快照、KPI、招聘诊断、全链路漏斗、事业部与 HRBP 效能、岗位明细和只读分享能力保留；新的产品 API 与视觉口径待确认，本轮不改动 |
| 简历管理 | ✅ 运行中 | 飞书导入、BOSS 导入、邮箱同步、异步上传（队列并发）、字段提取、AI 初筛与能力维度评分、Excel 导出、学历/专业/年龄/性别/岗位筛选；非终态简历可推送或淘汰 |
| 岗位管理 | ✅ 运行中 | 飞书同步、标准岗位映射、能力维度定义、AI 生成 JD；岗位配置默认负责人、一面面试官和二面面试官 |
| 面试管理 | ✅ 运行中 | 飞书同步、一面/二面面试官、提醒、评价流转；新建面试自动继承岗位默认面试官，可手动覆盖 |
| 面试官管理 | ✅ 运行中 | 飞书面试官目录同步、open_id 精确映射和重复映射校验 |
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
| **响应式管理页面** | ✅ 已完成 | 宽表格页面按容器宽度切换大屏表格、中屏双列卡片、小屏单列卡片；保留分页、全选、行选择、操作按钮与详情展开 |
| **仪表盘岗位明细** | ✅ 已完成 | 小屏支持按事业部折叠/展开，保留岗位详情、一面/二面/三面通过、Offer、入职与合计数据 |
| **重复分页修复** | ✅ 已完成 | 自定义 `SimplePagination` 页面关闭 Ant Design 内置分页，避免出现两套翻页控件 |
| **面试自动化闭环** | 🧪 本地实施分支 | AI 初筛→业务筛选→待安排面试→飞书日程/通知→评价→下一轮；D1 作业与通知可追踪、去重、重试，生产开关默认关闭 |
| **业务简历推送与筛选** | ✅ 已完成 | HR 批量推送 → 面试官专属链接 → 业务筛选入库/不入库 → 回写简历主流程；同一面试官跨岗位、跨重复提醒复用同一链接 |
| **批量重新评估** | ✅ 已上线 | AI 工具支持“全部重评”和“重评未评估/失败简历”，按当前用户可见范围创建批次并异步入队 |
| **重评进度与停止处理** | ✅ 已上线 | 展示完成数、排队数、评估中数量、当前候选人、失败项和进度条；支持停止批次并保留已完成结果 |
| **AI 初筛关键词规则 v2** | ✅ 已上线 | 5 年智能硬件/IoT/嵌入式经验、ODM/外包团队管控、知名企业智能硬件背景按三点规则评分；关键词达到 2 分即可通过关键词门槛 |
| **妙搭仪表盘 v3 双源聚合** | 🧪 本地验收 | 飞书岗位主数据 + D1 简历/流程增量；7 级全局漏斗、事业部 mini 漏斗、HRBP 效能、P2 独立明细和 v3 分享兼容；等待产品 API 与视觉确认后再切换生产 |
| **鹅宝招聘查询 Skill** | ✅ 接口已提供 | 通过 `/api/public/*` 查询岗位、简历、负责人待办、面试、人才库、Offer、入职、日报、看板和 AI 用量；支持按人名容错查询 |
| **生产发布链路** | ✅ 运行中 | GitHub Actions 自动执行 D1 migration、Cloudflare Pages、API Worker、Resume Consumer Worker 和健康检查 |

仪表盘 v3 的字段、统计集合和转化率公式见 [`docs/dashboard-migration/data-contract.md`](docs/dashboard-migration/data-contract.md)。

### 面试自动化闭环（一期）

- 业务筛选通过后幂等创建待安排的一面；一面通过后创建待安排的二面。
- HR 确认时间后，由 Cloudflare Queue 异步创建飞书招聘日程，通知面试官并发送候选人邮件。
- 每轮面试独立记录，自动化作业和每个通知通道均支持查询、去重、失败重试和人工接管。
- 公开面试卡片与候选人邀请页为受限只读；评价、改期和取消必须登录并经过权限校验。
- 全局 `INTERVIEW_AUTOMATION_ENABLED` 和岗位 `auto_business_screening_enabled` 默认关闭；生产启用前必须完成数据审计、预览验收和灰度观察。
- 需求文档：[`docs/superpowers/specs/2026-08-20-interview-automation-closed-loop-requirements.md`](docs/superpowers/specs/2026-08-20-interview-automation-closed-loop-requirements.md)
- 执行计划：[`docs/superpowers/plans/2026-08-20-interview-automation-closed-loop.md`](docs/superpowers/plans/2026-08-20-interview-automation-closed-loop.md)

### 当前项目进度（2026-08-19）

#### 业务筛选与链接规则

- 简历管理中的业务筛选推送已从“只允许 AI 初筛通过”调整为：非 HR 淘汰、非业务筛选终态、具备标准岗位和有效负责人的简历均可推送；AI 初筛结果仍用于展示和筛选，不再作为推送阻断条件。
- 同一面试官以飞书 `open_id` 作为业务范围唯一标识。同一面试官负责多个岗位时，跨岗位、跨多次提醒、跨不同发送人身份都复用同一业务筛选链接。
- 推送时只追加新的候选人，按 `(batch_id, resume_id)` 去重；飞书提醒卡片也始终指向同一链接，并展示该链接当前所有待筛选简历数量。
- 一个链接页面支持按岗位复选筛选，面试官可以在同一链接内切换不同岗位的候选人，不需要记忆多个链接。
- 普通链接默认有效期为 30 天，可在推送/重发时选择 7 天、30 天、90 天或永久；有效期内重复推送和重复提醒继续复用原链接，链接过期后才进入新的周期，HR 主动淘汰会撤销相关链接。
- 业务筛选公开页支持单份和批量“入库/不入库”，回调具备幂等、冲突保护和 HR 终态校验；可查看结构化候选人档案、AI 初筛结果、简历文本和 PDF 原件（若原件已缓存）。
- 公开页标题支持由查询主题传入；未传标题或标题仅包含“100份”“3人”等数量时，统一显示“业务筛选”，避免把候选人数误当成页面标题。

#### 岗位、面试官与岗位映射

- 岗位管理中的标准岗位名是业务主数据；简历管理、面试管理和业务筛选链接均优先显示标准岗位名。
- 岗位映射表继续保存飞书原始岗位名称，并将其映射到标准岗位；负责人和一面/二面面试官分别从岗位主数据与面试官目录解析，避免同名字段混用。
- 面试管理新建或同步候选人时，会优先继承岗位管理配置的一面、二面面试官；只有岗位未配置或人工需要调整时才手动覆盖。

#### 鹅宝招聘查询 Skill / 对外接口

鹅宝 Skill 的查询基地址为 `https://ai-interview-88r.pages.dev`。当前主要使用以下接口：

| 能力 | 接口 |
|------|------|
| 岗位与岗位进度 | `GET /api/public/positions`、`GET /api/public/positions/{id}/progress`、`GET /api/public/positions/{id}/resumes` |
| 简历与简历详情 | `GET /api/public/resumes`、`GET /api/public/resumes/{id}` |
| 按负责人/面试官查简历 | `GET /api/public/person/{name}/resumes`、`GET /api/public/person/{name}/todo` |
| 面试官、任务、面试 | `GET /api/public/interviewers`、`GET /api/public/recruitment-tasks`、`GET /api/public/interviews`、`GET /api/public/interviews/{id}` |
| 人才库及招聘流程 | `GET /api/public/talent-pool`、`/offers`、`/requisitions`、`/onboarding`、`/probation`、`/background-checks` |
| 映射、统计和报表 | `GET /api/public/position-mappings`、`/overview`、`/daily-reports`、`/snapshots`、`/ai-usage` |
| 简历交付与批量处理 | `POST /api/public/person/{name}/export`、`POST /api/public/resumes/action` |

鉴权边界：公开查询默认返回脱敏字段；配置完整访问凭证后，大部分公共列表/详情接口可返回更完整字段。简历交付和批量入库/淘汰属于写操作，必须使用受保护凭证。业务筛选链接本身通过 token 鉴权，可直接查看和回传入库/不入库结果。

目前“生成新的业务筛选链接”的推送/重发接口仍是系统内部的管理员/HR 登录接口；鹅宝 Skill 已能查询和交付相关简历，但不能仅凭公开查询接口绕过管理员权限生成链接。

#### 最近一次生产发布

- Git 提交：`f5679e7`（合并远端并包含业务筛选标题兜底修复）。
- 部署工作流：`32210178534`，D1 migration、Pages 前端、API Worker、Resume Consumer Worker 全部成功。
- 线上健康检查：`https://ai-interview-88r.pages.dev/health` 返回 HTTP 200。
- 生产固定业务筛选链接已验证：标题为“业务筛选”，负责人链接状态正常，链接有效期按批次配置执行。
- 本地验证：Worker 全量测试 72 个测试文件、576 个测试通过；前端生产构建和部署预检通过。

### 最近更新 (2026-08-14)

**批量重新评估：**

- 简历管理页的「AI 工具」内提供「全部重评」和「重评未评估/失败简历」两个入口，沿用当前登录用户可见的简历权限范围。
- 批量任务使用 D1 批次记录和 Cloudflare Queue 异步处理，避免一次请求同步等待全部 AI 评估。
- 页面展示批次总数、完成数、排队数、评估中数量、失败数、当前候选人及处理阶段，并在任务进行中支持「停止处理」。
- 停止处理只取消尚未开始的任务，已经完成的评估结果保留；失败项可单独重新提交。
- 批次协调器按页发现和入队简历，并对丢失的队列消息执行超时恢复，避免页面长期停留在“评估中”。

**AI 初筛规则 v2：**

- 关键词匹配改为三个业务判断点：智能硬件/IoT/嵌入式相关经验、ODM/外包团队对接与需求管控经验、知名企业智能硬件相关背景。
- 每个判断点命中一个关键词或明确经历即可计入该点；满足一个点得 2 分，满足两个点得 3 分，满足三个点得 4–5 分。
- 关键词匹配达到 2 分即可通过关键词门槛；避坑雷区仍保持 5 分硬门槛，其他能力维度继续用于综合评分。
- 规则已同步到系统设置的简历初筛提示词，并兼容历史保存的旧提示词配置。

**自定义简历筛选：**

- 简历管理页新增「自定义筛选」：选择岗位 + 输入自定义条件（如「持有护士证」），在该岗位全部简历的文本内容（OCR / raw_text / resume_markdown / 解析字段）中检索匹配简历。
- 关键词 token 预筛先控制 AI 成本，再用 AI 对候选池做 0-100 语义评分并给出一句理由；AI 失败或漏评的简历自动回退关键词打分（命中/分词数比例）。
- 命中结果按符合程度从高到低以卡片展示，每张卡片带「符合程度」徽标（按阈值变色）+ 评分依据 tooltip；支持阈值、清除筛选。

**验证与发布：**

- 最新生产部署 workflow `31781641693`：D1 migration、Cloudflare Pages、Resume Consumer Worker 和健康检查全部成功。
- 生产健康检查 `https://ai-interview-88r.pages.dev/health` 返回 HTTP 200，且 `ai_binding: true`。
- 2026-08-14 当前批量重评观察快照：总计 260 份，已完成 11 份，评估中 3 份，排队 11 份，失败 0 份；该数字会随任务运行持续变化。

### 最近更新 (2026-08-13)

**业务端简历推送与筛选流程：**

- 简历管理主操作由“入库/不入库”调整为“推送/淘汰”：仅 AI 初筛通过且未被 HR 淘汰的简历可推送，推送后按岗位配置的面试官分组生成批次链接。
- 每个面试官收到一条本批次专属安全链接（随机 Token + SHA-256 哈希存储，默认 7 天有效），无需登录即可查看本批次相关简历、解析文本和原件，并执行“入库/不入库”。
- 回调支持幂等与冲突保护：重复回调不重复写入；已完成决策不可被反向覆盖；旧批次/旧链接在重发或 HR 淘汰后返回 410/409 且零写入。
- 同一候选人在一次推送中可同时分发给主/副面试官（共享 dispatch 组），首个有效决策关闭同批其他待处理项；重发会切换新 dispatch 组，旧链接失效。
- HR 淘汰会立即撤销相关活动批次，回调落库前再次校验 HR 终态，确保旧回调无写入。
- 岗位管理支持以面试官目录下拉选择默认一面/业务筛选及二面面试官；面试创建时自动带出岗位默认面试官（可覆盖）。
- 简历列表与优化 SQL 列表均暴露并支持按 `business_screening_status=pending|passed|rejected` 过滤。
- 仪表盘本期不改动，相关指标口径（AI 初筛通过、业务筛选通过等）已预留等待产品 API 与视觉稿。

**验证与发布：**

- Worker 测试：44 个测试文件、312 个测试通过。
- Frontend 测试：33 个测试文件、147 个测试通过。
- Frontend 生产构建（含 `_worker.js` 编译）通过；TypeScript 类型检查通过（业务筛选模块无新增错误）。
- 生产健康检查 `https://ai-interview-88r.pages.dev/health` 返回 `{"status":"ok"}`。

### 最近更新 (2026-08-12)

**管理页面响应式改造：**

- 需求管理、岗位管理、岗位映射、面试官映射、用户管理、入职管理、试用期管理、面试管理、人才库、能力维度、工作流、JD 管理、评测等宽表格页面已接入统一响应式视图。
- 大屏保留原 Ant Design Table；中屏切换双列卡片；小屏切换单列卡片，避免用户必须拖动页面级横向滚动条。
- 卡片模式保留 `rowKey`、分页、全选、禁用行、操作回调和详情展开；操作按钮在窄屏自动换行。
- 桌面表格的横向滚动提示改为按需启用，不影响普通表格、弹窗表格和已有分页布局。
- 仪表盘底部“全量岗位明细汇总”在小屏保留事业部折叠/展开、岗位详情、阶段通过数据和合计行。

**最近修复：**

- 修复 `ResponsiveDataView` 在 `pagination={false}` 时错误生成 Ant Design 默认分页，导致岗位管理等页面出现两套翻页 UI。
- 修复响应模式切换时非受控分页页码重置、数据缩减后页码越界、窄屏操作按钮被卡片裁切等问题。

**验证与发布：**

- 前端测试：23 个测试文件、96 个测试通过。
- TypeScript 类型检查通过。
- GitHub Actions 已完成 D1 migration、Cloudflare Pages、Resume Consumer Worker 部署。
- 生产健康检查 `https://ai-interview-88r.pages.dev/health` 返回 HTTP 200。

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

### 飞书面试提醒与招聘日报运维

- 人工发送面试提醒使用当前登录用户的飞书身份；发送前，该用户必须在「个人设置」完成飞书 OAuth 绑定。应用版本需开通 IM 消息权限（包括 `im:message`、`im:message.send_as_user`）以及「获取与上传图片或文件资源」权限。
- `interviewer_mappings.open_id` 必须来自与当前 OAuth/发送应用相同的飞书应用，并与面试官姓名精确、唯一对应。同名映射得到多个不同 `open_id` 时系统会拒绝发送，不会猜测接收人。
- 简历 PDF 通过飞书 IM 文件接口上传；文件必须非空且不得超过 30 MiB。超过限制时不会发起上传。
- Worker cron 发送招聘日报时必须在运行环境配置 `FEISHU_RECRUITMENT_GROUP_CHAT_ID`。该值是非密钥运行配置；应用密钥、用户 token 等敏感值仍须使用 Cloudflare Secrets，不要写入仓库。
- 本分支新增的 D1 `0025_feishu_token_failed_at.sql` 和 `0026_resume_approved_at.sql` 应按未部署迁移处理。发布顺序必须是：先对目标 D1 依次应用 `0025`、`0026`，确认成功后再部署 Worker；否则 token 刷新状态和日报“当日通过”口径会处于兼容降级状态。
- 提醒接口的“部分成功”表示卡片已经送达（`card_sent=true`），但 PDF 上传或文件消息失败（`file_sent=false`，并返回 `warning`）；不得把它展示成完整成功，也不应因为附件失败而重复发送卡片。
- 每份招聘日报保存不可变的 v2 统计与候选人明细快照；历史查看和再次发送都读取原快照，不按当前数据库重算。负责人行固定按「何雨菱 → 杜雁玲 → 魏秋柠」排序，无法唯一归属的数据只计入 `unassigned`。

---

## 数据库结构 (D1)

核心业务表：

- **users** — 用户、角色、飞书 OAuth 绑定
- **positions** — 岗位、负责人、能力维度
- **resumes** — 简历、AI 解析、匹配评分、OCR 文本、筛选状态、业务筛选状态（`business_screening_status` / `hr_disposition` / `business_screening_remark` 等）
- **interviews** — 面试记录、一面/二面面试官、评价、状态
- **resume_push_batches / resume_push_batch_items** — 业务筛选推送批次与明细（面试官专属链接、令牌哈希、幂等回调）
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

AI 调用统一走 `worker/src/index.ts` 的 `getLLMConfigs()` + `callAI()`：

系统设置「AI 模型配置」页支持最多 **4 组模型配置**（`llm_*` / `llm2_*` / `llm3_*` / `llm4_*`），
调用时按优先级从上到下依次尝试，上一组失败（超时 / 格式错误 / 空响应）自动降级到下一组，
全部失败后才视 `AI_FALLBACK_ENABLED` 是否启用降级到 Workers AI。每组均可独立「测试连通性」。

| 优先级 | 配置来源 | 说明 |
|--------|----------|------|
| 1 | **系统设置配置 1**（D1 `system_configs` 表 `llm_*`） | 首选；缺失时回退环境变量 `AI_API_KEY` |
| 2 | **系统设置配置 2**（`llm2_*`） | 配置 1 失败时自动降级 |
| 3 | **系统设置配置 3**（`llm3_*`） | 配置 2 失败时自动降级 |
| 4 | **系统设置配置 4**（`llm4_*`） | 配置 3 失败时自动降级 |
| 5 | **Workers AI 降级**（`env.AI` binding） | 仅当 `AI_FALLBACK_ENABLED=true` 且前 4 组全部失败时启用 |

**降级链路**：`配置1` → `配置2` → `配置3` → `配置4` → `Workers AI Llama 3.3 70B` → `Workers AI Llama 3.1 8B`

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
