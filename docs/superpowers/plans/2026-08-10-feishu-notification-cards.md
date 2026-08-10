# Feishu Interview Reminder and Daily Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send complete interview reminder cards and PDF attachments from the current user's Feishu identity, and send immutable three-owner recruitment daily reports as native Feishu tables.

**Architecture:** Add focused Worker modules for reminder normalization/delivery and daily-report aggregation/card rendering, while keeping Hono route registration in `worker/src/index.ts`. The reminder route loads authoritative D1/KV data and uses a strict current-user token; daily report generation stores a JSON snapshot that both manual and cron delivery reuse. Frontend changes are limited to interpreting complete versus partial delivery results.

**Tech Stack:** TypeScript, Hono, Cloudflare Workers, D1, KV, Feishu IM APIs, React, Axios, Vitest.

## Global Constraints

- Work only on branch `codex/feishu-notification-cards`; do not deploy production.
- Manual interview reminders must never fall back to another user token or bot identity.
- PDF upload uses the Feishu IM file API and rejects empty or larger-than-30-MB files before network I/O.
- Reminder sends do not trigger a new AI call; they reuse stored evaluation data.
- Daily report owners are ordered exactly as `何雨菱`, `杜雁玲`, `魏秋柠`.
- Daily boundaries use `Asia/Shanghai` and daily-report history reads stored snapshots.
- Logs must not include PDF bytes, resume text, contact details, or complete AI analysis.
- Every production behavior starts with a failing test and follows red-green-refactor.

---

### Task 1: Normalize interview reminder data and render the card

**Files:**
- Create: `worker/src/feishu-notifications/interview-reminder.ts`
- Create: `worker/tests/interview-reminder.test.ts`

**Interfaces:**
- Consumes: raw `interview`, `resume`, `screening`, and `recruitmentTask` records already loaded by the route.
- Produces: `buildInterviewReminderView(source, now): InterviewReminderView` and `buildInterviewReminderCard(view, options): FeishuCard`.

- [ ] **Step 1: Write failing normalization and card tests**

```ts
import { describe, expect, it } from 'vitest';
import { buildInterviewReminderCard, buildInterviewReminderView } from '../src/feishu-notifications/interview-reminder';

it('normalizes all seven fields from authoritative resume data', () => {
  const view = buildInterviewReminderView({
    interview: { candidate_name: '候选人', position_applied: '旧岗位', interview_time: '2026-08-11T02:00:00.000Z' },
    resume: {
      candidate_name: '张三', mapped_position: '社区运营', gender: '', education: '', birthday: '1996-08-11',
      parsed_data: JSON.stringify({ highest_degree: '本科', gender: '女', city: '北京' }),
      ai_evaluation: JSON.stringify({ summary: '匹配岗位', risk_points: ['稳定性待核实'], interview_questions: ['请说明离职原因'] }),
    },
  }, new Date('2026-08-10T00:00:00.000Z'));

  expect(view).toMatchObject({ name: '张三', education: '本科', age: 29, gender: '女', position: '社区运营', city: '北京' });
  expect(view.aiAdvice).toContain('稳定性待核实');
});

it('renders attachment availability and never exposes raw JSON', () => {
  const card = buildInterviewReminderCard({
    name: '张三', education: '本科', age: 29, gender: '女', position: '社区运营',
    interviewTime: '2026-08-11 10:00', city: '北京', aiAdvice: '建议核实稳定性',
  }, { operatorName: '金皓翔', attachmentAvailable: true });
  const serialized = JSON.stringify(card);
  expect(serialized).toContain('简历 PDF 将在下一条消息发送');
  expect(serialized).toContain('学历');
  expect(serialized).not.toContain('risk_points');
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `cd worker && npx vitest run tests/interview-reminder.test.ts`

Expected: FAIL because `feishu-notifications/interview-reminder` does not exist.

- [ ] **Step 3: Implement the reminder view and card**

```ts
export interface InterviewReminderView {
  name: string;
  education: string;
  age: number | null;
  gender: string;
  position: string;
  interviewTime: string;
  city: string;
  aiAdvice: string;
}

