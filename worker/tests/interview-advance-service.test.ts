import { describe, expect, it, vi } from 'vitest';
import { advanceInterview } from '../src/interview-automation/advance-service';

function makeRepo(overrides: any = {}) {
  return {
    loadInterview: vi.fn(async () => ({ id: 'iv-1', resume_id: 'resume-1', position_id: 'pos-1', round: 1 })),
    loadPosition: vi.fn(async () => ({ id: 'pos-1', secondary_interviewer: '魏秋柠' })),
    createOrGetRound: vi.fn(async (input: any) => ({ id: 'iv-2', ...input, round: 2 })),
    linkRounds: vi.fn(async () => undefined),
    finishCandidateAsRejected: vi.fn(async () => undefined),
    markPendingOfferReview: vi.fn(async () => undefined),
    markInterviewManualReview: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('advanceInterview', () => {
  it('creates and links one second-round interview after a pass', async () => {
    const repo = makeRepo();
    const result = await advanceInterview('iv-1', 'passed', { repo });
    expect(result.status).toBe('awaiting_schedule');
    expect(result.next).toMatchObject({ id: 'iv-2', round: 2, interviewer: '魏秋柠', previousInterviewId: 'iv-1' });
    expect(repo.linkRounds).toHaveBeenCalledWith('iv-1', 'iv-2');
  });

  it('marks the next round for manual review when no interviewer is configured', async () => {
    const repo = makeRepo({ loadPosition: vi.fn(async () => ({ id: 'pos-1', secondary_interviewer: '' })) });
    const result = await advanceInterview('iv-1', 'passed', { repo });
    expect(result.status).toBe('manual_review');
    expect(repo.markInterviewManualReview).toHaveBeenCalledWith('iv-2', 'NEXT_INTERVIEWER_MISSING', '岗位未配置二面面试官');
  });

  it('rejects the candidate on a failed result and sends no next-round request', async () => {
    const repo = makeRepo();
    const result = await advanceInterview('iv-1', 'failed', { repo });
    expect(result.status).toBe('rejected');
    expect(repo.finishCandidateAsRejected).toHaveBeenCalledWith(expect.objectContaining({ id: 'iv-1' }), 'iv-1');
    expect(repo.createOrGetRound).not.toHaveBeenCalled();
  });

  it('marks offer review after a second-round pass', async () => {
    const repo = makeRepo({ loadInterview: vi.fn(async () => ({ id: 'iv-2', resume_id: 'resume-1', position_id: 'pos-1', round: 2 })) });
    const result = await advanceInterview('iv-2', 'passed', { repo });
    expect(result.status).toBe('pending_offer_review');
    expect(repo.markPendingOfferReview).toHaveBeenCalledWith('resume-1', 'iv-2');
  });
});
