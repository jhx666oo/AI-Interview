# Resume Processing Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make resume text extraction and AI screening durable, idempotent background work that continues after the browser closes and scales safely for batch uploads.

**Architecture:** The Pages Worker creates a D1 resume and job, then sends `{ jobId, resumeId }` to a Queue. A separate Queue consumer owns OCR, field extraction, and screening as idempotent steps, while the React app only reads and displays D1 job state. Feishu writeback is decoupled from the processing outcome.

**Tech Stack:** Cloudflare Pages, Cloudflare Queues, Cloudflare Worker consumer, D1, Hono, TypeScript, React 19, Vitest.

## Global Constraints

- All task identity and writes use `resume.id` and `resume_processing_jobs.id`; never `candidate_name`.
- Main processing must not use `executionCtx.waitUntil`.
- The consumer starts with `max_concurrency = 3` and processes one resume per Queue message.
- Queue failures are retried with bounded backoff; a failed Feishu sync must not revert `ai_screened`.
- Preserve existing `resumes` and `resume_files` records; no historical reprocessing in this change.
- Do not log API keys, access tokens, PDF contents, or candidate PII.

---

## File structure

- `scripts/migration_resume_processing_jobs.sql` — additive D1 table/index migration.
- `worker/src/resume-processing/types.ts` — job states, Queue payload, D1 row types.
- `worker/src/resume-processing/job-repository.ts` — idempotent task creation, atomic claim, state transitions.
- `worker/src/resume-processing/processor.ts` — text/OCR, field extraction, and screening orchestration by resume ID.
- `worker/src/resume-consumer.ts` — Queue consumer entrypoint and retry policy.
- `worker/wrangler.resume-consumer.toml` — separate consumer deployment and Queue binding.
- `worker/tests/resume-processing.test.ts` — job claim, retry, and ID-only write tests.
- `worker/tests/resume-processor.test.ts` — text-to-fields-to-screening ordering tests with mocked AI/OCR.
- `worker/src/index.ts` — Queue producer binding, upload enqueue, job status/retry APIs; remove automatic batch-evaluation entrypoints from this flow.
- `worker/schema.sql` — local schema parity for the new job table.
- `frontend/wrangler.toml` — Pages Queue producer binding.
- `frontend/src/pages/Resumes/List.tsx` — remove automatic `auto-evaluate-all`; show job state and poll only active jobs.
- `frontend/src/pages/Resumes/Detail.tsx` — show processing state/error and enqueue safe retry.
- `frontend/src/pages/Resumes/Upload.tsx` — consume immediate queued-upload response without driving OCR/AI itself.
- `frontend/package.json`, `worker/package.json` — test scripts/dependencies if absent.

## Task 1: Define the durable job data model

**Files:**
- Create: `scripts/migration_resume_processing_jobs.sql`
- Create: `worker/src/resume-processing/types.ts`
- Modify: `worker/schema.sql`
- Test: `worker/tests/resume-processing.test.ts`

**Consumes:** Existing `resumes(id, parse_status, parse_error, updated_at)`.

**Produces:** `ResumeProcessingJob`, `ResumeJobStatus`, `ResumeJobStep`, and a partial unique index for active jobs.

- [ ] **Step 1: Write the failing schema/type tests**

```ts
import { describe, expect, it } from 'vitest';
import { ACTIVE_JOB_STATUSES, isTerminalJobStatus } from '../src/resume-processing/types';

describe('resume job status contract', () => {
  it('only treats completed, failed, and cancelled as terminal', () => {
    expect(isTerminalJobStatus('completed')).toBe(true);
    expect(isTerminalJobStatus('queued')).toBe(false);
    expect(ACTIVE_JOB_STATUSES).toEqual(['queued', 'running']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd worker && npm test -- resume-processing.test.ts`

Expected: FAIL because `resume-processing/types` and the test command do not exist.

- [ ] **Step 3: Add the migration and types**

