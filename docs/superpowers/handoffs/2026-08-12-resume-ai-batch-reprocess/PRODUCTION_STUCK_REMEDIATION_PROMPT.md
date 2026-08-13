# 可直接交给其他 Agent 的修复提示词

请在项目目录 `/Users/jhx/Desktop/天鹅到家/dvS2cn/ai-interview` 修复“简历 AI 批量重评一直停留处理中、页面持续刷新、没有评估出结果”的问题。

开始前必须阅读：

1. `docs/superpowers/plans/2026-08-12-resume-reprocess-stuck-remediation.md`
2. `docs/superpowers/handoffs/2026-08-12-resume-ai-batch-reprocess/DESIGN.md`
3. `docs/superpowers/handoffs/2026-08-12-resume-ai-batch-reprocess/IMPLEMENTATION_PLAN.md`

## 已确认的生产事实

生产批次 `6ba5dc24-38c4-417c-8d9f-77a088db3b68` 当前状态是：

```text
batch.status = running
total = 3
completed = 0
queued = 1
skipped = 2
failed = 0
```

其中候选人“方智辉”的实际 job 是：

```text
job.status = failed
job.step = extracting_text
error = file page count exceeds API limit (20 pages), please input page_range to specify the page range
resume.parse_status = failed
resume.parse_error = 同一错误
batch_item.status = queued
```

根因有两个：

1. MinerU 拒绝了超过 20 页的 PDF，任务在 OCR/文本提取阶段失败，尚未进入 AI 评分。
2. `enqueueResumeReprocessBatchPage` 在发送 Queue 后无条件把 batch item 写回 `queued`，可能覆盖 consumer 已写入的 `failed`。因此 D1 中 job 已 failed，但 item 仍 queued；批次聚合只看 item，所以前端永远轮询。

截图中的 `Immersive Translate ERROR: dynamic-i18n version mismatch` 是浏览器翻译扩展错误，不是本项目故障。

## 必须完成

1. 修复 Queue 发送和 consumer 回写之间的竞态，禁止 queued/running 覆盖 completed/failed/skipped。
2. 增加批次终态对账：查询批次进度前，发现 job 已 completed/failed 但 item 仍 active 时自动同步 item，再聚合批次状态。不能要求用户手动改生产 D1。
3. MinerU 页数限制必须变成明确的不可重试失败，错误码建议为 `OCR_PAGE_LIMIT_EXCEEDED`，前端显示“PDF 超过 MinerU 20 页限制”，不能无限重试。
4. 如果实现完整能力增强，按 MinerU 当前 API 的真实 `page_range` 规范分段处理 PDF；不要未经确认只取前 20 页导致简历内容丢失。
5. `queued`、`running`、`failed` 时隐藏旧 AI 分数、维度、门槛标签和初筛结论；成功且有有效评估时才显示分数。
6. 批次全部 item 到终态后停止轮询。批次可以显示“已完成”，同时单独显示失败数量和失败原因。
7. 保持当前用户权限范围、两个 scope、活动批次恢复、普通单份评估和历史 API 兼容。

## 修改范围建议

优先检查并修改：

- `worker/src/resume-processing/reprocess.ts`
- `worker/src/resume-processing/batch-repository.ts`
- `worker/src/resume-consumer.ts`
- `worker/src/resume-processing/ocr.ts`
- `frontend/src/utils/resumeReprocess.ts`
- `frontend/src/components/ResumeReprocessProgress.tsx`
- `frontend/src/pages/Resumes/List.tsx`
- 对应 `worker/tests/*reprocess*`、`worker/tests/resume-consumer.test.ts`、`worker/tests/resume-ocr.test.ts` 和前端测试

## 必须测试的场景

- Queue consumer 在 `queue.send()` 返回前失败，最终 item 仍为 failed。
- consumer 完成后任何旧 queued 写入都不能覆盖 completed。
- 重复执行完成/失败回调是幂等的。
- 生产现状 `job failed + item queued` 查询后会自动收敛为 failed，批次变为终态，percent 为 100。
- MinerU 页数限制、普通 OCR 失败、网络暂时失败分别走正确的失败/重试路径。
- 旧 AI 评估存在时，queued/running/failed 卡片仍不显示旧分数。
- 无 batch item 的普通单份任务不受影响。

## 验证命令

```bash
cd frontend
npm test -- --reporter=dot
npx tsc -b
npm run build

cd ../worker
npm test -- --run
npx tsc --noEmit

cd ..
git diff --check
git status --short
git diff --stat
```

## 严格限制

- 不修改根目录未跟踪的 `package-lock.json`。
- 不手动修改生产 D1 或 secrets。
- 不提交 commit、不 push GitHub、不创建 PR、不部署生产。
- 不执行破坏性 git 命令。
- 完成后只报告代码改动和本地验证结果，并明确说明没有提交、推送或部署。
