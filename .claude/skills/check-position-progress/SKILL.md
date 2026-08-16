---
name: check-position-progress
description: 招聘系统统一查询入口。可查全部数据域：岗位进度与简历（按岗位/按人/按面试官，支持姓名容错如「魏秋宁→魏秋柠」）、面试官待办、招聘任务、面试、人才库、Offer、招聘需求、入职/试用、背调、岗位映射、全局统计（漏斗）、日报、看板快照、AI 用量；并可批量入库/淘汰简历、以飞书表格或卡片交付简历。当用户想了解「某个岗位招到哪一步了」「某面试官有哪些待办/待筛选/待面试的简历」「这个岗位有哪些候选人」「拿取某人的相关简历并交付」「批量入库/淘汰符合条件的简历」「查某个数据域的明细」时使用。
---

# 招聘系统查询手册

本 skill 是系统的统一查询入口：所有数据都以 `/api/public/*` 只读查询接口开放，并**全部写在这里**，以后直接按本手册查即可。

## 0. 通用约定

**接口基地址**：Worker 部署地址（本地 dev 为 `http://127.0.0.1:8788`，生产为部署域名，如 `https://ai-interview-88r.pages.dev`）。

**两档鉴权**（决定返回字段的完整程度）：

| 调用方式 | 模式 | 返回内容 |
| --- | --- | --- |
| 不带任何头 | `public` 公开脱敏 | 进度类字段，**不含**联系方式（contact/email）、简历原文（raw_text）、解析数据（parsed_data）、AI 评估、offer 薪资、预算等敏感字段 |
| `x-api-key: <RESUME_UPLOAD_API_KEY>` | `full` 完整 | 返回完整字段（含联系方式、offer 薪资等）。key 值见系统配置 `RESUME_UPLOAD_API_KEY` |

- **写接口**（批量 action、export 交付、review 详情）必须带 `x-api-key` 或 `Authorization: Bearer <jwt>`，否则 `401`。
- **分页**：所有列表接口都支持 `limit`（默认 50，最大 200）与 `offset`（默认 0），响应统一为 `{ total, limit, offset, items }`。
- **姓名容错**：所有按人查询（`person/:name/*`）都支持「差一个字也能匹配」——内部用编辑距离 ≤ 1 自动纠错。例：查「魏秋宁」自动解析为「魏秋柠」，响应里 `person` 是被纠错后的正确姓名，并附 `matched_from: "魏秋宁"` 标注原输入。若差一字的候选不唯一，则返回 `{ matched: null, candidates: [...] }` 供选择。
- **公共字段脱敏红线**：公开模式永远不返回 `contact/email/raw_text/parsed_data/ai_evaluation/offer 薪资`。带 key 的完整模式才返回。

---

## 1. 岗位

### 1.1 岗位列表
```
GET /api/public/positions?limit=50&offset=0&status=open&keyword=软件&responsible_person=张三&department=研发部
```
- `status`：按岗位状态过滤（open/published/recruiting/draft/paused/closed）
- `keyword`：标题/部门/描述模糊匹配；`responsible_person` / `department` 精确匹配

### 1.2 单个岗位进度（漏斗）
```
GET /api/public/positions/{positionId}/progress
```
返回岗位基本信息 + `progress` 漏斗（简历数、AI 初筛、各轮面试、offer、入职）+ `resume_status_breakdown` 状态分布。**只对招聘中的岗位开放**（`status` 为 open/published/recruiting），草稿/暂停/已关闭返回 404。

> **简历数口径（与前端简历页一致）**：`position_id` 直接命中，或原始岗位名（`mapped_position`/`position_applied`）经 `position_mappings` 解析后等于本岗位标题的简历都计入。因此数量可能远大于「标题精确匹配」——例如「软件产品经理（智能硬件方向）」会把「IoT产品经理（双休）」「智能硬件产品经理」等映射名的简历都算进来（实际 200+ 份，而非 2 份）。

