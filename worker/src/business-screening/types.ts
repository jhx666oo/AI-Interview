export type BusinessScreeningStatus = 'not_ready' | 'pending' | 'passed' | 'rejected';

export type BusinessScreeningAction = 'approve' | 'reject';

export type ResumePushBatchStatus = 'active' | 'completed' | 'revoked' | 'expired';

export type ResumePushBatchItemStatus = 'pending' | 'passed' | 'rejected';

export type HrDisposition = 'pending' | 'pushed' | 'rejected';

export interface BusinessScreeningResume {
  id: string;
  screening_result?: string | null;
  status?: string | null;
  hr_disposition?: HrDisposition | string | null;
  mapped_position?: string | null;
  position_applied?: string | null;
  position_id?: string | null;
  business_screening_status?: BusinessScreeningStatus | null;
}

export interface InterviewerDirectoryEntry {
  name: string;
  openId?: string | null;
  userId?: string | null;
}

export interface PositionInterviewerConfig {
  id?: string | null;
  title: string;
  primary_interviewer?: string | null;
  secondary_interviewer?: string | null;
}

export interface PushGroup {
  interviewer: Required<Pick<InterviewerDirectoryEntry, 'name'>> & { openId: string; userId?: string | null };
  resumes: BusinessScreeningResume[];
  positionTitles: string[];
}

export interface DecisionResult {
  nextStatus: BusinessScreeningStatus;
  changed: boolean;
  terminal: boolean;
  reason?: string;
}

export interface ResumePushBatchRow {
  id: string;
  interviewer_id: string | null;
  interviewer_name: string;
  interviewer_open_id: string;
  token_hash: string;
  expires_at: string | null;
  status: ResumePushBatchStatus;
  created_by: string;
  created_at: string;
  last_sent_at: string | null;
}

export interface ResumePushBatchItemRow {
  id: string;
  batch_id: string;
  resume_id: string;
  position_id: string | null;
  status: ResumePushBatchItemStatus;
  remark: string | null;
  processed_at: string | null;
  created_at: string;
}

export interface CreateResumePushBatchInput {
  id: string;
  interviewerId?: string | null;
  interviewerName: string;
  interviewerOpenId: string;
  tokenHash: string;
  expiresAt?: string | null;
  status?: ResumePushBatchStatus;
  createdBy: string;
  createdAt?: string;
  lastSentAt?: string | null;
}

export interface CreateResumePushBatchItemInput {
  id: string;
  batchId: string;
  resumeId: string;
  positionId?: string | null;
  status?: ResumePushBatchItemStatus;
  remark?: string | null;
  processedAt?: string | null;
  createdAt?: string;
}

export interface RecordBusinessScreeningDecisionInput {
  resumeId: string;
  batchId: string;
  status: Extract<BusinessScreeningStatus, 'passed' | 'rejected'>;
  remark?: string | null;
  screenedAt?: string;
  screenedBy?: string | null;
}

export interface RecordBusinessScreeningDecisionResult {
  applied: boolean;
  idempotent: boolean;
  status: Extract<BusinessScreeningStatus, 'passed' | 'rejected'>;
  reason?: string;
}
