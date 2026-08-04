# Recruitment Events and Funnel Metrics Implementation Plan

> Execution order: may start after storage foundation, but integrate only after resume identifiers and soft deletion are stable.

**Goal:** Preserve auditable candidate-stage history and calculate dashboard funnel metrics from immutable events instead of mutable current-state guesses.

**Architecture:** Business actions append normalized events with idempotency keys. Current resume/interview status remains the operational projection. Dashboard metrics are computed by explicit time semantics and can be snapshotted for historical sharing.

## Metric definitions frozen for implementation

- `event_time`: count events whose `occurred_at` falls in the selected range.
- `cohort`: start with resumes uploaded in the selected range, then count their later downstream events.
- Default dashboard mode: `event_time` for current operations. Shared monthly snapshot records both mode and cutoff time.
- Funnel stages: `resume_received → ai_screened → hr_approved → interview_1_passed → interview_2_passed → interview_3_passed → offer_issued → onboarded`.
- A candidate counts at most once per stage per position in a metric window.

## Task 1: Create append-only event and outbox tables

**Files:**
- Create: `worker/migrations/0017_candidate_stage_events.sql`
- Modify: `worker/schema.sql`
- Create: `worker/tests/recruitment-event-schema.test.ts`

**Table:** `candidate_stage_events(id, tenant_id, resume_id, candidate_id, position_id, stage, action, occurred_at, actor_user_id, source, dedupe_key UNIQUE, metadata_json, created_at)`.

- [ ] Add indexes `(tenant_id, occurred_at)`, `(position_id, occurred_at)`, `(resume_id, stage)`, and `(stage, occurred_at)`.
- [ ] Metadata may contain reason codes, score bands, interview round, and source record IDs; it must not contain resume text, phone, email, or full AI output.
- [ ] Add `recruitment_event_outbox(id, dedupe_key UNIQUE, event_json, status, attempt_count, next_attempt_at, created_at, processed_at)` for writes that cross existing transactions.
- [ ] Test uniqueness, required fields, allowed stage check constraint, and indexes.
- [ ] Run local migration and `cd worker && npm test -- recruitment-event-schema.test.ts`.
- [ ] Commit: `feat: add recruitment event ledger and outbox`.

## Task 2: Implement idempotent event recording

**Files:**
- Create: `worker/src/recruitment-events/types.ts`
- Create: `worker/src/recruitment-events/repository.ts`
- Create: `worker/src/recruitment-events/dedupe.ts`
- Create: `worker/tests/recruitment-event-repository.test.ts`

- [ ] Define stage/action/source enums and runtime validators.
- [ ] Generate deterministic dedupe keys: `{source}:{sourceRecordId}:{stage}:{action}:{occurredAt}`. For system processing, use `{resumeId}:{processingVersion}:{stage}`.
- [ ] `append()` uses `INSERT ... ON CONFLICT(dedupe_key) DO NOTHING` and returns whether a row was created.
- [ ] `appendInBatch()` accepts the D1 statements from the status projection so event and current state commit together when possible.
- [ ] Add an outbox flusher for integrations that cannot share the transaction; retries are exponential and idempotent.
- [ ] Run `cd worker && npm test -- recruitment-event-repository.test.ts`.
- [ ] Commit: `feat: add idempotent recruitment event recorder`.

## Task 3: Emit events from every stage-changing workflow

**Files:**
- Create: `worker/src/recruitment-events/integrations.ts`
- Modify: `worker/src/resume-uploads/service.ts`
- Modify: `worker/src/resume-processing/processor.ts`
- Modify: relevant HR decision, interview, offer, and onboarding handlers in `worker/src/index.ts`
- Create: `worker/tests/recruitment-event-integrations.test.ts`

- [ ] Map upload completion to `resume_received`, AI completion to `ai_screened`, manual approve/reject to HR actions, interview outcome by round, offer action, and onboarding action.
- [ ] Do not emit `hr_approved` merely because AI recommends pass; human/system stages remain separate.
- [ ] Test retries, repeated button clicks, status reversals, and corrections. A correction appends a new event; it never edits the prior event.
- [ ] For Feishu synchronization, store the remote record ID as metadata and use it in the dedupe key.
- [ ] Add a code audit proving every write to relevant status fields either appends an event or is an explicitly documented migration/backfill.
- [ ] Run `cd worker && npm test -- recruitment-event-integrations.test.ts`.
- [ ] Commit: `feat: emit recruitment events from stage changes`.

## Task 4: Implement exact funnel aggregation

**Files:**
- Create: `worker/src/recruitment-events/funnel-query.ts`
- Create: `worker/src/recruitment-events/metrics.ts`
- Create: `worker/tests/recruitment-funnel-metrics.test.ts`

**Interface:**