### 1.3 岗位简历列表
```
GET /api/public/positions/{positionId}/resumes?limit=50&offset=0&status=pending_interview
```
只看该岗位候选人，`status` 可按简历状态过滤。返回进度字段，不含联系方式与原文。

---

## 2. 简历

### 2.1 全量简历列表
```
GET /api/public/resumes?limit=50&offset=0&status=pending_screening&screening_result=通过&keyword=王&education_min=本科&age_max=30
```
过滤参数（可组合）：
- `status` / `stage` / `screening_result`（通过/不通过/待定）
- `keyword`：候选人姓名/投递岗位模糊匹配
- `position_id` / `position_applied` / `mapped_position`
- `education_min` / `education_max` / `education`（学历等级过滤，需在服务端解析 parsed_data，公开模式不暴露学历）
- `age_min` / `age_max`（年龄过滤，同上）

### 2.2 简历详情
```
GET /api/public/resumes/{resumeId}
```
公开模式返回脱敏字段（姓名/岗位/状态/初筛结果/学历等），带 key 返回完整字段（含联系方式、parsed_data、AI 评估、原文）。

### 2.3 按人查简历（负责人/面试官相关）
```
GET /api/public/person/{姓名}/resumes?limit=50&offset=0&status=pending_interview
```
「相关」= 该人是岗位负责人/面试官、岗位映射责任人、招聘任务责任人/面试官、或面试记录里的面试官。**支持姓名容错**（见 §0）。响应 `person` 为纠错后姓名，附 `matched_from`；候选不唯一时返回 `candidates`。

---

## 3. 面试官

### 3.1 面试官列表（含聚合统计）
```
GET /api/public/interviewers?keyword=魏&limit=50&offset=0
```
每项返回：`name`、`position_count`（负责岗位数）、`pending_interview_count`（待面试/进行中面试数）、`pending_task_count`（招聘任务数）。带 key 额外返回 `open_id`。

### 3.2 某面试官的待办（核心）
```
GET /api/public/person/{姓名}/todo
```
返回该面试官**待办分组**（支持姓名容错）：
- `summary`：各组计数一目了然
- `groups.pending_resumes`：待筛选/待复审/待部门评审/待HR决策的简历
- `groups.ai_passed`：AI 初筛「通过」且仍未处理的简历（最需要看的一批）
- `groups.pending_interview`：待面试的简历
- `groups.recruitment_tasks`：他的招聘任务
- `groups.interviews`：已安排/进行中的面试

示例：查「魏秋宁」的待办（会纠错为「魏秋柠」）：
```
curl "https://ai-interview-88r.pages.dev/api/public/person/%E9%AD%8F%E7%A7%8B%E5%AE%81/todo"
```

---

## 4. 招聘任务
```
GET /api/public/recruitment-tasks?status=pending&responsible_person=张三&interviewer=李四
```
返回 `position_name`、`status`、`assignee`、`due_date`、`notes`、`interviewers`、`responsible_person`、`city`。

---

## 5. 面试
```
GET /api/public/interviews?status=scheduled&interviewer=黄维&position_id=pos-1&date_from=2026-08-01&date_to=2026-08-31
GET /api/public/interviews/{interviewId}
```
列表过滤：`status`（scheduled/in_progress/completed/cancelled）、`result`、`interviewer`（含一二面面试官）、`position_id`、`date_from`/`date_to`。列表返回进度字段；带 key 的详情含 `comments/evaluation/scores` 等。

---

## 6. 人才库
```
GET /api/public/talent-pool?status=available&keyword=前端
```
公开模式不含 `email`/`phone`，带 key 返回完整（含期望薪资、标签、来源）。

---

## 7. Offer
```
GET /api/public/offers?status=approved&position_id=pos-1&keyword=王
```
公开模式不含薪资与邮箱，带 key 返回 `salary_monthly`/`salary_annual`/`candidate_email` 等。

---

