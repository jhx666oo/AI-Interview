import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

describe('recruitment event schema', () => {
  it('creates candidate_stage_events with all constraints', async () => {
    const sql = await readFile(resolve(process.cwd(), 'migrations/0017_candidate_stage_events.sql'), 'utf8');
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS candidate_stage_events/);
    expect(sql).toMatch(/dedupe_key TEXT NOT NULL UNIQUE/);
    expect(sql).toContain("'resume_received'");
    expect(sql).toContain("'ai_screened'");
    expect(sql).toContain("'hr_approved'");
    expect(sql).toContain("'hired'");
    expect(sql).toMatch(/idx_candidate_stage_events_resume/);
    expect(sql).toMatch(/idx_candidate_stage_events_occurred/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS recruitment_event_outbox/);
  });
});

describe('funnel query', () => {
  it('exports FunnelQuery class', async () => {
    const mod = await import('../src/recruitment-events/funnel-query');
    expect(mod.FunnelQuery).toBeDefined();
  });

  it('has compute method', async () => {
    const { FunnelQuery } = await import('../src/recruitment-events/funnel-query');
    expect(typeof FunnelQuery.prototype.compute).toBe('function');
  });
});
