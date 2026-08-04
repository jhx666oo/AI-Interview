import { Hono } from 'hono';
import { ArtifactRepository } from '../resume-storage/artifact-repository';
import { R2ArtifactStore } from '../resume-storage/r2-artifact-store';
import { ArtifactMigrationService } from './migrate-artifacts';

interface Env {
  DB: D1Database;
  RESUME_ARTIFACTS: R2Bucket;
}

export function createMaintenanceRoutes(app: Hono<{ Bindings: Env }>): void {
  const migrationRoutes = new Hono();

  // 查看迁移状态
  migrationRoutes.get('/status', async (c) => {
    const artifactRepo = new ArtifactRepository(c.env.DB);
    const r2Store = new R2ArtifactStore(c.env.RESUME_ARTIFACTS);
    const migrationService = new ArtifactMigrationService({
      db: c.env.DB,
      artifactRepo,
      r2Store,
    });
    const stats = await migrationService.getStats();
    return c.json(stats);
  });

  // 开始迁移（逐批处理）
  migrationRoutes.post('/start', async (c) => {
    const { batchSize = 10 } = await c.req.json().catch(() => ({}));
    const artifactRepo = new ArtifactRepository(c.env.DB);
    const r2Store = new R2ArtifactStore(c.env.RESUME_ARTIFACTS);
    const migrationService = new ArtifactMigrationService({
      db: c.env.DB,
      artifactRepo,
      r2Store,
    });

    const pending = await migrationService.listPending(batchSize);
    const results: Array<{ resumeId: string; migrated: string[] }> = [];

    for (const resumeId of pending) {
      const migrated = await migrationService.migrateOne(resumeId);
      results.push({ resumeId, migrated });
    }

    return c.json({ processed: results.length, results });
  });

  // 迁移单条
  migrationRoutes.post('/migrate/:resumeId', async (c) => {
    const resumeId = c.req.param('resumeId');
    const artifactRepo = new ArtifactRepository(c.env.DB);
    const r2Store = new R2ArtifactStore(c.env.RESUME_ARTIFACTS);
    const migrationService = new ArtifactMigrationService({
      db: c.env.DB,
      artifactRepo,
      r2Store,
    });

    const migrated = await migrationService.migrateOne(resumeId);
    return c.json({ resumeId, migrated });
  });

  app.route('/api/admin/resume-migration', migrationRoutes);
}
