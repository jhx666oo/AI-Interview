# Resume History Migration Implementation Plan

> Execution order: after R2 repositories and search-document generation work in staging. Migration must never invoke OCR or AI.

**Goal:** Copy existing PDFs, extracted text, and full AI analysis from D1 to R2 safely, verify integrity, create search documents, then reclaim D1 storage in reversible phases.

**Operating limits:** 25 resumes per batch, two concurrent object writes per consumer, pauseable flag, separate maintenance queue, no destructive cleanup until 100% verification plus a seven-day observation window.

## Task 1: Add per-artifact migration tracking

**Files:**
- Create: `worker/migrations/0019_resume_artifact_migrations.sql`
- Modify: `worker/schema.sql`
- Create: `worker/tests/resume-artifact-migration-schema.test.ts`

**Table:** `resume_artifact_migrations(resume_id, artifact_kind, source_column, source_sha256, target_artifact_id, status, attempt_count, error_code, started_at, verified_at, cleaned_at, updated_at, PRIMARY KEY(resume_id, artifact_kind))`.

- [ ] Add status constraint `pending|copying|copied|verified|cleaned|failed|skipped_empty` and indexes on `(status, updated_at)`.
- [ ] Add `resume_migration_runs(id, mode, status, cursor, totals_json, started_at, paused_at, completed_at)`.
- [ ] Test uniqueness, retries, and progress counts.
- [ ] Apply locally and run `cd worker && npm test -- resume-artifact-migration-schema.test.ts`.
- [ ] Commit: `feat: track historical resume artifact migration`.

## Task 2: Build a read-only inventory command

**Files:**
- Create: `scripts/audit-resume-storage.mjs`
- Create: `docs/runbooks/resume-storage-inventory.md`

- [ ] Query counts/bytes for Base64 PDFs, text columns, analysis columns, missing IDs, duplicates, and already-present R2 artifacts.
- [ ] Detect Base64 data-URL prefixes and estimate decoded bytes without printing contents.
- [ ] Group by artifact kind and status only; output JSON plus a Markdown summary without names, phone numbers, or resume text.
- [ ] Support `--local`, `--remote --env staging`, and `--remote --env production`; remote execution requires explicit operator approval.
- [ ] Run local inventory and attach the output path to the handoff.
- [ ] Commit: `chore: add resume storage inventory command`.

## Task 3: Add the isolated maintenance queue

**Files:**
- Create: `worker/src/resume-maintenance/types.ts`
- Create: `worker/src/resume-maintenance-consumer.ts`
- Create: `worker/wrangler.resume-maintenance.jsonc`
- Modify: `worker/wrangler.jsonc`
- Create: `worker/tests/resume-maintenance-consumer.test.ts`

**Queue:** `resume-maintenance`, DLQ `resume-maintenance-dlq`, max batch 25, max concurrency 1 at rollout; consumer-internal R2 concurrency 2.

- [ ] Define messages `migrate_artifacts`, `refresh_search_document`, `purge_deleted_artifacts`, and `cleanup_legacy_columns` with `schema_version: 1`.
- [ ] Test unknown messages, duplicate delivery, pause flag, poison messages, and partial batch failure.
- [ ] Production resume-processing queue must not be reused; maintenance backlog cannot delay fresh uploads.
- [ ] Configure max retries 5 and DLQ; generate types and run build.
- [ ] Run `cd worker && npm test -- resume-maintenance-consumer.test.ts && npm run build`.
- [ ] Commit: `feat: add isolated resume maintenance queue`.

## Task 4: Implement copy and cryptographic verification

**Files:**
- Create: `worker/src/resume-maintenance/migrate-artifacts.ts`
- Create: `worker/src/resume-maintenance/source-readers.ts`
- Create: `worker/tests/resume-artifact-migration.test.ts`

- [ ] Test Base64 PDF decoding, plain text, JSON/stringified analysis, malformed legacy data, empty source, existing identical target, and existing different target.
- [ ] Claim rows with compare-and-set; decode/read source, calculate source SHA-256, write through `ArtifactWriter`, read target back, and verify target SHA-256.
- [ ] Mark `verified` only when source and target hashes match. Mismatch is terminal `failed/hash_mismatch` and never overwrites an existing different target.
- [ ] Do not call MinerU, DeepSeek, or any other model. Migration copies existing facts only.
- [ ] After verified text/analysis, enqueue `refresh_search_document` using the separate maintenance queue.
- [ ] Run `cd worker && npm test -- resume-artifact-migration.test.ts`.
- [ ] Commit: `feat: migrate legacy resume artifacts to R2`.

