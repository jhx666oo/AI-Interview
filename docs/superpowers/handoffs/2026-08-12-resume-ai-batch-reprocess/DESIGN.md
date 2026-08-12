# 简历 AI 批量重评与进度追踪设计摘要

## 目标

把简历管理页的 AI 重评能力拆成两个入口：

\`\`\`text
AI 工具 ▾
├─ 全部重评
├─ 重评未评估/失败简历
└─ 清除已淘汰
\`\`\`

两个入口都处理当前登录用户可见范围内的简历，不受当前页、分页和勾选影响。勾选仍只服务于批量入库、淘汰和删除。

## 核心方案

复用现有 \`resume_processing_jobs\` 和 Cloudflare Queue，扩展现有 \`resume_reprocess_batches\`，新增 \`resume_reprocess_batch_items\`。批次明细逐份记录 \`pending\`、\`queued\`、\`running\`、\`completed\`、\`failed\`、\`skipped\`，队列消费者在领取、更新步骤、完成和最终失败时回写明细。进度由 D1 聚合，页面刷新后通过活动批次接口恢复。

## 范围和判定

- \`all\`：当前用户可见的全部简历。
- \`incomplete_or_failed\`：没有有效 AI 评估、\`parse_status\` 为 \`pending_screening\`/\`needs_manual\`、最近任务失败，或处于明确失败状态的简历。
- 已有 \`queued\`/\`running\` 单份任务的简历不重复清空、不重复入队，批次明细标记 \`skipped\`。
- 最近任务完成且存在有效评估结果的简历不进入“未评估/失败”批次。

## 数据和接口

批次表增加：

\`\`\`text
scope: all | incomplete_or_failed
total_count: integer
\`\`\`

新增批次明细表至少包含：

\`\`\`text
id, batch_id, resume_id, job_id, status, step, candidate_name,
skip_reason, error_code, error_message, created_at, updated_at, completed_at
\`\`\`

保留并扩展：

\`\`\`http
POST /api/resumes/batch-reprocess
\`\`\`

新 UI 请求：

\`\`\`json
{ "scope": "all" }
\`\`\`

或：

\`\`\`json
{ "scope": "incomplete_or_failed" }
\`\`\`

新增：

\`\`\`http
GET /api/resumes/reprocess-batches/active
GET /api/resumes/reprocess-batches/:batchId
\`\`\`

批次状态至少返回：

\`\`\`text
batch_id, scope, status, total, completed, processing, queued,
pending, failed, skipped, percent, current, failed_items,
created_at, updated_at, completed_at
\`\`\`

简历列表增加：

\`\`\`text
evaluation_job_status
evaluation_job_step
evaluation_job_error
evaluation_batch_id
\`\`\`

普通列表和 \`RESUME_SQL_LIST=true\` 的优化列表必须保持一致。

## 页面交互

点击“全部重评”或“重评未评估/失败简历”后，顶部显示进度卡片：

\`\`\`text
全部重评
已完成 42 / 120
排队中 68 · 评估中 5 · 失败 4 · 跳过 1
当前：张三 · AI 评分中
\`\`\`

每 4 秒轮询批次状态，刷新页面或重新进入时调用活动批次接口恢复。完成或失败后停止轮询，但保留摘要。失败明细可用 Modal 查看；本次不增加单独失败重试按钮。

## 旧分数保护

重新评估任务成功创建后，只清除 AI 结果字段：

\`\`\`text
ai_review, ai_evaluation, match_score, screening_result,
hard_requirement_result, capability_scores, three_layer_match
\`\`\`

不清除人工复核、候选人业务状态、面试记录、原始文本和 OCR 数据。

当任务为 \`queued\`、\`running\` 或 \`failed\` 时，前端隐藏旧分数、维度、门槛标签和初筛结论，显示“排队中”“AI 评分中”或“评估失败”。只有完成且有有效评估结果时才显示评分。

## 测试和边界

必须覆盖权限范围、两个 scope、空批次、活动任务跳过、批次聚合、任务状态同步、失败原因、跨用户读取保护、列表字段、刷新恢复和旧分数隐藏。

不做 SSE/WebSocket、单独失败重试按钮、重新评估选中简历菜单、普通上传流程改造、生产 D1/secrets 修改和生产部署。

完整版本见：

\`docs/superpowers/specs/2026-08-12-resume-ai-batch-reprocess-progress-design.md\`
