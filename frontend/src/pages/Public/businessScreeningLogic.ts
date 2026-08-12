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

function getBackendDetail(error: any): string {
  return typeof error?.response?.data?.detail === 'string'
    ? error.response.data.detail.trim()
    : '';
}

export function buildBusinessScreeningDecisionPayload(remark?: string | null): Record<string, string> {
  const trimmed = typeof remark === 'string' ? remark.trim() : '';
  return trimmed ? { remark: trimmed } : {};
}

export function mapBusinessScreeningDecisionError(error: any): string {
  const detail = getBackendDetail(error);
  if (detail === 'business screening already completed') {
    return '该候选人已被其他人完成业务筛选，请刷新页面查看最新结果。';
  }
  if (detail === 'business screening dispatch group changed' || detail === 'Link unavailable') {
    return '当前链接已失效，HR 可能已重新发送，请联系 HR 获取最新链接。';
  }
  if (detail === 'HR already rejected resume') {
    return '该候选人已被 HR 淘汰，无法继续处理。';
  }
  return detail || '提交失败，请稍后重试';
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
