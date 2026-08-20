import { automationError } from './orchestrator';

export interface AdvanceDeps {
  repo: {
    loadInterview(interviewId: string): Promise<any | null>;
    loadPosition(positionId: string): Promise<any | null>;
    createOrGetRound(input: { resumeId: string; positionId?: string; round: number; interviewer: string; secondaryInterviewer?: string; previousInterviewId?: string }): Promise<any>;
    linkRounds(previousInterviewId: string, nextInterviewId: string): Promise<void>;
    finishCandidateAsRejected(interview: any, sourceInterviewId: string): Promise<void>;
    markPendingOfferReview(resumeId: string, sourceInterviewId: string): Promise<void>;
    markInterviewManualReview(interviewId: string, code: string, message: string): Promise<void>;
    markCandidateInterviewing?: (resumeId: string) => Promise<void>;
  };
}

export async function createInitialInterviewFromBusinessPass(
  resumeId: string,
  positionId: string | undefined,
  deps: AdvanceDeps,
): Promise<{ status: 'awaiting_schedule' | 'manual_review'; interview: any }> {
  if (!positionId) throw automationError('POSITION_REQUIRED', '业务筛选通过后缺少岗位信息', false);
  const position = await deps.repo.loadPosition(positionId);
  if (!position) throw automationError('POSITION_NOT_FOUND', '业务筛选通过后找不到岗位', false);
  const interviewer = String(position.primary_interviewer || '').trim();
  const interview = await deps.repo.createOrGetRound({
    resumeId,
    positionId,
    round: 1,
    interviewer,
    secondaryInterviewer: String(position.secondary_interviewer || '').trim(),
  });
  if (!interviewer) {
    await deps.repo.markInterviewManualReview(interview.id, 'FIRST_INTERVIEWER_MISSING', '岗位未配置一面面试官');
    return { status: 'manual_review', interview };
  }
  await deps.repo.markCandidateInterviewing?.(resumeId);
  return { status: 'awaiting_schedule', interview };
}

export async function advanceInterview(
  interviewId: string,
  result: 'passed' | 'failed',
  deps: AdvanceDeps,
): Promise<{ status: 'rejected' | 'awaiting_schedule' | 'manual_review' | 'pending_offer_review'; next?: any }> {
  const current = await deps.repo.loadInterview(interviewId);
  if (!current) throw automationError('INTERVIEW_NOT_FOUND', '面试不存在', false);
  if (result === 'failed') {
    await deps.repo.finishCandidateAsRejected(current, interviewId);
    return { status: 'rejected' };
  }
  if (Number(current.round || 1) >= 2) {
    await deps.repo.markPendingOfferReview(String(current.resume_id || ''), interviewId);
    return { status: 'pending_offer_review' };
  }

  const position = current.position_id ? await deps.repo.loadPosition(current.position_id) : null;
  const interviewer = String(position?.secondary_interviewer || '').trim();
  const next = await deps.repo.createOrGetRound({
    resumeId: String(current.resume_id || ''),
    positionId: current.position_id || undefined,
    round: Number(current.round || 1) + 1,
    interviewer,
    secondaryInterviewer: '',
    previousInterviewId: current.id,
  });
  await deps.repo.linkRounds(current.id, next.id);
  if (!interviewer) {
    await deps.repo.markInterviewManualReview(next.id, 'NEXT_INTERVIEWER_MISSING', '岗位未配置二面面试官');
    return { status: 'manual_review', next };
  }
  await deps.repo.markCandidateInterviewing?.(String(current.resume_id || ''));
  return { status: 'awaiting_schedule', next };
}
