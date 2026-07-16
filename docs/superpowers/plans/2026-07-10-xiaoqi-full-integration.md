# 小七全功能 Worker 集成计划

> **For agentic workers:** 使用 subagent-driven-development 逐步实现。

**Goal:** 将小七系统的飞书卡片审核、群推、调度全部移植到 Cloudflare Worker 中

**Architecture:** Worker 作为后端，使用 Feishu Open API（HTTP REST）实现卡片发送、卡片回调 webhook、群消息推送；使用 wrangler cron 实现定时日报/提醒；使用 D1 存储 pending 卡片状态和群映射信息

**Tech Stack:** Cloudflare Workers + D1 + Hono + Feishu Open API

---

### Task 1: Feishu 卡片发送核心函数

**Files:**
- Modify: `worker/src/index.ts`（在 Feishu Sync 辅助函数区域之后添加）

**What:** 添加 `sendScreeningCard()` 函数 — 发送交互式审核卡片给 Feishu 用户

- 接收参数: candidate_name, position, match_score, risk_points, evaluation, record_id, file_path
- 构建 Feishu interactive card JSON（含 header + body + ✅/❌ 按钮）
- 调用 Feishu API: `POST https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id`
- 返回 message_id

**按钮 value 结构:**
```json
{
  "action": "store" | "discard",
  "name": "候选人姓名",
  "record_id": "screening_record_uuid",
  "record_key": "same_as_record_id"
}
```

---

### Task 2: Feishu Drive 上传 + Bitable 写入函数

**Files:**
- Modify: `worker/src/index.ts`

**What:**
1. `uploadToFeishuDrive(token, fileName, fileBuffer)` — 上传文件到飞书云盘
   - `POST https://open.feishu.cn/open-apis/drive/v1/files/upload_all`
   - multipart/form-data: file_name, parent_type=bitable_file, parent_node=BASE_TOKEN, file
   - 返回 file_token

2. `createFeishuBitableRecord(token, tableId, fields)` — 在飞书多维表格创建记录
   - `POST https://open.feishu.cn/open-apis/bitable/v1/apps/{token}/tables/{tableId}/records`
   - 字段: 姓名, 年龄, 性别, 学历, 面试岗位, 招聘岗位, 城市, 简历附件(file_token), AI简历评估

3. `updateFeishuCard(token, messageId, cardContent)` — 更新已发送的卡片
   - `PATCH https://open.feishu.cn/open-apis/im/v1/messages/{messageId}`
   - 更新卡片 header + elements

---

### Task 3: 卡片回调 Webhook 端点

**Files:**
- Modify: `worker/src/index.ts`

**What:** 添加 `POST /api/feishu/card-action` — 飞书卡片按钮回调

Feishu 发送的数据格式:
```json
{
  "open_message_id": "om_xxx",
  "action": {
    "value": { "action": "store", "name": "张三", "record_id": "xxx" }
  }
}
```

处理流程:
1. 解析 action（store/discard）和 record_id
2. 从 D1 读取 screening record
3. 立即标记 record.status = 'processing'（防止重复点击）
4. 立即返回 toast，异步执行后续
5. 如果 store:
   - 从 D1 读取 resume raw_text（或从 file_path 获取文件）
   - 如果有文件 → 上传到 Feishu Drive → 获取 file_token
   - 创建 Feishu Bitable 记录（人才库表 tblWkwsoTIPhzusI）
   - 更新 card 为绿色（已入库）
   - 更新 D1 record: status='approved', ai_result='shortlisted'
   - 推送到招聘群（调用 Task 5）
6. 如果 discard:
   - 更新 card 为红色（已淘汰）
   - 更新 D1 record: status='rejected'

返回格式（飞书要求3秒内返回）:
```json
{
  "code": 0,
  "msg": "success",
  "data": {
    "toast": { "type": "success", "content": "处理中..." }
  }
}
```

---

