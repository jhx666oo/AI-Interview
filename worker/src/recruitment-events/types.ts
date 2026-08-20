export type CandidateStage =
  | 'resume_received'
  | 'ai_screened'
  | 'hr_approved'
  | 'hr_rejected'
  | 'interview_scheduled'
  | 'interview_completed'
  | 'interview_passed'
  | 'interview_failed'
  | 'offer_sent'
  | 'offer_accepted'
  | 'offer_rejected'
  | 'hired'
  | 'candidate_withdrawn';

export type MetricMode = 'event_time' | 'cohort';

export interface StageEvent {
  id: string;
  resumeId: string;
  positionId?: string;
  stage: CandidateStage;
  action: string;
  occurredAt: string;
  actorUserId?: string;
  source: string;
  dedupeKey: string;
  metadata: Record<string, unknown>;
}

export interface FunnelMetricsQuery {
  from?: string;
  to?: string;
  mode: MetricMode;
  positionId?: string;
  departmentId?: string;
  hrbpUserId?: string;
}

export interface FunnelStageMetrics {
  stage: CandidateStage;
  count: number;
  previousStageCount?: number;
  conversionRate?: number;
}

export interface FunnelMetrics {
  stages: FunnelStageMetrics[];
  mode: MetricMode;
  from?: string;
  to?: string;
  computedAt: string;
}

/** 面试自动化状态不直接等同于漏斗事件，单独返回避免把待安排误计为已面试。 */
export interface InterviewStatusMetrics {
  awaitingSchedule: number;
  scheduled: number;
  completed: number;
  passed: number;
  failed: number;
  manualReview: number;
  notificationPartial: number;
}
