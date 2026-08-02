# Recruitment Dashboard Snapshot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a blue-purple single-page recruiting operations dashboard with real-time data, immutable daily snapshots, safe live/snapshot sharing, division/HRBP drill-downs, and a foldable position summary table.

**Architecture:** A versioned aggregate DTO is generated from fixed-count D1 queries for live data and stored verbatim for snapshot data. Internal and anonymous pages use the same presentational React board; only the internal container owns filters, refresh, snapshots, and sharing controls.

**Tech Stack:** Cloudflare Workers + Hono + D1 + Cron Triggers, TypeScript, React 19, Ant Design 6, Recharts, Vitest, Vite.

## Global Constraints

- Keep D1 as live-data truth; snapshots are write-once aggregate JSON and contain no candidate-level payloads.
- Snapshot dates use `Asia/Shanghai`; scheduled day-end snapshot runs at `55 15 * * *` UTC.
- Preserve the existing `0 1 * * *` reminder cron.
- Historical board and snapshot-share requests read `payload_json`; they never recompute source records.
- Public responses cannot contain candidate names, contacts, resume/parsed text, or raw AI evaluations.
- Aggregate with fixed-count SQL queries; no per-position, per-division, or per-HRBP query loops.
- Use current system tokens: `#0F172A`, `#3B82F6`, `#6366F1`, `#F8FAFC`, current Ant Design cards and Tags. Do not introduce the reference page’s red theme.
- Display unavailable data as `—` / `暂未采集`; never approximate one metric using another.
- Do not stage user-owned `frontend/.wrangler.local.toml` or brainstorm artifacts in `.superpowers/`.

---

## File Structure

- Create `scripts/migration_dashboard_snapshots.sql` — production D1 migration.
- Create `worker/src/recruiting-operations/dashboard.ts` — DTOs, aggregation, insight and public-filter helpers.
- Modify `worker/schema.sql`, `worker/src/index.ts`, `worker/src/recruiting-operations/share-links.ts`, `worker/wrangler.toml`, `worker/tests/recruiting-operations.test.ts`.
- Create `frontend/src/pages/Dashboard/types.ts`, `frontend/src/pages/Dashboard/components/RecruitingBoardView.tsx`, `frontend/src/pages/Dashboard/components/PositionSummaryTable.tsx`, `frontend/src/pages/Dashboard/dashboard.module.css`.
- Modify `frontend/src/pages/Dashboard/index.tsx`, `frontend/src/pages/SharedDashboard/index.tsx`, and `README.md`.

## Task 1: Add immutable snapshot and share-mode persistence

**Files:**
- Create: `scripts/migration_dashboard_snapshots.sql`
- Modify: `worker/schema.sql:749-761`
- Modify: `worker/src/recruiting-operations/share-links.ts`
- Test: `worker/tests/recruiting-operations.test.ts`

**Interfaces:** Produces `DashboardDataMode = 'live' | 'snapshot'`, `DashboardSnapshotRow`, `assertShareDataMode()`, and `toShanghaiSnapshotDate()`.

- [ ] **Step 1: Write failing tests**

```ts
import { assertShareDataMode, toShanghaiSnapshotDate } from '../src/recruiting-operations/share-links';

it('requires a snapshot id only for snapshot links', () => {
  expect(() => assertShareDataMode('live', null)).not.toThrow();
  expect(() => assertShareDataMode('snapshot', 'snapshot-1')).not.toThrow();
  expect(() => assertShareDataMode('snapshot', null)).toThrow('snapshot_id is required');
});

it('uses the China calendar date for a snapshot', () => {
  expect(toShanghaiSnapshotDate(new Date('2026-08-02T15:55:00.000Z'))).toBe('2026-08-02');
});
```

- [ ] **Step 2: Verify the tests fail**

Run: `cd worker && npm test -- recruiting-operations.test.ts`

Expected: FAIL because the two helpers are not exported.

- [ ] **Step 3: Add migration, schema, and helper code**

```sql
CREATE TABLE IF NOT EXISTS dashboard_snapshots (
  id TEXT PRIMARY KEY,
  snapshot_date TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  generated_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dashboard_snapshots_date ON dashboard_snapshots(snapshot_date DESC);
ALTER TABLE dashboard_share_links ADD COLUMN data_mode TEXT NOT NULL DEFAULT 'live';
ALTER TABLE dashboard_share_links ADD COLUMN snapshot_id TEXT;
CREATE INDEX IF NOT EXISTS idx_dashboard_share_links_snapshot ON dashboard_share_links(snapshot_id);
```

