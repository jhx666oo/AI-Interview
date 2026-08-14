---
name: check-position-progress
description: 查看某个招聘岗位的进度（简历数、AI 初筛、各轮面试、offer、入职）以及该岗位的简历列表（全部或分页）；按人（负责人/面试官）查看其相关简历，并以飞书多维表格或卡片的形式交付（支持入库/不入库）；按条件（相关人/岗位/AI初筛结果/学历/年龄）批量入库或淘汰简历。当用户想了解"某个岗位招到哪一步了""这个岗位有多少简历""看看某岗位候选人的进展""拿取某人的相关简历并交付""批量入库/淘汰符合条件的简历""我需要面试/筛选的有哪几个"时使用。
---

# 查看岗位进度与简历

本 skill 用于查询某个岗位的招聘进度和候选人简历列表。接口为公开接口（无需登录），但**只对招聘中的岗位开放**：`status` 必须是 `open` / `published` / `recruiting` 之一，草稿（draft）、暂停（paused）、已关闭（closed）的岗位一律返回 404。

接口基地址：Worker 部署地址（本地 dev 为 `http://127.0.0.1:8788`，生产为部署域名）。

## 1. 查看岗位进度

```
GET /api/public/positions/{positionId}/progress
```

示例（本地 dev）：

```
curl http://127.0.0.1:8788/api/public/positions/pos-open-1/progress
```

### 响应结构

```json
{
  "position": {
    "id": "pos-open-1",
    "title": "软件工程师",
    "department": "研发部",
    "location": "上海",
    "salary_range": "20k-30k",
    "status": "open",
    "urgency": "high",
    "headcount": 3,
    "responsible_person": "张三",
    "description": "负责核心系统开发与维护",
    "requirements": "本科以上，3年经验"
  },
  "progress": {
    "total_resumes": 6,
    "ai_screened": 5,
    "first_interview": 3,
    "first_pass": 2,
    "second_pass": 2,
    "third_pass": 1,
    "offers": 1,
    "hired": 1,
    "resume_status_breakdown": {
      "pending_screening": 2,
      "pending_interview": 1,
      "interview_passed": 1,
      "offered": 1,
      "rejected": 1
    }
  },
  "updated_at": "2026-08-10 10:00:00"
}
```

### 字段说明

| 字段 | 含义 |
| --- | --- |
| `progress.total_resumes` | 该岗位收到的简历总数（含按岗位名匹配的简历） |
| `progress.ai_screened` | 已完成 AI 初筛的简历数 |
| `progress.first_interview` | 已进入第 1 轮面试的人数（已安排/进行中） |
| `progress.first_pass` / `second_pass` / `third_pass` | 通过第 1 / 2 / 3 轮面试的人数 |
| `progress.offers` | 已发 offer 数（不含草稿/已取消） |
| `progress.hired` | 已入职人数 |
| `progress.resume_status_breakdown` | 简历按 `status` 字段的分布，用于看候选人处于哪个阶段 |

## 2. 查看岗位简历列表（全部或一部分）

```
GET /api/public/positions/{positionId}/resumes?limit=50&offset=0&status=pending_interview
```

- `limit`：每页条数，默认 50，最大 200
- `offset`：偏移量，默认 0，用于翻页
- `status`：可选，按简历状态筛选（如 `pending_screening`、`pending_interview`、`interview_passed`、`rejected`、`offered` 等）

示例：查看某岗位的"待面试"候选人，每页 10 条：

```
curl "http://127.0.0.1:8788/api/public/positions/pos-open-1/resumes?limit=10&offset=0&status=pending_interview"
```

### 响应结构

```json
{
  "position": { "id": "pos-open-1", "title": "软件工程师", "status": "open" },
  "total": 6,
  "limit": 50,
  "offset": 0,
  "items": [
    {
      "id": "res-1",
      "candidate_name": "王小明",
      "position_applied": "软件工程师",
      "status": "pending_interview",
      "stage": "interview",
      "match_score": 85,
      "screening_result": "通过",
      "parse_status": "ai_screened",
      "created_at": "2026-08-02 09:00:00",
      "updated_at": "2026-08-02 09:00:00"
    }
  ]
}
```

