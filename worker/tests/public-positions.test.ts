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
  counts?: Record<string, number>;
}) {
  const position = opts.position === undefined ? PUBLIC_POSITION : opts.position;
  const counts = opts.counts ?? {};
  const c = (key: string, fallback = 0) => counts[key] ?? fallback;
  return {
    prepare(sql: string) {
      return {
        bind: (..._params: unknown[]) => ({
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
            if (sql.includes('SELECT status, parse_status FROM resumes')) return { results: opts.progressResumes ?? [] };
            if (sql.includes('FROM resumes')) return { results: opts.listRows ?? [] };
            return { results: [] };
          },
        }),
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
        { status: 'pending_screening', parse_status: 'ai_screened' },
        { status: 'pending_screening', parse_status: 'ai_screened' },
        { status: 'pending_interview', parse_status: 'ai_screened' },
        { status: 'interview_passed', parse_status: 'ai_screened' },
        { status: 'rejected', parse_status: 'ai_screened' },
        { status: 'offered', parse_status: 'processing' },
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
    expect(body.items[0]).toEqual({
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

  it('passes limit/offset and status filter into SQL', async () => {
    let capturedSql = '';
    let capturedParams: unknown[] = [];
    const db = {
      prepare(sql: string) {
        return {
          bind: (...params: unknown[]) => {
            capturedSql = sql;
            capturedParams = params;
            return {
              first: async () => {
                if (sql.startsWith('SELECT * FROM positions')) return PUBLIC_POSITION;
                if (sql.includes('COUNT(*)')) return { cnt: 1 };
                return null;
              },
              all: async () => ({ results: [resumeRows[0]] }),
            };
          },
        };
      },
    };
    const env = makeEnv(db);
    const res = await worker.fetch(new Request(`${BASE}/api/public/positions/pos-1/resumes?limit=5&offset=10&status=rejected`), env);
    expect(res.status).toBe(200);
    expect(capturedSql).toContain('LIMIT ? OFFSET ?');
    expect(capturedSql).toContain('AND status = ?');
    // 岗位匹配的 OR 组必须带括号，避免 AND status 只作用于最后一个 OR 分支
    expect(capturedSql).toContain('(position_id = ? OR LOWER(mapped_position) = LOWER(?) OR LOWER(position_applied) = LOWER(?)) AND status = ?');
    // 前 3 个参数是岗位匹配（position_id + title + title），之后是 status、limit、offset
    expect(capturedParams).toEqual(['pos-1', '软件工程师', '软件工程师', 'rejected', 5, 10]);
  });

  it('clamps limit to max 200 and negative offset to 0', async () => {
    let capturedParams: unknown[] = [];
    const db = {
      prepare(sql: string) {
        return {
          bind: (...params: unknown[]) => {
            capturedParams = params;
            return {
              first: async () => {
                if (sql.startsWith('SELECT * FROM positions')) return PUBLIC_POSITION;
                if (sql.includes('COUNT(*)')) return { cnt: 0 };
                return null;
              },
              all: async () => ({ results: [] }),
            };
          },
        };
      },
    };
    const env = makeEnv(db);
    const res = await worker.fetch(new Request(`${BASE}/api/public/positions/pos-1/resumes?limit=99999&offset=-5`), env);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.limit).toBe(200);
    expect(capturedParams[3]).toBe(200);
    expect(capturedParams[4]).toBe(0);
  });

  it('returns 404 when the position status is not public', async () => {
    const env = makeEnv(makeDb({ position: { ...PUBLIC_POSITION, status: 'closed' } }));
    const res = await worker.fetch(new Request(`${BASE}/api/public/positions/pos-1/resumes`), env);
    expect(res.status).toBe(404);
  });
});
