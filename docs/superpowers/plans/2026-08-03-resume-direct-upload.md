# Resume Direct R2 Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace flagged browser PDF uploads with an idempotent two-phase direct-to-R2 protocol that creates the resume card immediately, supports batch progress, and enqueues processing only after server-side object verification.

**Architecture:** The authenticated API creates a resume, pending artifacts, and an upload session, then returns short-lived presigned PUT URLs for the PDF and optional browser-extracted text. The browser uploads directly to private R2 with bounded concurrency and calls a completion endpoint. Completion verifies R2 metadata, atomically marks artifacts available, creates the existing durable processing job, and sends one Queue message.

**Tech Stack:** Hono, D1, R2 S3 presigned URLs, `aws4fetch`, Cloudflare Queues, React 19, Axios, pdfjs-dist, Vitest.

## Global Constraints

- Complete the storage-foundation plan first.
- Keep `DIRECT_R2_UPLOAD=false` by default.
- Maximum PDF size is 20 MiB; only `application/pdf` is accepted.
- Maximum browser-extracted text sidecar is 512 KiB and uses `text/markdown; charset=utf-8`.
- Presigned URLs expire after 600 seconds and authorize one exact object key, HTTP method, Content-Type, and SHA-256 metadata header.
- Object keys never include original filename or candidate PII.
- The browser uploads at most four files concurrently.
- Processing Queue messages are created only after R2 HEAD verification.
- Repeating the completion request returns the original `job_id` and never creates a second active job.
- Abandoned pending uploads expire after 24 hours.
- Do not deploy CORS or create R2 API credentials without explicit infrastructure approval.

---

## File Structure

- `worker/migrations/0012_resume_upload_sessions.sql` — upload state and idempotency.
- `worker/schema.sql` — bootstrap parity.
- `worker/src/resume-uploads/types.ts` — request/response contracts.
- `worker/src/resume-uploads/presigner.ts` — `aws4fetch` PUT URL generation.
- `worker/src/resume-uploads/service.ts` — init, complete, fail, expire behavior.
- `worker/src/resume-uploads/routes.ts` — authenticated Hono route registration.
- `worker/src/resume-uploads/cleanup.ts` — abandoned-session cleanup.
- `worker/tests/resume-upload-session.test.ts` — service and route tests.
- `worker/tests/resume-upload-presigner.test.ts` — signature constraints.
- `infra/r2/resume-artifacts-cors.json` — exact browser CORS policy.
- `frontend/src/services/resumeUpload.ts` — hashing, init, PUT, complete client.
- `frontend/src/hooks/useBatchResumeUpload.ts` — four-slot batch scheduler and progress.
- `frontend/src/pages/Resumes/List.tsx` — use the new batch hook behind the feature response.
- `frontend/src/pages/Resumes/Upload.tsx` — use the same direct-upload service.
- `frontend/src/types/resumeUpload.ts` — frontend contracts.
- `frontend/src/utils/resumeUploadQueue.ts` — pure bounded-concurrency helper.
- `worker/src/index.ts` — environment typing and route registration only.
- `frontend/wrangler.jsonc` — public non-secret bucket/account vars and flags.
- `worker/package.json`, `worker/package-lock.json` — add `aws4fetch`.

## Task 1: Add upload-session state

**Files:**
- Create: `worker/migrations/0012_resume_upload_sessions.sql`
- Modify: `worker/schema.sql`
- Create: `worker/tests/resume-upload-session.test.ts`

**Interfaces:**
- Consumes: `resumes(id)` and `resume_artifacts(id)`.
- Produces: `resume_upload_sessions` with one session per resume.

- [ ] **Step 1: Write the failing schema test**

```ts
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('resume upload session schema', () => {
  it('keeps upload sessions idempotent and expirable', async () => {
    const sql = await readFile(resolve(process.cwd(), 'migrations/0012_resume_upload_sessions.sql'), 'utf8');
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS resume_upload_sessions/);
    expect(sql).toMatch(/resume_id TEXT NOT NULL UNIQUE/);
    expect(sql).toMatch(/idx_resume_upload_sessions_expiry/);
    expect(sql).toMatch(/'initiated','completed','expired','failed'/);
  });
});
```

