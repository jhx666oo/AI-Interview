# Resume Architecture Production Hardening and Rollout Plan

> Execute last. Every production mutation in this plan requires explicit approval and a recorded rollback point.

**Goal:** Prove the new architecture can safely handle present volume and grow from 500 resumes/day toward 10,000/day, with bounded external-AI concurrency, retention controls, monitoring, recovery, and predictable cost.

**Primary risk:** Cloudflare edge ingress is not the limiting factor. OCR/model rate limits, queue backlog, D1 query patterns, and unbounded retries are the limiting factors; capacity gates therefore focus on those systems.

## Service objectives

- Upload init/complete API: p95 <500ms excluding direct R2 PUT.
- Resume list API: p95 <800ms for 20-card page.
- Search API: p95 <2s; safe exact-filter fallback on search failure.
- Fresh text PDF: 95% reaches terminal AI state within 5 minutes.
- Scanned PDF: 95% reaches terminal state within 15 minutes, subject to MinerU availability.
- Queue oldest-message age alert: warning 5 minutes, critical 15 minutes.
- No cross-user data exposure; no lost acknowledged queue message; no duplicate paid AI call for the same processing version.

## Task 1: Add production retention configuration

**Files:**
- Create: `infra/r2/resume-artifacts-lifecycle.json`
- Create: `docs/runbooks/resume-retention.md`
- Modify: `README.md`

**Lifecycle file:**

```json
{
  "Rules": [
    {
      "ID": "expire-original-resume-pdfs-after-60-days",
      "Status": "Enabled",
      "Filter": { "Prefix": "pdf/" },
      "Expiration": { "Days": 60 }
    },
    {
      "ID": "abort-incomplete-resume-uploads-after-one-day",
      "Status": "Enabled",
      "Filter": { "Prefix": "pdf/" },
      "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 1 }
    }
  ]
}
```

- [ ] Confirm legal/product retention: original PDFs 60 days; OCR text, structured fields, AI analysis, interview events, and aggregate metrics retained until candidate deletion policy applies.
- [ ] Apply in staging with `npx wrangler r2 bucket lifecycle set ai-interview-resume-artifacts-staging --file infra/r2/resume-artifacts-lifecycle.json`.
- [ ] Verify using `npx wrangler r2 bucket lifecycle list ai-interview-resume-artifacts-staging` and inspect `x-amz-expiration` on a new `pdf/` object.
- [ ] Document that lifecycle deletion is asynchronous and may take roughly 24 hours after expiry.
- [ ] Production application command must be run only after explicit approval.
- [ ] Commit: `chore: define resume artifact retention policy`.

## Task 2: Complete deferred purge and privacy deletion

**Files:**
- Create: `worker/migrations/0020_resume_purge_jobs.sql`
- Modify: `worker/schema.sql`
- Create: `worker/src/resume-maintenance/purge-deleted.ts`
- Modify: `worker/src/resume-maintenance-consumer.ts`
- Create: `worker/tests/resume-purge.test.ts`

- [ ] Add purge job state with `resume_id`, `not_before`, `status`, attempts, error code, and completion time.
- [ ] Normal delete has a 7-day recoverable window. Privacy/authorized erasure uses `not_before=now` and records the actor/reason in the audit log.
- [ ] Purger lists all tracked object keys for the resume, deletes R2 objects, verifies absence, deletes search document/state, redacts candidate PII and long payloads, and preserves only anonymous aggregate events where policy permits.
- [ ] A missing object counts as success; partial failure retries only unfinished objects.
- [ ] Test restore-before-purge, immediate privacy purge, idempotent rerun, and R2 failure.
- [ ] Run `cd worker && npm test -- resume-purge.test.ts`.
- [ ] Commit: `feat: add durable resume artifact purge`.

## Task 3: Configure queue resilience and backpressure

**Files:**
- Modify: `worker/wrangler.resume-consumer.jsonc`
- Modify: `worker/wrangler.resume-maintenance.jsonc`
- Create: `worker/src/resume-processing/backpressure.ts`
- Create: `worker/src/resume-processing/dlq.ts`
- Create: `worker/tests/resume-queue-resilience.test.ts`

