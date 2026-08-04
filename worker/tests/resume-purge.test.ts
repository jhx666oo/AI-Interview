import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

describe('resume purge jobs schema', () => {
  it('creates resume_purge_jobs with correct constraints', async () => {
    const sql = await readFile(resolve(process.cwd(), 'migrations/0020_resume_purge_jobs.sql'), 'utf8');
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS resume_purge_jobs/);
    expect(sql).toMatch(/purge_type.*IN \('normal','privacy'\)/);
    expect(sql).toMatch(/not_before TEXT NOT NULL/);
    expect(sql).toMatch(/idx_resume_purge_jobs_status/);
    expect(sql).toMatch(/idx_resume_purge_jobs_not_before/);
  });
});

describe('purge service', () => {
  it('exports PurgeService', async () => {
    const mod = await import('../src/resume-maintenance/purge-deleted');
    expect(mod.PurgeService).toBeDefined();
  });

  it('has expected methods', async () => {
    const { PurgeService } = await import('../src/resume-maintenance/purge-deleted');
    const proto = PurgeService.prototype;
    expect(typeof proto.purge).toBe('function');
    expect(typeof proto.listPendingPurges).toBe('function');
  });
});

describe('maintenance routes', () => {
  it('exports createMaintenanceRoutes', async () => {
    const mod = await import('../src/resume-maintenance/routes');
    expect(typeof mod.createMaintenanceRoutes).toBe('function');
  });
});
