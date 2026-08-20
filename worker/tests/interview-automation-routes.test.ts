import { describe, expect, it, vi } from 'vitest';
import { createInterviewAutomationRoutes } from '../src/interview-automation/routes';

class FakeD1 {
  interviews: any[] = [{ id: 'iv-1', resume_id: 'r-1', status: 'awaiting_schedule', version: 1, interviewer: '王面试官', primary_interviewer: '王面试官', secondary_interviewer: '李面试官' }];
  jobs: any[] = [];
  notifications: any[] = [];
  prepare(sql: string) {
    const self = this;
    const make = (params: any[] = []) => ({
      bind: (...args: any[]) => make(args),
      first: async () => {
        if (sql.includes('SELECT * FROM interviews WHERE id')) return self.interviews.find((row) => row.id === params[0]) || null;
        if (sql.includes('interview_automation_jobs WHERE idempotency_key')) return self.jobs.find((row) => row.idempotency_key === params[0]) || null;
        if (sql.includes('interview_notifications WHERE id =')) return self.notifications.find((row) => row.id === params[0]) || null;
        return null;
      },
      all: async () => ({ results: [] }),
      run: async () => {
        if (sql.includes('UPDATE interviews SET scheduled_start_at')) {
          const row = self.interviews.find((item) => item.id === params[9]);
          if (row) Object.assign(row, { scheduled_start_at: params[0], scheduled_end_at: params[1], interview_time: params[2], duration_minutes: params[3], timezone: params[4], interview_type: params[5], interview_location: params[6], schedule_status: 'queued', version: params[7] });
        }
        if (sql.includes('INSERT INTO interview_automation_jobs')) {
          self.jobs.push({ id: `job-${self.jobs.length + 1}`, idempotency_key: params[0], status: 'queued' });
        }
        return { meta: { changes: 1 } };
      },
    });
    return make();
  }
}

function harness() {
  const db = new FakeD1();
  const queue = { send: vi.fn(async () => undefined) };
  const app = createInterviewAutomationRoutes({
    authMiddleware: async (c, next) => { c.set('user', { id: 'u-1', email: 'hr@example.com', role: 'hr', full_name: 'HR' }); await next(); },
    now: () => '2026-08-20T08:00:00.000Z',
    uuid: () => `job-${db.jobs.length + 1}`,
  });
  return { app, env: { DB: db, INTERVIEW_AUTOMATION_ENABLED: 'true', INTERVIEW_AUTOMATION_QUEUE: queue }, db, queue };
}

describe('authenticated interview automation routes', () => {
  it('validates schedule input and creates one queued job', async () => {
    const h = harness();
    const invalid = await h.app.request('/api/interviews/iv-1/schedule', { method: 'POST', body: JSON.stringify({ start_at: '' }), headers: { 'content-type': 'application/json' } }, h.env as any);
    expect(invalid.status).toBe(400);
    const valid = await h.app.request('/api/interviews/iv-1/schedule', { method: 'POST', body: JSON.stringify({ start_at: '2099-08-22T06:00:00.000Z', duration_minutes: 60 }), headers: { 'content-type': 'application/json' } }, h.env as any);
    expect(valid.status).toBe(202);
    expect((await valid.json()).status).toBe('schedule_queued');
    expect(h.queue.send).toHaveBeenCalledTimes(1);
  });

  it('only allows assigned interviewer or HR to submit a result', async () => {
    const db = new FakeD1();
    const app = createInterviewAutomationRoutes({
      authMiddleware: async (c, next) => { c.set('user', { id: 'u-2', role: 'interviewer', full_name: '陌生人' }); await next(); },
      now: () => '2026-08-20T08:00:00.000Z', uuid: () => 'job-1',
    });
    const response = await app.request('/api/interviews/iv-1/result', { method: 'POST', body: JSON.stringify({ result: 'passed' }), headers: { 'content-type': 'application/json' } }, { DB: db, INTERVIEW_AUTOMATION_ENABLED: 'true', INTERVIEW_AUTOMATION_QUEUE: { send: vi.fn() } } as any);
    expect(response.status).toBe(403);
  });

  it('does not mutate a schedule when automation is disabled', async () => {
    const h = harness();
    const response = await h.app.request('/api/interviews/iv-1/schedule', {
      method: 'POST',
      body: JSON.stringify({ start_at: '2099-08-22T06:00:00.000Z', duration_minutes: 60 }),
      headers: { 'content-type': 'application/json' },
    }, { ...h.env, INTERVIEW_AUTOMATION_ENABLED: 'false' } as any);
    expect(response.status).toBe(503);
    expect(h.db.interviews[0].schedule_status).toBeUndefined();
    expect(h.db.interviews[0].version).toBe(1);
    expect(h.queue.send).not.toHaveBeenCalled();
  });
});