- [ ] Production processing queue uses small batches, explicit acknowledgements, bounded concurrency, `max_retries`, `retry_delay`, and a DLQ. Maintenance queue has its own DLQ.
- [ ] Start AI concurrency at 3 per consumer deployment. On 429/5xx, call `message.retry({ delaySeconds })` with capped exponential backoff and jitter; do not spin in one invocation.
- [ ] Classify failures: retryable external error, terminal invalid input, configuration error, and operator retry. Persist safe codes in D1.
- [ ] Add an admin-only DLQ replay path that creates a new message with the same idempotency key and audit reason; never blindly purge a DLQ.
- [ ] Test mixed batch success, 429 retry delay, terminal ack, stale processing version, and DLQ replay.
- [ ] Run `cd worker && npm test -- resume-queue-resilience.test.ts resume-r2-processing.test.ts`.
- [ ] Commit: `feat: add resume queue backpressure and DLQ recovery`.

## Task 4: Add privacy-safe observability and health endpoints

**Files:**
- Create: `worker/src/observability/resume-logger.ts`
- Create: `worker/src/observability/resume-metrics.ts`
- Create: `worker/src/observability/resume-health.ts`
- Modify: `worker/src/index.ts`
- Create: `worker/tests/resume-observability.test.ts`

**Admin endpoints:**
- `GET /api/admin/resume-processing/health`
- `GET /api/admin/resume-search/health`
- `GET /api/admin/resume-storage/health`

- [ ] Emit correlation ID, resume ID, processing version, stage, attempt, latency, provider, outcome, and safe error code. Never log candidate name, phone, email, OCR body, prompts, signed URLs, secrets, or full AI output.
- [ ] Health aggregates D1 processing states, oldest queued/processing timestamps, recent failure rate, migration state, search-document backlog, and artifact mismatch count.
- [ ] Add alerts/runbook conditions: oldest age >5m/>15m, failure rate >5% for 10m, DLQ >0, search indexing lag >30m, hash mismatch >0, and D1 5xx >1%.
- [ ] Test response authorization and log redaction with representative PII strings.
- [ ] Run `cd worker && npm test -- resume-observability.test.ts`.
- [ ] Commit: `feat: add resume pipeline health and safe telemetry`.

## Task 5: Add repeatable load and soak tests

**Files:**
- Create: `scripts/load-test-resume-api.mjs`
- Create: `scripts/generate-synthetic-resumes.mjs`
- Create: `docs/runbooks/resume-load-test.md`
- Create: `worker/tests/resume-load-contract.test.ts`

- [ ] Generate synthetic PDFs/text only; never use production resumes. Include 80% text PDFs and 20% generated image-only PDF fixtures, sized 100KiB–10MiB.
- [ ] Scenarios: 20-file single-user burst, 50 users × 20 init/complete requests over 10 minutes, 500/day steady simulation, and 10,000/day queue-capacity model.
- [ ] Load script measures init/complete/list/search latency, HTTP errors, duplicate resume IDs, queue completion latency, and external provider calls per processing version.
- [ ] Staging test must stub paid OCR/AI unless a capped explicit budget is approved; a separate five-file real-provider smoke test verifies integration.
- [ ] Pass gates: no 5xx above 1%, no lost/duplicate terminal records, list p95 <800ms, API p95 <500ms, queue drains within 15 minutes after burst, D1 busy/locked errors zero.
- [ ] Run contract tests locally, then staging soak for two hours.
- [ ] Commit: `test: add resume pipeline load and soak tests`.

## Task 6: Establish cost budgets and scale triggers

**Files:**
- Create: `docs/runbooks/resume-capacity-and-cost.md`
- Create: `scripts/estimate-resume-cost.mjs`

- [ ] Parameterize daily resumes, average PDF/text/analysis bytes, OCR percentage, AI tokens, retries, retention days, search-document count, and provider unit prices.
- [ ] Produce low/current/high scenarios for 500, 3,000, and 10,000 resumes/day. Separate Cloudflare storage/operations, AI Search, OCR, model tokens, and observability costs.
- [ ] Pull current provider prices immediately before budgeting and record source URL/date; AI Search is open beta and future price must be represented as `unknown`, not zero forever.
- [ ] Add budget alerts at 70%, 90%, and 100%; at 100%, stop automatic retries/bulk backfills before stopping ordinary user uploads.
- [ ] Define scale triggers:
  - D1 list/search p95 >800ms for 7 days after query/index tuning → evaluate PostgreSQL.
  - D1 database approaches plan storage/read limits → archive or migrate.
  - AI Search reaches 400,000 files → create the next sharded instance before 500,000.
  - OCR/AI backlog >15m → raise provider quota or bounded consumer concurrency after rate-limit test.