### 隐私与安全注意

- 公开列表**不返回**联系方式（`contact`/`email`）与简历原文（`raw_text`/`parsed_data`），只返回进度相关字段。
- 非公开岗位（草稿/暂停/已关闭）或岗位不存在时返回 `404 {"detail":"Not found"}`。

## 3. 查看某人的相关简历并交付

当用户说"拿取所有关于某人的简历"时，可以按人名查询他的相关简历，并以两种形式交付给他：

- **"相关"的定义**：该人是岗位的**负责人（responsible_person）或面试官**（一二面面试官、岗位映射、招聘任务、面试记录里的面试官）。
- **表格形式（form=`table`）**：飞书机器人新建一张多维表格（每行一个候选人），给目标人授查看权限，并把表格链接发给他；每行末列"操作"是一个链接，点击进入决策页可 入库 / 不入库。
- **卡片形式（form=`cards`）**：给目标人逐张发候选人卡片，卡片上带 ✅入库 / ❌不入库 按钮，点击即生效。

### 3.1 查看某人的相关简历（公开接口，无需登录）

```
GET /api/public/person/{姓名}/resumes?limit=50&offset=0&status=pending_interview
```

示例（本地 dev）：查看"黄维"相关简历，每页 10 条：

```
curl "http://127.0.0.1:8788/api/public/person/%E9%BB%84%E7%BB%B4/resumes?limit=10&offset=0"
```

响应与"岗位简历列表"类似，但根字段是 `person`：

```json
{
  "person": "黄维",
  "total": 12,
  "limit": 50,
  "offset": 0,
  "items": [
    { "id": "res-1", "candidate_name": "王小明", "position_applied": "软件工程师", "status": "pending_interview", "stage": "interview", "match_score": 85, "screening_result": "通过", "parse_status": "ai_screened", "created_at": "2026-08-05 09:00:00", "updated_at": "2026-08-05 09:00:00" }
  ]
}
```

同样只返回进度字段，不返回联系方式与简历原文。

### 3.2 交付（需要 API Key 或 Bearer JWT）

> **为什么需要鉴权**：这个接口会创建文档/发飞书消息，不能公开。调用时带上 `x-api-key`（值在系统配置里，`RESUME_UPLOAD_API_KEY`）或 `Authorization: Bearer <jwt>`。

```
POST /api/public/person/{姓名}/export
Content-Type: application/json
x-api-key: <RESUME_UPLOAD_API_KEY>

{ "form": "table" | "cards" }
```

示例：把"黄维"相关简历以多维表格交付给他：

```
curl -X POST "http://127.0.0.1:8788/api/public/person/%E9%BB%84%E7%BB%B4/export" \
  -H "Content-Type: application/json" \
  -H "x-api-key: <RESUME_UPLOAD_API_KEY>" \
  -d '{"form":"table"}'
```

- `form=table` 返回 `table_url`（飞书多维表格链接）。
- `form=cards` 返回 `delivered`（成功发送卡片数）与 `failed`（失败简历 id）。
- 单次卡片最多 50 张；表格最多 200 行（一表一页）。

**失败处理**：
- `400 {"detail":"未找到 X 的飞书绑定"}`：目标人还没同步飞书 open_id，先调 `POST /api/settings/interviewers/batch-sync-from-feishu` 同步后再试。
- `400 {"detail":"存在多个同名面试官绑定"}`：面试官管理里有重复映射，清理后重试。

### 3.3 决策页（入库 / 不入库）

表格每行"操作"列和卡片按钮最终都落到同一个动作：

- 表格操作链接 → `GET /api/public/resume/{id}/decision?t={token}` 打开一个 HTML 决策页（两个按钮），或
- 卡片按钮 → 飞书卡片回调（服务端处理），点击立即生效。

**注意**：决策页的链接带 HMAC 签名 token，7 天内有效，仅对单个简历生效，不要复制给他人。

