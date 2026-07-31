import { describe, expect, it } from 'vitest';
import {
  ACTIVE_JOB_STATUSES,
  isTerminalJobStatus,
} from '../src/resume-processing/types';
import { claimJob } from '../src/resume-processing/job-repository';

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
