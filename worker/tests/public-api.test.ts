import { describe, expect, it } from 'vitest';
import worker from '../src/index';

const BASE = 'http://worker.local';
const PENDING = ['pending_screening', 'pending_review', 'pending_dept_review', 'pending_hr_decision'];

type Tables = Record<string, Array<Record<string, unknown>>>;

function tableFromSql(sql: string): string | null {
  const table = /FROM (\w+)/.exec(sql)?.[1];
  if (!table) return null;
  return table;
}

function filterResumeRows(sql: string, rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  let out = [...rows];
  if (sql.includes('screening_result = ?')) out = out.filter((r) => String(r.screening_result) === '通过');
  if (/status IN \(\?,\?,\?,\?\)/.test(sql)) out = out.filter((r) => PENDING.includes(String(r.status)));
  else if (/status = \?/.test(sql)) out = out.filter((r) => String(r.status) === 'pending_interview');
  return out;
}

function makeDb(tables: Tables) {
  const getRows = (table: string | null) => (table ? tables[table] ?? [] : []);
  return {
    prepare(sql: string) {
      const stmt = (params: unknown[]) => ({
        async first() {
          const table = tableFromSql(sql);
          if (sql.includes('COUNT(*)')) {
            const rows = table === 'resumes' ? filterResumeRows(sql, getRows(table)) : getRows(table);
            return { cnt: rows.length };
          }
          if (table === 'resumes' && /WHERE id = \?/.test(sql)) {
            return getRows('resumes').find((r) => String(r.id) === String(params[0])) || null;
          }
          return null;
        },
        async all() {
          if (sql.includes('GROUP BY')) {
            const col = /SELECT (\w+) as n, COUNT\(\*\) as c/.exec(sql)?.[1];
            const table = /FROM (\w+)/.exec(sql)?.[1] || '';
            const rows = getRows(table);
            const filtered = sql.includes("WHERE status IN ('scheduled','in_progress')")
              ? rows.filter((r) => ['scheduled', 'in_progress'].includes(String(r.status)))
              : rows;
            const map: Record<string, number> = {};
            for (const r of filtered) {
              const n = r[col] as string;
              if (n) map[n] = (map[n] || 0) + 1;
            }
            return { results: Object.entries(map).map(([n, c]) => ({ n, c })) };
          }
          const table = tableFromSql(sql);
          let rows = getRows(table);
          if (table === 'resumes') rows = filterResumeRows(sql, rows);
          return { results: rows };
        },
        async run() {
          return { meta: { changes: 1 } };
        },
      });
      return {
        bind: (...p: unknown[]) => stmt(p),
        first: () => stmt([]).first(),
        all: () => stmt([]).all(),
        run: () => stmt([]).run(),
      };
    },
  };
}

function makeEnv(db: unknown, overrides: Record<string, unknown> = {}) {
  return { DB: db, SECRET_KEY: 'test-secret', RESUME_UPLOAD_API_KEY: 'test-api-key', ...overrides } as any;
}

function get(path: string, env: any, headers: Record<string, string> = {}) {
  return worker.fetch(new Request(`${BASE}${path}`, { headers }), env);
}

function fullGet(path: string, db: unknown) {
  return get(path, makeEnv(db), { 'x-api-key': 'test-api-key' });
}

describe('姓名容错 resolveInterviewerName → person/resumes', () => {
  const tables: Tables = {
    interviewer_mappings: [{ id: 'm-1', name: '魏秋柠', open_id: 'ou_weiqiu' }],
    positions: [{ id: 'pos-1', title: '软件工程师', responsible_person: '魏秋柠' }],
    resumes: [
      { id: 'res-1', candidate_name: '王小明', position_id: 'pos-1', mapped_position: '软件工程师', status: 'pending_interview', stage: 'interview', match_score: 85, screening_result: '通过', parse_status: 'ai_screened', created_at: '2026-08-05', updated_at: '2026-08-05' },
    ],
  };

  it('把差一字的 魏秋宁 自动解析为 魏秋柠 并返回 matched_from', async () => {
    const db = makeDb(tables);
    const res = await get(`/api/public/person/${encodeURIComponent('魏秋宁')}/resumes`, makeEnv(db));
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.person).toBe('魏秋柠');
    expect(body.matched_from).toBe('魏秋宁');
    expect(body.total).toBe(1);
    expect(body.items).toHaveLength(1);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('contact');
    expect(serialized).not.toContain('parsed_data');
  });

  it('精确姓名不返回 matched_from', async () => {
    const db = makeDb(tables);
    const res = await get(`/api/public/person/${encodeURIComponent('魏秋柠')}/resumes`, makeEnv(db));
    const body = await res.json() as any;
    expect(body.person).toBe('魏秋柠');
    expect(body.matched_from).toBeUndefined();
  });
});

