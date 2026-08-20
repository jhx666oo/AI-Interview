import { Hono } from 'hono';
import { enqueueInterviewAutomation } from './enqueue';
import { InterviewAutomationRepository } from './repository';
import { canEvaluateInterview, canManageInterview } from './permissions';
import type { CreateJobInput, InterviewAutomationQueueMessage } from './types';
import type { Queue } from '@cloudflare/workers-types';

type RouteEnv = {
  DB: D1Database;
  INTERVIEW_AUTOMATION_QUEUE?: Queue<InterviewAutomationQueueMessage>;
  INTERVIEW_AUTOMATION_ENABLED?: string;
};

export interface InterviewAutomationRouteDeps {
  authMiddleware: (c: any, next: any) => Promise<Response | void>;
  now: () => string;
  uuid: () => string;
  enqueue?: (env: RouteEnv, input: CreateJobInput) => Promise<{ jobId: string; created: boolean }>;
}

function repoFor(env: RouteEnv, deps: InterviewAutomationRouteDeps) {
  return new InterviewAutomationRepository(env.DB, { uuid: deps.uuid, now: deps.now });
}

function httpError(status: number, code: string, detail: string): Error & { status: number; code: string } {
  return Object.assign(new Error(detail), { status, code });
}

function parseScheduleInput(body: any, nowMs = Date.now()) {
  const startMs = Date.parse(String(body?.start_at || ''));
  const duration = Number(body?.duration_minutes ?? 60);
  const timezone = String(body?.timezone || 'Asia/Shanghai');
  const interviewType = String(body?.interview_type || 'video');
  const interviewLocation = String(body?.location || body?.interview_location || '').trim();
  if (!Number.isFinite(startMs) || startMs <= nowMs || !Number.isInteger(duration) || duration < 15 || duration > 480) {
    throw httpError(400, 'SCHEDULE_INPUT_INVALID', '面试开始时间和 15–480 分钟时长必须有效');
  }
  if (timezone !== 'Asia/Shanghai') throw httpError(400, 'TIMEZONE_UNSUPPORTED', '一期仅支持 Asia/Shanghai');
  if (!['video', 'onsite', 'phone'].includes(interviewType)) throw httpError(400, 'INTERVIEW_TYPE_INVALID', '面试方式无效');
  return {
    scheduledStartAt: new Date(startMs).toISOString(),
    scheduledEndAt: new Date(startMs + duration * 60_000).toISOString(),
    interviewTime: new Date(startMs).toISOString().replace('T', ' ').slice(0, 16),
    durationMinutes: duration,
    timezone,
    interviewType,
    interviewLocation,
  };
}

async function enqueueJob(c: any, deps: InterviewAutomationRouteDeps, input: CreateJobInput) {
  if (String(c.env.INTERVIEW_AUTOMATION_ENABLED || '').toLowerCase() !== 'true' || !c.env.INTERVIEW_AUTOMATION_QUEUE) {
    throw httpError(503, 'AUTOMATION_DISABLED', '面试自动化暂未开启');
  }
  return deps.enqueue
    ? deps.enqueue(c.env, input)
    : enqueueInterviewAutomation(repoFor(c.env, deps), c.env.INTERVIEW_AUTOMATION_QUEUE, input);
}

function assertAutomationEnabled(c: any) {
  if (String(c.env.INTERVIEW_AUTOMATION_ENABLED || '').toLowerCase() !== 'true' || !c.env.INTERVIEW_AUTOMATION_QUEUE) {
    throw httpError(503, 'AUTOMATION_DISABLED', '面试自动化暂未开启');
  }
}

