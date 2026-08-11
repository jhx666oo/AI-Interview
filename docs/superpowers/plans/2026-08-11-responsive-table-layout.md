# 宽表管理页自适应布局实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** 在不改变 API、数据和业务操作的前提下，让管理类宽表和仪表盘底部岗位明细在笔记本/小屏自动切换为可展开卡片，避免横向拖动。

**Architecture:** 新增 ResponsiveDataView 作为表格展示边界，使用容器实际宽度选择 full/compact/narrow 模式。full 模式继续渲染现有 Ant Design Table，其他模式使用同一份记录、列渲染和业务回调生成卡片；各页面只声明字段优先级和卡片操作。仪表盘底部岗位明细使用专用卡片适配器，保留事业部展开/收起和合计数据。

**Tech Stack:** React 19、TypeScript、Ant Design 6、Vitest 4、Vite 7、CSS Modules/全局 CSS、ResizeObserver。

## Global Constraints

- 只改造宽表管理页和仪表盘底部岗位明细；仪表盘上方、招聘日报、简历管理主列表保持现状。
- 不修改后端 API、D1 数据结构、权限逻辑、分页接口和业务状态机。
- 所有原表格字段必须在卡片详情中可见；空值统一显示 —。
- 所有现有编辑、删除、发布、同步、入库、AI 生成、批量选择、分页回调必须继续使用原函数。
- 不允许 body 级横向滚动；卡片模式不得依赖触摸板手势。
- 默认模式断点按组件内容区宽度：full >= 1180px、compact 760–1179px、narrow < 760px。
- 每个任务完成后运行对应测试并创建一个可回滚 commit。

---

## 文件与职责地图

| 文件 | 职责 |
|---|---|
| frontend/src/components/Responsive/responsiveDataView.tsx | 自适应表格/卡片组件和公共 props |
| frontend/src/components/Responsive/responsiveCardList.tsx | 卡片列表、详情展开、复选框和操作区 |
| frontend/src/components/Responsive/responsiveMode.ts | 容器宽度到三种模式的纯函数和 ResizeObserver Hook |
| frontend/src/components/Responsive/responsiveDataView.test.tsx | 模式、字段、选择和展开行为测试 |
| frontend/src/components/Responsive/index.ts | 导出公共组件和类型 |
| frontend/src/index.css | 卡片、详情、操作区和窄屏布局样式 |
| 各管理页 List.tsx/Editor.tsx | 提供 cardConfig，保留原数据请求和业务回调 |
| frontend/src/pages/Dashboard/components/PositionSummaryTable.tsx | 事业部/岗位明细卡片适配器 |

---

### Task 1: 建立容器模式计算与字段配置类型

**Files:**
- Create: frontend/src/components/Responsive/responsiveMode.ts
- Create: frontend/src/components/Responsive/responsiveMode.test.ts
- Create: frontend/src/components/Responsive/responsiveTypes.ts

**Interfaces:**
- Produces ResponsiveMode = 'full' | 'compact' | 'narrow'.
- Produces getResponsiveMode(width: number): ResponsiveMode.
- Produces useResponsiveMode(ref, testWidth?): ResponsiveMode, using ResizeObserver outside tests.
- Produces ResponsiveField<RecordType> and ResponsiveCardConfig<RecordType>.

- [ ] Step 1: Write the failing mode tests

~~~ts
import { describe, expect, it } from 'vitest';
import { getResponsiveMode } from './responsiveMode';

describe('getResponsiveMode', () => {
  it.each([
    [1180, 'full'],
    [1536, 'full'],
    [1179, 'compact'],
    [760, 'compact'],
    [759, 'narrow'],
    [390, 'narrow'],
  ])('maps %dpx to %s', (width, expected) => {
    expect(getResponsiveMode(width)).toBe(expected);
  });
});
~~~

- [ ] Step 2: Run the focused test and confirm it fails

Run from frontend:

~~~bash
npx vitest run src/components/Responsive/responsiveMode.test.ts
~~~

Expected: FAIL because responsiveMode.ts is not present.

- [ ] Step 3: Add the pure mode function and shared types

Implement:

~~~ts
export type ResponsiveMode = 'full' | 'compact' | 'narrow';

