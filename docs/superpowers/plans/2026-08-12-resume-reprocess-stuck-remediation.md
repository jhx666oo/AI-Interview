# 简历 AI 重评卡死问题修复方案

> **For agentic workers:** Use test-driven-development and verification-before-completion. This document authorizes local implementation and verification only. Do not create branches, commits, pushes, PRs, production deployments, production D1 writes, or secret changes without separate user authorization.

**Goal:** 修复批量重评在单份任务失败后批次仍永久显示“处理中”的问题，并让 PDF 超过 MinerU 页数限制时以明确失败结束；同时确保排队、评估中和失败简历不继续展示旧 AI 结果。

**Architecture:** 继续复用 `resume_processing_jobs`、`resume_reprocess_batches`、`resume_reprocess_batch_items` 和 Cloudflare Queue。以 job 状态为执行真相源，以 batch item 状态为进度投影；所有状态同步必须具备幂等性和终态保护，并增加终态对账，修复已经存在的 `job failed、item queued` 历史数据。

**Tech Stack:** Cloudflare Workers、Hono、D1、Cloudflare Queue、MinerU Agent API、React、TypeScript、Ant Design、Vitest。

## 已确认的生产故障链

### 1. 实际评估失败原因

生产批次：`6ba5dc24-38c4-417c-8d9f-77a088db3b68`

候选人：`方智辉`

生产 D1 当前记录：

```text
resume.parse_status = failed
resume.parse_error  = file page count exceeds API limit (20 pages), please input page_range to specify the page range
job.status          = failed
job.step            = extracting_text
item.status         = queued
item.step           = extracting_text
batch.status        = running
```

任务在 OCR/文本提取阶段就失败了，尚未进入字段提取或 AI 评分阶段。MinerU 返回的是输入文件页数限制，不是 DeepSeek、权限、D1 或前端分页错误。

截图底部的 `Immersive Translate ERROR: dynamic-i18n version mismatch` 来自浏览器翻译扩展的 `content_main.js`，与本项目评估失败无关，不要围绕这个错误修改业务代码。

### 2. 页面永久刷新的直接原因

生产批次统计为：

```text
total = 3
completed = 0
queued = 1
skipped = 2
failed = 0
batch.status = running
```

但对应 job 已经是 `failed`。`refreshReprocessBatchStatus` 和 `getReprocessBatchView` 只按 `resume_reprocess_batch_items.status` 聚合；由于 item 仍是 `queued`，批次永远达不到终态，前端按照现有逻辑持续每 4 秒轮询并刷新列表。

### 3. 代码级竞态

当前调用顺序存在覆盖窗口：

1. `enqueueResumeReprocessBatchPage` 创建/重置 job。
2. `enqueueResumeReprocess` 在发送 Queue 前调用 `attachReprocessBatchItemToJob`，将 item 写成 `queued`。
3. Queue consumer 可能立即领取并处理任务。
4. consumer 失败后，`onFail` 调用 `syncReprocessBatchItemByJob`，理论上将 item 写成 `failed`。
5. `enqueueResumeReprocessBatchPage` 从 `queue.send()` 返回后，又无条件执行：

```sql
UPDATE resume_reprocess_batch_items
SET job_id=?, status='queued', updated_at=?
WHERE batch_id=? AND resume_id=?
```

这条旧的 queued 写入可能覆盖 consumer 刚写入的 `failed`。生产时间戳吻合这个顺序：item 更新时间 `05:32:16.220Z`，job 失败更新时间 `05:32:19.283Z`，但 item 没有随后更新为 failed。

## 修复目标与验收标准

- job 为 `completed` 时，关联 item 最终只能是 `completed`。
- job 为 `failed` 时，关联 item 最终只能是 `failed`，并携带 `PROCESSING_FAILED` 和原始错误信息。
- 后续的 `queued`/`running` 回写不能覆盖 `completed`、`failed`、`skipped`。
- 已存在的 `job=failed、item=queued/running` 数据，在查询批次状态时能够自动对账并收敛，不需要手动修改生产 D1。
- 批次所有 item 到达终态后停止显示“处理中”；建议批次整体状态为 `completed`，同时显示 `failed > 0`，因为“批次已处理完但有失败项”比“批次仍运行”更准确。
- MinerU 页数限制错误不得无限重试；必须显示具体原因，并允许用户通过“重评未评估/失败简历”再次尝试。
- queued/running/failed 的简历卡片隐藏旧的分数、维度、门槛标签和初筛结论；completed 且有有效评估结果时才显示新结果。
- 两个重评入口继续只处理当前登录用户可见范围；不得重新引入选中简历依赖。

