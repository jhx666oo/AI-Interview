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
  jobId: string;
  resumeId: string;
  reprocess?: boolean;
}

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
