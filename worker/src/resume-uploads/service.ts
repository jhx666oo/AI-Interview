import { generateArtifactId, generateObjectKey } from '../resume-storage/object-key';
import { ArtifactRepository } from '../resume-storage/artifact-repository';
import { generatePresignedPutUrl } from './presigner';
import type { InitUploadRequest, InitUploadResponse, CompleteUploadResponse } from './types';
import { logResumeProcessing, logResumeProcessingError } from '../resume-processing/logging';
import { buildResumeIngestionIdentity } from '../recruiting-operations/resume-ingestion';

interface UploadServiceDeps {
  db: D1Database;
  artifactRepo: ArtifactRepository;
  env: {
    R2_ACCOUNT_ID: string;
    R2_ACCESS_KEY_ID: string;
    R2_SECRET_ACCESS_KEY: string;
    R2_BUCKET_NAME?: string;
    RESUME_PROCESSING_QUEUE: Queue;
  };
  userId: string;
}

export class UploadService {
  constructor(private deps: UploadServiceDeps) {}

  async initUpload(req: InitUploadRequest): Promise<InitUploadResponse> {
    const startedAt = Date.now();
    const resumeId = `res_${crypto.randomUUID()}`;
    const pdfArtifactId = generateArtifactId();
    const pdfObjectKey = generateObjectKey('pdf', resumeId, 1);
    const ingestion = buildResumeIngestionIdentity({ source: 'local_upload', fileSha256: req.fileSha256, receivedAt: new Date().toISOString() });
    logResumeProcessing('upload.init.start', {
      resumeId,
      fileNameLength: req.originalFilename.length,
      fileSize: req.fileSize,
    });

    // 创建简历记录
    await this.deps.db.prepare(`
      INSERT INTO resumes (id, candidate_name, status, file_sha256, resume_received_at, resume_source, resume_source_record_id, resume_ingest_key, created_at, updated_at)
      VALUES (?, ?, 'pending_upload', ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).bind(resumeId, req.originalFilename, req.fileSha256, ingestion.receivedAt, ingestion.source, ingestion.sourceRecordId, ingestion.ingestKey).run();

    // 创建 artifact 记录
    await this.deps.artifactRepo.insert({
      id: pdfArtifactId,
      resumeId,
      type: 'pdf',
      objectKey: pdfObjectKey,
      bucket: this.deps.env.R2_BUCKET_NAME ?? 'ai-interview-resume-artifacts',
      contentType: 'application/pdf',
      contentSha256: req.fileSha256,
      byteSize: req.fileSize,
      version: 1,
    });

    // 生成 presigned URL
    const presignedUrl = await generatePresignedPutUrl({
      accountId: this.deps.env.R2_ACCOUNT_ID,
      bucketName: this.deps.env.R2_BUCKET_NAME ?? 'ai-interview-resume-artifacts',
      objectKey: pdfObjectKey,
      accessKeyId: this.deps.env.R2_ACCESS_KEY_ID,
      secretAccessKey: this.deps.env.R2_SECRET_ACCESS_KEY,
      contentType: 'application/pdf',
      sha256: req.fileSha256,
    });

    // 创建上传会话
    const uploadId = `upload_${crypto.randomUUID()}`;
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await this.deps.db.prepare(`
      INSERT INTO resume_upload_sessions (id, resume_id, pdf_artifact_id, created_by, original_filename, expected_pdf_size, expected_pdf_sha256, status, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'initiated', ?)
    `).bind(uploadId, resumeId, pdfArtifactId, this.deps.userId, req.originalFilename, req.fileSize, req.fileSha256, expiresAt).run();

    logResumeProcessing('upload.init.ok', { resumeId, uploadId, durationMs: Date.now() - startedAt });
    return {
      uploadId,
      resumeId,
      presignedUrl,
      pdfObjectKey,
      expiresInSeconds: 600,
    };
  }

  async completeUpload(uploadId: string): Promise<CompleteUploadResponse> {
    const startedAt = Date.now();
    logResumeProcessing('upload.complete.start', { uploadId });
    // 获取上传会话
    const session = await this.deps.db.prepare(`
      SELECT * FROM resume_upload_sessions WHERE id = ?
    `).bind(uploadId).first<any>();

    if (!session) throw new Error('Upload session not found');
    if (session.status !== 'initiated') throw new Error(`Upload already ${session.status}`);

    // 生成 job ID
    const jobId = `job_${crypto.randomUUID()}`;

    // 更新会话状态
    await this.deps.db.prepare(`
      UPDATE resume_upload_sessions SET status = 'completed', job_id = ?, completed_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
    `).bind(jobId, uploadId).run();

    // 更新 artifact 状态为 available
    await this.deps.artifactRepo.updateStatus(session.pdf_artifact_id, 'available');

    // 更新简历状态
    await this.deps.db.prepare(`
      UPDATE resumes SET status = 'pending_screening', updated_at = datetime('now') WHERE id = ?
    `).bind(session.resume_id).run();

    // 入队处理
    logResumeProcessing('upload.queue_send.start', { uploadId, resumeId: session.resume_id, jobId });
    const queueStartedAt = Date.now();
    try {
      await this.deps.env.RESUME_PROCESSING_QUEUE.send({
        jobId,
        resumeId: session.resume_id,
      });
    } catch (error) {
      logResumeProcessingError('upload.queue_send.error', error, {
        uploadId,
        resumeId: session.resume_id,
        jobId,
        durationMs: Date.now() - queueStartedAt,
      });
      throw error;
    }
    logResumeProcessing('upload.queue_send.ok', {
      uploadId,
      resumeId: session.resume_id,
      jobId,
      durationMs: Date.now() - queueStartedAt,
      totalDurationMs: Date.now() - startedAt,
    });

    return {
      resumeId: session.resume_id,
      jobId,
      status: 'completed',
    };
  }

  async failUpload(uploadId: string, errorCode: string): Promise<void> {
    logResumeProcessing('upload.fail', { uploadId, errorCode });
    await this.deps.db.prepare(`
      UPDATE resume_upload_sessions SET status = 'failed', error_code = ?, updated_at = datetime('now') WHERE id = ?
    `).bind(errorCode, uploadId).run();
  }

  async expireAbandoned(): Promise<number> {
    const result = await this.deps.db.prepare(`
      UPDATE resume_upload_sessions SET status = 'expired', updated_at = datetime('now')
      WHERE status = 'initiated' AND expires_at < datetime('now')
    `).run();
    return result.meta.changes ?? 0;
  }
}
