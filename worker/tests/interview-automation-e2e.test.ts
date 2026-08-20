import { describe, expect, it } from 'vitest';
import { advanceInterview, createInitialInterviewFromBusinessPass } from '../src/interview-automation/advance-service';

function createFlowRepo() {
  const interviews = new Map<string, any>();
  let sequence = 0;
  return {
    interviews,
    loadPosition: async () => ({ primary_interviewer: '杜雁玲', secondary_interviewer: '魏秋柠' }),
    loadInterview: async (id: string) => interviews.get(id) || null,
    createOrGetRound: async (input: any) => {
      const existing = [...interviews.values()].find((row) => row.resume_id === input.resumeId && row.round === input.round && row.status !== 'cancelled');
      if (existing) return existing;
      const row = {
        id: `iv-${++sequence}`,
        ...input,
        resume_id: input.resumeId,
        position_id: input.positionId,
        status: 'awaiting_schedule',
        result: 'pending',
      };
      interviews.set(row.id, row);
      return row;
    },
    linkRounds: async (previous: string, next: string) => {
      interviews.get(previous).next_interview_id = next;
      interviews.get(next).previous_interview_id = previous;
    },
    finishCandidateAsRejected: async () => undefined,
    markPendingOfferReview: async () => undefined,
    markInterviewManualReview: async () => undefined,
    markCandidateInterviewing: async () => undefined,
  };
}

describe('interview automation closed loop', () => {
  it('creates one awaiting-schedule round one and round two exactly once', async () => {
    const repo = createFlowRepo();
    const first = await createInitialInterviewFromBusinessPass('resume-1', 'position-1', { repo });
    expect(first).toMatchObject({ status: 'awaiting_schedule', interview: { round: 1, interviewer: '杜雁玲' } });

    const second = await advanceInterview(first.interview.id, 'passed', { repo });
    expect(second).toMatchObject({ status: 'awaiting_schedule', next: { round: 2, interviewer: '魏秋柠', previous_interview_id: first.interview.id } });
    const retry = await advanceInterview(first.interview.id, 'passed', { repo });
    expect(retry.next.id).toBe(second.next?.id);
    expect(repo.interviews.size).toBe(2);
  });

  it('keeps a failed interview as a terminal candidate decision', async () => {
    const repo = createFlowRepo();
    const first = await createInitialInterviewFromBusinessPass('resume-1', 'position-1', { repo });
    await expect(advanceInterview(first.interview.id, 'failed', { repo })).resolves.toEqual({ status: 'rejected' });
  });
});
