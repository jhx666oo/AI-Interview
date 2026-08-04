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
});
