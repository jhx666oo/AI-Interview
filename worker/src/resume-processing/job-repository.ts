import { hasValidAiEvaluation, type ResumeProcessingJob } from './types';

export const STALE_RESUME_JOB_TIMEOUT_MS = 10 * 60 * 1000;

export async function ensureResumeProcessingJobsSchema(db: Pick<D1Database, 'prepare'>): Promise<void> {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS resume_processing_jobs (
      id TEXT PRIMARY KEY,
      resume_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
      step TEXT NOT NULL CHECK (step IN ('extracting_text', 'extracting_fields', 'screening', 'syncing_feishu')),
      attempt_count INTEGER NOT NULL DEFAULT 0,
      error_code TEXT,
      error_message TEXT,
      version INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (resume_id) REFERENCES resumes(id)
    )
  `).bind().run();
  await db.prepare(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_resume_jobs_one_active
      ON resume_processing_jobs(resume_id)
      WHERE status IN ('queued', 'running')
  `).bind().run();
  await db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_resume_jobs_status_updated
      ON resume_processing_jobs(status, updated_at DESC)
  `).bind().run();
  // AI 诊断列（0029）——对旧数据库幂等补列
  for (const column of [
    "ALTER TABLE resume_processing_jobs ADD COLUMN ai_provider TEXT",
    "ALTER TABLE resume_processing_jobs ADD COLUMN ai_model TEXT",
    "ALTER TABLE resume_processing_jobs ADD COLUMN ai_attempt INTEGER",
    "ALTER TABLE resume_processing_jobs ADD COLUMN ai_response_chars INTEGER",
    "ALTER TABLE resume_processing_jobs ADD COLUMN ai_error_stage TEXT",
    "ALTER TABLE resume_processing_jobs ADD COLUMN ai_finish_reason TEXT",
    "ALTER TABLE resume_processing_jobs ADD COLUMN ai_content_chars INTEGER",
    "ALTER TABLE resume_processing_jobs ADD COLUMN ai_reasoning_chars INTEGER",
    "ALTER TABLE resume_processing_jobs ADD COLUMN ai_response_shape TEXT",
    "ALTER TABLE resume_processing_jobs ADD COLUMN ai_format_attempt INTEGER",
    "ALTER TABLE resume_processing_jobs ADD COLUMN ai_repair_status TEXT",
  ]) {
    try {
      await db.prepare(column).run();
    } catch { /* column may already exist */ }
  }
}

export function isMissingResumeProcessingJobsError(error: unknown): boolean {
  return /no such table|does not exist|resume_processing_jobs/i.test(String((error as any)?.message || error));
}

export async function createOrGetActiveJob(
  db: D1Database,
  resumeId: string,
): Promise<ResumeProcessingJob> {
  const timestamp = new Date().toISOString();
  const insertJob = () => db
    .prepare(
      `INSERT OR IGNORE INTO resume_processing_jobs
         (id, resume_id, status, step, created_at, updated_at)
       VALUES (?, ?, 'queued', 'extracting_text', ?, ?)`,
    )
    .bind(crypto.randomUUID(), resumeId, timestamp, timestamp)
    .run();
  try {
    await insertJob();
  } catch (error) {
    if (!isMissingResumeProcessingJobsError(error)) throw error;
    await ensureResumeProcessingJobsSchema(db);
    await insertJob();
  }

  const job = await db
    .prepare(
      `SELECT * FROM resume_processing_jobs
       WHERE resume_id=? AND status IN ('queued', 'running')
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(resumeId)
    .first();

  if (!job) throw new Error('Unable to create resume processing job');
  return job as ResumeProcessingJob;
}

export async function claimJob(
  db: D1Database,
  jobId: string,
): Promise<ResumeProcessingJob | null> {
  const timestamp = new Date().toISOString();
  const result = await db
    .prepare(
      `UPDATE resume_processing_jobs
         SET status='running',
             attempt_count=attempt_count+1,
             started_at=COALESCE(started_at, ?),
             updated_at=?,
             version=version+1
       WHERE id=? AND status='queued'`,
    )
    .bind(timestamp, timestamp, jobId)
    .run();

  if (!result.meta.changes) return null;

  return (await db
    .prepare('SELECT * FROM resume_processing_jobs WHERE id=?')
    .bind(jobId)
    .first()) as ResumeProcessingJob | null;
}

export interface JobAIDiagnostics {
  provider?: string | null;
  model?: string | null;
  attempt?: number | null;
  responseChars?: number | null;
  errorStage?: string | null;
  finishReason?: string | null;
  contentChars?: number | null;
  reasoningChars?: number | null;
  responseShape?: string | null;
  formatAttempt?: number | null;
  repairStatus?: string | null;
}

/** Thrown when a job was cancelled (batch stopped) before an in-flight AI write. */
export class ResumeProcessingCancelledError extends Error {
  readonly code = 'BATCH_CANCELLED';
  constructor(message = '任务已被用户停止，不再写入评估结果') {
    super(message);
  }
}

/**
 * Guard called before every resume write. If the job is no longer running
 * (cancelled by a batch stop, or already completed/failed by a duplicate
 * consumer), throw so the in-flight result is never persisted.
 */
