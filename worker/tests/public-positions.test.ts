import { describe, expect, it } from 'vitest';
import worker from '../src/index';

const PUBLIC_POSITION = {
  id: 'pos-1',
  title: '软件工程师',
  description: '负责核心系统开发',
  requirements: '本科以上',
  salary_range: '20k-30k',
  location: '上海',
  department: '研发部',
  status: 'open',
  urgency: 'high',
  position_type: 'full_time',
  headcount: 3,
  responsible_person: '张三',
  primary_interviewer: '',
  secondary_interviewer: '',
  personalized_requirements: '',
  capability_dimensions: '[]',
  created_at: '2026-08-01 10:00:00',
  updated_at: '2026-08-10 10:00:00',
};

function makeDb(opts: {
  position?: Record<string, unknown> | null;
  progressResumes?: Array<Record<string, unknown>>;
  listRows?: Array<Record<string, unknown>>;
  mappings?: Array<Record<string, unknown>>;
  counts?: Record<string, number>;
}) {
  const position = opts.position === undefined ? PUBLIC_POSITION : opts.position;
  const counts = opts.counts ?? {};
  const c = (key: string, fallback = 0) => counts[key] ?? fallback;
  return {
    prepare(sql: string) {
      const stmt = {
        first: async () => {
          if (sql.startsWith('SELECT * FROM positions')) return position;
          if (sql.includes('FROM interviews')) {
            if (sql.includes('round = 3')) return { cnt: c('third_pass') };
            if (sql.includes('result2')) return { cnt: c('second_pass') };
            if (sql.includes('status2')) return { cnt: c('first_pass') };
            return { cnt: c('scheduled') };
          }
          if (sql.includes('FROM offers')) return { cnt: c('offers') };
          if (sql.includes('FROM onboarding_records')) return { cnt: c('hired') };
          if (sql.includes('COUNT(*)') && sql.includes('FROM resumes')) return { cnt: c('total_resumes', 0) };
          return null;
        },
        all: async () => {
          if (sql.includes('FROM position_mappings')) return { results: opts.mappings ?? [] };
          if (sql.includes('FROM resumes')) return { results: opts.listRows ?? opts.progressResumes ?? [] };
          return { results: [] };
        },
      };
      return {
        bind: () => stmt,
        first: () => stmt.first(),
        all: () => stmt.all(),
        run: () => ({ meta: { changes: 1 } }),
      };
    },
  };
}

function makeEnv(db: unknown) {
  return { DB: db } as any;
}

const BASE = 'http://worker.local';

