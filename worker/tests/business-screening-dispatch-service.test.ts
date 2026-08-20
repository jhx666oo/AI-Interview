import { describe, expect, it, vi } from 'vitest';
import { dispatchBusinessScreening } from '../src/business-screening/dispatch-service';

describe('dispatchBusinessScreening', () => {
  it('groups eligible resumes and sends one reusable batch per interviewer', async () => {
    const createOrReuseBatch = vi.fn(async (group: any) => ({ id: `batch-${group.interviewer.name}`, url: `https://example.test/${group.interviewer.name}` }));
    const sendBatchCard = vi.fn(async () => undefined);
    const result = await dispatchBusinessScreening({ resumeIds: ['r1', 'r1', 'r2'], createdBy: 'system', source: 'automation' }, {
      db: {} as any,
      store: { listResumesByIds: vi.fn(async () => [{ id: 'r1' }, { id: 'r2' }] as any) },
      groupEligibleResumes: vi.fn(async () => [{ interviewer: { name: '王面试官' }, resumes: [{ id: 'r1' }, { id: 'r2' }] }] as any),
      createOrReuseBatch,
      sendBatchCard,
      collectSkipped: () => [],
    });
    expect(result.batches).toEqual([{ id: 'batch-王面试官', interviewerName: '王面试官', resumeIds: ['r1', 'r2'], url: 'https://example.test/王面试官' }]);
    expect(createOrReuseBatch).toHaveBeenCalledTimes(1);
    expect(sendBatchCard).toHaveBeenCalledTimes(1);
  });
});
