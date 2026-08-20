import type { Queue } from '@cloudflare/workers-types';
import type { InterviewAutomationRepository } from './repository';
import type { CreateJobInput, InterviewAutomationQueueMessage } from './types';

/** 先把作业写入 D1，再发送 Queue 消息；重复幂等键不会重复投递。 */
export async function enqueueInterviewAutomation(
  repo: InterviewAutomationRepository,
  queue: Queue<InterviewAutomationQueueMessage>,
  input: CreateJobInput,
): Promise<{ jobId: string; created: boolean }> {
  const job = await repo.createOrGetJob(input);
  if (job.created) {
    await queue.send({
      jobId: job.id,
      action: input.action,
      interviewId: input.interviewId,
      resumeId: input.resumeId,
    });
  }
  return { jobId: job.id, created: job.created };
}
