# Resume AI Batch Reprocess Progress Implementation Plan

> For agentic workers: execute this plan task by task. Each task ends with a focused test cycle. Do not create branches, commits, PRs, pushes, or production changes without separate user authorization.

Goal: split resume AI re-evaluation into 全部重评 and 重评未评估/失败简历, persist per-resume batch progress, and prevent stale AI scores from being displayed while a job is queued, running, or failed.

Architecture: reuse resume_processing_jobs and Cloudflare Queue. Extend resume_reprocess_batches with scope/count fields and add resume_reprocess_batch_items. Expose batch creation/status/recovery APIs, merge latest evaluation-job status into both resume-list implementations, and let the React page poll the batch API and gate evaluation rendering on job state.

Tech stack: Cloudflare Workers, Hono, D1, Cloudflare Queue, React, TypeScript, Vite, Ant Design, Vitest.

## Global constraints

- Process only resumes visible to the authenticated user. Admin sees all; non-admin uses the existing getOwnerName responsibility filter.
- The two new UI actions must not depend on selectedRowKeys. Selection remains for batch approve, reject, and delete.
- New UI requests use { scope: 'all' } or { scope: 'incomplete_or_failed' }. Keep the old { ids } API path compatible.
- Never clear status, stage, hr_review, interview records, raw resume text, OCR artifacts, or secrets.
- Clear old AI result fields only after this call has successfully created a new job for the resume. Reusing an active job must not clear data.
- Batch progress comes from D1 batch-item rows and job state, never from browser memory or queue-send count.
- Keep the bounded historical coordinator; do not create one unbounded request-time queue loop.
- Keep the root package-lock.json untracked and out of every add or commit command.
- Do not create a branch, worktree, commit, push, PR, migration deployment, or production change unless separately authorized.
- Register /api/resumes/reprocess-batches/active before /api/resumes/reprocess-batches/:batchId.

## File map

Create or modify only these feature files unless a compiler or test proves another existing file is required:

- Create worker/migrations/0027_resume_reprocess_batch_items.sql.
- Modify worker/schema.sql.
- Create worker/src/resume-processing/batch-repository.ts.
- Modify worker/src/resume-processing/types.ts.
- Modify worker/src/resume-processing/reprocess.ts.
- Modify worker/src/index.ts.
- Modify worker/src/resume-list/optimized-handler.ts.
- Modify worker/src/resume-consumer.ts.
- Create or modify worker/tests/resume-reprocess-batch.test.ts.
- Modify worker/tests/historical-reprocess.test.ts.
- Modify worker/tests/resume-processing-reprocess.test.ts.
- Modify worker/tests/resume-consumer.test.ts.
- Modify worker/tests/optimized-resume-list.test.ts.
- Create frontend/src/utils/resumeReprocess.ts and its test.
- Create frontend/src/components/ResumeReprocessProgress.tsx and its test.
- Modify frontend/src/pages/Resumes/List.tsx and its focused test.

## Task 0: baseline

Files: read-only inspection of the files in the file map. No source changes.

- [ ] Step 1: run git status --short and git log -3 --oneline. Confirm the root package-lock.json remains untracked.
- [ ] Step 2: run the existing frontend and worker test suites:
    cd frontend && npm test -- --reporter=dot
    cd ../worker && npm test -- --run
- [ ] Step 3: record unrelated baseline failures by exact test name. Do not fix unrelated failures.

## Task 1: D1 schema

Files:
- Create worker/migrations/0027_resume_reprocess_batch_items.sql.
- Modify worker/schema.sql.
- Test worker/tests/resume-reprocess-batch.test.ts.

- [ ] Step 1: write a migration contract test asserting that the migration contains:
    ALTER TABLE resume_reprocess_batches ADD COLUMN scope TEXT NOT NULL DEFAULT 'all'
    ALTER TABLE resume_reprocess_batches ADD COLUMN total_count INTEGER NOT NULL DEFAULT 0
    CREATE TABLE IF NOT EXISTS resume_reprocess_batch_items
    UNIQUE(batch_id, resume_id)
    indexes for batch/status, resume/updated, and job ID.
