# Business Resume Push and Screening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the product-approved business resume workflow: AI-passed resumes can be pushed to the configured interviewer in batches, the interviewer can use a secure link to approve/reject each resume, and the result is written back into the existing resume/interview flow.

**Architecture:** Keep the existing D1 `resumes` and `positions` tables as the source of truth, add a small D1 push-batch model for interviewer-scoped links, and expose a public read/action surface that is constrained by a hashed opaque token. Reuse the existing Feishu user-token delivery and operation-log helpers. Do not implement dashboard styling/API integration in this plan; only preserve the future metric fields/events.

**Tech Stack:** React 19 + Ant Design + Vite; Cloudflare Workers/Hono; Cloudflare D1/SQLite; Vitest; existing Feishu messaging helpers.

## Global Constraints

- Only resumes whose AI screening result is `通过` and which are not HR-rejected may be pushed.
- HR actions are `推送` and `淘汰`; interviewer actions are `入库` and `不入库`.
- One interviewer link represents one push batch and contains all resumes in that batch for that interviewer.
- Do not add a separate talent-pool page or implement dashboard work in this scope.
- Store only a cryptographic hash of public link tokens in D1; use Web Crypto for token generation and hashing.
- Public link responses must never expose unrelated resumes or sensitive identifiers in URLs/errors/logs.
- Repeated callbacks are idempotent; a completed business decision cannot be overwritten by the opposite public-link action.
- Preserve existing uncommitted batch-reprocess work and do not revert or rewrite it.
- Every new behavior must have a failing test before production implementation.
- Every Worker promise must be awaited, returned, or passed to `ctx.waitUntil`; do not add request-scoped module state.
- The dashboard is explicitly deferred until product supplies final visual design and API contract.

## File Map

### Backend

- Create `worker/migrations/0028_business_screening_push.sql` for business-screening fields and push-batch tables/indexes.
- Create `worker/src/business-screening/types.ts` for shared status and DTO types.
- Create `worker/src/business-screening/token.ts` for secure token generation/hash/constant-time verification helpers.
- Create `worker/src/business-screening/repository.ts` for D1 reads/writes, batch creation, item transitions, and idempotency.
- Create `worker/src/business-screening/service.ts` for push eligibility, interviewer grouping, link payloads, and callback decisions.
- Create `worker/src/business-screening/routes.ts` for authenticated HR routes and unauthenticated token routes.
- Create `worker/tests/business-screening-token.test.ts`.
- Create `worker/tests/business-screening-service.test.ts`.
- Create `worker/tests/business-screening-routes.test.ts`.
- Modify `worker/schema.sql` with the migration-equivalent schema for fresh environments only.
- Modify `worker/src/index.ts` to register the new routes and wire existing Feishu delivery/logging dependencies.
- Modify `worker/wrangler.jsonc` only if the existing public URL/config requires a non-secret variable; do not add secrets.

### Frontend

- Modify `frontend/src/pages/Positions/Form.tsx` to use the interviewer directory for primary/secondary defaults.
- Modify `frontend/src/pages/Positions/List.tsx` for the same editor path and display.
- Modify `frontend/src/pages/Resumes/List.tsx` to replace HR `入库/不入库` with `推送/淘汰`, show push status, and render batch results.
- Create `frontend/src/pages/PublicBusinessScreening/index.tsx` for the token-scoped interviewer page.
- Modify `frontend/src/router/index.tsx` to add the public business-screening route.
- Create `frontend/src/pages/PublicBusinessScreening/logic.ts` for pure action/status helpers.
- Create `frontend/src/pages/PublicBusinessScreening/logic.test.ts`.
- Modify `frontend/src/api/request.ts` or the existing request helper only if a public no-auth request helper is required; preserve authenticated behavior.

### Documentation and verification

- Update `README.md` only after implementation is verified, documenting the new flow and the deferred dashboard.
- Add `docs/superpowers/verification/2026-08-12-business-resume-push-screening.md` with test/build/security evidence.

