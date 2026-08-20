import { describe, expect, it } from 'vitest';
import { InterviewAutomationRepository } from '../src/interview-automation/repository';

type Row = Record<string, any>;

class FakeD1 {
  jobs: Row[] = [];
  interviews: Row[] = [];
  notifications: Row[] = [];
  sql: string[] = [];

  prepare(sql: string) {
    this.sql.push(sql);
    const self = this;
    const statement = (params: any[] = []) => ({
      bind: (...args: any[]) => statement(args),
      first: async () => self.first(sql, params),
      run: async () => self.run(sql, params),
    });
    return statement();
  }

  async batch(statements: any[]) {
    for (const statement of statements) await statement.run();
    return { success: true };
  }

  private async first(sql: string, params: any[]) {
    if (sql.includes('interview_automation_jobs WHERE idempotency_key')) {
      return this.jobs.find((row) => row.idempotency_key === params[0]) || null;
    }
    if (sql.includes('interview_automation_jobs WHERE id =')) {
      return this.jobs.find((row) => row.id === params[0]) || null;
    }
    if (sql.includes('interviews') && sql.includes('resume_id = ?') && sql.includes('round = ?')) {
      return this.interviews.find((row) => row.resume_id === params[0] && row.round === params[1] && row.status !== 'cancelled') || null;
    }
    if (sql.includes('SELECT version FROM interviews')) {
      const row = this.interviews.find((item) => item.id === params[0]);
      return row ? { version: row.version } : null;
    }
    if (sql.includes('SELECT * FROM interviews WHERE id =')) {
      return this.interviews.find((row) => row.id === params[0]) || null;
    }
    if (sql.includes('interview_notifications WHERE dedupe_key')) {
      return this.notifications.find((row) => row.dedupe_key === params[0]) || null;
    }
    return null;
  }

  private async run(sql: string, params: any[]) {
    if (sql.includes('INSERT INTO interview_automation_jobs')) {
      const [id, idempotencyKey, resumeId, interviewId, action, maxAttempts, payloadJson, createdAt, updatedAt] = params;
      this.jobs.push({ id, idempotency_key: idempotencyKey, resume_id: resumeId, interview_id: interviewId, action, status: 'queued', attempt_count: 0, max_attempts: maxAttempts, payload_json: payloadJson, created_at: createdAt, updated_at: updatedAt });
      return { meta: { changes: 1 } };
    }
    if (sql.includes("SET status = 'running'")) {
      const row = this.jobs.find((item) => item.id === params[2]);
      if (!row || !['queued', 'failed'].includes(row.status) || row.attempt_count >= row.max_attempts) return { meta: { changes: 0 } };
      row.status = 'running'; row.attempt_count += 1; row.started_at = params[0]; row.updated_at = params[1];
      return { meta: { changes: 1 } };
    }
    if (sql.includes('UPDATE interview_automation_jobs SET status = ?')) {
      const row = this.jobs.find((item) => item.id === params[4]);
      if (row) { row.status = params[0]; row.result_json = params[1]; row.completed_at = params[2]; row.updated_at = params[3]; }
      return { meta: { changes: row ? 1 : 0 } };
    }
    if (sql.includes('INSERT INTO interview_notifications')) {
      const [id, interviewId, channel, recipientType, recipientId, templateKey, interviewVersion, dedupeKey, createdAt, updatedAt] = params;
      this.notifications.push({ id, interview_id: interviewId, channel, recipient_type: recipientType, recipient_id: recipientId, template_key: templateKey, interview_version: interviewVersion, dedupe_key: dedupeKey, status: 'queued', created_at: createdAt, updated_at: updatedAt });
      return { meta: { changes: 1 } };
    }
    if (sql.includes('UPDATE interviews SET scheduled_start_at')) {
      const row = this.interviews.find((item) => item.id === params[7]);
      if (row) { row.scheduled_start_at = params[0]; row.scheduled_end_at = params[1]; row.interview_time = params[2]; row.duration_minutes = params[3]; row.timezone = params[4]; row.schedule_status = 'queued'; row.version = params[5]; row.updated_at = params[6]; }
      return { meta: { changes: row ? 1 : 0 } };
    }
    if (sql.includes('UPDATE interviews SET result = COALESCE')) {
      const row = this.interviews.find((item) => item.id === params[4]);
      if (row) { if (params[0]) row.result = params[0]; if (params[1]) row.evaluation = params[1]; row.updated_at = params[3]; }
      return { meta: { changes: row ? 1 : 0 } };
    }
    return { meta: { changes: 1 } };
  }
}

function repo(db: FakeD1) {
  return new InterviewAutomationRepository(db as unknown as D1Database, {
    uuid: () => 'job-1',
    now: () => '2026-08-20T08:00:00.000Z',
  });
}

describe('InterviewAutomationRepository', () => {
  it('creates a job once for the same idempotency key', async () => {
    const db = new FakeD1();
    const r = repo(db);
    const first = await r.createOrGetJob({ idempotencyKey: 'schedule:iv-1:v1', action: 'schedule', interviewId: 'iv-1', payload: { version: 1 } });
    const second = await r.createOrGetJob({ idempotencyKey: 'schedule:iv-1:v1', action: 'schedule', interviewId: 'iv-1', payload: { version: 1 } });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.id).toBe(first.id);
    expect(db.jobs).toHaveLength(1);
  });

  it('claims a queued job once and completes it', async () => {
    const db = new FakeD1();
    const r = repo(db);
    await r.createOrGetJob({ idempotencyKey: 'schedule:iv-1:v1', action: 'schedule', interviewId: 'iv-1', payload: {} });
    const claimed = await r.claimJob('job-1');
    expect(claimed?.status).toBe('running');
    expect(claimed?.attempt_count).toBe(1);
    expect(await r.claimJob('job-1')).toBeNull();
    await r.completeJob('job-1', 'succeeded', { ok: true });
    expect(db.jobs[0].status).toBe('succeeded');
  });

  it('increments interview version when preparing a schedule', async () => {
    const db = new FakeD1();
    db.interviews.push({ id: 'iv-1', resume_id: 'resume-1', version: 2, status: 'awaiting_schedule' });
    const row = await repo(db).prepareSchedule('iv-1', { scheduledStartAt: '2026-08-21T02:00:00.000Z', scheduledEndAt: '2026-08-21T03:00:00.000Z', interviewTime: '2026-08-21 10:00' });
    expect(row.version).toBe(3);
    expect(db.interviews[0].schedule_status).toBe('queued');
    expect(db.interviews[0].version).toBe(3);
  });

  it('rejects a conflicting terminal result', async () => {
    const db = new FakeD1();
    db.interviews.push({ id: 'iv-1', result: 'passed', status: 'completed', version: 1 });
    await expect(repo(db).saveResultOnce('iv-1', { result: 'failed' }, 'user-1')).rejects.toThrow('RESULT_CONFLICT');
  });
});
