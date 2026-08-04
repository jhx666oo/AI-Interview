/**
 * R2 Workers Binding 适配器
 * 实现 ResumeArtifactStore 接口，封装对 R2 对象的读写操作
 */
import type { ResumeArtifactStore, PutArtifactInput, StoredArtifactObject } from './types';

export class R2ArtifactStore implements ResumeArtifactStore {
  constructor(private bucket: R2Bucket) {}

  async put(input: PutArtifactInput): Promise<StoredArtifactObject> {
    const headers: Record<string, string> = {
      'content-type': input.contentType,
    };
    if (input.contentSha256) {
      headers['sha256'] = input.contentSha256;
    }
    if (input.expiresAt) {
      headers['expires'] = input.expiresAt;
    }

    const object = await this.bucket.put(input.objectKey, input.content, {
      httpMetadata: { contentType: input.contentType } as any,
      customMetadata: {
        resumeId: input.resumeId,
        type: input.type,
        sha256: input.contentSha256 ?? '',
        version: String(input.version ?? 1),
      },
    });

    return {
      objectKey: input.objectKey,
      version: input.version ?? 1,
      byteSize: object.size,
      contentSha256: input.contentSha256,
    };
  }

  async get(objectKey: string): Promise<R2ObjectBody | null> {
    return this.bucket.get(objectKey);
  }

  async head(objectKey: string): Promise<R2Object | null> {
    return this.bucket.head(objectKey);
  }

  async delete(objectKey: string): Promise<void> {
    await this.bucket.delete(objectKey);
  }
}