Put the table and share columns into the fresh-install definitions in `worker/schema.sql`. Production deployment must inspect `PRAGMA table_info(dashboard_share_links)` and run each `ALTER TABLE` only if that column is absent.

```ts
export type DashboardDataMode = 'live' | 'snapshot';
export function assertShareDataMode(mode: unknown, snapshotId: unknown): asserts mode is DashboardDataMode {
  if (mode !== 'live' && mode !== 'snapshot') throw new Error('invalid dashboard data mode');
  if (mode === 'snapshot' && (typeof snapshotId !== 'string' || snapshotId.length === 0)) throw new Error('snapshot_id is required');
  if (mode === 'live' && snapshotId != null) throw new Error('live links cannot include snapshot_id');
}
export function toShanghaiSnapshotDate(value: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(value);
}
```

- [ ] **Step 4: Run tests and type-check**

Run: `cd worker && npm test -- recruiting-operations.test.ts && npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add scripts/migration_dashboard_snapshots.sql worker/schema.sql worker/src/recruiting-operations/share-links.ts worker/tests/recruiting-operations.test.ts && git commit -m "feat: add immutable dashboard snapshot storage"`

## Task 2: Define a v2 board DTO and deterministic board aggregation

**Files:**
- Create: `worker/src/recruiting-operations/dashboard.ts`
- Modify: `worker/src/index.ts:1225-1323`
- Test: `worker/tests/recruiting-operations.test.ts`

**Interfaces:** Consumes `RecruitingBoardPositionRow[]`; produces `buildRecruitingBoard(rows, options): RecruitingBoard` and scoped, privacy-safe public projection.

- [ ] **Step 1: Write failing aggregation tests**

```ts
import { buildRecruitingBoard } from '../src/recruiting-operations/dashboard';

it('builds all dashboard levels and marks weekly completion unavailable', () => {
  const board = buildRecruitingBoard([{ position_id: 'p1', division: '职培', hrbp: '王凯月', position: '销售', priority: 'P0', headcount: 2, total_resumes: 8, ai_screened: 6, first_interview: 4, first_pass: 3, second_pass: 2, third_pass: 1, offers: 1, hired: 1, notes: '', status: '招聘中' }], { dataMode: 'live', updatedAt: '2026-08-02T15:00:00.000Z' });
  expect(board.funnel.stages.map((item) => item.key)).toEqual(['resumes', 'ai_screened', 'first_interview', 'first_pass', 'second_pass', 'third_pass', 'offers', 'hired']);
  expect(board.divisions[0]).toMatchObject({ division: '职培', hrbps: ['王凯月'] });
  expect(board.hrbps[0]).toMatchObject({ hrbp: '王凯月', average_hiring_days: null });
  expect(board.kpis.weekly_requirement_completion).toEqual({ value: null, available: false });
});

it('uses third-pass divided by scheduled first interviews for the published pass rate', () => {
  const board = buildRecruitingBoard([{ position_id: 'p1', division: 'A', hrbp: '', position: '运营', priority: 'P1', headcount: 1, total_resumes: 10, ai_screened: 8, first_interview: 8, first_pass: 5, second_pass: 3, third_pass: 2, offers: 1, hired: 1, notes: '', status: '招聘中' }], { dataMode: 'live', updatedAt: '2026-08-02T15:00:00.000Z' });
  expect(board.kpis.interview_pass_rate).toEqual({ value: 25, available: true });
});
```

- [ ] **Step 2: Verify the test fails because the module is absent**

Run: `cd worker && npm test -- recruiting-operations.test.ts`

Expected: FAIL with a missing dashboard module error.

- [ ] **Step 3: Implement DTOs, groups, funnel, and insights**

