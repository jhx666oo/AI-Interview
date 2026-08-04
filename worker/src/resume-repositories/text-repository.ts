import { ArtifactRepository } from '../resume-storage/artifact-repository';
import { R2ArtifactStore } from '../resume-storage/r2-artifact-store';
import { generateObjectKey, generateArtifactId } from '../resume-storage/object-key';
import { parseFeatureFlags } from '../resume-config/flags';
import type { ResumeTextRepository } from '../resume-storage/types';

interface TextRepoDeps {
  db: D1Database;
  artifactRepo: ArtifactRepository;
  r2Store: R2ArtifactStore;
  env: Record<string, string | undefined>;
}

export class TextRepository implements ResumeTextRepository {
  constructor(private deps: TextRepoDeps) {}

  async getCurrent(resumeId: string): Promise<{ text: string; artifactId?: string; source: 'r2' | 'legacy_d1' } | null> {
    const flags = parseFeatureFlags(this.deps.env);

    // 优先从 R2 读取
    if (flags.r2ArtifactRead) {
      const artifact = await this.deps.artifactRepo.getCurrentByType(resumeId, 'ocr');
      if (artifact) {
        const obj = await this.deps.r2Store.get(artifact.objectKey);
        if (obj) {
          const text = await obj.text();
          return { text, artifactId: artifact.id, source: 'r2' };
        }
      }
    }

    // 降级到 D1 旧列
    const row = await this.deps.db.prepare(`
      SELECT ocr_markdown, raw_text, resume_markdown FROM resumes WHERE id = ?
    `).bind(resumeId).first<any>();
    if (row) {
      const text = row.ocr_markdown ?? row.resume_markdown ?? row.raw_text;
      if (text) return { text, source: 'legacy_d1' };
    }

    return null;
  }

  async putVersion(input: { resumeId: string; text: string; source: string; version: number }): Promise<string> {
    const artifactId = generateArtifactId();
    const objectKey = generateObjectKey('ocr', input.resumeId, input.version);

    // 写入 R2
    await this.deps.r2Store.put({
      resumeId: input.resumeId,
      type: 'ocr',
      objectKey,
      contentType: 'text/markdown; charset=utf-8',
      content: new TextEncoder().encode(input.text).buffer,
      byteSize: new TextEncoder().encode(input.text).length,
      version: input.version,
    });

    // 写入 D1 artifact 记录
    await this.deps.artifactRepo.insert({
      id: artifactId,
      resumeId: input.resumeId,
      type: 'ocr',
      objectKey,
      bucket: 'ai-interview-resume-artifacts',
      contentType: 'text/markdown; charset=utf-8',
      byteSize: new TextEncoder().encode(input.text).length,
      version: input.version,
    });

    return artifactId;
  }
}
