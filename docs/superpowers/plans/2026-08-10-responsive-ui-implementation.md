# Responsive UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the React/Ant Design application usable at desktop widths, browser zoom levels up to 200%, and narrow viewports without changing business behavior or backend contracts.

**Architecture:** Add a small, pure viewport-mode module and a reusable responsive layout layer. The shell will use the mode for sidebar/header behavior, while CSS media queries handle spacing, wrapping, grid density, and modal/table containment. Pages will migrate in risk-ranked batches; API calls, routes, permissions, and data structures remain untouched.

**Tech Stack:** React 19, TypeScript 5.9, Ant Design 6, Vite 7, Vitest 4, existing CSS in `frontend/src/index.css`.

## Global Constraints

- Do not change API URLs, HTTP methods, request payloads, response fields, routes, permissions, D1 schema, queues, R2, Feishu, or AI configuration.
- Do not use `zoom`, `transform: scale()`, or a viewport setting that disables browser zoom.
- Keep existing colors, border radii, shadows, and desktop visual hierarchy.
- Page-level horizontal scrolling must remain disabled; wide tables may scroll only inside their own container.
- No business action may be removed; narrow layouts may wrap or move low-frequency actions into an explicit “更多” menu.
- Validate at 1920×1080, 1440×900, 1280×720, 1024×768, 768×1024, and 390×844; include 100%–200% zoom on desktop sizes.
- Run frontend tests/build and Worker tests before each integration checkpoint.
- Do not deploy production or modify production data as part of this plan.

---

## File Map

Create the following focused layout files:

- `frontend/src/components/Layout/responsive.ts` — viewport mode type, breakpoints, pure classifier, and viewport subscription hook.
- `frontend/src/components/Layout/responsive.test.ts` — boundary tests for the classifier.
- `frontend/src/components/Responsive/PageHeader.tsx` — title, description, and primary/secondary actions.
- `frontend/src/components/Responsive/ResponsiveToolbar.tsx` — responsive filter and action wrapper.
- `frontend/src/components/Responsive/TableViewport.tsx` — table-only horizontal scrolling container.
- `frontend/src/components/Responsive/ResponsiveModal.tsx` — Ant Design Modal wrapper with viewport-safe width.
- `frontend/src/components/Responsive/index.ts` — public exports for the four components.
- `frontend/src/components/Responsive/index.test.ts` — Vitest export contract for the primitives.

Modify these existing files in migration order:

- `frontend/src/index.css`
- `frontend/src/components/Layout/index.tsx`
- `frontend/src/pages/Requisitions/List.tsx`
- `frontend/src/pages/Resumes/List.tsx`
- `frontend/src/pages/Resumes/Detail.tsx`
- `frontend/src/pages/DailyReports/List.tsx`
- `frontend/src/pages/Dashboard/index.tsx`
- `frontend/src/pages/Dashboard/components/PositionSummaryTable.tsx`
- `frontend/src/pages/Dashboard/components/RecruitingBoardView.tsx`
- Remaining pages containing tables, forms, cards, or fixed-width toolbars: `Positions`, `Interviews`, `Onboarding`, `Probation`, `TalentPool`, `Settings`, `JDManagement`, `Workflows`, `Reviews`, and `Public` pages.

## Task 1: Add a Testable Viewport Mode Classifier

**Files:**
- Create: `frontend/src/components/Layout/responsive.ts`
- Test: `frontend/src/components/Layout/responsive.test.ts`

**Interfaces:**
- Produces `LayoutMode = 'desktop' | 'compact' | 'mobile' | 'narrow'`.
- Produces `getLayoutMode(width: number): LayoutMode`.
- Produces `useViewportWidth(): number` for the shell; the hook only subscribes to `resize` and never touches business state.

- [ ] **Step 1: Write the failing boundary tests.**