### Task 4: 卡片发送与 AI 分析集成

**Files:**
- Modify: `worker/src/index.ts`（AI analyze endpoint）

**What:** 在 AI 分析成功后，自动发送飞书审核卡片

- 在 `POST /api/resume-screening/:id/ai-analyze` 中的成功路径末尾
- 调用 `sendScreeningCard()` 发送卡片给审核人
- 将返回的 message_id 存入 D1 record 的 `feishu_card_msg_id` 字段
- 需要新增 D1 字段: `feishu_card_msg_id TEXT`

**字段迁移:**
```sql
ALTER TABLE resume_screening_queue ADD COLUMN feishu_card_msg_id TEXT;
```

卡片内容包含:
- 候选人姓名、年龄、性别、学历
- AI 分析结果（初筛结果、匹配分数、优势、风险、能力评分、面试问题）
- ✅ 入库 / ❌ 淘汰 按钮

---

### Task 5: 机器人事件 Webhook 端点（群推 + 群内评价）

**Files:**
- Modify: `worker/src/index.ts`

**What:** 添加 `POST /api/feishu/event-callback` — 飞书事件回调

处理以下事件:
1. **URL 验证挑战**: `POST` with `{ "challenge": "xxx" }` → 返回 `{ "challenge": "xxx" }`
2. **`im.message.receive_v1`**: 群消息/ @机器人消息
   - 解析消息内容
   - 如果是面试评价（如"评价张三人选，沟通能力4分"）→ 写入 `department_reviews` 表
   - 如果是 bot 菜单命令 → 执行对应操作
3. **`im.menu.action`**（可选）: 机器人菜单点击事件

---

### Task 6: 群推送 + 定时任务

**Files:**
- Modify: `worker/src/index.ts`

**What:**

1. `pushCandidateToGroup(candidateInfo)` — 推送候选人到招聘群
   - 发送交互式卡片到指定 chat_id
   - 卡片包含: 候选人姓名、岗位、AI评估摘要、简历链接（FileToken）
   
2. `sendDailyReport(env)` — 生成并发送日报
   - 查询当日面试/入库/淘汰统计数据
   - 生成日报文本
   - 发送到指定群/人

3. Cron 配置 (`wrangler.toml`):
```toml
[triggers]
crons = ["0 2 * * *", "0 6 * * *"]
```
- 每天 10:00（UTC+8=02:00 UTC）发送日报
- 每天 10:00 和 15:00 UTC+8 发送提醒

---

### Task 7: 数据库迁移 + 前端按钮

**Files:**
- Create: `scripts/migration_card_workflow.sql`
- Modify: `worker/src/index.ts`

**What:** 
1. 为 `resume_screening_queue` 表添加飞书卡片相关字段:
   - `feishu_card_msg_id TEXT` — 存储卡片消息ID，用于回调更新
   - `feishu_processed_at TEXT` — 飞书处理时间戳

2. 在前端简历筛选页面添加「配置飞书回调」提示

---

### Task 8: 部署文档 + 配置说明

**Files:**
- Modify: `worker/wrangler.toml`
- Create: `DEPLOY_FEISHU.md`

**What:**
1. 添加 cron 配置到 wrangler.toml
2. 写部署文档说明:
   - 如何在飞书开发者后台配置卡片回调 URL
   - 如何配置事件回调 URL
   - 审核人 open_id 配置
   - 招聘群 chat_id 配置

---

## 执行计划

1. Task 1 → 先完成卡片发送函数（可独立测试）
2. Task 2 → Drive 上传 + Bitable 写入（可独立测试）
3. Task 3 → 卡片回调端点（需先有卡片）
4. Task 4 → 集成到 AI 分析流程（端到端测试）
5. Task 5 → 机器人事件 webhook
6. Task 6 → 群推送 + cron
7. Task 7 → 数据库迁移
8. Task 8 → 部署文档 + 配置
