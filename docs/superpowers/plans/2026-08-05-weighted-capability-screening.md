# Weighted Capability Screening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将简历 AI 初筛统一为“关键词匹配/避坑雷区准入 + 其余五维加权分（0–5）”，并让岗位权重、前端展示和历史重评全部使用同一规则。

**Architecture:** 新增纯函数评分模块作为唯一规则源，接收 7 个维度和岗位配置，先校验两个闸门，再对核心画像、核心职责、任职要求、企业背景、加分项进行归一化加权。队列消费者和兼容旧路由都调用该模块；评估 JSON 保存 7 项明细、`weighted_score`、`screening_reason` 和 `screening_result`，前端从结构化评估读取 `/5` 分数。

**Tech Stack:** Cloudflare Worker/TypeScript、D1、Queues、Vitest、React + Ant Design、Vite。

## Global Constraints

- 所有 7 个维度均为 0–5 分；关键词匹配和避坑雷区只能作为准入闸门。
- 关键词匹配或避坑雷区低于 5 时，最终结果必须为“不通过”，且 `weighted_score` 为 `null`。
- 两个闸门均为 5 后，只计算其余五维；加权分 `>= 4` 为“通过”。
- 默认五维原始权重为 `25 / 22 / 22 / 13 / 10`，岗位配置权重归一化后计算。
- 不再生成或展示“AI 存疑”；历史 `match_score` 仅兼容读取，新写入值为 0–5 加权分。
- 生产部署前必须完成测试、构建、预发布检查并取得用户明确上线确认。

---

### Task 1: 建立统一评分纯函数

**Files:**
- Create: `worker/src/resume-processing/weighted-screening.ts`
- Create: `worker/tests/weighted-screening.test.ts`
- Modify: `worker/src/index.ts:11-15` (replace local scoring imports with the new module)

**Interfaces:**
- Consumes: raw AI `dimensions`, configured dimension weights, and optional legacy `match_score`.
- Produces: `evaluateWeightedScreening(evaluation, configuredDimensions)` returning `{ dimensions, weighted_score, screening_result, screening_reason, gate_results }`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { evaluateWeightedScreening } from '../src/resume-processing/weighted-screening';

const config = [
  { name: '核心画像', weight: 25 }, { name: '核心职责', weight: 22 },
  { name: '任职要求', weight: 22 }, { name: '企业背景', weight: 13 },
  { name: '关键词匹配', weight: 8 }, { name: '加分项', weight: 10 },
  { name: '避坑雷区', weight: 8 },
];

it('rejects when keyword gate is below five without calculating a score', () => {
  const result = evaluateWeightedScreening({ dimensions: config.map(d => ({ name: d.name, score: d.name === '关键词匹配' ? 4 : 5 })) }, config);
  expect(result.screening_result).toBe('不通过');
  expect(result.weighted_score).toBeNull();
  expect(result.screening_reason).toContain('关键词');
});

it('rejects when the red-flag gate is below five', () => {
  const result = evaluateWeightedScreening({ dimensions: config.map(d => ({ name: d.name, score: d.name === '避坑雷区' ? 3 : 5 })) }, config);
  expect(result.screening_result).toBe('不通过');
  expect(result.weighted_score).toBeNull();
  expect(result.screening_reason).toContain('避坑');
});

it('calculates only the five scoring dimensions after both gates pass', () => {
  const result = evaluateWeightedScreening({ dimensions: config.map(d => ({ name: d.name, score: 5 })) }, config);
  expect(result.weighted_score).toBe(5);
  expect(result.screening_result).toBe('通过');
});