- [ ] Step 2: run cd worker && npm test -- --run tests/resume-reprocess-batch.test.ts and verify the new test fails because the migration is absent.
- [ ] Step 3: add the migration with these columns:
    id, batch_id, resume_id, job_id, status, step, candidate_name, skip_reason, error_code, error_message, created_at, updated_at, completed_at.
  Status constraint: pending, queued, running, completed, failed, skipped.
  Add UNIQUE(batch_id, resume_id), foreign keys to batches and resumes, and indexes on batch_id/status, resume_id/updated_at DESC, and job_id.
- [ ] Step 4: update worker/schema.sql baseline definitions with scope, total_count, the item table, and indexes. Do not put ALTER TABLE statements into schema.sql and do not duplicate the existing batch table.
- [ ] Step 5: run the focused migration test again. Expected: PASS.

## Task 2: batch repository

Files:
- Modify worker/src/resume-processing/types.ts.
- Create worker/src/resume-processing/batch-repository.ts.
- Test worker/tests/resume-reprocess-batch.test.ts.

Add these public types:

    ReprocessScope = 'all' | 'incomplete_or_failed'
    ReprocessBatchStatus = 'queued' | 'running' | 'completed' | 'failed'
    ReprocessBatchItemStatus = 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'skipped'

Add ReprocessBatchView fields:

    batch_id, scope, status, total, completed, processing, queued, pending,
    failed, skipped, percent, current, failed_items, created_at,
    updated_at, completed_at

Add repository functions:

    hasValidAiEvaluation(value)
    ensureResumeReprocessBatchSchema(db)
    insertReprocessBatchItems(db, items)
    attachReprocessBatchItemToJob(db, batchId, resumeId, jobId)
    syncReprocessBatchItemByJob(db, jobId, update)
    getReprocessBatchView(db, batchId, owner)
    getActiveReprocessBatchView(db, owner)
    appendEvaluationJobProjection(db, items)

- [ ] Step 1: write failing tests for valid evaluation detection, aggregation, current item selection, failed-item listing, and cross-owner access denial.
- [ ] Step 2: run cd worker && npm test -- --run tests/resume-reprocess-batch.test.ts. Expected: FAIL because the repository module is absent.
- [ ] Step 3: implement hasValidAiEvaluation. Accept a parsed object with a non-empty dimensions array, finite weighted_score, non-empty summary, or non-empty screening_reason. Reject null, arrays, malformed JSON strings, and empty objects.
- [ ] Step 4: implement idempotent schema creation, inserting at most 100 items per D1 batch call, and INSERT OR IGNORE for duplicate batch/resume pairs.
- [ ] Step 5: implement job attachment. Write job_id, read the current job, copy status/step/errors, and close the race where a consumer finishes before attachment.
- [ ] Step 6: implement job synchronization. Update only non-terminal item rows; never move completed, failed, or skipped back to active.
- [ ] Step 7: implement aggregation. Verify batch owner first. Aggregate items by status. Percent is round((completed + failed + skipped) / total * 100); total zero is 100 and completed. Current is newest running item, otherwise newest queued item. Cap failed_items at 100.
- [ ] Step 8: implement appendEvaluationJobProjection in chunks of at most 100 IDs. Prefer active jobs over terminal jobs; add evaluation_job_status, evaluation_job_step, evaluation_job_error, and evaluation_batch_id to each existing list object. If no job exists, derive failed/active compatibility from parse_status and parse_error.
- [ ] Step 9: run the focused repository tests. Expected: PASS.

## Task 3: scoped candidate selection and orchestration

Files:
- Modify worker/src/resume-processing/reprocess.ts.
- Modify worker/src/resume-processing/types.ts if queue metadata needs a batch ID.
- Modify worker/tests/historical-reprocess.test.ts.
- Modify worker/tests/resume-processing-reprocess.test.ts.

Change the historical entry point to accept scope:
    startHistoricalResumeReprocess(db, queue, owner, scope)

Add testable functions:
    selectResumeIdsForBatchScope(db, scope, owner)
    enqueueResumeReprocessBatchPage(db, queue, batchId, rows)