- [ ] **Step 2: Run it and confirm failure**

Run: `cd worker && npm test -- resume-upload-session.test.ts`

Expected: FAIL because the migration is absent.

- [ ] **Step 3: Add the migration and schema parity**

```sql
CREATE TABLE IF NOT EXISTS resume_upload_sessions (
  id TEXT PRIMARY KEY,
  resume_id TEXT NOT NULL UNIQUE,
  pdf_artifact_id TEXT NOT NULL,
  text_artifact_id TEXT,
  created_by TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  expected_pdf_size INTEGER NOT NULL CHECK (expected_pdf_size > 0),
  expected_pdf_sha256 TEXT NOT NULL,
  expected_text_size INTEGER,
  expected_text_sha256 TEXT,
  status TEXT NOT NULL CHECK (status IN ('initiated','completed','expired','failed')),
  error_code TEXT,
  job_id TEXT,
  expires_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (resume_id) REFERENCES resumes(id),
  FOREIGN KEY (pdf_artifact_id) REFERENCES resume_artifacts(id),
  FOREIGN KEY (text_artifact_id) REFERENCES resume_artifacts(id),
  FOREIGN KEY (job_id) REFERENCES resume_processing_jobs(id)
);
CREATE INDEX IF NOT EXISTS idx_resume_upload_sessions_expiry
  ON resume_upload_sessions(status, expires_at);
```

Copy the definition into `worker/schema.sql` after `resume_artifacts` and `resume_processing_jobs` exist.

- [ ] **Step 4: Apply twice locally and run the test**

```bash
cd worker
npx wrangler d1 migrations apply ai-interview-db --local --config wrangler.jsonc
npx wrangler d1 migrations apply ai-interview-db --local --config wrangler.jsonc
npm test -- resume-upload-session.test.ts
```

Expected: PASS; no migration is reapplied.

- [ ] **Step 5: Commit**

```bash
git add worker/migrations/0012_resume_upload_sessions.sql worker/schema.sql worker/tests/resume-upload-session.test.ts
git commit -m "feat: add resume upload sessions"
```

## Task 2: Add strict upload contracts and validation

**Files:**
- Create: `worker/src/resume-uploads/types.ts`
- Modify: `worker/tests/resume-upload-session.test.ts`

**Interfaces:**
- Consumes: JSON request from authenticated frontend.
- Produces: `parseResumeUploadInit`, `ResumeUploadInitInput`, `ResumeUploadInitResponse`.

- [ ] **Step 1: Write failing validation tests**

```ts
import { parseResumeUploadInit } from '../src/resume-uploads/types';

it('accepts a PDF and optional text sidecar metadata', () => {
  expect(parseResumeUploadInit({
    file_name: 'candidate.pdf', file_size: 1000, file_sha256: 'a'.repeat(64),
    content_type: 'application/pdf', candidate_name: '候选人', position_id: 'p1',
    extracted_text_size: 20, extracted_text_sha256: 'b'.repeat(64),
  })).toMatchObject({ fileSize: 1000, hasExtractedText: true });
});

it.each([
  [{ file_name: 'x.exe', file_size: 100, file_sha256: 'a'.repeat(64), content_type: 'application/pdf' }, 'INVALID_FILE_EXTENSION'],
  [{ file_name: 'x.pdf', file_size: 20 * 1024 * 1024 + 1, file_sha256: 'a'.repeat(64), content_type: 'application/pdf' }, 'PDF_TOO_LARGE'],
  [{ file_name: 'x.pdf', file_size: 100, file_sha256: 'short', content_type: 'application/pdf' }, 'INVALID_SHA256'],
])('rejects invalid upload metadata', (input, code) => {
  expect(() => parseResumeUploadInit(input)).toThrow(code);
});
```

