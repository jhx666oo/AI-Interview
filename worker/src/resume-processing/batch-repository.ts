import type {
  ReprocessBatchItemStatus,
  ReprocessBatchView,
  ReprocessBatchCurrentTask,
  ReprocessBatchFailedItem,
  ReprocessBatchStatus,
  ReprocessScope,
} from './types';

type Db = Pick<D1Database, 'prepare'>;

const TERMINAL_ITEM_STATUSES = new Set(['completed', 'failed', 'skipped']);
const BATCH_SIZE = 100;

export async function ensureResumeReprocessBatchSchema(db: Db): Promise<void> {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS resume_reprocess_batch_items (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL,
      resume_id TEXT NOT NULL,
      job_id TEXT,
      status TEXT NOT NULL CHECK (status IN ('pending', 'queued', 'running', 'completed', 'failed', 'skipped')),
      step TEXT,
      candidate_name TEXT,
      skip_reason TEXT,
      error_code TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY (batch_id) REFERENCES resume_reprocess_batches(id),
      FOREIGN KEY (resume_id) REFERENCES resumes(id)
    )
  `).bind().run();
  await db.prepare(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_resume_reprocess_items_batch_resume
      ON resume_reprocess_batch_items(batch_id, resume_id)
  `).bind().run();
  await db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_resume_reprocess_items_batch_status
      ON resume_reprocess_batch_items(batch_id, status)
  `).bind().run();
  await db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_resume_reprocess_items_resume_updated
      ON resume_reprocess_batch_items(resume_id, updated_at DESC)
  `).bind().run();
  await db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_resume_reprocess_items_job
      ON resume_reprocess_batch_items(job_id)
  `).bind().run();
}

export interface InsertReprocessBatchItem {
  batchId: string;
  resumeId: string;
  candidateName: string | null;
}

export async function insertReprocessBatchItems(
  db: Db,
  items: InsertReprocessBatchItem[],
): Promise<void> {
  if (items.length === 0) return;
  const timestamp = new Date().toISOString();
  for (let start = 0; start < items.length; start += BATCH_SIZE) {
    const chunk = items.slice(start, start + BATCH_SIZE);
    const values: unknown[] = [];
    const placeholders: string[] = [];
    for (const item of chunk) {
      const id = `${item.batchId}:${item.resumeId}`;
      placeholders.push(`(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      values.push(
        id, item.batchId, item.resumeId, null,
        'pending', null, item.candidateName, null,
        null, null, timestamp, timestamp, null,
      );
    }
    const sql = `INSERT OR IGNORE INTO resume_reprocess_batch_items
      (id, batch_id, resume_id, job_id, status, step, candidate_name, skip_reason, error_code, error_message, created_at, updated_at, completed_at)
      VALUES ${placeholders.join(', ')}`;
    await db.prepare(sql).bind(...values).run();
  }
}

export async function attachReprocessBatchItemToJob(
  db: Db,
  batchId: string,
  resumeId: string,
  jobId: string,
): Promise<void> {
  const timestamp = new Date().toISOString();
  const row = await db.prepare(
    'SELECT id, status FROM resume_reprocess_batch_items WHERE batch_id=? AND resume_id=?',
  ).bind(batchId, resumeId).first() as { id: string; status: string } | null;
  if (!row) return;
  if (row.status === 'completed' || row.status === 'failed' || row.status === 'skipped') return;

  const job = await db.prepare(
    "SELECT status, step, error_code, error_message FROM resume_processing_jobs WHERE id=?",
  ).bind(jobId).first() as { status: string; step: string; error_code: string | null; error_message: string | null } | null;

  const status: ReprocessBatchItemStatus = 'queued';
  const step = job?.step ?? null;
  await db.prepare(
    `UPDATE resume_reprocess_batch_items
       SET job_id=?, status=?, step=?, updated_at=?
     WHERE batch_id=? AND resume_id=?`,
  ).bind(jobId, status, step, timestamp, batchId, resumeId).run();
}

interface BatchItemUpdate {
  status?: ReprocessBatchItemStatus;
  step?: string | null;
  error_code?: string | null;
  error_message?: string | null;
  completed_at?: string | null;
}

