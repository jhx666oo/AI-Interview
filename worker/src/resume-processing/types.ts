export const ACTIVE_JOB_STATUSES = ['queued', 'running'] as const;

export type ResumeJobStatus =
  | (typeof ACTIVE_JOB_STATUSES)[number]
  | 'completed'
  | 'failed'
  | 'cancelled';

export type ResumeJobStep =
  | 'extracting_text'
  | 'extracting_fields'
  | 'screening'
  | 'syncing_feishu';

export interface ResumeQueueMessage {
  kind?: 'resume_reprocess';
  jobId: string;
  resumeId: string;
  reprocess?: boolean;
  batchId?: string;
}

export interface HistoricalReprocessQueueMessage {
  kind: 'historical_reprocess';
  batchId: string;
}

export type ResumeProcessingQueueMessage = ResumeQueueMessage | HistoricalReprocessQueueMessage;

export interface ResumeProcessingJob {
  id: string;
  resume_id: string;
  status: ResumeJobStatus;
  step: ResumeJobStep;
  attempt_count: number;
  error_code: string | null;
  error_message: string | null;
  version: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
}

export function isTerminalJobStatus(status: ResumeJobStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

export type ReprocessScope = 'all' | 'incomplete_or_failed';

export type ReprocessBatchStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export type ReprocessBatchItemStatus = 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'skipped';

export interface ReprocessBatchItemRow {
  id: string;
  batch_id: string;
  resume_id: string;
  job_id: string | null;
  status: ReprocessBatchItemStatus;
  step: string | null;
  candidate_name: string | null;
  skip_reason: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

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
  evaluation_job_status: ResumeJobStatus | null;
  evaluation_job_step: ResumeJobStep | null;
  evaluation_job_error: string | null;
  evaluation_batch_id: string | null;
}

export function hasValidAiEvaluation(value: unknown): boolean {
  if (value == null) return false;
  if (Array.isArray(value)) return false;
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const dimensions = obj.dimensions;
    if (Array.isArray(dimensions) && dimensions.length > 0) return true;
    const summary = obj.summary;
    if (typeof summary === 'string' && summary.trim().length > 0) return true;
    const screeningReason = obj.screening_reason;
    if (typeof screeningReason === 'string' && screeningReason.trim().length > 0) return true;
    const weightedScore = obj.weighted_score;
    if (typeof weightedScore === 'number' && Number.isFinite(weightedScore)) return true;
    return false;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return hasValidAiEvaluation(parsed);
    } catch {
      return false;
    }
  }
  return false;
}