- [ ] **Step 2: Run it and confirm failure**

Run: `cd worker && npm test -- resume-upload-session.test.ts`

Expected: FAIL because validation is absent.

- [ ] **Step 3: Implement exact limits**

```ts
export const MAX_RESUME_PDF_BYTES = 20 * 1024 * 1024;
export const MAX_EXTRACTED_TEXT_BYTES = 512 * 1024;
const SHA256 = /^[a-f0-9]{64}$/i;

export function parseResumeUploadInit(value: unknown): ResumeUploadInitInput {
  const body = value as Record<string, unknown>;
  const fileName = String(body.file_name || '');
  const fileSize = Number(body.file_size);
  const fileSha256 = String(body.file_sha256 || '');
  if (!fileName.toLowerCase().endsWith('.pdf')) throw new Error('INVALID_FILE_EXTENSION');
  if (body.content_type !== 'application/pdf') throw new Error('INVALID_CONTENT_TYPE');
  if (!Number.isInteger(fileSize) || fileSize < 1 || fileSize > MAX_RESUME_PDF_BYTES) throw new Error('PDF_TOO_LARGE');
  if (!SHA256.test(fileSha256)) throw new Error('INVALID_SHA256');
  const textSize = body.extracted_text_size == null ? null : Number(body.extracted_text_size);
  const textHash = body.extracted_text_sha256 == null ? null : String(body.extracted_text_sha256);
  if ((textSize == null) !== (textHash == null)) throw new Error('INVALID_TEXT_METADATA');
  if (textSize != null && (!Number.isInteger(textSize) || textSize < 1 || textSize > MAX_EXTRACTED_TEXT_BYTES)) throw new Error('TEXT_TOO_LARGE');
  if (textHash != null && !SHA256.test(textHash)) throw new Error('INVALID_SHA256');
  return {
    fileName, fileSize, fileSha256, candidateName: String(body.candidate_name || ''),
    positionId: String(body.position_id || ''), hasExtractedText: textSize != null,
    extractedTextSize: textSize, extractedTextSha256: textHash,
  };
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `cd worker && npm test -- resume-upload-session.test.ts && npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/resume-uploads/types.ts worker/tests/resume-upload-session.test.ts
git commit -m "feat: validate direct resume uploads"
```

## Task 3: Generate constrained R2 PUT URLs

**Files:**
- Create: `worker/src/resume-uploads/presigner.ts`
- Create: `worker/tests/resume-upload-presigner.test.ts`
- Modify: `worker/package.json`
- Modify: `worker/package-lock.json`

**Interfaces:**
- Consumes: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` and exact object metadata.
- Produces: `createPresignedPutRequest(input, env): Promise<Request>`.

- [ ] **Step 1: Install the official documented lightweight signer**

```bash
cd worker
npm install aws4fetch
```

Expected: dependency and lockfile update.

- [ ] **Step 2: Write failing signature tests**

```ts
it('signs one PUT key for ten minutes with exact content headers', async () => {
  const request = await createPresignedPutRequest({
    objectKey: 'pdf/default/2026/08/r1/source-v1.pdf',
    contentType: 'application/pdf', sha256: 'a'.repeat(64), expiresSeconds: 600,
  }, testCredentials);
  expect(request.method).toBe('PUT');
  expect(request.headers.get('Content-Type')).toBe('application/pdf');
  expect(request.headers.get('x-amz-meta-sha256')).toBe('a'.repeat(64));
  expect(new URL(request.url).searchParams.get('X-Amz-Expires')).toBe('600');
  expect(request.url).toContain('/ai-interview-resume-artifacts/pdf/default/2026/08/r1/source-v1.pdf');
});
```

- [ ] **Step 3: Implement signing with `aws4fetch`**