export function getResponsiveMode(width: number): ResponsiveMode {
  if (width >= 1180) return 'full';
  if (width >= 760) return 'compact';
  return 'narrow';
}
~~~

The hook accepts a React ref and optional test width. It initializes from testWidth when supplied; otherwise it observes the ref element, stores its clientWidth, and disconnects the observer on unmount. If the element is not measured yet, use full mode for the first render to keep desktop SSR output stable.

Define the field contract:

~~~ts
import type { ReactNode } from 'react';

export interface ResponsiveField<RecordType> {
  key: string;
  label: ReactNode;
  level: 'secondary' | 'detail';
  render: (record: RecordType, index: number) => ReactNode;
  hideWhenEmpty?: boolean;
}

export interface ResponsiveCardConfig<RecordType> {
  getKey?: (record: RecordType, index: number) => string | number;
  title: (record: RecordType, index: number) => ReactNode;
  subtitle?: (record: RecordType, index: number) => ReactNode;
  status?: (record: RecordType, index: number) => ReactNode;
  fields: ResponsiveField<RecordType>[];
  actions?: (record: RecordType, index: number) => ReactNode;
}
~~~

- [ ] Step 4: Run the focused tests

~~~bash
npx vitest run src/components/Responsive/responsiveMode.test.ts
~~~

Expected: 6 cases passed.

- [ ] Step 5: Commit

~~~bash
git add frontend/src/components/Responsive/responsiveMode.ts frontend/src/components/Responsive/responsiveMode.test.ts frontend/src/components/Responsive/responsiveTypes.ts
git commit -m "test: define responsive table modes"
~~~

### Task 2: Implement the reusable card list

**Files:**
- Create: frontend/src/components/Responsive/responsiveCardList.tsx
- Create: frontend/src/components/Responsive/responsiveCardList.test.tsx
- Modify: frontend/src/components/Responsive/responsiveTypes.ts

**Interfaces:**
- Consumes ResponsiveCardConfig<RecordType> from Task 1.
- Consumes Ant Design RowSelection<RecordType> for selection state.
- Produces ResponsiveCardList<RecordType> with keyboard-accessible details and preserved row keys.

- [ ] Step 1: Write the failing card behavior tests

Use a small record fixture and assert the rendered contract:

~~~tsx
const config: ResponsiveCardConfig<Row> = {
  getKey: row => row.id,
  title: row => row.name,
  subtitle: row => row.department,
  status: row => <Tag>{row.status}</Tag>,
  fields: [
    { key: 'city', label: '城市', level: 'secondary', render: row => row.city },
    { key: 'budget', label: '预算', level: 'detail', render: row => row.budget },
  ],
};

it('shows primary fields and expands all detail fields', async () => {
  render(<ResponsiveCardList data={[row]} card={config} />);
  expect(screen.getByText('招商主管')).toBeInTheDocument();
  expect(screen.queryByText('预算')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '展开招商主管详情' }));
  expect(screen.getByText('预算')).toBeInTheDocument();
});
~~~

Add a second test for rowSelection that asserts the card checkbox, aria-checked and onChange payload. Add a third test verifying hideWhenEmpty removes only empty fields.

- [ ] Step 2: Run focused tests and confirm the missing component failure

~~~bash
npx vitest run src/components/Responsive/responsiveCardList.test.tsx
~~~

Expected: FAIL because the card list component is not present.

- [ ] Step 3: Implement the card list

Implement these rules:

1. Render each record as an article inside a role=list container.
2. Render title, subtitle, status, all secondary fields and actions outside the detail panel.
3. Render detail fields only after clicking an aria-expanded button labelled with the title and “展开详情/收起详情”.
4. Use getKey when provided; use the array index only as a last-resort key.
5. If rowSelection is present, render a card checkbox and a top “全选当前页” checkbox, calling the existing onChange callback with the same selected-key shape.
6. Preserve getCheckboxProps disabled state and never mutate records.
7. Keep actions visible in compact and allow wrapping in narrow.

- [ ] Step 4: Run the card tests

~~~bash
npx vitest run src/components/Responsive/responsiveCardList.test.tsx
~~~

Expected: all selection, expansion and empty-field tests pass.

- [ ] Step 5: Commit

