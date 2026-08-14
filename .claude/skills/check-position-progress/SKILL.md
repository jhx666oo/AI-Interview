---
name: check-position-progress
description: 查看某个招聘岗位的进度（简历数、AI 初筛、各轮面试、offer、入职）以及该岗位的简历列表（全部或分页）；也可以按人（负责人/面试官）查看其相关简历，并以飞书多维表格或卡片的形式交付给他（支持入库/不入库操作）。当用户想了解"某个岗位招到哪一步了""这个岗位有多少简历""看看某岗位候选人的进展""拿取某人的相关简历并交付"时使用。
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

## 使用建议

- 想快速了解"岗位招到哪一步了"→ 调进度接口，看 `progress` 的漏斗数字和 `resume_status_breakdown`。
- 想看"这个岗位有哪些候选人、各自什么状态"→ 调简历列表接口；简历多时分页查看，或按 `status` 筛选。
- 汇报时建议先给岗位基本信息 + 漏斗汇总，再按需展开候选人明细。
