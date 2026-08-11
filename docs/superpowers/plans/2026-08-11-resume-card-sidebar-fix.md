# 简历卡片首行与侧边栏高度修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the original single-row resume-card header on desktop while keeping evaluation dimensions on their own horizontal row, and make the desktop/compact sidebar fill and track the application viewport reliably.

**Architecture:** Keep all API and business code untouched. Add semantic CSS hooks around the existing resume-card header groups, use desktop-only no-wrap with compact/mobile fallback, and replace fixed-position sidebar compensation with a flex/sticky shell layout while preserving the mobile Drawer path.

**Tech Stack:** React 19, TypeScript 5.9, Ant Design 6, existing CSS, Vitest 4.

## Global Constraints

- Do not change API URLs, HTTP methods, request payloads, response fields, routes, permissions, D1 schema, queues, R2, Feishu, or AI configuration.
- Keep the existing visual order and business actions in the resume card.
- Keep the AI dimension row independent from the card header; only its existing horizontal wrapping behavior may remain.
- Desktop header stays one row when the viewport has sufficient space; compact/mobile may wrap to remain usable.
- Mobile navigation remains an Ant Design Drawer.
- Page-level horizontal scrolling stays disabled; no new `zoom` or `transform: scale(...)` layout technique.

## File Map

- Modify `frontend/src/pages/Resumes/List.tsx`: preserve the existing semantic card groups and make their desktop single-row contract explicit.
- Modify `frontend/src/components/Layout/index.tsx`: let desktop/compact Sider participate in the outer flex layout instead of compensating for fixed positioning with `margin-left`.
- Modify `frontend/src/index.css`: define the sidebar sticky/flex height rules and desktop/compact/mobile resume-card header rules.
- Create `frontend/src/pages/Resumes/List.layout.test.ts`: source-level regression tests for row separation and header grouping.
- Create `frontend/src/components/Layout/layout-responsive.test.ts`: source/CSS regression tests for the shell’s sticky sidebar contract.

### Task 1: Add failing layout regression tests

**Files:**
- Create: `frontend/src/pages/Resumes/List.layout.test.ts`
- Create: `frontend/src/components/Layout/layout-responsive.test.ts`

- [ ] **Step 1: Write the failing tests.**

```ts
// List.layout.test.ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./List.tsx', import.meta.url), 'utf8');

describe('resume card layout contracts', () => {
  it('keeps header groups separate from the evaluation dimension row', () => {
    const headerStart = source.indexOf('className="resume-card__header"');
    const evaluationStart = source.indexOf('className="resume-card__evaluation"', headerStart);
    const dimensionsStart = source.indexOf('className="resume-card__dimensions"', evaluationStart);

    expect(headerStart).toBeGreaterThan(-1);
    expect(source.slice(headerStart, evaluationStart)).toContain('resume-card__identity');
    expect(source.slice(headerStart, evaluationStart)).toContain('resume-card__status');
    expect(source.slice(headerStart, evaluationStart)).toContain('resume-card__actions');
    expect(dimensionsStart).toBeGreaterThan(evaluationStart);
  });
});
```

```ts
// layout-responsive.test.ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const layout = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');

describe('application shell responsive contracts', () => {
  it('keeps desktop shell sizing in flex flow and uses a sticky sidebar', () => {
    expect(layout).toContain('className="app-shell__sider"');
    expect(layout).not.toContain("marginLeft: isMobile ? 0 : (isCompact || collapsed ? 80 : 200)");
    expect(css).toMatch(/\.app-shell__sider[\s\S]*?position:\s*sticky/);
    expect(css).toMatch(/\.app-shell__sider[\s\S]*?height:\s*100vh/);
  });
});
```

- [ ] **Step 2: Run only the new tests and confirm they fail for the current fixed/no-wrap implementation.**

Run:

```bash
cd frontend
npx vitest run src/pages/Resumes/List.layout.test.ts src/components/Layout/layout-responsive.test.ts
```

Expected: the card test may pass its existing semantic groups, but the shell test fails because the Sider is `position: fixed` and the main Layout still has the inline `marginLeft` compensation. If the card test passes, strengthen it with the missing desktop style assertion in Task 2 before implementation.

### Task 2: Restore desktop resume-card header layout

**Files:**
- Modify: `frontend/src/pages/Resumes/List.tsx` around the candidate card render block.
- Modify: `frontend/src/index.css` in the `.resume-card__*` rules and responsive media queries.
- Test: `frontend/src/pages/Resumes/List.layout.test.ts`

- [ ] **Step 1: Add a failing source assertion for the desktop no-wrap contract.**

```ts
it('declares a desktop single-row header with a narrow-screen fallback', () => {
  expect(css).toMatch(/\.resume-card__header\s*\{[\s\S]*?flex-wrap:\s*nowrap/);
  expect(css).toMatch(/@media \(max-width: 1199px\)[\s\S]*?\.resume-card__header[\s\S]*?flex-wrap:\s*wrap/);
});
```

Run the targeted test again and verify it fails because the base rule currently uses `flex-wrap: wrap`.

- [ ] **Step 2: Keep the existing JSX order and add no business behavior.**

The card must retain this order:

```tsx
<div className="resume-card__header">
  <div className="resume-card__identity">...</div>
  <div className="resume-card__status">...</div>
  <div className="resume-card__actions">...</div>
</div>
<div className="resume-card__evaluation">
  <div className="resume-card__evaluation-summary">...</div>
  <div className="resume-card__dimensions">...</div>
</div>
```

