# 简历 AI 批量重评与进度追踪设计

## 1. 背景与目标

简历管理页当前只有一个“批量重新评估”入口：没有选中简历时会提交当前用户可见的全部简历，页面只能看到“已提交任务”，无法知道批次处理到哪里；重新评估开始后，列表仍可能显示旧的 AI 分数，用户无法区分旧结果和本次任务结果。

本次改造目标：

1. 将重新评估入口统一放入“AI 工具”菜单，与批量入库、批量淘汰、批量删除分开。
2. 提供“全部重评”和“重评未评估/失败简历”两个入口。
3. 两个入口都只处理当前登录用户有权限看到的简历；管理员沿用现有逻辑处理全库，非管理员沿用 `getOwnerName` 权限范围。
4. 以 D1 中的批次明细和单份任务状态作为进度真相源，显示真实总数、完成数、排队数、评估中数量、失败数和当前候选人。
5. 批次创建后立即清除待重评简历的旧 AI 结果；评估中或失败时，前端不得显示旧分数。
6. 页面刷新、翻页或重新进入简历管理页后可以恢复活动批次进度。

## 2. 页面交互

### 2.1 菜单结构

`AI 工具` 菜单改为：

```text
AI 工具 ▾
├─ 全部重评
├─ 重评未评估/失败简历
└─ 清除已淘汰
```

当前页面勾选状态不影响两个重评入口。勾选仅继续服务于批量入库、批量淘汰、批量删除等业务操作。后端现有按 `ids` 的能力保留，但本次不在菜单中暴露“重评选中简历”。

### 2.2 确认弹窗

点击“全部重评”时，弹窗明确说明：

- 本次范围是当前登录用户可见的全部简历。
- 本次会清除这些简历当前的 AI 评估结果，并重新提取字段和评分。
- 人工复核状态、面试记录和候选人业务状态不会被修改。

点击“重评未评估/失败简历”时，后端先按权限范围计算实际候选数量。若数量为零，直接提示“当前没有需要重新评估的简历”；有候选项时弹窗或提交结果显示实际纳入数量。

同一用户已有活动批次时，两个重评菜单项禁用，菜单项提示当前批次仍在处理，避免重复创建活动批次。清除已淘汰不受重评批次限制，除非现有业务规则另有要求。

### 2.3 顶部进度面板

批次创建成功后，在简历列表顶部显示可持续存在的进度卡片：

```text
全部重评
██████████░░░░░░ 35%

已完成 42 / 120
排队中 68 · 评估中 5 · 失败 4 · 跳过 1
当前：张三 · AI 评分中
```

字段要求：

- 批次名称：`全部重评` 或 `重评未评估/失败简历`。
- 百分比：按终态明细数除以批次总数计算，四舍五入到整数；终态包括 `completed`、`failed`、`skipped`。
- 统计：总数、已完成、排队中、评估中、失败、跳过。
- 当前任务：显示最近更新时间最新的 `running` 明细的候选人和步骤；没有 running 但有 queued 时显示队列等待；没有活动项时不显示当前任务。
- 完成状态：显示成功、失败、跳过摘要，并允许打开失败明细。

失败明细使用 Modal 展示候选人、简历 ID、错误码和错误信息。本次不新增独立失败重试按钮，用户可再次执行“重评未评估/失败简历”。

## 3. 业务范围和状态规则

### 3.1 批次范围

批次拥有 `scope`：

- `all`：当前用户可见的全部简历。
- `incomplete_or_failed`：当前用户可见且符合未评估或最近评估失败规则的简历。

范围筛选必须在后端完成，不能使用前端当前页数据作为候选集合。

### 3.2 未评估/失败判定

后端统一判定：

- 存在活动单份任务 `queued` 或 `running`：不重复加入本次批次，作为 `skipped`/已在处理中统计。
- 最近一次任务为 `failed`：纳入批次。
- 没有有效 AI 评估结果：纳入批次。
- `parse_status` 为 `pending_screening` 或 `needs_manual`：纳入批次。
- 最近一次任务为 `completed` 且存在有效 AI 评估结果：不纳入批次。

