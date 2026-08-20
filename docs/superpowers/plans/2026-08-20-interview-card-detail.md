# 面试提醒候选人详情页 Implementation Plan

> **For agentic workers:** Implement task-by-task with a test-first loop. Do not change the Feishu message URL format.

**Goal:** Enrich the existing `/interview-card/:token` read-only page with the candidate resume, AI evaluation, HR/business decisions, interview evaluations, and a single backend-derived current status.

**Architecture:** Add a small public interview-card route module in the Worker that validates the bearer token, resolves the interview to one resume, and returns a stable view model. Add a public React page and route that renders the view model; PDF bytes are streamed through the same token. Existing Feishu reminder sending remains unchanged.

**Tech Stack:** Hono, Cloudflare D1, React 19, React Router, Ant Design, existing PDF viewer and request client.

## Global Constraints

- Public links are read-only and remain token-expiring/revocable.
- Resolve resumes by `resume_id`; never silently choose between same-name candidates.
- Return empty-state values for missing test data instead of throwing or hiding the whole page.
- Keep current API field compatibility and preserve existing `/interview-card/:token` URLs.
- Do not expose raw storage URLs; PDF is proxied through the Worker.

### Task 1: Add the public interview-card API contract

**Files:**
- Create: `worker/src/interview-card/routes.ts`
- Create: `worker/src/interview-card/view-model.ts`
- Test: `worker/tests/interview-card-routes.test.ts`
- Modify: `worker/src/index.ts`

**Steps:**

- [ ] Write failing tests for valid/expired tokens, resume association, same-name ambiguity, current-status precedence, and all requested data sections.
- [ ] Run the focused Worker test and confirm it fails because the route is not registered.
- [ ] Implement token lookup, D1 joins, JSON field normalization, status derivation, and a stable response shape.
- [ ] Register `GET /api/public/interview-card/:token` before the generic public routes.
- [ ] Run the focused test and confirm it passes.

### Task 2: Add token-protected PDF preview/download

**Files:**
- Modify: `worker/src/interview-card/routes.ts`
- Test: `worker/tests/interview-card-routes.test.ts`

**Steps:**

- [ ] Add failing tests for PDF preview, download headers, missing file, expired token, and absent `resume_id`.
- [ ] Run focused tests and confirm the new cases fail.
- [ ] Stream bytes from the existing resume-file/artifact helpers with `Content-Type: application/pdf`, `Content-Disposition`, `Cache-Control: no-store`, and range support where available.
- [ ] Run focused tests and confirm all file cases pass.

### Task 3: Build the public React interview-card page

**Files:**
- Create: `frontend/src/pages/Public/InterviewCard.tsx`
- Create: `frontend/src/pages/Public/InterviewCard.test.tsx`
- Modify: `frontend/src/router/index.tsx`
- Modify: `frontend/src/index.css`

**Steps:**

- [ ] Write failing component tests for summary, profile, AI, HR/business, interview rounds, timeline, empty states, and PDF controls.
- [ ] Run focused frontend tests and confirm the page/route is missing.
- [ ] Implement the page using the existing request client, PDF viewer, Ant Design primitives, status tags, and responsive two-column/single-column layout.
- [ ] Add explicit empty placeholders and long-text wrapping; default-expand the current interview round.
- [ ] Register public route `/interview-card/:token`.
- [ ] Run focused tests and confirm they pass.

### Task 4: Repair reminder data association and regression coverage

**Files:**
- Modify: `worker/src/index.ts` (interview creation/reminder source)
- Modify: `worker/src/interview-card/view-model.ts`
- Test: `worker/tests/interview-reminder.test.ts`
- Test: `worker/tests/interview-card-routes.test.ts`

**Steps:**

- [ ] Add a failing regression test showing an interview created with a known resume keeps `resume_id` and exposes AI/HR/business fields through the card.
- [ ] Run the focused tests and confirm the association is absent or incomplete.
- [ ] Persist `resume_id` during new/synced interview creation; use unique fallback matching only for legacy rows and return an ambiguity response otherwise.
- [ ] Run reminder and card tests together and confirm no duplicate-name regression.

### Task 5: Verify build and compatibility

**Files:**
- No production file changes expected.

**Steps:**

- [ ] Run Worker focused and full tests.
- [ ] Run frontend focused and full tests.
- [ ] Run TypeScript checks and production build.
- [ ] Verify the public page at desktop and mobile widths with a populated fixture and an empty/test candidate.
- [ ] Inspect the final diff and confirm no Feishu message URL or write API changed.
