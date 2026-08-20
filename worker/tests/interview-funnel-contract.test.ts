import { describe, expect, it, vi } from 'vitest';
import { FunnelQuery } from '../src/recruitment-events/funnel-query';

describe('interview funnel contract', () => {
  it('counts awaiting schedule separately from scheduled interviews', async () => {
    const first = vi.fn(async () => ({
      awaiting_schedule: 1,
      scheduled: 2,
      completed: 3,
      passed: 2,
      failed: 1,
      manual_review: 0,
      notification_partial: 1,
    }));
    const db = { prepare: vi.fn(() => ({ bind: vi.fn(() => ({ first })) })) } as any;
    await expect(new FunnelQuery(db).computeInterviewStatuses()).resolves.toEqual({
      awaitingSchedule: 1,
      scheduled: 2,
      completed: 3,
      passed: 2,
      failed: 1,
      manualReview: 0,
      notificationPartial: 1,
    });
  });

  it('keeps position filtering parameterized', async () => {
    const bind = vi.fn(() => ({ first: vi.fn(async () => ({})) }));
    const db = { prepare: vi.fn(() => ({ bind })) } as any;
    await new FunnelQuery(db).computeInterviewStatuses('position-1');
    expect(bind).toHaveBeenCalledWith('position-1');
  });
});