it('uses four as the pass boundary and treats missing gate dimensions as zero', () => {
  const scores = { '核心画像': 4, '核心职责': 4, '任职要求': 4, '企业背景': 4, '加分项': 4, '关键词匹配': 5, '避坑雷区': 5 };
  const result = evaluateWeightedScreening({ dimensions: Object.entries(scores).map(([name, score]) => ({ name, score })) }, config);
  expect(result.weighted_score).toBe(4);
  expect(result.screening_result).toBe('通过');
  expect(evaluateWeightedScreening({ dimensions: [] }, config).screening_reason).toContain('关键词');
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `cd worker && npm test -- weighted-screening.test.ts`

Expected: FAIL because `weighted-screening.ts` and `evaluateWeightedScreening` do not exist.

- [ ] **Step 3: Implement the minimal scoring module**

Implement these exact rules:

1. Normalize configured weights by dimension name; use 25/22/22/13/10 for the five scoring names when no positive weights are configured.
2. Normalize each AI score to a finite number clamped to 0–5; missing scores become 0.
3. Require `关键词匹配 >= 5` and `避坑雷区 >= 5`; fail fast with `weighted_score: null` and a Chinese reason naming the first failed gate.
4. Calculate `sum(score * normalizedWeight) / sum(normalizedWeight)` using only the five scoring names, round to one decimal, and return `通过` when the result is at least 4.

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `cd worker && npm test -- weighted-screening.test.ts`

Expected: 4 tests passed.

- [ ] **Step 5: Commit**

```bash
git add worker/src/resume-processing/weighted-screening.ts worker/tests/weighted-screening.test.ts
git commit -m "feat: add weighted capability screening rules"
```

### Task 2: Route every AI evaluation through the scoring module

**Files:**
- Modify: `worker/src/index.ts:620-740, 4580-4610, 5470-5560, 6230-6400, 10290-10460`
- Modify: `worker/src/resume-consumer.ts`
- Modify: `worker/src/resume-processing/processor.ts`
- Modify: `worker/src/resume-processing/reprocess.ts`
- Test: `worker/tests/resume-consumer.test.ts`, `worker/tests/weighted-screening.test.ts`

**Interfaces:**
- Consumes: `evaluateWeightedScreening` from Task 1.
- Produces: every upload/reparse/auto-evaluate/queue path writes the same `dimensions`, `weighted_score`, `screening_reason`, `screening_result`, and `match_score = weighted_score`.

- [ ] **Step 1: Add integration tests that fail against the current 0–100 path**

Cover the queue consumer and the synchronous compatibility evaluator with a mocked AI result containing `match_score: 62` but seven 5-point dimensions. Assert the persisted result is `weighted_score: 5`, `match_score: 5`, and `screening_result: '通过'`; add a red-flag score of 4 and assert `screening_result: '不通过'` with null weighted score.

- [ ] **Step 2: Run the integration tests and verify the old behavior fails**

Run: `cd worker && npm test -- resume-consumer.test.ts weighted-screening.test.ts`

Expected: the new assertions fail because existing code still derives the result from `match_score`.

- [ ] **Step 3: Replace legacy score derivation**

Update `enrichScreeningEvaluation` to call `evaluateWeightedScreening` after filtering configured dimensions. Update all result persistence blocks to use `evaluation.weighted_score` for `match_score`, use `evaluation.screening_result`, and include `screening_reason` and `gate_results` in `ai_evaluation` and `ai_review`.

Update all AI prompts to require exactly the seven named dimensions, explicitly define keyword and red-flag gate semantics, and state that `match_score` is not authoritative.

Make the queue processor re-evaluate existing `ai_evaluation` when a reprocess job is explicitly requested; do not skip screening just because old JSON exists.

- [ ] **Step 4: Run worker tests**

Run: `cd worker && npm test`

Expected: all worker tests pass, including the new gate and boundary assertions.

- [ ] **Step 5: Commit**

```bash
git add worker/src/index.ts worker/src/resume-consumer.ts worker/src/resume-processing/processor.ts worker/src/resume-processing/reprocess.ts worker/tests
git commit -m "feat: use weighted capability score for AI screening"
```

### Task 3: Persist and expose structured gate results

**Files:**
- Modify: `worker/src/resume-schema.ts`
- Modify: `worker/src/resume-list/optimized-handler.ts`
- Modify: `worker/src/index.ts:5070-5100, 5600-5620`
- Test: `worker/tests/optimized-resume-list.test.ts`, `worker/tests/resume-schema-compatibility.test.ts`

**Interfaces:**
- Consumes: `ai_evaluation.gate_results`, `weighted_score`, and `screening_reason` from Task 2.
- Produces: list/detail API rows with `weighted_score`, `gate_results`, `screening_reason`, and normalized 0–5 `match_score`.

- [ ] **Step 1: Add failing API normalization tests**

Assert that a row containing legacy `match_score: 62` and structured `ai_evaluation.weighted_score: 3.8` exposes `weighted_score: 3.8` and `match_score: 3.8`; assert gate details are parsed as objects and old `screening_result: '存疑'` normalizes to `不通过`.

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `cd worker && npm test -- optimized-resume-list.test.ts resume-schema-compatibility.test.ts`

Expected: FAIL because the handlers currently expose the legacy score and do not expose gate fields.

- [ ] **Step 3: Implement compatibility parsing**

Parse `ai_evaluation` before applying fallback fields, expose `weighted_score` from the JSON, derive `match_score` from it, and preserve `null` for gate failures. Add a defensive schema migration only if a separate scalar column is required; prefer structured JSON to avoid a D1 migration for this display-only field.

- [ ] **Step 4: Run the focused tests and the full worker suite**

Run: `cd worker && npm test -- optimized-resume-list.test.ts resume-schema-compatibility.test.ts && npm test`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add worker/src/resume-schema.ts worker/src/resume-list/optimized-handler.ts worker/src/index.ts worker/tests
git commit -m "feat: expose weighted score and screening gates"
```

### Task 4: Add editable five-dimension weights and preserve seven-dimension display

**Files:**
- Modify: `frontend/src/pages/Positions/List.tsx`
- Modify: `frontend/src/pages/Settings/CapabilityDimensions.tsx`
- Modify: `frontend/src/pages/Resumes/Detail.tsx`
- Modify: `frontend/src/pages/Resumes/List.tsx`
- Modify: `frontend/src/utils/resumeEvaluation.ts`
- Test: `frontend/src/pages/Positions/capabilitySave.test.ts`, create `frontend/src/utils/weightedScreeningDisplay.test.ts`

**Interfaces:**
- Consumes: API `weighted_score`, `gate_results`, `screening_reason`, and configured dimensions from Tasks 2–3.
- Produces: position forms that edit per-dimension weights and resume UI that displays `加权分 / 5`, gate tags, and failure reason.

- [ ] **Step 1: Write failing frontend tests**

Test that normalized evaluation chooses `weighted_score` over `match_score`, renders a gate failure as “关键词匹配未达 5 分” or “命中避坑雷区”, and renders a passing score as `4.2/5` rather than `84%`.

- [ ] **Step 2: Run focused frontend tests and verify failure**

Run: `cd frontend && npx vitest run src/utils/weightedScreeningDisplay.test.ts src/pages/Positions/capabilitySave.test.ts`

Expected: FAIL because the helper and new display fields do not exist.

- [ ] **Step 3: Implement the UI and save payload**

Add a numeric weight input to each position capability row; preserve `name`, `description`, and `weight` when loading/saving. Default the five scoring dimensions to 25/22/22/13/10 and keep keyword/red-flag rows visible with a non-scoring label. Update detail/list cards and progress formatting to use 0–5, show `—` when a gate failed, and render both gate rows separately with their reasons.

- [ ] **Step 4: Run frontend tests and build**

Run: `cd frontend && npx vitest run src/utils/weightedScreeningDisplay.test.ts src/pages/Positions/capabilitySave.test.ts && npm run build`

Expected: focused tests pass and Vite/TypeScript build exits 0.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Positions/List.tsx frontend/src/pages/Settings/CapabilityDimensions.tsx frontend/src/pages/Resumes/Detail.tsx frontend/src/pages/Resumes/List.tsx frontend/src/utils/resumeEvaluation.ts frontend/src/utils/weightedScreeningDisplay.test.ts
git commit -m "feat: show weighted resume score and editable weights"
```

### Task 5: Re-evaluate all historical resumes through the queue

**Files:**
- Modify: `worker/src/index.ts:5878-5960, 10302-10320`
- Modify: `worker/src/resume-processing/reprocess.ts`
- Test: `worker/tests/resume-processing-reprocess.test.ts`, create `worker/tests/historical-reprocess.test.ts`

**Interfaces:**
- Consumes: existing `enqueueResumeReprocessBatchForIds` and the unified scoring path from Task 2.
- Produces: an authenticated, idempotent batch operation that enqueues every visible historical resume, reports counts, and never performs AI work inline.

- [ ] **Step 1: Add a failing batch test**

Assert that an admin request with no `ids` selects all resumes, enqueues each exactly once, resets stale evaluation fields, and returns HTTP 202 with `requested`, `matched`, `queued`, and `failed` counts.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `cd worker && npm test -- historical-reprocess.test.ts resume-processing-reprocess.test.ts`

Expected: FAIL for the stale-evaluation reset/idempotency assertions.

- [ ] **Step 3: Implement safe historical reprocessing**

Ensure `resetResumeForReprocess` clears old evaluation and score fields while retaining PDF/OCR/raw text and HR/interview fields. Reuse `/api/resumes/batch-reprocess` for the admin-triggered all-resume run, record processing logs, and do not add a deployment-time synchronous migration.

- [ ] **Step 4: Run worker tests and the pre-deploy check**

Run: `cd worker && npm test && cd .. && node scripts/pre-deploy-check.mjs`

Expected: all tests pass and pre-deploy check reports 0 failures.

- [ ] **Step 5: Commit**

```bash
git add worker/src/index.ts worker/src/resume-processing/reprocess.ts frontend/src/pages/Resumes/List.tsx worker/tests
git commit -m "feat: queue historical resumes for weighted re-evaluation"
```

### Task 6: End-to-end verification and release handoff

**Files:**
- Verify: all files from Tasks 1–5
- No new production files

- [ ] **Step 1: Run the complete test matrix**

Run:

```bash
cd worker && npm test
cd ../frontend && npx vitest run && npm run build
cd .. && node scripts/pre-deploy-check.mjs
```

Expected: worker/frontend tests pass, frontend build exits 0, and pre-deploy checks report 0 failures.

- [ ] **Step 2: Inspect the final diff and ensure no unrelated changes**

Run: `git diff --check && git status --short && git diff --stat origin/main...HEAD`

Expected: no whitespace errors, only weighted-screening files/docs changed, and worktree is clean after commit.

- [ ] **Step 3: Report deployment approval requirement**

Do not push `main` or deploy Pages/Worker until the user explicitly says “上线/部署吧”. After approval, push the verified commit, watch `.github/workflows/deploy.yml`, check `https://ai-interview-88r.pages.dev/health`, then trigger the authenticated historical batch re-evaluation and report queue counts.
