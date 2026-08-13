export type ReprocessScope = 'all' | 'incomplete_or_failed';
export type ReprocessBatchStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type ReprocessBatchItemStatus = 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'skipped';

export interface ReprocessBatchCurrentTask {
  resume_id: string;
  candidate_name: string;
  step: string;
}

export interface ReprocessBatchFailedItem {
  resume_id: string;
  candidate_name: string;
  error_code: string | null;
  error_message: string | null;
}

export interface ReprocessBatchView {
  batch_id: string;
  scope: ReprocessScope;
  status: ReprocessBatchStatus;
  total: number;
  completed: number;
  processing: number;
  queued: number;
  pending: number;
  failed: number;
  skipped: number;
  percent: number;
  current: ReprocessBatchCurrentTask | null;
  failed_items: ReprocessBatchFailedItem[];
  error_message: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface ResumeEvaluationJobProjection {
  evaluation_job_status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | null;
  evaluation_job_step: string | null;
  evaluation_job_error: string | null;
  evaluation_batch_id: string | null;
}

export function getReprocessPercent(batch: ReprocessBatchView): number {
  if (batch.total === 0) return 100;
  const finished = batch.completed + batch.failed + batch.skipped;
  return Math.round((finished / batch.total) * 100);
}

export function isReprocessBatchActive(batch: ReprocessBatchView | null): boolean {
  if (!batch) return false;
  return batch.status === 'queued' || batch.status === 'running';
}

const STEP_LABELS: Record<string, string> = {
  extracting_text: '文本提取中',
  extracting_fields: '字段提取中',
  screening: 'AI 评分中',
  syncing_feishu: '同步飞书中',
};

export function getEvaluationStepLabel(step: string | null): string {
  if (!step) return '';
  return STEP_LABELS[step] || step;
}

export function getEvaluationCardState(record: any): {
  status: 'queued' | 'running' | 'failed' | 'cancelled' | 'idle';
  label: string;
  error?: string;
} {
  const jobStatus = record.evaluation_job_status;
  if (jobStatus === 'queued') return { status: 'queued', label: '排队中' };
  if (jobStatus === 'running') return { status: 'running', label: getEvaluationStepLabel(record.evaluation_job_step) || '评估中' };
  if (jobStatus === 'cancelled') return { status: 'cancelled', label: '已停止' };
  if (jobStatus === 'failed') {
    const errorCode = record.evaluation_job_error?.split(':')[0] || '';
    if (errorCode === 'OCR_PAGE_LIMIT_EXCEEDED') {
      return { status: 'failed', label: 'PDF 超过 MinerU 20 页限制', error: 'PDF 页数超过 MinerU 限制，请拆分 PDF 或提供文本版简历后重新评估' };
    }
    if (errorCode === 'AI_SCREENING_INVALID_SUMMARY' || errorCode === 'AI_SCREENING_INVALID_DIMENSIONS' || errorCode === 'AI_SCREENING_INVALID_JSON') {
      const detail = record.evaluation_job_error?.split(':').slice(1).join(':').trim() || '';
      return { status: 'failed', label: '评估失败', error: detail ? `AI 返回格式异常（${detail}）` : 'AI 返回格式异常，已自动修复仍失败' };
    }
    const error = record.evaluation_job_error?.split(':').slice(1).join(':').trim() || record.parse_error || '评估失败';
    return { status: 'failed', label: '评估失败', error };
  }
  return { status: 'idle', label: '' };
}

/**
 * True when a completed screening is a hard-gate rejection (关键词匹配/避坑雷区
 * 未达到 5 分使加权分为空)，而不是一次 AI 请求失败。这类记录不应显示为系统错误。
 */
export function isHardGateRejection(record: any): boolean {
  const active = record.evaluation_job_status === 'queued' || record.evaluation_job_status === 'running' || record.evaluation_job_status === 'failed' || record.evaluation_job_status === 'cancelled';
  if (active) return false;
  return record.screening_result === '不通过' && record.match_score === null;
}
