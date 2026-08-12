export type BusinessScreeningResumeStatus = 'pending' | 'passed' | 'rejected';

export interface BusinessScreeningResume {
  id: string;
  candidateName: string;
  position: string;
  education?: string;
  workExperience?: string;
  status: BusinessScreeningResumeStatus;
  remark?: string;
  processedAt?: string;
}

export interface BusinessScreeningBatch {
  id: string;
  interviewer: string;
  status: string;
  expiresAt?: string;
  lastSentAt?: string;
}

export interface BusinessScreeningView {
  batch: BusinessScreeningBatch;
  resumes: BusinessScreeningResume[];
}

export type BusinessScreeningLoadState = 'expired' | 'error';

export function pickActiveBusinessScreeningResumeId(
  resumes: BusinessScreeningResume[],
  currentId?: string | null,
): string | null {
  if (currentId && resumes.some((resume) => resume.id === currentId)) return currentId;
  return resumes[0]?.id || null;
}

export function classifyBusinessScreeningLoadError(error: any): BusinessScreeningLoadState {
  return error?.response?.status === 410 ? 'expired' : 'error';
}

export function buildBusinessScreeningDecisionPayload(remark?: string | null): Record<string, string> {
  const trimmed = typeof remark === 'string' ? remark.trim() : '';
  return trimmed ? { remark: trimmed } : {};
}

export function applyBusinessScreeningDecision(
  resumes: BusinessScreeningResume[],
  input: {
    resumeId: string;
    action: 'approve' | 'reject';
    remark?: string;
    processedAt: string;
  },
): BusinessScreeningResume[] {
  return resumes.map((resume) => {
    if (resume.id !== input.resumeId) return resume;
    return {
      ...resume,
      status: input.action === 'approve' ? 'passed' : 'rejected',
      remark: input.remark || undefined,
      processedAt: input.processedAt,
    };
  });
}
