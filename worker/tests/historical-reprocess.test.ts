import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  enqueueResumeReprocessBatchForIds,
  runHistoricalReprocessCoordinator,
  selectVisibleResumeIdsForReprocess,
  selectResumeIdsForBatchScope,
  enqueueResumeReprocessBatchPage,
  recoverStalledHistoricalResumeReprocess,
  startHistoricalResumeReprocess,
} from '../src/resume-processing/reprocess';
import { insertReprocessBatchItems, refreshReprocessBatchStatus } from '../src/resume-processing/batch-repository';
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
      enqueuePage: async (rows) => ({ queued: rows.length, already_processing: 0, failed: 0 }),
      saveProgress: async () => undefined,
      complete: async () => undefined,
      sendNext: async (message) => { sent.push(message); },
    });

    expect(loadedLimits).toEqual([25]);
    expect(result).toMatchObject({ processed: 25, has_more: true });
    expect(sent).toEqual([{ kind: 'historical_reprocess', batchId: 'batch-1' }]);
  });

  it('does not schedule another page when the batch is cancelled while saving progress', async () => {
    const sent: unknown[] = [];
    let shouldContinueCalls = 0;
    const result = await runHistoricalReprocessCoordinator('batch-1', {
      pageSize: 25,
      claimBatch: async () => ({ id: 'batch-1', cursor: null }),
      loadPage: async () => Array.from({ length: 25 }, (_, index) => ({ id: `resume-${index}` })),
      enqueuePage: async (rows) => ({ queued: rows.length, already_processing: 0, failed: 0 }),
      saveProgress: async () => undefined,
      complete: async () => undefined,
      shouldContinue: async () => shouldContinueCalls++ === 0,
      sendNext: async (message) => { sent.push(message); },
    });

    expect(result).toMatchObject({ processed: 25, has_more: true });
    expect(sent).toEqual([]);
  });

  it('requeues a stale coordinator when no current page items remain active', async () => {
    const db = createStalledBatchDb();
    const queue = createQueue();
    const now = Date.parse('2026-08-12T12:00:00.000Z');

    await expect(recoverStalledHistoricalResumeReprocess(
      db as never,
      queue as never,
      'batch-stalled',
      null,
      now,
    )).resolves.toBe(true);

    expect(db.batch.status).toBe('queued');
    expect(queue.messages).toEqual([{ kind: 'historical_reprocess', batchId: 'batch-stalled' }]);

    await expect(recoverStalledHistoricalResumeReprocess(
      db as never,
      queue as never,
      'batch-stalled',
      null,
      now,
    )).resolves.toBe(false);
    expect(queue.messages).toHaveLength(1);
  });

  it('does not requeue a stale batch while the current page still has active items', async () => {
    const db = createStalledBatchDb(1);
    const queue = createQueue();

    await expect(recoverStalledHistoricalResumeReprocess(
      db as never,
      queue as never,
      'batch-stalled',
      null,
      Date.parse('2026-08-12T12:00:00.000Z'),
    )).resolves.toBe(false);

    expect(db.batch.status).toBe('running');
    expect(queue.messages).toHaveLength(0);
  });

  it('does not promote a queued coordinator back to running when page jobs are active', async () => {
    let finalValues: unknown[] | null = null;
    const db = {
      prepare(sql: string) {
        return {
          bind(...values: unknown[]) {
            return {
              async first() {
                if (sql.includes('SELECT status, total_count')) return { status: 'queued', total_count: 226 };
                if (sql.includes('SELECT COUNT(*) AS item_total')) return { item_total: 25, terminal_total: 24, running_total: 1 };
                return null;
              },
              async run() {
                finalValues = values;
                return { meta: { changes: 1 } };
              },
            };
          },
        };
      },
    };

    await refreshReprocessBatchStatus(db as never, 'batch-1');
    expect(finalValues).not.toBeNull();
    expect(finalValues?.[0]).toBe('queued');
  });

  it('completes a batch when all materialized items are terminal even if pagination found extras', async () => {
    let finalValues: unknown[] | null = null;
    const db = {
      prepare(sql: string) {
        return {
          bind(...values: unknown[]) {
            return {
              async first() {
                if (sql.includes('SELECT status, total_count')) return { status: 'running', total_count: 80 };
                if (sql.includes('SELECT COUNT(*) AS item_total')) return { item_total: 81, terminal_total: 81, running_total: 0 };
                return null;
              },
              async run() {
                finalValues = values;
                return { meta: { changes: 1 } };
              },
            };
          },
        };
      },
    };

    await refreshReprocessBatchStatus(db as never, 'batch-1');

    expect(finalValues?.[0]).toBe('completed');
    expect(finalValues?.[1]).toEqual(expect.any(String));
  });

  it('does not complete a batch while materialized items are still below the target', async () => {
    let finalValues: unknown[] | null = null;
    const db = {
      prepare(sql: string) {
        return {
          bind(...values: unknown[]) {
            return {
              async first() {
                if (sql.includes('SELECT status, total_count')) return { status: 'running', total_count: 80 };
                if (sql.includes('SELECT COUNT(*) AS item_total')) return { item_total: 79, terminal_total: 79, running_total: 0 };
                return null;
              },
              async run() {
                finalValues = values;
                return { meta: { changes: 1 } };
              },
            };
          },
        };
      },
    };

    await refreshReprocessBatchStatus(db as never, 'batch-1');

    expect(finalValues?.[0]).toBe('running');
    expect(finalValues?.[1]).toBeNull();
  });

  it('keeps batch item inserts within D1 bound parameter limits', async () => {
    const db = createHistoricalDb([]);
    await insertReprocessBatchItems(db as never, Array.from({ length: 8 }, (_, index) => ({
      batchId: 'batch-1',
      resumeId: `resume-${index}`,
      candidateName: `Candidate-${index}`,
    })));

    expect(db.maxBindCount).toBeLessThanOrEqual(100);
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

  it('selectResumeIdsForBatchScope with all scope returns all visible resumes', async () => {
    const db = createHistoricalDb(['resume-1', 'resume-2']);
    const rows = await selectResumeIdsForBatchScope(db as never, 'all', null);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.id)).toEqual(['resume-1', 'resume-2']);
  });

  it('enqueueResumeReprocessBatchPage creates batch items and enqueues jobs', async () => {
    const db = createHistoricalDb(['resume-1', 'resume-2']);
    const queue = createQueue();
    const result = await enqueueResumeReprocessBatchPage(db as never, queue as never, 'batch-1', [
      { id: 'resume-1', candidate_name: '张三' },
      { id: 'resume-2', candidate_name: '李四' },
    ]);
    expect(result.queued).toBe(2);
    expect(result.skipped).toBe(0);
    expect(queue.messages).toHaveLength(2);
  });

  it('startHistoricalResumeReprocess accepts scope parameter and creates items', async () => {
    const db = createHistoricalDbWithItems(['resume-1', 'resume-2']);
    const queue = createQueue();
    const response = await startHistoricalResumeReprocess(db as never, queue as never, null, 'all');
    expect(response.batch_id).toBeDefined();
    expect(queue.messages).toHaveLength(1);
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
  let maxBindCount = 0;
  return {
    resetResumeIds,
    get maxBindCount() { return maxBindCount; },
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          maxBindCount = Math.max(maxBindCount, values.length);
          return {
            async all() {
              if (sql.startsWith('SELECT id FROM resumes WHERE 1=1')) {
                return { results: resumeIds.map((id) => ({ id })) };
              }
              if (sql.includes('SELECT r.id, r.candidate_name') && sql.includes('resume_processing_jobs')) {
                return { results: resumeIds.map((id) => ({ id, candidate_name: `Candidate-${id}` })) };
              }
              if (sql.includes('SELECT r.id, r.candidate_name FROM resumes r WHERE 1=1')) {
                return { results: resumeIds.map((id) => ({ id, candidate_name: `Candidate-${id}` })) };
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
              if (sql.includes('INSERT OR IGNORE INTO resume_reprocess_batch_items')) {
                return { meta: { changes: 1 } };
              }
              if (sql.includes('UPDATE resume_reprocess_batch_items')) {
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };
}

function createHistoricalDbWithItems(resumeIds: string[]) {
  const db = createHistoricalDb(resumeIds);
  return db;
}

function createStalledBatchDb(activeTotal = 0) {
  const batch = {
    id: 'batch-stalled',
    owner: null,
    status: 'running',
    total_count: 226,
    updated_at: '2026-08-12T09:00:00.000Z',
  };

  return {
    batch,
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async first() {
              if (sql.includes('SELECT id, owner, status, updated_at, total_count')) return { ...batch };
              if (sql.includes('SELECT COUNT(*) AS item_total')) return { item_total: 25, active_total: activeTotal };
              return null;
            },
            async run() {
              if (sql.includes("SET status='queued'")) {
                batch.status = 'queued';
                batch.updated_at = String(values[0]);
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };
}