```ts
import { AwsClient } from 'aws4fetch';

export async function createPresignedPutRequest(
  input: { objectKey: string; contentType: string; sha256: string; expiresSeconds: number },
  env: { R2_ACCOUNT_ID: string; R2_ACCESS_KEY_ID: string; R2_SECRET_ACCESS_KEY: string; R2_BUCKET_NAME: string },
): Promise<Request> {
  if (input.expiresSeconds !== 600) throw new Error('INVALID_UPLOAD_EXPIRY');
  const client = new AwsClient({
    service: 's3', region: 'auto', accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  });
  const endpoint = `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET_NAME}/${input.objectKey}`;
  const request = new Request(`${endpoint}?X-Amz-Expires=${input.expiresSeconds}`, {
    method: 'PUT',
    headers: { 'Content-Type': input.contentType, 'x-amz-meta-sha256': input.sha256 },
  });
  return client.sign(request, { aws: { signQuery: true } });
}
```

Never log the returned URL.

- [ ] **Step 4: Run tests**

Run: `cd worker && npm test -- resume-upload-presigner.test.ts && npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/package.json worker/package-lock.json worker/src/resume-uploads/presigner.ts worker/tests/resume-upload-presigner.test.ts
git commit -m "feat: sign direct R2 resume uploads"
```

## Task 4: Implement idempotent init and completion services

**Files:**
- Create: `worker/src/resume-uploads/service.ts`
- Modify: `worker/tests/resume-upload-session.test.ts`

**Interfaces:**
- Consumes: parsed upload input, authenticated actor, artifact repository, R2 HEAD, job repository, Queue producer.
- Produces: `initResumeUpload` and `completeResumeUpload`.

- [ ] **Step 1: Write failing service tests**

```ts
it('creates a visible uploading resume before returning URLs', async () => {
  const deps = createUploadDeps();
  const result = await initResumeUpload(validInit, { userId: 'u1', tenantId: 'default' }, deps);
  expect(deps.resumeWrites[0]).toMatchObject({ id: result.resumeId, parse_status: 'uploading' });
  expect(result.pdf.putUrl).toContain('X-Amz-Signature=');
  expect(deps.queueMessages).toHaveLength(0);
});

it('verifies objects before creating exactly one processing job', async () => {
  const deps = createUploadDeps({ pdfHead: { size: 1000, customMetadata: { sha256: 'a'.repeat(64) } } });
  const first = await completeResumeUpload('upload-1', { userId: 'u1', tenantId: 'default' }, deps);
  const second = await completeResumeUpload('upload-1', { userId: 'u1', tenantId: 'default' }, deps);
  expect(second.jobId).toBe(first.jobId);
  expect(deps.queueMessages).toEqual([{ jobId: first.jobId, resumeId: first.resumeId }]);
});

it('does not queue a size or hash mismatch', async () => {
  const deps = createUploadDeps({ pdfHead: { size: 999, customMetadata: { sha256: 'bad' } } });
  await expect(completeResumeUpload('upload-1', { userId: 'u1', tenantId: 'default' }, deps)).rejects.toThrow('UPLOAD_OBJECT_MISMATCH');
  expect(deps.queueMessages).toHaveLength(0);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `cd worker && npm test -- resume-upload-session.test.ts`

Expected: FAIL because services are absent.

- [ ] **Step 3: Implement init transaction boundaries**

`initResumeUpload` begins with:

```ts
const resumeId = crypto.randomUUID();
const uploadId = crypto.randomUUID();
const now = new Date();
const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
const pdfKey = buildResumeArtifactKey({ tenantId: actor.tenantId, resumeId, type: 'pdf', version: 1, createdAt: now });
```

Use one `DB.batch()` to insert the `resumes` row, pending PDF artifact, optional pending OCR artifact, and upload session. Generate presigned URLs only after the batch succeeds. If signing fails, mark the session failed and do not return an upload URL.

- [ ] **Step 4: Implement completion state transition**

Completion must:

1. Load session by `id` and `created_by`; reject other users with 404.
2. Return stored response when `status='completed'`.
3. Reject expired or failed sessions.
4. HEAD PDF and optional text object through `RESUME_ARTIFACTS`.
5. Compare exact size and `customMetadata.sha256`.
6. Call `createOrGetActiveJob(DB, resume_id)`.
7. Batch-update artifacts to `available`, session to `completed`, resume to `queued`.
8. Send `{ jobId, resumeId }` with `contentType: 'json'`.
9. If Queue send fails, restore session to `initiated`, leave objects available, and allow completion retry.

The Queue rollback update is conditional on `job_id` and must not delete the resume or R2 objects.

- [ ] **Step 5: Run focused and existing queue tests**

```bash
cd worker
npm test -- resume-upload-session.test.ts resume-processing.test.ts resume-consumer.test.ts
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add worker/src/resume-uploads/service.ts worker/tests/resume-upload-session.test.ts
git commit -m "feat: complete verified resume uploads"
```

## Task 5: Register authenticated upload routes and cleanup

**Files:**
- Create: `worker/src/resume-uploads/routes.ts`
- Create: `worker/src/resume-uploads/cleanup.ts`
- Modify: `worker/src/index.ts`
- Modify: `worker/tests/resume-upload-session.test.ts`

**Interfaces:**
- Consumes: current JWT user from `c.get('user')` and feature flags.
- Produces: init/complete endpoints and `cleanupExpiredUploads`.

- [ ] **Step 1: Write route authorization tests**

```ts
it('returns 404 for another user upload id', async () => {
  const response = await testApp.request('/api/resumes/uploads/upload-1/complete', {
    method: 'POST', headers: authHeadersFor('u2'),
  });
  expect(response.status).toBe(404);
});