export function buildInterviewReminderView(
  source: InterviewReminderSource,
  at = new Date(),
): InterviewReminderView;

export function buildInterviewReminderCard(
  view: InterviewReminderView,
  options: { operatorName: string; attachmentAvailable: boolean },
): Record<string, unknown>;
```

The implementation must parse object-or-string JSON defensively, calculate age only from valid values, format interview time in `Asia/Shanghai`, and compose AI advice from summary, recommendation, risk points, and interview questions with a bounded length.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `cd worker && npx vitest run tests/interview-reminder.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add worker/src/feishu-notifications/interview-reminder.ts worker/tests/interview-reminder.test.ts
git commit -m "feat: build complete interview reminder cards"
```

### Task 2: Add PDF upload and strict Feishu delivery

**Files:**
- Modify: `worker/src/feishu-notifications/interview-reminder.ts`
- Modify: `worker/tests/interview-reminder.test.ts`

**Interfaces:**
- Consumes: `InterviewReminderView`, current user token, app resource token, interviewer `open_id`, and optional PDF bytes.
- Produces: `deliverInterviewReminder(input, dependencies): Promise<InterviewReminderDeliveryResult>`.

- [ ] **Step 1: Write failing delivery tests**

```ts
it('uploads PDF before sending the card and file from the current user', async () => {
  const calls: string[] = [];
  const result = await deliverInterviewReminder({
    userToken: 'user-token', resourceToken: 'tenant-token', receiverOpenId: 'ou_receiver',
    view: completeView, operatorName: '金皓翔',
    file: { bytes: new Uint8Array([1, 2, 3]), fileName: '张三.pdf' },
  }, {
    fetch: async (url, init) => {
      calls.push(String(url).includes('/files') ? 'upload' : JSON.parse(String(init?.body)).msg_type);
      return Response.json(String(url).includes('/files')
        ? { code: 0, data: { file_key: 'file-key' } }
        : { code: 0, data: { message_id: 'message-id' } });
    },
  });
  expect(calls).toEqual(['upload', 'interactive', 'file']);
  expect(result).toMatchObject({ cardSent: true, fileSent: true });
});

it('rejects delivery without a current-user token', async () => {
  await expect(deliverInterviewReminder({ ...deliveryInput, userToken: '' }, dependencies))
    .rejects.toMatchObject({ code: 'FEISHU_AUTH_REQUIRED' });
});

