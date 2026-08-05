import { describe, expect, it } from 'vitest';
import { enqueueResumeReprocess, ResumeNotFoundError } from '../src/resume-processing/reprocess';

describe('resume reprocess enqueue', () => {
  it('clears only AI fields while preserving source and human workflow fields', async () => {
    const db = createReprocessDb({ failedJob: { id: 'job-failed', status: 'failed' } });
    const queue = createQueue();

    await enqueueResumeReprocess(db as never, queue, 'resume-1');

    const resetSql = db.calls.find((sql) => sql.startsWith('UPDATE resumes SET')) || '';
    expect(resetSql).toContain('ai_review=NULL');
    expect(resetSql).toContain('ai_evaluation=NULL');
    expect(resetSql).toContain('match_score=NULL');
    expect(resetSql).toContain('capability_scores=NULL');
    expect(resetSql).toContain('three_layer_match=NULL');
    expect(resetSql).toContain('hard_requirement_result=NULL');
    expect(resetSql).toContain("parse_status='queued'");
    expect(resetSql).not.toContain('\n       status=');
    expect(resetSql).not.toContain('hr_review=');
    expect(resetSql).not.toContain('stage=');
    expect(resetSql).not.toContain('raw_text=NULL');
    expect(resetSql).not.toContain('parsed_data=NULL');
    expect(resetSql).not.toContain('ocr_markdown=NULL');
    expect(resetSql).not.toContain('file_path=NULL');
    expect(queue.messages).toEqual([{ jobId: 'job-failed', resumeId: 'resume-1', reprocess: true }]);
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
    const db = createReprocessDb({ jobsTableMissing: true });
    const queue = createQueue();

    const result = await enqueueResumeReprocess(db as never, queue, 'resume-1');
    expect(result).toMatchObject({ status: 'queued', queued: true });
    expect(queue.messages).toEqual([{ jobId: result.jobId, resumeId: 'resume-1', reprocess: true }]);
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

  it('marks a job failed after queue send rejection so a retry can send it again', async () => {
    const db = createReprocessDb({});
    let sendAttempts = 0;
    const messages: Array<{ jobId: string; resumeId: string; reprocess?: boolean }> = [];
    const queue = {
      async send(message: { jobId: string; resumeId: string; reprocess?: boolean }) {
        sendAttempts += 1;
        if (sendAttempts === 1) throw new Error('queue unavailable');
        messages.push(message);
      },
    };

    await expect(enqueueResumeReprocess(db as never, queue, 'resume-1')).rejects.toThrow('queue unavailable');
    expect(db.calls.some((sql) => sql.includes("SET status='failed'") && sql.includes('QUEUE_SEND_FAILED'))).toBe(true);

    const retryResult = await enqueueResumeReprocess(db as never, queue, 'resume-1');
    expect(retryResult).toMatchObject({ queued: true });
    expect(messages).toEqual([{ jobId: retryResult.jobId, resumeId: 'resume-1', reprocess: true }]);
  });
});

function createQueue() {
  const messages: Array<{ jobId: string; resumeId: string; reprocess?: boolean }> = [];
  return {
    messages,
    async send(message: { jobId: string; resumeId: string; reprocess?: boolean }) {
      messages.push(message);
    },
  };
}

function createReprocessDb(options: {
  resumeExists?: boolean;
  activeJob?: { id: string; status: 'queued' | 'running' } | null;
  failedJob?: { id: string; status: 'failed' } | null;
  jobsTableMissing?: boolean;
}) {
  const calls: string[] = [];
  let createdJob: { id: string; status: 'queued' | 'failed' } | null = null;
  let schemaReady = !options.jobsTableMissing;
  return {
    calls,
    prepare(sql: string) {
      calls.push(sql);
      return {
        bind(...values: unknown[]) {
          return {
            async first() {
              if (sql.includes('SELECT id FROM resumes')) return options.resumeExists === false ? null : { id: values[0] };
              if (!schemaReady && sql.includes('resume_processing_jobs')) throw new Error('no such table: resume_processing_jobs');
              if (sql.includes("status IN ('queued', 'running')")) {
                if (options.activeJob) return options.activeJob;
                return createdJob?.status === 'queued' ? createdJob : null;
              }
              if (sql.includes("status='failed'")) return options.failedJob || (createdJob?.status === 'failed' ? createdJob : null);
              return null;
            },
            async run() {
              if (sql.includes('CREATE TABLE IF NOT EXISTS resume_processing_jobs')) schemaReady = true;
              if (sql.includes('INSERT OR IGNORE')) {
                createdJob = { id: 'job-new', status: 'queued' };
              }
              if (sql.includes("SET status='failed'")) {
                createdJob = { id: String(values.at(-1)), status: 'failed' };
              }
              if (sql.includes("SET\n         status='queued'")) {
                createdJob = { id: String(values.at(-1)), status: 'queued' };
              }
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };
}