## 8. 招聘需求
```
GET /api/public/requisitions?status=pending&department=研发部
```
带 key 额外返回 `description`/`requirements`/`budget`/`channel_plan` 等。

---

## 9. 入职 / 试用期
```
GET /api/public/onboarding?status=onboarded
GET /api/public/probation?result=pass
```
- `onboarding`：按 `status`（pending/onboarded 等）过滤
- `probation`：按 `result` 过滤；带 key 返回 `salary_adjustment` 等

---

## 10. 背调
```
GET /api/public/background-checks?status=pending
```

---

## 11. 岗位映射
```
GET /api/public/position-mappings
```
返回 `raw_name`/`mapped_name`/`responsible_person`/`interviewers`，用于理解岗位名与简历岗位的对应关系。

---

## 12. 全局统计
```
GET /api/public/overview
```
一次返回：`overview`（活跃岗位、编制、简历总数、待处理简历、面试漏斗转化率、offer、入职）、`funnel`（简历推送→安排面试→面试通过→发放Offer→已入职 五段漏斗）、`resume_status_breakdown`（简历状态分布）、`hr_stats`（需求数、人才库规模、入职/试用计数）。

---

## 13. 日报 / 快照 / AI 用量
```
GET /api/public/daily-reports?report_date=2026-08-14        # 或 date_from/date_to
GET /api/public/snapshots
GET /api/public/ai-usage?date_from=2026-08-01&date_to=2026-08-14
```
- `daily-reports`：日报聚合数字；带 key 返回 `ai_summary`/`candidate_details`
- `snapshots`：招聘看板快照列表；带 key 返回 `payload_json` 完整看板
- `ai-usage`：每日 token 用量，含 `totals` 汇总

---

## 14. 简历交付（表格 / 卡片）

按人交付相关简历给本人：
```
POST /api/public/person/{姓名}/export
Content-Type: application/json
x-api-key: <RESUME_UPLOAD_API_KEY>
{ "form": "table" | "cards" }
```
- `table`：飞书多维表格（每行一个候选人，末列「操作」为决策链接），授权目标人查看并发送链接
- `cards`：逐张候选人卡片，带 ✅入库 / ❌不入库 按钮
- 单次卡片最多 50 张；表格最多 200 行。需目标人已同步飞书 open_id（未绑定先调 `POST /api/settings/interviewers/batch-sync-from-feishu`）

---

## 15. 批量入库 / 淘汰

按条件在服务端过滤并**直接变更简历状态**（入库→approved，淘汰→rejected）：
```
POST /api/public/resumes/action
Content-Type: application/json
x-api-key: <RESUME_UPLOAD_API_KEY>
{ "action": "approve" | "reject", "conditions": { ... }, "limit": 200 }
```
`conditions` 支持：`related_person`、`position_id`、`status`、`screening_result`、`education_min/max`、`education`、`age_min/max`。

学历等级：`小学 < 初中 < 高中 < 中专 < 大专 < 本科 < 硕士 < 博士`。

常见场景：
- 本科及以上 + AI 通过入库：`{"action":"approve","conditions":{"screening_result":"通过","education_min":"本科"}}`
- 大专且 ≤30 岁淘汰：`{"action":"reject","conditions":{"education":"大专","age_max":30}}`

⚠️ **没有 dry-run**：`matched > 0` 即真实变更。执行前先用 §2.3 或 §3.2 确认候选人符合预期。

---

## 使用建议

- 想快速了解全局 → `overview`（§12）。
- 某个岗位招到哪一步 → `positions/:id/progress`（§1.2）。
- 某面试官的待办 → `person/:name/todo`（§3.2），重点看 `ai_passed` 和 `pending_interview`。
- 按人拿简历并交付 → `person/:name/resumes` + `person/:name/export`（§2.3 / §14）。
- 批量处理 → `resumes/action`（§15），先查后改。
- 查具体数据域明细（面试/任务/offer/人才库等）→ 对应章节。
- 汇报建议先给漏斗汇总 + 岗位信息，再按需展开候选人明细。