有效 AI 评估结果以可解析的 `ai_evaluation` 对象为主，并要求存在可用于展示的评估内容；不能只因为字符串非空就认定评估有效。

### 3.3 单份任务状态

继续使用 `resume_processing_jobs` 作为单份执行任务真相源：

- `queued`：已创建任务但尚未被消费者领取。
- `running`：消费者已领取，步骤由 `extracting_text`、`extracting_fields`、`screening` 更新。
- `completed`：评估成功。
- `failed`：最终失败，记录错误码和错误信息。
- `cancelled`：保留既有兼容状态。

### 3.4 批次明细状态

新增批次明细表，每份简历在一个批次内有一条明细，状态为：

- `pending`：已纳入批次但尚未创建单份任务。
- `queued`：已关联单份任务且等待执行。
- `running`：单份任务正在执行。
- `completed`：单份任务成功。
- `failed`：单份任务最终失败。
- `skipped`：因已有活动任务、不可见或其他明确原因未由本批次重复执行。

批次总进度按明细聚合，不按“协调器已投递数量”推断完成。

## 4. 数据模型

现有 `resume_reprocess_batches` 保留，并增加批次语义字段：

- `scope TEXT NOT NULL`：`all` 或 `incomplete_or_failed`。
- `total_count INTEGER NOT NULL DEFAULT 0`：批次明细总数。
- 现有累计字段继续保留用于兼容和审计，但新接口的实时统计以明细聚合为准。

新增 `resume_reprocess_batch_items`：

```sql
CREATE TABLE IF NOT EXISTS resume_reprocess_batch_items (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  resume_id TEXT NOT NULL,
  job_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'queued', 'running', 'completed', 'failed', 'skipped')),
  step TEXT,
  candidate_name TEXT,
  skip_reason TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (batch_id) REFERENCES resume_reprocess_batches(id),
  FOREIGN KEY (resume_id) REFERENCES resumes(id)
);
```

约束和索引：

- `UNIQUE(batch_id, resume_id)`，防止一份简历重复进入同一批次。
- `idx_resume_reprocess_items_batch_status`：按 `batch_id, status` 聚合进度。
- `idx_resume_reprocess_items_resume_updated`：按 `resume_id, updated_at` 查询简历最近批次状态。
- `idx_resume_reprocess_items_job`：按 `job_id` 让队列消费者快速回写明细。

正式 migration 文件使用下一个项目迁移编号，例如 `worker/migrations/0027_resume_reprocess_batch_items.sql`；实际编号以仓库当前迁移目录为准，不能覆盖已有迁移。

## 5. 后端接口和数据流

### 5.1 创建批次

保留：

```http
POST /api/resumes/batch-reprocess
```

新增明确请求体：

```json
{ "scope": "all" }
```

或：

```json
{ "scope": "incomplete_or_failed" }
```

现有 `{ ids }` 请求兼容保留，但本次前端不调用；如果同时传 `scope` 和 `ids`，后端应拒绝为 400，避免语义不明确。

成功返回 202：

```json
{
  "ok": true,
  "batch_id": "batch-id",
  "scope": "all",
  "total": 120,
  "queued": 116,
  "already_processing": 3,
  "skipped": 1,
  "failed": 0
}
```

创建过程：

1. 解析并校验 `scope`。
2. 用现有 `getOwnerName` 计算当前用户可见范围。
3. 对 `all` 选择可见全部简历；对 `incomplete_or_failed` 使用统一 SQL/查询服务筛选候选。
4. 若同一 owner 存在 `queued`/`running` 批次，返回 409 或等价业务错误，前端保持已有批次。
5. 创建批次和明细；每个候选明细先为 `pending`。
6. 为可执行简历调用现有 `enqueueResumeReprocess`。成功后写入 `job_id` 并置为 `queued`；已有活动任务的明细置为 `skipped` 并记录原因。
7. `enqueueResumeReprocess` 清空待重评简历旧 AI 结果；必须保证只有成功获得本批次新任务后才清空，不能清空其他正在执行任务的数据。
8. 空候选批次直接标记 `completed`，返回 `total: 0`。

