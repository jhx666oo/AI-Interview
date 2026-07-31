# Recruiting Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add bulk talent-pool approval, explainable role rules, a recruiting-board dashboard, and revocable time-limited dashboard shares.

**Architecture:** Preserve D1 as the authoritative store. Extend the existing Hono Worker with ID-based batch and aggregate endpoints; keep Feishu as best-effort synchronization. Reuse the current dashboard data sources for the internal board, while a token-gated endpoint emits an intentionally reduced public DTO for the share page.

**Tech Stack:** Cloudflare Pages/Workers, Hono, D1, React, TypeScript, Ant Design, Vitest.

## Global Constraints

- All resume mutations use `resume.id`; candidate names are display-only.
- Bulk action failures are isolated per resume and never roll back successful D1 updates.
- Hard requirements mark and sort; they never hide a candidate by default.
- Public shares contain no candidate-level data or AI evaluation content.
- Store only SHA-256 hashes of public share tokens.
- Existing Worker `tsc` errors are historical; require focused Vitest tests and `frontend npm run build`.

---

## File structure

- `scripts/migration_dashboard_share_links.sql` — additive D1 table and indexes.
- `worker/src/recruiting-operations/types.ts` — DTOs, share expiry types, safe public board shape.
- `worker/src/recruiting-operations/share-links.ts` — token hashing, expiry validation, safe token lookup.
- `worker/tests/recruiting-operations.test.ts` — unit contracts for expiry, safe DTO, rule scoring.
- `worker/src/index.ts` — batch approval, rule evaluation, recruiting-board and share routes.
- `frontend/src/pages/Resumes/List.tsx` — bulk approval action and hard-rule filters/tags.
- `frontend/src/pages/Dashboard/index.tsx` — grouped recruiting board and share-link modal.
- `frontend/src/pages/SharedDashboard/index.tsx` — unauthenticated, read-only dashboard page.
- `frontend/src/router/index.tsx` — public route before private layout.

## Task 1: Add share-link persistence and safe token utilities

**Files:**
- Create: `scripts/migration_dashboard_share_links.sql`
- Create: `worker/src/recruiting-operations/types.ts`
- Create: `worker/src/recruiting-operations/share-links.ts`
- Create: `worker/tests/recruiting-operations.test.ts`
- Modify: `worker/schema.sql`

**Produces:** expiring `dashboard_share_links` records and token helpers with no plaintext persistence.

- [ ] **Step 1: Write failing token tests**

```ts
it('accepts a live link and rejects expired or revoked links', () => {
  expect(isShareLinkActive({ expires_at: future, revoked_at: null }, now)).toBe(true);
  expect(isShareLinkActive({ expires_at: past, revoked_at: null }, now)).toBe(false);
  expect(isShareLinkActive({ expires_at: null, revoked_at: now }, now)).toBe(false);
});

it('removes candidate fields from a public board row', () => {
  expect(toPublicBoardRow({ position: '运营', total_resumes: 10, candidate_name: 'X' })).not.toHaveProperty('candidate_name');
});
```

- [ ] **Step 2: Run RED**

Run: `cd worker && npm test -- recruiting-operations.test.ts`

Expected: module-not-found failure.

- [ ] **Step 3: Add schema and helpers**

```sql
CREATE TABLE IF NOT EXISTS dashboard_share_links (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('all','divisions')),
  scope_ids TEXT NOT NULL DEFAULT '[]',
  expires_at TEXT,
  revoked_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dashboard_share_links_active
  ON dashboard_share_links(revoked_at, expires_at);
```

Implement `hashShareToken(token)`, `isShareLinkActive(link, now)`, `createShareExpiry('1d'|'7d'|'30d'|'permanent')`, and `toPublicBoardRow(row)`.

- [ ] **Step 4: Run GREEN and migration check**

Run: `cd worker && npm test -- recruiting-operations.test.ts && npx wrangler d1 execute ai-interview-db --local --file ../scripts/migration_dashboard_share_links.sql`

Expected: tests pass and the migration succeeds.

- [ ] **Step 5: Commit**

```bash
git add worker/schema.sql scripts/migration_dashboard_share_links.sql worker/src/recruiting-operations worker/tests/recruiting-operations.test.ts
git commit -m "feat: add dashboard share link storage"
```

