# Position Capability Description Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure saving a position's capability descriptions updates only that position, while allowing identical capability names to have different descriptions across positions.

**Architecture:** Keep the existing position-level `capability_dimensions` payload and CRUD endpoints. Remove the frontend's cross-position synchronization option and batch update loop; no database migration is needed.

**Tech Stack:** React, TypeScript, Ant Design, Vite, Vitest-style unit tests already present in `frontend/src`.

## Global Constraints

- Existing position data must not be rewritten by this change.
- Capability names remain reusable; descriptions are position-scoped.
- No backend API contract changes.

---

### Task 1: Add a regression test for position-scoped saves

**Files:**
- Create: `frontend/src/pages/Positions/capabilitySave.ts`
- Create: `frontend/src/pages/Positions/capabilitySave.test.ts`
- Modify: `frontend/src/pages/Positions/List.tsx:540-600`

**Interfaces:**
- Test a pure helper exported from `List.tsx` that returns the current-position payload without cross-position updates.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { buildPositionCapabilitySave } from './List';

describe('buildPositionCapabilitySave', () => {
  it('keeps same-named capability descriptions scoped to the edited position', () => {
    const result = buildPositionCapabilitySave({
      title: '软件产品经理（智能硬件方向）',
      capability_dimensions: [{ name: '任职要求', description: '产品经理描述' }],
    });

    expect(result.payload.capability_dimensions).toBe(
      JSON.stringify([{ name: '任职要求', description: '产品经理描述' }]),
    );
    expect(result.crossPositionUpdates).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/Positions/capabilitySave.test.ts`

Expected: FAIL because `buildPositionCapabilitySave` is not yet exported.

- [ ] **Step 3: Write the minimal implementation**

Add the helper in `capabilitySave.ts`:

```ts
export function buildPositionCapabilitySave(values: { title?: string; capability_dimensions?: unknown[] }) {
  const dims = Array.isArray(values.capability_dimensions) ? values.capability_dimensions : [];
  return {
    payload: { ...values, capability_dimensions: JSON.stringify(dims) },
    crossPositionUpdates: [],
  };
}
```

Use the helper in `handleOk`, remove the `syncDescriptions` state, checkbox, and all-position update loop. Keep the existing create/update request unchanged except for the helper-produced payload.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/pages/Positions/capabilitySave.test.ts`

Expected: PASS.

- [ ] **Step 5: Run frontend validation**

Run: `cd frontend && npm run build`

Expected: TypeScript and Vite build complete successfully.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/Positions/List.tsx frontend/src/pages/Positions/capabilitySave.test.ts
git commit -m "fix: isolate capability descriptions by position"
```