```ts
import { describe, expect, it } from 'vitest';
import { getLayoutMode } from './responsive';

describe('getLayoutMode', () => {
  it.each([
    [1920, 'desktop'],
    [1200, 'desktop'],
    [1199, 'compact'],
    [768, 'compact'],
    [767, 'mobile'],
    [480, 'mobile'],
    [479, 'narrow'],
    [390, 'narrow'],
  ])('maps %dpx to %s', (width, expected) => {
    expect(getLayoutMode(width)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run the targeted test and verify it fails because the module does not exist.**

Run from `frontend`:

```bash
npx vitest run src/components/Layout/responsive.test.ts
```

Expected result: FAIL with a module-not-found error for `./responsive`.

- [ ] **Step 3: Implement the classifier and viewport hook.**

```ts
import { useSyncExternalStore } from 'react';

export type LayoutMode = 'desktop' | 'compact' | 'mobile' | 'narrow';

export function getLayoutMode(width: number): LayoutMode {
  if (width >= 1200) return 'desktop';
  if (width >= 768) return 'compact';
  if (width >= 480) return 'mobile';
  return 'narrow';
}

const getWidth = () => (typeof window === 'undefined' ? 1440 : window.innerWidth);
const subscribe = (onStoreChange: () => void) => {
  window.addEventListener('resize', onStoreChange);
  return () => window.removeEventListener('resize', onStoreChange);
};

export function useViewportWidth(): number {
  return useSyncExternalStore(subscribe, getWidth, () => 1440);
}
```

- [ ] **Step 4: Run the targeted test and the TypeScript check.**

```bash
npx vitest run src/components/Layout/responsive.test.ts
npx tsc -b --pretty false
```

Expected result: 8 boundary cases pass and TypeScript exits with code 0.

- [ ] **Step 5: Commit the isolated helper.**

```bash
git add frontend/src/components/Layout/responsive.ts frontend/src/components/Layout/responsive.test.ts
git commit -m "feat: add responsive layout mode classifier"
```

## Task 2: Add Responsive Layout Primitives and CSS Tokens

**Files:**
- Create: `frontend/src/components/Responsive/PageHeader.tsx`
- Create: `frontend/src/components/Responsive/ResponsiveToolbar.tsx`
- Create: `frontend/src/components/Responsive/TableViewport.tsx`
- Create: `frontend/src/components/Responsive/ResponsiveModal.tsx`
- Create: `frontend/src/components/Responsive/index.ts`
- Modify: `frontend/src/index.css`

**Interfaces:**
- `PageHeader` accepts `{ title: ReactNode; description?: ReactNode; actions?: ReactNode }`.
- `ResponsiveToolbar` accepts `{ children: ReactNode; actions?: ReactNode }`.
- `TableViewport` accepts `{ children: ReactNode; className?: string }`.
- `ResponsiveModal` accepts all Ant Design `ModalProps` and adds the `responsive-modal` class.

- [ ] **Step 1: Add a failing export contract test for the presentation primitives.**

Create `frontend/src/components/Responsive/index.test.ts` using only the existing Vitest dependency:

```ts
import { describe, expect, it } from 'vitest';
import { PageHeader, ResponsiveToolbar, TableViewport, ResponsiveModal } from './index';

describe('responsive layout primitives', () => {
  it('exports all four components', () => {
    expect(PageHeader).toBeTypeOf('function');
    expect(ResponsiveToolbar).toBeTypeOf('function');
    expect(TableViewport).toBeTypeOf('function');
    expect(ResponsiveModal).toBeTypeOf('function');
  });
});
```

Run `npx vitest run src/components/Responsive/index.test.ts`. Expected result: FAIL because `./index` does not exist.

- [ ] **Step 2: Implement the four primitives with no data fetching.**

Use these structures:

```tsx
import type { ReactNode } from 'react';
import { Modal, type ModalProps } from 'antd';

export interface PageHeaderProps { title: ReactNode; description?: ReactNode; actions?: ReactNode; }
export interface ResponsiveToolbarProps { children: ReactNode; actions?: ReactNode; }
export interface TableViewportProps { children: ReactNode; className?: string; }

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return <div className="responsive-page-header">
    <div className="responsive-page-header__copy">
      <h1>{title}</h1>
      {description ? <p>{description}</p> : null}
    </div>
    {actions ? <div className="responsive-page-header__actions">{actions}</div> : null}
  </div>;
}

