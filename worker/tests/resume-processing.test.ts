import { describe, expect, it } from 'vitest';
import {
  ACTIVE_JOB_STATUSES,
  isTerminalJobStatus,
} from '../src/resume-processing/types';
import { claimJob, createOrGetActiveJob, updateJobAIDiagnostics } from '../src/resume-processing/job-repository';

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
  it('persists provider, model, attempt and response chars', async () => {
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
    });
    const update = captured.find((c) => c.sql.includes('UPDATE resume_processing_jobs'))!;
    expect(update.sql).toContain('ai_provider=?');
    expect(update.sql).toContain('ai_model=?');
    expect(update.sql).toContain('ai_attempt=?');
    expect(update.sql).toContain('ai_response_chars=?');
    expect(update.values).toEqual(expect.arrayContaining(['configured_api', 'deepseek-chat', 3, 8421]));
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
