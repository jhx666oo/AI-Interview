import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

describe('resume migration state schema', () => {
  it('creates resume_migration_state with correct constraints', async () => {
    const sql = await readFile(resolve(process.cwd(), 'migrations/0018_resume_migration_state.sql'), 'utf8');
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS resume_migration_state/);
    expect(sql).toMatch(/status.*IN \('pending','migrating','verified','failed','cleaned'\)/);
    expect(sql).toMatch(/idx_resume_migration_status/);
  });
});

describe('artifact migration service', () => {
  it('exports ArtifactMigrationService', async () => {
    const mod = await import('../src/resume-maintenance/migrate-artifacts');
    expect(mod.ArtifactMigrationService).toBeDefined();
  });

  it('has expected methods', async () => {
    const { ArtifactMigrationService } = await import('../src/resume-maintenance/migrate-artifacts');
    const proto = ArtifactMigrationService.prototype;
    expect(typeof proto.migrateOne).toBe('function');
    expect(typeof proto.listPending).toBe('function');
    expect(typeof proto.getStats).toBe('function');
  });
});