```sql
CREATE TABLE IF NOT EXISTS resume_processing_jobs (
  id TEXT PRIMARY KEY,
  resume_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','running','completed','failed','cancelled')),
  step TEXT NOT NULL CHECK (step IN ('extracting_text','extracting_fields','screening','syncing_feishu')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (resume_id) REFERENCES resumes(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_resume_jobs_one_active
  ON resume_processing_jobs(resume_id)
  WHERE status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS idx_resume_jobs_status_updated
  ON resume_processing_jobs(status, updated_at DESC);
```

```ts
export const ACTIVE_JOB_STATUSES = ['queued', 'running'] as const;
export type ResumeJobStatus = typeof ACTIVE_JOB_STATUSES[number] | 'completed' | 'failed' | 'cancelled';
export type ResumeJobStep = 'extracting_text' | 'extracting_fields' | 'screening' | 'syncing_feishu';
export interface ResumeQueueMessage { jobId: string; resumeId: string; }
export const isTerminalJobStatus = (status: ResumeJobStatus) =>
  status === 'completed' || status === 'failed' || status === 'cancelled';
```

- [ ] **Step 4: Run the test and schema migration locally**

Run: `cd worker && npm test -- resume-processing.test.ts` then `npx wrangler d1 execute ai-interview-db --local --file ../scripts/migration_resume_processing_jobs.sql`

Expected: test PASS; migration returns success and can be re-run safely.

- [ ] **Step 5: Commit**

```bash
git add worker/schema.sql scripts/migration_resume_processing_jobs.sql worker/src/resume-processing/types.ts worker/tests/resume-processing.test.ts worker/package.json worker/package-lock.json
git commit -m "feat: add durable resume processing jobs"
```

## Task 2: Build an idempotent D1 job repository

**Files:**
- Create: `worker/src/resume-processing/job-repository.ts`
- Modify: `worker/tests/resume-processing.test.ts`

**Consumes:** `ResumeQueueMessage`, D1 database binding.

**Produces:** `createOrGetActiveJob`, `claimJob`, `setJobStep`, `completeJob`, `failJob`.

- [ ] **Step 1: Write failing claim tests**

```ts
it('only allows one consumer to claim a queued job', async () => {
  await insertJob(db, { id: 'job-1', resume_id: 'resume-1', status: 'queued' });
  expect(await claimJob(db, 'job-1')).toMatchObject({ status: 'running', attempt_count: 1 });
  expect(await claimJob(db, 'job-1')).toBeNull();
});

it('returns an existing active job instead of creating a duplicate', async () => {
  const first = await createOrGetActiveJob(db, 'resume-1');
  const second = await createOrGetActiveJob(db, 'resume-1');
  expect(second.id).toBe(first.id);
});
```

- [ ] **Step 2: Run the tests to verify failure**

Run: `cd worker && npm test -- resume-processing.test.ts`

Expected: FAIL because repository functions do not exist.

- [ ] **Step 3: Implement conditional, ID-only transitions**

```ts
export async function claimJob(db: D1Database, jobId: string) {
  const timestamp = new Date().toISOString();
  const result = await db.prepare(
    `UPDATE resume_processing_jobs
       SET status='running', attempt_count=attempt_count+1, started_at=COALESCE(started_at, ?), updated_at=?, version=version+1
     WHERE id=? AND status='queued'`
  ).bind(timestamp, timestamp, jobId).run();
  if (!result.meta.changes) return null;
  return db.prepare('SELECT * FROM resume_processing_jobs WHERE id=?').bind(jobId).first();
}
```

Implement all other writes with `WHERE id = ?`; use the unique partial index conflict to return the existing queued/running job.

- [ ] **Step 4: Run repository tests**

Run: `cd worker && npm test -- resume-processing.test.ts`

Expected: PASS, including a duplicate enqueue and a double-claim attempt.

- [ ] **Step 5: Commit**

```bash
git add worker/src/resume-processing/job-repository.ts worker/tests/resume-processing.test.ts
git commit -m "feat: add idempotent resume job repository"
```

