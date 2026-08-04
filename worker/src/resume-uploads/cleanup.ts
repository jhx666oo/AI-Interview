import { UploadService } from './service';
import { ArtifactRepository } from '../resume-storage/artifact-repository';

export async function cleanupAbandonedUploads(env: {
  DB: D1Database;
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_BUCKET_NAME?: string;
  RESUME_PROCESSING_QUEUE: Queue;
}): Promise<number> {
  const artifactRepo = new ArtifactRepository(env.DB);
  const uploadService = new UploadService({
    db: env.DB,
    artifactRepo,
    env: {
      R2_ACCOUNT_ID: env.R2_ACCOUNT_ID,
      R2_ACCESS_KEY_ID: env.R2_ACCESS_KEY_ID,
      R2_SECRET_ACCESS_KEY: env.R2_SECRET_ACCESS_KEY,
      R2_BUCKET_NAME: env.R2_BUCKET_NAME,
      RESUME_PROCESSING_QUEUE: env.RESUME_PROCESSING_QUEUE,
    },
    userId: 'system',
  });

  return uploadService.expireAbandoned();
}
