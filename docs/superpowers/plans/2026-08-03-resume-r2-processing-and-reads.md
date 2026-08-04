# Resume R2 Processing and Read-Path Implementation Plan

> Execution order: run after `2026-08-03-resume-storage-foundation.md` and `2026-08-03-resume-direct-upload.md`. Keep all new flags off until Task 8.

**Goal:** Make background processing independent of the browser, store OCR text and full AI analysis in R2, keep only queryable projections in D1, and make list/detail APIs fast and backward-compatible.

**Architecture:** The queue consumer reads source artifacts from R2 and writes immutable versioned text/analysis artifacts. Repositories hide R2-versus-legacy-D1 details. Detail endpoints authorize in D1 before returning artifacts; list endpoints use SQL filtering and never fetch large text columns.

**Stack:** Cloudflare Workers, Queues, R2, D1, Hono, TypeScript, Vitest.

## Frozen contracts

```ts
export interface ResumeTextRepository {
  getCurrent(resumeId: string): Promise<{ text: string; artifactId?: string; source: 'r2' | 'legacy_d1' } | null>;
  putVersion(input: { resumeId: string; text: string; source: string; version: number }): Promise<string>;
}

export interface ResumeAnalysisRepository {
  getCurrent(resumeId: string): Promise<Record<string, unknown> | null>;
  putVersion(input: { resumeId: string; analysis: Record<string, unknown>; model: string; promptVersion: string; version: number }): Promise<string>;
}
```

Artifact routes return content, never an R2 key. Every route first resolves the resume through the existing authorization scope.

## Task 1: Add deterministic artifact hashing and writes

**Files:**
- Create: `worker/src/resume-storage/hash.ts`
- Create: `worker/src/resume-storage/artifact-writer.ts`
- Create: `worker/tests/resume-artifact-writer.test.ts`

- [ ] Write failing tests for stable SHA-256, idempotent repeated writes, and hash mismatch rejection.
- [ ] Implement Web Crypto hashing and `put()` with `httpMetadata.contentType` and custom metadata `resume-id`, `kind`, `version`, `sha256`.
- [ ] Upsert the `resume_artifacts` row only after R2 `put()` succeeds; repeated `(resume_id, kind, version)` returns the existing artifact.
- [ ] Run `cd worker && npm test -- resume-artifact-writer.test.ts`.
- [ ] Commit: `feat: add idempotent resume artifact writer`.

## Task 2: Implement R2-first text and analysis repositories

**Files:**
- Create: `worker/src/resume-storage/text-repository.ts`
- Create: `worker/src/resume-storage/analysis-repository.ts`
- Create: `worker/tests/resume-artifact-repositories.test.ts`

- [ ] Test R2 current-version reads, missing-object behavior, corrupt-hash behavior, and legacy fallback.
- [ ] `ResumeTextRepository.getCurrent()` resolves the current `resume_artifacts` row, verifies SHA-256, then falls back in this exact order: `resume_files.extracted_text`, `resumes.raw_text`, `resumes.resume_text`.
- [ ] `ResumeAnalysisRepository.getCurrent()` reads current `ai_analysis` JSON, validates that the root is an object, and falls back to `resumes.ai_evaluation`/`ai_review` normalization.
- [ ] `putVersion()` writes the object, records byte size/hash/content type, and marks the new version current in one D1 batch.
- [ ] Run `cd worker && npm test -- resume-artifact-repositories.test.ts`.
- [ ] Commit: `feat: add R2-first resume repositories`.

## Task 3: Route queue processing through R2 repositories

**Files:**
- Modify: `worker/src/resume-processing/ocr.ts`
- Modify: `worker/src/resume-processing/processor.ts`
- Modify: `worker/src/resume-consumer.ts`
- Create: `worker/tests/resume-r2-processing.test.ts`

- [ ] Test a direct-uploaded text PDF, a scanned PDF that requires MinerU, a retry after AI success, and a retry after partial R2 write.
- [ ] Consumer loads the `pdf` artifact from R2; browser-extracted text, when present, is treated as an input hint and persisted as a versioned `ocr` artifact.
- [ ] OCR writes normalized UTF-8 text to R2 before moving state from `ocr_processing` to `pending_screening`.
- [ ] AI screening reads through `ResumeTextRepository`, writes complete raw/normalized analysis to R2, then updates only structured list/filter columns in `resumes`.
- [ ] Every state transition uses compare-and-set (`WHERE id=? AND processing_version=? AND parse_status=?`) so stale retries cannot overwrite newer results.
- [ ] A queue message is acknowledged only after artifact and D1 projection commits; transient external errors throw for retry, validation errors become terminal `failed` with a safe error code.
- [ ] Run `cd worker && npm test -- resume-r2-processing.test.ts resume-processing-state-machine.test.ts`.
- [ ] Commit: `refactor: process resume artifacts through R2`.

## Task 4: Replace every long-text direct read

**Files:**
- Modify: `worker/src/index.ts`
- Modify: modules under `worker/src/resume-processing/`
- Create: `worker/tests/resume-text-call-sites.test.ts`

- [ ] Add contract tests for reparse, hard-rule evaluation, capability scoring, ranking, interview report generation, and batch evaluation using repository-provided text.
- [ ] Replace all business-path reads of `raw_text`, `resume_text`, `extracted_text`, `ai_evaluation`, and `ai_review` with repository calls.
- [ ] Keep legacy-column access only inside repository fallback and migration code.
- [ ] Run the audit gate:

```bash
rg -n "raw_text|resume_text|extracted_text|ai_evaluation|ai_review" worker/src
```

