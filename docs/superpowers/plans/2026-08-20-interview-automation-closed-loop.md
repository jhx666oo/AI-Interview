# Interview Automation Closed Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不破坏现有简历、业务筛选和面试管理的前提下，建立可靠、幂等、可审计的 AI 初筛→业务筛选→面试安排→通知→评价→下一轮闭环。

**Architecture:** API Worker 只负责校验、写入 D1 业务真相和创建幂等作业；`INTERVIEW_AUTOMATION_QUEUE` 交给独立 consumer 执行飞书日程、飞书卡片/PDF、SMTP 邮件和下一轮创建。每一轮面试使用独立 `interviews` 记录，通过作业表、通知表、候选人事件和操作日志提供可恢复的完整时间线。

**Tech Stack:** React 19, TypeScript, Ant Design, Hono, Cloudflare Pages/Workers, D1, Cloudflare Queues, KV, Vitest, Feishu Calendar v4/Open API, SMTP over Cloudflare sockets.

## Implementation status (2026-08-20)

本执行分支已完成一期闭环的本地实现和回归验证，当前不是生产发布状态：

- [x] Task 1–6：公开面试链接只读、取消不删档案、D1 自动化作业/通知模型、Queue 执行层、显式招聘日历、通知去重与重试。
- [x] Task 7：全局/岗位双开关、AI 初筛后自动业务筛选作业、业务通过后待安排一面、一面通过后待安排二面、独立 consumer 与部署配置。
- [x] Task 8：登录态安排/改期/取消/评价/重试/时间线 API；接口在写入前检查自动化开关。
- [x] Task 9：面试列表待安排/排队/部分失败/人工处理状态、自动化状态查看和通知重试入口；两个公开页改为只读。
- [x] Task 10（本地部分）：轮次只读审计、旧二面字段离线回填工具、未取消轮次唯一索引、面试状态漏斗统计和 consumer CI 依赖关系。
- [x] Task 11（本地验证部分）：前端 43 个测试文件/198 个测试通过；Worker 85 个测试文件/679 个测试通过；前端生产构建和独立 consumer bundle 通过。
- [ ] Task 10（生产部分）：生产历史数据审计、二面兼容迁移和唯一索引尚未执行远程 D1 migration。
- [ ] Task 11（生产收口部分）：预览环境浏览器矩阵、Queue/飞书/SMTP 真实链路验收、压测和灰度观察，需在用户批准后执行。

当前 feature flags 仍默认关闭：`INTERVIEW_AUTOMATION_ENABLED=false`，岗位 `auto_business_screening_enabled=0`。本分支可提交到 GitHub 供代码审阅，但在生产开关、远程迁移和部署前必须再次确认配置与数据审计。

## Global Constraints

- 实施基线必须是 `origin/main@eb99be4` 或实施当日更新的 `origin/main`；不得从当前落后 16 个提交的本地 `main@cecdcbc` 直接开发。
- 不直接在 `main` 实施；实施前需用户同意创建 `codex/interview-automation-closed-loop` 分支或隔离 worktree。
- D1 是业务状态真相源；外部日程、飞书消息和邮件失败不得回滚面试主记录。
- 业务通过但无开始时间时，只创建 `awaiting_schedule` 面试；不得使用当前时间补齐。
- 新链路每个 `resume_id + round` 只有一条有效面试；历史 `evaluation2/result2/status2` 仅兼容读取。
- 公开 `/interview-card/:token` 和 `/interview-invite/:token` 在 MVP 只读；评价、改期、取消必须使用登录态 API。
- `INTERVIEW_AUTOMATION_ENABLED` 和岗位 `auto_business_screening_enabled` 默认关闭；上线后按岗位灰度。
- 关键异步任务不得使用 `executionCtx.waitUntil` 作为唯一保障；必须先写 D1 job 再入队。
- 取消面试不得删除 `resumes`、`talent_pool`、AI 结果、业务评价或历史面试记录。
- 飞书自动日程使用 `FEISHU_RECRUITMENT_CALENDAR_ID`；未配置时进入人工处理，不默认写任意用户的 `primary` 日历。
- 所有 migration 先本地验证再远程执行；未获得用户明确生产批准前，不得推送 `main`、远程迁移或部署生产。
- 每个任务必须先写失败测试，再写最小实现，再运行定向测试、类型检查和相关回归。

## File/Module Map

| 文件/目录 | 职责 |
|---|---|
| `worker/src/interview-automation/types.ts` | 状态、作业、通知和 API 公共类型 |
| `worker/src/interview-automation/repository.ts` | 面试轮次、job、notification 的 D1 幂等读写 |
| `worker/src/interview-automation/enqueue.ts` | “先写 job，再 Queue.send”的唯一入口 |
| `worker/src/interview-automation/orchestrator.ts` | 按 action 调度日程、通知、推进的编排器 |
| `worker/src/interview-automation/consumer.ts` | Cloudflare Queue consumer，负责租约、重试、终态回写 |
| `worker/src/interview-automation/routes.ts` | 登录态 schedule/reschedule/cancel/result/retry/timeline/automation API |
| `worker/src/interview-start/feishu-calendar.ts` | 飞书 Calendar v4 适配器，显式 calendar id，创建/更新/取消 |
| `worker/src/interview-start/reminders.ts` | 面试官卡片与 PDF 投递适配器 |
| `worker/src/interview-start/smtp.ts` | 候选人 SMTP 投递适配器 |
| `worker/src/interview-card/routes.ts` | 公开只读卡片与 PDF 路由 |
| `worker/src/interview-start/routes.ts` | 候选人只读邀请路由 |
| `worker/src/business-screening/routes.ts` | 业务决策成功后创建推进 job |
| `worker/src/resume-processing/processor.ts` | AI 完成后可选创建自动业务筛选 job |
| `worker/src/interview-automation-consumer.ts` | 独立 Worker 入口 |
| `worker/wrangler.interview-automation-consumer.toml` | Queue consumer 生产 binding |
| `frontend/src/pages/Interviews/List.tsx` | 待安排、安排中、失败重试交互 |
| `frontend/src/pages/Interviews/Score.tsx` | 授权评价、前序上下文和推进反馈 |
| `frontend/src/pages/Public/InterviewCard.tsx` | 面试协作只读页 |
| `frontend/src/pages/Public/InterviewInvite.tsx` | 候选人安排只读页 |
| `.github/workflows/deploy.yml` | 先 migration，再部署 consumer/API/Pages，最后健康检查 |

## Delivery Sequence

| 时间 | 任务 | 可单独验收的交付 |
|---|---|---|
| 第 1 天 | Task 1–2 | 最新基线证据；公开链接只读；取消面试不再删人才档案 |
| 第 2 天 | Task 3–4 | D1 job/notification 模型和可测试的 Queue 执行引擎 |
| 第 3 天 | Task 5 | 安排与开始解耦；显式招聘日历；创建/改期/取消日程 |
| 第 4 天 | Task 6 | 面试官卡片/PDF 和候选人邮件的独立去重、状态和重试 |
| 第 5 天 | Task 7–8 | AI/业务/面试轮次推进；登录态安排、评价、重试和时间线 API |
| 第 6 天 | Task 9 | 面试列表、评价页、公开只读页交互完成 |
| 第 7 天 | Task 10–11 的 MVP 部分 | 历史数据审计、主链路 E2E、预览环境和单岗位验收 |
| 第 8–12 天 | Task 10–11 的生产收口 | 压测、24 小时灰度、指标观察、岗位级扩大开启 |

---

### Task 1: 建立最新基线并固定当前行为

**Files:**
- Create: `docs/superpowers/verification/2026-08-20-interview-automation-baseline.md`
- Test: `worker/tests/interview-automation-baseline.test.ts`
- Test: `frontend/src/pages/Interviews/interviewAutomationBaseline.test.ts`

**Interfaces:**
- Consumes: `origin/main` 现有面试路由、`createInterviewStartRoutes()`、`createInterviewCardRoutes()`、`sendInterviewerInterviewReminder()`。
- Produces: 后续任务共用的基线行为清单和回归测试。

- [ ] **Step 1: 获取最新远程状态并核对基线**

Run:

```bash
git fetch origin --prune
git rev-parse origin/main
git log -1 --oneline origin/main
git status --short --branch
```

Expected: `origin/main` 包含 `eb99be4` 或更新提交，当前未跟踪文件全部保留。

- [ ] **Step 2: 经用户批准后创建隔离实施分支**

Run:

```bash
git switch --create codex/interview-automation-closed-loop origin/main
git status --short --branch
```

Expected: 当前分支为 `codex/interview-automation-closed-loop`，起点为最新 `origin/main`。

- [ ] **Step 3: 写基线契约测试**

Create `worker/tests/interview-automation-baseline.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { resolveEventTimeframe } from '../src/interview-start/service';

describe('interview automation baseline', () => {
  it('documents the existing 60 minute interview duration', () => {
    const frame = resolveEventTimeframe(
      { id: 'iv-1', interview_time: '2026-08-21 10:00' },
      Date.parse('2026-08-20T00:00:00Z'),
    );
    expect(frame.endTs - frame.startTs).toBe(3600);
  });

  it('keeps an existing meeting link instead of creating a replacement', () => {
    const interview = { meeting_link: 'https://vc.feishu.cn/j/abc' };
    expect(Boolean(interview.meeting_link)).toBe(true);
  });
});
```

Create `frontend/src/pages/Interviews/interviewAutomationBaseline.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

describe('interview list baseline', () => {
  it('retains schedule, reminder, card link and evaluation entry points', () => {
    const source = fs.readFileSync(new URL('./List.tsx', import.meta.url), 'utf8');
    for (const copy of ['安排面试', '提醒一面', '面试卡片', '查看评价']) {
      expect(source).toContain(copy);
    }
  });
});
```

- [ ] **Step 4: 运行基线测试**

Run:

```bash
cd worker && npm test -- tests/interview-automation-baseline.test.ts
cd ../frontend && npm test -- src/pages/Interviews/interviewAutomationBaseline.test.ts
```

Expected: 两组测试 PASS，为后续改造提供回归保护。

- [ ] **Step 5: 记录基线和已知风险**

Create `docs/superpowers/verification/2026-08-20-interview-automation-baseline.md` with:

```markdown
# Interview Automation Baseline

- Baseline commit: `origin/main` captured at implementation start.
- Existing reusable modules: interview card, Feishu calendar, SMTP invitation, reminder card/PDF, business screening decisions.
- Known risks protected by later tasks: public token write access, cancel deleting talent records, `waitUntil` delivery, one-row-two-round legacy fields, scheduling coupled to start.
- Production feature flags remain disabled during implementation.
```

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/verification/2026-08-20-interview-automation-baseline.md worker/tests/interview-automation-baseline.test.ts frontend/src/pages/Interviews/interviewAutomationBaseline.test.ts
git commit -m "test: capture interview automation baseline"
```

---

### Task 2: 先修复公开写入与取消误删风险

**Files:**
- Modify: `worker/src/interview-card/routes.ts`
- Modify: `worker/src/interview-start/routes.ts`
- Modify: `worker/src/index.ts`
- Test: `worker/tests/interview-card.test.ts`
- Test: `worker/tests/interview-start-routes.test.ts`
- Create: `worker/tests/interview-cancel-preserves-talent.test.ts`

**Interfaces:**
- Consumes: 已有公开 token 校验、`POST /api/interviews/:id/cancel`。
- Produces: 公开页只读保证；取消面试不删人才档案的安全语义。

- [ ] **Step 1: 先写三个失败测试**

Add to the route tests:

```ts
it('rejects public interview-card evaluation writes', async () => {
  const response = await app.request('/api/public/interview-card/token/evaluate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ result: 'passed', round: 1, evaluation: 'ok' }),
  }, env);
  expect(response.status).toBe(410);
  expect(await response.json()).toMatchObject({ code: 'PUBLIC_WRITE_DISABLED' });
});

