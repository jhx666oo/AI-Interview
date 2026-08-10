# Resume Edit Endpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the missing D1-backed `PUT /api/resumes/:id` endpoint so HR/Admin users can save the resume detail page's editable contact fields.

**Architecture:** Keep the existing React form and D1-first resume detail flow unchanged. Add a narrowly scoped Worker route with an explicit field allowlist, update only the D1 `resumes` row, and return the updated row; Feishu remains an optional mirror and is not required for a successful edit.

**Tech Stack:** Hono on Cloudflare Workers, Cloudflare D1, TypeScript, Vitest, React/Ant Design (existing frontend).

## Global Constraints

- The editable field allowlist is exactly `candidate_name`, `email`, and `contact`.
- Only authenticated `admin` and `hr` users may edit resumes.
- A missing D1 resume returns HTTP 404 and must not create a record or call Feishu.
- The endpoint must update `updated_at` and use parameterized D1 bindings.
- The frontend contract remains `PUT /api/resumes/:id`; no frontend route or payload change is required.

### Task 1: Define and test the resume edit payload contract

**Files:**
- Modify: `worker/src/index.ts` near the D1 helper exports
- Create: `worker/tests/resume-edit.test.ts`

**Interfaces:**
- Produces `normalizeResumeEditPayload(body: Record<string, unknown>): Record<string, string>` for the route.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { normalizeResumeEditPayload } from '../src/index';

describe('resume edit payload', () => {
  it('keeps only editable fields and trims text values', () => {
    expect(normalizeResumeEditPayload({
      candidate_name: '  张三 ',
      email: ' zhang@example.com ',
      contact: ' 13800000000 ',
      status: 'approved',
      ai_evaluation: '{}',
    })).toEqual({
      candidate_name: '张三',
      email: 'zhang@example.com',
      contact: '13800000000',
    });
  });

  it('allows partial updates and ignores undefined values', () => {
    expect(normalizeResumeEditPayload({ candidate_name: '李四', email: undefined })).toEqual({ candidate_name: '李四' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run worker/tests/resume-edit.test.ts`

Expected: FAIL because `normalizeResumeEditPayload` is not exported yet.

- [ ] **Step 3: Write the minimal implementation**

```ts
export function normalizeResumeEditPayload(body: Record<string, unknown>): Record<string, string> {
  const updates: Record<string, string> = {};
  for (const field of ['candidate_name', 'email', 'contact']) {
    if (body[field] === undefined) continue;
    updates[field] = typeof body[field] === 'string' ? body[field].trim() : String(body[field] ?? '').trim();
  }
  return updates;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run worker/tests/resume-edit.test.ts`

Expected: 2 tests pass.

### Task 2: Add the D1 resume edit route

**Files:**
- Modify: `worker/src/index.ts` immediately after `GET /api/resumes/:id` and before `/file` routes

**Interfaces:**
- Consumes `normalizeResumeEditPayload` from Task 1.
- Produces authenticated `PUT /api/resumes/:id` with `{ candidate_name?, email?, contact? }` JSON input.

- [ ] **Step 1: Add the route with role and existence checks**

```ts
app.put('/api/resumes/:id', authMiddleware, requireRole(['admin', 'hr']), async (c) => {
  try {
    const id = c.req.param('id');
    const existing = await c.env.DB.prepare('SELECT id FROM resumes WHERE id = ?').bind(id).first();
    if (!existing) return c.json({ detail: 'Not found' }, 404);

    const body = await c.req.json().catch(() => ({}));
    const updates = normalizeResumeEditPayload(body && typeof body === 'object' ? body : {});
    const fields = Object.keys(updates);
    if (fields.length === 0) return c.json({ detail: 'No editable fields' }, 400);

    const assignments = fields.map((field) => `${field} = ?`).join(', ');
    await c.env.DB.prepare(
      `UPDATE resumes SET ${assignments}, updated_at = ? WHERE id = ?`
    ).bind(...fields.map((field) => updates[field]), now(), id).run();

    const row = await c.env.DB.prepare('SELECT * FROM resumes WHERE id = ?').bind(id).first();
    return c.json(transformRow(row as Record<string, any>));
  } catch (e: any) {
    return c.json({ detail: '更新失败: ' + e.message }, 500);
  }
});
```

- [ ] **Step 2: Run focused tests and type/build checks**

Run: `npm test -- --run` from `worker/`, then `npm run build` from `frontend/`.

Expected: all existing Worker tests pass and the frontend build emits `frontend/dist/_worker.js` successfully.

### Task 3: Verify the production-shaped API flow and commit

**Files:**
- Test: `http://127.0.0.1:8788/api/resumes/:id` against the local D1 mirror

- [ ] **Step 1: Run local API regression**

Authenticate with the local admin account, select one existing local resume, PUT the three editable fields, GET the same resume, and assert the values persist and the list count is unchanged. Restore the original values afterward so the local mirror remains unchanged.

- [ ] **Step 2: Run deployment preflight**

Run: `node scripts/pre-deploy-check.mjs` from the repository root.

Expected: `== 自检通过：0 项失败 ==`.

- [ ] **Step 3: Commit the implementation**

```bash
git add worker/src/index.ts worker/tests/resume-edit.test.ts docs/superpowers/plans/2026-08-10-resume-edit-endpoint.md
git commit -m "fix: add resume edit endpoint"
```

- [ ] **Step 4: Publish only after explicit production approval**

Push the commit to `main` and rely on the existing Cloudflare GitHub Actions workflow to deploy D1, Pages, and the resume consumer; verify the workflow and production health endpoint before reporting success.