## Task 5: Add operator controls and progress APIs

**Files:**
- Create: `worker/src/resume-maintenance/routes.ts`
- Modify: `worker/src/index.ts`
- Create: `worker/tests/resume-maintenance-routes.test.ts`

**Admin-only routes:**
- `POST /api/admin/resume-migration/dry-run`
- `POST /api/admin/resume-migration/start`
- `POST /api/admin/resume-migration/pause`
- `POST /api/admin/resume-migration/resume`
- `GET /api/admin/resume-migration/status`
- `POST /api/admin/resume-migration/retry-failed`

- [ ] Require admin role and an audit reason; mutating routes require `RESUME_BACKFILL_ENABLED=true`.
- [ ] Start selects only `pending/failed` rows and enqueues ID batches; it never scans/copies within the HTTP request.
- [ ] Status returns counts, bytes, oldest failure, queue estimate, and safe error codes—no PII.
- [ ] Pause stops new claims; in-flight object writes may finish safely.
- [ ] Run `cd worker && npm test -- resume-maintenance-routes.test.ts`.
- [ ] Commit: `feat: add resume migration operator controls`.

## Task 6: Reconcile migration completeness

**Files:**
- Create: `scripts/verify-resume-artifact-migration.mjs`
- Create: `worker/src/resume-maintenance/reconcile.ts`
- Create: `worker/tests/resume-migration-reconcile.test.ts`

- [ ] Compare eligible non-empty source cells, tracking rows, current artifact rows, actual R2 object existence, byte sizes, and hashes.
- [ ] Report orphan R2 objects and artifact rows separately; do not delete them automatically.
- [ ] Randomly re-download and hash at least 1% or 100 objects, whichever is larger, capped at 1,000 per run.
- [ ] Gate cleanup on: zero untracked eligible sources, zero failed/hash mismatch, all targets present, and search documents generated for all searchable active resumes.
- [ ] Run `cd worker && npm test -- resume-migration-reconcile.test.ts` and a staging reconciliation.
- [ ] Commit: `test: add resume migration reconciliation`.

## Task 7: Clean legacy D1 payloads in reversible phases

**Files:**
- Create: `worker/src/resume-maintenance/cleanup-legacy.ts`
- Create: `worker/tests/resume-legacy-cleanup.test.ts`
- Modify: `docs/runbooks/resume-storage-inventory.md`

- [ ] Phase A: after verification, enable R2 reads for seven days while retaining all D1 payloads.
- [ ] Phase B: export a protected D1 backup, record its identifier/time, then set verified legacy payload columns to `NULL` in batches of 25. Do not delete resume rows or projections.
- [ ] Each update requires `status='verified'`, matching recorded source hash, and `cleaned_at IS NULL`; mark `cleaned` in the same D1 batch.
- [ ] Never null candidate fields used for list, filters, permission, scores, statuses, or dashboard metrics.
- [ ] Rollback reads from the recorded D1 backup or R2; do not attempt to reconstruct from AI.
- [ ] Test wrong hash, missing target, interrupted batch, and rerun.
- [ ] Commit: `chore: clean verified legacy resume payloads`.

## Task 8: Execute staged migration waves

**Files:**
- Create: `docs/runbooks/resume-history-migration-execution.md`
- Modify: `README.md`

- [ ] Wave 0: local synthetic data, including corrupt and duplicate records.
- [ ] Wave 1: staging, 100 resumes, manual sample 20, reconciliation pass.
- [ ] Wave 2: production, 1% or 100 resumes, observe 24 hours.
- [ ] Wave 3: 10%, observe queue latency/error rate; pause if fresh processing p95 exceeds 10 minutes.
- [ ] Wave 4: remaining data, daily reconciliation, then seven-day read observation.
- [ ] Only after explicit production approval: backup and Phase B cleanup.
- [ ] Record run IDs, counts, bytes, hashes sampled, failures, retries, and flag states for every wave.
- [ ] Commit: `docs: add historical resume migration execution runbook`.

## Done criteria

- Every non-empty legacy payload is verified in R2 or explicitly classified as invalid/empty.
- No migration task invokes OCR or AI.
- Migration can pause/resume and is isolated from new-resume processing.
- D1 cleanup occurs only after backup, verification, and observation.