describe('GET /api/public/positions/:id/progress', () => {
  it('returns position info and funnel progress for a public position', async () => {
    const env = makeEnv(makeDb({
      progressResumes: [
        { position_id: 'pos-1', status: 'pending_screening', parse_status: 'ai_screened' },
        { position_id: 'pos-1', status: 'pending_screening', parse_status: 'ai_screened' },
        { position_id: 'pos-1', status: 'pending_interview', parse_status: 'ai_screened' },
        { position_id: 'pos-1', status: 'interview_passed', parse_status: 'ai_screened' },
        { position_id: 'pos-1', status: 'rejected', parse_status: 'ai_screened' },
        { position_id: 'pos-1', status: 'offered', parse_status: 'processing' },
      ],
      counts: { scheduled: 4, first_pass: 3, second_pass: 2, third_pass: 1, offers: 1, hired: 1 },
    }));
    const res = await worker.fetch(new Request(`${BASE}/api/public/positions/pos-1/progress`), env);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.position).toMatchObject({ id: 'pos-1', title: '软件工程师', status: 'open', headcount: 3 });
    expect(body.progress).toMatchObject({
      total_resumes: 6,
      ai_screened: 5,
      first_interview: 4,
      first_pass: 3,
      second_pass: 2,
      third_pass: 1,
      offers: 1,
      hired: 1,
      resume_status_breakdown: {
        pending_screening: 2,
        pending_interview: 1,
        interview_passed: 1,
        rejected: 1,
        offered: 1,
      },
    });
  });

  it('按 position_mappings 解析原始岗位名计入 progress（与前端一致）', async () => {
    const env = makeEnv(makeDb({
      mappings: [{ raw_name: 'IoT产品经理', mapped_name: '软件工程师' }],
      progressResumes: [
        { position_id: 'pos-1', status: 'pending_screening', parse_status: 'ai_screened' },
        { position_id: '', mapped_position: 'IoT产品经理', status: 'pending_screening', parse_status: 'ai_screened' },
        { position_id: '', mapped_position: '后端开发', status: 'rejected', parse_status: 'ai_screened' },
      ],
    }));
    const res = await worker.fetch(new Request(`${BASE}/api/public/positions/pos-1/progress`), env);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.progress.total_resumes).toBe(2);
    expect(body.progress.ai_screened).toBe(2);
    expect(body.progress.resume_status_breakdown).toMatchObject({ pending_screening: 2 });
  });

  it('returns 404 when the position status is not public', async () => {
    const env = makeEnv(makeDb({ position: { ...PUBLIC_POSITION, status: 'draft' } }));
    const res = await worker.fetch(new Request(`${BASE}/api/public/positions/pos-1/progress`), env);
    expect(res.status).toBe(404);
  });

  it('returns 404 when the position does not exist', async () => {
    const env = makeEnv(makeDb({ position: null }));
    const res = await worker.fetch(new Request(`${BASE}/api/public/positions/missing/progress`), env);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/public/positions/:id/resumes', () => {
  const resumeRows = [
    { id: 'r1', candidate_name: '李四', mapped_position: '软件工程师', position_applied: '软件工程师', status: 'pending_interview', stage: 'interview', match_score: 85, screening_result: '通过', parse_status: 'ai_screened', created_at: '2026-08-05 09:00:00', updated_at: '2026-08-05 09:00:00' },
    { id: 'r2', candidate_name: '王五', mapped_position: '', position_applied: '软件工程师', status: 'rejected', stage: 'rejected', match_score: 60, screening_result: '不通过', parse_status: 'ai_screened', created_at: '2026-08-06 09:00:00', updated_at: '2026-08-06 09:00:00' },
  ];

  it('returns a paginated list with progress fields only (no sensitive fields)', async () => {
    const env = makeEnv(makeDb({ listRows: resumeRows, counts: { total_resumes: 2 } }));
    const res = await worker.fetch(new Request(`${BASE}/api/public/positions/pos-1/resumes`), env);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.position).toMatchObject({ id: 'pos-1', title: '软件工程师' });
    expect(body.total).toBe(2);
    expect(body.limit).toBe(50);
    expect(body.offset).toBe(0);
    expect(body.items).toHaveLength(2);
    // 按 created_at DESC 排序，最新在前
    expect(body.items[0].id).toBe('r2');
    expect(body.items[1]).toEqual({
      id: 'r1',
      candidate_name: '李四',
      position_applied: '软件工程师',
      status: 'pending_interview',
      stage: 'interview',
      match_score: 85,
      screening_result: '通过',
      parse_status: 'ai_screened',
      created_at: '2026-08-05 09:00:00',
      updated_at: '2026-08-05 09:00:00',
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('contact');
    expect(serialized).not.toContain('email');
    expect(serialized).not.toContain('raw_text');
    expect(serialized).not.toContain('parsed_data');
  });

  it('按 position_mappings 解析原始岗位名计入列表（与前端一致）', async () => {
    const db = makeDb({
      mappings: [{ raw_name: 'IoT产品经理', mapped_name: '软件工程师' }],
      listRows: [
        { id: 'r1', candidate_name: '李四', mapped_position: '软件工程师', position_applied: '软件工程师', status: 'pending_interview', stage: 'interview', match_score: 85, screening_result: '通过', parse_status: 'ai_screened', created_at: '2026-08-05 09:00:00', updated_at: '2026-08-05 09:00:00' },
        { id: 'r2', candidate_name: '王五', mapped_position: '', position_applied: 'IoT产品经理', status: 'rejected', stage: 'rejected', match_score: 60, screening_result: '不通过', parse_status: 'ai_screened', created_at: '2026-08-06 09:00:00', updated_at: '2026-08-06 09:00:00' },
        { id: 'r3', candidate_name: '赵六', mapped_position: '', position_applied: '后端开发', status: 'pending_screening', stage: 'new', match_score: 70, screening_result: '', parse_status: 'ai_screened', created_at: '2026-08-07 09:00:00', updated_at: '2026-08-07 09:00:00' },
      ],
    });
    const res = await worker.fetch(new Request(`${BASE}/api/public/positions/pos-1/resumes`), makeEnv(db));
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.total).toBe(2); // r1 标题精确 + r2 经映射，r3 无关岗位被排除
    const names = body.items.map((i: any) => i.candidate_name);
    expect(names).toContain('李四');
    expect(names).toContain('王五');
    expect(names).not.toContain('赵六');
  });

  it('status 过滤与分页在服务端 JS 生效', async () => {
    const db = makeDb({
      listRows: [
        { id: 'r1', candidate_name: '李四', mapped_position: '软件工程师', position_applied: '软件工程师', status: 'pending_interview', stage: 'interview', match_score: 85, screening_result: '通过', parse_status: 'ai_screened', created_at: '2026-08-05 09:00:00', updated_at: '2026-08-05 09:00:00' },
        { id: 'r2', candidate_name: '王五', mapped_position: '软件工程师', position_applied: '软件工程师', status: 'rejected', stage: 'rejected', match_score: 60, screening_result: '不通过', parse_status: 'ai_screened', created_at: '2026-08-06 09:00:00', updated_at: '2026-08-06 09:00:00' },
      ],
    });
    const res = await worker.fetch(new Request(`${BASE}/api/public/positions/pos-1/resumes?status=rejected`), makeEnv(db));
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.total).toBe(1);
    expect(body.items[0].id).toBe('r2');
  });

  it('clamps limit to max 200 and negative offset to 0', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({
      id: `r${i}`, candidate_name: `候选人${i}`, mapped_position: '软件工程师', position_applied: '软件工程师',
      status: 'pending_screening', stage: 'new', match_score: 0, screening_result: '', parse_status: '',
      created_at: `2026-08-0${i + 1} 09:00:00`, updated_at: `2026-08-0${i + 1} 09:00:00`,
    }));
    const db = makeDb({ listRows: rows });
    const res = await worker.fetch(new Request(`${BASE}/api/public/positions/pos-1/resumes?limit=99999&offset=-5`), makeEnv(db));
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.limit).toBe(200);
    expect(body.offset).toBe(0);
    expect(body.total).toBe(5);
    expect(body.items).toHaveLength(5);
  });

  it('returns 404 when the position status is not public', async () => {
    const env = makeEnv(makeDb({ position: { ...PUBLIC_POSITION, status: 'closed' } }));
    const res = await worker.fetch(new Request(`${BASE}/api/public/positions/pos-1/resumes`), env);
    expect(res.status).toBe(404);
  });
});