## Task 2: Add ID-based bulk talent-pool approval

**Files:**
- Modify: `worker/src/index.ts`
- Modify: `worker/tests/recruiting-operations.test.ts`
- Modify: `frontend/src/pages/Resumes/List.tsx`

**Consumes:** selected resume UUIDs and authenticated admin/hr user.

**Produces:** `POST /api/resumes/batch-approve-to-talent-pool` and a list action that reports each outcome.

- [ ] **Step 1: Write failing API service tests**

```ts
it('approves eligible rows and skips already-approved rows by resume id', async () => {
  const result = await approveBatch(fakeDb, ['resume-1', 'resume-2']);
  expect(result.approved).toEqual(['resume-1']);
  expect(result.skipped).toEqual([{ id: 'resume-2', reason: 'already_approved' }]);
});
```

- [ ] **Step 2: Run RED**

Run: `cd worker && npm test -- recruiting-operations.test.ts`

Expected: `approveBatch` is not exported.

- [ ] **Step 3: Implement isolated per-row approval**

Use `resume.id` to select and update `status='approved', stage='talent_pool'`. Return `approved`, `skipped`, and `failed`; write `operation_logs` per success. Call the existing Feishu update helper in a separate `try/catch` after each D1 success.

- [ ] **Step 4: Add UI confirmation and result summary**

Use existing `selectedRowKeys`; add a non-danger `批量入库` button next to `批量淘汰` and `批量删除`. Disable while submitting, then remove successful IDs from selection and refresh rows.

- [ ] **Step 5: Verify and commit**

Run: `cd worker && npm test -- recruiting-operations.test.ts`; `cd frontend && npm run build`.

```bash
git add worker/src/index.ts worker/tests/recruiting-operations.test.ts frontend/src/pages/Resumes/List.tsx
git commit -m "feat: add bulk talent-pool approval"
```

## Task 3: Normalize ability weights and hard-requirement results

**Files:**
- Modify: `worker/src/index.ts`
- Modify: `worker/tests/recruiting-operations.test.ts`
- Modify: `frontend/src/pages/Resumes/List.tsx`

**Produces:** weighted dimensions in AI results, `hard_requirement_result` shape, list filters and non-blocking tags.

- [ ] **Step 1: Write failing scoring tests**

```ts
it('normalizes configured weights before calculating a weighted score', () => {
  expect(weightedScore([{ score: 4, weight: 40 }, { score: 3, weight: 60 }])).toBe(3.4);
});

it('marks missing age as manual review rather than failed', () => {
  expect(evaluateHardRequirements({ age: null }, [{ field: 'age', operator: 'between', value: [22, 35] }]))
    .toMatchObject({ passed: true, unknown_items: ['age'] });
});
```

- [ ] **Step 2: Run RED**

Run: `cd worker && npm test -- recruiting-operations.test.ts`

Expected: missing scoring and hard-requirement functions.

- [ ] **Step 3: Implement and persist results**

Normalize `positions.capability_dimensions` entries to `{name, weight, description}`. Persist `hard_requirement_result` with `passed`, `unmet_items`, `unknown_items`, and `message`. Update AI processor writes to include weighted result data without changing the raw per-dimension evidence.

- [ ] **Step 4: Add list filters**

Add `硬条件` select values `all`, `passed`, `unmet`, `unknown`; add a minimum match-score control. Render a Tag for unmet or pending-review hard requirements; retain all rows unless the user explicitly filters.

- [ ] **Step 5: Verify and commit**

Run: `cd worker && npm test -- recruiting-operations.test.ts`; `cd frontend && npm run build`.

```bash
git add worker/src/index.ts worker/tests/recruiting-operations.test.ts frontend/src/pages/Resumes/List.tsx
git commit -m "feat: add weighted role rules and hard-condition filters"
```

## Task 4: Build the recruiting-board aggregate endpoint and internal dashboard

**Files:**
- Modify: `worker/src/index.ts`
- Modify: `worker/tests/recruiting-operations.test.ts`
- Modify: `frontend/src/pages/Dashboard/index.tsx`

**Produces:** `GET /api/dashboard/recruiting-board` and department-grouped, expandable dashboard rows.

- [ ] **Step 1: Write failing aggregate test**

