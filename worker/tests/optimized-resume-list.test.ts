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
        all: async () => ({ results: rows }),
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
      all: async () => ({ results: [] }),
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
      all: async () => ({ results: [] }),
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

    const dataSql = captured.find(c => c.sql.includes('ORDER BY r.created_at DESC'));
    expect(dataSql!.sql).toContain('r.mapped_position = ?');
    expect(dataSql!.sql).toContain('r.mapped_position IN (SELECT raw_name FROM position_mappings WHERE mapped_name = ?)');
    expect(dataSql!.sql).toContain("json_extract(r.parsed_data, '$.major') LIKE ?");
    expect(dataSql!.sql).toContain("strftime('%Y%m', 'now')");
    expect(dataSql!.sql).toContain("json_extract(r.parsed_data, '$.birthday')");
    expect(dataSql!.sql).toContain("LIKE '%岁%'");
    expect(dataSql!.sql).toContain("COALESCE(NULLIF(r.gender, '')");
    expect(dataSql!.params.slice(0, 4)).toEqual(['软件工程师', '软件工程师', '%计算机%', 25]);
    expect(dataSql!.params.slice(4, 6)).toEqual([35, '男']);
  });

  it('includes newly uploaded pending rows in the pending-screening filter', async () => {
    const context = makeContext();
    const captured: string[] = [];
    context.env.DB.prepare = (sql: string) => {
      captured.push(sql);
      return {
        all: async () => ({ results: [] }),
        bind: (..._params: unknown[]) => ({
          first: async () => sql.includes('COUNT(*)') ? { total: 1 } : null,
          all: async () => ({ results: [] }),
        }),
      };
    };
    context.req = { query: (name: string) => ({ page: '1', page_size: '20', status: 'pending_screening' }[name]) };

    await handleOptimizedResumeList(context);

    const dataSql = captured.find((sql) => sql.includes('ORDER BY')) || '';
    expect(dataSql).toContain("r.screening_result = 'pending'");
    expect(dataSql).toContain("r.status = 'pending_screening'");
  });

  it('maps raw position names to standard position names for display', async () => {
    const context = makeContext();
    const mappings = [{ raw_name: 'IoT产品经理（双休｜入职五险一金）', mapped_name: '软件产品经理（智能硬件方向）' }];
    const resumeRow = [{
      id: 'resume-mapped',
      candidate_name: '候选人',
      status: 'approved',
      mapped_position: 'IoT产品经理（双休｜入职五险一金）',
      position_applied: 'IoT产品经理（双休｜入职五险一金）',
      parsed_data: JSON.stringify({ name: '候选人' }),
    }];
    context.env.DB.prepare = (sql: string) => {
      const isMapping = sql.includes('FROM position_mappings');
      return {
        all: async () => ({ results: isMapping ? mappings : [] }),
        bind: (..._params: unknown[]) => ({
          first: async () => sql.includes('COUNT(*)') ? { total: 1, pending_screening: 0, approved: 1, rejected: 0 } : null,
          all: async () => ({ results: isMapping ? mappings : resumeRow }),
        }),
      };
    };

    const response = await handleOptimizedResumeList(context);
    const item = (await response.json() as any).items[0];
    expect(item.standard_position).toBe('软件产品经理（智能硬件方向）');
    expect(item.mapped_position).toBe('IoT产品经理（双休｜入职五险一金）');
  });

  it('includes evaluation_job_status field when a job exists', async () => {
    const context = makeContext();
    let capturedSql = '';
    context.env.DB.prepare = (sql: string) => {
      capturedSql = sql;
      return {
        all: async () => {
          if (sql.includes('COUNT(*)')) return { results: [{ total: 1, pending_screening: 0, approved: 1, rejected: 0 }] };
          if (sql.includes('resume_processing_jobs')) {
            return { results: [{ id: 'job-1', resume_id: 'resume-1', status: 'running', step: 'screening', error_code: null, error_message: null, created_at: '2026-01-01T00:00:00Z' }] };
          }
          return { results: [{ id: 'resume-1', candidate_name: '测试', status: 'approved', ai_evaluation: null, parsed_data: null }] };
        },
        bind: (..._params: unknown[]) => ({
          first: async () => sql.includes('COUNT(*)') ? { total: 1, pending_screening: 0, approved: 1, rejected: 0 } : null,
          all: async () => {
            if (sql.includes('resume_processing_jobs')) {
              return { results: [{ id: 'job-1', resume_id: 'resume-1', status: 'running', step: 'screening', error_code: null, error_message: null, created_at: '2026-01-01T00:00:00Z' }] };
            }
            return { results: [{ id: 'resume-1', candidate_name: '测试', status: 'approved', ai_evaluation: null, parsed_data: null }] };
          },
        }),
      };
    };

    const response = await handleOptimizedResumeList(context);
    const payload = await response.json() as any;
    expect(payload.items[0].evaluation_job_status).toBe('running');
    expect(payload.items[0].evaluation_job_step).toBe('screening');
    expect(payload.items[0].evaluation_batch_id).toBeNull();
  });

  it('derives failed status from parse_status when no job exists', async () => {
    const context = makeContext();
    context.env.DB.prepare = (sql: string) => {
      return {
        all: async () => {
          if (sql.includes('COUNT(*)')) return { results: [{ total: 1, pending_screening: 0, approved: 0, rejected: 0 }] };
          return { results: [{ id: 'resume-failed', candidate_name: '失败者', status: 'approved', parse_status: 'failed', parse_error: 'OCR失败', ai_evaluation: null, parsed_data: null }] };
        },
        bind: (..._params: unknown[]) => ({
          first: async () => sql.includes('COUNT(*)') ? { total: 1 } : null,
          all: async () => ({ results: [{ id: 'resume-failed', candidate_name: '失败者', status: 'approved', parse_status: 'failed', parse_error: 'OCR失败', ai_evaluation: null, parsed_data: null }] }),
        }),
      };
    };

    const response = await handleOptimizedResumeList(context);
    const payload = await response.json() as any;
    expect(payload.items[0].evaluation_job_status).toBe('failed');
    expect(payload.items[0].evaluation_job_error).toBe('OCR失败');
  });
});
