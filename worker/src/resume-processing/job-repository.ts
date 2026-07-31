import type { ResumeProcessingJob } from './types';

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
