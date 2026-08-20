import { describe, expect, it, vi } from 'vitest';
import { enqueueInterviewAutomation } from '../src/interview-automation/enqueue';

describe('enqueueInterviewAutomation', () => {
  it('persists the job before publishing and reuses the same job', async () => {
    const order: string[] = [];
    const repo = {
      createOrGetJob: vi.fn(async () => { order.push('db'); return { id: 'job-1', created: true, status: 'queued' }; }),
    };
    const queue = { send: vi.fn(async () => { order.push('queue'); }) };
    const first = await enqueueInterviewAutomation(repo as never, queue as never, {
      idempotencyKey: 'schedule:iv-1:v1', action: 'schedule', interviewId: 'iv-1', payload: { version: 1 },
    });
    expect(first).toEqual({ jobId: 'job-1', created: true });
    expect(order).toEqual(['db', 'queue']);
  });

  it('does not publish a duplicate idempotent job', async () => {
    const repo = { createOrGetJob: vi.fn(async () => ({ id: 'job-1', created: false, status: 'queued' })) };
    const queue = { send: vi.fn() };
    const result = await enqueueInterviewAutomation(repo as never, queue as never, {
      idempotencyKey: 'schedule:iv-1:v1', action: 'schedule', interviewId: 'iv-1', payload: {},
    });
    expect(result.created).toBe(false);
    expect(queue.send).not.toHaveBeenCalled();
  });
});