it('returns 503 when direct upload is disabled', async () => {
  const response = await disabledApp.request('/api/resumes/uploads/init', {
    method: 'POST', headers: authHeadersFor('u1'), body: JSON.stringify(validBody),
  });
  expect(response.status).toBe(503);
});
```

- [ ] **Step 2: Register routes without adding business logic to `index.ts`**

```ts
export function registerResumeUploadRoutes(app: Hono<AppEnv>) {
  app.post('/api/resumes/uploads/init', authMiddleware, async (c) => {
    if (!readResumeFeatureFlags(c.env).directR2Upload) return c.json({ detail: 'DIRECT_UPLOAD_DISABLED' }, 503);
    const input = parseResumeUploadInit(await c.req.json());
    return c.json(await initResumeUpload(input, actorFromContext(c), depsFromContext(c)), 201);
  });

  app.post('/api/resumes/uploads/:uploadId/complete', authMiddleware, async (c) => {
    if (!readResumeFeatureFlags(c.env).directR2Upload) return c.json({ detail: 'DIRECT_UPLOAD_DISABLED' }, 503);
    return c.json(await completeResumeUpload(c.req.param('uploadId'), actorFromContext(c), depsFromContext(c)), 202);
  });
}
```

`worker/src/index.ts` imports and calls `registerResumeUploadRoutes(app)` once.

- [ ] **Step 3: Implement abandoned-upload cleanup**

```ts
export async function cleanupExpiredUploads(db: D1Database, store: ResumeArtifactStore, nowIso: string) {
  const sessions = await db.prepare(
    `SELECT s.id, s.resume_id, a.id artifact_id, a.object_key
     FROM resume_upload_sessions s JOIN resume_artifacts a ON a.resume_id=s.resume_id
     WHERE s.status='initiated' AND s.expires_at < ? AND a.status='pending' LIMIT 100`,
  ).bind(nowIso).all<ExpiredUploadRow>();
  for (const row of sessions.results) {
    await store.delete(row.object_key).catch(() => undefined);
    await db.batch([
      db.prepare("UPDATE resume_artifacts SET status='deleted', deleted_at=? WHERE id=? AND status='pending'").bind(nowIso, row.artifact_id),
      db.prepare("UPDATE resume_upload_sessions SET status='expired', updated_at=? WHERE id=? AND status='initiated'").bind(nowIso, row.id),
      db.prepare("UPDATE resumes SET parse_status='upload_failed', parse_error='UPLOAD_EXPIRED', updated_at=? WHERE id=? AND parse_status='uploading'").bind(nowIso, row.resume_id),
    ]);
  }
  return sessions.results.length;
}
```

Wire it to an existing safe cron/maintenance route, not `waitUntil`. Process at most 100 sessions per run.

- [ ] **Step 4: Run tests and commit**

```bash
cd worker
npm test -- resume-upload-session.test.ts
npm test
npx tsc --noEmit
git add worker/src/resume-uploads/routes.ts worker/src/resume-uploads/cleanup.ts worker/src/index.ts worker/tests/resume-upload-session.test.ts
git commit -m "feat: expose durable resume upload routes"
```

Expected: PASS.

## Task 6: Add browser hashing and one-file direct upload

**Files:**
- Create: `frontend/src/types/resumeUpload.ts`
- Create: `frontend/src/services/resumeUpload.ts`
- Modify: `frontend/src/pages/Resumes/Upload.tsx`
- Modify: `frontend/src/pages/Resumes/List.tsx`

**Interfaces:**
- Consumes: PDF `File`, optional extracted text, selected position, candidate name.
- Produces: `uploadResumeDirect(input, onProgress): Promise<CompletedResumeUpload>`.

- [ ] **Step 1: Implement pure SHA-256 and API contracts**

```ts
export async function sha256Hex(data: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await data.arrayBuffer());
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
```

Define the init response exactly:

```ts
export interface DirectUploadTarget {
  object_key: string;
  put_url: string;
  content_type: string;
  sha256: string;
}
export interface ResumeUploadInitResponse {
  upload_id: string;
  resume_id: string;
  expires_at: string;
  pdf: DirectUploadTarget;
  extracted_text: DirectUploadTarget | null;
}
```

- [ ] **Step 2: Implement init, PUT, and complete in one service**

```ts
await axios.put(target.put_url, blob, {
  headers: {
    'Content-Type': target.content_type,
    'x-amz-meta-sha256': target.sha256,
  },
  onUploadProgress: event => onProgress(event.total ? event.loaded / event.total : 0),
});
```

Never send the application JWT to the R2 URL. The JWT is used only for `/api/resumes/uploads/*` calls.

- [ ] **Step 3: Preserve the old flow behind server capability**

The UI first calls init. If it returns `503 DIRECT_UPLOAD_DISABLED`, call the existing multipart upload function. Do not fallback to legacy upload for any other error, because doing so could create a duplicate resume after a partial R2 upload.

- [ ] **Step 4: Build and manually verify one file**

```bash
cd frontend
npm run build
```

Expected: build PASS. With local flag enabled, upload one text PDF; the card appears as `uploading`, progresses to `queued`, and no Authorization header is present on the R2 PUT request.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types/resumeUpload.ts frontend/src/services/resumeUpload.ts frontend/src/pages/Resumes/Upload.tsx frontend/src/pages/Resumes/List.tsx
git commit -m "feat: upload resumes directly to R2"
```

## Task 7: Add bounded batch upload and visible per-file states

**Files:**
- Create: `frontend/src/utils/resumeUploadQueue.ts`
- Create: `frontend/src/utils/resumeUploadQueue.test.ts`
- Create: `frontend/src/hooks/useBatchResumeUpload.ts`
- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json`
- Modify: `frontend/src/pages/Resumes/List.tsx`

**Interfaces:**
- Consumes: `UploadCandidate[]` and a worker callback.
- Produces: at most four concurrent uploads and independent `hashing/init/uploading/completing/queued/failed` states.

- [ ] **Step 1: Add frontend Vitest and write the pure concurrency test**

Add `vitest` as a frontend dev dependency and add `"test": "vitest run"` to `frontend/package.json`. Keep the helper dependency-free. Test contract in `frontend/src/utils/resumeUploadQueue.test.ts`:

```ts
it('never runs more than four uploads concurrently', async () => {
  let active = 0;
  let peak = 0;
  await runWithConcurrencyLimit(Array.from({ length: 20 }, (_, id) => id), 4, async () => {
    active += 1;
    peak = Math.max(peak, active);
    await Promise.resolve();
    active -= 1;
  });
  expect(peak).toBe(4);
});
```

- [ ] **Step 2: Implement the scheduler**

```ts
export async function runWithConcurrencyLimit<T>(items: T[], limit: number, work: (item: T) => Promise<void>) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      if (item !== undefined) await work(item);
    }
  });
  await Promise.all(workers);
}
```

- [ ] **Step 3: Implement the hook and UI states**

`useBatchResumeUpload` calls `runWithConcurrencyLimit(files, 4, uploadOne)`. Insert the returned `resume_id` into the list as soon as init succeeds. A failed file shows its error and retry button without clearing completed files.

- [ ] **Step 4: Verify a 20-file local batch**

```bash
cd frontend && npm test -- resumeUploadQueue.test.ts && npm run build
cd ../worker && npm test -- resume-upload-session.test.ts
```

Expected: tests/build PASS; browser Network panel never shows more than four simultaneous R2 PUTs.

- [ ] **Step 5: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/utils/resumeUploadQueue.ts frontend/src/utils/resumeUploadQueue.test.ts frontend/src/hooks/useBatchResumeUpload.ts frontend/src/pages/Resumes/List.tsx
git commit -m "feat: add bounded batch resume uploads"
```

## Task 8: Add and verify the exact R2 CORS policy

**Files:**
- Create: `infra/r2/resume-artifacts-cors.json`
- Modify: `README.md`

**Interfaces:**
- Consumes: current production origin and localhost.
- Produces: PUT-only browser access to presigned URLs.

- [ ] **Step 1: Create the policy file**

```json
{
  "rules": [
    {
      "allowed": {
        "origins": [
          "https://ai-interview-88r.pages.dev",
          "http://localhost:5173"
        ],
        "methods": ["PUT"],
        "headers": ["Content-Type", "x-amz-meta-sha256"]
      },
      "exposeHeaders": ["ETag"],
      "maxAgeSeconds": 3600
    }
  ]
}
```

- [ ] **Step 2: Validate but do not apply without approval**

```bash
python3 -m json.tool infra/r2/resume-artifacts-cors.json
npx wrangler r2 bucket cors list ai-interview-resume-artifacts
```

Expected: JSON valid; list command is read-only. Applying the policy is a separate approved infrastructure action:

```bash
npx wrangler r2 bucket cors set ai-interview-resume-artifacts --file infra/r2/resume-artifacts-cors.json
```

- [ ] **Step 3: After approved staging application, verify preflight**

```bash
curl -i -X OPTIONS 'SIGNED_STAGING_PUT_URL' \
  -H 'Origin: http://localhost:5173' \
  -H 'Access-Control-Request-Method: PUT' \
  -H 'Access-Control-Request-Headers: content-type,x-amz-meta-sha256'
```

Expected: `Access-Control-Allow-Origin: http://localhost:5173`, method PUT, and both allowed headers. Substitute a freshly generated staging URL only in the local shell; never save it in the repository or logs.

- [ ] **Step 4: Commit policy and docs**

```bash
git add infra/r2/resume-artifacts-cors.json README.md
git commit -m "docs: define resume R2 upload policy"
```

## Plan Completion Gate

- [ ] All flags false preserves the existing upload path.
- [ ] With local/staging direct upload enabled, resume records appear before file completion.
- [ ] A failed or abandoned upload creates no Queue processing message.
- [ ] Repeating complete creates one job and one Queue message.
- [ ] Browser upload concurrency never exceeds four.
- [ ] No application Authorization header reaches R2.
- [ ] No new flagged upload writes `resume_files.content`.
- [ ] Production CORS, credentials, flags, migrations, and deployment remain unchanged until approved.