describe('GET /api/public/person/:name/todo', () => {
  const tables: Tables = {
    interviewer_mappings: [{ id: 'm-1', name: '魏秋柠', open_id: 'ou_weiqiu' }],
    positions: [{ id: 'pos-1', title: '软件工程师', responsible_person: '魏秋柠' }],
    resumes: [
      { id: 'res-a', candidate_name: '张三', position_id: 'pos-1', status: 'pending_screening', screening_result: '通过', created_at: '2026-08-01', updated_at: '2026-08-01' },
      { id: 'res-b', candidate_name: '李四', position_id: 'pos-1', status: 'pending_interview', screening_result: '通过', created_at: '2026-08-02', updated_at: '2026-08-02' },
    ],
    recruitment_tasks: [{ id: 'task-1', position_name: '软件工程师', status: 'pending', responsible_person: '魏秋柠', interviewers: '[]', city: '上海' }],
    interviews: [{ id: 'iv-1', resume_id: 'res-b', candidate_name: '李四', round: 1, interviewer: '魏秋柠', status: 'scheduled', interview_time: '2026-08-15 10:00:00' }],
  };

  it('返回待办 summary + 分组 items，且不含隐私字段', async () => {
    const db = makeDb(tables);
    const res = await get(`/api/public/person/${encodeURIComponent('魏秋宁')}/todo`, makeEnv(db));
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.person).toBe('魏秋柠');
    expect(body.matched_from).toBe('魏秋宁');
    expect(body.summary.pending_resumes).toBe(1);
    expect(body.summary.ai_passed).toBe(1);
    expect(body.summary.pending_interview).toBe(1);
    expect(body.summary.recruitment_tasks).toBe(1);
    expect(body.summary.interviews).toBe(1);
    expect(body.groups.pending_resumes.items).toHaveLength(1);
    expect(body.groups.ai_passed.items[0].id).toBe('res-a');
    expect(body.groups.pending_interview.items[0].id).toBe('res-b');
    expect(body.groups.interviews.items[0]).toMatchObject({ id: 'iv-1', interviewer: '魏秋柠' });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('contact');
    expect(serialized).not.toContain('email');
    expect(serialized).not.toContain('raw_text');
    expect(serialized).not.toContain('parsed_data');
  });
});

describe('GET /api/public/resumes', () => {
  it('支持学历过滤（本科及以上），只返回进度字段', async () => {
    const db = makeDb({
      resumes: [
        { id: 'res-1', candidate_name: '硕士甲', education: '硕士', created_at: '2026-08-01', updated_at: '2026-08-01' },
        { id: 'res-2', candidate_name: '大专乙', education: '大专', created_at: '2026-08-01', updated_at: '2026-08-01' },
      ],
    });
    const res = await get('/api/public/resumes?education_min=本科', makeEnv(db));
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.total).toBe(1);
    expect(body.items[0].candidate_name).toBe('硕士甲');
    expect(JSON.stringify(body)).not.toContain('education');
  });

  it('把 status 与 keyword 传入简历 SQL', async () => {
    let capturedSql = '';
    let capturedParams: unknown[] = [];
    const db = {
      prepare(sql: string) {
        return {
          bind: (...params: unknown[]) => {
            if (sql.includes('FROM resumes') && sql.includes('LIMIT ? OFFSET ?') && !sql.includes('LIMIT 5000')) {
              capturedSql = sql;
              capturedParams = params;
            }
            return {
              async first() { return { cnt: 1 }; },
              async all() { return { results: [] }; },
              async run() { return { meta: { changes: 1 } }; },
            };
          },
          first: async () => ({ cnt: 1 }),
          all: async () => ({ results: [] }),
          run: async () => ({ meta: { changes: 1 } }),
        };
      },
    };
    await get('/api/public/resumes?status=pending_interview&keyword=王', makeEnv(db));
    expect(capturedSql).toContain('status = ?');
    expect(capturedSql).toContain('candidate_name LIKE ?');
    expect(capturedParams).toContain('%王%');
  });
});

describe('GET /api/public/resumes/:id 两档脱敏', () => {
  const resumeRow = {
    id: 'res-1', candidate_name: '王小明', contact: '13800000000', email: 'wm@x.com',
    status: 'pending_screening', screening_result: '通过', gender: '男',
    parsed_data: JSON.stringify({ age: 28, city: '上海' }), raw_text: '……原文……',
  };
  it('公开模式不返回联系方式与解析数据', async () => {
    const db = makeDb({ resumes: [resumeRow] });
    const res = await get('/api/public/resumes/res-1', makeEnv(db));
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.contact).toBeUndefined();
    expect(body.email).toBeUndefined();
    expect(body.parsed_data).toBeUndefined();
    expect(body.raw_text).toBeUndefined();
    expect(body.candidate_name).toBe('王小明');
  });
  it('带 key 返回完整字段', async () => {
    const db = makeDb({ resumes: [resumeRow] });
    const res = await fullGet('/api/public/resumes/res-1', db);
    const body = await res.json() as any;
    expect(body.contact).toBe('13800000000');
    expect(body.email).toBe('wm@x.com');
    expect(body.parsed_data).toBeDefined();
    expect(body.raw_text).toContain('原文');
  });
});