- [ ] Step 1: add failing tests for all scope, incomplete_or_failed scope, active-job skip behavior, empty batches, and duplicate coordinator retries.
- [ ] Step 2: run the two focused worker test files and verify the new tests fail.
- [ ] Step 3: implement all-scope selection using the existing owner predicate.
- [ ] Step 4: implement incomplete_or_failed selection with fields id, candidate_name, parse_status, ai_evaluation, and newest task state. Include rows when no valid evaluation exists, parse_status is pending_screening or needs_manual, parse_status is failed, or newest job is failed. Do not exclude active jobs at selection time.
- [ ] Step 5: create one batch with scope, requested_count, matched_count, total_count, owner, timestamps, and active-owner protection. Send one historical_reprocess coordinator message. Return pending/queued counts accurately; do not claim all rows are queued before pages run.
- [ ] Step 6: materialize each coordinator page in groups of at most 25. Insert pending items with candidate names. For each row, call enqueueResumeReprocess. New job: attach job and mark queued. Existing active job: mark skipped with already_processing. Enqueue error: mark failed with ENQUEUE_FAILED and truncated error. Keep processing other rows.
- [ ] Step 7: preserve cursor and retry behavior. Unique batch/resume items make coordinator retries idempotent. Only mark the batch completed after all pages are materialized and all item rows are terminal.
- [ ] Step 8: run:
    cd worker && npm test -- --run tests/historical-reprocess.test.ts tests/resume-processing-reprocess.test.ts
  Expected: PASS, including existing legacy tests.

## Task 4: worker routes and list projection

Files:
- Modify worker/src/index.ts.
- Modify worker/src/resume-list/optimized-handler.ts.
- Modify worker/tests/resume-reprocess-batch.test.ts.
- Modify worker/tests/optimized-resume-list.test.ts.

Routes:
    POST /api/resumes/batch-reprocess
    GET /api/resumes/reprocess-batches/active
    GET /api/resumes/reprocess-batches/:batchId

- [ ] Step 1: add failing route tests for valid scopes, invalid scope, scope plus ids rejection, active batch response, missing batch response, and cross-owner 404.
- [ ] Step 2: run the focused route tests and verify failure.
- [ ] Step 3: implement POST validation. Accept exactly one of scope or legacy ids. Unknown scope and scope plus ids return 400. Existing ids maximum of 50 remains.
- [ ] Step 4: implement active route before dynamic route. Return { batch: null } when no active batch. Return 404 for missing or unauthorized batch IDs.
- [ ] Step 5: map an existing active batch to 409 with stable human-readable detail. Do not leak SQL errors or resume content.
- [ ] Step 6: call appendEvaluationJobProjection after parsing items in both normal and optimized list handlers. Do not add raw_text or OCR blobs to optimized LIST_COLUMNS.
- [ ] Step 7: run:
    cd worker && npm test -- --run tests/resume-reprocess-batch.test.ts tests/optimized-resume-list.test.ts
  Expected: PASS.

## Task 5: queue consumer synchronization

Files:
- Modify worker/src/resume-consumer.ts.
- Modify worker/tests/resume-consumer.test.ts.

- [ ] Step 1: write failing tests asserting item updates on claim, step, completion, final failure, and no-op behavior when the job has no batch item. Retryable errors must not become final failed items.
- [ ] Step 2: run the focused consumer test and verify failure.
- [ ] Step 3: after claimJob succeeds, sync job status running.
- [ ] Step 4: in both D1 and R2 setJobStep callbacks, sync the item step and running state idempotently.
- [ ] Step 5: after successful job completion, sync completed. After final failure, sync failed with PROCESSING_FAILED, the same truncated error, and the existing resume parse_status failed update.
- [ ] Step 6: if sync itself fails after the job is complete, log it without re-running AI work or making the queue retry; reconciliation can use the job table.
- [ ] Step 7: run:
    cd worker && npm test -- --run tests/resume-consumer.test.ts tests/resume-reprocess-batch.test.ts
  Expected: PASS.

## Task 6: frontend types and progress component

Files:
- Create frontend/src/utils/resumeReprocess.ts.
- Create frontend/src/utils/resumeReprocess.test.ts.
- Create frontend/src/components/ResumeReprocessProgress.tsx.
- Create frontend/src/components/ResumeReprocessProgress.test.tsx.

Add frontend types matching the worker view and helpers:
    getEvaluationCardState(record)
    getEvaluationStepLabel(step)
    getReprocessPercent(batch)
    isReprocessBatchActive(batch)

- [ ] Step 1: write failing tests:
    getReprocessPercent({ total: 120, completed: 42, failed: 4, skipped: 1 }) is 39.
    total zero is 100.
    queued/running wins over old ai_evaluation.
    failed wins over old ai_evaluation.
    screening maps to AI 评分中.
