import { describe, expect, it, vi } from 'vitest';
import {
  ACTIVE_JOB_STATUSES,
  isTerminalJobStatus,
} from '../src/resume-processing/types';
import { processResume } from '../src/resume-processing/processor';
import { claimJob, createOrGetActiveJob, updateJobAIDiagnostics, assertJobRunning, ResumeProcessingCancelledError, recoverStaleResumeProcessingJobs } from '../src/resume-processing/job-repository';

describe('resume processing job status contract', () => {
  it('only treats completed, failed, and cancelled as terminal', () => {
    expect(isTerminalJobStatus('completed')).toBe(true);
    expect(isTerminalJobStatus('failed')).toBe(true);
    expect(isTerminalJobStatus('cancelled')).toBe(true);
    expect(isTerminalJobStatus('queued')).toBe(false);
    expect(isTerminalJobStatus('running')).toBe(false);
  });

  it('keeps queued and running as the only active job states', () => {
    expect(ACTIVE_JOB_STATUSES).toEqual(['queued', 'running']);
  });
});

describe('screening completion hook', () => {
  it('runs after AI screening is persisted so automation can enqueue safely', async () => {
    const updates: Array<Record<string, unknown>> = [];
    const onScreened = vi.fn(async () => undefined);
    await processResume({ jobId: 'job-1', resumeId: 'resume-1' }, {
      getResume: async () => ({ id: 'resume-1', raw_text: 'candidate resume text with enough characters', parsed_data: null, ai_evaluation: null }),
      getText: async () => 'candidate resume text with enough characters',
      extractFields: async () => ({ name: '候选人' }),
      screen: async () => ({ screening_result: '通过', weighted_score: 80 }),
      updateResume: async (_id, update) => { updates.push(update); },
      setJobStep: async () => undefined,
      assertJobRunning: async () => undefined,
      onScreened,
    });
    expect(updates.some((update) => update.parse_status === 'ai_screened')).toBe(true);
    expect(onScreened).toHaveBeenCalledWith(expect.objectContaining({ result: expect.objectContaining({ screening_result: '通过' }) }));
  });
});

describe('job claiming', () => {
  it('returns the existing active job instead of creating a duplicate', async () => {
    const db = createActiveJobDb();

    const first = await createOrGetActiveJob(db as never, 'resume-1');
    const second = await createOrGetActiveJob(db as never, 'resume-1');

    expect(second.id).toBe(first.id);
    expect(db.insertAttempts).toBe(2);
  });
  it('only allows one consumer to claim a queued job', async () => {
    const db = createClaimDb();

    await expect(claimJob(db as never, 'job-1')).resolves.toMatchObject({
      id: 'job-1',
      status: 'running',
      attempt_count: 1,
    });
    await expect(claimJob(db as never, 'job-1')).resolves.toBeNull();
  });
});

function createClaimDb() {
  let status = 'queued';
  let attemptCount = 0;

  return {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async run() {
              if (!sql.includes("WHERE id=? AND status='queued'")) {
                throw new Error('claim must conditionally update by job id and queued status');
              }
              if (values.at(-1) !== 'job-1' || status !== 'queued') {
                return { meta: { changes: 0 } };
              }
              status = 'running';
              attemptCount += 1;
              return { meta: { changes: 1 } };
            },
            async first() {
              return { id: 'job-1', status, attempt_count: attemptCount };
            },
          };
        },
      };
    },
  };
}

function createActiveJobDb() {
  const job = { id: 'job-existing', resume_id: 'resume-1', status: 'queued', step: 'extracting_text' };
  let insertAttempts = 0;
  return {
    get insertAttempts() { return insertAttempts; },
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async run() {
              if (sql.includes('INSERT OR IGNORE')) insertAttempts += 1;
              return { meta: { changes: 0 } };
            },
            async first() { return job; },
          };
        },
      };
    },
  };
}

