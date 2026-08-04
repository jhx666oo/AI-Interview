import { ArtifactRepository } from '../resume-storage/artifact-repository';
import { R2ArtifactStore } from '../resume-storage/r2-artifact-store';
import { generateObjectKey, generateArtifactId } from '../resume-storage/object-key';
import { parseFeatureFlags } from '../resume-config/flags';
import type { ResumeAnalysisRepository } from '../resume-storage/types';

interface AnalysisRepoDeps {
  db: D1Database;
  artifactRepo: ArtifactRepository;
  r2Store: R2ArtifactStore;
  env: Record<string, string | undefined>;
}

export class AnalysisRepository implements ResumeAnalysisRepository {
  constructor(private deps: AnalysisRepoDeps) {}

  async getCurrent(resumeId: string): Promise<Record<string, unknown> | null> {
    const flags = parseFeatureFlags(this.deps.env);

    if (flags.r2ArtifactRead) {
      const artifact = await this.deps.artifactRepo.getCurrentByType(resumeId, 'ai_analysis');
      if (artifact) {
        const obj = await this.deps.r2Store.get(artifact.objectKey);
        if (obj) {
          const text = await obj.text();
          try { return JSON.parse(text); } catch { /* fall through */ }
        }
      }
    }

    // 降级 D1
    const row = await this.deps.db.prepare(`
      SELECT ai_review, ai_evaluation FROM resumes WHERE id = ?
    `).bind(resumeId).first<any>();
    if (row) {
      try {
        if (row.ai_evaluation) return JSON.parse(row.ai_evaluation);
        if (row.ai_review) return JSON.parse(row.ai_review);
      } catch { /* not valid JSON */ }
    }

    return null;
  }

  async putVersion(input: {
    resumeId: string;
    analysis: Record<string, unknown>;
    model: string;
    promptVersion: string;
    version: number;
  }): Promise<string> {
    const artifactId = generateArtifactId();
    const objectKey = generateObjectKey('ai_analysis', input.resumeId, input.version);
    const json = JSON.stringify(input.analysis);
    const bytes = new TextEncoder().encode(json);

    await this.deps.r2Store.put({
      resumeId: input.resumeId,
      type: 'ai_analysis',
      objectKey,
      contentType: 'application/json',
      content: bytes.buffer,
      byteSize: bytes.length,
      version: input.version,
    });

    await this.deps.artifactRepo.insert({
      id: artifactId,
      resumeId: input.resumeId,
      type: 'ai_analysis',
      objectKey,
      bucket: 'ai-interview-resume-artifacts',
      contentType: 'application/json',
      byteSize: bytes.length,
      version: input.version,
    });

    return artifactId;
  }
}
