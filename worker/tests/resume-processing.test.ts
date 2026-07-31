import { describe, expect, it } from 'vitest';
import {
  ACTIVE_JOB_STATUSES,
  isTerminalJobStatus,
} from '../src/resume-processing/types';
import { claimJob, createOrGetActiveJob } from '../src/resume-processing/job-repository';

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