export async function syncReprocessBatchItemByJob(
  db: Db,
  jobId: string,
  update: BatchItemUpdate,
): Promise<void> {
  const row = await db.prepare(
    'SELECT batch_id, resume_id, status FROM resume_reprocess_batch_items WHERE job_id=?',
  ).bind(jobId).first() as { batch_id: string; resume_id: string; status: string } | null;
  if (!row) return;
  if (TERMINAL_ITEM_STATUSES.has(row.status as ReprocessBatchItemStatus)) return;

  const parts: string[] = ['updated_at=?'];
  const values: unknown[] = [new Date().toISOString()];

  if (update.status && !TERMINAL_ITEM_STATUSES.has(update.status)) {
    parts.push('status=?');
    values.push(update.status);
  } else if (update.status && TERMINAL_ITEM_STATUSES.has(update.status)) {
    parts.push('status=?');
    values.push(update.status);
    if (update.status === 'completed') {
      parts.push('completed_at=?');
      values.push(update.completed_at ?? new Date().toISOString());
    }
  }
  if (update.step !== undefined) {
    parts.push('step=?');
    values.push(update.step ?? null);
  }
  if (update.error_code !== undefined) {
    parts.push('error_code=?');
    values.push(update.error_code ?? null);
  }
  if (update.error_message !== undefined) {
    parts.push('error_message=?');
    values.push(update.error_message ?? null);
  }

  await db.prepare(
    `UPDATE resume_reprocess_batch_items SET ${parts.join(', ')} WHERE job_id=?`,
  ).bind(...values, jobId).run();
  await refreshReprocessBatchStatus(db, row.batch_id);
}

export async function refreshReprocessBatchStatus(
  db: Db,
  batchId: string,
): Promise<void> {
  const batch = await db.prepare(
    'SELECT status, total_count FROM resume_reprocess_batches WHERE id=?',
  ).bind(batchId).first() as { status: ReprocessBatchStatus | null; total_count: number | null } | null;
  if (!batch) return;

  const counts = await db.prepare(
    `SELECT COUNT(*) AS item_total,
            SUM(CASE WHEN status IN ('completed', 'failed', 'skipped') THEN 1 ELSE 0 END) AS terminal_total,
            SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running_total
       FROM resume_reprocess_batch_items WHERE batch_id=?`,
  ).bind(batchId).first() as { item_total?: number; terminal_total?: number; running_total?: number } | null;
  const itemTotal = Number(counts?.item_total || 0);
  const terminalTotal = Number(counts?.terminal_total || 0);
  const targetTotal = Number(batch.total_count || 0) || itemTotal;
  const completed = targetTotal === itemTotal && terminalTotal === itemTotal;
  const status: ReprocessBatchStatus = completed
    ? 'completed'
    : Number(counts?.running_total || 0) > 0 || batch.status === 'running'
      ? 'running'
      : 'queued';
  const timestamp = new Date().toISOString();
  await db.prepare(
    `UPDATE resume_reprocess_batches
        SET status=?, completed_at=?, updated_at=?
      WHERE id=? AND status != 'failed'`,
  ).bind(status, completed ? timestamp : null, timestamp, batchId).run();
}

