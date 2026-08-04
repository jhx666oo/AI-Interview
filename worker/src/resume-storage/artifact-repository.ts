/**
 * 简历 Artifact 的 D1 生命周期操作
 * 只负责 D1 元数据记录，不直接读写 R2
 */
import type { ResumeArtifact, ResumeArtifactStatus, ResumeArtifactType } from './types';

export interface D1ArtifactRow {
  id: string;
  resume_id: string;
  type: string;
  object_key: string;
  bucket: string;
  content_type: string;
  content_sha256: string | null;
  byte_size: number;
  version: number;
  status: string;
  is_current: number;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToArtifact(row: D1ArtifactRow): ResumeArtifact {
  return {
    id: row.id,
    resumeId: row.resume_id,
    type: row.type as ResumeArtifactType,
    objectKey: row.object_key,
    bucket: row.bucket,
    contentType: row.content_type,
    contentSha256: row.content_sha256 ?? undefined,
    byteSize: row.byte_size,
    version: row.version,
    status: row.status as ResumeArtifactStatus,
    isCurrent: row.is_current === 1,
    expiresAt: row.expires_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class ArtifactRepository {
  constructor(private db: D1Database) {}

  async insert(artifact: {
    id: string;
    resumeId: string;
    type: ResumeArtifactType;
    objectKey: string;
    bucket: string;
    contentType: string;
    contentSha256?: string;
    byteSize: number;
    version?: number;
    expiresAt?: string;
  }): Promise<void> {
    const ver = artifact.version ?? 1;
    const stmt = this.db.prepare(`
      INSERT INTO resume_artifacts (id, resume_id, type, object_key, bucket, content_type, content_sha256, byte_size, version, is_current, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    // 新 artifact 创建时设为 is_current=1（同 type 同 resume 旧记录的 is_current 需调用方处理）
    await stmt.bind(
      artifact.id,
      artifact.resumeId,
      artifact.type,
      artifact.objectKey,
      artifact.bucket,
      artifact.contentType,
      artifact.contentSha256 ?? null,
      artifact.byteSize,
      ver,
      1,
      artifact.expiresAt ?? null
    ).run();
  }

  async setCurrent(artifactIds: string[], resumeId: string, type: ResumeArtifactType): Promise<void> {
    // 先清除该 resume+type 的所有 current 标记，再设置新 ID
    const clearStmt = this.db.prepare(`
      UPDATE resume_artifacts SET is_current = 0, updated_at = datetime('now')
      WHERE resume_id = ? AND type = ? AND is_current = 1
    `);
    await clearStmt.bind(resumeId, type).run();

    if (artifactIds.length > 0) {
      const placeholders = artifactIds.map(() => '?').join(',');
      const setStmt = this.db.prepare(`
        UPDATE resume_artifacts SET is_current = 1, updated_at = datetime('now')
        WHERE id IN (${placeholders})
      `);
      await setStmt.bind(...artifactIds).run();
    }
  }

  async updateStatus(id: string, status: ResumeArtifactStatus): Promise<void> {
    const stmt = this.db.prepare(`
      UPDATE resume_artifacts SET status = ?, updated_at = datetime('now') WHERE id = ?
    `);
    await stmt.bind(status, id).run();
  }

  async getCurrentByType(resumeId: string, type: ResumeArtifactType): Promise<ResumeArtifact | null> {
    const result = await this.db.prepare(`
      SELECT * FROM resume_artifacts
      WHERE resume_id = ? AND type = ? AND is_current = 1
      LIMIT 1
    `).bind(resumeId, type).first<D1ArtifactRow>();
    return result ? rowToArtifact(result) : null;
  }

  async listByResume(resumeId: string): Promise<ResumeArtifact[]> {
    const result = await this.db.prepare(`
      SELECT * FROM resume_artifacts WHERE resume_id = ? ORDER BY version DESC
    `).bind(resumeId).all<D1ArtifactRow>();
    return result.results.map(rowToArtifact);
  }

  async listByTypeAndStatus(type: ResumeArtifactType, status: ResumeArtifactStatus, limit = 100): Promise<ResumeArtifact[]> {
    const result = await this.db.prepare(`
      SELECT * FROM resume_artifacts WHERE type = ? AND status = ? LIMIT ?
    `).bind(type, status, limit).all<D1ArtifactRow>();
    return result.results.map(rowToArtifact);
  }

  async getById(id: string): Promise<ResumeArtifact | null> {
    const result = await this.db.prepare(`
      SELECT * FROM resume_artifacts WHERE id = ?
    `).bind(id).first<D1ArtifactRow>();
    return result ? rowToArtifact(result) : null;
  }
}
