# 统一简历评估流程 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让上传、单份重新评估和批量重新评估统一复用 `resume-processing` 队列，并让结果只包含岗位配置的能力维度。

**Architecture:** 通过共享的重处理状态重置与队列入队函数触发已有消费者；消费者统一加载岗位上下文并在保存前过滤、去重和补齐能力维度。前端删除旧的同步评估入口，只保留单份“重新评估”和批量“批量重新评估”。

**Tech Stack:** Cloudflare Worker/Hono、D1、Cloudflare Queue、TypeScript、Vitest、React/Ant Design。

## Global Constraints

- 重新评估不得修改 HR 复核、入库、淘汰、面试关联等人工状态。
- 岗位能力维度优先读取 `capability_dimensions.dimensions_json`，`positions.capability_dimensions` 仅作兼容兜底。
- 结果只允许保存岗位当前配置的维度；没有配置时保存空维度，不生成通用维度。
- 生产部署前必须获得用户明确上线确认。

---

### Task 1: Add canonical dimension filtering helpers

**Files:**
- Modify: `worker/src/resume-processing/dimension-scores.ts`
- Test: `worker/tests/resume-dimension-scores.test.ts`

**Interfaces:**
- Produces `filterDimensionScoresToConfigured(scores, configuredNames)` and `mergeConfiguredDimensionScores(existing, supplemental, configuredNames)` for the consumer and legacy compatibility paths.

- [ ] **Step 1: Write the failing tests**

Add tests that require extra AI dimensions to be dropped, duplicate names to keep the first evidence, and configured order to be preserved:

