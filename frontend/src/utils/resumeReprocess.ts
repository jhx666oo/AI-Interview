export type ReprocessScope = 'all' | 'incomplete_or_failed';
export type ReprocessBatchStatus = 'queued' | 'running' | 'completed' | 'failed';
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
  status: 'queued' | 'running' | 'failed' | 'idle';
  label: string;
  error?: string;
} {
  const jobStatus = record.evaluation_job_status;
  if (jobStatus === 'queued') return { status: 'queued', label: '排队中' };
  if (jobStatus === 'running') return { status: 'running', label: getEvaluationStepLabel(record.evaluation_job_step) || '评估中' };
  if (jobStatus === 'failed') {
    const error = record.evaluation_job_error || record.parse_error || '评估失败';
    return { status: 'failed', label: '评估失败', error };
  }
  return { status: 'idle', label: '' };
}