- [ ] Step 2: run the helper test and verify failure.
- [ ] Step 3: implement helpers. Processing means queued or running; failed means failed; completed requires a valid result; otherwise empty. Keep legacy rows with valid evaluation displayable when no job projection exists.
- [ ] Step 4: implement the component using Ant Design Card, Progress, Tag, Space, and Modal. Show batch title, percent, completed/total, pending, queued, processing, failed, skipped, current candidate/step, and a failed-item modal.
- [ ] Step 5: run the helper and component tests. Expected: PASS.

## Task 7: integrate the resume page

Files:
- Modify frontend/src/pages/Resumes/List.tsx.
- Modify frontend/src/pages/Resumes/List.layout.test.ts or create frontend/src/pages/Resumes/List.reprocess.test.ts.

Add page state:
    reprocessBatch: ReprocessBatchView | null
    reprocessPolling: boolean

Add functions:
    handleStartReprocess(scope)
    fetchReprocessBatch(batchId, silent)
    fetchActiveReprocessBatch()

- [ ] Step 1: write failing source/UI contract assertions:
    menu contains 全部重评 and 重评未评估/失败简历;
    requests contain scope all and incomplete_or_failed;
    page renders ResumeReprocessProgress;
    page uses evaluation_job_status;
    old selectedRowKeys-dependent reparse label is absent.
- [ ] Step 2: run the focused frontend test and verify failure.
- [ ] Step 3: replace the old selection-dependent reparse handler with scope-based Modal.confirm. Use exact menu labels:
    全部重评
    重评未评估/失败简历
    清除已淘汰
- [ ] Step 4: on confirm POST /resumes/batch-reprocess with scope. For total zero, show 当前没有需要重新评估的简历 and do not start polling. Otherwise fetch the batch, refresh the current list, and show accepted/skipped counts. Handle 409 by keeping the active batch.
- [ ] Step 5: on initial page load GET /resumes/reprocess-batches/active. Poll the selected batch every 4000ms while queued or running. Use a dedicated request version/ref, update batch state, refresh the current list, stop on completed/failed, and clean timers on unmount.
- [ ] Step 6: render ResumeReprocessProgress below PageHeader and above statistics.
- [ ] Step 7: in card rendering, compute card state from evaluation_job_status. While queued/running or failed, hide screening label, gate tags, weighted score, dimension tags, and screening reason from old evaluation. Show 排队中, AI 评分中, or 评估失败 with the error. Preserve position, human workflow tags, actions, and navigation.
- [ ] Step 8: keep old parse_status polling for compatibility, but never use it for batch percentage.
- [ ] Step 9: run:
    cd frontend && npm test -- --reporter=dot && npx tsc -b
  Expected: PASS and typecheck exit 0.

## Task 8: regression tests

Files:
- Modify worker/tests/optimized-resume-list.test.ts.
- Modify worker/tests/resume-reprocess-batch.test.ts.
- Modify frontend/src/utils/resumeReprocess.test.ts.
- Modify frontend/src/components/ResumeReprocessProgress.test.tsx.
- Modify the focused page test.

- [ ] Step 1: prove active list rows include evaluation_job_status, evaluation_job_step, evaluation_job_error, and evaluation_batch_id.
- [ ] Step 2: prove legacy parse_status failed without a job becomes evaluation_job_status failed with parse_error.
- [ ] Step 3: prove queued/running/failed records with old scores resolve to processing/failed, never completed.
- [ ] Step 4: render a batch with total 10 and completed 4; assert 40%, 已完成 4 / 10, and 失败 count.
- [ ] Step 5: run both full suites:
    cd frontend && npm test -- --reporter=dot
    cd ../worker && npm test -- --run
  Expected: no failures. Report exact unrelated baseline failures instead of weakening assertions.

## Task 9: final verification and handoff

- [ ] Step 1: run:
    cd frontend && npx tsc -b && npm run build
    cd ../worker && npx tsc --noEmit
  Expected: every command exits 0.
- [ ] Step 2: run git diff --check, git status --short, and git diff --stat.
- [ ] Step 3: inspect that root package-lock.json is still untracked and untouched, no production operation occurred, no human fields were cleared, both list handlers expose job projection fields, and the old selection-dependent reparse menu item is gone.
- [ ] Step 4: report files, migration filename, exact verification results, known limitations, and explicit statements that production was not deployed and GitHub was not pushed.