```ts
export interface RecruitingBoardPositionRow { position_id: string; division: string; hrbp: string; position: string; priority: 'P0'|'P1'|'P2'; headcount: number; total_resumes: number; ai_screened: number; first_interview: number; first_pass: number; second_pass: number; third_pass: number; offers: number; hired: number; notes: string; status: string; unmatched?: boolean; }
export interface Metric { value: number | null; available: boolean; }
export interface RecruitingBoard { version: 'v2'; data_mode: DashboardDataMode; snapshot_date: string | null; updated_at: string; kpis: Record<string, Metric>; funnel: { stages: Array<{ key: string; label: string; count: number }> }; insights: { summary: string; bottlenecks: string[]; recommendations: string[] }; divisions: DivisionBoard[]; hrbps: HrbpBoard[]; totals: BoardTotals; }

export function buildRecruitingBoard(rows: RecruitingBoardPositionRow[], input: { dataMode: DashboardDataMode; updatedAt: string; snapshotDate?: string | null }): RecruitingBoard {
  const totals = sumRows(rows);
  const passRate = totals.first_interview > 0 && totals.third_pass > 0 ? Math.round(totals.third_pass / totals.first_interview * 1000) / 10 : null;
  return { version: 'v2', data_mode: input.dataMode, snapshot_date: input.snapshotDate || null, updated_at: input.updatedAt, kpis: makeKpis(rows, totals, passRate), funnel: { stages: makeFunnel(totals) }, insights: buildDeterministicInsights(totals), divisions: groupDivisionCards(rows), hrbps: groupHrbpCards(rows), totals: { ...totals, interview_pass_rate: passRate } };
}
```

`makeKpis` returns exactly seven metrics, with `weekly_requirement_completion: { value: null, available: false }`. `buildDeterministicInsights` finds the lowest valid adjacent funnel conversion and returns a neutral Chinese “暂无足够漏斗数据” diagnostic when all denominators are zero. Move `groupBoardRows`, `getBoardInterviewPassCondition`, and `getBoardFirstInterviewCount` to this module and re-export them from `index.ts` while existing tests import from there. Extend the current grouped resumes query with `SUM(CASE WHEN parse_status = 'ai_screened' THEN 1 ELSE 0 END) AS ai_screened`.

- [ ] **Step 4: Verify tests and Worker compilation**

Run: `cd worker && npm test -- recruiting-operations.test.ts && npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add worker/src/recruiting-operations/dashboard.ts worker/src/index.ts worker/tests/recruiting-operations.test.ts && git commit -m "feat: build versioned recruiting board aggregates"`

## Task 3: Add snapshot APIs, scheduled snapshots, and snapshot-aware shares

**Files:**
- Modify: `worker/src/index.ts:1304-1492,9782-9816`
- Modify: `worker/wrangler.toml:20-22`
- Test: `worker/tests/recruiting-operations.test.ts`

**Interfaces:** Produces `GET /api/dashboard/recruiting-board?mode=live|snapshot`, `GET /api/dashboard/snapshots`, `POST /api/dashboard/snapshots`, and extended share-link payloads.

- [ ] **Step 1: Write failing immutable-snapshot test**

```ts
import { createDashboardSnapshot, readDashboardSnapshot } from '../src/index';

it('writes only the first snapshot for a date', async () => {
  const db = createSnapshotDb();
  await expect(createDashboardSnapshot(db as never, '2026-08-02', { version: 'v2' }, 'cron', '2026-08-02T15:55:00.000Z')).resolves.toMatchObject({ snapshot_date: '2026-08-02' });
  await expect(createDashboardSnapshot(db as never, '2026-08-02', { version: 'v2' }, 'cron', '2026-08-02T15:56:00.000Z')).rejects.toThrow('snapshot already exists');
  await expect(readDashboardSnapshot(db as never, '2026-08-02')).resolves.toMatchObject({ version: 'v2' });
});
```

- [ ] **Step 2: Verify it fails**

Run: `cd worker && npm test -- recruiting-operations.test.ts`

Expected: FAIL because snapshot helpers do not exist.

- [ ] **Step 3: Implement write-once service and endpoints**

```ts
export async function createDashboardSnapshot(db: D1Database, snapshotDate: string, board: RecruitingBoard, generatedBy: string, generatedAt: string) {
  const present = await db.prepare('SELECT id FROM dashboard_snapshots WHERE snapshot_date = ?').bind(snapshotDate).first();
  if (present) throw new Error('snapshot already exists');
  const row = { id: uuid(), snapshot_date: snapshotDate, payload_json: JSON.stringify({ ...board, data_mode: 'snapshot', snapshot_date: snapshotDate }), generated_at: generatedAt, generated_by: generatedBy, created_at: generatedAt };
  await db.prepare('INSERT INTO dashboard_snapshots (id, snapshot_date, payload_json, generated_at, generated_by, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(row.id, row.snapshot_date, row.payload_json, row.generated_at, row.generated_by, row.created_at).run();
  return row;
}
export async function readDashboardSnapshot(db: D1Database, snapshotDate: string): Promise<RecruitingBoard | null> {
  const row = await db.prepare('SELECT payload_json FROM dashboard_snapshots WHERE snapshot_date = ?').bind(snapshotDate).first<{ payload_json: string }>();
  return row ? JSON.parse(row.payload_json) as RecruitingBoard : null;
}
```

