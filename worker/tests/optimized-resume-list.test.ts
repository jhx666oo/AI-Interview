import { describe, expect, it } from 'vitest';
import { handleOptimizedResumeList } from '../src/resume-list/optimized-handler';

function makeContext() {
  const rows = [{
    id: 'resume-1',
    candidate_name: '候选人',
    status: 'approved',
    ai_evaluation: JSON.stringify({
      dimensions: [{ name: '沟通能力', score: 4, reason: '表达清晰' }],
    }),
    parsed_data: JSON.stringify({ name: '候选人' }),
  }];

  const db = {
    prepare(sql: string) {
      return {
        bind: (..._params: unknown[]) => ({
          first: async () => sql.includes('COUNT(*)')
            ? { total: 250, pending_screening: 201, approved: 30, rejected: 19 }
            : null,
          all: async () => ({ results: rows }),
        }),
      };
    },
  };

  return {
    req: { query: (name: string) => name === 'page' ? '1' : name === 'page_size' ? '20' : undefined },
    env: { DB: db },
    get: () => null,
    json: (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } }),
  };
}

describe('optimized resume list response', () => {
  it('returns full-list stats and parsed evaluation details with a paged item list', async () => {
    const response = await handleOptimizedResumeList(makeContext());
    const payload = await response.json() as any;

    expect(payload.items).toHaveLength(1);
    expect(payload.total).toBe(250);
    expect(payload.stats).toMatchObject({ total: 250, pending_screening: 201, approved: 30, rejected: 19 });
    expect(payload.items[0].ai_evaluation).toEqual({
      dimensions: [{ name: '沟通能力', score: 4, reason: '表达清晰' }],
    });
  });

  it('uses the structured weighted score and exposes screening gate details', async () => {
    const context = makeContext();
    context.env.DB.prepare = (sql: string) => ({
      bind: (..._params: unknown[]) => ({
        first: async () => sql.includes('COUNT(*)') ? { total: 1 } : null,
        all: async () => ({ results: [{
          id: 'resume-weighted',
          candidate_name: '候选人',
          status: 'approved',
          match_score: 62,
          screening_result: '存疑',
          ai_evaluation: JSON.stringify({
            weighted_score: 3.8,
            gate_results: { keyword_match: { score: 5, passed: true } },
            screening_reason: '五项能力加权分未达到 4 分',
          }),
        }] }),
      }),
    });

    const response = await handleOptimizedResumeList(context);
    const item = (await response.json() as any).items[0];

    expect(item.weighted_score).toBe(3.8);
    expect(item.match_score).toBe(3.8);
    expect(item.gate_results).toEqual({ keyword_match: { score: 5, passed: true } });
    expect(item.screening_reason).toBe('五项能力加权分未达到 4 分');
    expect(item.screening_result).toBe('不通过');
  });

  it('passes position / major / age / gender filters into SQL and keeps pagination stats', async () => {
    const context = makeContext();
    const captured: { sql: string; params: unknown[] }[] = [];
    context.env.DB.prepare = (sql: string) => ({
      bind: (...params: unknown[]) => {
        captured.push({ sql, params });
        return {
          first: async () => sql.includes('COUNT(*)') ? { total: 3, pending_screening: 0, approved: 2, rejected: 1 } : null,
          all: async () => ({ results: [] }),
        };
      },
    });
    const queries = (key: string) => ({ position: '软件工程师', major: '计算机', min_age: '25', max_age: '35', genders: '男,未识别' } as Record<string, string>)[key];
    context.req = { query: (name: string) => name === 'page' ? '1' : name === 'page_size' ? '20' : queries(name) };

    const response = await handleOptimizedResumeList(context);
    const payload = await response.json() as any;
    expect(payload.total).toBe(3);
    expect(payload.stats).toMatchObject({ total: 3, approved: 2, rejected: 1 });

    const dataSql = captured.find(c => c.sql.includes('ORDER BY r.updated_at DESC'));
    expect(dataSql!.sql).toContain('r.mapped_position = ?');
    expect(dataSql!.sql).toContain("json_extract(r.parsed_data, '$.major') LIKE ?");
    expect(dataSql!.sql).toContain("strftime('%Y%m', 'now')");
    expect(dataSql!.sql).toContain("json_extract(r.parsed_data, '$.birthday')");
    expect(dataSql!.sql).toContain("LIKE '%岁%'");
    expect(dataSql!.sql).toContain("COALESCE(NULLIF(r.gender, '')");
    expect(dataSql!.params.slice(0, 4)).toEqual(['软件工程师', '%计算机%', 25, 35]);
    expect(dataSql!.params.slice(4, 5)).toEqual(['男']);
  });
});