export function ResponsiveToolbar({ children, actions }: ResponsiveToolbarProps) {
  return <div className="responsive-toolbar">
    <div className="responsive-toolbar__fields">{children}</div>
    {actions ? <div className="responsive-toolbar__actions">{actions}</div> : null}
  </div>;
}

export function TableViewport({ children, className = '' }: TableViewportProps) {
  return <div className={`table-viewport ${className}`}>{children}</div>;
}

export function ResponsiveModal({ className = '', ...props }: ModalProps) {
  return <Modal {...props} className={`responsive-modal ${className}`} />;
}
```

- [ ] **Step 3: Add scoped CSS and responsive tokens.**

Add the following behavior to `frontend/src/index.css` without changing the existing color tokens:

```css
:root {
  --page-gutter: 32px;
  --card-gutter: 24px;
  --control-gap: 12px;
}

.app-shell, .app-shell .ant-layout, .page-container { min-width: 0; max-width: 100%; }
.responsive-page-header { display: flex; gap: 16px; justify-content: space-between; align-items: flex-end; min-width: 0; margin-bottom: 20px; }
.responsive-page-header__copy, .responsive-page-header__actions, .responsive-toolbar__fields, .responsive-toolbar__actions { min-width: 0; }
.responsive-page-header h1 { margin: 0; font-size: 24px; line-height: 1.25; overflow-wrap: anywhere; }
.responsive-page-header p { margin: 4px 0 0; color: var(--text-secondary); }
.responsive-page-header__actions, .responsive-toolbar__fields, .responsive-toolbar__actions { display: flex; gap: var(--control-gap); flex-wrap: wrap; align-items: center; }
.responsive-toolbar { display: flex; gap: 16px; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; min-width: 0; }
.table-viewport { min-width: 0; max-width: 100%; overflow-x: auto; overflow-y: hidden; }
.responsive-modal .ant-modal { max-width: calc(100vw - 32px); }
@media (max-width: 1199px) { :root { --page-gutter: 24px; --card-gutter: 16px; } }
@media (max-width: 767px) { :root { --page-gutter: 16px; --card-gutter: 12px; --control-gap: 8px; } .responsive-page-header { align-items: flex-start; flex-direction: column; } .responsive-page-header__actions, .responsive-toolbar__fields, .responsive-toolbar__actions { width: 100%; } }
@media (max-width: 479px) { :root { --page-gutter: 12px; } .responsive-page-header h1 { font-size: 20px; } .responsive-toolbar__fields > * { flex: 1 1 100%; min-width: 0; } }
```

Also remove or scope the global table/card padding rules that currently force large widths; preserve their values for desktop through the new tokens.

- [ ] **Step 4: Run frontend tests and build.**

```bash
npm test -- --reporter=dot
npm run build
```

Expected result: existing tests pass and the Vite build emits `frontend/dist/_worker.js` successfully.

- [ ] **Step 5: Commit the primitives.**

```bash
git add frontend/src/components/Responsive frontend/src/index.css
git commit -m "feat: add responsive layout primitives"
```

## Task 3: Make the Application Shell Responsive

**Files:**
- Modify: `frontend/src/components/Layout/index.tsx`
- Modify: `frontend/src/index.css`

**Interfaces:**
- Consumes `useViewportWidth` and `getLayoutMode` from Task 1.
- Produces desktop, compact, mobile, and narrow shell behavior without changing menu item definitions or navigation callbacks.

- [ ] **Step 1: Add shell mode state and verify the current shell remains unchanged at 1440px.**

Inside `AppLayout`, add:

```ts
const viewportWidth = useViewportWidth();
const layoutMode = getLayoutMode(viewportWidth);
const isMobile = layoutMode === 'mobile' || layoutMode === 'narrow';
const isCompact = layoutMode === 'compact';
```

Run the local app at 1440px and confirm the current expanded sidebar, full header, owner selector, notification, and username are present before continuing.

- [ ] **Step 2: Implement compact and mobile sidebar behavior.**

Import `Drawer` from `antd` and keep the existing `filteredMenuItems`, `selectedKeys`, and `navigate` callback. Add `const [mobileMenuOpen, setMobileMenuOpen] = useState(false)`. Use:

```tsx
{isMobile ? (
  <Drawer open={mobileMenuOpen} onClose={() => setMobileMenuOpen(false)} placement="left" width={280}>
    <Menu items={filteredMenuItems} selectedKeys={[location.pathname]} onClick={({ key }) => { setMobileMenuOpen(false); navigate(key); }} />
  </Drawer>
) : (
  <Sider collapsed={isCompact || collapsed} ... />
)}
```

The mobile menu button is rendered only in the Header; no route or permission logic is duplicated.

- [ ] **Step 3: Make Header regions shrink safely.**

Wrap title, owner selector, and user actions in named classes. Hide username in compact mode, replace the owner selector with a filter trigger in mobile mode, and set `min-width: 0` plus single-line ellipsis on the title. Remove the fixed vertical alignment dependency on `line-height: 64px`.

- [ ] **Step 4: Make Content use responsive gutters and prevent page overflow.**

Add `className="app-shell"` to the outer Layout and use `style={{ margin: 0, minHeight: '100vh' }}` plus CSS variables for Content padding. The Layout offset remains 200px, 80px, or 0px according to mode.

- [ ] **Step 5: Verify shell behavior at all four mode boundaries.**

Run:

```bash
npx vitest run src/components/Layout/responsive.test.ts
npm run build
```

Then use the local browser at widths 1440, 1024, 768, 390. Expected: no page-level horizontal scrollbar, mobile drawer opens and navigates, and the owner filter remains reachable.

- [ ] **Step 6: Commit the shell.**

```bash
git add frontend/src/components/Layout/index.tsx frontend/src/index.css
git commit -m "feat: make application shell responsive"
```

## Task 4: Migrate Requirements Management

**Files:**
- Modify: `frontend/src/pages/Requisitions/List.tsx`

**Interfaces:**
- Consumes `PageHeader`, `ResponsiveToolbar`, `TableViewport`, and `ResponsiveModal`.
- Keeps `fetchData`, `handleFeishuSync`, selection state, batch status/delete handlers, and form fields unchanged.

- [ ] **Step 1: Move Card `extra` controls into `ResponsiveToolbar`.**

Replace the current `Card title + extra={<Space wrap>...}` with:

```tsx
<PageHeader title="人力需求管理" actions={<Space wrap>...</Space>} />
<Card>
  <ResponsiveToolbar actions={<Space wrap>...</Space>}>
    <Input placeholder="搜索部门" ... />
    <Select placeholder="状态筛选" ... />
  </ResponsiveToolbar>
  ...existing selection controls...
