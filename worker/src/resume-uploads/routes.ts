import { Hono } from 'hono';
import { UploadService } from './service';
import { ArtifactRepository } from '../resume-storage/artifact-repository';
import type { InitUploadRequest } from './types';
import { logResumeProcessingError } from '../resume-processing/logging';

interface Env {
  DB: D1Database;
  RESUME_PROCESSING_QUEUE: Queue;
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_BUCKET_NAME?: string;
}

export function createUploadRoutes(app: Hono<{ Bindings: Env }>): void {
  app.post('/api/resumes/uploads/init', async (c) => {
    try {
      const body = await c.req.json<InitUploadRequest>();
      if (!body.originalFilename || !body.fileSize || !body.fileSha256) {
        return c.json({ error: 'Missing required fields: originalFilename, fileSize, fileSha256' }, 400);
      }
      if (body.fileSize > 20 * 1024 * 1024) {
        return c.json({ error: 'File size exceeds 20MB limit' }, 400);
      }

      const userId = 'system'; // 后续从 auth 中间件获取
      const artifactRepo = new ArtifactRepository(c.env.DB);
      const uploadService = new UploadService({
        db: c.env.DB,
        artifactRepo,
        env: {
          R2_ACCOUNT_ID: c.env.R2_ACCOUNT_ID,
          R2_ACCESS_KEY_ID: c.env.R2_ACCESS_KEY_ID,
          R2_SECRET_ACCESS_KEY: c.env.R2_SECRET_ACCESS_KEY,
          R2_BUCKET_NAME: c.env.R2_BUCKET_NAME,
          RESUME_PROCESSING_QUEUE: c.env.RESUME_PROCESSING_QUEUE,
        },
        userId,
      });

      const result = await uploadService.initUpload(body);
      return c.json(result, 201);
    } catch (err) {
      logResumeProcessingError('upload.init.error', err);
      return c.json({ error: 'Failed to initialize upload' }, 500);
    }
  });

  app.post('/api/resumes/uploads/:uploadId/complete', async (c) => {
    try {
      const uploadId = c.req.param('uploadId');
      const artifactRepo = new ArtifactRepository(c.env.DB);
      const uploadService = new UploadService({
        db: c.env.DB,
        artifactRepo,
        env: {
          R2_ACCOUNT_ID: c.env.R2_ACCOUNT_ID,
          R2_ACCESS_KEY_ID: c.env.R2_ACCESS_KEY_ID,
          R2_SECRET_ACCESS_KEY: c.env.R2_SECRET_ACCESS_KEY,
          R2_BUCKET_NAME: c.env.R2_BUCKET_NAME,
          RESUME_PROCESSING_QUEUE: c.env.RESUME_PROCESSING_QUEUE,
        },
        userId: 'system',
      });

      const result = await uploadService.completeUpload(uploadId);
      return c.json(result);
    } catch (err: any) {
      logResumeProcessingError('upload.complete.error', err, { uploadId: c.req.param('uploadId') });
      const status = err.message?.includes('not found') ? 404 : 409;
      return c.json({ error: err.message ?? 'Failed to complete upload' }, status);
    }
  });

  app.post('/api/resumes/uploads/:uploadId/fail', async (c) => {
    try {
      const uploadId = c.req.param('uploadId');
      const { errorCode } = await c.req.json<{ errorCode: string }>();
      const artifactRepo = new ArtifactRepository(c.env.DB);
      const uploadService = new UploadService({
        db: c.env.DB,
        artifactRepo,
        env: {
          R2_ACCOUNT_ID: c.env.R2_ACCOUNT_ID,
          R2_ACCESS_KEY_ID: c.env.R2_ACCESS_KEY_ID,
          R2_SECRET_ACCESS_KEY: c.env.R2_SECRET_ACCESS_KEY,
          R2_BUCKET_NAME: c.env.R2_BUCKET_NAME,
          RESUME_PROCESSING_QUEUE: c.env.RESUME_PROCESSING_QUEUE,
        },
        userId: 'system',
      });

      await uploadService.failUpload(uploadId, errorCode);
      return c.json({ status: 'failed' });
    } catch (err) {
      logResumeProcessingError('upload.fail.error', err, { uploadId: c.req.param('uploadId') });
      return c.json({ error: 'Failed to mark upload as failed' }, 500);
    }
  });
}
