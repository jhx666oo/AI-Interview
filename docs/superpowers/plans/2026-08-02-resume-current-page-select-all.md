# Resume Current-Page Select-All Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a current-page select-all checkbox to the resume card list while preserving selected IDs from other pages.

**Architecture:** Derive the current page’s visible ID set from the existing paginated resume data. Use set union/difference against existing `selectedRowKeys`, so selection remains globally stored but the new control only affects visible cards.

**Tech Stack:** React 19, TypeScript, Ant Design Checkbox, Vite.

## Global Constraints

- The control selects and clears only the current pagination page.
- Existing selected IDs from other pages must survive every current-page toggle.
- Keep batch approval, rejection, deletion, confirmation dialogs, and card checkboxes unchanged.
- Do not stage `frontend/.wrangler.local.toml` or `.superpowers/`.

---

### Task 1: Add current-page selection state and control

**Files:**
- Modify: `frontend/src/pages/Resumes/List.tsx`
- Test: `frontend/src/pages/Resumes/List.tsx` exported pure selection helper, or the existing frontend test setup if available.

**Interfaces:**
- Produces `toggleCurrentPageSelection(selected, currentPageIds, checked): React.Key[]`.

- [ ] **Step 1: Add a failing pure behavior check**

```ts
expect(toggleCurrentPageSelection(['other-page'], ['page-1', 'page-2'], true)).toEqual(['other-page', 'page-1', 'page-2']);
expect(toggleCurrentPageSelection(['other-page', 'page-1', 'page-2'], ['page-1', 'page-2'], false)).toEqual(['other-page']);
```

- [ ] **Step 2: Run the check and verify the helper is absent**

Run: `cd frontend && npm run build`

Expected: TypeScript fails until the helper is exported and used.

- [ ] **Step 3: Implement the minimal selection helper and checkbox**

```tsx
const currentPageIds = paginatedData.map((resume) => resume.id);
const selectedOnPage = currentPageIds.filter((id) => selectedRowKeys.includes(id));
const allCurrentPageSelected = currentPageIds.length > 0 && selectedOnPage.length === currentPageIds.length;
const someCurrentPageSelected = selectedOnPage.length > 0 && !allCurrentPageSelected;

<Checkbox
  checked={allCurrentPageSelected}
  indeterminate={someCurrentPageSelected}
  disabled={currentPageIds.length === 0}
  onChange={(event) => setSelectedRowKeys((previous) => toggleCurrentPageSelection(previous, currentPageIds, event.target.checked))}
>全选本页</Checkbox>
```

The helper uses `Set` to union selected IDs when checked and filters only `currentPageIds` when cleared. Place it next to the existing `已选 N 项` toolbar, before batch action buttons.

- [ ] **Step 4: Run production build and manually verify state transitions**

Run: `cd frontend && npm run build`

Expected: TypeScript and Vite pass. In the browser: select one card (checkbox becomes indeterminate), select all current page, go to another page and select one card, return and clear current page; the other-page card remains selected.

- [ ] **Step 5: Commit**

Run: `git add frontend/src/pages/Resumes/List.tsx && git commit -m "feat: add current-page resume selection"`

## Plan Self-Review

- Coverage: Defines the control, exact current-page-only semantics, cross-page preservation, visual checked/indeterminate states, build verification, and manual state matrix.
- Placeholder scan: no deferred behavior or ambiguous scope remains.
- Type consistency: the selection state stays `React.Key[]`, matching the existing `selectedRowKeys` state.