Do not move the dimension row into the header and do not change button handlers.

- [ ] **Step 3: Implement the CSS contract.**

Use this base desktop behavior:

```css
.resume-card__header {
  gap: 12px;
  flex-wrap: nowrap;
  margin-bottom: 8px;
  min-height: 32px;
}

.resume-card__identity {
  flex: 0 1 auto;
  white-space: nowrap;
}

.resume-card__status {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
}

.resume-card__actions {
  flex: 0 0 auto;
  margin-left: auto;
}

.resume-card__evaluation,
.resume-card__evaluation-summary,
.resume-card__dimensions {
  min-width: 0;
  max-width: 100%;
}

@media (max-width: 1199px) {
  .resume-card__header {
    flex-wrap: wrap;
  }

  .resume-card__status {
    white-space: normal;
    overflow: visible;
  }
}
```

At `max-width: 479px`, retain the existing action width rule and allow identity/summary text to wrap. The evaluation and dimension rows remain unchanged.

- [ ] **Step 4: Run targeted tests and frontend tests.**

```bash
cd frontend
npx vitest run src/pages/Resumes/List.layout.test.ts
npm test -- --reporter=dot
```

Expected: the targeted layout test and all frontend tests pass.

- [ ] **Step 5: Commit the resume-card fix.**

```bash
git add frontend/src/pages/Resumes/List.tsx frontend/src/index.css frontend/src/pages/Resumes/List.layout.test.ts
git commit -m "fix: restore resume card header layout"
```

### Task 3: Make the desktop/compact sidebar fill the shell

**Files:**
- Modify: `frontend/src/components/Layout/index.tsx`
- Modify: `frontend/src/index.css`
- Test: `frontend/src/components/Layout/layout-responsive.test.ts`

- [ ] **Step 1: Add failing assertions for the flex-flow sidebar contract.**

```ts
it('does not use fixed sidebar compensation on the desktop main layout', () => {
  expect(layout).not.toMatch(/style=\{\{\s*marginLeft:/);
  expect(css).toMatch(/\.app-shell\s*\{[\s\S]*?display:\s*flex/);
  expect(css).toMatch(/\.app-shell__sider\s*\{[\s\S]*?align-self:\s*flex-start/);
  expect(css).toMatch(/\.app-shell__menu\s*\{[\s\S]*?overflow-y:\s*auto/);
});
```

Run the targeted shell test and confirm it fails before changing the implementation.

- [ ] **Step 2: Remove only the fixed-position compensation.**

Keep `Sider` rendering for desktop/compact and `Drawer` rendering for mobile. Change the desktop main Layout to use its natural flex sibling relationship:

```tsx
<Layout className="app-shell__main">
```

Do not change owner filtering, menu items, collapse state, navigation handlers, or mobile Drawer behavior.

- [ ] **Step 3: Implement sticky/flex shell CSS.**

Replace the fixed sidebar rule with:

```css
.app-shell {
  display: flex;
  align-items: stretch;
  min-height: 100vh;
  overflow-x: clip;
}

.app-shell__sider {
  position: sticky !important;
  inset-block-start: 0;
  align-self: flex-start;
  height: 100vh;
  max-height: 100vh;
  z-index: 100;
  flex: 0 0 auto;
}

.app-shell__menu {
  height: calc(100vh - 64px);
  max-height: none;
  overflow-y: auto;
}

.app-shell__main {
  min-width: 0;
  flex: 1 1 auto;
  transition: none;
}
```

Keep the Drawer-specific max-height rules under the mobile media path. The main content remains `min-width: 0` and page-level horizontal overflow stays hidden.

- [ ] **Step 4: Run targeted shell test and full frontend tests/build.**

```bash
cd frontend
npx vitest run src/components/Layout/layout-responsive.test.ts
npm test -- --reporter=dot
npm run build
```

Expected: targeted shell test passes, all frontend tests pass, and the build emits the existing pdfjs eval warning only.

- [ ] **Step 5: Commit the sidebar fix.**

```bash
git add frontend/src/components/Layout/index.tsx frontend/src/index.css frontend/src/components/Layout/layout-responsive.test.ts
git commit -m "fix: make sidebar fill application shell"
```

### Task 4: Browser regression check and handoff

**Files:**
- Verify: `frontend/src/pages/Resumes/List.tsx`, `frontend/src/components/Layout/index.tsx`, `frontend/src/index.css`
- Reference: `docs/superpowers/specs/2026-08-11-resume-card-sidebar-fix-design.md`

- [ ] **Step 1: Run the complete frontend and Worker verification.**

```bash
cd frontend && npm test -- --reporter=dot && npm run build
cd ../worker && npm test -- --reporter=dot
cd .. && git diff --check
```

- [ ] **Step 2: Run the local browser matrix.**

Check `/resumes`, `/dashboard`, and `/settings/system` at widths 1440, 1024, 768, and 390. Confirm `document.documentElement.scrollWidth === innerWidth`, the card header is one row at 1440, the dimension row remains separate, and the sidebar covers the full viewport height at desktop/compact widths.

- [ ] **Step 3: Commit any verification record and report production status.**

Do not deploy from this plan. Report the branch, commits, test counts, local preview URL, and the fact that production remains unchanged until the user explicitly asks to publish.
