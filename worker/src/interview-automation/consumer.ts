import type { InterviewAutomationRepository } from './repository';
import type { InterviewAutomationQueueMessage } from './types';
import { classifyAutomationError, type InterviewAutomationOrchestrator } from './orchestrator';

const RETRY_DELAYS_SECONDS = [60, 300, 900, 3600, 14400] as const;

export interface ConsumerDeps {
  repo: Pick<InterviewAutomationRepository, 'claimJob' | 'isStaleVersion' | 'cancelJob' | 'completeJob' | 'scheduleRetry' | 'failJob' | 'markInterviewManualReview'>;
  orchestrator: Pick<InterviewAutomationOrchestrator, 'execute'>;
  classifyError?: typeof classifyAutomationError;
}

export async function processInterviewAutomationMessage(
  message: InterviewAutomationQueueMessage,
  deps: ConsumerDeps,
): Promise<{ status: 'succeeded' | 'partial' | 'queued' | 'failed' | 'cancelled'; delaySeconds?: number; manualReview?: boolean }> {
  const job = await deps.repo.claimJob(message.jobId);
  if (!job || ['succeeded', 'cancelled'].includes(job.status)) return { status: 'cancelled' };
  if (await deps.repo.isStaleVersion(job)) {
    await deps.repo.cancelJob(job.id, 'STALE_INTERVIEW_VERSION');
    return { status: 'cancelled' };
  }

  try {
    const result = await deps.orchestrator.execute(job);
    await deps.repo.completeJob(job.id, result.status, result);
    return { status: result.status };
  } catch (error) {
    const failure = (deps.classifyError || classifyAutomationError)(error);
    const attempt = Number(job.attempt_count || 1);
    if (failure.retryable && attempt < Number(job.max_attempts || 5)) {
      const delaySeconds = RETRY_DELAYS_SECONDS[Math.min(attempt - 1, RETRY_DELAYS_SECONDS.length - 1)];
      await deps.repo.scheduleRetry(job.id, failure.code, failure.message, delaySeconds);
      return { status: 'queued', delaySeconds };
    }
    await deps.repo.failJob(job.id, failure.code, failure.message);
    if (job.interview_id) await deps.repo.markInterviewManualReview(job.interview_id, failure.code, failure.message);
    return { status: 'failed', manualReview: true };
  }
}