it('still sends a card when PDF upload fails', async () => {
  const result = await deliverInterviewReminder(deliveryInput, failingUploadDependencies);
  expect(result).toMatchObject({ cardSent: true, fileSent: false });
  expect(result.warning).toContain('PDF');
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `cd worker && npx vitest run tests/interview-reminder.test.ts`

Expected: FAIL because `deliverInterviewReminder` is not exported.

- [ ] **Step 3: Implement bounded upload and message delivery**

```ts
export interface InterviewReminderDeliveryResult {
  cardSent: boolean;
  fileSent: boolean;
  warning: string | null;
}

export async function deliverInterviewReminder(
  input: InterviewReminderDeliveryInput,
  dependencies: { fetch: typeof fetch },
): Promise<InterviewReminderDeliveryResult>;
```

Use `FormData` with `file_type=pdf`, `file_name`, and a `Blob`. Reject zero-byte and `> 30 * 1024 * 1024` payloads before calling fetch. Upload with the resource token; send both `interactive` and `file` messages with the supplied current-user token. Await every promise and parse only bounded Feishu JSON responses.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `cd worker && npx vitest run tests/interview-reminder.test.ts`

Expected: PASS, including upload failure and missing token cases.

- [ ] **Step 5: Commit Task 2**

```bash
git add worker/src/feishu-notifications/interview-reminder.ts worker/tests/interview-reminder.test.ts
git commit -m "feat: deliver reminder cards with PDF attachments"
```

### Task 3: Integrate authoritative reminder loading and frontend feedback

**Files:**
- Modify: `worker/src/index.ts:10428-10495`
- Create: `frontend/src/pages/Interviews/reminderFeedback.ts`
- Create: `frontend/src/pages/Interviews/reminderFeedback.test.ts`
- Modify: `frontend/src/pages/Interviews/List.tsx:458-480`
- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json`

**Interfaces:**
- Consumes: `deliverInterviewReminder`, `getResumeFileBytes`, `getValidUserAccessToken`, `getFeishuToken`, `getInterviewerOpenId`.
- Produces: endpoint response `{ ok, card_sent, file_sent, sent_as, warning }` and `getReminderFeedback(response)`.

- [ ] **Step 1: Add frontend Vitest and write a failing feedback test**

Run: `cd frontend && npm install --save-dev vitest`

Add script: `"test": "vitest run"`.

```ts
import { expect, it } from 'vitest';
import { getReminderFeedback } from './reminderFeedback';

it('returns a warning when the card arrived but the PDF failed', () => {
  expect(getReminderFeedback({ card_sent: true, file_sent: false, warning: 'PDF 上传失败' }))
    .toEqual({ type: 'warning', content: '卡片已发送，但简历 PDF 未发送：PDF 上传失败' });
});
```

- [ ] **Step 2: Run the frontend test and verify RED**

Run: `cd frontend && npx vitest run src/pages/Interviews/reminderFeedback.test.ts`

Expected: FAIL because `reminderFeedback.ts` does not exist.

- [ ] **Step 3: Implement feedback mapping and use it in the page**

```ts
export function getReminderFeedback(response: ReminderDeliveryResponse) {
  if (response.card_sent && response.file_sent) {
    return { type: 'success' as const, content: '已用你的飞书账号提醒面试官，并发送简历 PDF' };
  }
  return {
    type: 'warning' as const,
    content: `卡片已发送，但简历 PDF 未发送：${response.warning || '附件暂不可用'}`,
  };
}
```

Update `handleSendReminder` to inspect the returned response and call `message.success` or `message.warning` accordingly.

- [ ] **Step 4: Replace the reminder endpoint with authoritative loading**

The route must:

```ts
const interview = await c.env.DB.prepare('SELECT * FROM interviews WHERE id = ?').bind(id).first();
const resume = interview.resume_id
  ? await c.env.DB.prepare('SELECT * FROM resumes WHERE id = ?').bind(interview.resume_id).first()
  : await resolveUniqueResumeByCandidateName(c.env.DB, interview.candidate_name);
const userToken = await getValidUserAccessToken(c.env, currentUser.email);
const resourceToken = await getFeishuToken(c.env);
const file = resume ? await getResumeFileBytes(c.env, resume.id) : { bytes: null, fileName: 'resume.pdf' };
```

It must reject missing interviews, ambiguous name-only matches, missing interviewer mapping, and missing current-user authorization with actionable fields (`need_bind` or `need_feishu_auth`). It must not call `sendFeishuMessageWithFallback`.

- [ ] **Step 5: Run focused tests and builds**

Run:

```bash
cd worker && npx vitest run tests/interview-reminder.test.ts
cd frontend && npx vitest run src/pages/Interviews/reminderFeedback.test.ts
cd frontend && npm run build
```

Expected: all pass.

- [ ] **Step 6: Commit Task 3**

```bash
git add worker/src/index.ts frontend/src/pages/Interviews frontend/package.json frontend/package-lock.json
git commit -m "feat: send interview reminders as the current user"
```

### Task 4: Build immutable three-owner daily-report snapshots and native table cards

**Files:**
- Create: `worker/src/daily-reports/report.ts`
- Create: `worker/tests/daily-report.test.ts`

**Interfaces:**
- Consumes: a bounded `DailyReportDataset` loaded from D1 and an exact report date.
- Produces: `buildDailyReportSnapshot(dataset, reportDate, generatedAt)`, `buildDailyReportFeishuCard(snapshot, summary)`, and `buildDailyReportFallbackSummary(snapshot)`.

- [ ] **Step 1: Write failing aggregation tests**

```ts
import { describe, expect, it } from 'vitest';
import { buildDailyReportFeishuCard, buildDailyReportSnapshot } from '../src/daily-reports/report';

it('always emits the three owners in the required order plus a total row', () => {
  const snapshot = buildDailyReportSnapshot(datasetFixture, '2026-08-10', '2026-08-10T10:00:00.000Z');
  expect(snapshot.rows.map((row) => row.owner)).toEqual(['何雨菱', '杜雁玲', '魏秋柠']);
  expect(snapshot.totals.todayOffers).toBe(1);
  expect(snapshot.totals.todayOnboarding).toBe(1);
});

it('does not assign ambiguous records and reports them separately', () => {
  const snapshot = buildDailyReportSnapshot(ambiguousDatasetFixture, '2026-08-10', '2026-08-10T10:00:00.000Z');
  expect(snapshot.unassigned).toBeGreaterThan(0);
  expect(snapshot.rows.reduce((sum, row) => sum + row.todayNew, 0)).toBe(0);
});

it('renders a native Feishu table with all report columns', () => {
  const card = buildDailyReportFeishuCard(snapshotFixture, '今日重点推进待初筛简历。');
  const table = card.elements.find((element: any) => element.tag === 'table');
  expect(table.columns.map((column: any) => column.name)).toEqual([
    'owner', 'open_positions', 'today_new', 'pending', 'today_approved',
    'today_rejected', 'today_interviews', 'today_offers', 'today_onboarding',
  ]);
  expect(table.rows).toHaveLength(4);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `cd worker && npx vitest run tests/daily-report.test.ts`

Expected: FAIL because `daily-reports/report` does not exist.

- [ ] **Step 3: Implement typed snapshot aggregation**

```ts
export const DAILY_REPORT_OWNERS = ['何雨菱', '杜雁玲', '魏秋柠'] as const;

export interface DailyOwnerMetrics {
  owner: typeof DAILY_REPORT_OWNERS[number];
  openPositions: number;
  todayNew: number;
  pending: number;
  todayApproved: number;
  todayRejected: number;
  todayInterviews: number;
  todayOffers: number;
  todayOnboarding: number;
}

export interface DailyReportSnapshot {
  version: 'v2';
  reportDate: string;
  generatedAt: string;
  rows: DailyOwnerMetrics[];
  totals: Omit<DailyOwnerMetrics, 'owner'> & { allTimeResumes: number };
  unassigned: number;
}
```

Resolve owner by exact `position_id`, exact normalized mapped title, then exact alias. Multiple owner candidates are ambiguous and counted as unassigned. Create the native `table` component with four rows (three owners and 合计), `freeze_first_column: true`, and nine declared columns.

- [ ] **Step 4: Implement deterministic summary fallback**

`buildDailyReportFallbackSummary` must identify the highest `todayNew + todayApproved + todayInterviews` owner, state the largest pending queue, and output one next-day action. It must use only snapshot aggregates and must return a bounded Chinese string.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `cd worker && npx vitest run tests/daily-report.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

```bash
git add worker/src/daily-reports/report.ts worker/tests/daily-report.test.ts
git commit -m "feat: build owner-based daily report snapshots"
```

### Task 5: Unify manual and cron daily report generation and sending

**Files:**
- Modify: `worker/src/index.ts:8562-8705`
- Modify: `worker/src/index.ts:9678-9755`
- Modify: `worker/tests/daily-report.test.ts`

**Interfaces:**
- Consumes: the Task 4 snapshot/card functions, `queryDailyCandidatesByOwner`, `callAI`, and existing Feishu chat/user message helpers.
- Produces: one stored snapshot used by `/generate`, `/:id/send`, and `/cron/daily-report`.

- [ ] **Step 1: Add a failing legacy-snapshot compatibility test**

```ts
it('converts a legacy report into a v2 display snapshot without inventing owner data', () => {
  const snapshot = normalizeStoredDailyReportSnapshot({
    report_date: '2026-08-09', total_resumes: 10, pending_screening: 2,
    approved: 1, rejected: 1, total_interviews: 1, total_onboarding: 0,
  });
  expect(snapshot.rows.map((row) => row.todayNew)).toEqual([0, 0, 0]);
  expect(snapshot.totals.allTimeResumes).toBe(10);
});
```

- [ ] **Step 2: Run the compatibility test and verify RED**

Run: `cd worker && npx vitest run tests/daily-report.test.ts`

Expected: FAIL because `normalizeStoredDailyReportSnapshot` is not implemented.

- [ ] **Step 3: Implement D1 dataset loading and snapshot persistence**

Load only the columns needed from positions, mappings, resumes, interviews, offers, and onboarding records. Resume loading must be bounded to current pending rows or rows created/updated on the report date, plus a separate `COUNT(*)` for all-time totals.

Insert the report with:

```sql
INSERT INTO daily_reports (
  id, report_date, total_resumes, pending_screening, approved, rejected,
  total_interviews, total_offers, total_onboarding, ai_summary, stats,
  candidate_details, created_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
```

`stats` stores the full v2 snapshot and `candidate_details` stores the candidate-detail snapshot generated at the same time.

- [ ] **Step 4: Reuse the stored snapshot for manual sending**

Parse `daily_reports.stats` through `normalizeStoredDailyReportSnapshot`, build the native table card, and send to the selected chat or user. Do not call live aggregate queries from `/:id/send`.

- [ ] **Step 5: Reuse generation and card functions in cron**

Use the Shanghai calendar date, create and persist the same daily report snapshot, then send that stored snapshot to `FEISHU_CONFIG.recruitmentGroupChatId`. Remove the duplicate markdown-only cron statistics implementation.

- [ ] **Step 6: Run focused and full Worker tests**

Run:

```bash
cd worker && npx vitest run tests/daily-report.test.ts
cd worker && npm test
```

Expected: focused daily tests pass and all Worker test files pass.

- [ ] **Step 7: Commit Task 5**

```bash
git add worker/src/index.ts worker/tests/daily-report.test.ts
git commit -m "feat: unify daily report generation and delivery"
```

### Task 6: End-to-end local verification and documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-08-10-feishu-interview-reminder-daily-report-design.md` only if implementation reveals a documented constraint that changed.

**Interfaces:**
- Consumes: completed reminder and daily-report routes.
- Produces: verified local build and an operator-facing permission note.

- [ ] **Step 1: Run every automated check**

Run:

```bash
cd worker && npm test
cd worker && npx tsc --noEmit
cd frontend && npm test
cd frontend && npx eslint src/pages/Interviews/reminderFeedback.ts src/pages/Interviews/reminderFeedback.test.ts
cd frontend && npm run build
```

Expected: all commands exit 0. Existing third-party bundle warnings may be recorded, but no TypeScript, focused test, focused lint, or build errors are allowed. The pre-existing whole-frontend lint baseline is 617 errors and 19 warnings on `main`; it is recorded but is outside this feature's scope.

- [ ] **Step 2: Start local services and verify with agent-browser**

Start the repository's existing local development commands, log in locally, open `/interviews` and `/daily-reports`, and verify:

- Reminder button disables while sending.
- Complete and partial delivery responses show different messages.
- Daily report generation returns a v2 snapshot and existing detail UI still opens.
- No request targets `ai-interview-88r.pages.dev` during local verification.

- [ ] **Step 3: Update README operator notes**

Document that manual reminders require the current user to bind Feishu, interviewer mappings must use the same application, and the Feishu application must have file upload permission for PDF delivery.

- [ ] **Step 4: Review the Worker changes against current Cloudflare guidance**

Check every new fetch is awaited, no request state is stored globally, KV uses the binding, Feishu responses are bounded JSON, no secret is hardcoded, and no PDF bytes are logged.

- [ ] **Step 5: Commit Task 6**

```bash
git add README.md docs/superpowers/specs/2026-08-10-feishu-interview-reminder-daily-report-design.md
git commit -m "docs: document Feishu reminder permissions"
```

- [ ] **Step 6: Final branch verification**

Run: `git status --short --branch && git log --oneline main..HEAD`

Expected: clean branch with the design, implementation-plan, reminder, daily-report, integration, and documentation commits. Do not push or deploy without explicit approval.