## Task 1: Add the business-screening data model and pure security/service primitives

**Files:**
- Create: `worker/migrations/0028_business_screening_push.sql`
- Modify: `worker/schema.sql`
- Create: `worker/src/business-screening/types.ts`
- Create: `worker/src/business-screening/token.ts`
- Create: `worker/src/business-screening/repository.ts`
- Create: `worker/src/business-screening/service.ts`
- Test: `worker/tests/business-screening-token.test.ts`
- Test: `worker/tests/business-screening-service.test.ts`

**Interfaces:**
- `createPublicToken(): Promise<{ token: string; tokenHash: string }>`
- `hashPublicToken(token: string): Promise<string>`
- `isEligibleForPush(resume: { screening_result?: string; status?: string; mapped_position?: string; position_applied?: string }, interviewer: { name: string; openId?: string }): { ok: true } | { ok: false; reason: string }`
- `groupEligibleResumesByInterviewer(resumes, positions, interviewerDirectory): Map<string, PushGroup>`
- `decideBusinessScreening(current: BusinessScreeningStatus, action: 'approve' | 'reject'): DecisionResult`

- [ ] **Step 1: Write failing token tests.**

Test secure random token shape, deterministic SHA-256 hash, and failure to treat a raw token as its stored hash.

- [ ] **Step 2: Run token tests and confirm the expected missing-module failure.**

Run: `cd worker && npm test -- business-screening-token.test.ts --run`

- [ ] **Step 3: Implement token helpers with Web Crypto.**

Use `crypto.getRandomValues` for token bytes and `crypto.subtle.digest('SHA-256', ...)` for the stored hash. Never use `Math.random`.

- [ ] **Step 4: Write failing service tests.**

Cover: AI `通过` + non-rejected is eligible; AI `不通过` is blocked; HR `rejected` is blocked; missing standard position/interviewer is blocked; grouping creates one group per interviewer; a completed decision is idempotent and cannot be reversed by a public callback.

- [ ] **Step 5: Run service tests and confirm they fail for missing functions.**

Run: `cd worker && npm test -- business-screening-service.test.ts --run`

- [ ] **Step 6: Add types, service rules, repository SQL methods, and migration.**

Add to `resumes`: `hr_disposition`, `business_screening_status`, `business_screening_remark`, `business_screened_at`, `business_screened_by`, `business_screening_batch_id`.

Create `resume_push_batches` with one row per interviewer batch and `resume_push_batch_items` with one row per resume. Enforce `UNIQUE(batch_id, resume_id)`, indexes for token hash/status/resume, and foreign keys where compatible with the existing schema.

Use statuses `not_ready`, `pending`, `passed`, `rejected`; batch statuses `active`, `completed`, `revoked`, `expired`; item statuses `pending`, `passed`, `rejected`.

- [ ] **Step 7: Run focused tests and migration/schema checks.**

Run: `cd worker && npm test -- business-screening-token.test.ts business-screening-service.test.ts --run` and inspect the migration SQL for idempotent `IF NOT EXISTS`/safe additive changes.

## Task 2: Implement authenticated HR push APIs and token-scoped callback APIs

**Files:**
- Create: `worker/src/business-screening/routes.ts`
- Test: `worker/tests/business-screening-routes.test.ts`
- Modify: `worker/src/index.ts`

**Interfaces:**
- `POST /api/resumes/business-screening/push` receives `{ ids: string[] }` and returns per-resume/per-interviewer results plus public URLs.
- `POST /api/resumes/:id/business-screening/reject` records HR “淘汰”.
- `GET /api/public/business-screening/:token` returns only the token’s interviewer batch view.
- `POST /api/public/business-screening/:token/resumes/:resumeId/approve` records interviewer “入库”.
- `POST /api/public/business-screening/:token/resumes/:resumeId/reject` records interviewer “不入库”.
- `POST /api/resumes/business-screening/batches/:batchId/resend` resends/reissues only the selected batch after authenticated HR validation.

