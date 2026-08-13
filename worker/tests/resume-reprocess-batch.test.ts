import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import {
  hasValidAiEvaluation,
} from '../src/resume-processing/types';
import { cancelReprocessBatch } from '../src/resume-processing/batch-repository';

describe('hasValidAiEvaluation', () => {
  it('rejects null and undefined', () => {
    expect(hasValidAiEvaluation(null)).toBe(false);
    expect(hasValidAiEvaluation(undefined)).toBe(false);
  });

  it('rejects arrays', () => {
    expect(hasValidAiEvaluation([])).toBe(false);
    expect(hasValidAiEvaluation([1, 2])).toBe(false);
  });

  it('rejects empty objects', () => {
    expect(hasValidAiEvaluation({})).toBe(false);
    expect(hasValidAiEvaluation({ foo: 'bar' })).toBe(false);
  });

  it('accepts a complete seven-dimension evaluation', () => {
    expect(hasValidAiEvaluation({ dimensions: [
      '核心画像', '核心职责', '任职要求', '企业背景', '加分项', '关键词匹配', '避坑雷区',
    ].map((name) => ({ name, score: 4 })) })).toBe(true);
  });

  it('rejects incomplete dimension results even when the dimensions array is non-empty', () => {
    expect(hasValidAiEvaluation({ dimensions: [{ name: '核心画像', score: 4 }] })).toBe(false);
  });

  it('accepts objects with non-empty summary', () => {
    expect(hasValidAiEvaluation({ summary: '好候选人' })).toBe(true);
  });

  it('accepts objects with weighted_score', () => {
    expect(hasValidAiEvaluation({ weighted_score: 42 })).toBe(true);
  });

  it('rejects objects with empty summary', () => {
    expect(hasValidAiEvaluation({ summary: '' })).toBe(false);
  });

  it('parses valid JSON strings', () => {
    expect(hasValidAiEvaluation(JSON.stringify({ summary: 'ok' }))).toBe(true);
  });

  it('rejects malformed JSON strings', () => {
    expect(hasValidAiEvaluation('{ invalid')).toBe(false);
  });
});

describe('cancelReprocessBatch', () => {
  it('cancels both queued and running jobs and skips active items', async () => {
    const db = createCancelDb('b1', 'owner-1');
    const ok = await cancelReprocessBatch(db as never, 'b1', 'owner-1');
    expect(ok).toBe(true);

    const jobUpdate = db.calls.find((sql: string) => sql.includes('UPDATE resume_processing_jobs') && sql.includes('status='));
    expect(jobUpdate).toBeDefined();
    expect(jobUpdate).not.toContain("WHERE status='queued'");
    expect(jobUpdate).toContain("status IN ('queued', 'running')");

    const itemUpdate = db.calls.find((sql: string) => sql.includes('UPDATE resume_reprocess_batch_items'));
    expect(itemUpdate).toBeDefined();
    expect(itemUpdate).toContain("status IN ('pending', 'queued', 'running')");
  });

  it('refuses to cancel another owner batch', async () => {
    const db = createCancelDb('b1', 'owner-1');
    const ok = await cancelReprocessBatch(db as never, 'b1', 'other-owner');
    expect(ok).toBe(false);
  });
});

function createCancelDb(batchId: string, owner: string | null) {
  const calls: string[] = [];
  return {
    calls,
    prepare(sql: string) {
      return {
        bind(..._values: unknown[]) {
          return {
            async first() {
              if (sql.includes('FROM resume_reprocess_batches')) {
                return { id: batchId, owner, status: 'running' };
              }
              return null;
            },
            async run() {
              calls.push(sql);
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };
}