Expected: each remaining hit is a projection write, explicit legacy fallback, schema adapter, or migration helper; document every allowed hit in the test.

- [ ] Run `cd worker && npm test`.
- [ ] Commit: `refactor: centralize resume text and analysis reads`.

## Task 5: Add authorized artifact detail routes

**Files:**
- Create: `worker/src/resume-artifacts/routes.ts`
- Create: `worker/src/resume-artifacts/authorization.ts`
- Modify: `worker/src/index.ts`
- Create: `worker/tests/resume-artifact-routes.test.ts`

**Routes:**
- `GET /api/resumes/:id/text` → `{ text, source, version }`
- `GET /api/resumes/:id/analysis` → `{ analysis, version, model, prompt_version }`
- `GET /api/resumes/:id/file` → streamed PDF with private cache headers

- [ ] Test admin access, assigned-HR access, unrelated-HR 404, missing artifact, legacy fallback, and response key leakage.
- [ ] Reuse the same D1 scope resolver as resume detail; return 404 rather than revealing forbidden IDs.
- [ ] Stream R2 bodies; do not Base64 encode PDFs and do not return bucket/object-key fields.
- [ ] Set `Cache-Control: private, no-store`, `Content-Disposition: inline`, and `X-Content-Type-Options: nosniff`.
- [ ] Run `cd worker && npm test -- resume-artifact-routes.test.ts`.
- [ ] Commit: `feat: add authorized resume artifact routes`.

## Task 6: Make the resume list a true SQL query

**Files:**
- Create: `worker/src/resumes/list-query.ts`
- Modify: `worker/src/index.ts`
- Modify: `frontend/src/services/resume.ts`
- Modify: `frontend/src/pages/Resumes/List.tsx`
- Create: `worker/tests/resume-list-query.test.ts`

**Request:** `GET /api/resumes?page=1&page_size=20&position_id=&status=&gender=&age_min=&age_max=&score_min=&sort=created_at_desc`.

**Response:** `{ items, page, page_size, total, processing_count }`.

- [ ] Test SQL pagination, all current filters, access scope, newest-first ordering, and that generated SQL never selects long-text columns.
- [ ] Add these exact indexes in `worker/migrations/0013_resume_list_indexes.sql` and mirror them in `worker/schema.sql`: `idx_resumes_created_at_desc ON resumes(created_at DESC)`, `idx_resumes_parse_status_created ON resumes(parse_status, created_at DESC)`, `idx_resumes_position_created ON resumes(position_id, created_at DESC)`, `idx_resumes_match_score ON resumes(match_score)`, `idx_resumes_gender ON resumes(gender)`, and `idx_resumes_birthday ON resumes(birthday)`. The stable HR ownership index is added with `positions.responsible_user_id` in the search plan.
- [ ] Replace in-memory full-table filtering/slicing with parameterized SQL plus a separate `COUNT(*)` query.
- [ ] Preserve a compatibility adapter in the frontend for one release, then consume `items` directly.
- [ ] Run `cd worker && npm test -- resume-list-query.test.ts && cd ../frontend && npm run build`.
- [ ] Commit: `perf: paginate resume list in D1`.

## Task 7: Add artifact-aware soft deletion

**Files:**
- Create: `worker/migrations/0014_resume_soft_delete.sql`
- Modify: `worker/schema.sql`
- Create: `worker/src/resume-storage/deletion.ts`
- Modify: `worker/src/index.ts`
- Create: `worker/tests/resume-deletion.test.ts`

- [ ] Add `resumes.deleted_at`, `resume_artifacts.deleted_at`, and `resume_upload_sessions.deleted_at`; index active resume queries.
- [ ] Test that delete immediately removes a resume from list/detail/search eligibility and is idempotent.
- [ ] `DELETE /api/resumes/:id` marks all three entities deleted in a D1 batch and returns only after that transaction succeeds.
- [ ] Do not physically delete R2 objects here; production maintenance handles deferred purge so a mistaken deletion can be recovered during the retention window.
- [ ] Add `deleted_at IS NULL` to every resume query and queue processor claim.
- [ ] Run `cd worker && npm test -- resume-deletion.test.ts resume-list-query.test.ts`.
- [ ] Commit: `feat: add soft deletion for resume artifacts`.

## Task 8: Integrate behind flags and verify end to end

**Files:**
- Modify: `worker/src/config/feature-flags.ts`
- Modify: `frontend/src/config/features.ts`
- Modify: `README.md`

- [ ] With flags off, run the complete baseline suite and confirm old upload/detail behavior remains usable.
- [ ] Enable `R2_ARTIFACT_READ=true`, `R2_ARTIFACT_WRITE=true`, and `RESUME_SQL_LIST=true` locally.
- [ ] Upload one text PDF and one scanned PDF; leave the page immediately. Confirm queue completion, R2 artifacts, card fields, detail text/analysis, and newest-first sorting.
- [ ] Retry the same queue message and confirm one current artifact per kind/version and no duplicate AI invocation.
- [ ] Run:

```bash
cd worker && npm test && npm run build
cd ../frontend && npm test && npm run build
```

- [ ] Record object keys, artifact IDs, D1 row IDs, timings, and redacted logs in the handoff.
- [ ] Commit: `docs: verify R2 resume processing and reads`.

## Done criteria

- Browser navigation has no effect on processing completion.
- List endpoint does not read PDF, OCR text, or full AI JSON.
- All protected artifact routes enforce D1 scope before R2 access.
- Queue retries are idempotent and cannot overwrite newer processing versions.
- Legacy rows remain readable until the migration plan completes.