```ts
it('sums position rows into one division total without storing a second total', () => {
  expect(groupBoardRows([{ division: 'A', total_resumes: 2 }, { division: 'A', total_resumes: 3 }]))
    .toMatchObject([{ division: 'A', total_resumes: 5, positions: expect.any(Array) }]);
});
```

- [ ] **Step 2: Run RED**

Run: `cd worker && npm test -- recruiting-operations.test.ts`

Expected: `groupBoardRows` missing.

- [ ] **Step 3: Implement board aggregation**

Reuse existing dashboard position queries and return a versioned DTO containing KPI totals and grouped rows. Stage counts must derive from D1 `resumes`, `interviews`, `offers`, and `onboarding_records`; return `pass_rate=null` when the denominator is zero.

- [ ] **Step 4: Render the board**

Replace the flat dashboard detail table with expandable division rows and position children. Keep the existing filters, add HRBP and priority filters, and use P0/P1/P2 plus pipeline-status Tags in the existing blue-purple visual system.

- [ ] **Step 5: Verify and commit**

Run: `cd worker && npm test -- recruiting-operations.test.ts`; `cd frontend && npm run build`.

```bash
git add worker/src/index.ts worker/tests/recruiting-operations.test.ts frontend/src/pages/Dashboard/index.tsx
git commit -m "feat: add grouped recruiting board dashboard"
```

## Task 5: Add expiring dashboard shares and public read-only page

**Files:**
- Modify: `worker/src/index.ts`
- Modify: `worker/tests/recruiting-operations.test.ts`
- Create: `frontend/src/pages/SharedDashboard/index.tsx`
- Modify: `frontend/src/pages/Dashboard/index.tsx`
- Modify: `frontend/src/router/index.tsx`

**Produces:** creation/revocation endpoints and `/shared/dashboard/:token`.

- [ ] **Step 1: Write failing share-route tests**

```ts
it('returns 404 instead of public data for an expired token', async () => {
  const response = await getSharedBoard(fakeDb, 'expired-token', now);
  expect(response.status).toBe(404);
});
```

- [ ] **Step 2: Run RED**

Run: `cd worker && npm test -- recruiting-operations.test.ts`

Expected: `getSharedBoard` missing.

- [ ] **Step 3: Add authenticated management routes and anonymous read route**

Implement `POST/GET/DELETE /api/dashboard/share-links` for admin/hr and `GET /api/shared/dashboard/:token` without auth. Accept only `1d`, `7d`, `30d`, `permanent`; hash token before D1 lookup; use `toPublicBoardRow` before responding.

- [ ] **Step 4: Add share modal and page**

Add a Dashboard “分享看板” button and modal with radio options for 1/7/30 days and long-term, copied link output, and revocation list. Create a no-layout `SharedDashboard` that renders only title, update time, KPIs and board rows.

- [ ] **Step 5: Verify and commit**

Run: `cd worker && npm test -- recruiting-operations.test.ts`; `cd frontend && npm run build`.

```bash
git add worker/src/index.ts worker/tests/recruiting-operations.test.ts frontend/src/pages/Dashboard/index.tsx frontend/src/pages/SharedDashboard/index.tsx frontend/src/router/index.tsx
git commit -m "feat: add expiring recruiting dashboard shares"
```

## Final verification and production rollout

- [ ] Run all Worker tests: `cd worker && npm test`.
- [ ] Run frontend build: `cd frontend && npm run build`.
- [ ] Apply `scripts/migration_dashboard_share_links.sql` locally, then production after approval.
- [ ] In production: batch-approve records across two list pages; confirm D1 results persist after refresh.
- [ ] Configure a role with weighted dimensions and confirm visible hard-condition tags.
- [ ] Create a 1-day share, verify anonymous page excludes candidate data, revoke it, and verify 404.
- [ ] Commit any rollout documentation and publish the branch/PR only with user approval.

## Plan self-review

- Coverage: Task 2 implements bulk approval; Task 3 covers ability dimensions and hard conditions; Tasks 4–5 implement the internal board and expiring public share page.
- Type consistency: all mutations use `resume.id`, share token storage uses `token_hash`, and public DTO construction is centralized before anonymous responses.
- Scope: evaluation-set work and unrelated recruiting modules remain excluded.