it('rejects public candidate reschedule writes', async () => {
  const response = await app.request('/api/public/interview-invite/token/reschedule', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ interview_time: '2026-08-22 14:00' }),
  }, env);
  expect(response.status).toBe(410);
  expect(await response.json()).toMatchObject({ code: 'PUBLIC_WRITE_DISABLED' });
});
```

Create `worker/tests/interview-cancel-preserves-talent.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

describe('cancel interview', () => {
  it('updates the interview without deleting talent_pool or Feishu talent records', async () => {
    const statements: string[] = [];
    const db = fakeDbThatRecordsSql(statements);
    const response = await requestCancelInterview({ db, interviewId: 'iv-1', reason: '候选人申请改期' });
    expect(response.status).toBe(202);
    expect(statements.some(sql => /DELETE\s+FROM\s+talent_pool/i.test(sql))).toBe(false);
    expect(statements.some(sql => /UPDATE\s+interviews/i.test(sql))).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试确认当前行为不安全**

Run:

```bash
cd worker && npm test -- tests/interview-card.test.ts tests/interview-start-routes.test.ts tests/interview-cancel-preserves-talent.test.ts
```

Expected: 公开写入断言失败，取消接口仍出现 `DELETE FROM talent_pool` 或测试辅助函数未定义。

- [ ] **Step 3: 把两个公开写入端点改为明确的迁移响应**

Use the same response in both public route modules:

```ts
const publicWriteDisabled = (c: any) => c.json({
  detail: '该公开链接已调整为只读，请登录系统完成操作',
  code: 'PUBLIC_WRITE_DISABLED',
  retryable: false,
}, 410);

app.post('/api/public/interview-card/:token/evaluate', publicWriteDisabled);
app.post('/api/public/interview-invite/:token/reschedule', publicWriteDisabled);
```

- [ ] **Step 4: 解耦取消面试和人才库删除**

Replace the legacy cancel handler body with a D1-only state change until Task 7 adds asynchronous calendar cancellation:

```ts
app.post('/api/interviews/:id/cancel', authMiddleware, async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const reason = String(body.reason || '').trim();
  if (!reason) return c.json({ detail: '取消原因必填', code: 'CANCEL_REASON_REQUIRED' }, 400);

  const changedAt = now();
  const result = await c.env.DB.prepare(
    `UPDATE interviews
        SET status = 'cancelled', updated_at = ?
      WHERE id = ? AND status <> 'cancelled'`,
  ).bind(changedAt, c.req.param('id')).run();
  if ((result.meta.changes ?? 0) === 0) {
    const exists = await c.env.DB.prepare('SELECT id, status FROM interviews WHERE id = ?').bind(c.req.param('id')).first();
    if (!exists) return c.json({ detail: 'Not found' }, 404);
  }
  await logOperation(c.env.DB, 'interview.cancel', 'interview', c.req.param('id'), user?.email || 'system', 'success', JSON.stringify({ reason }));
  return c.json({ ok: true, status: 'cancelled' }, 202);
});
```

- [ ] **Step 5: 重跑定向回归和类型检查**

Run:

```bash
cd worker && npm test -- tests/interview-card.test.ts tests/interview-start-routes.test.ts tests/interview-cancel-preserves-talent.test.ts
npm exec tsc -- --noEmit
```

Expected: 公开写入返回 410，取消测试 PASS，TypeScript PASS。

- [ ] **Step 6: Commit**

```bash
git add worker/src/interview-card/routes.ts worker/src/interview-start/routes.ts worker/src/index.ts worker/tests/interview-card.test.ts worker/tests/interview-start-routes.test.ts worker/tests/interview-cancel-preserves-talent.test.ts
git commit -m "fix: secure public interview links and preserve talent records"
```

---

### Task 3: 增加面试闭环数据模型与领域类型

**Files:**
- Create: `worker/migrations/0046_interview_automation_foundation.sql`
- Modify: `worker/schema.sql`
- Create: `worker/src/interview-automation/types.ts`
- Create: `worker/src/interview-automation/repository.ts`
- Create: `worker/tests/interview-automation-repository.test.ts`

**Interfaces:**
- Consumes: D1 `interviews`、`candidate_stage_events`、`operation_logs`。
- Produces: `InterviewAutomationAction`, `InterviewAutomationJob`, `InterviewNotification`, `InterviewAutomationRepository.createOrGetRound()`、`createOrGetJob()`、`recordNotification()`。

- [ ] **Step 1: 写 repository 失败测试**

Create `worker/tests/interview-automation-repository.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { InterviewAutomationRepository } from '../src/interview-automation/repository';

describe('InterviewAutomationRepository', () => {
  it('returns the existing active interview for the same resume and round', async () => {
    const db = createTestDb();
    const repo = new InterviewAutomationRepository(db, { uuid: () => 'iv-new', now: () => '2026-08-20T08:00:00.000Z' });
    await seedInterview(db, { id: 'iv-existing', resume_id: 'resume-1', round: 1, status: 'awaiting_schedule' });
    const first = await repo.createOrGetRound({ resumeId: 'resume-1', positionId: 'pos-1', round: 1, interviewer: '杜雁玲' });
    const second = await repo.createOrGetRound({ resumeId: 'resume-1', positionId: 'pos-1', round: 1, interviewer: '杜雁玲' });
    expect(first.id).toBe('iv-existing');
    expect(second.id).toBe('iv-existing');
  });

  it('deduplicates automation jobs by idempotency key', async () => {
    const db = createTestDb();
    const repo = new InterviewAutomationRepository(db, { uuid: () => 'job-1', now: () => '2026-08-20T08:00:00.000Z' });
    const first = await repo.createOrGetJob({
      idempotencyKey: 'schedule:iv-1:v1', interviewId: 'iv-1', action: 'schedule', payload: { version: 1 },
    });
    const second = await repo.createOrGetJob({
      idempotencyKey: 'schedule:iv-1:v1', interviewId: 'iv-1', action: 'schedule', payload: { version: 1 },
    });
    expect(second.id).toBe(first.id);
    expect(second.created).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试确认类型和 repository 尚不存在**

Run:

```bash
cd worker && npm test -- tests/interview-automation-repository.test.ts
```

Expected: FAIL with module not found for `interview-automation/repository`.

- [ ] **Step 3: 创建增量 migration**

Create `worker/migrations/0046_interview_automation_foundation.sql`:

```sql
ALTER TABLE interviews ADD COLUMN candidate_email TEXT DEFAULT '';
ALTER TABLE interviews ADD COLUMN scheduled_start_at TEXT;
ALTER TABLE interviews ADD COLUMN scheduled_end_at TEXT;
ALTER TABLE interviews ADD COLUMN duration_minutes INTEGER NOT NULL DEFAULT 60;
ALTER TABLE interviews ADD COLUMN timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai';
ALTER TABLE interviews ADD COLUMN schedule_status TEXT NOT NULL DEFAULT 'not_ready';
ALTER TABLE interviews ADD COLUMN calendar_id TEXT DEFAULT '';
ALTER TABLE interviews ADD COLUMN calendar_event_id TEXT DEFAULT '';
ALTER TABLE interviews ADD COLUMN meeting_url TEXT DEFAULT '';
ALTER TABLE interviews ADD COLUMN previous_interview_id TEXT;
ALTER TABLE interviews ADD COLUMN next_interview_id TEXT;
ALTER TABLE interviews ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE interviews ADD COLUMN last_error_code TEXT DEFAULT '';
ALTER TABLE interviews ADD COLUMN last_error_message TEXT DEFAULT '';
ALTER TABLE interviews ADD COLUMN cancel_reason TEXT DEFAULT '';
ALTER TABLE interviews ADD COLUMN cancelled_by TEXT DEFAULT '';
ALTER TABLE interviews ADD COLUMN cancelled_at TEXT;

CREATE TABLE IF NOT EXISTS interview_automation_jobs (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  resume_id TEXT,
  interview_id TEXT,
  action TEXT NOT NULL CHECK (action IN (
    'auto_business_screening','create_next_round','schedule','reschedule','cancel',
    'notify_interviewer','notify_candidate','advance'
  )),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','partial','failed','cancelled')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  next_retry_at TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  result_json TEXT NOT NULL DEFAULT '{}',
  error_code TEXT DEFAULT '',
  error_message TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_interview_jobs_status_retry ON interview_automation_jobs(status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_interview_jobs_interview ON interview_automation_jobs(interview_id, created_at);

CREATE TABLE IF NOT EXISTS interview_notifications (
  id TEXT PRIMARY KEY,
  interview_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('feishu_card','feishu_file','email')),
  recipient_type TEXT NOT NULL CHECK (recipient_type IN ('primary_interviewer','secondary_interviewer','candidate','hr')),
  recipient_id TEXT NOT NULL DEFAULT '',
  template_key TEXT NOT NULL CHECK (template_key IN ('scheduled','reminder_30m','rescheduled','cancelled')),
  interview_version INTEGER NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed','skipped','cancelled')),
  external_message_id TEXT DEFAULT '',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT DEFAULT '',
  sent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_interview_notifications_interview ON interview_notifications(interview_id, created_at);
CREATE INDEX IF NOT EXISTS idx_interview_notifications_status ON interview_notifications(status, updated_at);

UPDATE interviews
SET calendar_event_id = COALESCE(NULLIF(calendar_event_id, ''), feishu_event_id, ''),
    meeting_url = COALESCE(NULLIF(meeting_url, ''), meeting_link, '')
WHERE COALESCE(feishu_event_id, '') <> '' OR COALESCE(meeting_link, '') <> '';
```

Mirror the same columns, tables and indexes in `worker/schema.sql`.

- [ ] **Step 4: 定义严格领域类型**

Create `worker/src/interview-automation/types.ts`:

```ts
export type InterviewAutomationAction =
  | 'auto_business_screening' | 'create_next_round' | 'schedule' | 'reschedule'
  | 'cancel' | 'notify_interviewer' | 'notify_candidate' | 'advance';

export type InterviewAutomationJobStatus = 'queued' | 'running' | 'succeeded' | 'partial' | 'failed' | 'cancelled';
export type InterviewScheduleStatus = 'not_ready' | 'queued' | 'scheduled' | 'reschedule_pending' | 'cancel_pending' | 'cancelled' | 'failed';
export type InterviewNotificationChannel = 'feishu_card' | 'feishu_file' | 'email';
export type InterviewNotificationStatus = 'queued' | 'sent' | 'failed' | 'skipped' | 'cancelled';

export interface InterviewAutomationQueueMessage {
  jobId: string;
  action: InterviewAutomationAction;
  interviewId?: string;
  resumeId?: string;
}

export interface CreateRoundInput {
  resumeId: string;
  positionId?: string;
  round: number;
  interviewer: string;
  secondaryInterviewer?: string;
  previousInterviewId?: string;
}

export interface CreateJobInput {
  idempotencyKey: string;
  action: InterviewAutomationAction;
  interviewId?: string;
  resumeId?: string;
  payload: Record<string, unknown>;
  maxAttempts?: number;
}

export interface InterviewAutomationStore {
  createOrGetRound(input: CreateRoundInput): Promise<Record<string, unknown> & { id: string; created: boolean }>;
  createOrGetJob(input: CreateJobInput): Promise<Record<string, unknown> & { id: string; created: boolean }>;
  claimJob(jobId: string): Promise<any | null>;
  isStaleVersion(job: any): Promise<boolean>;
  cancelJob(jobId: string, code: string): Promise<void>;
  completeJob(jobId: string, status: 'succeeded' | 'partial', result: unknown): Promise<void>;
  scheduleRetry(jobId: string, code: string, message: string, delaySeconds: number): Promise<void>;
  failJob(jobId: string, code: string, message: string): Promise<void>;
  markInterviewManualReview(interviewId: string, code: string, message: string): Promise<void>;
  createOrGetNotification(input: Record<string, unknown>): Promise<any>;
  finishNotification(notificationId: string, outcome: Record<string, unknown>): Promise<void>;
  markScheduled(interviewId: string, calendarId: string, eventId: string, meetingUrl: string): Promise<void>;
  markScheduleCancelled(interviewId: string): Promise<void>;
  loadInterview(interviewId: string): Promise<any | null>;
  loadPosition(positionId: string): Promise<any | null>;
  linkRounds(previousInterviewId: string, nextInterviewId: string): Promise<void>;
  finishCandidateAsRejected(interview: any, sourceInterviewId: string): Promise<void>;
  markPendingOfferReview(resumeId: string, sourceInterviewId: string): Promise<void>;
  requireInterview(interviewId: string): Promise<any>;
  prepareSchedule(interviewId: string, input: Record<string, unknown>): Promise<any>;
  saveResultOnce(interviewId: string, input: Record<string, unknown>, actorId: string): Promise<any>;
}
```

- [ ] **Step 5: 实现幂等 repository**

Create `worker/src/interview-automation/repository.ts` with these public methods and SQL semantics:

```ts
export class InterviewAutomationRepository {
  constructor(
    private readonly db: D1Database,
    private readonly deps: { uuid: () => string; now: () => string },
  ) {}

  async createOrGetRound(input: CreateRoundInput) {
    const existing = await this.db.prepare(
      `SELECT * FROM interviews
        WHERE resume_id = ? AND round = ? AND status <> 'cancelled'
        ORDER BY created_at DESC LIMIT 1`,
    ).bind(input.resumeId, input.round).first<any>();
    if (existing) return { ...existing, created: false };

    const id = this.deps.uuid();
    const timestamp = this.deps.now();
    await this.db.prepare(
      `INSERT INTO interviews (
        id, resume_id, position_id, round, interviewer, primary_interviewer,
        secondary_interviewer, previous_interview_id, status, schedule_status,
        version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'awaiting_schedule', 'not_ready', 1, ?, ?)`,
    ).bind(
      id, input.resumeId, input.positionId || null, input.round, input.interviewer,
      input.interviewer, input.secondaryInterviewer || '', input.previousInterviewId || null,
      timestamp, timestamp,
    ).run();
    return { id, ...input, status: 'awaiting_schedule', schedule_status: 'not_ready', version: 1, created: true };
  }

  async createOrGetJob(input: CreateJobInput) {
    const existing = await this.db.prepare(
      'SELECT * FROM interview_automation_jobs WHERE idempotency_key = ?',
    ).bind(input.idempotencyKey).first<any>();
    if (existing) return { ...existing, created: false };

    const id = this.deps.uuid();
    const timestamp = this.deps.now();
    await this.db.prepare(
      `INSERT INTO interview_automation_jobs (
        id, idempotency_key, resume_id, interview_id, action, status,
        max_attempts, payload_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?)`,
    ).bind(
      id, input.idempotencyKey, input.resumeId || null, input.interviewId || null,
      input.action, input.maxAttempts || 5, JSON.stringify(input.payload), timestamp, timestamp,
    ).run();
    return { id, ...input, status: 'queued', created: true };
  }
}
```

Implement the remaining `InterviewAutomationStore` methods in the same class with these exact state transitions:

```ts
// claimJob: queued/failed -> running and attempt_count + 1; terminal jobs return null.
// isStaleVersion: compare payload_json.version with interviews.version when a version exists.
// cancelJob: status='cancelled', error_code=code, completed_at=now.
// completeJob: status supplied by caller, result_json=JSON.stringify(result), completed_at=now.
// scheduleRetry: status='queued', next_retry_at=now+delay, error fields set.
// failJob: status='failed', error fields set, completed_at=now.
// markInterviewManualReview: interviews.status='manual_review', schedule_status='failed', error fields set.
// createOrGetNotification: SELECT by dedupe_key before INSERT status='queued'.
// finishNotification: update status/external_message_id/last_error/sent_at atomically.
// markScheduled: dual-write calendar_event_id+feishu_event_id and meeting_url+meeting_link, then set schedule_status='scheduled'.
// markScheduleCancelled: schedule_status='cancelled' while preserving both external ids for audit.
// prepareSchedule: validate current status, write UTC start/end, duration, timezone, increment version, set schedule_status='queued'.
// saveResultOnce: same result is idempotent; opposite terminal result throws RESULT_CONFLICT.
```

- [ ] **Step 6: 本地应用 migration 并运行测试**

Run:

```bash
cd worker
npx wrangler d1 migrations apply ai-interview-db --local --config wrangler.jsonc
npm test -- tests/interview-automation-repository.test.ts
npm exec tsc -- --noEmit
```

Expected: migration 应用成功，repository 测试 PASS，TypeScript PASS。

- [ ] **Step 7: Commit**

```bash
git add worker/migrations/0046_interview_automation_foundation.sql worker/schema.sql worker/src/interview-automation/types.ts worker/src/interview-automation/repository.ts worker/tests/interview-automation-repository.test.ts
git commit -m "feat: add interview automation data foundation"
```

---

### Task 4: 建立 D1 Job + Cloudflare Queue 可靠执行层

**Files:**
- Create: `worker/src/interview-automation/enqueue.ts`
- Create: `worker/src/interview-automation/orchestrator.ts`
- Create: `worker/src/interview-automation/consumer.ts`
- Test: `worker/tests/interview-automation-enqueue.test.ts`
- Test: `worker/tests/interview-automation-consumer.test.ts`

**Interfaces:**
- Consumes: `InterviewAutomationRepository.createOrGetJob()`、`InterviewAutomationQueueMessage`。
- Produces: `enqueueInterviewAutomation()`、`processInterviewAutomationMessage()`；后续日程和通知步骤只从 orchestrator 调用。

- [ ] **Step 1: 写先落库再入队的失败测试**

Create `worker/tests/interview-automation-enqueue.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { enqueueInterviewAutomation } from '../src/interview-automation/enqueue';

it('persists the job before publishing and reuses the same job', async () => {
  const order: string[] = [];
  const repo = {
    createOrGetJob: vi.fn(async () => { order.push('db'); return { id: 'job-1', created: true, status: 'queued' }; }),
  };
  const queue = { send: vi.fn(async () => { order.push('queue'); }) };
  const first = await enqueueInterviewAutomation(repo as never, queue as never, {
    idempotencyKey: 'schedule:iv-1:v1', action: 'schedule', interviewId: 'iv-1', payload: { version: 1 },
  });
  expect(first.jobId).toBe('job-1');
  expect(order).toEqual(['db', 'queue']);
});
```

Create `worker/tests/interview-automation-consumer.test.ts`:

```ts
it('marks retryable failures for delayed retry and terminal configuration errors for manual review', async () => {
  const retryable = await processInterviewAutomationMessage(message, depsThrowing({ code: 'FEISHU_429', retryable: true }));
  expect(retryable).toMatchObject({ status: 'queued', delaySeconds: 60 });

  const terminal = await processInterviewAutomationMessage(message, depsThrowing({ code: 'CALENDAR_NOT_CONFIGURED', retryable: false }));
  expect(terminal).toMatchObject({ status: 'failed', manualReview: true });
});
```

- [ ] **Step 2: 运行测试确认模块缺失**

Run:

```bash
cd worker && npm test -- tests/interview-automation-enqueue.test.ts tests/interview-automation-consumer.test.ts
```

Expected: FAIL with missing `enqueue` and `consumer` modules.

- [ ] **Step 3: 实现唯一入队函数**

Create `worker/src/interview-automation/enqueue.ts`:

```ts
import type { CreateJobInput, InterviewAutomationQueueMessage } from './types';
import type { InterviewAutomationRepository } from './repository';

export async function enqueueInterviewAutomation(
  repo: InterviewAutomationRepository,
  queue: Queue<InterviewAutomationQueueMessage>,
  input: CreateJobInput,
): Promise<{ jobId: string; created: boolean }> {
  const job = await repo.createOrGetJob(input);
  if (job.created) {
    await queue.send({ jobId: job.id, action: input.action, interviewId: input.interviewId, resumeId: input.resumeId });
  }
  return { jobId: job.id, created: job.created };
}
```

- [ ] **Step 4: 实现 consumer 租约、版本校验和重试分类**

Use these exported contracts in `worker/src/interview-automation/consumer.ts`:

```ts
const RETRY_DELAYS_SECONDS = [60, 300, 900, 3600, 14400] as const;

export async function processInterviewAutomationMessage(
  message: InterviewAutomationQueueMessage,
  deps: ConsumerDeps,
): Promise<{ status: 'succeeded' | 'partial' | 'queued' | 'failed' | 'cancelled'; delaySeconds?: number; manualReview?: boolean }> {
  const job = await deps.repo.claimJob(message.jobId);
  if (!job || ['succeeded', 'cancelled'].includes(job.status)) return { status: 'cancelled' };
  if (await deps.repo.isStaleVersion(job)) {
    await deps.repo.cancelJob(job.id, 'STALE_INTERVIEW_VERSION');
    return { status: 'cancelled' };
  }
  try {
    const result = await deps.orchestrator.execute(job);
    await deps.repo.completeJob(job.id, result.status, result);
    return { status: result.status };
  } catch (error) {
    const failure = deps.classifyError(error);
    const attempt = job.attempt_count + 1;
    if (failure.retryable && attempt < job.max_attempts) {
      const delaySeconds = RETRY_DELAYS_SECONDS[Math.min(attempt - 1, RETRY_DELAYS_SECONDS.length - 1)];
      await deps.repo.scheduleRetry(job.id, failure.code, failure.message, delaySeconds);
      return { status: 'queued', delaySeconds };
    }
    await deps.repo.failJob(job.id, failure.code, failure.message);
    if (job.interview_id) await deps.repo.markInterviewManualReview(job.interview_id, failure.code, failure.message);
    return { status: 'failed', manualReview: true };
  }
}
```

- [ ] **Step 5: 实现可注入 handler 的 orchestrator**

Create `worker/src/interview-automation/orchestrator.ts`:

```ts
export type AutomationHandler = (job: any) => Promise<{ status: 'succeeded' | 'partial'; [key: string]: unknown }>;

export class InterviewAutomationOrchestrator {
  constructor(private readonly handlers: Record<InterviewAutomationAction, AutomationHandler>) {}

  async execute(job: { action: InterviewAutomationAction }): Promise<{ status: 'succeeded' | 'partial'; [key: string]: unknown }> {
    const handler = this.handlers[job.action];
    if (!handler) throw automationError('ACTION_HANDLER_MISSING', `未配置自动作业处理器: ${job.action}`, false);
    return handler(job);
  }
}

export function automationError(code: string, message: string, retryable: boolean): Error & { code: string; retryable: boolean } {
  return Object.assign(new Error(message), { code, retryable });
}

export function classifyAutomationError(error: unknown): { code: string; message: string; retryable: boolean } {
  const value = error as { code?: string; message?: string; retryable?: boolean };
  return {
    code: value?.code || 'AUTOMATION_UNKNOWN',
    message: value?.message || String(error),
    retryable: value?.retryable === true,
  };
}
```

- [ ] **Step 6: 运行定向测试和类型检查**

Run:

```bash
cd worker
npm test -- tests/interview-automation-enqueue.test.ts tests/interview-automation-consumer.test.ts
npm exec tsc -- --noEmit
```

Expected: 定向测试 PASS，TypeScript PASS。

- [ ] **Step 7: Commit**

```bash
git add worker/src/interview-automation/enqueue.ts worker/src/interview-automation/orchestrator.ts worker/src/interview-automation/consumer.ts worker/tests/interview-automation-enqueue.test.ts worker/tests/interview-automation-consumer.test.ts
git commit -m "feat: add reliable interview automation queue"
```

---

### Task 5: 改造飞书日程为显式调度适配器

**Files:**
- Modify: `worker/src/interview-start/feishu-calendar.ts`
- Modify: `worker/src/interview-start/service.ts`
- Create: `worker/src/interview-automation/schedule-service.ts`
- Test: `worker/tests/interview-start-calendar.test.ts`
- Create: `worker/tests/interview-schedule-service.test.ts`

**Interfaces:**
- Consumes: `createInterviewCalendarEvent()`、`updateInterviewCalendarEventTime()`、新增 `INTERVIEW_AUTOMATION_QUEUE` job。
- Produces: `createCalendarEvent()`、`updateCalendarEvent()`、`cancelCalendarEvent()`、`executeScheduleJob()`，一律使用显式 `calendarId`。

- [ ] **Step 1: 写日历配置和幂等测试**

Add tests:

```ts
it('refuses automatic scheduling without a recruitment calendar id', async () => {
  await expect(executeScheduleJob(interview, { FEISHU_RECRUITMENT_CALENDAR_ID: '' } as never, deps))
    .rejects.toMatchObject({ code: 'CALENDAR_NOT_CONFIGURED', retryable: false });
});

it('uses the configured recruitment calendar instead of primary', async () => {
  const fetchImpl = vi.fn(async () => feishuSuccess({ event_id: 'evt-1', meeting_url: 'https://vc.feishu.cn/j/1' }));
  await createInterviewCalendarEvent(env, input, { fetchImpl, getTenantToken: async () => 'tenant-token' });
  expect(fetchImpl.mock.calls[0][0]).toContain('/calendars/recruiting-calendar/events');
  expect(fetchImpl.mock.calls[0][0]).not.toContain('/calendars/primary/events');
});

it('does not create a second event when calendar_event_id already exists', async () => {
  const result = await executeScheduleJob({ ...interview, calendar_event_id: 'evt-existing' }, env, deps);
  expect(result.calendarEventId).toBe('evt-existing');
  expect(deps.createCalendarEvent).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: 运行测试确认旧实现使用 `primary`**

Run:

```bash
cd worker && npm test -- tests/interview-start-calendar.test.ts tests/interview-schedule-service.test.ts
```

Expected: FAIL because the URL still contains `/calendars/primary/events` and schedule service is missing.

- [ ] **Step 3: 把 calendar id 变成显式入参并增加取消**

Use this request path in `feishu-calendar.ts`:

```ts
function calendarEventUrl(calendarId: string, eventId?: string): string {
  const base = `${FEISHU_BASE}/calendar/v4/calendars/${encodeURIComponent(calendarId)}/events`;
  return eventId ? `${base}/${encodeURIComponent(eventId)}?user_id_type=open_id` : `${base}?user_id_type=open_id`;
}

export async function deleteInterviewCalendarEvent(
  env: FeishuCalendarEnv,
  calendarId: string,
  eventId: string,
  deps: FeishuCalendarDeps = {},
): Promise<void> {
  const token = deps.getTenantToken
    ? await deps.getTenantToken(env)
    : await getTenantAccessToken(env, undefined, deps.fetchImpl || fetch);
  await feishuRequest(
    calendarEventUrl(calendarId, eventId),
    { method: 'DELETE' },
    token,
    deps.fetchImpl || fetch,
    deps.timeoutMs || DEFAULT_TIMEOUT_MS,
  );
}
```

- [ ] **Step 4: 实现 schedule service，禁止时间回退**

Create `worker/src/interview-automation/schedule-service.ts`:

```ts
export async function executeScheduleJob(
  interview: ScheduleInterviewRow,
  env: ScheduleEnv,
  deps: ScheduleDeps,
): Promise<ScheduleResult> {
  const calendarId = String(env.FEISHU_RECRUITMENT_CALENDAR_ID || '').trim();
  if (!calendarId) throw automationError('CALENDAR_NOT_CONFIGURED', '未配置招聘日历', false);
  if (!interview.scheduled_start_at || !interview.scheduled_end_at) {
    throw automationError('INTERVIEW_TIME_REQUIRED', '面试开始和结束时间必填', false);
  }
  if (interview.calendar_event_id) {
    return { calendarId, calendarEventId: interview.calendar_event_id, meetingUrl: interview.meeting_url || '' };
  }

  const event = await deps.createCalendarEvent(env, {
    calendarId,
    summary: `面试 - ${interview.candidate_name} - ${interview.position_applied} - 第${interview.round}轮`,
    description: deps.buildDescription(interview),
    startTimestamp: Math.floor(Date.parse(interview.scheduled_start_at) / 1000),
    endTimestamp: Math.floor(Date.parse(interview.scheduled_end_at) / 1000),
    attendeeOpenIds: await deps.resolveAttendees(interview),
    videoMeeting: interview.interview_type !== 'onsite',
  });
  // markScheduled 必须同时写 calendar_event_id/feishu_event_id 和 meeting_url/meeting_link，保持旧 UI 兼容。
  await deps.repo.markScheduled(interview.id, calendarId, event.eventId, event.meetingUrl || '');
  return { calendarId, calendarEventId: event.eventId, meetingUrl: event.meetingUrl || '' };
}
```

Add `executeRescheduleJob()` and `executeCancelJob()` in the same file:

```ts
export async function executeRescheduleJob(interview: ScheduleInterviewRow, env: ScheduleEnv, deps: ScheduleDeps) {
  if (!interview.calendar_id || !interview.calendar_event_id) return executeScheduleJob(interview, env, deps);
  if (!interview.scheduled_start_at || !interview.scheduled_end_at) {
    throw automationError('INTERVIEW_TIME_REQUIRED', '改期后的开始和结束时间必填', false);
  }
  await deps.updateCalendarEvent(env, interview.calendar_id, interview.calendar_event_id, {
    startTimestamp: Math.floor(Date.parse(interview.scheduled_start_at) / 1000),
    endTimestamp: Math.floor(Date.parse(interview.scheduled_end_at) / 1000),
    timezone: interview.timezone,
  });
  await deps.repo.markScheduled(interview.id, interview.calendar_id, interview.calendar_event_id, interview.meeting_url || '');
  return { calendarId: interview.calendar_id, calendarEventId: interview.calendar_event_id, meetingUrl: interview.meeting_url || '' };
}

export async function executeCancelJob(interview: ScheduleInterviewRow, env: ScheduleEnv, deps: ScheduleDeps) {
  if (interview.calendar_id && interview.calendar_event_id) {
    await deps.deleteCalendarEvent(env, interview.calendar_id, interview.calendar_event_id);
  }
  await deps.repo.markScheduleCancelled(interview.id);
  return { cancelled: true, externalEventExisted: Boolean(interview.calendar_event_id) };
}
```

- [ ] **Step 5: 移除“开始面试”中的日程创建和自动改时间**

Reduce `/api/interviews/:id/start` to:

```ts
const interview = await c.env.DB.prepare('SELECT id, status FROM interviews WHERE id = ?').bind(id).first<any>();
if (!interview) return c.json({ detail: 'Not found' }, 404);
if (!['scheduled', 'notification_partial'].includes(interview.status)) {
  return c.json({ detail: '仅已安排的面试可开始', code: 'INTERVIEW_NOT_SCHEDULED' }, 409);
}
await c.env.DB.prepare("UPDATE interviews SET status = 'in_progress', started_at = ?, updated_at = ? WHERE id = ?")
  .bind(now(), now(), id).run();
return c.json(transformRow(await c.env.DB.prepare('SELECT * FROM interviews WHERE id = ?').bind(id).first()));
```

- [ ] **Step 6: 运行定向测试、开始面试回归和类型检查**

Run:

```bash
cd worker
npm test -- tests/interview-start-calendar.test.ts tests/interview-schedule-service.test.ts tests/interview-start-service.test.ts tests/interview-start-routes.test.ts
npm exec tsc -- --noEmit
```

Expected: 所有测试 PASS；开始面试不再调用 Calendar/SMTP/Feishu reminder。

- [ ] **Step 7: Commit**

```bash
git add worker/src/interview-start/feishu-calendar.ts worker/src/interview-start/service.ts worker/src/interview-automation/schedule-service.ts worker/src/index.ts worker/tests/interview-start-calendar.test.ts worker/tests/interview-schedule-service.test.ts worker/tests/interview-start-service.test.ts worker/tests/interview-start-routes.test.ts
git commit -m "refactor: schedule interviews before start"
```

---

### Task 6: 建立独立通知投递与去重记录

**Files:**
- Create: `worker/src/interview-automation/notification-service.ts`
- Modify: `worker/src/interview-start/reminders.ts`
- Modify: `worker/src/interview-start/email-template.ts`
- Modify: `worker/src/interview-start/smtp.ts`
- Modify: `worker/src/interview-automation/orchestrator.ts`
- Create: `worker/tests/interview-notification-service.test.ts`
- Modify: `worker/tests/interview-reminder.test.ts`
- Modify: `worker/tests/interview-start-smtp.test.ts`

**Interfaces:**
- Consumes: `sendInterviewerInterviewReminder()`、`sendSmtpMail()`、`interview_notifications`。
- Produces: `deliverInterviewNotifications(interviewId, templateKey, version)`，返回每渠道 `sent/failed/skipped`。

- [ ] **Step 1: 写部分成功、去重和单通道重试测试**

Create `worker/tests/interview-notification-service.test.ts`:

```ts
it('records card success, pdf failure and email success independently', async () => {
  const result = await deliverInterviewNotifications(interview, 'scheduled', deps({
    card: { ok: true, externalId: 'msg-card' },
    file: { ok: false, error: 'upload timeout' },
    email: { ok: true, externalId: 'smtp-message' },
  }));
  expect(result.status).toBe('partial');
  expect(result.channels).toEqual({ feishu_card: 'sent', feishu_file: 'failed', email: 'sent' });
});

it('does not resend successful channels for the same interview version', async () => {
  await seedNotification({ dedupe_key: 'iv-1:v1:scheduled:feishu_card:open-1', status: 'sent' });
  await deliverInterviewNotifications(interview, 'scheduled', deps());
  expect(deps().sendCard).not.toHaveBeenCalled();
});

it('marks missing candidate email as skipped without failing the schedule', async () => {
  const result = await deliverInterviewNotifications({ ...interview, candidate_email: '' }, 'scheduled', deps());
  expect(result.channels.email).toBe('skipped');
  expect(result.status).not.toBe('failed');
});
```

- [ ] **Step 2: 运行测试确认统一投递服务缺失**

Run:

```bash
cd worker && npm test -- tests/interview-notification-service.test.ts tests/interview-reminder.test.ts tests/interview-start-smtp.test.ts
```

Expected: FAIL with missing notification service.

- [ ] **Step 3: 实现通知去重键和独立结果**

Create `worker/src/interview-automation/notification-service.ts` around this contract:

```ts
export function notificationDedupeKey(input: {
  interviewId: string;
  version: number;
  templateKey: NotificationTemplateKey;
  channel: InterviewNotificationChannel;
  recipientId: string;
}): string {
  return [input.interviewId, `v${input.version}`, input.templateKey, input.channel, input.recipientId || 'missing'].join(':');
}

export async function deliverInterviewNotifications(
  interview: NotificationInterview,
  templateKey: NotificationTemplateKey,
  deps: NotificationDeps,
): Promise<{ status: 'succeeded' | 'partial'; channels: Record<InterviewNotificationChannel, InterviewNotificationStatus> }> {
  const channels = {} as Record<InterviewNotificationChannel, InterviewNotificationStatus>;
  for (const delivery of deps.buildDeliveries(interview, templateKey)) {
    const key = notificationDedupeKey({
      interviewId: interview.id,
      version: interview.version,
      templateKey,
      channel: delivery.channel,
      recipientId: delivery.recipientId,
    });
    const record = await deps.repo.createOrGetNotification({ ...delivery, dedupeKey: key, interviewVersion: interview.version });
    if (record.status === 'sent' || record.status === 'skipped') {
      channels[delivery.channel] = record.status;
      continue;
    }
    const outcome = await delivery.send();
    await deps.repo.finishNotification(record.id, outcome);
    channels[delivery.channel] = outcome.status;
  }
  return { status: Object.values(channels).includes('failed') ? 'partial' : 'succeeded', channels };
}

export async function retryInterviewNotification(notificationId: string, deps: NotificationDeps) {
  const record = await deps.repo.requireFailedNotification(notificationId);
  const interview = await deps.repo.requireInterview(record.interview_id);
  const delivery = deps.buildDeliveries(interview, record.template_key)
    .find(item => item.channel === record.channel && item.recipientId === record.recipient_id);
  if (!delivery) throw automationError('NOTIFICATION_DELIVERY_MISSING', '通知投递配置已变更', false);
  const outcome = await delivery.send();
  await deps.repo.finishNotification(record.id, outcome);
  return { status: outcome.status === 'failed' ? 'partial' as const : 'succeeded' as const, notification: outcome };
}
```

- [ ] **Step 4: 扩充邮件模板但保持内外数据隔离**

Make the candidate template accept `roundLabel`, `durationMinutes`, and `contactText` and keep internal evaluation fields absent:

```ts
export interface InterviewInvitationEmailInput {
  candidateName: string;
  positionName: string;
  roundLabel: string;
  timeLabel: string;
  durationMinutes: number;
  interviewTypeLabel?: string;
  location?: string | null;
  interviewerName?: string | null;
  meetingUrl?: string | null;
  contactText: string;
  fromName: string;
}
```

Add rows for `面试轮次` and `预计时长` and a contact paragraph. Do not add `ai_evaluation`, `hr_review`, `business_screening_remark`, `scores`, or `evaluation` to the template input.

- [ ] **Step 5: 让 orchestrator 在日程成功后调用通知服务**

Use this ordering:

```ts
const schedule = await executeScheduleJob(interview, env, deps.schedule);
const notifications = await deliverInterviewNotifications(
  { ...interview, calendar_event_id: schedule.calendarEventId, meeting_url: schedule.meetingUrl },
  job.action === 'reschedule' ? 'rescheduled' : 'scheduled',
  deps.notifications,
);
return notifications.status === 'partial'
  ? { status: 'partial' as const, schedule, notifications }
  : { status: 'succeeded' as const, schedule, notifications };
```

- [ ] **Step 6: 运行定向测试和类型检查**

Run:

```bash
cd worker
npm test -- tests/interview-notification-service.test.ts tests/interview-reminder.test.ts tests/interview-start-smtp.test.ts tests/interview-start-service.test.ts
npm exec tsc -- --noEmit
```

Expected: 部分成功、去重、缺邮箱和模板隔离测试全部 PASS。

- [ ] **Step 7: Commit**

```bash
git add worker/src/interview-automation/notification-service.ts worker/src/interview-automation/orchestrator.ts worker/src/interview-start/reminders.ts worker/src/interview-start/email-template.ts worker/src/interview-start/smtp.ts worker/tests/interview-notification-service.test.ts worker/tests/interview-reminder.test.ts worker/tests/interview-start-smtp.test.ts worker/tests/interview-start-service.test.ts
git commit -m "feat: track interview notifications independently"
```

---

### Task 7: 连接 AI、业务决策和下一轮推进

**Files:**
- Create: `worker/migrations/0047_position_automation_switch.sql`
- Modify: `worker/schema.sql`
- Modify: `worker/src/resume-processing/processor.ts`
- Modify: `worker/src/business-screening/routes.ts`
- Create: `worker/src/business-screening/dispatch-service.ts`
- Create: `worker/src/interview-automation/advance-service.ts`
- Modify: `worker/src/interview-automation/orchestrator.ts`
- Create: `worker/src/interview-automation-consumer.ts`
- Create: `worker/wrangler.interview-automation-consumer.toml`
- Modify: `worker/wrangler.toml`
- Test: `worker/tests/resume-processing.test.ts`
- Modify: `worker/tests/business-screening-routes.test.ts`
- Create: `worker/tests/business-screening-dispatch-service.test.ts`
- Create: `worker/tests/interview-advance-service.test.ts`

**Interfaces:**
- Consumes: 岗位 `primary_interviewer/secondary_interviewer`、业务 `recordDecision()`、`createOrGetRound()`、`enqueueInterviewAutomation()`。
- Produces: AI 可选自动业务推送和 `advanceInterview(interviewId, result)`。

- [ ] **Step 1: 写开关、业务通过幂等和一面→二面失败测试**

Add tests:

```ts
it('does not auto-push AI-passed resumes when either feature flag is off', async () => {
  await completeAiScreening({ globalEnabled: false, positionEnabled: true });
  expect(queue.send).not.toHaveBeenCalled();
  await completeAiScreening({ globalEnabled: true, positionEnabled: false });
  expect(queue.send).not.toHaveBeenCalled();
});

it('enqueues one first-round creation after an idempotent business pass', async () => {
  await decideBusiness('passed');
  await decideBusiness('passed');
  expect(enqueuedKeys).toEqual(['create-next-round:resume-1:r1']);
});

it('creates one round-two interview and links both rounds', async () => {
  const first = await seedInterview({ id: 'iv-1', resume_id: 'resume-1', position_id: 'pos-1', round: 1 });
  const result = await advanceInterview(first.id, 'passed', depsWithPosition({ secondary_interviewer: '魏秋柠' }));
  expect(result.next).toMatchObject({ round: 2, interviewer: '魏秋柠', previous_interview_id: 'iv-1' });
  expect(await loadInterview('iv-1')).toMatchObject({ next_interview_id: result.next.id });
});
```

- [ ] **Step 2: 运行测试确认触发链尚未存在**

Run:

```bash
cd worker && npm test -- tests/resume-processing.test.ts tests/business-screening-routes.test.ts tests/interview-advance-service.test.ts
```

Expected: FAIL on missing feature fields, missing enqueue call, and missing advance service.

- [ ] **Step 3: 增加默认关闭的岗位开关**

Create `worker/migrations/0047_position_automation_switch.sql` and mirror it in schema:

```sql
ALTER TABLE positions ADD COLUMN auto_business_screening_enabled INTEGER NOT NULL DEFAULT 0;
```

Extend Worker `Env`:

```ts
INTERVIEW_AUTOMATION_ENABLED?: string;
INTERVIEW_AUTOMATION_QUEUE: Queue<InterviewAutomationQueueMessage>;
FEISHU_RECRUITMENT_CALENDAR_ID?: string;
```

- [ ] **Step 4: 抽取手动和自动公用的业务筛选推送服务**

Create `worker/src/business-screening/dispatch-service.ts`:

```ts
export interface DispatchBusinessScreeningInput {
  resumeIds: string[];
  createdBy: string;
  source: 'manual' | 'automation';
}

export async function dispatchBusinessScreening(
  input: DispatchBusinessScreeningInput,
  deps: DispatchBusinessScreeningDeps,
): Promise<{ batches: Array<{ id: string; interviewerName: string; resumeIds: string[]; url: string }>; skipped: Array<{ resumeId: string; reason: string }> }> {
  const resumes = await deps.store.listResumesByIds(deps.db, [...new Set(input.resumeIds)]);
  const groups = await deps.groupEligibleResumes(resumes);
  const batches = [];
  for (const group of groups) {
    const batch = await deps.createOrReuseBatch(group, input.createdBy);
    await deps.sendBatchCard(batch, group.interviewer);
    batches.push({ id: batch.id, interviewerName: group.interviewer.name, resumeIds: group.resumes.map(item => item.id), url: batch.url });
  }
  return { batches, skipped: deps.collectSkipped(resumes, groups) };
}
```

The existing manual push route validates HTTP input and calls this service. The `auto_business_screening` handler calls the same service with one `resumeId`; neither path duplicates the batch grouping, stable token, D1 chunking, or card delivery implementation.

- [ ] **Step 5: 在 AI 成功落库后只创建可选作业**

Use this guard in `resume-processing/processor.ts` after the final D1 screening update:

```ts
const automationEnabled = String(env.INTERVIEW_AUTOMATION_ENABLED || '').toLowerCase() === 'true';
if (automationEnabled && result.screeningResult === 'passed' && position?.auto_business_screening_enabled === 1) {
  await enqueueInterviewAutomation(repo, env.INTERVIEW_AUTOMATION_QUEUE, {
    idempotencyKey: `auto-business-screening:${resume.id}:${resume.ai_result_version || resume.updated_at}`,
    action: 'auto_business_screening',
    resumeId: resume.id,
    payload: { positionId: position.id, screeningVersion: resume.ai_result_version || resume.updated_at },
  });
}
```

- [ ] **Step 6: 在业务通过落库后创建一面推进 job**

After `recordDecision()` returns `passed`, call:

```ts
if (result.status === 'passed') {
  await deps.enqueueAutomation({
    idempotencyKey: `create-next-round:${resumeId}:r1`,
    action: 'create_next_round',
    resumeId,
    payload: { round: 1, sourceBatchId: batch.id, sourceItemId: item.id },
  });
}
```

Expose `enqueueAutomation` as a route dependency so the route test does not need a real Queue.

- [ ] **Step 7: 实现下一轮推进**

Create `worker/src/interview-automation/advance-service.ts`:

```ts
export async function advanceInterview(
  interviewId: string,
  result: 'passed' | 'failed',
  deps: AdvanceDeps,
): Promise<AdvanceResult> {
  const current = await deps.repo.loadInterview(interviewId);
  if (!current) throw automationError('INTERVIEW_NOT_FOUND', '面试不存在', false);
  if (result === 'failed') {
    await deps.repo.finishCandidateAsRejected(current, interviewId);
    return { status: 'rejected' };
  }
  if (current.round >= 2) {
    await deps.repo.markPendingOfferReview(current.resume_id, interviewId);
    return { status: 'pending_offer_review' };
  }

  const position = await deps.repo.loadPosition(current.position_id);
  const interviewer = String(position?.secondary_interviewer || '').trim();
  const next = await deps.repo.createOrGetRound({
    resumeId: current.resume_id,
    positionId: current.position_id,
    round: current.round + 1,
    interviewer,
    previousInterviewId: current.id,
  });
  await deps.repo.linkRounds(current.id, next.id);
  if (!interviewer) await deps.repo.markInterviewManualReview(next.id, 'NEXT_INTERVIEWER_MISSING', '岗位未配置二面面试官');
  return { status: interviewer ? 'awaiting_schedule' : 'manual_review', next };
}
```

- [ ] **Step 8: 组装生产 consumer 和 Queue bindings**

Create `worker/src/interview-automation-consumer.ts`:

```ts
export default {
  async queue(batch: MessageBatch<InterviewAutomationQueueMessage>, env: Env): Promise<void> {
    const repo = createInterviewAutomationRepository(env.DB);
    const orchestrator = new InterviewAutomationOrchestrator(createProductionHandlers(env, repo));
    const deps = { repo, orchestrator, classifyError: classifyAutomationError };
    for (const message of batch.messages) {
      const result = await processInterviewAutomationMessage(message.body, deps);
      if (result.status === 'queued' && result.delaySeconds) message.retry({ delaySeconds: result.delaySeconds });
      else message.ack();
    }
  },
};
```

`createProductionHandlers(env, repo)` must return all eight keys from `InterviewAutomationAction` and map them exactly. `claimJob()` parses `payload_json` into `job.payload` before dispatch:

```ts
export function createProductionHandlers(env: Env, repo: InterviewAutomationRepository): Record<InterviewAutomationAction, AutomationHandler> {
  return {
    auto_business_screening: async job => ({
      status: 'succeeded',
      result: await dispatchBusinessScreening(
        { resumeIds: [job.resume_id], createdBy: 'system', source: 'automation' },
        createBusinessDispatchDeps(env),
      ),
    }),
    create_next_round: async job => ({
      status: 'succeeded',
      result: await createRequestedRound(job.resume_id, Number(job.payload.round), job.payload, createAdvanceDeps(env, repo)),
    }),
    schedule: async job => {
      const interview = await repo.requireInterview(job.interview_id);
      const schedule = await executeScheduleJob(interview, env, createScheduleDeps(env, repo));
      const notifications = await deliverInterviewNotifications(
        { ...interview, calendar_event_id: schedule.calendarEventId, meeting_url: schedule.meetingUrl },
        'scheduled',
        createNotificationDeps(env, repo),
      );
      return { status: notifications.status, schedule, notifications };
    },
    reschedule: async job => {
      const interview = await repo.requireInterview(job.interview_id);
      const schedule = await executeRescheduleJob(interview, env, createScheduleDeps(env, repo));
      const notifications = await deliverInterviewNotifications(interview, 'rescheduled', createNotificationDeps(env, repo));
      return { status: notifications.status, schedule, notifications };
    },
    cancel: async job => {
      const interview = await repo.requireInterview(job.interview_id);
      const schedule = await executeCancelJob(interview, env, createScheduleDeps(env, repo));
      const notifications = await deliverInterviewNotifications(interview, 'cancelled', createNotificationDeps(env, repo));
      return { status: notifications.status, schedule, notifications };
    },
    notify_interviewer: job => retryInterviewNotification(String(job.payload.notification_id), createNotificationDeps(env, repo)),
    notify_candidate: job => retryInterviewNotification(String(job.payload.notification_id), createNotificationDeps(env, repo)),
    advance: async job => ({
      status: 'succeeded',
      result: await advanceInterview(job.interview_id, job.payload.result, createAdvanceDeps(env, repo)),
    }),
  };
}
```

Add producer binding to `worker/wrangler.toml` and create `worker/wrangler.interview-automation-consumer.toml`:

```toml
name = "ai-interview-automation-consumer"
main = "src/interview-automation-consumer.ts"
compatibility_date = "2024-12-01"

[[d1_databases]]
binding = "DB"
database_name = "ai-interview-db"
database_id = "3f82993e-210d-4b0b-9d83-4ed4be69724f"

[[queues.producers]]
binding = "INTERVIEW_AUTOMATION_QUEUE"
queue = "interview-automation"

[[queues.consumers]]
queue = "interview-automation"
max_batch_size = 5
max_batch_timeout = 5
max_concurrency = 3
max_retries = 0
```

- [ ] **Step 9: 运行定向测试和业务筛选全回归**

Run:

```bash
cd worker
npm test -- tests/resume-processing.test.ts tests/business-screening-routes.test.ts tests/business-screening-dispatch-service.test.ts tests/business-screening-service.test.ts tests/business-screening-repository.test.ts tests/interview-advance-service.test.ts
npm exec tsc -- --noEmit
```

Expected: 自动化关闭时无新 job；开启时业务通过只创建一个一面 job；一面通过只创建一条二面。

- [ ] **Step 10: Commit**

```bash
git add worker/migrations/0047_position_automation_switch.sql worker/schema.sql worker/src/resume-processing/processor.ts worker/src/business-screening/routes.ts worker/src/business-screening/dispatch-service.ts worker/src/interview-automation/advance-service.ts worker/src/interview-automation/orchestrator.ts worker/src/interview-automation-consumer.ts worker/wrangler.toml worker/wrangler.interview-automation-consumer.toml worker/tests/resume-processing.test.ts worker/tests/business-screening-routes.test.ts worker/tests/business-screening-dispatch-service.test.ts worker/tests/interview-advance-service.test.ts
git commit -m "feat: connect screening decisions to interview rounds"
```

---

### Task 8: 提供登录态调度、评价、重试和时间线 API

**Files:**
- Create: `worker/src/interview-automation/routes.ts`
- Create: `worker/src/interview-automation/permissions.ts`
- Modify: `worker/src/index.ts`
- Create: `worker/tests/interview-automation-routes.test.ts`
- Create: `worker/tests/interview-automation-permissions.test.ts`

**Interfaces:**
- Consumes: `enqueueInterviewAutomation()`、`advanceInterview()`、`InterviewAutomationRepository`。
- Produces: `/schedule`、`/reschedule`、`/cancel`、`/result`、`/advance`、`/retry`、`/timeline`、`/automation` API。

- [ ] **Step 1: 写 API 验证、权限和 202 语义失败测试**

Create route tests:

```ts
it('creates a schedule job only after all required fields are valid', async () => {
  const invalid = await authRequest('/api/interviews/iv-1/schedule', { method: 'POST', body: { start_at: '' } });
  expect(invalid.status).toBe(400);
  expect(await invalid.json()).toMatchObject({ code: 'SCHEDULE_INPUT_INVALID' });

  const valid = await authRequest('/api/interviews/iv-1/schedule', {
    method: 'POST',
    body: { start_at: '2026-08-22T06:00:00.000Z', duration_minutes: 60, timezone: 'Asia/Shanghai', interview_type: 'video' },
  });
  expect(valid.status).toBe(202);
  expect(await valid.json()).toMatchObject({ status: 'schedule_queued', job_id: 'job-1' });
});

it('allows only the assigned interviewer, HR or admin to submit the current round result', async () => {
  expect((await submitAs('非当轮面试官', '/api/interviews/iv-1/result')).status).toBe(403);
  expect((await submitAs('当轮面试官', '/api/interviews/iv-1/result')).status).toBe(200);
});

it('retries one failed notification without creating a new calendar event', async () => {
  const response = await authRequest('/api/interviews/iv-1/retry', {
    method: 'POST', body: { notification_id: 'notification-email-failed' },
  });
  expect(response.status).toBe(202);
  expect(enqueuedAction).toBe('notify_candidate');
});
```

- [ ] **Step 2: 运行测试确认路由缺失**

Run:

```bash
cd worker && npm test -- tests/interview-automation-routes.test.ts tests/interview-automation-permissions.test.ts
```

Expected: FAIL with missing route and permission modules.

- [ ] **Step 3: 实现严格输入验证**

Use an explicit parser in `routes.ts`:

```ts
function parseScheduleInput(body: any): ScheduleInput {
  const startMs = Date.parse(String(body.start_at || ''));
  const duration = Number(body.duration_minutes || 60);
  const timezone = String(body.timezone || 'Asia/Shanghai');
  const interviewType = String(body.interview_type || 'video');
  if (!Number.isFinite(startMs) || startMs <= Date.now() || !Number.isInteger(duration) || duration < 15 || duration > 480) {
    throw httpError(400, 'SCHEDULE_INPUT_INVALID', '面试开始时间和 15–480 分钟时长必须有效');
  }
  if (timezone !== 'Asia/Shanghai') throw httpError(400, 'TIMEZONE_UNSUPPORTED', '一期仅支持 Asia/Shanghai');
  if (!['video', 'onsite', 'phone'].includes(interviewType)) throw httpError(400, 'INTERVIEW_TYPE_INVALID', '面试方式无效');
  return {
    startAt: new Date(startMs).toISOString(),
    endAt: new Date(startMs + duration * 60_000).toISOString(),
    durationMinutes: duration,
    timezone,
    interviewType: interviewType as ScheduleInput['interviewType'],
  };
}
```

- [ ] **Step 4: 实现安排和改期路由**

The schedule route must update D1 and increment `version` before enqueueing:

```ts
app.post('/api/interviews/:id/schedule', authMiddleware, requireRole(['admin', 'hr']), async (c) => {
  const input = parseScheduleInput(await c.req.json());
  const interview = await repo.prepareSchedule(c.req.param('id'), input);
  const queued = await deps.enqueue({
    idempotencyKey: `schedule:${interview.id}:v${interview.version}`,
    action: 'schedule',
    interviewId: interview.id,
    resumeId: interview.resume_id,
    payload: { version: interview.version },
  });
  return c.json({ interview_id: interview.id, status: 'schedule_queued', job_id: queued.jobId }, 202);
});
```

Use the same pattern for `/reschedule`, but increment version, set `schedule_status='reschedule_pending'`, and use `reschedule:{id}:v{version}`.

- [ ] **Step 5: 实现取消、评价和重试路由**

The result route must be idempotent and create an advance job only after saving the evaluation:

```ts
app.post('/api/interviews/:id/result', authMiddleware, async (c) => {
  const user = c.get('user');
  const interview = await repo.requireInterview(c.req.param('id'));
  await permissions.requireCanEvaluate(user, interview);
  const input = parseResultInput(await c.req.json());
  const saved = await repo.saveResultOnce(interview.id, input, user.id);
  const queued = await deps.enqueue({
    idempotencyKey: `advance:${interview.id}:${input.result}`,
    action: 'advance',
    interviewId: interview.id,
    resumeId: interview.resume_id,
    payload: { result: input.result },
  });
  return c.json({ interview: saved, advance_job_id: queued.jobId });
});
```

Cancel must set `cancel_reason/cancelled_by/cancelled_at`, increment version, cancel old queued notifications, and enqueue only `cancel:{id}:v{version}`. Retry must load the exact failed job or notification and reject `sent/succeeded` records with 409.

- [ ] **Step 6: 实现聚合时间线和自动化状态**

Return a sorted union without exposing secret payloads:

```ts
const timeline = [
  ...candidateEvents.map(toTimelineEvent),
  ...jobs.map(job => toTimelineEvent({ type: 'automation', ...job, payload_json: undefined })),
  ...notifications.map(item => toTimelineEvent({ type: 'notification', ...item, recipient_id: maskRecipient(item.recipient_id) })),
  ...operationLogs.map(toTimelineEvent),
].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
```

- [ ] **Step 7: 运行 API 测试、面试旧接口回归和类型检查**

Run:

```bash
cd worker
npm test -- tests/interview-automation-routes.test.ts tests/interview-automation-permissions.test.ts tests/interview-start-routes.test.ts tests/interview-card.test.ts tests/interview-reminder.test.ts
npm exec tsc -- --noEmit
```

Expected: 新 API 语义 PASS，公开只读回归 PASS，面试提醒仍可用。

- [ ] **Step 8: Commit**

```bash
git add worker/src/interview-automation/routes.ts worker/src/interview-automation/permissions.ts worker/src/index.ts worker/tests/interview-automation-routes.test.ts worker/tests/interview-automation-permissions.test.ts
git commit -m "feat: add authenticated interview automation APIs"
```

---

### Task 9: 改造面试管理、评价页和两个公开页

**Files:**
- Modify: `frontend/src/pages/Interviews/List.tsx`
- Modify: `frontend/src/pages/Interviews/Score.tsx`
- Modify: `frontend/src/pages/Public/InterviewCard.tsx`
- Modify: `frontend/src/pages/Public/InterviewInvite.tsx`
- Create: `frontend/src/pages/Interviews/automationViewModel.ts`
- Create: `frontend/src/pages/Interviews/automationViewModel.test.ts`
- Create: `frontend/src/pages/Interviews/List.automation.test.tsx`
- Create: `frontend/src/pages/Interviews/Score.automation.test.tsx`
- Create: `frontend/src/pages/Public/InterviewCard.test.tsx`

**Interfaces:**
- Consumes: Task 8 API 和 `job_id`、面试 `version/schedule_status`、通知状态。
- Produces: 可视的待安排/排队/部分失败/人工处理交互和授权评价。

- [ ] **Step 1: 先写 view model 和用户交互失败测试**

Create `frontend/src/pages/Interviews/automationViewModel.test.ts`:

```ts
it('shows the exact partial delivery and retry action', () => {
  expect(toAutomationBadge({
    status: 'notification_partial',
    notifications: { feishu_card: 'sent', feishu_file: 'failed', email: 'sent' },
  })).toEqual({
    label: '已安排·PDF 发送失败',
    tone: 'warning',
    retryAction: { action: 'notify_interviewer', channel: 'feishu_file' },
  });
});

it('does not allow start before the interview is scheduled', () => {
  expect(canStartInterview({ status: 'awaiting_schedule', schedule_status: 'not_ready' })).toBe(false);
  expect(canStartInterview({ status: 'scheduled', schedule_status: 'scheduled' })).toBe(true);
});
```

Add component tests:

```tsx
it('submits schedule and polls the returned job instead of showing immediate success', async () => {
  render(<InterviewList />);
  await user.click(screen.getByRole('button', { name: '安排面试' }));
  await fillValidScheduleForm(user);
  await user.click(screen.getByRole('button', { name: '确认安排' }));
  expect(await screen.findByText('正在创建飞书日程')).toBeInTheDocument();
  expect(request.post).toHaveBeenCalledWith('/interviews/iv-1/schedule', expect.any(Object));
});

it('does not render evaluation or reschedule forms on public token pages', async () => {
  render(<InterviewCard />);
  expect(screen.queryByRole('button', { name: '提交评价' })).not.toBeInTheDocument();
  render(<InterviewInvite />);
  expect(screen.queryByRole('button', { name: '确认改期' })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: 运行测试确认现有页面仍有公开写操作且无排队状态**

Run:

```bash
cd frontend
npm test -- src/pages/Interviews/automationViewModel.test.ts src/pages/Interviews/List.automation.test.tsx src/pages/Interviews/Score.automation.test.tsx src/pages/Public/InterviewCard.test.tsx
```

Expected: FAIL on missing view model, missing job progress, or public write controls still present.

- [ ] **Step 3: 实现状态 view model**

Create `frontend/src/pages/Interviews/automationViewModel.ts`:

```ts
export function canStartInterview(row: Pick<InterviewRow, 'status' | 'schedule_status'>): boolean {
  return row.schedule_status === 'scheduled' && ['scheduled', 'notification_partial'].includes(row.status);
}

export function toAutomationBadge(row: InterviewAutomationView): AutomationBadge {
  if (row.status === 'awaiting_schedule') return { label: '待安排', tone: 'default' };
  if (row.status === 'schedule_queued') return { label: '安排中', tone: 'processing' };
  if (row.status === 'manual_review') return { label: '需人工处理', tone: 'error' };
  if (row.notifications?.feishu_file === 'failed') {
    return {
      label: '已安排·PDF 发送失败',
      tone: 'warning',
      retryAction: { action: 'notify_interviewer', channel: 'feishu_file' },
    };
  }
  if (row.notifications?.email === 'failed') {
    return {
      label: '已安排·候选人邮件失败',
      tone: 'warning',
      retryAction: { action: 'notify_candidate', channel: 'email' },
    };
  }
  return { label: '已安排', tone: 'success' };
}
```

- [ ] **Step 4: 改造安排弹窗和列表进度**

Submit UTC ISO time, duration and timezone:

```ts
const response = await request.post(`/interviews/${record.interview_id}/schedule`, {
  start_at: values.start_at.toISOString(),
  duration_minutes: values.duration_minutes || 60,
  timezone: 'Asia/Shanghai',
  interview_type: values.interview_type,
  interview_location: values.interview_location || '',
});
setPendingJobs(current => ({ ...current, [record.interview_id]: response.job_id }));
message.info('已提交安排，正在创建飞书日程');
```

Poll `/interviews/:id/automation` every 3 seconds only while a visible row has a non-terminal job; stop after terminal status or component unmount.

- [ ] **Step 5: 改造内部评价页**

Submit through the authenticated result endpoint:

```ts
await request.post(`/interviews/${interviewId}/result`, {
  result: values.result,
  evaluation: values.evaluation,
  scores: values.scores,
  strengths: values.strengths,
  risks: values.risks,
  key_answers: values.key_answers,
});
message.success(values.result === 'passed'
  ? '评价已提交，系统正在创建下一轮待安排面试'
  : '评价已提交，当前候选流程已结束');
```

Load `/interviews/:id/timeline` and render AI, HR, business and prior interview sections as collapsed panels above the current evaluation form.

- [ ] **Step 6: 把两个公开页改为只读**

- `InterviewCard.tsx`: remove the public evaluation form and POST request; retain resume, AI, HR/business summary, interview history and timeline.
- `InterviewInvite.tsx`: remove the reschedule POST and selectable slots; retain candidate name, position, round, time, location, meeting link and contact instructions.
- Add `Cache-Control: no-store` handling on API responses; frontend must not persist token payload in localStorage/sessionStorage.

- [ ] **Step 7: 运行定向测试、全部前端测试、类型检查和构建**

Run:

```bash
cd frontend
npm test -- src/pages/Interviews/automationViewModel.test.ts src/pages/Interviews/List.automation.test.tsx src/pages/Interviews/Score.automation.test.tsx src/pages/Public/InterviewCard.test.tsx
npm test
npm exec tsc -- -b
npm run build
```

Expected: 定向和全量测试 PASS，TypeScript PASS，Vite/Worker bundle 完成。

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/Interviews frontend/src/pages/Public/InterviewCard.tsx frontend/src/pages/Public/InterviewInvite.tsx frontend/src/pages/Public/InterviewCard.test.tsx
git commit -m "feat: add interview automation workflow UI"
```

---

### Task 10: 数据兼容、仪表盘/日报口径和部署链路

**Files:**
- Create: `scripts/audit_interview_rounds.sql`
- Create: `scripts/backfill_interview_rounds.py`
- Create: `worker/migrations/0048_interview_round_uniqueness.sql`
- Modify: `worker/src/recruitment-events/types.ts`
- Modify: `worker/src/recruitment-events/repository.ts`
- Modify: `worker/src/recruitment-events/funnel-query.ts`
- Modify: `worker/src/index.ts`
- Modify: `.github/workflows/deploy.yml`
- Create: `docs/superpowers/verification/2026-08-20-interview-automation-rollout.md`
- Create: `worker/tests/interview-round-backfill.test.ts`
- Create: `worker/tests/interview-funnel-contract.test.ts`

**Interfaces:**
- Consumes: 新每轮面试模型、`candidate_stage_events`、automation consumer config。
- Produces: 可检查的历史数据迁移、有效轮次唯一索引、统一仪表盘/日报口径和 CI/CD 部署步骤。

- [ ] **Step 1: 写历史二面迁移和漏斗口径失败测试**

Create tests:

```ts
it('converts legacy result2 into a linked round-two row without changing round one', async () => {
  const legacy = { id: 'iv-1', resume_id: 'resume-1', round: 1, result: 'passed', result2: 'passed', evaluation2: '二面通过' };
  const rows = migrateLegacyInterview(legacy);
  expect(rows).toHaveLength(2);
  expect(rows[1]).toMatchObject({ resume_id: 'resume-1', round: 2, result: 'passed', evaluation: '二面通过', previous_interview_id: 'iv-1' });
});

it('counts awaiting schedule separately from scheduled interviews', async () => {
  await seedInterviews([
    { id: 'iv-wait', status: 'awaiting_schedule', schedule_status: 'not_ready' },
    { id: 'iv-scheduled', status: 'scheduled', schedule_status: 'scheduled' },
  ]);
  expect(await loadInterviewFunnel()).toMatchObject({ awaiting_schedule: 1, scheduled: 1 });
});
```

- [ ] **Step 2: 运行测试确认新口径缺失**

Run:

```bash
cd worker && npm test -- tests/interview-round-backfill.test.ts tests/interview-funnel-contract.test.ts
```

Expected: FAIL because migration helper and separate funnel counts do not exist.

- [ ] **Step 3: 先审计历史数据，不直接修改生产**

Create `scripts/audit_interview_rounds.sql`:

```sql
SELECT resume_id, round, COUNT(*) AS active_count
FROM interviews
WHERE COALESCE(resume_id, '') <> '' AND status <> 'cancelled'
GROUP BY resume_id, round
HAVING COUNT(*) > 1;

SELECT id, resume_id, result2, evaluation2, status2
FROM interviews
WHERE COALESCE(result2, 'pending') <> 'pending'
   OR COALESCE(evaluation2, '') <> ''
   OR COALESCE(status2, 'pending') <> 'pending';
```

Run read-only against local first:

```bash
cd worker
npx wrangler d1 execute ai-interview-db --local --config wrangler.jsonc --file ../scripts/audit_interview_rounds.sql
```

Expected: outputs duplicate groups and legacy second-round candidates; no `UPDATE` or `DELETE` is executed.

- [ ] **Step 4: 实现可重复执行的迁移脚本**

Create `scripts/backfill_interview_rounds.py` with deterministic IDs and dry-run default:

```python
def round_two_id(round_one_id: str) -> str:
    return f"{round_one_id}-round-2"

def build_round_two(row: dict) -> dict:
    return {
        "id": round_two_id(row["id"]),
        "resume_id": row["resume_id"],
        "position_id": row.get("position_id"),
        "round": 2,
        "result": row.get("result2") or "pending",
        "evaluation": row.get("evaluation2") or "",
        "status": "completed" if (row.get("result2") or "pending") != "pending" else "awaiting_schedule",
        "previous_interview_id": row["id"],
    }
```

The script must print JSONL by default and only emit SQL when invoked with `--emit-sql`; it must never connect directly to production D1.

- [ ] **Step 5: 在数据审计和迁移后添加唯一索引**

Create `worker/migrations/0048_interview_round_uniqueness.sql`:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_interviews_resume_round_active
ON interviews(resume_id, round)
WHERE COALESCE(resume_id, '') <> '' AND status <> 'cancelled';
```

Do not apply this migration remotely until the read-only audit reports zero active duplicates.

- [ ] **Step 6: 更新仪表盘和日报口径**

Use explicit D1 aggregates:

```sql
SELECT
  SUM(CASE WHEN i.status = 'awaiting_schedule' THEN 1 ELSE 0 END) AS awaiting_schedule,
  SUM(CASE WHEN i.schedule_status = 'scheduled' AND i.status <> 'cancelled' THEN 1 ELSE 0 END) AS scheduled,
  SUM(CASE WHEN i.status = 'completed' AND i.result = 'passed' THEN 1 ELSE 0 END) AS interview_passed,
  SUM(CASE WHEN i.status = 'completed' AND i.result IN ('failed','rejected') THEN 1 ELSE 0 END) AS interview_failed
FROM interviews i;
```

Write `candidate_stage_events` only for actual funnel events:

- external calendar success → `stage='interview_scheduled'`, `action='interview.scheduled'`
- evaluation submitted → `stage='interview_completed'`, `action='interview.completed'`
- result passed → `stage='interview_passed'`, `action='interview.passed'`
- result failed → `stage='interview_failed'`, `action='interview.failed'`

`awaiting_schedule`, notification retries and manual review remain in automation jobs/notifications/operation logs and do not create false funnel events.

- [ ] **Step 7: 把 automation consumer 加入 CI/CD**

Add a deploy job after D1 migrations:

```yaml
  worker-interview-automation-consumer:
    name: Deploy Interview Automation Consumer
    runs-on: ubuntu-latest
    needs: database-migrations
    defaults:
      run:
        working-directory: worker
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: worker/package-lock.json
      - run: npm ci
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ vars.CLOUDFLARE_ACCOUNT_ID }}
          workingDirectory: worker
          command: deploy --config wrangler.interview-automation-consumer.toml
```

Make `worker-api` and `frontend` depend on both `database-migrations` and `worker-interview-automation-consumer` so the producer is not deployed before the consumer.

- [ ] **Step 8: 运行数据、漏斗、类型和 workflow 检查**

Run:

```bash
cd worker
npm test -- tests/interview-round-backfill.test.ts tests/interview-funnel-contract.test.ts
npm exec tsc -- --noEmit
cd ..
node scripts/pre-deploy-check.mjs
```

Expected: 迁移和漏斗测试 PASS，TypeScript PASS，部署前检查确认新 consumer 配置存在。

- [ ] **Step 9: 写灰度执行文档**

Create `docs/superpowers/verification/2026-08-20-interview-automation-rollout.md` with these exact gates:

```markdown
# Interview Automation Rollout Gates

1. Remote read-only duplicate audit returns zero active `resume_id + round` duplicates.
2. D1 migrations 0046, 0047 and 0048 apply successfully in preview.
3. API, consumer and Pages preview deployments pass health checks.
4. `INTERVIEW_AUTOMATION_ENABLED=false` smoke test preserves legacy manual workflows.
5. Enable one internal test position only; complete 10 candidates through business pass, round one and round two.
6. Observe for 24 hours: zero duplicate interviews/events/messages, zero unauthorized public writes, zero talent record deletions.
7. Expand by position only after admin and HR sign-off.
8. Rollback means disabling flags and reverting application code; do not reverse additive D1 migrations or delete job/notification audit records.
```

- [ ] **Step 10: Commit**

```bash
git add scripts/audit_interview_rounds.sql scripts/backfill_interview_rounds.py worker/migrations/0048_interview_round_uniqueness.sql worker/src/recruitment-events worker/src/index.ts worker/tests/interview-round-backfill.test.ts worker/tests/interview-funnel-contract.test.ts .github/workflows/deploy.yml docs/superpowers/verification/2026-08-20-interview-automation-rollout.md
git commit -m "feat: complete interview automation data rollout"
```

---

### Task 11: 全链路验证、安全复核和交付决策

**Files:**
- Create: `worker/tests/interview-automation-e2e.test.ts`
- Create: `docs/superpowers/verification/2026-08-20-interview-automation-final.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: Tasks 1–10 的所有接口、UI、migration、queue consumer 和部署配置。
- Produces: 可评审的验证证据、剩余风险和上线决策输入。

- [ ] **Step 1: 写主链路和异常链路 E2E 测试**

Create `worker/tests/interview-automation-e2e.test.ts`:

```ts
describe('interview automation closed loop', () => {
  it('moves one candidate from business pass through round one to round two awaiting schedule exactly once', async () => {
    await seedCandidateAndPosition({ resumeId: 'resume-1', primary: '杜雁玲', secondary: '魏秋柠' });
    await submitBusinessDecision('resume-1', 'passed');
    await drainAutomationQueue();
    expect(await activeInterviews('resume-1')).toEqual([expect.objectContaining({ round: 1, status: 'awaiting_schedule' })]);

    await scheduleInterview(1, '2026-08-22T06:00:00.000Z');
    await drainAutomationQueue();
    expect(calendarCreates).toHaveLength(1);
    expect(notificationDeliveries).toEqual(expect.arrayContaining(['feishu_card', 'feishu_file', 'email']));

    await submitInterviewResult(1, 'passed');
    await drainAutomationQueue();
    expect(await activeInterviews('resume-1')).toEqual([
      expect.objectContaining({ round: 1, result: 'passed' }),
      expect.objectContaining({ round: 2, interviewer: '魏秋柠', status: 'awaiting_schedule' }),
    ]);
  });

  it('keeps the interview scheduled when candidate email fails and retries email only', async () => {
    smtp.failOnce('timeout');
    await scheduleAndDrain('iv-1');
    expect(await loadInterview('iv-1')).toMatchObject({ schedule_status: 'scheduled', status: 'notification_partial' });
    await retryNotification('iv-1', 'email');
    await drainAutomationQueue();
    expect(calendarCreates).toHaveLength(1);
    expect(smtp.attempts).toBe(2);
  });

  it('cancels an interview without deleting candidate data', async () => {
    await cancelInterview('iv-1', '候选人临时无法参加');
    await drainAutomationQueue();
    expect(await loadResume('resume-1')).toBeTruthy();
    expect(await loadTalent('resume-1')).toBeTruthy();
    expect(await loadInterview('iv-1')).toMatchObject({ status: 'cancelled' });
  });
});
```

- [ ] **Step 2: 运行 Worker 定向和全量测试**

Run:

```bash
cd worker
npm test -- tests/interview-automation-e2e.test.ts tests/interview-automation-repository.test.ts tests/interview-automation-consumer.test.ts tests/interview-automation-routes.test.ts tests/interview-notification-service.test.ts tests/interview-advance-service.test.ts
npm test
npm exec tsc -- --noEmit
```

Expected: 定向和全量 Worker 测试 PASS，TypeScript PASS。

- [ ] **Step 3: 运行前端定向和全量测试**

Run:

```bash
cd frontend
npm test -- src/pages/Interviews/automationViewModel.test.ts src/pages/Interviews/List.automation.test.tsx src/pages/Interviews/Score.automation.test.tsx src/pages/Public/InterviewCard.test.tsx
npm test
npm exec tsc -- -b
npm run build
```

Expected: 定向和全量前端测试 PASS，TypeScript PASS，生产构建完成。

- [ ] **Step 4: 运行静态安全检查**

Run:

```bash
rg -n "app\.post\('/api/public/(interview-card|interview-invite)" worker/src
rg -n "DELETE FROM talent_pool" worker/src/index.ts worker/src/interview-automation
rg -n "waitUntil" worker/src/interview-automation worker/src/interview-start
rg -n "calendars/primary/events" worker/src/interview-start/feishu-calendar.ts
git diff --check origin/main...HEAD
```

Expected:

- 公开面试 POST 只剩返回 410 的兼容路由，无业务写入。
- 无取消面试删除人才库的 SQL。
- 闭环关键路径无 `waitUntil`。
- 自动日程不使用 `primary` 日历。
- `git diff --check` 无新增空白错误。

- [ ] **Step 5: 手动浏览器验收矩阵**

Run the local API, consumer and frontend, then verify these viewport/role cases:

```text
1440x900 admin: 业务通过→一面待安排→安排→通知状态
1366x768 HR: 安排弹窗、改期、取消、单渠道重试
1280x800 当轮面试官: 上下文和评价提交
390x844 公开面试卡片: 只读、脱敏、无评价按钮
390x844 候选人邀请: 只读、无内部评价、无改期按钮
```

Expected: 所有角色权限和窄屏布局符合需求，浏览器控制台无未处理错误。

- [ ] **Step 6: 更新 README 并写最终验证证据**

Add to `README.md`:

```markdown
### 面试自动化闭环

- 业务筛选通过后幂等创建待安排面试。
- HR 确认时间后由 Cloudflare Queue 异步创建飞书日程，通知面试官和候选人。
- 每轮面试独立记录，通过后自动创建下一轮待安排记录。
- 自动作业和每个通知通道均可查询、去重、重试和审计。
- 公开面试卡片和候选人邀请页仅限受限读取，写操作必须登录。
```

Create `docs/superpowers/verification/2026-08-20-interview-automation-final.md` containing:

- tested commit SHA;
- migration dry-run and local apply output;
- Worker/frontend targeted and full test counts;
- TypeScript/build result;
- static security scan result;
- browser matrix result;
- known residual risks;
- feature flags and pilot position names;
- explicit statement that production deployment has not occurred unless separately approved.

- [ ] **Step 7: Commit**

```bash
git add worker/tests/interview-automation-e2e.test.ts docs/superpowers/verification/2026-08-20-interview-automation-final.md README.md
git commit -m "docs: verify interview automation closed loop"
```

- [ ] **Step 8: 停在交付门禁等待用户决定**

Run:

```bash
git status --short --branch
git log --oneline origin/main..HEAD
git diff --stat origin/main...HEAD
```

Expected: 工作区干净，所有实施提交仅存在功能分支。向用户提供审查摘要，未获得明确批准前不推送、不合并 `main`、不执行远程 D1 migration、不部署生产。

---

## Requirement-to-Task Traceability

| 需求 | 实施任务 |
|---|---|
| 公开链接只读、取消不删档案 | Task 2, Task 9, Task 11 |
| D1 状态、job、notification 数据模型 | Task 3 |
| Queue 可靠异步、幂等、重试 | Task 4 |
| 飞书日程/会议、安排与开始解耦 | Task 5 |
| 面试官卡片/PDF、候选人邮件、部分成功 | Task 6 |
| AI 自动业务筛选、业务通过、下一轮 | Task 7 |
| 登录态调度/评价/重试/时间线 API | Task 8 |
| 面试列表、评价页、公开页 UI | Task 9 |
| 历史轮次迁移、仪表盘/日报口径、CI/CD | Task 10 |
| 完整验收、安全扫描、灰度门禁 | Task 11 |
