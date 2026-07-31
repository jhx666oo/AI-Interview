import type { ResumeQueueMessage } from './resume-processing/types';

export class RetryableResumeError extends Error {
  constructor(public readonly code: string, message?: string) {
    super(message ?? code);
  }
}

type QueueMessage = {
  body: ResumeQueueMessage;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
};

type ResumeConsumerDeps = {
  claim(jobId: string): Promise<unknown | null>;
  process(message: ResumeQueueMessage): Promise<void>;
  complete(jobId: string): Promise<void>;
  fail(jobId: string, error: Error): Promise<void>;
};

export async function handleResumeQueueMessage(
  message: QueueMessage,
  deps: ResumeConsumerDeps,
): Promise<void> {
  const job = await deps.claim(message.body.jobId);
  if (!job) {
    message.ack();
    return;
  }

  try {
    await deps.process(message.body);
    await deps.complete(message.body.jobId);
    message.ack();
  } catch (error) {
    if (error instanceof RetryableResumeError) {
      message.retry({ delaySeconds: 30 });
      return;
    }
    await deps.fail(message.body.jobId, error instanceof Error ? error : new Error(String(error)));
    message.ack();
  }
}