## 实施任务

### Task 1：修复批次明细状态竞态

**修改文件：**

- `worker/src/resume-processing/reprocess.ts`
- `worker/src/resume-processing/batch-repository.ts`
- `worker/src/resume-consumer.ts`
- `worker/tests/resume-processing-reprocess.test.ts`
- `worker/tests/resume-reprocess-batch.test.ts`
- `worker/tests/resume-consumer.test.ts`

**实现要求：**

1. 删除或改造 `enqueueResumeReprocessBatchPage` 中 queue 发送后的无条件 `status='queued'` 更新。
2. `attachReprocessBatchItemToJob` 必须读取 job 当前状态并映射：`queued -> queued`、`running -> running`、`completed -> completed`、`failed -> failed`；同步 `step`、错误字段，completed 时写 `completed_at`。
3. Queue 发送后重新读取 job 状态，再调用统一同步函数；不能使用 queue 发送前缓存的旧时间戳覆盖更新。
4. `syncReprocessBatchItemByJob` 的 SQL 必须有终态保护：活动更新只允许作用于 `pending/queued/running`；终态更新不能覆盖 `completed/failed/skipped`。
5. consumer 在 `claimJob` 成功后显式同步 `running`；现有 D1/R2 的 `setJobStep`、完成、最终失败回调继续同步 batch item。
6. 同步失败只记录日志，不重新执行 AI，也不因为投影失败导致业务 job 重跑。

**必须新增的测试：**

- 模拟 Queue consumer 在 `queue.send()` 返回前将 job 置为 failed，断言最终 item 仍为 failed。
- 模拟 consumer 完成后批次入队逻辑再次尝试写 queued，断言 completed 不被覆盖。
- 重复执行 failed/completed 回调，断言结果幂等。
- 没有 batch item 的普通单份任务，行为保持不变。

### Task 2：增加历史终态对账，修复本次已经卡住的批次

**修改文件：**

- `worker/src/resume-processing/batch-repository.ts`
- `worker/src/index.ts`
- `worker/tests/resume-reprocess-batch.test.ts`

新增内部函数，例如：

```ts
reconcileReprocessBatchItems(db, batchId): Promise<void>
```

**对账规则：**

1. 查询该批次所有 `job_id` 不为空且 item 仍为 `pending`、`queued` 或 `running` 的明细。
2. 批量查询关联 job，不能每个 item 单独请求一次 D1。
3. job 已 `completed` 的 item 改为 `completed`。
4. job 已 `failed` 的 item 改为 `failed`，复制错误码和错误信息。
5. job 仍 queued/running 的 item 只同步对应活动状态和 step。
6. 对账后调用 `refreshReprocessBatchStatus`。
7. 在 `getReprocessBatchView` 聚合前执行一次对账，确保已有生产批次下一次轮询即可自愈；`getActiveReprocessBatchView` 通过同一查询链路获得修复后的结果。

**本次生产数据的逻辑验收结果应为：**

```text
completed = 0
queued = 0
processing = 0
failed = 1
skipped = 2
percent = 100
status = completed
```

这里 `completed` 是批次处理完成状态，不代表失败项成功；失败数量必须单独展示。

### Task 3：处理 MinerU 超过 20 页的错误

**修改文件：**

- `worker/src/resume-consumer.ts`
- `worker/src/resume-processing/ocr.ts`（如需要扩展错误类型）
- `worker/tests/resume-ocr.test.ts`
- `worker/tests/resume-consumer.test.ts`

#### 3A. 必须完成的安全修复

识别 MinerU 的页数限制错误，包括错误码 `-30003`（如果当前 API 响应仍使用该错误码）和错误文本 `file page count exceeds API limit`。将它归类为不可通过 Queue 重试解决的输入错误：

```text
OCR_PAGE_LIMIT_EXCEEDED
PDF 超过 MinerU 20 页限制，请拆分 PDF、提供文本版简历，或配置页码范围后重新评估
```

