# Resume Chain Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变生产环境和前端卡片展示的前提下，修复简历字段重复跳过、列表排序漂移和“待初筛”筛选遗漏。

**Architecture:** 以生产 `main` 的 Queue + D1 + KV 链路为基线。处理器在 `parsed_data` 中写入内部字段提取完成标记，显式重新处理任务强制重新提取字段；列表 SQL 以 `created_at` 为稳定主排序，并兼容 `screening_result='pending'` 的新上传记录。

**Tech Stack:** Cloudflare Workers/Hono, D1/SQLite, Cloudflare Queues, TypeScript, Vitest, React/Vite（仅构建验证，不改展示组件）。

## Global Constraints

- 不执行生产部署、不执行远程 D1 migration、不修改 `main` 分支。
- 不改变简历卡片、详情页的视觉展示和评分口径。
- 不引入新依赖；保持现有 Queue、D1、KV 接口。
- 所有行为变更必须先有失败测试，再写实现。

### Task 1: 字段提取状态标记与重新处理行为

**Files:**
- Modify: `worker/src/resume-processing/processor.ts`
- Test: `worker/tests/resume-processor.test.ts`

**Interfaces:**
- Consumes: `ResumeQueueMessage.reprocess` and persisted `parsed_data`.
- Produces: persisted `parsed_data._fields_extracted=true` and screening receives merged fields.

- [ ] **Step 1: Write the failing test**

Add a test where `parsed_data` contains only `school`, the evaluation is absent, and the processor must call `extractFields` before screening. Add a second assertion that an explicit `reprocess` job calls `extractFields` even when the marker already exists.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- --run tests/resume-processor.test.ts`

Expected: the new partial-field test fails because the current processor treats any non-empty field as complete.

- [ ] **Step 3: Write the minimal implementation**

Replace the “any extracted field” gate with a persisted `_fields_extracted` marker, force extraction when `message.reprocess` is true, merge metadata and extracted fields, and pass the merged object to screening.

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `npm test -- --run tests/resume-processor.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/resume-processing/processor.ts worker/tests/resume-processor.test.ts
git commit -m "fix: reextract incomplete resume fields"
```

### Task 2: 稳定新上传排序与待初筛筛选

**Files:**
- Modify: `worker/src/resume-list/optimized-handler.ts`
- Modify: `worker/src/index.ts`
- Test: `worker/tests/optimized-resume-list.test.ts`

**Interfaces:**
- Consumes: list query parameters `status=pending_screening`, D1 `created_at`, `updated_at`, and `screening_result`.
- Produces: stable newest-upload-first SQL ordering and inclusion of rows whose screening result is `pending`.

- [ ] **Step 1: Write the failing tests**

Update the optimized-list SQL assertion to require `ORDER BY r.created_at DESC, r.updated_at DESC`, and add an assertion that the pending filter includes the literal `pending` screening state.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- --run tests/optimized-resume-list.test.ts`

Expected: the ordering assertion fails against the current `updated_at`-first query.

- [ ] **Step 3: Write the minimal implementation**

Use `created_at` as the primary order in the optimized and legacy list handlers. Change the pending filter to require `status='pending_screening'` and accept `NULL`, empty, or `pending` screening results.

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `npm test -- --run tests/optimized-resume-list.test.ts tests/resume-display-order.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/resume-list/optimized-handler.ts worker/src/index.ts worker/tests/optimized-resume-list.test.ts
git commit -m "fix: stabilize resume list ordering and pending filter"
```

### Task 3: 本地验证

**Files:**
- No additional source files.

- [ ] **Step 1: Run Worker tests**

Run: `npm test`

Expected: all existing Worker tests pass.

- [ ] **Step 2: Build the frontend without changing UI code**

Run: `cd ../frontend && npm run build`

Expected: Vite build succeeds; existing pdfjs `eval` warning is acceptable if no new error appears.

- [ ] **Step 3: Report local branch and preview instructions**

Report the branch name, commit(s), test results, and that no production deployment occurred.