export async function getReprocessBatchView(
  db: Db,
  batchId: string,
  owner: string | null,
): Promise<ReprocessBatchView | null> {
  const batch = await db.prepare(
    'SELECT id, owner, status, scope, total_count, created_at, updated_at, completed_at FROM resume_reprocess_batches WHERE id=?',
  ).bind(batchId).first() as any;
  if (!batch) return null;
  const batchOwner = batch.owner || null;
  if (owner && batchOwner !== owner) return null;

  const rows = (await db.prepare(
    `SELECT i.resume_id, i.status, i.step, i.candidate_name, i.error_code, i.error_message,
            r.candidate_name AS resume_candidate_name, i.updated_at
     FROM resume_reprocess_batch_items i
     LEFT JOIN resumes r ON i.resume_id = r.id
     WHERE i.batch_id=?`,
  ).bind(batchId).all()) as { results?: any[] } | undefined;

  const list = rows?.results || [];
  let completed = 0, processing = 0, queued = 0, pending = 0, failed = 0, skipped = 0;
  const failedItems: ReprocessBatchFailedItem[] = [];
  let current: ReprocessBatchCurrentTask | null = null;
  let currentUpdatedAt = '';

  for (const row of list) {
    const status = row.status as ReprocessBatchItemStatus;
    if (status === 'completed') completed++;
    else if (status === 'failed') failed++;
    else if (status === 'skipped') skipped++;
    else if (status === 'running') processing++;
    else if (status === 'queued') queued++;
    else if (status === 'pending') pending++;

    if (status === 'failed') {
      failedItems.push({
        resume_id: row.resume_id,
        candidate_name: row.resume_candidate_name || row.candidate_name || 'Unknown',
        error_code: row.error_code,
        error_message: row.error_message,
      });
    }

    if (status === 'running' && (!current || (row as any).updated_at > currentUpdatedAt)) {
      current = {
        resume_id: row.resume_id,
        candidate_name: row.resume_candidate_name || row.candidate_name || 'Unknown',
        step: row.step || 'screening',
      };
      currentUpdatedAt = (row as any).updated_at;
    }
  }

  const total = Number(batch.total_count) || list.length || 0;
  pending += Math.max(0, total - list.length);
  const finished = completed + failed + skipped;
  const percent = total === 0 ? 100 : Math.round((finished / total) * 100);
  const status = finished >= total && total >= 0
    ? 'completed'
    : batch.status;

  return {
    batch_id: batch.id,
    scope: (batch.scope as ReprocessScope) || 'all',
    status,
    total,
    completed,
    processing,
    queued,
    pending,
    failed,
    skipped,
    percent,
    current,
    failed_items: failedItems.slice(0, 100),
    created_at: batch.created_at,
    updated_at: batch.updated_at,
    completed_at: batch.completed_at,
  };
}

export async function getActiveReprocessBatchView(
  db: Db,
  owner: string | null,
): Promise<ReprocessBatchView | null> {
  const batch = await db.prepare(
    `SELECT * FROM resume_reprocess_batches
     WHERE (${owner ? 'owner=?' : 'owner IS NULL'}) AND status IN ('queued', 'running')
     ORDER BY created_at DESC LIMIT 1`,
  ).bind(...(owner ? [owner] : [])).first() as any;
  if (!batch) return null;
  return getReprocessBatchView(db, batch.id, owner);
}

export async function appendEvaluationJobProjection(
  db: Db,
  items: any[],
): Promise<void> {
  if (items.length === 0) return;

  const jobById: Map<string, any> = new Map();
  const jobByResume: Map<string, any> = new Map();

  for (let start = 0; start < items.length; start += BATCH_SIZE) {
    const chunk = items.slice(start, start + BATCH_SIZE);
    const ids = chunk.map((item: any) => item.id);
    const placeholders = ids.map(() => '?').join(',');
    const rows = (await db.prepare(
      `SELECT id, resume_id, status, step, error_code, error_message, created_at
       FROM resume_processing_jobs
       WHERE resume_id IN (${placeholders})
       ORDER BY created_at DESC`,
    ).bind(...ids).all()) as { results?: any[] } | undefined;

    for (const row of rows?.results || []) {
      const key = row.resume_id;
      if (!jobByResume.has(key)) {
        jobByResume.set(key, row);
      }
      jobById.set(row.id, row);
    }
  }

  for (const item of items) {
    const activeJob = jobByResume.get(item.id);
    if (activeJob) {
      item.evaluation_job_status = activeJob.status;
      item.evaluation_job_step = activeJob.step;
      item.evaluation_job_error = activeJob.error_code ? `${activeJob.error_code}: ${activeJob.error_message ?? ''}`.slice(0, 200) : null;
      item.evaluation_batch_id = null;
    } else {
      const isFailed = item.parse_status === 'failed';
      item.evaluation_job_status = isFailed ? 'failed' : null;
      item.evaluation_job_step = null;
      item.evaluation_job_error = isFailed ? (item.parse_error ?? null) : null;
      item.evaluation_batch_id = null;
    }
  }
}
