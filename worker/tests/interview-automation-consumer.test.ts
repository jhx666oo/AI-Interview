import { describe, expect, it, vi } from 'vitest';
import { processInterviewAutomationMessage } from '../src/interview-automation/consumer';
import { automationError } from '../src/interview-automation/orchestrator';

const message = { jobId: 'job-1', action: 'schedule' as const, interviewId: 'iv-1' };

function depsThrowing(error: Error) {
  return {
    repo: {
      claimJob: vi.fn(async () => ({ id: 'job-1', status: 'running', attempt_count: 1, max_attempts: 5, interview_id: 'iv-1' })),
      isStaleVersion: vi.fn(async () => false),
      cancelJob: vi.fn(), completeJob: vi.fn(), scheduleRetry: vi.fn(), failJob: vi.fn(), markInterviewManualReview: vi.fn(),
    },
    orchestrator: { execute: vi.fn(async () => { throw error; }) },
  };
}

describe('processInterviewAutomationMessage', () => {
  it('delays retryable failures', async () => {
    const deps = depsThrowing(automationError('FEISHU_429', 'rate limited', true));
    const result = await processInterviewAutomationMessage(message, deps as never);
    expect(result).toMatchObject({ status: 'queued', delaySeconds: 60 });
    expect(deps.repo.scheduleRetry).toHaveBeenCalledWith('job-1', 'FEISHU_429', 'rate limited', 60);
  });

  it('marks terminal failures for manual review', async () => {
    const deps = depsThrowing(automationError('CALENDAR_NOT_CONFIGURED', '未配置招聘日历', false));
    const result = await processInterviewAutomationMessage(message, deps as never);
    expect(result).toMatchObject({ status: 'failed', manualReview: true });
    expect(deps.repo.failJob).toHaveBeenCalledWith('job-1', 'CALENDAR_NOT_CONFIGURED', '未配置招聘日历');
    expect(deps.repo.markInterviewManualReview).toHaveBeenCalledWith('iv-1', 'CALENDAR_NOT_CONFIGURED', '未配置招聘日历');
  });

  it('cancels stale versions before executing the handler', async () => {
    const deps = depsThrowing(new Error('must not execute'));
    deps.repo.isStaleVersion = vi.fn(async () => true);
    const result = await processInterviewAutomationMessage(message, deps as never);
    expect(result.status).toBe('cancelled');
    expect(deps.repo.cancelJob).toHaveBeenCalledWith('job-1', 'STALE_INTERVIEW_VERSION');
    expect(deps.orchestrator.execute).not.toHaveBeenCalled();
  });
});