describe('GET /api/public/interviewers', () => {
  const tables: Tables = {
    interviewer_mappings: [{ id: 'm-1', name: '魏秋柠', open_id: 'ou_weiqiu' }],
    positions: [{ id: 'pos-1', title: '软件工程师', responsible_person: '魏秋柠' }],
    interviews: [{ id: 'iv-1', resume_id: 'res-b', interviewer: '魏秋柠', status: 'scheduled' }],
    recruitment_tasks: [{ id: 'task-1', position_name: '软件工程师', responsible_person: '魏秋柠', interviewers: '[]' }],
  };
  it('聚合面试官统计，公开模式不含 open_id', async () => {
    const db = makeDb(tables);
    const res = await get('/api/public/interviewers', makeEnv(db));
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    const item = body.items.find((x: any) => x.name === '魏秋柠');
    expect(item).toBeDefined();
    expect(item.position_count).toBe(1);
    expect(item.pending_interview_count).toBe(1);
    expect(item.pending_task_count).toBe(1);
    expect(item.open_id).toBeUndefined();
  });
  it('带 key 返回 open_id', async () => {
    const db = makeDb(tables);
    const res = await fullGet('/api/public/interviewers', db);
    const body = await res.json() as any;
    const item = body.items.find((x: any) => x.name === '魏秋柠');
    expect(item.open_id).toBe('ou_weiqiu');
  });
});

describe('GET /api/public/interviews', () => {
  it('按面试官过滤并返回脱敏字段', async () => {
    const db = makeDb({
      interviews: [
        { id: 'iv-1', resume_id: 'res-1', interviewer: '黄维', status: 'scheduled', round: 1, evaluation: '很优秀', scores: JSON.stringify({ a: 90 }), created_at: '2026-08-01' },
      ],
    });
    const res = await get('/api/public/interviews?interviewer=黄维', makeEnv(db));
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.total).toBe(1);
    const item = body.items[0];
    expect(item.interviewer).toBe('黄维');
    expect(item.evaluation).toBeUndefined();
    expect(item.scores).toBeUndefined();
  });
});

describe('GET /api/public/offers 两档脱敏', () => {
  const offer = {
    id: 'of-1', resume_id: 'res-1', candidate_name: '张三', candidate_email: 'zs@x.com',
    salary_monthly: 25000, position_title: '软件工程师', status: 'approved', created_at: '2026-08-01', updated_at: '2026-08-01',
  };
  it('公开模式不返回薪资与邮箱', async () => {
    const db = makeDb({ offers: [offer] });
    const res = await get('/api/public/offers', makeEnv(db));
    const body = await res.json() as any;
    const item = body.items[0];
    expect(item.candidate_name).toBe('张三');
    expect(item.salary_monthly).toBeUndefined();
    expect(item.candidate_email).toBeUndefined();
  });
  it('带 key 返回薪资与邮箱', async () => {
    const db = makeDb({ offers: [offer] });
    const res = await fullGet('/api/public/offers', db);
    const body = await res.json() as any;
    expect(body.items[0].salary_monthly).toBe(25000);
    expect(body.items[0].candidate_email).toBe('zs@x.com');
  });
});

describe('GET /api/public/overview', () => {
  it('返回全局漏斗与 hr_stats 数字', async () => {
    const db = makeDb({
      positions: [{ id: 'pos-1', title: '软件工程师', status: 'open' }],
      resumes: [{ id: 'res-1', candidate_name: '张三', status: 'pending_screening' }],
      job_requisitions: [{ id: 'req-1', title: '招聘需求', status: 'pending' }],
      talent_pool: [{ id: 'tp-1', candidate_name: '李四' }],
      onboarding_records: [{ id: 'ob-1', candidate_name: '王五', status: 'onboarded' }],
      probation_records: [{ id: 'pb-1', employee_name: '赵六', result: 'pending' }],
    });
    const res = await get('/api/public/overview', makeEnv(db));
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.overview.active_positions).toBe(1);
    expect(body.overview.total_resumes).toBe(1);
    expect(body.hr_stats.total_requisitions).toBe(1);
    expect(body.hr_stats.talent_pool_size).toBe(1);
    expect(body.hr_stats.onboarding_count).toBe(1);
    expect(body.hr_stats.probation_count).toBe(1);
    expect(body.funnel.stages).toHaveLength(5);
    expect(body.resume_status_breakdown).toBeDefined();
  });
});

describe('POST /api/public/review/:resumeId 鉴权（PII 泄漏修复）', () => {
  it('未带 key/JWT 返回 401', async () => {
    const db = makeDb({ resumes: [{ id: 'res-1', candidate_name: '张三', contact: '138', email: 'z@x.com' }] });
    const res = await get('/api/public/review/res-1', makeEnv(db));
    expect(res.status).toBe(401);
  });
  it('带 key 返回完整简历', async () => {
    const db = makeDb({ resumes: [{ id: 'res-1', candidate_name: '张三', contact: '138', email: 'z@x.com' }] });
    const res = await fullGet('/api/public/review/res-1', db);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.candidate_name).toBe('张三');
    expect(body.contact).toBe('138');
  });
});