</Card>
```

Do not change the input values, change handlers, or status options.

- [ ] **Step 2: Wrap the Table and preserve all columns.**

Use:

```tsx
<TableViewport>
  <Table scroll={{ x: 1400 }} ... />
</TableViewport>
```

Keep the existing `columns`, `rowKey`, selection callbacks, pagination, and action handlers. The only permitted table changes are container classes and responsive density.

- [ ] **Step 3: Replace the fixed-width modal wrapper.**

Use `<ResponsiveModal width={640} ...>` for create/edit while preserving `Form`, `Row`, `Col`, validation rules, submit handler, and modal state.

- [ ] **Step 4: Verify requirements behavior and responsive layout.**

Run the existing frontend test suite and build. Manually verify search, status filter, Feishu import, create, edit, selection, batch status, batch delete, and table scroll at 1440px and 390px.

- [ ] **Step 5: Commit the page migration.**

```bash
git add frontend/src/pages/Requisitions/List.tsx
git commit -m "feat: make requisitions page responsive"
```

## Task 5: Migrate Resume Management and Candidate Cards

**Files:**
- Modify: `frontend/src/pages/Resumes/List.tsx`

**Interfaces:**
- Keeps all resume request functions, selection helpers, filters, pagination, upload handlers, AI tools, and navigation callbacks unchanged.
- Consumes `PageHeader`, `ResponsiveToolbar`, `ResponsiveModal`, and `TableViewport` where existing modals or table-like regions require them.

- [ ] **Step 1: Move the page title and upload/action buttons into `PageHeader`.**

Keep every existing button and callback. Group primary actions (`上传简历`, `导出 Excel`, `BOSS导入`, `飞书导入`) separately from secondary actions (`刷新数据`, `AI工具`) so they wrap without compressing the title.

- [ ] **Step 2: Convert the four statistics columns to responsive spans.**

Use Ant Design responsive props:

```tsx
<Col xs={24} sm={12} md={12} lg={6}>...</Col>
```

Keep each existing `Statistic` value, suffix, color, and label unchanged.

- [ ] **Step 3: Move all filters and batch actions into `ResponsiveToolbar`.**

Keep the state variables and handlers exactly as they are. Place status, position, major, education, age, and gender controls in the fields area; place selected-count, batch actions, page select-all, search, and reset in the actions area. Use `min-width: 0` on each field wrapper.

- [ ] **Step 4: Refactor the candidate card header into wrap-safe regions.**

Replace the single top Flex row with:

```tsx
<div className="resume-card__header">
  <div className="resume-card__identity">checkbox, name, summary</div>
  <div className="resume-card__status">position and status tags</div>
  <div className="resume-card__actions">existing action buttons</div>
