import { createOrGetActiveJob } from './job-repository';
import type { ResumeQueueMessage } from './types';

type ReprocessDb = Pick<D1Database, 'prepare'>;
type ReprocessQueue = { send(message: ResumeQueueMessage): Promise<unknown> };

export class ResumeNotFoundError extends Error {
  constructor(public readonly resumeId: string) {
    super(`RESUME_NOT_FOUND:${resumeId}`);
  }
}

export async function resetResumeForReprocess(db: ReprocessDb, resumeId: string): Promise<void> {
  const timestamp = new Date().toISOString();
  await db.prepare(
    `UPDATE resumes SET
       parsed_data=NULL,
       ai_review=NULL,
       ai_evaluation=NULL,
       match_score=NULL,
       screening_result=NULL,
       hard_requirement_result=NULL,
       parse_status='queued',
       parse_error=NULL,
       updated_at=?
     WHERE id=?`,
  ).bind(timestamp, resumeId).run();
}

export async function enqueueResumeReprocess(
  db: ReprocessDb,
  queue: ReprocessQueue,
  resumeId: string,
): Promise<{ jobId: string; status: 'queued' | 'running'; queued: boolean }> {
  const resume = await db.prepare('SELECT id FROM resumes WHERE id=?').bind(resumeId).first();
  if (!resume) throw new ResumeNotFoundError(resumeId);

  const activeJob = await db.prepare(
    "SELECT * FROM resume_processing_jobs WHERE resume_id=? AND status IN ('queued', 'running') ORDER BY created_at DESC LIMIT 1",
  ).bind(resumeId).first() as any;
  if (activeJob) {
    return { jobId: activeJob.id, status: activeJob.status, queued: false };
  }

  let job = await db.prepare(
    "SELECT * FROM resume_processing_jobs WHERE resume_id=? AND status='failed' ORDER BY updated_at DESC LIMIT 1",
  ).bind(resumeId).first() as any;

  if (job) {
    const timestamp = new Date().toISOString();
    await db.prepare(
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
    job = { ...job, status: 'queued' };
  } else {
    job = await createOrGetActiveJob(db as D1Database, resumeId);
  }

  await resetResumeForReprocess(db, resumeId);
  await queue.send({ jobId: job.id, resumeId });
  return { jobId: job.id, status: 'queued', queued: true };
}
