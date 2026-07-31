import { describe, expect, it, vi } from 'vitest';
import { handleResumeQueueMessage, RetryableResumeError } from '../src/resume-consumer';

describe('resume queue consumer', () => {
  it('acknowledges a completed job', async () => {
    const message = fakeMessage();
    await handleResumeQueueMessage(message as never, {
      claim: async () => ({ id: 'job-1' }),
      process: async () => undefined,
      complete: async () => undefined,
      fail: async () => undefined,
    });
    expect(message.ack).toHaveBeenCalledOnce();
  });

  it('retries a transient failure with a delay', async () => {
    const message = fakeMessage();
    await handleResumeQueueMessage(message as never, {
      claim: async () => ({ id: 'job-1' }),
      process: async () => { throw new RetryableResumeError('AI_TIMEOUT'); },
      complete: async () => undefined,
      fail: async () => undefined,
    });
    expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 30 });
    expect(message.ack).not.toHaveBeenCalled();
  });
});

function fakeMessage() {
  return {
    body: { jobId: 'job-1', resumeId: 'resume-1' },
    ack: vi.fn(),
    retry: vi.fn(),
  };
}