“全部”批次仍可由历史协调器按页投递，但每页投递前必须先创建对应明细；协调器不把投递完成当成评估完成。

### 5.2 查询批次状态

新增：

```http
GET /api/resumes/reprocess-batches/:batchId
```

返回：

```json
{
  "batch_id": "batch-id",
  "scope": "all",
  "status": "running",
  "total": 120,
  "completed": 42,
  "processing": 5,
  "queued": 68,
  "failed": 4,
  "skipped": 1,
  "percent": 36,
  "current": {
    "resume_id": "resume-id",
    "candidate_name": "候选人姓名",
    "step": "screening"
  },
  "failed_items": [
    {
      "resume_id": "resume-id",
      "candidate_name": "候选人姓名",
      "error_code": "PROCESSING_FAILED",
      "error_message": "简历文本不可用"
    }
  ],
  "created_at": "2026-08-12T00:00:00.000Z",
  "updated_at": "2026-08-12T00:05:00.000Z",
  "completed_at": null
}
```

权限要求：批次查询必须验证批次 owner，并对批次明细关联的简历执行当前用户权限检查；不能凭 batch ID 读取其他用户的数据。

### 5.3 查询当前用户活动批次

新增：

```http
GET /api/resumes/reprocess-batches/active
```

返回当前用户最新活动批次的同样状态结构；没有活动批次返回 `null` 或 `{ "batch": null }`，由前后端选定一种并在测试中固定。

页面首次进入时调用，用于刷新、返回页面和浏览器重新打开后的进度恢复。

### 5.4 队列状态回写

队列消费者在现有单份任务生命周期中同步批次明细：

- `claimJob` 成功后：关联明细 `queued → running`。
- `setJobStep` 时：更新明细 `step` 和 `updated_at`。
- `complete` 时：明细 `running → completed`，写入 `completed_at`。
- 最终 `fail` 时：明细 `running → failed`，同步 `error_code`、`error_message`，并继续写入简历 `parse_status='failed'`。
- 同一个 `job_id` 如果没有批次明细，不能影响普通单份评估流程。
- 明细状态回写必须幂等，重复消费或重复完成不能把终态改回活动态。

批次状态由聚合结果维护：全部明细为终态时批次 `completed`；协调器自身出现不可恢复错误时批次 `failed` 并记录批次级错误。

## 6. 简历列表状态契约

`GET /api/resumes` 在保留原字段的基础上增加评估任务展示字段，建议由后端统一合并：

- `evaluation_job_status`：`queued`、`running`、`completed`、`failed` 或 `null`。
- `evaluation_job_step`：当前步骤或 `null`。
- `evaluation_job_error`：失败原因或 `null`。
- `evaluation_batch_id`：最近活动批次 ID 或 `null`。

如果存在多个历史任务，只取该简历最近一条任务；活动任务优先于历史终态任务。

前端渲染优先级：

1. `evaluation_job_status` 为 `queued`/`running`：显示“评估中”和步骤，隐藏 AI 分数、维度和初筛结论。
2. `evaluation_job_status` 为 `failed`：显示“评估失败”和错误摘要，隐藏旧 AI 分数。
3. 状态为 `completed` 且评估内容有效：显示最新评估结果。
4. 无有效结果：显示“暂无 AI 评估”。

不能仅根据旧 `ai_evaluation` 非空渲染分数，也不能让前端只依赖 `parse_status` 猜测批次进度。

## 7. 前端实现边界

主要修改 `frontend/src/pages/Resumes/List.tsx`：

- 将现有 AI 工具菜单中的单一 `reparse` 项拆为“全部重评”和“重评未评估/失败简历”。
- 删除其对 `selectedRowKeys` 的重评语义依赖。
- 增加批次状态、轮询和页面恢复状态。
- 在列表顶部渲染进度面板。
- 卡片显示任务状态时屏蔽旧评估渲染。
- 继续保留现有列表刷新、分页和响应式卡片行为。