```ts
it('filters extra AI dimensions and preserves configured order', () => {
  expect(filterDimensionScoresToConfigured([
    { name: '额外维度', score: 5, reason: '模型自行扩展' },
    { name: '沟通能力', score: 4, reason: '有跨部门经验' },
    { name: '沟通能力', score: 2, reason: '重复结果' },
    { name: '业务理解', score: 3, reason: '有相关项目' },
  ], ['业务理解', '沟通能力'])).toEqual([
    { name: '业务理解', score: 3, reason: '有相关项目' },
    { name: '沟通能力', score: 4, reason: '有跨部门经验' },
  ]);
});

it('supplements only missing configured dimensions', () => {
  expect(mergeConfiguredDimensionScores(
    [{ name: '沟通能力', score: 4, reason: '已有' }],
    [{ name: '业务理解', score: 3, reason: '补充' }, { name: '额外', score: 5, reason: '丢弃' }],
    ['沟通能力', '业务理解'],
  )).toEqual([
    { name: '沟通能力', score: 4, reason: '已有' },
    { name: '业务理解', score: 3, reason: '补充' },
  ]);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run `cd worker && npm test -- --run tests/resume-dimension-scores.test.ts`.

Expected: FAIL because the two new helpers are not exported.

- [ ] **Step 3: Implement the minimal helpers**

Normalize configured names by trimming, build a set, discard unknown names, keep the first occurrence of each configured name, and return results in configured-name order. Implement the merge helper by filtering existing and supplemental results separately, then append supplemental entries whose names are not already present.

- [ ] **Step 4: Run the focused test and verify it passes**

Run `cd worker && npm test -- --run tests/resume-dimension-scores.test.ts`.

Expected: PASS.

- [ ] **Step 5: Commit**

Run `git add worker/src/resume-processing/dimension-scores.ts worker/tests/resume-dimension-scores.test.ts && git commit -m "fix: constrain resume dimensions to configured names"`.

### Task 2: Make the queue consumer use canonical configured dimensions

**Files:**
- Modify: `worker/src/resume-consumer.ts`
- Modify: `worker/src/index.ts`
- Test: `worker/tests/recruiting-operations.test.ts`

**Interfaces:**
- `enrichScreeningEvaluation` returns `dimensions` filtered to `configured_dimensions` and keeps `configured_dimensions` with normalized descriptions and weights.
- Queue scoring loads the independent capability-dimension row first, then falls back to the positions JSON column.

- [ ] **Step 1: Write the failing tests**

Add a test for `enrichScreeningEvaluation` that passes model output containing an unknown dimension and duplicate configured names, then asserts only configured names remain and `weighted_score` uses the configured weights.

- [ ] **Step 2: Run the focused test and verify it fails**

Run `cd worker && npm test -- --run tests/recruiting-operations.test.ts`.

Expected: FAIL because `enrichScreeningEvaluation` currently retains raw model dimensions.

- [ ] **Step 3: Implement the minimal shared filtering**

Use the Task 1 helper inside `enrichScreeningEvaluation`. Keep the model’s first score/reason for a configured name, attach the configured weight, and return dimensions in configured order. Update the consumer’s missing-dimension merge to use the same helper. Change `getPositionRequirements` to query `capability_dimensions` first and fall back to `positions.capability_dimensions`, preserving descriptions and personalized requirements.

- [ ] **Step 4: Run focused tests**

Run `cd worker && npm test -- --run tests/recruiting-operations.test.ts tests/resume-dimension-scores.test.ts`.

Expected: PASS.

- [ ] **Step 5: Commit**

Run `git add worker/src/resume-consumer.ts worker/src/index.ts worker/tests/recruiting-operations.test.ts && git commit -m "fix: use canonical position context for resume scoring"`.

### Task 3: Add one idempotent reprocess enqueue operation

**Files:**
- Create: `worker/src/resume-processing/reprocess.ts`
- Modify: `worker/src/index.ts`
- Test: `worker/tests/resume-processing-reprocess.test.ts`

**Interfaces:**
- `resetResumeForReprocess(db, resumeId)` clears only parsing/evaluation fields and sets `parse_status='queued'`.
- `enqueueResumeReprocess({ db, queue, resumeId, force })` returns `{ jobId, status: 'queued' | 'running' }`, reuses an active job, and sends one queue message.

- [ ] **Step 1: Write failing tests**

Cover three behaviors: an existing completed/failed evaluation is cleared while `status`, `hr_review`, and `stage` are untouched; an active job is reused without inserting a second job; and a missing resume returns a typed not-found error.

- [ ] **Step 2: Run the focused test and verify it fails**

Run `cd worker && npm test -- --run tests/resume-processing-reprocess.test.ts`.

Expected: FAIL because the module and operation do not exist.

- [ ] **Step 3: Implement the minimal operation**

Use the existing `createOrGetActiveJob`. Update only `parsed_data`, `ai_review`, `ai_evaluation`, `match_score`, `screening_result`, `hard_requirement_result`, `parse_status`, and `parse_error`; preserve PDF/text and human workflow columns. For failed jobs, reset the latest failed job to queued; for active jobs, return the active job without duplicating the queue message; for a fresh job, send one message.

- [ ] **Step 4: Run the focused test**

Run `cd worker && npm test -- --run tests/resume-processing-reprocess.test.ts`.

Expected: PASS.

- [ ] **Step 5: Commit**

Run `git add worker/src/resume-processing/reprocess.ts worker/src/index.ts worker/tests/resume-processing-reprocess.test.ts && git commit -m "feat: enqueue idempotent resume reprocessing"`.

### Task 4: Route legacy evaluation endpoints to the queue

**Files:**
- Modify: `worker/src/index.ts`
- Modify: `frontend/src/pages/Resumes/Detail.tsx`
- Modify: `frontend/src/pages/Resumes/List.tsx`
- Test: `worker/tests/resume-processing-reprocess.test.ts`

**Interfaces:**
- `POST /api/resumes/:id/reparse` becomes a 202 queue trigger.
- `POST /api/resumes/:id/ai-screen` becomes a compatibility alias to the same queue trigger.
- `POST /api/resumes/batch-reprocess` accepts `{ ids?: string[] }`; absent ids means all visible/authorized resumes and returns queued/skipped counts.
- Existing `/auto-evaluate-all`, `/batch-ai-evaluate`, and `/batch-auto-screen` remain callable but delegate to batch reprocess rather than invoking AI synchronously.

- [ ] **Step 1: Write failing endpoint tests**

Add route-level tests or handler tests asserting `/reparse` returns 202 with `job_id`, clears old AI fields, and does not call `callAI` in the request; batch requests with ids enqueue only those ids.

- [ ] **Step 2: Run tests and verify failure**

Run `cd worker && npm test -- --run tests/resume-processing-reprocess.test.ts`.

Expected: FAIL because `/reparse` still performs synchronous AI work and no batch queue route exists.

- [ ] **Step 3: Implement compatibility routing**

Replace the synchronous `/reparse` body with the reprocess enqueue operation. Add `/batch-reprocess` with explicit ids support and authorization filtering. Convert legacy endpoints to call the same batch operation with `force=true`, returning 202 task counts instead of synchronous AI results. Keep old route names only for compatibility.

- [ ] **Step 4: Update frontend actions**

In `Detail.tsx`, remove the `AI初筛` button and rename `重新解析` to `重新评估`. In `List.tsx`, remove `AI 自动评估` and `AI 批量评估`; rename `全部重解析` to `批量重新评估`, pass selected ids when present, and otherwise confirm all resumes. Refresh via the existing polling path after 202.

- [ ] **Step 5: Run focused tests and build**

Run `cd worker && npm test -- --run tests/resume-processing-reprocess.test.ts tests/recruiting-operations.test.ts tests/resume-dimension-scores.test.ts`, then `cd frontend && npm run build`.

Expected: all selected tests PASS and the frontend build succeeds.

- [ ] **Step 6: Commit**

Run `git add worker/src/index.ts frontend/src/pages/Resumes/Detail.tsx frontend/src/pages/Resumes/List.tsx worker/tests/resume-processing-reprocess.test.ts && git commit -m "feat: unify resume evaluation actions"`.

### Task 5: Full verification and handoff

**Files:**
- Modify: none

- [ ] **Step 1: Run the full Worker suite**

Run `cd worker && npm test`.

Expected: all existing and new tests pass.

- [ ] **Step 2: Run frontend build and pre-deploy checks**

Run `cd frontend && npm run build && node ../scripts/pre-deploy-check.mjs`.

Expected: build succeeds and pre-deploy reports zero failures.

- [ ] **Step 3: Inspect the final diff**

Run `git diff origin/main...HEAD --stat` and `git diff --check`.

Expected: only unified resume evaluation code, tests, plan, and approved design documentation are changed.

- [ ] **Step 4: Report deployment readiness**

Do not deploy automatically. Report test evidence and wait for explicit production approval before pushing/merging to the production branch.