- [ ] **Step 1: Write failing route tests.**

Cover unauthorized HR push, ineligible resume rejection, successful grouping, partial failure without losing successful groups, token scope isolation, expired/revoked link, approve/reject callback, duplicate callback, opposite callback after completion, and no sensitive IDs in public errors.

- [ ] **Step 2: Run route tests and confirm expected failures.**

Run: `cd worker && npm test -- business-screening-routes.test.ts --run`

- [ ] **Step 3: Implement HR push endpoint.**

Load selected resumes with positions and configured interviewers, apply the eligibility predicate, group by interviewer, create one batch/token per interviewer, insert batch items, and return a structured result:

```ts
{
  ok: boolean;
  pushed: string[];
  skipped: Array<{ id: string; reason: string }>;
  failed: Array<{ interviewer: string; reason: string }>;
  batches: Array<{ batchId: string; interviewer: string; url: string; itemCount: number }>;
}
```

The endpoint must update eligible resumes to `hr_disposition = 'pushed'` and `business_screening_status = 'pending'` only after the batch/item transaction-equivalent writes succeed.

- [ ] **Step 4: Implement HR淘汰 endpoint.**

Require the authenticated HR/admin role, reject a resume that is already business-screening completed, set `hr_disposition = 'rejected'`, set the existing HR rejection fields through the established rejection path, and preserve push history.

- [ ] **Step 5: Implement token-scoped read/action endpoints.**

Hash the supplied token, load the active batch, enforce expiry/revocation, verify the resume belongs to the batch, and return only sanitized candidate data. The action route must persist the result atomically enough that the same item cannot be changed by the opposite public action after completion.

- [ ] **Step 6: Wire Feishu delivery.**

For each created batch, use the existing interviewer open-id resolution and current-user Feishu token rules. Send one link message per interviewer. Do not silently fall back to an unrelated user. If delivery fails, return a failed group and keep a retryable batch status.

- [ ] **Step 7: Run focused route tests and existing Worker tests.**

Run: `cd worker && npm test -- business-screening-token.test.ts business-screening-service.test.ts business-screening-routes.test.ts --run` and then `cd worker && npm test -- --run`.

## Task 3: Update岗位默认面试官 configuration and resume HR actions

**Files:**
- Modify: `frontend/src/pages/Positions/Form.tsx`
- Modify: `frontend/src/pages/Positions/List.tsx`
- Modify: `frontend/src/pages/Resumes/List.tsx`
- Test: existing position/resume tests plus new focused tests where pure helpers are extracted

**Interfaces:**
- Position forms consume the existing interviewer directory endpoint and submit stable selected interviewer values.
- Resume list calls the HR push/reject APIs from Task 2 and renders the returned batch summary.

- [ ] **Step 1: Write failing frontend tests for action labels and eligibility presentation.**

Assert AI-passed/non-rejected rows show `推送` and `淘汰`, pushed rows show waiting state, and completed business results show `业务已通过`/`业务不通过` without exposing the old primary action.

- [ ] **Step 2: Run the focused frontend tests and confirm failure.**

Run: `cd frontend && npm test -- --run src/pages/Resumes/businessScreeningActions.test.ts`.

- [ ] **Step 3: Replace position free-text interviewer inputs with directory-backed selectors.**

Load `/api/auth/interviewers`, display names, submit the established name fields, and retain current values if a historical interviewer is no longer active. Keep primary and secondary semantics explicit.

- [ ] **Step 4: Replace HR resume actions.**

Remove the primary `入库/不入库` buttons from the HR card action area. Add `推送` for eligible rows and `淘汰` for HR rejection. Add batch push and batch淘汰 actions with per-item feedback. Keep existing AI reprocess and delete actions untouched.

- [ ] **Step 5: Add status/filter presentation.**