建议新增小型纯函数/组件，避免继续扩大页面文件职责：

- `frontend/src/utils/resumeReprocess.ts`：批次响应类型、状态聚合展示辅助函数、步骤中文文案和百分比计算。
- `frontend/src/components/ResumeReprocessProgress.tsx`：顶部进度面板和失败明细 Modal；如果项目现有组件组织不适合，也可在页面内保持小组件，但必须有独立可测试的渲染边界。

轮询要求：

- 创建或恢复活动批次后每 3～5 秒查询批次状态。
- 批次状态为 `completed`/`failed` 且无活动明细时停止轮询。
- 批次轮询与当前列表刷新分开；列表刷新只用于卡片数据，不再负责计算批次进度。
- 请求版本保护必须沿用现有 `resumeRefreshVersion` 思路，避免旧请求覆盖新数据。
- 每次批次状态刷新后同步刷新当前列表，使卡片状态及时更新。
- 页面卸载时清理定时器。

## 8. 测试设计

### 8.1 Worker 测试

覆盖：

- `scope=all` 只选择当前用户可见简历。
- `scope=incomplete_or_failed` 包含无有效评估、`pending_screening`、`needs_manual` 和最近任务失败的简历。
- 已完成且有有效评估的简历不进入不完整/失败批次。
- queued/running 简历不重复入队，明细正确标记跳过或已在处理中。
- 非法 scope 返回 400。
- 同一 owner 不能创建两个活动批次。
- 空候选批次正确完成。
- 批次明细能与 job ID 关联并防重复。
- `queued → running → completed` 正确回写步骤和时间。
- 任务失败正确回写错误字段，旧结果不重新出现。
- 批次聚合返回总数、终态数、百分比、当前候选人和失败列表。
- 无权限用户不能读取其他用户的批次或明细。
- 普通单份任务没有批次明细时，消费者行为保持不变。

### 8.2 Frontend 测试

覆盖：

- AI 工具菜单显示三个精简入口。
- 两个重评入口不受 `selectedRowKeys` 影响并发送正确 scope。
- 批次进度面板显示百分比和各状态数量。
- running/queued 简历卡片隐藏旧分数和维度。
- failed 简历卡片隐藏旧分数并显示失败信息。
- 页面刷新时从 active 接口恢复批次。
- 批次完成后停止轮询并显示完成摘要。
- 失败明细 Modal 正确展示。
- 空批次显示无可处理提示且不启动无意义轮询。
- 旧列表数据缺少新增字段时页面不崩溃。

验证命令：

```bash
cd frontend
npm test -- --reporter=dot
npx tsc -b

cd ../worker
npm test -- --run
npx tsc --noEmit
```

## 9. 不在本次范围内

- SSE/WebSocket 实时推送。
- 新增独立“失败重试”按钮。
- 修改普通单份评估、简历上传、人工复核、面试记录和业务状态流程。
- 暴露“重新评估选中简历”菜单项。
- 手动修改生产 D1 或 secrets。
- 生产部署和 GitHub 推送；仍遵循项目现有确认流程。

## 10. 验收标准

1. AI 工具菜单显示“全部重评”“重评未评估/失败简历”“清除已淘汰”。
2. 两个重评入口均按当前用户可见范围执行，不受当前分页或勾选影响。
3. 点击重评后旧 AI 分数立即消失，卡片显示评估中或排队中。
4. 顶部进度面板能显示真实百分比、完成、排队、评估中、失败、跳过和当前候选人。
5. 队列处理过程中刷新页面，进度面板和卡片状态可以恢复。
6. 失败任务显示失败原因，且旧分数不会被误显示。
7. 批次完成后显示成功/失败/跳过摘要并停止轮询。
8. 前端和 Worker 测试、类型检查通过。
9. 不修改生产环境，根目录未跟踪的 `package-lock.json` 不加入提交。