- [ ] Commit: `docs: add resume capacity and cost model`.

## Task 7: Run security and failure-recovery review

**Files:**
- Create: `worker/tests/resume-security-regression.test.ts`
- Create: `docs/runbooks/resume-disaster-recovery.md`
- Modify: `scripts/pre-deploy-check.mjs`

- [ ] Test presigned URL expiry, wrong content type/size, key tampering, replayed complete, unauthorized artifact/search/admin access, SQL filter injection, oversized query, deleted resume access, and PII-free logs.
- [ ] Test failure drills: AI outage, MinerU outage, R2 unavailable, D1 unavailable, queue backlog, corrupted artifact, AI Search unavailable, and accidental feature-flag rollback.
- [ ] Document recovery order: disable new feature path, preserve ingestion, pause maintenance, inspect health/DLQ, retry idempotently, reconcile artifacts, then restore flags.
- [ ] Add database backup/export and R2 inventory procedures. Never prescribe deleting production data as a recovery step.
- [ ] `pre-deploy-check` must run worker tests/typecheck/build, frontend tests/build, migration ordering check, secret scan, config validation, and generated Worker types check.
- [ ] Commit: `test: add resume security and disaster recovery gates`.

## Task 8: Execute staged production rollout

**Files:**
- Create: `docs/runbooks/resume-production-rollout.md`
- Modify: `README.md`
- Modify: `deliverables/project-status-summary-2026-07-31.md` only by appending a dated architecture status section; preserve prior content.

**Rollout order:**

1. Deploy additive migrations/bindings with all flags off.
2. Enable direct upload and R2 dual-write for admins.
3. Enable R2 reads for admins, then all users after 24 hours.
4. Enable SQL list endpoint.
5. Enable search for admins, one HR, then all HR.
6. Enable event-based dashboard after seven-day parity gate.
7. Run historical migration waves.
8. Apply PDF lifecycle and, later, verified D1 cleanup.

- [ ] Before each phase record commit SHA, deployment ID, schema version, binding inventory, queue settings, flags, baseline metrics, and rollback owner.
- [ ] Each phase requires its own smoke tests: login, list, upload text PDF, leave page, processing completion, scanned PDF, detail, delete, exact filter, semantic search, dashboard, and share snapshot.
- [ ] Abort phase on data leakage, hash mismatch, D1 5xx >1%, queue critical age, or unexplained metric divergence.
- [ ] Rollback changes flags first; additive schema and artifacts remain. Never roll back by deleting new R2 objects or event rows.
- [ ] Production deployment and lifecycle/migration cleanup require explicit user/company approval at execution time.
- [ ] After 72 stable hours, update project status, unresolved risks, actual latency/cost, and next scale trigger.
- [ ] Commit: `docs: add resume architecture production rollout`.

## Final verification command set

```bash
cd worker
npm ci
npm test
npm run typecheck
npm run build
npx wrangler types

cd ../frontend
npm ci
npm test
npm run build

cd ..
node scripts/pre-deploy-check.mjs
git diff --check
git status --short
```

Expected: all commands pass, only intentional files are changed, no secrets or production data are present.

## Done criteria

- Retention/purge behavior matches the product policy and is auditable.
- Queue backlog, failures, DLQ, migration, search lag, and artifact integrity are observable.
- Load tests demonstrate the current and next-stage traffic envelopes.
- Cost model separates known prices from unknown/beta pricing.
- Rollout is phased, reversible by flags, and never requires destructive rollback.

## Official implementation references

- [R2 object lifecycle rules](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)
- [Cloudflare Queues batching, retries, and delays](https://developers.cloudflare.com/queues/configuration/batching-retries/)
- [Cloudflare Queues dead-letter queues](https://developers.cloudflare.com/queues/configuration/dead-letter-queues/)
- [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)