export function createInterviewAutomationRoutes(deps: InterviewAutomationRouteDeps) {
  const app = new Hono<{ Bindings: RouteEnv; Variables: { user: any } }>();
  app.use('/api/interviews/:id/*', deps.authMiddleware);

  const schedule = async (c: any, action: 'schedule' | 'reschedule') => {
    try {
      const user = c.get('user') || {};
      if (!canManageInterview(user)) return c.json({ detail: '无权安排面试' }, 403);
      // 在修改 D1 前先确认异步执行能力已开启，避免留下“已排队但没有作业”的半状态。
      assertAutomationEnabled(c);
      const repo = repoFor(c.env, deps);
      const id = c.req.param('id');
      const input = parseScheduleInput(await c.req.json().catch(() => ({})));
      const interview = await repo.prepareSchedule(id, input);
      const queued = await enqueueJob(c, deps, {
        idempotencyKey: `${action}:${id}:v${interview.version}`,
        action,
        interviewId: id,
        resumeId: interview.resume_id,
        payload: { version: interview.version },
      });
      return c.json({ interview_id: id, status: action === 'schedule' ? 'schedule_queued' : 'reschedule_queued', job_id: queued.jobId }, 202);
    } catch (error: any) {
      const status = Number(error?.status || 500);
      return c.json({ detail: error?.message || '安排面试失败', code: error?.code || 'SCHEDULE_FAILED' }, status);
    }
  };

  app.post('/api/interviews/:id/schedule', (c) => schedule(c, 'schedule'));
  app.post('/api/interviews/:id/reschedule', (c) => schedule(c, 'reschedule'));

  app.post('/api/interviews/:id/cancel', async (c) => {
    try {
      const user = c.get('user') || {};
      if (!canManageInterview(user)) return c.json({ detail: '无权取消面试' }, 403);
      assertAutomationEnabled(c);
      const id = c.req.param('id');
      const repo = repoFor(c.env, deps);
      const interview = await repo.requireInterview(id);
      if (interview.status === 'cancelled') return c.json({ ok: true, interview_id: id, status: 'cancelled', already_cancelled: true });
      const body = await c.req.json().catch(() => ({}));
      const version = Number(interview.version || 1) + 1;
      const at = deps.now();
      await c.env.DB.prepare(
        `UPDATE interviews SET status = 'cancel_pending', schedule_status = 'cancel_pending',
         cancel_reason = ?, cancelled_by = ?, cancelled_at = ?, version = ?, updated_at = ? WHERE id = ?`,
      ).bind(String(body?.reason || '管理员取消'), String(user.email || user.id || 'system'), at, version, at, id).run();
      const queued = await enqueueJob(c, deps, {
        idempotencyKey: `cancel:${id}:v${version}`,
        action: 'cancel', interviewId: id, resumeId: interview.resume_id, payload: { version },
      });
      return c.json({ ok: true, interview_id: id, status: 'cancel_queued', job_id: queued.jobId }, 202);
    } catch (error: any) {
      return c.json({ detail: error?.message || '取消面试失败', code: error?.code || 'CANCEL_FAILED' }, (Number(error?.status || 500) as any));
    }
  });

  app.post('/api/interviews/:id/result', async (c) => {
    try {
      const id = c.req.param('id');
      const repo = repoFor(c.env, deps);
      const interview = await repo.requireInterview(id);
      const user = c.get('user') || {};
      if (!canEvaluateInterview(user, interview)) return c.json({ detail: '仅当轮面试官、HR 或管理员可提交评价' }, 403);
      assertAutomationEnabled(c);
      const body = await c.req.json().catch(() => ({}));
      const result = body?.result === 'failed' ? 'failed' : body?.result === 'passed' ? 'passed' : '';
      if (!result) return c.json({ detail: 'result 必须是 passed 或 failed', code: 'RESULT_INVALID' }, 400);
      const saved = await repo.saveResultOnce(id, { result, evaluation: body?.evaluation || '' }, String(user.id || user.email || 'system'));
      const queued = await enqueueJob(c, deps, {
        idempotencyKey: `advance:${id}:${result}`,
        action: 'advance', interviewId: id, resumeId: interview.resume_id, payload: { result },
      });
      return c.json({ interview: saved, advance_job_id: queued.jobId }, 202);
    } catch (error: any) {
      const conflict = String(error?.message || '') === 'RESULT_CONFLICT';
      return c.json({ detail: error?.message || '提交评价失败', code: conflict ? 'RESULT_CONFLICT' : 'RESULT_FAILED' }, conflict ? 409 : 500);
    }
  });

  app.post('/api/interviews/:id/advance', async (c) => {
    const user = c.get('user') || {};
    if (!canManageInterview(user)) return c.json({ detail: '无权推进面试' }, 403);
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const result = body?.result === 'failed' ? 'failed' : 'passed';
    const interview = await repoFor(c.env, deps).requireInterview(id);
    const queued = await enqueueJob(c, deps, { idempotencyKey: `advance:${id}:${result}`, action: 'advance', interviewId: id, resumeId: interview.resume_id, payload: { result } });
    return c.json({ interview_id: id, status: 'advance_queued', job_id: queued.jobId }, 202);
  });

  app.post('/api/interviews/:id/retry', async (c) => {
    const user = c.get('user') || {};
    if (!canManageInterview(user)) return c.json({ detail: '无权重试通知' }, 403);
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const notificationId = String(body?.notification_id || '').trim();
    if (!notificationId) return c.json({ detail: 'notification_id 必填', code: 'NOTIFICATION_REQUIRED' }, 400);
    const row = await c.env.DB.prepare('SELECT * FROM interview_notifications WHERE id = ? AND interview_id = ?').bind(notificationId, id).first<any>();
    if (!row) return c.json({ detail: '通知记录不存在' }, 404);
    if (row.status !== 'failed') return c.json({ detail: '只有失败通知可以重试', code: 'NOTIFICATION_NOT_RETRYABLE' }, 409);
    const interview = await repoFor(c.env, deps).requireInterview(id);
    const action = row.recipient_type === 'candidate' ? 'notify_candidate' : 'notify_interviewer';
    const queued = await enqueueJob(c, deps, { idempotencyKey: `retry-notification:${notificationId}:${Number(row.attempt_count || 0) + 1}`, action, interviewId: id, resumeId: interview.resume_id, payload: { notification_id: notificationId } });
    return c.json({ status: 'retry_queued', job_id: queued.jobId }, 202);
  });

  app.get('/api/interviews/:id/timeline', async (c) => {
    const id = c.req.param('id');
    const rows = await Promise.all([
      c.env.DB.prepare('SELECT id, stage, action, occurred_at, actor_user_id, source, metadata_json FROM candidate_stage_events WHERE resume_id = (SELECT resume_id FROM interviews WHERE id = ?) ORDER BY occurred_at ASC').bind(id).all(),
      c.env.DB.prepare('SELECT id, action, status, error_code, error_message, created_at, updated_at FROM interview_automation_jobs WHERE interview_id = ? ORDER BY created_at ASC').bind(id).all(),
      c.env.DB.prepare('SELECT id, channel, recipient_type, status, last_error, sent_at, created_at, updated_at FROM interview_notifications WHERE interview_id = ? ORDER BY created_at ASC').bind(id).all(),
    ]);
    const timeline = [
      ...(rows[0].results || []).map((row: any) => ({ type: 'candidate_stage', occurred_at: row.occurred_at, ...row })),
      ...(rows[1].results || []).map((row: any) => ({ type: 'automation', occurred_at: row.created_at, ...row })),
      ...(rows[2].results || []).map((row: any) => ({ type: 'notification', occurred_at: row.created_at, ...row })),
    ].sort((a: any, b: any) => String(a.occurred_at).localeCompare(String(b.occurred_at)));
    return c.json({ interview_id: id, timeline });
  });

  app.get('/api/interviews/:id/automation', async (c) => {
    const id = c.req.param('id');
    const [jobs, notifications] = await Promise.all([
      c.env.DB.prepare('SELECT id, action, status, attempt_count, max_attempts, next_retry_at, error_code, error_message, created_at, updated_at, completed_at FROM interview_automation_jobs WHERE interview_id = ? ORDER BY created_at DESC').bind(id).all(),
      c.env.DB.prepare('SELECT id, channel, recipient_type, recipient_id, template_key, status, attempt_count, last_error, sent_at, created_at, updated_at FROM interview_notifications WHERE interview_id = ? ORDER BY created_at DESC').bind(id).all(),
    ]);
    return c.json({ interview_id: id, jobs: jobs.results || [], notifications: notifications.results || [] });
  });

  return app;
}

export { parseScheduleInput };