export async function assertJobRunning(
  db: Pick<D1Database, 'prepare'>,
  jobId: string,
): Promise<void> {
  const row = await db.prepare('SELECT status FROM resume_processing_jobs WHERE id=?')
    .bind(jobId)
    .first() as { status: string } | null;
  if (!row || row.status !== 'running') {
    throw new ResumeProcessingCancelledError('任务已停止，不再写入评估结果');
  }
}

/** Persist AI provider/model/attempt/length/error-stage diagnostics for a job. */
export async function updateJobAIDiagnostics(
  db: Pick<D1Database, 'prepare'>,
  jobId: string,
  diag: JobAIDiagnostics,
): Promise<void> {
  const parts: string[] = ['updated_at=?'];
  const values: unknown[] = [new Date().toISOString()];
  if (diag.provider !== undefined) { parts.push('ai_provider=?'); values.push(diag.provider); }
  if (diag.model !== undefined) { parts.push('ai_model=?'); values.push(diag.model); }
  if (diag.attempt !== undefined) { parts.push('ai_attempt=?'); values.push(diag.attempt); }
  if (diag.responseChars !== undefined) { parts.push('ai_response_chars=?'); values.push(diag.responseChars); }
  if (diag.errorStage !== undefined) { parts.push('ai_error_stage=?'); values.push(diag.errorStage); }
  if (diag.finishReason !== undefined) { parts.push('ai_finish_reason=?'); values.push(diag.finishReason); }
  if (diag.contentChars !== undefined) { parts.push('ai_content_chars=?'); values.push(diag.contentChars); }
  if (diag.reasoningChars !== undefined) { parts.push('ai_reasoning_chars=?'); values.push(diag.reasoningChars); }
  if (diag.responseShape !== undefined) { parts.push('ai_response_shape=?'); values.push(diag.responseShape); }
  if (diag.formatAttempt !== undefined) { parts.push('ai_format_attempt=?'); values.push(diag.formatAttempt); }
  if (diag.repairStatus !== undefined) { parts.push('ai_repair_status=?'); values.push(diag.repairStatus); }
  await db.prepare(`UPDATE resume_processing_jobs SET ${parts.join(', ')} WHERE id=?`)
    .bind(...values, jobId).run();
}

/**
 * Convert jobs that stopped making progress into an explicit terminal state.
 *
 * Queue consumers can be interrupted while an upstream AI request is waiting
 * for a response. D1 then keeps the job as `running`, which blocks the unique
 * active-job index and consumes one of the queue consumer's concurrency slots.
 * This recovery is deliberately conservative: a job is only stale when its
 * heartbeat timestamp is older than the lease, and a valid result already
 * written to the resume is finalized as completed instead of discarded.
 */
export async function recoverStaleResumeProcessingJobs(
  db: Pick<D1Database, 'prepare'>,
  staleAfterMs = STALE_RESUME_JOB_TIMEOUT_MS,
  now = Date.now(),
): Promise<{ recovered: number }> {
  const cutoff = new Date(now - staleAfterMs).toISOString();
  const rows = await db.prepare(
    `SELECT j.id, j.resume_id, r.parse_status, r.ai_evaluation
       FROM resume_processing_jobs j
       LEFT JOIN resumes r ON r.id = j.resume_id
      WHERE j.status='running' AND j.updated_at < ?`,
  ).bind(cutoff).all() as { results?: Array<{ id: string; resume_id: string; parse_status?: string | null; ai_evaluation?: unknown }> };

  let recovered = 0;
  const timestamp = new Date(now).toISOString();
  for (const row of rows.results || []) {
    const hasCompletedResult = row.parse_status === 'ai_screened' && hasValidAiEvaluation(row.ai_evaluation);
    if (hasCompletedResult) {
      const completed = await db.prepare(
        `UPDATE resume_processing_jobs
            SET status='completed', error_code='PROCESSING_RECOVERED',
                error_message='评估结果已写入，任务状态自动收敛', completed_at=?, updated_at=?
          WHERE id=? AND status='running' AND updated_at < ?`,
      ).bind(timestamp, timestamp, row.id, cutoff).run();
      if (completed.meta?.changes) recovered += 1;
      continue;
    }

    const failed = await db.prepare(
      `UPDATE resume_processing_jobs
          SET status='failed', error_code='PROCESSING_STALLED',
              error_message='评估任务超过 10 分钟未更新，已自动停止，可重新评估', completed_at=?, updated_at=?
        WHERE id=? AND status='running' AND updated_at < ?`,
    ).bind(timestamp, timestamp, row.id, cutoff).run();
    if (!failed.meta?.changes) continue;

    await db.prepare(
      `UPDATE resumes
          SET parse_status='failed', parse_error='PROCESSING_STALLED: 评估任务超过 10 分钟未更新，已自动停止，可重新评估', updated_at=?
        WHERE id=? AND parse_status IN ('queued', 'extracting_text', 'extracting_fields', 'screening')`,
    ).bind(timestamp, row.resume_id).run();
    recovered += 1;
  }

  return { recovered };
}
