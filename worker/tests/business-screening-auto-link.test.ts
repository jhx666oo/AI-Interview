import { describe, expect, it } from 'vitest';
import { syncAiResultToBusinessScreening, type BusinessScreeningAutoLinkDeps } from '../src/business-screening/auto-link';
import { createScopePublicToken } from '../src/business-screening/token';

/**
 * AI 初筛自动联动业务筛选：通过→自动推送、不通过→自动移除、无结果→跳过。
 * push 路径复用 pushResumesToBusinessScreening（已在路由测试中覆盖），
 * 这里聚焦 remove / skip 分支与 resume 读取。
 */

function makeDb(resume: any) {
  return {
    prepare(sql: string) {
      return {
        bind(...values: any[]) {
          return {
            async first() {
              if (sql.includes('SELECT id, screening_result')) {
                return resume?.id === values[0] ? { ...resume } : null;
              }
              return null;
            },
            async all() {
              return { results: [] };
            },
            async run() {
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  } as any;
}

function makeDeps(removedIds: string[]): BusinessScreeningAutoLinkDeps {
  return {
    now: () => '2026-08-20T00:00:00.000Z',
    uuid: () => 'auto-link-uuid',
    createScopePublicToken,
    store: {
      async removeResumeFromBusinessScreeningBatches(_db: any, resumeId: string) {
        removedIds.push(resumeId);
        return { removed: 1 };
      },
    } as any,
  };
}

describe('syncAiResultToBusinessScreening', () => {
  it('不通过 → 自动从业务链接移除并重置推送状态', async () => {
    const removedIds: string[] = [];
    const db = makeDb({
      id: 'r1',
      screening_result: '不通过',
      hr_disposition: 'pushed',
      business_screening_status: 'pending',
      status: 'pending_review',
    });
    const result = await syncAiResultToBusinessScreening(db, makeDeps(removedIds), 'r1');
    expect(result.action).toBe('remove');
    expect(removedIds).toEqual(['r1']);
  });

  it('无 screening_result（仅解析任务）→ 跳过，不触发任何联动', async () => {
    const removedIds: string[] = [];
    const db = makeDb({
      id: 'r2',
      screening_result: '',
      hr_disposition: 'pending',
      business_screening_status: 'not_ready',
      status: 'pending_screening',
    });
    const result = await syncAiResultToBusinessScreening(db, makeDeps(removedIds), 'r2');
    expect(result.action).toBe('skip');
    expect(removedIds).toEqual([]);
  });

  it('简历不存在 → 跳过', async () => {
    const removedIds: string[] = [];
    const db = makeDb(null);
    const result = await syncAiResultToBusinessScreening(db, makeDeps(removedIds), 'missing');
    expect(result.action).toBe('skip');
    expect(removedIds).toEqual([]);
  });
});