```ts
getFunnelMetrics({ tenantId, from, to, mode, departmentId?, hrbpUserId?, positionId? })
```

- [ ] Test timezone boundary at Asia/Shanghai midnight, duplicate events, cross-position candidates, late events, reversed stages, and zero denominators.
- [ ] Event-time query uses first qualifying event per `(resume_id, position_id, stage)` within the window.
- [ ] Cohort query selects `resume_received` cohort in-window, then joins their first downstream events up to `cutoff_at`.
- [ ] Return raw counts and separately named rates: `stage_conversion_rate` and `end_to_end_rate`; never reuse ambiguous `通过率` internally.
- [ ] Compute average recruitment cycle only for onboarded cohorts with both start/end events.
- [ ] Run `cd worker && npm test -- recruitment-funnel-metrics.test.ts`.
- [ ] Commit: `feat: calculate recruitment funnels from events`.

## Task 5: Integrate event metrics into the dashboard API

**Files:**
- Modify: `worker/src/recruiting-operations/dashboard.ts`
- Modify: dashboard routes in `worker/src/index.ts`
- Create: `worker/tests/recruiting-dashboard-events.test.ts`

- [ ] Preserve the current response shape through an adapter while adding `metric_mode`, `from`, `to`, `cutoff_at`, and `data_freshness`.
- [ ] Replace mutable-state counts only after parity comparison for the same dataset; include both old/new calculations behind `RECRUITMENT_EVENT_METRICS` during validation.
- [ ] Department cards, HRBP cards, funnel chart, and detailed position table must all derive from the same metric query and cutoff.
- [ ] AI summary receives aggregate numbers only, not candidate PII or resume text.
- [ ] Run `cd worker && npm test -- recruiting-dashboard-events.test.ts`.
- [ ] Commit: `refactor: power recruitment dashboard with event metrics`.

## Task 6: Create immutable dashboard snapshots and share semantics

**Files:**
- Create: `worker/migrations/0018_dashboard_snapshot_metric_mode.sql`
- Modify: `worker/schema.sql`
- Modify: `worker/src/recruiting-operations/snapshots.ts`
- Modify: dashboard share route in `worker/src/index.ts`
- Create: `worker/tests/dashboard-snapshot-semantics.test.ts`

- [ ] Add `metric_mode`, `range_start`, `range_end`, `cutoff_at`, `schema_version`, and `source_event_max_created_at` to snapshot storage.
- [ ] Generating a share link freezes the serialized snapshot; later events do not mutate it.
- [ ] Existing expiry-day choices remain; expiry controls link access, not metric recomputation.
- [ ] Snapshot response displays `数据截至` and `统计口径`.
- [ ] Test expiry, revoked token, unchanged historical snapshot after new events, and schema-version compatibility.
- [ ] Run `cd worker && npm test -- dashboard-snapshot-semantics.test.ts`.
- [ ] Commit: `feat: freeze event-based dashboard snapshots`.

## Task 7: Backfill only trustworthy historical events

**Files:**
- Create: `worker/src/recruitment-events/backfill.ts`
- Create: `scripts/audit-recruitment-event-backfill.mjs`
- Create: `worker/tests/recruitment-event-backfill.test.ts`
- Create: `docs/runbooks/recruitment-event-backfill.md`

- [ ] Inventory available timestamps and classify each mapping as exact, inferred, or unavailable.
- [ ] Backfill exact timestamps only. If only current status exists, do not invent intermediate event times; mark the resume in a report as `historical_stage_unknown`.
- [ ] Use dedupe source `migration_v1` so reruns are safe.
- [ ] Produce aggregate before/after counts by position and stage with no candidate PII.
- [ ] Run dry-run, sample 30 resumes manually, then execute staging batches of 100.
- [ ] Run `cd worker && npm test -- recruitment-event-backfill.test.ts`.
- [ ] Commit: `feat: backfill trustworthy recruitment events`.

## Task 8: Roll out with a parity gate

**Files:**
- Create: `docs/runbooks/recruitment-metrics-rollout.md`
- Modify: `worker/src/config/feature-flags.ts`
- Modify: `README.md`

- [ ] Run old and event-based metrics side by side for 7 days.
- [ ] Explain every difference above 1% or one candidate; expected differences from corrected deduplication must be signed off.
- [ ] Enable the new path for admins, then shared snapshots, then all dashboard users.
- [ ] Rollback is flag-only and does not delete events.
- [ ] Record test/build outputs and a redacted dashboard comparison.
- [ ] Commit: `docs: add recruitment event metric rollout`.

## Done criteria

- All future stage changes create idempotent events.
- Dashboard metrics have explicit time and conversion semantics.
- Shared links are immutable historical snapshots.
- Backfill never fabricates unknown history.
