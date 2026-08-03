# Resume Architecture Master Execution Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute the complete resume storage, durable processing, hybrid search, recruitment-event, migration, and production-hardening redesign in reviewable phases without interrupting the current production workflow.

**Architecture:** Keep React/Vite, Hono Workers, D1, Queues, and the existing resume consumer. Move PDF and long-form artifacts to private R2, add direct browser upload, isolate all long-text reads behind repositories, derive searchable documents for AI Search, and calculate funnel history from append-only events. Every production-visible capability is protected by feature flags and has a rollback path.

**Tech Stack:** TypeScript, Hono, React 19, Ant Design, Cloudflare Pages/Workers, D1, R2, Queues, AI Search, Vitest, Wrangler 4.68.1 or newer.

## Global Constraints

- Read and follow `docs/superpowers/specs/2026-08-03-resume-storage-search-architecture-design.md` before changing code.
- Work on a fresh `codex/` or company-approved feature branch; do not implement directly on the production branch.
- Preserve unrelated working-tree changes and untracked local files.
- Use `resume.id`, stable user IDs, position IDs, and artifact IDs; never use `candidate_name` as an update key.
- PDF retention is 60 days. OCR, full AI analysis, interview results, stage events, and dashboard snapshots are retained until an explicit deletion policy runs.
- No PDF Base64 is written to D1 after the R2 upload flag is enabled for that user.
- OCR, AI, search indexing, backfill, and deletion are durable jobs; do not use `waitUntil` for critical work.
- R2 buckets remain private. Never expose credentials, object keys, OCR text, AI analysis, presigned URLs, or candidate PII in logs.
- AI Search is a replaceable provider and a derived index, never the authorization source or business truth source.
- Search results are filtered by provider metadata and then filtered again by D1 authorization rules.
- `GET /api/resumes` must use database-level filtering and pagination and must not select long-text columns.
- Production D1 migration, R2 bucket/lifecycle changes, Cloudflare secrets, Queue changes, AI Search instance creation, and production deployment each require explicit production approval.
- Each task uses TDD: failing focused test, minimal implementation, focused test pass, broader regression, commit.
- Do not combine schema migration, data backfill, lifecycle deletion, and production traffic cutover in one deployment.

---

## Plan Package and Dependency Order

Execute these plans strictly in order unless a plan explicitly marks a task as parallel-safe:

1. `2026-08-03-resume-storage-foundation.md`
2. `2026-08-03-resume-direct-upload.md`
3. `2026-08-03-resume-r2-processing-and-reads.md`
4. `2026-08-03-resume-hybrid-search.md`
5. `2026-08-03-recruitment-events-and-funnel.md`
6. `2026-08-03-resume-history-migration.md`
7. `2026-08-03-resume-production-hardening-and-rollout.md`

Dependency graph:

```text
Storage foundation
  ├─ Direct upload
  └─ R2 processing and reads
       ├─ Hybrid search
       ├─ Recruitment events and funnel
       └─ History migration
            └─ Production hardening, lifecycle, and rollout
```

## Shared Interface Freeze

The first plan owns these contracts. Later plans may extend them additively but must not rename them without updating every dependent plan:

```ts
export type ResumeArtifactType =
  | 'pdf'
  | 'ocr'
  | 'ai_analysis'
  | 'interview_report'
  | 'search_document';

export type ResumeArtifactStatus =
  | 'pending'
  | 'available'
  | 'expired'
  | 'deleted'
  | 'failed';

export interface ResumeArtifactStore {
  put(input: PutArtifactInput): Promise<StoredArtifactObject>;
  get(objectKey: string): Promise<R2ObjectBody | null>;
  head(objectKey: string): Promise<R2Object | null>;
  delete(objectKey: string): Promise<void>;
}

export interface ResumeTextRepository {
  getCurrent(resumeId: string): Promise<{ text: string; artifactId?: string; source: 'r2' | 'legacy_d1' } | null>;
  putVersion(input: { resumeId: string; text: string; source: string; version: number }): Promise<string>;
}

export interface ResumeAnalysisRepository {
  getCurrent(resumeId: string): Promise<Record<string, unknown> | null>;
  putVersion(input: { resumeId: string; analysis: Record<string, unknown>; model: string; promptVersion: string; version: number }): Promise<string>;
}

export interface ResumeSearchService {
  search(input: ResumeSearchQuery, scope: ResumeAccessScope): Promise<ResumeSearchPage>;
  requestIndex(resumeId: string, version: number): Promise<void>;
  requestDelete(resumeId: string): Promise<void>;
  getHealth(): Promise<ResumeSearchHealth>;
}
```

## Shared Feature Flags

Use explicit string variables parsed by one helper; absence means disabled:

