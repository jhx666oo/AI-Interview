import { describe, expect, it, vi } from 'vitest';
import { handleResumeQueueMessage, RetryableResumeError } from '../src/resume-consumer';
import { processResume } from '../src/resume-processing/processor';
import { enrichScreeningEvaluation } from '../src/index';

describe('resume queue consumer', () => {
  it('acknowledges a completed job', async () => {
    const message = fakeMessage();
    await handleResumeQueueMessage(message as never, {
      claim: async () => ({ id: 'job-1' }),
      process: async () => undefined,
      complete: async () => undefined,
      resetJob: async () => undefined,
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
      resetJob: async () => undefined,
      fail: async () => undefined,
    });
    expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 30 });
    expect(message.ack).not.toHaveBeenCalled();
  });

  it('persists a queue evaluation using weighted five-point screening fields', async () => {
    const config = [
      { name: '核心画像', weight: 25 }, { name: '核心职责', weight: 22 },
      { name: '任职要求', weight: 22 }, { name: '企业背景', weight: 13 },
      { name: '关键词匹配', weight: 8 }, { name: '加分项', weight: 10 },
      { name: '避坑雷区', weight: 8 },
    ];
    const updates: Record<string, unknown>[] = [];
    const rawAiEvaluation = {
      match_score: 62,
      dimensions: config.map(({ name }) => ({ name, score: 5, reason: '满足要求' })),
    };

    await processResume({ jobId: 'job-1', resumeId: 'resume-1' }, {
      getResume: async () => ({ id: 'resume-1', raw_text: '候选人有充足的相关工作经验和完整简历内容。', parsed_data: JSON.stringify({ name: '候选人' }), ai_evaluation: null }),
      getText: async () => '候选人有充足的相关工作经验和完整简历内容。',
      extractFields: async () => ({ name: '候选人' }),
      screen: async () => enrichScreeningEvaluation(rawAiEvaluation, config),
      updateResume: async (_id, update) => { updates.push(update); },
      setJobStep: async () => undefined,
    });

    const persisted = updates.at(-1)!;
    const aiEvaluation = JSON.parse(String(persisted.ai_evaluation));
    expect(persisted.match_score).toBe(5);
    expect(persisted.screening_result).toBe('通过');
    expect(aiEvaluation).toMatchObject({
      weighted_score: 5,
      match_score: 5,
      screening_result: '通过',
      screening_reason: '五项能力加权分达到 4 分',
    });
    expect(aiEvaluation.dimensions).toHaveLength(7);
  });

  it('persists a failed red-flag gate with no weighted score', async () => {
    const updates: Record<string, unknown>[] = [];
    const config = ['核心画像', '核心职责', '任职要求', '企业背景', '关键词匹配', '加分项', '避坑雷区'].map(name => ({ name, weight: 10 }));
    await processResume({ jobId: 'job-1', resumeId: 'resume-1' }, {
      getResume: async () => ({ id: 'resume-1', raw_text: '候选人有充足的相关工作经验和完整简历内容。', parsed_data: JSON.stringify({ name: '候选人' }), ai_evaluation: null }),
      getText: async () => '候选人有充足的相关工作经验和完整简历内容。',
      extractFields: async () => ({ name: '候选人' }),
      screen: async () => enrichScreeningEvaluation({ match_score: 62, dimensions: config.map(({ name }) => ({ name, score: name === '避坑雷区' ? 4 : 5 })) }, config),
      updateResume: async (_id, update) => { updates.push(update); },
      setJobStep: async () => undefined,
    });

    const persisted = updates.at(-1)!;
    const aiEvaluation = JSON.parse(String(persisted.ai_evaluation));
    expect(persisted.match_score).toBeNull();
    expect(persisted.screening_result).toBe('不通过');
    expect(aiEvaluation.weighted_score).toBeNull();
    expect(aiEvaluation.gate_results.red_flag).toEqual({ score: 4, passed: false });
  });
});

function fakeMessage() {
  return {
    body: { jobId: 'job-1', resumeId: 'resume-1' },
    ack: vi.fn(),
    retry: vi.fn(),
  };
}
