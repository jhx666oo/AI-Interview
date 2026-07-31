import type { ResumeProcessingJob } from './types';

export async function createOrGetActiveJob(
  db: D1Database,
  resumeId: string,
): Promise<ResumeProcessingJob> {
  const timestamp = new Date().toISOString();
  await db
    .prepare(
      `INSERT OR IGNORE INTO resume_processing_jobs
         (id, resume_id, status, step, created_at, updated_at)
       VALUES (?, ?, 'queued', 'extracting_text', ?, ?)`,
    )
    .bind(crypto.randomUUID(), resumeId, timestamp, timestamp)
    .run();

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
