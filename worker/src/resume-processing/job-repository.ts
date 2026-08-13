import type { ResumeProcessingJob } from './types';

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
  await db.prepare(`UPDATE resume_processing_jobs SET ${parts.join(', ')} WHERE id=?`)
    .bind(...values, jobId).run();
}