</div>
```

The identity name must use `flex: 0 0 auto`; summary and tags may shrink/wrap; actions may wrap to a second row. Do not change the `navigate`, selection, `renderActionButtons`, or AI evaluation calculations.

- [ ] **Step 5: Make AI dimensions and long labels wrap safely.**

Keep every score, dimension, gate result, hard requirement result, and Tooltip. Add class-scoped `flex-wrap`, `max-width: 100%`, `overflow-wrap`, and ellipsis rules. No score text or dimension is removed.

- [ ] **Step 6: Apply `ResponsiveModal` to upload, interview, email preview, and other existing modals.**

Preserve modal widths, form names, validation, upload limits, and submit callbacks; only use the wrapper and responsive `Row/Col` spans where the current form is multi-column.

- [ ] **Step 7: Verify resume workflows.**

Run frontend tests/build and manually verify upload, multi-select, current-page select-all, filters, batch入库/淘汰/删除, AI tools, card navigation, interview scheduling, and email preview at 1440px, 768px, and 390px.

- [ ] **Step 8: Commit the resume page migration.**

```bash
git add frontend/src/pages/Resumes/List.tsx frontend/src/index.css
git commit -m "feat: make resume management responsive"
```

## Task 6: Migrate Resume Detail and Long-Form Panels

**Files:**
- Modify: `frontend/src/pages/Resumes/Detail.tsx`
- Modify: `frontend/src/components/PdfViewer.tsx` only if the existing preview container still causes page-level overflow.

**Interfaces:**
- Keeps PDF loading, field editing, save/cancel, AI analysis, re-evaluation, and all request calls unchanged.

- [ ] **Step 1: Preserve the two desktop columns and add responsive stacking classes.**

Keep the PDF preview and analysis panel as two flex children with `min-width: 0`; at `<768px`, set `flex-direction: column` and give both panels `width: 100%`.

- [ ] **Step 2: Make the candidate header and edit controls wrap.**

Keep name, email, phone, status, save, and cancel controls. Use a wrapping action row and replace fixed input widths with `width: 100%` inside their grid cells on narrow screens.

- [ ] **Step 3: Constrain AI review content.**

Keep the existing `aiContentStyle`, Tags, strengths, risks, dimensions, and review text. Add `max-width: 100%`, `overflow-wrap: anywhere`, and vertical scrolling only to the analysis panel where content is intentionally long.

- [ ] **Step 4: Run TypeScript/build and manually verify save/cancel and PDF preview at 390px.**

- [ ] **Step 5: Commit the detail migration.**

```bash
git add frontend/src/pages/Resumes/Detail.tsx frontend/src/components/PdfViewer.tsx
git commit -m "feat: make resume detail responsive"
```

## Task 7: Migrate Dashboard and Daily Reports

**Files:**
- Modify: `frontend/src/pages/Dashboard/index.tsx`
- Modify: `frontend/src/pages/Dashboard/components/PositionSummaryTable.tsx`
- Modify: `frontend/src/pages/Dashboard/components/RecruitingBoardView.tsx`
- Modify: `frontend/src/pages/DailyReports/List.tsx`

**Interfaces:**
- Keep dashboard and daily-report API calls, snapshot normalization, Feishu send actions, filters, table columns, owner rows, and report details unchanged.

- [ ] **Step 1: Replace dashboard fixed-width filter controls with responsive toolbar fields.**

Keep `division`, `hrbp`, `priority`, and `status` values and callbacks. Allow fields to wrap while preserving the same option lists.

- [ ] **Step 2: Change dashboard statistic cards to responsive grid spans.**

Use four columns on large screens, two on medium screens, and one on narrow screens. Keep all metric labels, colors, and values.

- [ ] **Step 3: Contain dashboard tables and charts.**

Wrap position summary and detail tables in `TableViewport`; set chart containers to `min-width: 0` and a non-zero responsive height to avoid Recharts width/height warnings. Do not change chart data.

- [ ] **Step 4: Make daily-report cards, detail modal, owner table, and Feishu-synced snapshot table responsive.**

Keep `renderSnapshotTable`, v2/legacy normalization, owner rows, totals, warning text, candidate groups, send-to-Feishu action, and AI summary. Only change wrapper widths, cell density, and modal max width.

- [ ] **Step 5: Verify dashboard and daily-report behavior at 1440px, 1024px, 768px, and 390px.**

Check filters, cards, charts, table scrolling, report detail, Feishu send modal, and candidate links.

- [ ] **Step 6: Commit the dashboard/report migration.**

```bash
git add frontend/src/pages/Dashboard frontend/src/pages/DailyReports/List.tsx
git commit -m "feat: make dashboard and daily reports responsive"
```

## Task 8: Migrate Remaining Business and Settings Pages

**Files:**
- Modify: `frontend/src/pages/Positions/List.tsx`
- Modify: `frontend/src/pages/Positions/Form.tsx`
- Modify: `frontend/src/pages/Interviews/List.tsx`
- Modify: `frontend/src/pages/Interviews/Result.tsx`
- Modify: `frontend/src/pages/Interviews/Score.tsx`
- Modify: `frontend/src/pages/Onboarding/List.tsx`
- Modify: `frontend/src/pages/Probation/List.tsx`
- Modify: `frontend/src/pages/TalentPool/List.tsx`
- Modify: `frontend/src/pages/Settings/CapabilityDimensions.tsx`
- Modify: `frontend/src/pages/Settings/InterviewerMappings.tsx`
- Modify: `frontend/src/pages/Settings/PositionMappings.tsx`
- Modify: `frontend/src/pages/Settings/Users.tsx`
- Modify: `frontend/src/pages/Settings/Mail.tsx`
- Modify: `frontend/src/pages/Settings/System.tsx`
- Modify: `frontend/src/pages/JDManagement/List.tsx`
- Modify: `frontend/src/pages/JDManagement/Editor.tsx`
- Modify: `frontend/src/pages/Workflows/List.tsx`
- Modify: `frontend/src/pages/Workflows/Editor.tsx`
- Modify: `frontend/src/pages/Reviews/MyReviews.tsx`
- Modify: `frontend/src/pages/Public/JobDetail.tsx`
- Modify: `frontend/src/pages/Public/Review.tsx`

**Interfaces:**
- Each page consumes the shared responsive primitives and keeps its existing requests, tables, forms, dialogs, and actions.

- [ ] **Step 1: For each table page, wrap the existing table in `TableViewport` and remove page-level overflow.**

Do not remove columns or change `dataIndex`, `rowKey`, selection, sorting, pagination, or action renderers.

- [ ] **Step 2: For each form page, change Ant Design grid spans to `xs={24} sm={12} md={8}` or the page-specific equivalent.**

Keep form names, validation rules, initial values, and submit handlers unchanged.

- [ ] **Step 3: Replace fixed-width action headers and Card `extra` blocks with `PageHeader` or `ResponsiveToolbar`.**

Keep every button and callback; only change grouping and wrapping.

- [ ] **Step 4: Apply `ResponsiveModal` to fixed-width dialogs and constrain long text panels.**

- [ ] **Step 5: After each page group, run frontend tests/build and manually exercise its primary create/edit/delete/search flow.**

- [ ] **Step 6: Commit each coherent page group separately.**

Use these commit messages:

```bash
git commit -m "feat: make recruiting operations pages responsive"
git commit -m "feat: make settings pages responsive"
git commit -m "feat: make workflow and review pages responsive"
```

## Task 9: Full Regression and Visual Verification

**Files:**
- Modify: `docs/superpowers/specs/2026-08-10-responsive-ui-design.md` only if verification reveals a design decision that must be recorded.
- Create: `docs/superpowers/verification/2026-08-10-responsive-ui-verification.md`

- [ ] **Step 1: Run frontend unit tests.**

```bash
cd frontend
npm test -- --reporter=dot
```

Expected: all existing tests plus `responsive.test.ts` pass.

- [ ] **Step 2: Run frontend production build.**

```bash
npm run build
```

Expected: TypeScript, Vite, and `scripts/build-worker.cjs` complete successfully.

- [ ] **Step 3: Run Worker regression tests.**

```bash
cd ../worker
npm test -- --reporter=dot
```

Expected: all existing Worker tests pass; no Worker source or migration files are changed by this UI work.

- [ ] **Step 4: Run repository whitespace and status checks.**

```bash
cd ..
git diff --check
git status -sb
```

Expected: no whitespace errors and only intended responsive UI commits/files are present.

- [ ] **Step 5: Perform the visual matrix manually in the local app.**

Start the app:

```bash
cd frontend
npm run dev -- --host 127.0.0.1 --port 5173
```

Check `/requisitions`, `/resumes`, `/resumes/:id`, `/dashboard`, `/daily-reports`, `/positions`, `/interviews`, and `/settings/mail` at the widths and zoom levels in the design document. Record for each page: page-level horizontal overflow, clipped text, reachable actions, modal width, and table-only scrolling.

- [ ] **Step 6: Write the verification record with actual results.**

The verification record must include the exact test commands, pass counts, viewport matrix, and any known exceptions. Do not claim visual success without checking the listed pages.

- [ ] **Step 7: Commit the verification record.**

```bash
git add docs/superpowers/verification/2026-08-10-responsive-ui-verification.md
git commit -m "test: record responsive ui verification"
```

## Task 10: Integration Checkpoint and Release Decision

- [ ] **Step 1: Review the complete diff against the responsive design.**

Confirm that every design requirement maps to Tasks 1–9, no API/backend files were modified, and all business actions remain reachable.

- [ ] **Step 2: Run the final frontend and Worker checks again from a clean working tree.**

```bash
cd frontend && npm test -- --reporter=dot && npm run build
cd ../worker && npm test -- --reporter=dot
cd .. && git diff --check
```

- [ ] **Step 3: Create a preview deployment only if the user explicitly requests visual online review.**

Use the existing Cloudflare Preview workflow; do not deploy production as part of this plan. Production requires a separate explicit approval after the preview is accepted.

- [ ] **Step 4: Present the release decision.**

Report the branch, commits, test results, visual matrix, known limitations, and whether the user wants to merge to `main` and deploy.
