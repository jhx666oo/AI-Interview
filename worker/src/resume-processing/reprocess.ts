import { ensureResumeProcessingJobsSchema, isMissingResumeProcessingJobsError } from './job-repository';
import type { ResumeQueueMessage } from './types';
import { logResumeProcessing, logResumeProcessingError } from './logging';

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