The board route returns 400 for an invalid mode or missing snapshot date, 404 for unknown snapshot, and applies owner scope after loading either version. `GET /dashboard/snapshots` returns only `id`, `snapshot_date`, `generated_at`. `POST /dashboard/snapshots` accepts optional `date`, permits `admin` only, returns 201 when created, 403 for non-admin, and 409 when it exists. A manual historical snapshot must be labelled with `generated_by=user.email`, because it is a current aggregation saved under that date and is not an invented reconstruction.

Add this exact trigger list and branch the current `scheduled` handler on the cron string:

```toml
[triggers]
crons = ["0 1 * * *", "55 15 * * *"]
```

```ts
if (event.cron === '55 15 * * *') {
  ctx.waitUntil((async () => {
    const at = new Date(event.scheduledTime);
    const board = await loadLiveRecruitingBoard(env.DB, null);
    try { await createDashboardSnapshot(env.DB, toShanghaiSnapshotDate(at), board, 'cron', at.toISOString()); }
    catch (error) { if (!(error instanceof Error && error.message === 'snapshot already exists')) throw error; }
  })());
  return;
}
```

Extend `POST /dashboard/share-links` to accept `{ data_mode, snapshot_id }`, validate with `assertShareDataMode`, verify the snapshot exists, and store both fields. In anonymous loading, use `loadLiveRecruitingBoard` for a live link and stored `payload_json` for a snapshot link before owner/division filtering and `toPublicRecruitingBoard`.

- [ ] **Step 4: Run test and local D1 migration checks**

Run: `cd worker && npm test -- recruiting-operations.test.ts && npx tsc --noEmit && npx wrangler d1 execute ai-interview-db --local --file ../scripts/migration_dashboard_snapshots.sql`

Expected: Tests PASS; D1 creates the snapshot table. If local share columns already exist, run only the `CREATE TABLE`/index statements and retain the production `PRAGMA` guarded migration procedure.

- [ ] **Step 5: Commit**

Run: `git add worker/src/index.ts worker/wrangler.toml worker/tests/recruiting-operations.test.ts && git commit -m "feat: add dashboard snapshots and snapshot shares"`

## Task 4: Create the shared visual board and foldable detail table

**Files:**
- Create: `frontend/src/pages/Dashboard/types.ts`
- Create: `frontend/src/pages/Dashboard/components/RecruitingBoardView.tsx`
- Create: `frontend/src/pages/Dashboard/components/PositionSummaryTable.tsx`
- Create: `frontend/src/pages/Dashboard/dashboard.module.css`
- Modify: `frontend/src/pages/Dashboard/index.tsx`

**Interfaces:** Produces `<RecruitingBoardView board={board} />` and `<PositionSummaryTable divisions={...} totals={...} />`, both reusable by the anonymous page.

- [ ] **Step 1: Add typed frontend DTOs**

```ts
export type DashboardDataMode = 'live' | 'snapshot';
export interface DashboardMetric { value: number | null; available: boolean; }
export interface BoardPosition { position_id: string; division: string; hrbp: string; position: string; priority: 'P0'|'P1'|'P2'; headcount: number; total_resumes: number; ai_screened: number; first_interview: number; first_pass: number; second_pass: number; third_pass: number; offers: number; hired: number; notes: string; status: string; }
export interface RecruitingBoard { version: 'v2'; data_mode: DashboardDataMode; snapshot_date: string | null; updated_at: string; kpis: Record<string, DashboardMetric>; funnel: { stages: Array<{ key: string; label: string; count: number }> }; insights: { summary: string; bottlenecks: string[]; recommendations: string[] }; divisions: Array<{ division: string; hrbps: string[]; positions: BoardPosition[]; [key: string]: unknown }>; hrbps: Array<Record<string, unknown>>; totals: Record<string, number | null>; }
```

- [ ] **Step 2: Implement one-table collapse behavior**

```tsx
const [expanded, setExpanded] = useState<Set<string>>(() => new Set(divisions.slice(0, 1).map((row) => row.division)));
const dataSource = divisions.flatMap((division) => [
  { key: `division:${division.division}`, kind: 'division' as const, ...division },
  ...(expanded.has(division.division) ? division.positions.map((position) => ({ key: `position:${position.position_id}`, kind: 'position' as const, ...position })) : []),
]);
// A division row toggles `expanded`; Table.Summary renders one final 合计 row.
```

