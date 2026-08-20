import type { CreateJobInput, CreateRoundInput, InterviewAutomationStore } from './types';

function parseJson(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export class InterviewAutomationRepository implements InterviewAutomationStore {
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

  async claimJob(jobId: string) {
    const now = this.deps.now();
    const result = await this.db.prepare(
      `UPDATE interview_automation_jobs
       SET status = 'running', attempt_count = attempt_count + 1,
           started_at = ?, updated_at = ?
       WHERE id = ? AND status IN ('queued', 'failed') AND attempt_count < max_attempts`,
    ).bind(now, now, jobId).run();
    if (!(result.meta.changes ?? 0)) return null;
    return this.db.prepare('SELECT * FROM interview_automation_jobs WHERE id = ?').bind(jobId).first<any>();
  }

  async isStaleVersion(job: any): Promise<boolean> {
    const payload = parseJson(job?.payload_json);
    const expected = Number(payload.version);
    if (!Number.isFinite(expected)) return false;
    const interviewId = typeof job?.interview_id === 'string' ? job.interview_id : '';
    if (!interviewId) return false;
    const row = await this.db.prepare('SELECT version FROM interviews WHERE id = ?').bind(interviewId).first<any>();
    return row?.version != null && Number(row.version) !== expected;
  }

  async cancelJob(jobId: string, code: string) {
    const now = this.deps.now();
    await this.db.prepare(
      `UPDATE interview_automation_jobs SET status = 'cancelled', error_code = ?, completed_at = ?, updated_at = ? WHERE id = ?`,
    ).bind(code, now, now, jobId).run();
  }

  async completeJob(jobId: string, status: 'succeeded' | 'partial', result: unknown) {
    const now = this.deps.now();
    await this.db.prepare(
      'UPDATE interview_automation_jobs SET status = ?, result_json = ?, completed_at = ?, updated_at = ? WHERE id = ?',
    ).bind(status, JSON.stringify(result ?? {}), now, now, jobId).run();
  }

  async scheduleRetry(jobId: string, code: string, message: string, delaySeconds: number) {
    const now = new Date(this.deps.now());
    const retryAt = new Date(now.getTime() + Math.max(1, delaySeconds) * 1000).toISOString();
    await this.db.prepare(
      `UPDATE interview_automation_jobs
       SET status = 'queued', next_retry_at = ?, error_code = ?, error_message = ?, updated_at = ? WHERE id = ?`,
    ).bind(retryAt, code, message, this.deps.now(), jobId).run();
  }

  async failJob(jobId: string, code: string, message: string) {
    const now = this.deps.now();
    await this.db.prepare(
      `UPDATE interview_automation_jobs SET status = 'failed', error_code = ?, error_message = ?, completed_at = ?, updated_at = ? WHERE id = ?`,
    ).bind(code, message, now, now, jobId).run();
  }

  async markInterviewManualReview(interviewId: string, code: string, message: string) {
    await this.db.prepare(
      `UPDATE interviews SET status = 'manual_review', schedule_status = 'failed', last_error_code = ?, last_error_message = ?, updated_at = ? WHERE id = ?`,
    ).bind(code, message, this.deps.now(), interviewId).run();
  }

  async createOrGetNotification(input: Record<string, unknown>) {
    const dedupeKey = String(input.dedupeKey || '');
    const existing = await this.db.prepare(
      'SELECT * FROM interview_notifications WHERE dedupe_key = ?',
    ).bind(dedupeKey).first<any>();
    if (existing) return { ...existing, created: false };
    const id = String(input.id || this.deps.uuid());
    const now = this.deps.now();
    await this.db.prepare(
      `INSERT INTO interview_notifications (
        id, interview_id, channel, recipient_type, recipient_id, template_key,
        interview_version, dedupe_key, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id, input.interviewId, input.channel, input.recipientType, input.recipientId || '',
      input.templateKey, Number(input.interviewVersion || 1), dedupeKey, now, now,
    ).run();
    return { id, ...input, status: 'queued', created: true };
  }

  async finishNotification(notificationId: string, outcome: Record<string, unknown>) {
    const status = String(outcome.status || 'sent');
    const sentAt = status === 'sent' ? (outcome.sentAt || this.deps.now()) : null;
    await this.db.prepare(
      `UPDATE interview_notifications
       SET status = ?, external_message_id = ?, last_error = ?, sent_at = ?,
           attempt_count = attempt_count + 1, updated_at = ? WHERE id = ?`,
    ).bind(status, outcome.externalMessageId || '', outcome.lastError || '', sentAt, this.deps.now(), notificationId).run();
  }

  async markScheduled(interviewId: string, calendarId: string, eventId: string, meetingUrl: string) {
    await this.db.prepare(
      `UPDATE interviews SET calendar_id = ?, calendar_event_id = ?, feishu_event_id = ?,
       meeting_url = ?, meeting_link = ?, schedule_status = 'scheduled', status = 'scheduled', updated_at = ? WHERE id = ?`,
    ).bind(calendarId, eventId, eventId, meetingUrl, meetingUrl, this.deps.now(), interviewId).run();
  }

  async markScheduleCancelled(interviewId: string) {
    await this.db.prepare(
      `UPDATE interviews SET schedule_status = 'cancelled', status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE id = ?`,
    ).bind(this.deps.now(), this.deps.now(), interviewId).run();
  }

  loadInterview(interviewId: string) {
    return this.db.prepare('SELECT * FROM interviews WHERE id = ?').bind(interviewId).first<any>();
  }

  loadPosition(positionId: string) {
    return this.db.prepare('SELECT * FROM positions WHERE id = ?').bind(positionId).first<any>();
  }

  async linkRounds(previousInterviewId: string, nextInterviewId: string) {
    const now = this.deps.now();
    await this.db.batch([
      this.db.prepare('UPDATE interviews SET next_interview_id = ?, updated_at = ? WHERE id = ?').bind(nextInterviewId, now, previousInterviewId),
      this.db.prepare('UPDATE interviews SET previous_interview_id = ?, updated_at = ? WHERE id = ?').bind(previousInterviewId, now, nextInterviewId),
    ]);
  }

  async finishCandidateAsRejected(interview: any, sourceInterviewId: string) {
    if (!interview?.resume_id) return;
    await this.db.prepare(
      `UPDATE resumes SET stage = 'rejected', status = 'rejected', updated_at = ? WHERE id = ?`,
    ).bind(this.deps.now(), interview.resume_id).run();
  }

  async markPendingOfferReview(resumeId: string, _sourceInterviewId: string) {
    await this.db.prepare(
      `UPDATE resumes SET stage = 'offer_pending', updated_at = ? WHERE id = ?`,
    ).bind(this.deps.now(), resumeId).run();
  }

  async requireInterview(interviewId: string) {
    const row = await this.loadInterview(interviewId);
    if (!row) throw new Error('INTERVIEW_NOT_FOUND');
    return row;
  }

  async prepareSchedule(interviewId: string, input: Record<string, unknown>) {
    const row = await this.requireInterview(interviewId);
    if (['cancelled', 'completed'].includes(String(row.status))) throw new Error('INTERVIEW_NOT_SCHEDULABLE');
    const version = Number(row.version || 1) + 1;
    const now = this.deps.now();
    await this.db.prepare(
      `UPDATE interviews SET scheduled_start_at = ?, scheduled_end_at = ?, interview_time = ?,
       duration_minutes = ?, timezone = ?, schedule_status = 'queued', version = ?, updated_at = ? WHERE id = ?`,
    ).bind(
      input.scheduledStartAt || null, input.scheduledEndAt || null, input.interviewTime || null,
      Number(input.durationMinutes || 60), input.timezone || 'Asia/Shanghai', version, now, interviewId,
    ).run();
    return { ...(row as any), ...input, schedule_status: 'queued', version };
  }

  async saveResultOnce(interviewId: string, input: Record<string, unknown>, actorId: string) {
    const row = await this.requireInterview(interviewId);
    const result = input.result == null ? null : String(input.result);
    if (result && ['passed', 'failed'].includes(String(row.result)) && row.result !== result) {
      throw new Error('RESULT_CONFLICT');
    }
    const now = this.deps.now();
    await this.db.prepare(
      `UPDATE interviews SET result = COALESCE(?, result), evaluation = COALESCE(?, evaluation),
       status = CASE WHEN ? = 'failed' THEN 'completed' ELSE status END, updated_at = ? WHERE id = ?`,
    ).bind(result, input.evaluation || null, result, now, interviewId).run();
    return { ...row, ...input, result, actor_id: actorId };
  }
}
