import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildScreeningQueuePersistence } from '../src/resume-processing/screening-queue-evaluation';

const configured = [
  { name: '核心画像', weight: 25 }, { name: '核心职责', weight: 22 },
  { name: '任职要求', weight: 22 }, { name: '企业背景', weight: 13 },
  { name: '关键词匹配', weight: 0 }, { name: '加分项', weight: 10 },
  { name: '避坑雷区', weight: 0 },
];

describe('resume screening queue evaluation', () => {
  it('ignores the model verdict and persists a failed gate as the canonical binary result', () => {
    const result = buildScreeningQueuePersistence({
      ai_result: '通过',
      match_score: 5,
      dimensions: configured.map(({ name }) => ({ name, score: name === '关键词匹配' ? 1 : 5, reason: '评分依据' })),
    }, configured);

    expect(result.ai_result).toBe('不通过');
    expect(result.screening_result).toBe('不通过');
    expect(result.weighted_score).toBeNull();
    expect(result.match_score).toBeNull();
    expect(result.screening_reason).toContain('关键词');
    expect(JSON.parse(result.gate_results).keyword_match).toEqual({ score: 1, passed: false });
    expect(JSON.parse(result.ai_analysis).dimensions).toHaveLength(7);
  });

  it('persists the evaluator five-point score instead of a legacy model score', () => {
    const result = buildScreeningQueuePersistence({
      ai_result: '不通过',
      match_score: 62,
      dimensions: configured.map(({ name }) => ({ name, score: 5, reason: '评分依据' })),
    }, configured);

    expect(result.ai_result).toBe('通过');
    expect(result.weighted_score).toBe(5);
    expect(result.match_score).toBe(5);
    expect(result.screening_reason).toContain('3.5 分');
  });

  it('routes both screening endpoints through the structured evaluator contract', async () => {
    const source = await readFile(resolve(process.cwd(), 'src/index.ts'), 'utf8');
    const singleRoute = source.slice(source.indexOf("app.post('/api/resume-screening/:id/ai-analyze'"), source.indexOf("app.post('/api/resume-screening/:id/approve'"));
    const batchRoute = source.slice(source.indexOf("app.post('/api/resume-screening/batch-analyze'"), source.indexOf("app.post('/api/resume-screening/from-resume'"));
    expect(singleRoute).toContain('analyzeResumeScreeningRecord(c.env, record)');
    expect(batchRoute).toContain('analyzeResumeScreeningRecord(c.env, rec)');
    expect(singleRoute + batchRoute).not.toContain('scoreMatch');
    expect(singleRoute + batchRoute).not.toContain('resultMatch');
  });

  it('migrates the screening queue and persisted coordinator fields', async () => {
    const sql = await readFile(resolve(process.cwd(), 'migrations/0022_weighted_screening_reprocess.sql'), 'utf8');
    for (const field of ['weighted_score', 'screening_result', 'screening_reason', 'gate_results']) {
      expect(sql).toContain(`ADD COLUMN ${field}`);
    }
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS resume_reprocess_batches');
    expect(sql).toContain('cursor TEXT');
  });
});