Use exactly one Ant `Table`, not `expandable` or a nested table. Render `▼`/`▶` in a button on each division row. Use `scroll={{ x: 1460 }}`, status/priority Tags, ellipsized notes, and `Table.Summary.Row` for totals. On input changes, retain expanded names that remain present; when none remain, expand the first sorted division.

- [ ] **Step 3: Render seven display sections with current-system style**

```tsx
export function RecruitingBoardView({ board }: { board: RecruitingBoard }) {
  return <div className={styles.board}>
    <KpiGrid kpis={board.kpis} />
    <InsightCard insights={board.insights} />
    <RecruitingFunnel stages={board.funnel.stages} />
    <DivisionBoardGrid divisions={board.divisions} />
    <HrbpEfficiencyGrid cards={board.hrbps} />
    <section><SectionTitle>全量岗位明细汇总</SectionTitle><PositionSummaryTable divisions={board.divisions} totals={board.totals} /></section>
  </div>;
}
```

`KpiGrid` has seven responsive cards, shows `—` for unavailable values, and writes `暂未采集` beneath weekly requirement completion. `RecruitingFunnel` uses Recharts horizontal bars. The board CSS uses page-local classes, `var(--background-color)`, `var(--surface-color)`, `var(--secondary-color)`, `#6366F1`, existing radii/shadows, and responsive 7/4/2 grids.

- [ ] **Step 4: Verify a production build**

Run: `cd frontend && npm run build`

Expected: TypeScript and Vite PASS.

- [ ] **Step 5: Commit**

Run: `git add frontend/src/pages/Dashboard/types.ts frontend/src/pages/Dashboard/components frontend/src/pages/Dashboard/dashboard.module.css frontend/src/pages/Dashboard/index.tsx && git commit -m "feat: build recruiting operations dashboard view"`

## Task 5: Add internal data-version, manual-snapshot, and share controls

**Files:**
- Modify: `frontend/src/pages/Dashboard/index.tsx`
- Modify: `frontend/src/pages/Dashboard/types.ts`

**Interfaces:** Consumes Task 3 routes; supplies the selected `RecruitingBoard` to Task 4.

- [ ] **Step 1: Add state and versioned loading**

```tsx
const [dataMode, setDataMode] = useState<DashboardDataMode>('live');
const [snapshotDate, setSnapshotDate] = useState<string>();
const [snapshots, setSnapshots] = useState<DashboardSnapshotMeta[]>([]);
const [shareMode, setShareMode] = useState<DashboardDataMode>('live');
const [shareSnapshotId, setShareSnapshotId] = useState<string>();
const loadBoard = async () => setBoard(await request.get('/dashboard/recruiting-board', { params: dataMode === 'snapshot' ? { mode: 'snapshot', date: snapshotDate, responsible_person: selectedOwner } : { mode: 'live', responsible_person: selectedOwner } }) as RecruitingBoard);
```

- [ ] **Step 2: Add version switcher and admin-only save button**

```tsx
<Select value={dataMode === 'live' ? 'live' : snapshotDate} onChange={(value) => value === 'live' ? (setDataMode('live'), setSnapshotDate(undefined)) : (setDataMode('snapshot'), setSnapshotDate(value))} options={[{ value: 'live', label: '最新实时数据' }, ...snapshots.map((item) => ({ value: item.snapshot_date, label: item.snapshot_date }))]} />
{user?.role === 'admin' && <Button disabled={dataMode !== 'live'} onClick={createMissingSnapshot}>保存今日快照</Button>}
```

`createMissingSnapshot` posts `{}`; on 201 reload metadata and switch to the returned date; on 409 show “今日快照已存在”. Never render overwrite UI.

- [ ] **Step 3: Extend the share modal**

```tsx
<Radio.Group value={shareMode} onChange={(event) => { setShareMode(event.target.value); setShareSnapshotId(undefined); }}>
  <Radio value="live">分享最新实时数据</Radio><Radio value="snapshot">固定为历史快照</Radio>
</Radio.Group>
{shareMode === 'snapshot' && <Select value={shareSnapshotId} onChange={setShareSnapshotId} placeholder="选择快照日期" options={snapshots.map((item) => ({ value: item.id, label: item.snapshot_date }))} />}
```

Post `{ expiry: shareExpiry, data_mode: shareMode, snapshot_id: shareMode === 'snapshot' ? shareSnapshotId : null }`; disable creation until a snapshot is selected; list existing links with `实时数据` or `固定快照：YYYY-MM-DD`.

