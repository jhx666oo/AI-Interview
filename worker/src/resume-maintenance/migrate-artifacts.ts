/**
 * 历史数据迁移：将 D1 中现存的长文本（Base64 PDF、OCR、AI 分析）迁至 R2
 * 逐批迁移，可暂停、可重试，不影响线上
 */
import { ArtifactRepository } from '../resume-storage/artifact-repository';
import { R2ArtifactStore } from '../resume-storage/r2-artifact-store';
import { generateObjectKey, generateArtifactId } from '../resume-storage/object-key';

interface MigrateDeps {
  db: D1Database;
  artifactRepo: ArtifactRepository;
  r2Store: R2ArtifactStore;
}

export class ArtifactMigrationService {
  constructor(private deps: MigrateDeps) {}

  /**
   * 迁移单条简历的遗留数据
   * 返回迁移的列名列表，空表示无数据可迁移
   */
  async migrateOne(resumeId: string): Promise<string[]> {
    const row = await this.deps.db.prepare(`
      SELECT id, ocr_markdown, raw_text, resume_markdown, ai_review, ai_evaluation
      FROM resumes WHERE id = ?
    `).bind(resumeId).first<any>();

    if (!row) return [];

    const migrated: string[] = [];

    // 迁移 OCR 文本
    const ocrText = row.ocr_markdown ?? row.resume_markdown ?? row.raw_text;
    if (ocrText && typeof ocrText === 'string' && ocrText.length > 0) {
      const artifactId = generateArtifactId();
      const objectKey = generateObjectKey('ocr', resumeId, 1);
      const bytes = new TextEncoder().encode(ocrText);

      await this.deps.r2Store.put({
        resumeId,
        type: 'ocr',
        objectKey,
        contentType: 'text/markdown; charset=utf-8',
        content: bytes.buffer,
        byteSize: bytes.length,
        version: 1,
      });

      await this.deps.artifactRepo.insert({
        id: artifactId,
        resumeId,
        type: 'ocr',
        objectKey,
        bucket: 'ai-interview-resume-artifacts',
        contentType: 'text/markdown; charset=utf-8',
        byteSize: bytes.length,
        version: 1,
      });

      migrated.push('ocr');
    }

    // 迁移 AI 分析
    const aiData = row.ai_evaluation ?? row.ai_review;
    if (aiData) {
      const jsonStr = typeof aiData === 'string' ? aiData : JSON.stringify(aiData);
      if (jsonStr.length > 0) {
        const artifactId = generateArtifactId();
        const objectKey = generateObjectKey('ai_analysis', resumeId, 1);
        const bytes = new TextEncoder().encode(jsonStr);

        await this.deps.r2Store.put({
          resumeId,
          type: 'ai_analysis',
          objectKey,
          contentType: 'application/json',
          content: bytes.buffer,
          byteSize: bytes.length,
          version: 1,
        });

        await this.deps.artifactRepo.insert({
          id: artifactId,
          resumeId,
          type: 'ai_analysis',
          objectKey,
          bucket: 'ai-interview-resume-artifacts',
          contentType: 'application/json',
          byteSize: bytes.length,
          version: 1,
        });

        migrated.push('ai_analysis');
      }
    }

    // 更新迁移状态
    if (migrated.length > 0) {
      await this.deps.db.prepare(`
        INSERT OR REPLACE INTO resume_migration_state (resume_id, source_columns, status, attempt_count, last_attempt_at)
        VALUES (?, ?, 'verified', 1, datetime('now'))
      `).bind(resumeId, JSON.stringify(migrated)).run();
    }

    return migrated;
  }

  /**
   * 获取待迁移的简历列表
   */
  async listPending(limit = 50): Promise<string[]> {
    const rows = await this.deps.db.prepare(`
      SELECT r.id FROM resumes r
      LEFT JOIN resume_migration_state m ON r.id = m.resume_id
      WHERE m.status IS NULL OR m.status IN ('pending', 'failed')
      AND (r.ocr_markdown IS NOT NULL OR r.raw_text IS NOT NULL OR r.ai_evaluation IS NOT NULL)
      LIMIT ?
    `).bind(limit).all<{ id: string }>();
    return rows.results.map(r => r.id);
  }

  /**
   * 获取迁移状态统计
   */
  async getStats(): Promise<{ total: number; pending: number; verified: number; failed: number }> {
    const total = await this.deps.db.prepare(`
      SELECT COUNT(*) as count FROM resumes
      WHERE ocr_markdown IS NOT NULL OR raw_text IS NOT NULL OR ai_evaluation IS NOT NULL
    `).first<{ count: number }>();

    const pending = await this.deps.db.prepare(`
      SELECT COUNT(*) as count FROM resume_migration_state WHERE status = 'pending'
    `).first<{ count: number }>();

    const verified = await this.deps.db.prepare(`
      SELECT COUNT(*) as count FROM resume_migration_state WHERE status = 'verified'
    `).first<{ count: number }>();

    const failed = await this.deps.db.prepare(`
      SELECT COUNT(*) as count FROM resume_migration_state WHERE status = 'failed'
    `).first<{ count: number }>();

    return {
      total: total?.count ?? 0,
      pending: pending?.count ?? 0,
      verified: verified?.count ?? 0,
      failed: failed?.count ?? 0,
    };
  }
}