Add visible business-screening states and filters without breaking existing status filters. Preserve current URL/session filter persistence and responsive layout.

- [ ] **Step 6: Run focused frontend tests and build.**

Run: `cd frontend && npm test -- --run` and `cd frontend && npm run build`.

## Task 4: Add the public interviewer page and connect business pass to interviews

**Files:**
- Create: `frontend/src/pages/PublicBusinessScreening/index.tsx`
- Create: `frontend/src/pages/PublicBusinessScreening/logic.ts`
- Create: `frontend/src/pages/PublicBusinessScreening/logic.test.ts`
- Modify: `frontend/src/router/index.tsx`
- Modify: `frontend/src/pages/Interviews/List.tsx`
- Modify: `worker/src/index.ts` interview creation path only if required to read position defaults

**Interfaces:**
- Public page reads `GET /api/public/business-screening/:token` without application auth.
- Public page posts the two callback actions and updates the local item state from the server response.
- Interview creation consumes `position.primary_interviewer` and `position.secondary_interviewer` as defaults but allows HR override.

- [ ] **Step 1: Write failing pure page-logic tests.**

Cover status-to-label mapping, disabling both actions after a completed result, and preserving a server error without falsely showing success.

- [ ] **Step 2: Run the logic tests and confirm failure.**

Run: `cd frontend && npm test -- --run src/pages/PublicBusinessScreening/logic.test.ts`.

- [ ] **Step 3: Implement the public page.**

Render interviewer name, expiry, total count, candidate cards/table, resume detail, preview/download, remark input, approve/reject actions, loading/error/expired states, and mobile-safe layout. Do not add an authenticated navigation shell.

- [ ] **Step 4: Register the public route.**

Add `/business-screening/:token` outside the authenticated route wrapper and preserve SPA fallback behavior.

- [ ] **Step 5: Connect business-passed resumes to interview defaults.**

When the HR creates or schedules an interview from a business-passed resume, load the linked position defaults and prefill the interviewer fields. Store the actual selected values on the interview record.

- [ ] **Step 6: Run frontend tests and build.**

Run: `cd frontend && npm test -- --run` and `cd frontend && npm run build`.

## Task 5: Verification, documentation, and whole-branch review

**Files:**
- Modify: `README.md`
- Create: `docs/superpowers/verification/2026-08-12-business-resume-push-screening.md`
- Do not modify: dashboard implementation files unless a compile/type dependency forces a narrowly scoped change

- [ ] **Step 1: Run repository hygiene checks.**

Run `git diff --check` and inspect the diff to ensure unrelated uncommitted batch-reprocess changes remain intact.

- [ ] **Step 2: Run the complete test matrix.**

Run `cd frontend && npm test -- --run`, `cd worker && npm test -- --run`, `cd frontend && npm run build`, and the repository's existing worker/build checks from `README.md`.

- [ ] **Step 3: Perform static security review.**

Verify token generation uses Web Crypto, D1 stores only token hashes, public routes enforce batch membership and expiry, no public response contains raw internal IDs beyond the route parameter needed for the action, and all background promises are handled.

- [ ] **Step 4: Update documentation.**

Document the new push flow, interviewer link behavior, required position interviewer setup, current limitations, and dashboard deferral. Include exact verification commands and results in the verification record.

- [ ] **Step 5: Run final diff review and report deployment readiness.**

Check changed files, migrations, API routes, and tests. Do not deploy production, apply production migrations, push branches, or create a PR unless separately authorized. Report any required migration/deployment steps for the final user deployment feedback loop.

## Execution Notes

- Tasks 1 and 3 can be developed in parallel only if the frontend branch does not assume unmerged backend types; integration must happen before Task 4.
- Task 2 depends on Task 1.
- Task 4 depends on Tasks 2 and 3.
- Task 5 runs after all implementation tasks.
- The existing working-tree changes are user-owned and must remain; use targeted patches and avoid broad formatting rewrites.
