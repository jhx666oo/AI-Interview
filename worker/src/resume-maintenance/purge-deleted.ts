/**
 * 简历删除后的清理任务
 * 删除 R2 中的 artifacts、搜索文档和相关记录
 */
import { ArtifactRepository } from '../resume-storage/artifact-repository';
import { R2ArtifactStore } from '../resume-storage/r2-artifact-store';

interface PurgeDeps {
  db: D1Database;
  artifactRepo: ArtifactRepository;
  r2Store: R2ArtifactStore;
}

export class PurgeService {
  constructor(private deps: PurgeDeps) {}

  /**
   * 执行单条简历的清理
   */
  async purge(resumeId: string, purgeType: 'normal' | 'privacy' = 'normal'): Promise<{ deletedObjects: number; deletedArtifacts: number }> {
    // 获取所有 artifacts
    const artifacts = await this.deps.artifactRepo.listByResume(resumeId);
    let deletedObjects = 0;
    let deletedArtifacts = 0;

    for (const artifact of artifacts) {
      try {
        await this.deps.r2Store.delete(artifact.objectKey);
        deletedObjects++;
      } catch (e) {
        console.error(`[Purge] Failed to delete R2 object ${artifact.objectKey}:`, e);
      }

      await this.deps.artifactRepo.updateStatus(artifact.id, 'deleted');
      deletedArtifacts++;
    }

    // 更新清理任务状态
    await this.deps.db.prepare(`
      UPDATE resume_purge_jobs SET status = 'completed', completed_at = datetime('now'), updated_at = datetime('now')
      WHERE resume_id = ?
    `).bind(resumeId).run();

    return { deletedObjects, deletedArtifacts };
  }

  /**
   * 查找待处理的清理任务
   */
  async listPendingPurges(limit = 50): Promise<Array<{ id: string; resumeId: string; purgeType: string }>> {
    const rows = await this.deps.db.prepare(`
      SELECT id, resume_id, purge_type FROM resume_purge_jobs
      WHERE status = 'pending' AND not_before <= datetime('now')
      LIMIT ?
    `).bind(limit).all<{ id: string; resume_id: string; purge_type: string }>();
    return rows.results.map(r => ({ id: r.id, resumeId: r.resume_id, purgeType: r.purge_type }));
  }
}