最终写入：

- `resume_processing_jobs.status='failed'`
- `resume_processing_jobs.error_code='OCR_PAGE_LIMIT_EXCEEDED'`
- `resume_processing_jobs.error_message` 保留用户可理解的中文说明和原始错误摘要
- `resumes.parse_status='failed'`
- batch item `status='failed'`

不能把明确的输入限制错误包装成无限 retryable error。

#### 3B. 推荐的能力增强

如果业务要求支持这类简历，先核对当前 MinerU Agent API 对 `page_range` 的精确格式，再实现以下方案之一：按每段不超过 20 页调用 MinerU 并按页序拼接 markdown，或使用 provider 支持的 `page_range` 分段请求。

不要默认只取前 20 页，因为可能丢失后续工作经历；除非产品明确接受“只评估前 20 页”。如果 Worker 没有可靠 PDF 页数解析能力，应先做可验证的页数/分段实现，再接入 OCR。

测试必须区分页数限制响应、普通 OCR 失败和可重试网络失败。

### Task 4：修复前端评估状态和进度展示

**修改文件：**

- `frontend/src/utils/resumeReprocess.ts`
- `frontend/src/components/ResumeReprocessProgress.tsx`
- `frontend/src/pages/Resumes/List.tsx`
- 对应 frontend 测试文件

**状态优先级：**

```text
evaluation_job_status = queued/running -> 排队中/评估中，隐藏旧评分
evaluation_job_status = failed        -> 评估失败，隐藏旧评分并显示错误
evaluation_job_status = completed     -> 仅当 ai_evaluation 有效时显示评分
无任务状态且有有效结果                -> 兼容显示历史评分
无有效结果                             -> 暂无 AI 评估
```

**进度卡片：**

- 显示批次名称、百分比、`已完成 x / total`、排队中、评估中、失败、跳过。
- 失败数量可展开查看候选人、错误码和错误信息。
- `跳过`显示原因摘要，例如“已有任务处理中”，避免用户以为系统漏评。
- 只有 batch status 为 `queued/running` 才轮询；`completed` 后保留最终摘要并停止轮询。
- 轮询函数接收固定 `batchId`，不要依赖闭包中的旧 `reprocessBatch` 对象；每次请求继续使用版本号保护，避免旧列表响应覆盖新状态。
- 对账后返回 `failed=1、skipped=2、percent=100、status=completed` 时，页面必须停止刷新。

不要把浏览器翻译扩展的 console 报错当作业务错误处理。

### Task 5：补充完整回归测试

**Worker：**

```bash
cd worker
npm test -- --run tests/resume-processing-reprocess.test.ts tests/resume-reprocess-batch.test.ts tests/resume-consumer.test.ts tests/resume-ocr.test.ts
npx tsc --noEmit
```

至少验证竞态覆盖、终态不可回退、历史对账、页数限制错误、重试错误、批次聚合、权限隔离、普通单份任务兼容。

**Frontend：**

```bash
cd frontend
npm test -- --reporter=dot
npx tsc -b
npm run build
```

至少验证 queued/running/failed 隐藏旧分数、进度百分比、失败明细、终态停止轮询、刷新恢复、AI 工具菜单 scope 不依赖勾选。

**最终静态检查：**

```bash
git diff --check
git status --short
git diff --stat
```

根目录未跟踪的 `package-lock.json` 必须保持未跟踪，不得加入修改范围。

## 不在本次 Agent 授权范围内

- 不手动修改生产 D1，不直接把当前批次改成 completed/failed。
- 不推送 GitHub，不提交 commit，不创建 PR。
- 不部署 Cloudflare Pages、Resume Consumer Worker 或生产 D1 migration。
- 不修改 secrets。
- 不重写整个 OCR、队列或简历权限架构。
- 不新增 SSE/WebSocket。

## 完成后的报告格式

Agent 必须报告：

1. 竞态修复涉及的文件和状态转换。
2. 历史对账如何让 `job failed/item queued` 自愈。
3. MinerU 超 20 页的处理方式，以及是否支持完整 PDF 分段评估。
4. 失败时旧评分是否隐藏。
5. 真实测试、类型检查和构建输出。
6. 明确说明没有提交、推送或部署生产。
