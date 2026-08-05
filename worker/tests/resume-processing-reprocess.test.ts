import { describe, expect, it } from 'vitest';
import { enqueueResumeReprocess, ResumeNotFoundError } from '../src/resume-processing/reprocess';

describe('resume reprocess enqueue', () => {
  it('clears only parsing and AI fields while preserving human workflow fields', async () => {
    const db = createReprocessDb({ failedJob: { id: 'job-failed', status: 'failed' } });
    const queue = createQueue();

    await enqueueResumeReprocess(db as never, queue, 'resume-1');

    const resetSql = db.calls.find((sql) => sql.startsWith('UPDATE resumes SET')) || '';
    expect(resetSql).toContain('ai_review=NULL');
    expect(resetSql).toContain('ai_evaluation=NULL');
    expect(resetSql).toContain('match_score=NULL');
    expect(resetSql).toContain("parse_status='queued'");
    expect(resetSql).not.toContain('\n       status=');
    expect(resetSql).not.toContain('hr_review=');
    expect(resetSql).not.toContain('stage=');
    expect(queue.messages).toEqual([{ jobId: 'job-failed', resumeId: 'resume-1' }]);
  });

  it('reuses an active job without sending a duplicate queue message', async () => {
    const db = createReprocessDb({ activeJob: { id: 'job-active', status: 'running' } });
    const queue = createQueue();

    await expect(enqueueResumeReprocess(db as never, queue, 'resume-1')).resolves.toEqual({
      jobId: 'job-active',
      status: 'running',
      queued: false,
    });
    expect(queue.messages).toEqual([]);
    expect(db.calls.some((sql) => sql.startsWith('UPDATE resumes SET'))).toBe(false);
  });

  it('creates one queued job and sends one message for a fresh resume', async () => {
    const db = createReprocessDb({});
    const queue = createQueue();

    const result = await enqueueResumeReprocess(db as never, queue, 'resume-1');
    expect(result).toMatchObject({ status: 'queued', queued: true });
    expect(queue.messages).toEqual([{ jobId: result.jobId, resumeId: 'resume-1' }]);
    expect(db.calls.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS resume_processing_jobs'))).toBe(true);
    expect(db.calls.some((sql) => sql.includes('INSERT OR IGNORE INTO resume_processing_jobs'))).toBe(true);
  });

  it('rejects an unknown resume before creating a job', async () => {
    const db = createReprocessDb({ resumeExists: false });
    const queue = createQueue();

    await expect(enqueueResumeReprocess(db as never, queue, 'missing'))
      .rejects.toBeInstanceOf(ResumeNotFoundError);
    expect(queue.messages).toEqual([]);
  });
});

function createQueue() {
  const messages: Array<{ jobId: string; resumeId: string }> = [];
  return {
    messages,
    async send(message: { jobId: string; resumeId: string }) {
      messages.push(message);
    },
  };
}

function createReprocessDb(options: {
  resumeExists?: boolean;
  activeJob?: { id: string; status: 'queued' | 'running' } | null;
  failedJob?: { id: string; status: 'failed' } | null;
}) {
  const calls: string[] = [];
  let createdJob: { id: string; status: 'queued' } | null = null;
  return {
    calls,
    prepare(sql: string) {
      calls.push(sql);
      return {
        bind(...values: unknown[]) {
          return {
            async first() {
              if (sql.includes('SELECT id FROM resumes')) return options.resumeExists === false ? null : { id: values[0] };
              if (sql.includes("status IN ('queued', 'running')")) return options.activeJob || createdJob;
              if (sql.includes("status='failed'")) return options.failedJob || null;
              return null;
            },
            async run() {
              if (sql.includes('INSERT OR IGNORE')) {
                createdJob = { id: 'job-new', status: 'queued' };
              }
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };
}