## Task 3: Implement the single resume processor

**Files:**
- Create: `worker/src/resume-processing/processor.ts`
- Modify: `worker/src/index.ts`
- Modify: `worker/tests/resume-processor.test.ts`

**Consumes:** `resume.id`, `resume_files`, existing `callAI`, `getPositionContext`, `extractJSON`, and MinerU API credentials.

**Produces:** `processResume(job, env)` that advances one resume through text, fields, and screening exactly once.

- [ ] **Step 1: Write the failing processor tests**

```ts
it('extracts fields before screening and writes only the target resume id', async () => {
  const calls: string[] = [];
  const deps = fakeProcessorDeps({
    getText: async () => 'candidate resume text',
    extractFields: async () => { calls.push('fields'); return { school: 'A大学', skills: ['TS'] }; },
    screen: async () => { calls.push('screen'); return { match_score: 82, dimensions: [] }; },
  });
  await processResume({ jobId: 'job-1', resumeId: 'resume-1' }, deps);
  expect(calls).toEqual(['fields', 'screen']);
  expect(deps.updatedResumeIds).toEqual(['resume-1', 'resume-1']);
});

it('skips field extraction and screening already persisted for a retried job', async () => {
  const deps = fakeProcessorDeps({ existingFields: { school: 'A大学' }, existingEvaluation: { match_score: 82 } });
  await processResume({ jobId: 'job-1', resumeId: 'resume-1' }, deps);
  expect(deps.aiCallCount).toBe(0);
});
```

- [ ] **Step 2: Run processor tests to verify failure**

Run: `cd worker && npm test -- resume-processor.test.ts`

Expected: FAIL because `processResume` does not exist.

- [ ] **Step 3: Extract reusable service boundaries and implement processing**

Export only the existing pure/reusable helpers needed by the consumer from `worker/src/index.ts`: `callAI`, `getPositionContext`, and `extractJSON`; do not duplicate prompts in the consumer. Implement these processor boundaries:

```ts
export interface ResumeProcessorDeps {
  getResume(resumeId: string): Promise<ResumeRow>;
  getText(resume: ResumeRow): Promise<{ text: string; source: 'raw_text' | 'ocr_markdown' | 'mineru' }>;
  extractFields(text: string, resume: ResumeRow): Promise<Record<string, unknown>>;
  screen(text: string, fields: Record<string, unknown>, resume: ResumeRow): Promise<ScreeningResult>;
  updateResume(resumeId: string, update: ResumeUpdate): Promise<void>;
  setJobStep(jobId: string, step: ResumeJobStep): Promise<void>;
}
export async function processResume(message: ResumeQueueMessage, deps: ResumeProcessorDeps): Promise<void>;
```

Use `ocr_markdown`, then `raw_text`, then `resume_files.content` + MinerU. Persist `ocr_markdown`; persist `parsed_data` before screening; persist `ai_review`, `ai_evaluation`, `match_score`, `screening_result`, and `parse_status='ai_screened'` only by `resume.id`.

- [ ] **Step 4: Run focused tests and Worker typecheck**

Run: `cd worker && npm test -- resume-processor.test.ts && npx tsc --noEmit`