describe('job AI diagnostics', () => {
  it('persists provider, model, attempt, response metadata and response chars', async () => {
    const captured: Array<{ sql: string; values: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        return {
          bind(...values: unknown[]) {
            captured.push({ sql, values });
            return { run: async () => ({ meta: { changes: 1 } }) };
          },
        };
      },
    };
    await updateJobAIDiagnostics(db as never, 'job-1', {
      provider: 'configured_api',
      model: 'deepseek-chat',
      attempt: 3,
      responseChars: 8421,
      finishReason: 'length',
      contentChars: 8421,
      reasoningChars: 1200,
      responseShape: 'truncated_json',
      formatAttempt: 1,
      repairStatus: 'not_attempted',
    });
    const update = captured.find((c) => c.sql.includes('UPDATE resume_processing_jobs'))!;
    expect(update.sql).toContain('ai_provider=?');
    expect(update.sql).toContain('ai_model=?');
    expect(update.sql).toContain('ai_attempt=?');
    expect(update.sql).toContain('ai_response_chars=?');
    expect(update.sql).toContain('ai_finish_reason=?');
    expect(update.sql).toContain('ai_content_chars=?');
    expect(update.sql).toContain('ai_reasoning_chars=?');
    expect(update.sql).toContain('ai_response_shape=?');
    expect(update.sql).toContain('ai_format_attempt=?');
    expect(update.sql).toContain('ai_repair_status=?');
    expect(update.values).toEqual(expect.arrayContaining([
      'configured_api', 'deepseek-chat', 3, 8421,
      'length', 8421, 1200, 'truncated_json', 1, 'not_attempted',
    ]));
    expect(update.values.at(-1)).toBe('job-1');
  });

  it('records a structured validation error stage', async () => {
    const captured: Array<{ sql: string; values: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        return {
          bind(...values: unknown[]) {
            captured.push({ sql, values });
            return { run: async () => ({ meta: { changes: 1 } }) };
          },
        };
      },
    };
    await updateJobAIDiagnostics(db as never, 'job-1', {
      responseChars: 500,
      errorStage: 'structured_validation',
    });
    const update = captured.find((c) => c.sql.includes('UPDATE resume_processing_jobs'))!;
    expect(update.sql).toContain('ai_error_stage=?');
    expect(update.values).toContain('structured_validation');
    expect(update.sql).not.toContain('ai_provider=?');
  });
});

describe('structured log hygiene', () => {
  it('consumer log calls never include resume text, full prompts, or API keys', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/resume-consumer.ts', import.meta.url), 'utf8');
    // 结构化日志事件对象不允许出现完整简历文本 / prompt / apiKey 作为字段值
    expect(source).not.toMatch(/logResumeProcessing(?:Error)?\([^)]*text:\s*(text|screenUserText)/);
    expect(source).not.toMatch(/logResumeProcessing(?:Error)?\([^)]*apiKey/);
    // 日志对象字段白名单只允许 ID、provider、model、attempt、长度、错误码、阶段
    expect(source).toMatch(/'ai.screening.validation_failed'/);
  });
});

describe('job cancellation protection', () => {
  it('assertJobRunning passes while the job is running', async () => {
    const db = { prepare: () => ({ bind: () => ({ first: async () => ({ status: 'running' }) }) }) };
    await expect(assertJobRunning(db as never, 'job-1')).resolves.toBeUndefined();
  });

  it('assertJobRunning rejects with BATCH_CANCELLED when the job was cancelled', async () => {
    const db = { prepare: () => ({ bind: () => ({ first: async () => ({ status: 'cancelled' }) }) }) };
    await expect(assertJobRunning(db as never, 'job-1')).rejects.toBeInstanceOf(ResumeProcessingCancelledError);
  });

  it('assertJobRunning rejects when the job no longer exists', async () => {
    const db = { prepare: () => ({ bind: () => ({ first: async () => null }) }) };
    await expect(assertJobRunning(db as never, 'job-1')).rejects.toBeInstanceOf(ResumeProcessingCancelledError);
  });
});

describe('stale job recovery', () => {
  it('marks an old running job failed and makes its resume retryable', async () => {
    const db = createStaleJobDb();
    const recovered = await recoverStaleResumeProcessingJobs(
      db as never,
      10 * 60 * 1000,
      Date.parse('2026-08-14T00:20:00.000Z'),
    );

    expect(recovered).toEqual({ recovered: 1 });
    expect(db.calls.some((sql) => sql.includes("SET status='failed'") && sql.includes('PROCESSING_STALLED'))).toBe(true);
    expect(db.calls.some((sql) => sql.includes("UPDATE resumes") && sql.includes("parse_status='failed'"))).toBe(true);
  });

  it('runs stale-job recovery before rendering batch progress', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/resume-processing/batch-repository.ts', import.meta.url), 'utf8');
    const viewStart = source.indexOf('export async function getReprocessBatchView');
    const viewSource = source.slice(viewStart);

    expect(viewStart).toBeGreaterThan(-1);
    expect(viewSource).toContain('recoverStaleResumeProcessingJobs');
  });
});

function createStaleJobDb() {
  const calls: string[] = [];
  return {
    calls,
    prepare(sql: string) {
      return {
        bind(..._values: unknown[]) {
          return {
            async all() {
              if (sql.includes("status='running'") && sql.includes('updated_at <')) {
                return {
                  results: [{
                    id: 'job-stale',
                    resume_id: 'resume-stale',
                    updated_at: '2026-08-13T23:59:00.000Z',
                  }],
                };
              }
              return { results: [] };
            },
            async run() {
              calls.push(sql);
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };
}
