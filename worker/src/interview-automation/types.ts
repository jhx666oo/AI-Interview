export type InterviewAutomationAction =
  | 'auto_business_screening'
  | 'create_next_round'
  | 'schedule'
  | 'reschedule'
  | 'cancel'
  | 'notify_interviewer'
  | 'notify_candidate'
  | 'advance';

export type InterviewAutomationJobStatus = 'queued' | 'running' | 'succeeded' | 'partial' | 'failed' | 'cancelled';
export type InterviewScheduleStatus = 'not_ready' | 'queued' | 'scheduled' | 'reschedule_pending' | 'cancel_pending' | 'cancelled' | 'failed';
export type InterviewNotificationChannel = 'feishu_card' | 'feishu_file' | 'email';
export type InterviewNotificationStatus = 'queued' | 'sent' | 'failed' | 'skipped' | 'cancelled';

export interface InterviewAutomationQueueMessage {
  jobId: string;
  action: InterviewAutomationAction;
  interviewId?: string;
  resumeId?: string;
}

export interface CreateRoundInput {
  resumeId: string;
  positionId?: string;
  round: number;
  interviewer: string;
  secondaryInterviewer?: string;
  previousInterviewId?: string;
}

export interface CreateJobInput {
  idempotencyKey: string;
  action: InterviewAutomationAction;
  interviewId?: string;
  resumeId?: string;
  payload: Record<string, unknown>;
  maxAttempts?: number;
}

export interface InterviewAutomationStore {
  createOrGetRound(input: CreateRoundInput): Promise<Record<string, unknown> & { id: string; created: boolean }>;
  createOrGetJob(input: CreateJobInput): Promise<Record<string, unknown> & { id: string; created: boolean }>;
  claimJob(jobId: string): Promise<any | null>;
  isStaleVersion(job: any): Promise<boolean>;
  cancelJob(jobId: string, code: string): Promise<void>;
  completeJob(jobId: string, status: 'succeeded' | 'partial', result: unknown): Promise<void>;
  scheduleRetry(jobId: string, code: string, message: string, delaySeconds: number): Promise<void>;
  failJob(jobId: string, code: string, message: string): Promise<void>;
  markInterviewManualReview(interviewId: string, code: string, message: string): Promise<void>;
  createOrGetNotification(input: Record<string, unknown>): Promise<any>;
  finishNotification(notificationId: string, outcome: Record<string, unknown>): Promise<void>;
  markScheduled(interviewId: string, calendarId: string, eventId: string, meetingUrl: string): Promise<void>;
  markScheduleCancelled(interviewId: string): Promise<void>;
  loadInterview(interviewId: string): Promise<any | null>;
  loadPosition(positionId: string): Promise<any | null>;
  linkRounds(previousInterviewId: string, nextInterviewId: string): Promise<void>;
  finishCandidateAsRejected(interview: any, sourceInterviewId: string): Promise<void>;
  markPendingOfferReview(resumeId: string, sourceInterviewId: string): Promise<void>;
  requireInterview(interviewId: string): Promise<any>;
  prepareSchedule(interviewId: string, input: Record<string, unknown>): Promise<any>;
  saveResultOnce(interviewId: string, input: Record<string, unknown>, actorId: string): Promise<any>;
}