- [ ] **Step 4: Build and manually smoke test**

Run: `cd frontend && npm run build`

Expected: PASS. Manual check: newest data loads, a snapshot loads, an admin saves a missing snapshot, and live/snapshot share creation both work.

- [ ] **Step 5: Commit**

Run: `git add frontend/src/pages/Dashboard/index.tsx frontend/src/pages/Dashboard/types.ts && git commit -m "feat: add dashboard version and snapshot controls"`

## Task 6: Reuse the full board in anonymous shares and perform final verification

**Files:**
- Modify: `frontend/src/pages/SharedDashboard/index.tsx`
- Modify: `frontend/src/pages/Dashboard/components/RecruitingBoardView.tsx`
- Modify: `README.md`
- Test: `worker/tests/recruiting-operations.test.ts`

**Interfaces:** Anonymous `/shared/dashboard/:token` receives the same public v2 DTO and renders all seven visual sections without controls.

- [ ] **Step 1: Replace the old KPI/table-only page**

```tsx
if (loading) return <FullPageSpinner />;
if (invalid || !board) return <InvalidShareLink />;
return <main className={styles.sharedPage}>
  <header><Title level={3}>招聘运营看板</Title><Text type="secondary">数据截止：{board.snapshot_date || '最新实时数据'} · 仅含聚合数据</Text></header>
  <RecruitingBoardView board={board} />
</main>;
```

The shared component receives no filters, refresh, snapshot-save, sharing, or candidate props. It must show the same KPIs, diagnostics, funnel, division cards, HRBP cards, and foldable table as the internal page.

- [ ] **Step 2: Add public snapshot safety test**

```ts
it('returns stored aggregate JSON instead of fresh data for a snapshot link', async () => {
  const response = await getSharedBoard(fakeSnapshotDb as never, 'snapshot-token', now, async () => liveBoardWith({ total_resumes: 999 }));
  expect(response.body).toMatchObject({ data_mode: 'snapshot', snapshot_date: '2026-08-01' });
  expect(JSON.stringify(response.body)).not.toContain('candidate@example.com');
});
```

- [ ] **Step 3: Run all automated checks**

Run: `cd worker && npm test && npx tsc --noEmit && cd ../frontend && npm run build && npm run lint`

Expected: every command exits 0.

- [ ] **Step 4: Run the manual verification matrix**

| Scenario | Expected result |
| --- | --- |
| Change a live resume after a snapshot | Live count changes; saved snapshot does not |
| Anonymous fixed-snapshot link | All seven sections show the saved date |
| Anonymous live link after a change | Aggregate counts refresh |
| Revoked/expired link | Only the unavailable-link response appears |
| No HRBP/onboarding data | Page renders; affected metrics are `—` |
| Filter one division | Detail total uses only matching rows |
| Toggle a division | Its positions show/hide in the same table; other groups do not change |

- [ ] **Step 5: Update README and commit**

Run: `git add frontend/src/pages/SharedDashboard/index.tsx frontend/src/pages/Dashboard/components/RecruitingBoardView.tsx worker/tests/recruiting-operations.test.ts README.md && git commit -m "feat: share full snapshot-aware recruiting dashboard"`

## Production Deployment After Code Review

- [ ] Inspect remote share columns:

Run: `cd worker && npx wrangler d1 execute ai-interview-db --remote --command "PRAGMA table_info(dashboard_share_links)"`

- [ ] Apply only absent share columns and create snapshots table, then deploy:

Run: `npx wrangler d1 execute ai-interview-db --remote --command "SELECT name FROM sqlite_master WHERE type='table' AND name='dashboard_snapshots'" && npx wrangler deploy && cd ../frontend && npm run build`

- [ ] In production, save a snapshot as admin, open it, create a 1-day fixed-snapshot share in an anonymous window, revoke it, and confirm it becomes unavailable.

## Plan Self-Review

- Coverage: Tasks 1–3 cover storage, aggregation, daily cron, APIs, immutable history, and safe share modes. Tasks 4–6 cover all seven visual sections, theme, foldable table, internal controls, anonymous reuse, documentation, tests, and deployment checks.
- Placeholder scan: all routes, tables, DTO names, cron strings, test scenarios, UI behavior, commands, and expected results are stated explicitly.
- Type consistency: `DashboardDataMode`, `RecruitingBoard`, `snapshot_date`, `data_mode`, and `snapshot_id` have one name across schema, Worker, API, frontend, and share flows.
