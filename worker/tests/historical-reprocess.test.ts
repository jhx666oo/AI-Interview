import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  enqueueResumeReprocessBatchForIds,
  runHistoricalReprocessCoordinator,
  selectVisibleResumeIdsForReprocess,
} from '../src/resume-processing/reprocess';
import { handleBatchResumeReprocess } from '../src/index';

describe('historical resume reprocess', () => {
  it('returns 202 counts and enqueues one bounded coordinator for an all-history request', async () => {
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
    expect(queue.messages).toHaveLength(1);
    expect(queue.messages[0]).toMatchObject({ kind: 'historical_reprocess' });
    expect(db.resetResumeIds).toEqual([]);

    const retryResponse = await handleBatchResumeReprocess({
      env: { DB: db, RESUME_PROCESSING_QUEUE: queue },
      get: () => ({ role: 'admin' }),
      req: { json: async () => ({}) },
      json: (body: unknown, status: number) => ({ body, status }),
    });
    expect(retryResponse.status).toBe(202);
    expect(retryResponse.body).toMatchObject({ requested: 2, matched: 2, queued: 2, coordinator_queued: false });
    expect(queue.messages).toHaveLength(1);
  });

  it('processes one bounded page and schedules the next page asynchronously', async () => {
    const loadedLimits: number[] = [];
    const sent: unknown[] = [];
    const result = await runHistoricalReprocessCoordinator('batch-1', {
      pageSize: 25,
      claimBatch: async () => ({ id: 'batch-1', cursor: null }),
      loadPage: async (_batch, limit) => {
        loadedLimits.push(limit);
        return Array.from({ length: 25 }, (_, index) => ({ id: `resume-${String(index + 1).padStart(2, '0')}` }));
      },
      enqueuePage: async (ids) => ({ queued: ids.length, already_processing: 0, failed: 0 }),
      saveProgress: async () => undefined,
      complete: async () => undefined,
      sendNext: async (message) => { sent.push(message); },
    });

    expect(loadedLimits).toEqual([25]);
    expect(result).toMatchObject({ processed: 25, has_more: true });
    expect(sent).toEqual([{ kind: 'historical_reprocess', batchId: 'batch-1' }]);
  });

  it('binds the resume consumer as a producer so the coordinator can schedule pages and resume jobs', async () => {
    const config = JSON.parse(await readFile(resolve(process.cwd(), 'wrangler.resume-consumer.jsonc'), 'utf8'));
    expect(config.queues.producers).toContainEqual({
      binding: 'RESUME_PROCESSING_QUEUE',
      queue: 'resume-processing',
    });
    const deployedConfig = await readFile(resolve(process.cwd(), 'wrangler.resume-consumer.toml'), 'utf8');
    expect(deployedConfig).toContain('[[queues.producers]]');
    expect(deployedConfig).toContain('binding = "RESUME_PROCESSING_QUEUE"');
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
  const messages: any[] = [];
  return { messages, async send(message: any) { messages.push(message); } };
}

function createHistoricalDb(resumeIds: string[]) {
  const activeJobs = new Map<string, { id: string; status: 'queued' }>();
  const resetResumeIds: string[] = [];
  const batches = new Map<string, any>();
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
              if (sql.includes('COUNT(*) AS total') && sql.includes('FROM resumes')) return { total: resumeIds.length };
              if (sql.includes('FROM resume_reprocess_batches') && sql.includes("status IN ('queued', 'running')")) {
                return [...batches.values()].find((batch) => batch.status === 'queued' || batch.status === 'running') || null;
              }
              const resumeId = values[0] as string;
              if (sql === 'SELECT id FROM resumes WHERE id=?') return resumeIds.includes(resumeId) ? { id: resumeId } : null;
              if (sql.includes("status IN ('queued', 'running')")) return activeJobs.get(resumeId) || null;
              if (sql.includes("status='failed'")) return null;
              return null;
            },
            async run() {
              if (sql.includes('INTO resume_reprocess_batches')) {
                batches.set(String(values[0]), {
                  id: values[0],
                  status: 'queued',
                  requested_count: values[2],
                  matched_count: values[3],
                  already_processing_count: 0,
                  failed_count: 0,
                });
                return { meta: { changes: 1 } };
              }
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