Expected: PASS with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add worker/src/index.ts worker/src/resume-processing/processor.ts worker/tests/resume-processor.test.ts
git commit -m "feat: add unified resume processing pipeline"
```

## Task 4: Add Queue producer and consumer deployment

**Files:**
- Create: `worker/src/resume-consumer.ts`
- Create: `worker/wrangler.resume-consumer.toml`
- Modify: `frontend/wrangler.toml`
- Modify: `worker/src/index.ts`
- Test: `worker/tests/resume-consumer.test.ts`

**Consumes:** Queue payload and processor/repository APIs.

**Produces:** Pages producer `RESUME_PROCESSING_QUEUE` and a Worker Queue consumer that retries transient processing failures.

- [ ] **Step 1: Write consumer tests**

```ts
it('acknowledges completed jobs and retries transient failures', async () => {
  await handleQueueMessage(fakeMessage({ jobId: 'job-1', resumeId: 'resume-1' }), fakeEnv({ process: async () => undefined }));
  expect(message.ack).toHaveBeenCalledOnce();

  await handleQueueMessage(fakeMessage({ jobId: 'job-2', resumeId: 'resume-2' }), fakeEnv({ process: async () => { throw new RetryableResumeError('SCREENING_TIMEOUT'); } }));
  expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 30 });
});
```

- [ ] **Step 2: Run the test to verify failure**

Run: `cd worker && npm test -- resume-consumer.test.ts`

Expected: FAIL because the consumer handler is absent.

- [ ] **Step 3: Configure Queue bindings and consumer**

Add this producer binding to `frontend/wrangler.toml`:

```toml
[[queues.producers]]
binding = "RESUME_PROCESSING_QUEUE"
queue = "resume-processing"
```

Create the consumer config with the same D1 binding and secrets as production API:

```toml
name = "ai-interview-resume-consumer"
main = "src/resume-consumer.ts"
compatibility_date = "2024-12-01"

[[queues.consumers]]
queue = "resume-processing"
max_batch_size = 1
max_batch_timeout = 5
max_concurrency = 3
```

The consumer must `ack()` completed/idempotently skipped messages, `retry({ delaySeconds })` retryable OCR/AI failures with exponential delays, and mark terminal failures in D1 before `ack()`. The Pages upload endpoint calls `await c.env.RESUME_PROCESSING_QUEUE.send({ jobId, resumeId })` only after the resume and job were persisted.

- [ ] **Step 4: Run consumer tests and local binding validation**

Run: `cd worker && npm test -- resume-consumer.test.ts && npx tsc --noEmit`

Expected: PASS. Then deploy a staging consumer and verify `wrangler tail` logs one acknowledged message.

- [ ] **Step 5: Commit**

```bash
git add frontend/wrangler.toml worker/wrangler.resume-consumer.toml worker/src/resume-consumer.ts worker/src/index.ts worker/tests/resume-consumer.test.ts
git commit -m "feat: queue resume processing jobs"
```

## Task 5: Change upload and retry APIs to enqueue work only

**Files:**
- Modify: `worker/src/index.ts`
- Modify: `worker/tests/resume-processing.test.ts`
- Modify: `frontend/src/pages/Resumes/Upload.tsx`
- Modify: `frontend/src/pages/Resumes/List.tsx`
- Modify: `frontend/src/pages/Resumes/Detail.tsx`

**Consumes:** job repository and Queue producer.

**Produces:** `POST /api/resumes` returns `202`; `POST /api/resumes/:id/retry-processing` safely re-enqueues only failed/no-active jobs; no browser-initiated OCR or auto-evaluation.

- [ ] **Step 1: Write failing API/UI contract tests**

```ts
it('returns an accepted queued job without calling AI during upload', async () => {
  const response = await uploadResume(app, textPdfFixture);
  expect(response.status).toBe(202);
  expect(await response.json()).toMatchObject({ parse_status: 'queued' });
  expect(fakeQueue.sent).toHaveLength(1);
  expect(fakeAi.calls).toHaveLength(0);
});