~~~bash
git add frontend/src/components/Responsive/responsiveCardList.tsx frontend/src/components/Responsive/responsiveCardList.test.tsx frontend/src/components/Responsive/responsiveTypes.ts
git commit -m "feat: add responsive data cards"
~~~

### Task 3: Add ResponsiveDataView and preserve desktop tables

**Files:**
- Create: frontend/src/components/Responsive/responsiveDataView.tsx
- Create: frontend/src/components/Responsive/responsiveDataView.test.tsx
- Modify: frontend/src/components/Responsive/index.ts
- Modify: frontend/src/components/Responsive/TableViewport.tsx

**Interfaces:**
- Consumes TableProps<RecordType> and ResponsiveCardConfig<RecordType>.
- Produces ResponsiveDataView<RecordType> with full/compact/narrow mode selection.

- [ ] Step 1: Write failing component tests

Cover full table, compact card and resize mode changes:

~~~tsx
it('renders Ant Table in full mode', () => {
  render(<ResponsiveDataView {...props} testWidth={1280} />);
  expect(screen.getByRole('table')).toBeInTheDocument();
});

it('renders cards in compact mode', () => {
  render(<ResponsiveDataView {...props} testWidth={1024} />);
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(screen.getByRole('list')).toBeInTheDocument();
});

it('updates mode when the container is resized', () => {
  const { rerender } = render(<ResponsiveDataView {...props} testWidth={1280} />);
  expect(screen.getByRole('table')).toBeInTheDocument();
  rerender(<ResponsiveDataView {...props} testWidth={700} />);
  expect(screen.getByRole('list')).toBeInTheDocument();
});
~~~

- [ ] Step 2: Run focused tests and confirm failure

~~~bash
npx vitest run src/components/Responsive/responsiveDataView.test.tsx
~~~

Expected: FAIL because ResponsiveDataView is not present.

- [ ] Step 3: Implement the component boundary

Use an Ant table prop surface plus the card config:

~~~ts
export interface ResponsiveDataViewProps<RecordType extends object> extends TableProps<RecordType> {
  card: ResponsiveCardConfig<RecordType>;
  className?: string;
  testWidth?: number;
}
~~~

Implementation rules:

1. Wrap content in a div with a ref, className responsive-data-view and data-responsive-mode.
2. Use testWidth only in tests; otherwise use useResponsiveMode with ResizeObserver and clientWidth.
3. Render Table inside TableViewport in full mode.
4. Render ResponsiveCardList with the same dataSource, rowSelection, loading and pagination in compact/narrow.
5. Keep rowKey, locale.emptyText, current-page data and pagination unchanged.
6. Do not issue requests or clone records.
7. Keep TableViewport as a compatibility wrapper for pages not yet migrated.

- [ ] Step 4: Export and run focused tests

Export ResponsiveDataView, its props, ResponsiveCardList, the field/config types and getResponsiveMode from frontend/src/components/Responsive/index.ts.

~~~bash
npx vitest run src/components/Responsive/responsiveMode.test.ts src/components/Responsive/responsiveCardList.test.tsx src/components/Responsive/responsiveDataView.test.tsx src/components/Responsive/index.test.ts
~~~

- [ ] Step 5: Commit

~~~bash
git add frontend/src/components/Responsive/responsiveDataView.tsx frontend/src/components/Responsive/responsiveDataView.test.tsx frontend/src/components/Responsive/index.ts frontend/src/components/Responsive/TableViewport.tsx
git commit -m "feat: add responsive data view"
~~~

### Task 4: Add shared responsive card styling

**Files:**
- Modify: frontend/src/index.css
- Create: frontend/src/components/Responsive/responsiveDataViewStyles.test.ts

**Interfaces:**
- Consumes the class names emitted by ResponsiveDataView and ResponsiveCardList.
- Produces compact two-column and narrow one-column layouts without body overflow.

- [ ] Step 1: Write failing CSS contract tests

Assert the stylesheet contains responsive-data-view, data-responsive-mode compact/narrow, responsive-card, responsive-card__details, visible focus styles and overflow-x hidden on application content.

- [ ] Step 2: Run the style test

~~~bash
npx vitest run src/components/Responsive/responsiveDataViewStyles.test.ts
~~~

