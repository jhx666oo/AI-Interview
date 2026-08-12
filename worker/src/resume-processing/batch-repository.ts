import type {
  ReprocessBatchItemStatus,
  ReprocessBatchView,
  ReprocessBatchCurrentTask,
  ReprocessBatchFailedItem,
  ReprocessBatchStatus,
  ReprocessScope,
  ResumeJobStatus,
} from './types';

type Db = Pick<D1Database, 'prepare'>;

const TERMINAL_ITEM_STATUSES = new Set(['completed', 'failed', 'skipped']);
const D1_MAX_BOUND_PARAMETERS = 100;
const BATCH_ITEM_COLUMNS = 13;
const BATCH_ITEM_INSERT_BATCH_SIZE = Math.floor(D1_MAX_BOUND_PARAMETERS / BATCH_ITEM_COLUMNS);
const RESUME_QUERY_BATCH_SIZE = D1_MAX_BOUND_PARAMETERS;

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
  for (let start = 0; start < items.length; start += BATCH_ITEM_INSERT_BATCH_SIZE) {
    const chunk = items.slice(start, start + BATCH_ITEM_INSERT_BATCH_SIZE);
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
  // Terminal states are final — never overwrite
  if (TERMINAL_ITEM_STATUSES.has(row.status as ReprocessBatchItemStatus)) return;

  const job = await db.prepare(
    "SELECT status, step, error_code, error_message FROM resume_processing_jobs WHERE id=?",
  ).bind(jobId).first() as { status: string; step: string; error_code: string | null; error_message: string | null } | null;

  // Map job status to item status; respect terminal protection
  let itemStatus: ReprocessBatchItemStatus = 'pending';
  if (job) {
    if (job.status === 'completed') itemStatus = 'completed';
    else if (job.status === 'failed') itemStatus = 'failed';
    else if (job.status === 'running') itemStatus = 'running';
    else itemStatus = 'queued';
  }

  const parts: string[] = ['job_id=?', 'step=?', 'updated_at=?'];
  const values: unknown[] = [jobId, job?.step ?? null, timestamp];

  // Only update status if it would change (prevents overwriting terminal states from concurrent consumers)
  if (itemStatus !== row.status) {
    parts.push('status=?');
    values.push(itemStatus);
    if (itemStatus === 'completed') {
      parts.push('completed_at=?');
      values.push(timestamp);
    }
  }
  if (job?.error_code) {
    parts.push('error_code=?');
    values.push(job.error_code);
  }
  if (job?.error_message) {
    parts.push('error_message=?');
    values.push(job.error_message);
  }

  await db.prepare(
    `UPDATE resume_reprocess_batch_items SET ${parts.join(', ')} WHERE batch_id=? AND resume_id=?`,
  ).bind(...values, batchId, resumeId).run();
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
  if (batch.status === 'failed' || batch.status === 'cancelled') {
    return;
  }
  const status: ReprocessBatchStatus = completed
    ? 'completed'
    : batch.status === 'queued'
      ? 'queued'
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

/**
 * Reconcile batch items whose job has reached a terminal state but the item hasn't been updated.
 */
export async function reconcileReprocessBatchItems(db: Db, batchId: string): Promise<void> {
  const rows = await db.prepare(
    `SELECT i.id, i.job_id, i.status, j.status AS job_status, j.step, j.error_code, j.error_message
     FROM resume_reprocess_batch_items i
     LEFT JOIN resume_processing_jobs j ON i.job_id = j.id
     WHERE i.batch_id=? AND i.job_id IS NOT NULL AND i.status IN ('pending', 'queued', 'running')`,
  ).bind(batchId).all() as unknown as { results?: any[] };

  const itemRows = rows.results || [];
  if (itemRows.length === 0) return;

  const timestamp = new Date().toISOString();
  for (const item of itemRows) {
    const jobStatus = item.job_status as ResumeJobStatus | null;
    if (!jobStatus) continue;

    let newItemStatus: ReprocessBatchItemStatus | null = null;
    const parts: string[] = ['updated_at=?'];
    const values: unknown[] = [timestamp];

    if (jobStatus === 'completed') {
      newItemStatus = 'completed';
      parts.push('status=?', 'completed_at=?');
      values.push('completed', timestamp);
    } else if (jobStatus === 'failed') {
      newItemStatus = 'failed';
      parts.push('status=?', 'error_code=?', 'error_message=?');
      values.push('failed', item.error_code ?? 'PROCESSING_FAILED', item.error_message ?? null);
    } else if (jobStatus === 'running' && item.status !== 'running') {
      newItemStatus = 'running';
      parts.push('status=?', 'step=?');
      values.push('running', item.step ?? null);
    } else if (jobStatus === 'queued' && item.status !== 'queued') {
      newItemStatus = 'queued';
      parts.push('status=?');
      values.push('queued');
    }

    if (newItemStatus && newItemStatus !== item.status) {
      await db.prepare(
        `UPDATE resume_reprocess_batch_items SET ${parts.join(', ')} WHERE id=?`,
      ).bind(...values, item.id).run();
    }
  }

  await refreshReprocessBatchStatus(db, batchId);
}

export async function getReprocessBatchView(
  db: Db,
  batchId: string,
  owner: string | null,
): Promise<ReprocessBatchView | null> {
  // Reconcile any stale items before aggregating
  await reconcileReprocessBatchItems(db, batchId).catch(() => undefined);

  const batch = await db.prepare(
    'SELECT id, owner, status, scope, total_count, error_message, created_at, updated_at, completed_at FROM resume_reprocess_batches WHERE id=?',
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
  const cancelled = batch.status === 'failed' && String(batch.error_message || '').startsWith('BATCH_CANCELLED:');
  const viewStatus: ReprocessBatchStatus = cancelled ? 'cancelled' : batch.status;
  const status: ReprocessBatchStatus = !cancelled && viewStatus !== 'failed' && finished >= total && total >= 0
    ? 'completed'
    : viewStatus;

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
    error_message: batch.error_message || null,
    created_at: batch.created_at,
    updated_at: batch.updated_at,
    completed_at: batch.completed_at,
  };
}

/**
 * Stop a historical batch without changing already completed evaluations.
 * D1 stores this as failed for schema compatibility; the view maps the
 * BATCH_CANCELLED marker to the user-facing cancelled status.
 */
export async function cancelReprocessBatch(
  db: Db,
  batchId: string,
  owner: string | null,
): Promise<boolean> {
  const batch = await db.prepare(
    'SELECT id, owner, status FROM resume_reprocess_batches WHERE id=?',
  ).bind(batchId).first() as { id: string; owner: string | null; status: string } | null;
  if (!batch || (owner && (batch.owner || null) !== owner)) return false;
  if (batch.status !== 'queued' && batch.status !== 'running') return true;

  const timestamp = new Date().toISOString();
  const message = 'BATCH_CANCELLED: 用户已停止批量重新评估';

  // Mark the batch first so a coordinator that is between pages observes the
  // terminal state and cannot schedule another coordinator message.
  await db.prepare(
    `UPDATE resume_reprocess_batches
        SET status='failed', error_message=?, completed_at=?, updated_at=?
      WHERE id=? AND status IN ('queued', 'running')`,
  ).bind(message, timestamp, timestamp, batchId).run();

  await db.prepare(
    `UPDATE resume_processing_jobs
        SET status='cancelled', error_code='BATCH_CANCELLED', error_message=?, completed_at=?, updated_at=?
      WHERE status='queued'
        AND id IN (
          SELECT job_id FROM resume_reprocess_batch_items
           WHERE batch_id=? AND status IN ('pending', 'queued') AND job_id IS NOT NULL
        )`,
  ).bind(message, timestamp, timestamp, batchId).run();

  // Reprocess reset these resumes to queued before sending the job. Mark jobs
  // that never started as failed/stopped as well, otherwise the regular resume
  // list polling would keep treating them as active parse work forever.
  await db.prepare(
    `UPDATE resumes
        SET parse_status='failed', parse_error=?, updated_at=?
      WHERE id IN (
        SELECT resume_id FROM resume_reprocess_batch_items
         WHERE batch_id=? AND status IN ('pending', 'queued') AND job_id IS NOT NULL
      )`,
  ).bind(message, timestamp, batchId).run();

  await db.prepare(
    `UPDATE resume_reprocess_batch_items
        SET status='skipped', skip_reason='cancelled', error_code='BATCH_CANCELLED', error_message=?, updated_at=?
      WHERE batch_id=? AND status IN ('pending', 'queued')`,
  ).bind(message, timestamp, batchId).run();
  return true;
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
  await reconcileReprocessBatchItems(db, batch.id).catch(() => undefined);
  return getReprocessBatchView(db, batch.id, owner);
}

export async function appendEvaluationJobProjection(
  db: Db,
  items: any[],
): Promise<void> {
  if (items.length === 0) return;

  const jobById: Map<string, any> = new Map();
  const jobByResume: Map<string, any> = new Map();

  for (let start = 0; start < items.length; start += RESUME_QUERY_BATCH_SIZE) {
    const chunk = items.slice(start, start + RESUME_QUERY_BATCH_SIZE);
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
