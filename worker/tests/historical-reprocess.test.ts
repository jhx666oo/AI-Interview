import { describe, expect, it } from 'vitest';
import {
  enqueueResumeReprocessBatchForIds,
  selectVisibleResumeIdsForReprocess,
} from '../src/resume-processing/reprocess';
import { handleBatchResumeReprocess } from '../src/index';

describe('historical resume reprocess', () => {
  it('returns 202 and counts for an admin request with no ids', async () => {
    const db = createHistoricalDb(['resume-1', 'resume-2']);
    const queue = createQueue();
    const response = await handleBatchResumeReprocess({
      env: { DB: db, RESUME_PROCESSING_QUEUE: queue },
      get: () => ({ role: 'admin' }),
      req: { json: async () => ({}) },
      json: (body: unknown, status: number) => ({ body, status }),
    });

    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({ requested: 2, matched: 2, queued: 2, failed: 0 });
  });

  it('selects every admin-visible resume and queues each one once', async () => {
    const db = createHistoricalDb(['resume-1', 'resume-2']);
    const queue = createQueue();

    const ids = await selectVisibleResumeIdsForReprocess(db as never, [], null);
    const result = await enqueueResumeReprocessBatchForIds(db as never, queue, ids);

    expect(ids).toEqual(['resume-1', 'resume-2']);
    expect(result).toMatchObject({ requested: 2, matched: 2, queued: 2, failed: 0 });
    expect(queue.messages.map((message) => message.resumeId)).toEqual(['resume-1', 'resume-2']);
    expect(db.resetResumeIds).toEqual(['resume-1', 'resume-2']);

    const secondRun = await enqueueResumeReprocessBatchForIds(db as never, queue, ids);
    expect(secondRun).toMatchObject({ requested: 2, matched: 2, queued: 0, failed: 0, already_processing: 2 });
    expect(queue.messages).toHaveLength(2);
    expect(db.resetResumeIds).toEqual(['resume-1', 'resume-2']);
  });
});

function createQueue() {
  const messages: Array<{ jobId: string; resumeId: string; reprocess?: boolean }> = [];
  return { messages, async send(message: { jobId: string; resumeId: string; reprocess?: boolean }) { messages.push(message); } };
}

function createHistoricalDb(resumeIds: string[]) {
  const activeJobs = new Map<string, { id: string; status: 'queued' }>();
  const resetResumeIds: string[] = [];
  let jobNumber = 0;
  return {
    resetResumeIds,
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async all() {
              if (sql.startsWith('SELECT id FROM resumes WHERE 1=1')) {
                return { results: resumeIds.map((id) => ({ id })) };
              }
              return { results: [] };
            },
            async first() {
              const resumeId = values[0] as string;
              if (sql === 'SELECT id FROM resumes WHERE id=?') return resumeIds.includes(resumeId) ? { id: resumeId } : null;
              if (sql.includes("status IN ('queued', 'running')")) return activeJobs.get(resumeId) || null;
              if (sql.includes("status='failed'")) return null;
              return null;
            },
            async run() {
              if (sql.includes('INSERT OR IGNORE INTO resume_processing_jobs')) {
                const resumeId = values[1] as string;
                if (activeJobs.has(resumeId)) return { meta: { changes: 0 } };
                activeJobs.set(resumeId, { id: `job-${++jobNumber}`, status: 'queued' });
              }
              if (sql.startsWith('UPDATE resumes SET')) resetResumeIds.push(values.at(-1) as string);
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };
}