## 4. 条件批量入库 / 淘汰

当用户说"批量入库……的简历""批量淘汰……的简历"时，用下面的接口按条件在服务端过滤并**直接变更简历状态**（入库=approve→`approved`，淘汰=reject→`rejected`）。

```
POST /api/public/resumes/action
Content-Type: application/json
x-api-key: <RESUME_UPLOAD_API_KEY>          # 或 Authorization: Bearer <jwt>

{ "action": "approve" | "reject", "conditions": { ... }, "limit": 200 }
```

### 支持的过滤条件（`conditions` 可组合）

| 条件 | 含义 |
| --- | --- |
| `related_person` | 相关人（负责人/面试官），内部解析为该人的全部相关岗位/映射/面试记录 |
| `position_id` | 岗位 id |
| `status` | 简历状态（如 `pending_screening`、`pending_interview`） |
| `screening_result` | AI 初筛结果（`通过` / `不通过` / `待定`） |
| `education_min` / `education_max` | 学历最低/最高等级（低于/高于则不匹配） |
| `education` | 学历精确等级 |
| `age_min` / `age_max` | 年龄下限/上限 |

学历等级顺序：`小学 < 初中 < 高中 < 中专 < 大专 < 本科 < 硕士 < 博士`。

### 场景示例

- **批量入库：本科及以上 + AI 初筛通过**
  ```
  {"action":"approve","conditions":{"screening_result":"通过","education_min":"本科"}}
  ```
- **批量淘汰：大专学历 + 年龄 ≤ 30**
  ```
  {"action":"reject","conditions":{"education":"大专","age_max":30}}
  ```
- **黄维相关简历全部入库**
  ```
  {"action":"approve","conditions":{"related_person":"黄维"}}
  ```
- **AI 初筛通过的简历全部入库**
  ```
  {"action":"approve","conditions":{"screening_result":"通过"}}
  ```

### 响应

```json
{ "ok": true, "action": "approve", "matched": 3, "affected": 3, "skipped": 0, "failed": 0, "resume_ids": ["res-1","res-2","res-3"] }
```

- `matched`：符合条件份数；`affected`：实际变更份数；`skipped`：已处理过/找不到的份数；`failed`：失败份数；`resume_ids`：本次处理的简历 id 列表。
- `matched: 0`（`detail:"没有符合条件的结果"`）表示没有简历符合条件，不会做任何变更。
- `limit` 默认 200，最大 500；命中数超过上限时响应带 `detail` 提示，仅处理前 `limit` 份。

### ⚠️ 重要提醒

- 该接口**没有 dry-run**：只要 `matched > 0` 就会立即批量变更简历状态。调用前先想清楚条件，或用公开列表接口（第 2、3 节）先确认候选人符合预期再执行。
- 学历/年龄只在服务端匹配，不会返回或暴露给调用方。
- 未带有效 key/JWT 返回 `401 {"detail":"Missing API key or token"}`。

## 5. 看"我需要面试/筛选的有哪几个"

用公开列表接口按 `status` 筛选即可（第 2、3 节），常见状态：

- **待筛选**：`status=pending_screening`
- **待面试**：`status=pending_interview`

示例：看黄维相关简历中需要面试的：
```
curl "http://127.0.0.1:8788/api/public/person/%E9%BB%84%E7%BB%B4/resumes?status=pending_interview"
```

## 使用建议

- 想快速了解"岗位招到哪一步了"→ 调进度接口，看 `progress` 的漏斗数字和 `resume_status_breakdown`。
- 想看"这个岗位有哪些候选人、各自什么状态"→ 调简历列表接口；简历多时分页查看，或按 `status` 筛选。
- 想"批量入库/淘汰符合条件的简历"→ 用第 4 节的 action 接口；该接口会真实改状态，先确认条件再执行。
- 想"我需要面试/筛选的有哪几个"→ 用第 5 节按 `status`（`pending_interview` / `pending_screening`）筛选。
- 汇报时建议先给岗位基本信息 + 漏斗汇总，再按需展开候选人明细。