Expected: FAIL before the new selectors are added.

- [ ] Step 3: Add scoped styles

Add these rules without changing existing color tokens:

~~~css
.responsive-data-view { min-width: 0; max-width: 100%; }
.responsive-card-list { display: grid; gap: 12px; min-width: 0; }
[data-responsive-mode='compact'] .responsive-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(260px, 0.8fr);
}
[data-responsive-mode='narrow'] .responsive-card { display: block; }
.responsive-card__details {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
[data-responsive-mode='narrow'] .responsive-card__details {
  grid-template-columns: minmax(0, 1fr);
}
~~~

Add min-width: 0, overflow-wrap: anywhere, visible focus rings, 32px minimum controls and box-sizing: border-box. Keep app-shell__content overflow-x hidden and do not add body scrolling.

- [ ] Step 4: Run focused style and layout tests

~~~bash
npx vitest run src/components/Responsive/responsiveDataViewStyles.test.ts src/components/Responsive/index.test.ts src/components/Layout/layout-responsive.test.ts
~~~

- [ ] Step 5: Commit

~~~bash
git add frontend/src/index.css frontend/src/components/Responsive/responsiveDataViewStyles.test.ts
git commit -m "style: add responsive data card layouts"
~~~

### Task 5: Migrate high-frequency recruitment management tables

**Files:**
- Modify: frontend/src/pages/Requisitions/List.tsx
- Modify: frontend/src/pages/Positions/List.tsx
- Modify: frontend/src/pages/Settings/PositionMappings.tsx
- Modify: frontend/src/pages/Settings/InterviewerMappings.tsx
- Modify: frontend/src/pages/Settings/Users.tsx
- Create: frontend/src/pages/ResponsiveManagementCards.static.test.ts

**Interfaces:**
- Consumes ResponsiveDataView from Task 3.
- Keeps each page's existing data loaders, selected keys, mutation handlers and columns unchanged for full mode.

- [ ] Step 1: Write migration contract tests

Read the five source files and assert each imports ResponsiveDataView, provides card=, and retains its existing mutation identifiers such as handleDelete, handleBatchDelete, handlePublish and handleSync. The test must fail before migration.

~~~ts
const pages = [
  'Requisitions/List.tsx',
  'Positions/List.tsx',
  'Settings/PositionMappings.tsx',
  'Settings/InterviewerMappings.tsx',
  'Settings/Users.tsx',
];

for (const page of pages) {
  const source = readFileSync(new URL('./' + page, import.meta.url), 'utf8');
  expect(source).toContain('ResponsiveDataView');
  expect(source).toContain('card=');
}
~~~

- [ ] Step 2: Run the contract test

~~~bash
npx vitest run src/pages/ResponsiveManagementCards.static.test.ts
~~~

Expected: FAIL because the pages still render TableViewport directly.

- [ ] Step 3: Add page card configurations

Use these priorities and keep the existing callbacks:

| Page | primary | secondary | detail |
|---|---|---|---|
| 需求管理 | 岗位名称 | 部门、城市、招聘人数、紧急程度、状态 | 薪资、预算、期望到岗 |
| 岗位管理 | 岗位名称 | 部门、类型、紧急度、状态、招聘进度 | 责任人、两轮面试官、能力维度、创建时间 |
| 岗位映射 | 标准岗位名 | BOSS 岗位名称、负责人、面试官 | 其他映射字段 |
| 面试官管理 | 姓名 | Open ID | 同步/操作信息 |
| 用户管理 | 姓名 | 邮箱、角色、状态 | 飞书绑定、创建时间 |

For every page pass the existing dataSource, loading, rowKey, rowSelection, pagination=false and scroll through ResponsiveDataView. Card actions must call existing handlers and must not duplicate HTTP requests.

- [ ] Step 4: Run focused source and TypeScript tests

~~~bash
npx vitest run src/pages/ResponsiveManagementCards.static.test.ts
npm run build
~~~

- [ ] Step 5: Commit

~~~bash
git add frontend/src/pages/Requisitions/List.tsx frontend/src/pages/Positions/List.tsx frontend/src/pages/Settings/PositionMappings.tsx frontend/src/pages/Settings/InterviewerMappings.tsx frontend/src/pages/Settings/Users.tsx frontend/src/pages/ResponsiveManagementCards.static.test.ts
git commit -m "feat: adapt recruitment management tables"
~~~

### Task 6: Migrate lifecycle, interview and configuration tables

**Files:**
- Modify: frontend/src/pages/Onboarding/List.tsx
- Modify: frontend/src/pages/Probation/List.tsx
- Modify: frontend/src/pages/Interviews/List.tsx
- Modify: frontend/src/pages/TalentPool/List.tsx
- Modify: frontend/src/pages/Settings/CapabilityDimensions.tsx
- Modify: frontend/src/pages/Settings/Mail.tsx
- Modify: frontend/src/pages/Workflows/List.tsx
- Modify: frontend/src/pages/JDManagement/List.tsx
- Modify: frontend/src/pages/JDManagement/Editor.tsx
- Modify: frontend/src/pages/Reviews/MyReviews.tsx
- Modify: frontend/src/pages/ResponsiveManagementCards.static.test.ts

**Interfaces:**
- Consumes the same ResponsiveDataView and card field contract as Task 5.
- Does not change interview reminder, email, workflow, JD, onboarding or probation API calls.

- [ ] Step 1: Extend the migration contract test

Assert all ten files import ResponsiveDataView, declare card, and retain their existing action handler identifiers. Include regressions that Interviews/List.tsx still contains the reminder action and Mail.tsx still contains attachment rendering.

- [ ] Step 2: Run the contract test

~~~bash
npx vitest run src/pages/ResponsiveManagementCards.static.test.ts
~~~

Expected: FAIL until the ten files are migrated.

- [ ] Step 3: Add card configurations

Use these priorities:

| Page | primary | secondary | detail |
|---|---|---|---|
| 入职管理 | 姓名 | 部门、职位、入职日期、状态 | 工号、合同、账号、设备、入职引导 |
| 试用期管理 | 姓名 | 试用开始、试用结束、结果 | 工号、期限、月度评估、转正日期 |
| 面试管理 | 候选人 | 岗位、学历、城市、面试状态、面试时间 | 两轮面试官、两轮结果、候选人状态 |
| 人才库 | 姓名 | 标准岗位、AI 初筛结果、HR 复核、状态 | 年龄、学历、城市、性别、创建时间 |
| 能力维度 | 岗位名称 | 能力维度、个性化需求 | 维度定义、操作信息 |
| 邮件记录 | 候选人 | 时间、邮件主题、状态 | 邮箱、附件 |
| 工作流 | 名称 | 状态、触发方式、更新时间 | 描述、执行结果 |
| JD 列表 | 岗位名称 | 部门、状态、最近修改 | JD 预览 |
| JD 版本 | 版本 | 修改人、修改时间 | JD 快照 |
| 我的评测 | 候选人 | 应聘岗位、AI 匹配度、指派时间 | 评测结果和操作 |

Keep row actions visible in compact and wrapped in narrow. Reuse existing functions for reminders, attachments, evaluation, publish and delete.

- [ ] Step 4: Run focused tests and the full frontend suite

~~~bash
npx vitest run src/pages/ResponsiveManagementCards.static.test.ts
npm test -- --reporter=dot
~~~

- [ ] Step 5: Commit

~~~bash
git add frontend/src/pages/Onboarding/List.tsx frontend/src/pages/Probation/List.tsx frontend/src/pages/Interviews/List.tsx frontend/src/pages/TalentPool/List.tsx frontend/src/pages/Settings/CapabilityDimensions.tsx frontend/src/pages/Settings/Mail.tsx frontend/src/pages/Workflows/List.tsx frontend/src/pages/JDManagement/List.tsx frontend/src/pages/JDManagement/Editor.tsx frontend/src/pages/Reviews/MyReviews.tsx frontend/src/pages/ResponsiveManagementCards.static.test.ts
git commit -m "feat: adapt lifecycle and configuration tables"
~~~

### Task 7: Adapt the dashboard bottom position summary table

**Files:**
- Modify: frontend/src/pages/Dashboard/components/PositionSummaryTable.tsx
- Modify: frontend/src/pages/Dashboard/dashboard.module.css
- Create: frontend/src/pages/Dashboard/components/PositionSummaryTable.test.tsx

**Interfaces:**
- Consumes divisions, totals, expanded, setExpanded and toggleDivision already present in the component.
- Accepts an optional testWidth prop used only by the regression test to force narrow mode.
- Produces a responsive summary table/card view without changing BoardTotals or DivisionBoard types.

- [ ] Step 1: Write failing dashboard regression tests

Cover the existing division toggle and the total summary:

~~~tsx
it('keeps the division expand control and aria state', async () => {
  render(<PositionSummaryTable divisions={fixtureDivisions} totals={fixtureTotals} testWidth={700} />);
  const toggle = screen.getByRole('button', { name: /展开|收起/ });
  expect(toggle).toHaveAttribute('aria-expanded');
  await userEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded');
});

it('renders total metrics in the narrow summary card', () => {
  render(<PositionSummaryTable divisions={fixtureDivisions} totals={fixtureTotals} testWidth={700} />);
  expect(screen.getByText('合计')).toBeInTheDocument();
  expect(screen.getByText(String(fixtureTotals.total_resumes))).toBeInTheDocument();
});
~~~

- [ ] Step 2: Run focused dashboard tests

~~~bash
npx vitest run src/pages/Dashboard/components/PositionSummaryTable.test.tsx
~~~

Expected: FAIL before the card adapter exists.

- [ ] Step 3: Add the dashboard card adapter

Keep the current table columns and expanded state for full mode. In card modes:

1. Render a division summary article with the existing toggle callback and aria-expanded.
2. Render expanded positions with position, HRBP, priority, headcount, resumes, pass rate, Offer and hired.
3. Render second/third interview counts, notes and status in the per-position detail section.
4. Render one total summary article after all divisions using totals.
5. Do not sort, filter or mutate divisions; reuse sortedDivisions and the existing data derivation.

- [ ] Step 4: Run dashboard and existing dashboard tests

~~~bash
npx vitest run src/pages/Dashboard/components/PositionSummaryTable.test.tsx src/pages/Dashboard
~~~

- [ ] Step 5: Commit

~~~bash
git add frontend/src/pages/Dashboard/components/PositionSummaryTable.tsx frontend/src/pages/Dashboard/components/PositionSummaryTable.test.tsx frontend/src/pages/Dashboard/dashboard.module.css
git commit -m "feat: adapt dashboard position summary"
~~~

### Task 8: Cross-page accessibility, responsive and regression verification

**Files:**
- Modify: frontend/src/components/Responsive/responsiveDataView.test.tsx
- Modify: frontend/src/pages/ResponsiveManagementCards.static.test.ts
- Create: frontend/src/components/Responsive/responsiveOverflow.test.ts

**Interfaces:**
- Consumes all migrated pages and shared components from Tasks 1–7.
- Produces final verification evidence for desktop, laptop and narrow layouts.

- [ ] Step 1: Add overflow and accessibility tests

Assert that compact and narrow fixtures have no body horizontal overflow, every card has a title and accessible expand/collapse button, selected keys round-trip through rowSelection.onChange, and full mode still renders TableViewport with the original scroll.x configuration.

- [ ] Step 2: Run all frontend tests

~~~bash
cd frontend
npm test -- --reporter=dot
~~~

Expected: all existing and new frontend tests pass with zero failures.

- [ ] Step 3: Build frontend and Worker bundle

~~~bash
cd frontend
npm run build
~~~

Expected: Vite build and scripts/build-worker.cjs both complete successfully.

- [ ] Step 4: Run the local browser matrix

Start the feature branch locally on an unused port and check:
- /requisitions
- /positions
- /settings/position-mappings
- /settings/interviewer-mappings
- /users
- /onboarding
- /dashboard (only bottom summary table)

Verify 1536×900, 1280×800, 1024×768, 768×900, 390×844 and browser zoom 125%/150%. Confirm no body horizontal scrollbar and that edit/delete/sync/batch actions are reachable without horizontal dragging.

- [ ] Step 5: Review the final diff

~~~bash
git diff --check
git status --short --branch
git diff --stat main...HEAD
~~~

Keep the worktree clean and report existing build warnings separately from failures.