it('does not enqueue a second active job on retry', async () => {
  await createActiveJob('resume-1');
  const response = await retryProcessing('resume-1');
  expect(response.status).toBe(200);
  expect(fakeQueue.sent).toHaveLength(0);
});
```

- [ ] **Step 2: Run the tests to verify failure**

Run: `cd worker && npm test -- resume-processing.test.ts`

Expected: FAIL because upload still calls AI/Bitable synchronously and retry endpoint is absent.

- [ ] **Step 3: Replace client-driven processing**

In `POST /api/resumes`, persist D1 resume/file first, create-or-get job, send Queue message, and return:

```ts
return c.json({ id: resumeId, job_id: job.id, parse_status: 'queued', detail: '简历已入队，正在后台处理' }, 202);
```

Delete the upload-time direct `callAI` block. Remove `mineruFlow`, upload-time `ocr_pending`, and list-load `auto-evaluate-all` calls; do not delete legacy endpoints until their callers are replaced. Add a retry endpoint that resets only a failed job to `queued`, clears only error fields, and sends its existing `jobId`.

- [ ] **Step 4: Update frontend status and polling**

Define one active set:

```ts
const ACTIVE_PARSE_STATUSES = new Set(['queued', 'extracting_text', 'extracting_fields', 'screening']);
```

Poll only while list rows contain an active status. Display the current status/error; Detail's retry button calls `/resumes/:id/retry-processing`. Do not make page load, refresh, or route navigation enqueue work.

- [ ] **Step 5: Run tests, typechecks, and build**

Run: `cd worker && npm test && npx tsc --noEmit`; then `cd frontend && npm run build`.

Expected: all tests and both TypeScript builds PASS.

- [ ] **Step 6: Commit**

```bash
git add worker/src/index.ts worker/tests/resume-processing.test.ts frontend/src/pages/Resumes/Upload.tsx frontend/src/pages/Resumes/List.tsx frontend/src/pages/Resumes/Detail.tsx
git commit -m "feat: make resume processing durable from upload"
```

## Task 6: Decouple Feishu sync and verify end-to-end behavior

**Files:**
- Modify: `worker/src/resume-consumer.ts`
- Modify: `worker/src/index.ts`
- Modify: `worker/wrangler.resume-consumer.toml`
- Modify: `worker/tests/resume-consumer.test.ts`
- Modify: `README.md`

**Consumes:** completed processing job and existing Bitable update helper.

**Produces:** Feishu failures are observable but do not change a successful AI result.

- [ ] **Step 1: Write failing sync-isolation tests**

```ts
it('keeps a completed AI result when Feishu writeback fails', async () => {
  const result = await processCompletedJob(fakeEnv({ syncFeishu: async () => { throw new Error('network'); } }));
  expect(result.resume.parse_status).toBe('ai_screened');
  expect(result.job.status).toBe('completed');
  expect(result.feishuSync.status).toBe('failed');
});
```

- [ ] **Step 2: Run the test to verify failure**

Run: `cd worker && npm test -- resume-consumer.test.ts`

Expected: FAIL because Feishu writeback is still inside the primary flow.

- [ ] **Step 3: Add a separate sync message type and status**

After primary completion, send `{ type: 'feishu-sync', resumeId }`. Handle it separately; write a sync error/status field or operation log and use retry/DLQ without changing `resume_processing_jobs.status` or `resumes.parse_status`.

- [ ] **Step 4: Run full verification**

Run: `cd worker && npm test && npx tsc --noEmit`; `cd frontend && npm run build`; run the pre-deploy check.

Expected: PASS. In staging, upload one text PDF and one scanned PDF, close the page, then reopen after completion; both rows show fields and AI results.

- [ ] **Step 5: Commit and document deployment steps**

```bash
git add worker/src/resume-consumer.ts worker/src/index.ts worker/wrangler.resume-consumer.toml worker/tests/resume-consumer.test.ts README.md
git commit -m "feat: decouple resume Feishu synchronization"
```

Document `wrangler queues create resume-processing`, consumer secret configuration, producer binding, DLQ monitoring, and the initial concurrency of 3.

## Plan self-review

- Spec coverage: Tasks 1–2 cover durable task identity/idempotency; Task 3 covers unified OCR/fields/screening; Task 4 covers Queue durability/concurrency; Task 5 removes browser task ownership; Task 6 isolates Feishu and validates the complete flow.
- Placeholder scan: no deferred implementation markers; each task names exact files, interfaces, tests, commands, and commit scope.
- Type consistency: every Queue payload is `{ jobId, resumeId }`; all processor/repository APIs accept IDs, never names; `queued/running/completed/failed/cancelled` are the only job statuses.
