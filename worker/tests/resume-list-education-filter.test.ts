import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { handleOptimizedResumeList } from '../src/resume-list/optimized-handler';

const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');

function makeContext(query: Record<string, string>) {
  const captured: { sql: string; params: unknown[] }[] = [];
  const db = {
    prepare(sql: string) {
      return {
        all: async () => ({ results: [] }),
        first: async () => ({ total: 0 }),
        run: async () => ({ meta: { changes: 0 } }),
        bind: (...params: unknown[]) => {
          captured.push({ sql, params });
          return {
            all: async () => ({ results: [] }),
            first: async () => (sql.includes('COUNT') ? { total: 0 } : null),
          };
        },
      };
    },
  };
  return {
    req: { query: (name: string) => query[name] },
    env: { DB: db },
    get: () => null,
    json: (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } }),
    captured,
  };
}

describe('resume list education_min filter', () => {
  it('inline handler builds an education_min level filter', () => {
    expect(source).toContain("c.req.query('education_min')");
    expect(source).toContain('educationLevel(i.education) >= minLevel');
  });

  it('optimized handler applies education_min as a SQL level comparison', async () => {
    const ctx = makeContext({ education_min: '本科', page: '1', page_size: '20' });
    await handleOptimizedResumeList(ctx as any);
    const main = ctx.captured.find((c) => c.sql.includes('FROM resumes'));
    expect(main).toBeTruthy();
    expect(main!.sql).toContain("LIKE '%博士%'");
    expect(main!.sql).toContain("LIKE '%大专%'");
    expect(main!.sql).toContain('>= ?');
    expect(main!.params).toContain(5); // 本科 = level 5，本科及以上 → >= 5
  });

  it('optimized handler ignores invalid education_min values', async () => {
    const ctx = makeContext({ education_min: '不存在的学历', page: '1', page_size: '20' });
    await handleOptimizedResumeList(ctx as any);
    const main = ctx.captured.find((c) => c.sql.includes('FROM resumes'));
    // 非法学历等级不追加过滤条件，列表不因未知学历被整体清空
    expect(main!.sql).not.toContain('LIKE \'%博士%\'');
  });
});
