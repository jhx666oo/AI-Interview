import { ensureResumeProcessingJobsSchema, isMissingResumeProcessingJobsError } from './job-repository';
import type { HistoricalReprocessQueueMessage, ResumeProcessingQueueMessage, ResumeQueueMessage } from './types';
import { logResumeProcessing, logResumeProcessingError } from './logging';

type ReprocessDb = Pick<D1Database, 'prepare'>;
type ReprocessQueue = { send(message: ResumeProcessingQueueMessage): Promise<unknown> };
type ReprocessOwner = string | null;
export const HISTORICAL_REPROCESS_PAGE_SIZE = 25;

async function ensureHistoricalReprocessSchema(db: ReprocessDb): Promise<void> {
  await db.prepare(`CREATE TABLE IF NOT EXISTS resume_reprocess_batches (
    id TEXT PRIMARY KEY,
    owner TEXT,
    status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed')),
    cursor TEXT,
    requested_count INTEGER NOT NULL DEFAULT 0,
    matched_count INTEGER NOT NULL DEFAULT 0,
    queued_count INTEGER NOT NULL DEFAULT 0,
    already_processing_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
  )`).bind().run();
  await db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_resume_reprocess_one_active_owner
    ON resume_reprocess_batches(COALESCE(owner, '')) WHERE status IN ('queued', 'running')`).bind().run();
}

export async function startHistoricalResumeReprocess(
  db: ReprocessDb,
  queue: ReprocessQueue,
  owner: ReprocessOwner,
) {
  await ensureHistoricalReprocessSchema(db);
  const ownerPredicate = owner ? 'owner=?' : 'owner IS NULL';
  const active = await db.prepare(
    `SELECT * FROM resume_reprocess_batches WHERE ${ownerPredicate} AND status IN ('queued', 'running') ORDER BY created_at DESC LIMIT 1`,
  ).bind(...(owner ? [owner] : [])).first() as any;
  if (active) {
    return {
      batch_id: active.id,
      requested: Number(active.requested_count || 0),
      matched: Number(active.matched_count || 0),
      queued: Number(active.matched_count || 0),
      already_processing: Number(active.already_processing_count || 0),
      failed: Number(active.failed_count || 0),
      coordinator_queued: false,
    };
  }

  const ownerWhere = owner
    ? ` WHERE position_id IN (SELECT id FROM positions WHERE responsible_person = ?) OR position_applied IN (SELECT raw_name FROM position_mappings WHERE responsible_person = ?) OR mapped_position IN (SELECT mapped_name FROM position_mappings WHERE responsible_person = ?)`
    : '';
  const countRow = await db.prepare(`SELECT COUNT(*) AS total FROM resumes${ownerWhere}`)
    .bind(...(owner ? [owner, owner, owner] : [])).first() as any;
  const total = Number(countRow?.total || 0);
  const batchId = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const inserted = await db.prepare(`INSERT OR IGNORE INTO resume_reprocess_batches
    (id, owner, status, requested_count, matched_count, created_at, updated_at)
    VALUES (?, ?, 'queued', ?, ?, ?, ?)`)
    .bind(batchId, owner, total, total, timestamp, timestamp).run();
  if (!inserted.meta?.changes) {
    const winner = await db.prepare(
      `SELECT * FROM resume_reprocess_batches WHERE ${ownerPredicate} AND status IN ('queued', 'running') ORDER BY created_at DESC LIMIT 1`,
    ).bind(...(owner ? [owner] : [])).first() as any;
    if (!winner) throw new Error('Unable to create historical reprocess batch');
    return {
      batch_id: winner.id,
      requested: Number(winner.requested_count || 0),
      matched: Number(winner.matched_count || 0),
      queued: Number(winner.matched_count || 0),
      already_processing: Number(winner.already_processing_count || 0),
      failed: Number(winner.failed_count || 0),
      coordinator_queued: false,
    };
  }

  try {
    await queue.send({ kind: 'historical_reprocess', batchId });
  } catch (error) {
    await db.prepare("UPDATE resume_reprocess_batches SET status='failed', error_message=?, updated_at=? WHERE id=?")
      .bind(String((error as any)?.message || error).slice(0, 500), new Date().toISOString(), batchId).run();
    throw error;
  }

  return {
    batch_id: batchId,
    requested: total,
    matched: total,
    queued: total,
    already_processing: 0,
    failed: 0,
    coordinator_queued: true,
  };
}

type HistoricalBatch = { id: string; cursor: string | null; owner?: string | null };
type HistoricalCoordinatorDeps = {
  pageSize?: number;
  claimBatch(): Promise<HistoricalBatch | null>;
  loadPage(batch: HistoricalBatch, limit: number): Promise<Array<{ id: string }>>;
  enqueuePage(ids: string[]): Promise<{ queued: number; already_processing: number; failed: number }>;
  saveProgress(batch: HistoricalBatch, cursor: string, counts: { queued: number; already_processing: number; failed: number }): Promise<void>;
  complete(batch: HistoricalBatch, counts: { queued: number; already_processing: number; failed: number }): Promise<void>;
  sendNext(message: HistoricalReprocessQueueMessage): Promise<void>;
};

export async function runHistoricalReprocessCoordinator(batchId: string, deps: HistoricalCoordinatorDeps) {
  const pageSize = Math.max(1, Math.min(HISTORICAL_REPROCESS_PAGE_SIZE, deps.pageSize || HISTORICAL_REPROCESS_PAGE_SIZE));
  const batch = await deps.claimBatch();
  if (!batch) return { claimed: false, processed: 0, has_more: false };
  const rows = await deps.loadPage(batch, pageSize);
  if (rows.length === 0) {
    await deps.complete(batch, { queued: 0, already_processing: 0, failed: 0 });
    return { claimed: true, processed: 0, has_more: false };
  }
  const counts = await deps.enqueuePage(rows.map((row) => row.id));
  const cursor = rows[rows.length - 1].id;
  const hasMore = rows.length === pageSize;
  if (hasMore) {
    await deps.saveProgress(batch, cursor, counts);
    await deps.sendNext({ kind: 'historical_reprocess', batchId });
  } else {
    await deps.complete(batch, counts);
  }
  return { claimed: true, processed: rows.length, has_more: hasMore, ...counts };
}

export async function processHistoricalResumeReprocessPage(
  db: ReprocessDb,
  queue: ReprocessQueue,
  batchId: string,
) {
  return runHistoricalReprocessCoordinator(batchId, {
    claimBatch: async () => {
      const timestamp = new Date().toISOString();
      const claimed = await db.prepare("UPDATE resume_reprocess_batches SET status='running', updated_at=? WHERE id=? AND status='queued'")
        .bind(timestamp, batchId).run();
      if (!claimed.meta?.changes) return null;
      return await db.prepare('SELECT id, owner, cursor FROM resume_reprocess_batches WHERE id=?').bind(batchId).first() as HistoricalBatch | null;
    },
    loadPage: async (batch, limit) => {
      const clauses = ['id > ?'];
      const values: unknown[] = [batch.cursor || ''];
      if (batch.owner) {
        clauses.push('(position_id IN (SELECT id FROM positions WHERE responsible_person = ?) OR position_applied IN (SELECT raw_name FROM position_mappings WHERE responsible_person = ?) OR mapped_position IN (SELECT mapped_name FROM position_mappings WHERE responsible_person = ?))');
        values.push(batch.owner, batch.owner, batch.owner);
      }
      const rows = await db.prepare(`SELECT id FROM resumes WHERE ${clauses.join(' AND ')} ORDER BY id LIMIT ?`)
        .bind(...values, limit).all();
      return (rows.results || []) as Array<{ id: string }>;
    },
    enqueuePage: async (ids) => enqueueResumeReprocessBatchForIds(db, queue, ids),
    saveProgress: async (_batch, cursor, counts) => {
      await db.prepare(`UPDATE resume_reprocess_batches SET cursor=?, status='queued',
        queued_count=queued_count+?, already_processing_count=already_processing_count+?, failed_count=failed_count+?, updated_at=? WHERE id=?`)
        .bind(cursor, counts.queued, counts.already_processing, counts.failed, new Date().toISOString(), batchId).run();
    },
    complete: async (_batch, counts) => {
      const timestamp = new Date().toISOString();
      await db.prepare(`UPDATE resume_reprocess_batches SET status='completed',
        queued_count=queued_count+?, already_processing_count=already_processing_count+?, failed_count=failed_count+?, completed_at=?, updated_at=? WHERE id=?`)
        .bind(counts.queued, counts.already_processing, counts.failed, timestamp, timestamp, batchId).run();
    },
    sendNext: (message) => queue.send(message).then(() => undefined),
  });
}

export async function resetHistoricalResumeReprocessBatch(db: ReprocessDb, batchId: string): Promise<void> {
  await db.prepare("UPDATE resume_reprocess_batches SET status='queued', updated_at=? WHERE id=? AND status='running'")
    .bind(new Date().toISOString(), batchId).run();
}

export async function selectVisibleResumeIdsForReprocess(
  db: ReprocessDb,
  requestedIds: string[],
  owner: ReprocessOwner,
): Promise<string[]> {
  const ownerWhere = owner
    ? ` AND (position_id IN (SELECT id FROM positions WHERE responsible_person = ?) OR position_applied IN (SELECT raw_name FROM position_mappings WHERE responsible_person = ?) OR mapped_position IN (SELECT mapped_name FROM position_mappings WHERE responsible_person = ?))`
    : '';
  const ownerParams = owner ? [owner, owner, owner] : [];
  const ids: string[] = [];

  if (requestedIds.length > 0) {
    for (let start = 0; start < requestedIds.length; start += 200) {
      const chunk = requestedIds.slice(start, start + 200);
      const placeholders = chunk.map(() => '?').join(', ');
      const rows = await db.prepare(`SELECT id FROM resumes WHERE id IN (${placeholders})${ownerWhere}`)
        .bind(...chunk, ...ownerParams).all();
      ids.push(...(rows.results || []).map((row: any) => row.id));
    }
  } else {
    const rows = await db.prepare(`SELECT id FROM resumes WHERE 1=1${ownerWhere} ORDER BY created_at DESC`)
      .bind(...ownerParams).all();
    ids.push(...(rows.results || []).map((row: any) => row.id));
  }

  return [...new Set(ids)];
}

export class ResumeNotFoundError extends Error {
  constructor(public readonly resumeId: string) {
    super(`RESUME_NOT_FOUND:${resumeId}`);
  }
}

export async function resetResumeForReprocess(db: ReprocessDb, resumeId: string): Promise<void> {
  const timestamp = new Date().toISOString();
  await db.prepare(
    `UPDATE resumes SET
       ai_review=NULL,
       ai_evaluation=NULL,
       match_score=NULL,
       screening_result=NULL,
       hard_requirement_result=NULL,
       capability_scores=NULL,
       three_layer_match=NULL,
       parse_status='queued',
       parse_error=NULL,
       updated_at=?
     WHERE id=?`,
  ).bind(timestamp, resumeId).run();
}

export async function enqueueResumeReprocessBatchForIds(
  db: ReprocessDb,
  queue: ReprocessQueue,
  resumeIds: string[],
) {
  const ids = [...new Set(resumeIds)];
  const queued: string[] = [];
  const alreadyProcessing: string[] = [];
  const failed: Array<{ id: string; detail: string }> = [];
  logResumeProcessing('reprocess.batch.start', { requested: ids.length });

  for (let start = 0; start < ids.length; start += 10) {
    const chunk = ids.slice(start, start + 10);
    const results = await Promise.all(chunk.map(async (resumeId) => {
      try {
        return { resumeId, result: await enqueueResumeReprocess(db, queue, resumeId) };
      } catch (error: any) {
        return { resumeId, error: error instanceof ResumeNotFoundError ? 'Resume not found' : (error?.message || '重新入队失败') };
      }
    }));
    for (const item of results) {
      if (item.error) failed.push({ id: item.resumeId, detail: item.error });
      else if (item.result?.queued) queued.push(item.resumeId);
      else alreadyProcessing.push(item.resumeId);
    }
  }

  const result = {
    requested: ids.length,
    matched: ids.length,
    queued: queued.length,
    already_processing: alreadyProcessing.length,
    failed: failed.length,
    failed_items: failed.slice(0, 20),
    job_ids: queued,
  };
  logResumeProcessing('reprocess.batch.complete', result);
  return result;
}

export async function enqueueResumeReprocess(
  db: ReprocessDb,
  queue: ReprocessQueue,
  resumeId: string,
): Promise<{ jobId: string; status: 'queued' | 'running'; queued: boolean }> {
  const startedAt = Date.now();
  logResumeProcessing('reprocess.enqueue.start', { resumeId });
  const resume = await db.prepare('SELECT id FROM resumes WHERE id=?').bind(resumeId).first();
  if (!resume) {
    logResumeProcessing('reprocess.resume.not_found', { resumeId, durationMs: Date.now() - startedAt });
    throw new ResumeNotFoundError(resumeId);
  }

  const findActiveJob = () => db.prepare(
    "SELECT * FROM resume_processing_jobs WHERE resume_id=? AND status IN ('queued', 'running') ORDER BY created_at DESC LIMIT 1",
  ).bind(resumeId).first();
  let activeJob: any;
  try {
    activeJob = await findActiveJob() as any;
  } catch (error) {
    // 兼容早期生产数据库：只在明确缺表时执行一次性建表，不拖慢正常请求。
    if (!isMissingResumeProcessingJobsError(error)) throw error;
    await ensureResumeProcessingJobsSchema(db);
    activeJob = await findActiveJob() as any;
  }
  if (activeJob) {
    logResumeProcessing('reprocess.active_job', {
      resumeId,
      jobId: activeJob.id,
      status: activeJob.status,
      durationMs: Date.now() - startedAt,
    });
    return { jobId: activeJob.id, status: activeJob.status, queued: false };
  }

  let job = await db.prepare(
    "SELECT * FROM resume_processing_jobs WHERE resume_id=? AND status='failed' ORDER BY updated_at DESC LIMIT 1",
  ).bind(resumeId).first() as any;

  if (job) {
    const timestamp = new Date().toISOString();
    const resetJobResult = await db.prepare(
      `UPDATE resume_processing_jobs SET
         status='queued',
         step='extracting_text',
         error_code=NULL,
         error_message=NULL,
         started_at=NULL,
         completed_at=NULL,
         updated_at=?
       WHERE id=? AND status='failed'`,
    ).bind(timestamp, job.id).run();
    // 另一个请求可能已经抢先重置了失败任务；此时它负责发送唯一的队列消息。
    if (!resetJobResult.meta?.changes) {
      const activeAfterRace = await db.prepare(
        "SELECT * FROM resume_processing_jobs WHERE resume_id=? AND status IN ('queued', 'running') ORDER BY created_at DESC LIMIT 1",
      ).bind(resumeId).first() as any;
      if (activeAfterRace) {
        logResumeProcessing('reprocess.active_job.race', {
          resumeId,
          jobId: activeAfterRace.id,
          status: activeAfterRace.status,
          durationMs: Date.now() - startedAt,
        });
        return { jobId: activeAfterRace.id, status: activeAfterRace.status, queued: false };
      }
      throw new Error('Unable to requeue failed resume processing job');
    }
    job = { ...job, status: 'queued' };
    logResumeProcessing('reprocess.job.requeued', { resumeId, jobId: job.id });
  } else {
    const timestamp = new Date().toISOString();
    const candidateJobId = crypto.randomUUID();
    const insertResult = await db.prepare(
      `INSERT OR IGNORE INTO resume_processing_jobs
         (id, resume_id, status, step, created_at, updated_at)
       VALUES (?, ?, 'queued', 'extracting_text', ?, ?)`,
    ).bind(candidateJobId, resumeId, timestamp, timestamp).run();
    if (insertResult.meta?.changes) {
      job = { id: candidateJobId, status: 'queued' };
      logResumeProcessing('reprocess.job.created', { resumeId, jobId: job.id });
    } else {
      // INSERT OR IGNORE 命中并发请求创建的活动任务；不要再次清空数据或发送消息。
      const activeAfterRace = await db.prepare(
        "SELECT * FROM resume_processing_jobs WHERE resume_id=? AND status IN ('queued', 'running') ORDER BY created_at DESC LIMIT 1",
      ).bind(resumeId).first() as any;
      if (!activeAfterRace) throw new Error('Unable to create resume processing job');
      logResumeProcessing('reprocess.active_job.insert_race', {
        resumeId,
        jobId: activeAfterRace.id,
        status: activeAfterRace.status,
        durationMs: Date.now() - startedAt,
      });
      return { jobId: activeAfterRace.id, status: activeAfterRace.status, queued: false };
    }
  }

  await resetResumeForReprocess(db, resumeId);
  logResumeProcessing('reprocess.queue_send.start', { resumeId, jobId: job.id });
  const queueStartedAt = Date.now();
  try {
    await queue.send({ jobId: job.id, resumeId, reprocess: true });
  } catch (error) {
    const timestamp = new Date().toISOString();
    await db.prepare(
      `UPDATE resume_processing_jobs SET status='failed', error_code='QUEUE_SEND_FAILED', error_message=?, updated_at=?
       WHERE id=? AND status='queued'`,
    ).bind(String((error as any)?.message || error).slice(0, 500), timestamp, job.id).run();
    logResumeProcessingError('reprocess.queue_send.error', error, {
      resumeId,
      jobId: job.id,
      durationMs: Date.now() - queueStartedAt,
    });
    throw error;
  }
  logResumeProcessing('reprocess.queue_send.ok', {
    resumeId,
    jobId: job.id,
    durationMs: Date.now() - queueStartedAt,
    totalDurationMs: Date.now() - startedAt,
  });
  return { jobId: job.id, status: 'queued', queued: true };
}