```ts
export interface ResumeFeatureFlags {
  r2ArtifactWrite: boolean;
  r2ArtifactRead: boolean;
  directR2Upload: boolean;
  sqlResumeList: boolean;
  hybridSearch: boolean;
  recruitmentEvents: boolean;
  recruitmentEventMetrics: boolean;
}

export function readResumeFeatureFlags(env: Record<string, unknown>): ResumeFeatureFlags {
  const enabled = (key: string) => String(env[key] ?? '').toLowerCase() === 'true';
  return {
    r2ArtifactWrite: enabled('R2_ARTIFACT_WRITE'),
    r2ArtifactRead: enabled('R2_ARTIFACT_READ'),
    directR2Upload: enabled('DIRECT_R2_UPLOAD'),
    sqlResumeList: enabled('RESUME_SQL_LIST'),
    hybridSearch: enabled('RESUME_HYBRID_SEARCH'),
    recruitmentEvents: enabled('RECRUITMENT_EVENTS'),
    recruitmentEventMetrics: enabled('RECRUITMENT_EVENT_METRICS'),
  };
}
```

Staging enables flags one at a time. Production starts with all flags false.

## Branch and Commit Protocol

- [ ] **Step 1: Create an isolated execution branch or worktree**

```bash
git status --short
git switch -c codex/resume-storage-search-rebuild
```

Expected: branch created without discarding existing user changes. If the current tree is dirty, use the company-approved worktree procedure instead of moving or stashing unknown files.

- [ ] **Step 2: Record the baseline revision and test results**

```bash
git rev-parse HEAD
cd worker && npm test
cd ../frontend && npm run build
node ../scripts/pre-deploy-check.mjs
```

Expected: record the commit SHA and exact pass/fail counts in the implementation handoff. Existing failures must be documented before feature work; do not silently treat them as caused by the new implementation.

- [ ] **Step 3: Use one commit per independently testable task**

Commit prefixes:

```text
test: add ... contract
feat: add ...
refactor: route ... through repository
fix: handle ...
docs: document ...
chore: configure ...
```

Do not squash until review has passed; the rollback strategy depends on task-level commits.

## Review Gates

### Gate A: Storage foundation

Required before direct upload:

- D1 migrations are additive and idempotent locally.
- R2 repository tests pass with a fake bucket.
- Wrangler dry run succeeds for Pages and consumer configs.
- No production bucket, secrets, or migration changes have occurred.

### Gate B: Staging upload and processing

Required before hybrid search:

- One text PDF and one scanned PDF complete after the browser closes.
- PDF is in private R2; D1 contains no new Base64 for flagged uploads.
- OCR and AI artifacts are readable through authenticated endpoints.
- Unflagged production behavior is unchanged.

### Gate C: Search pilot

Required before HR access:

- Admin-only staging search supports Chinese exact and semantic queries.
- Search results are re-filtered through D1 access scope.
- Deleted or out-of-scope resume IDs are not returned.
- Search outage falls back without breaking the resume list.

### Gate D: Historical migration

Required before D1 cleanup:

- Backfill is restartable, rate-limited, and hash-verified.
- Migration coverage is 100% or every exception has an explicit failure record.
- R2-first reads have been stable for seven days.
- A D1 export and restore procedure has been tested.

### Gate E: Production lifecycle

Required before enabling PDF expiry:

- The `pdf/` prefix contains only disposable source PDFs.
- A dry-run inventory lists every object that would expire.
- OCR, AI, interview, and `search/` prefixes are excluded from PDF deletion.
- The user gives explicit production approval.

## Definition of Done

- [ ] All seven plans are implemented and their focused tests pass.
- [ ] `cd worker && npm test` passes.
- [ ] `cd frontend && npm test && npm run build` passes.
- [ ] `node scripts/pre-deploy-check.mjs` passes from the expected directory.
- [ ] Pages and consumer `wrangler deploy --dry-run` commands pass.
- [ ] No new request lists all OCR/AI long text.
- [ ] No new upload writes PDF Base64 to D1 when `DIRECT_R2_UPLOAD=true`.
- [ ] Search, events, migration, and cleanup expose health/progress state.
- [ ] Staging acceptance covers upload, close-browser processing, search, delete, expiry simulation, and permissions.
- [ ] Production migration/deployment/lifecycle operations remain unexecuted until separately approved.

## Company AI Execution Prompt

Give the company AI this prompt at the beginning of each plan:

```text
Read the referenced design document, this master execution plan, and the selected child plan completely before editing. Inspect the current repository because it may have changed since the plan was written. Preserve unrelated changes. Execute exactly one task at a time using TDD, run the focused and regression commands specified by the task, and create the named commit only after the tests pass. Stop at every review gate and report evidence. Do not apply production migrations, create/delete Cloudflare production resources, change lifecycle rules, set secrets, push a production branch, or deploy production without explicit human approval.
```

## Handoff Record Template

After every child plan, append a record to the implementation task or PR description:

```text
Plan:
Tasks completed:
Commits:
Focused tests:
Full Worker tests:
Frontend build:
Wrangler dry run:
Feature flags changed:
External resources changed:
Known failures or follow-ups:
Rollback commit/flag:
```
