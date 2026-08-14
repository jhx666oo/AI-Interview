import { describe, expect, it } from 'vitest';
import worker from '../src/index';

const BASE = 'http://worker.local';

// 造数据：黄维是 pos-1（软件工程师）负责人
const POSITION_ROW = { id: 'pos-1', title: '软件工程师' };

function resumeRow(over: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'res-x',
    candidate_name: '候选人',
    position_id: 'pos-1',
    mapped_position: '软件工程师',
    position_applied: '软件工程师',
    status: 'pending_screening',
    stage: 'new',
    screening_result: '通过',
    education: '本科',
    parsed_data: JSON.stringify({ age: 30 }),
    created_at: '2026-08-05 09:00:00',
    updated_at: '2026-08-05 09:00:00',
    ...over,
  };
}

type MockOpts = {
  positions?: Array<Record<string, unknown>>;
  mappings?: Array<Record<string, unknown>>;
  tasks?: Array<Record<string, unknown>>;
  interviews?: Array<Record<string, unknown>>;
  resumes?: Array<Record<string, unknown>>;
};

function makeDb(opts: MockOpts = {}) {
  const resumeState = new Map<string, Record<string, unknown>>();
  for (const r of opts.resumes ?? []) resumeState.set(String(r.id), { ...r });

  let capturedResumeSql = '';
  let capturedResumeParams: unknown[] = [];

  return {
    resumeState,
    capturedResumeSql: () => capturedResumeSql,
    capturedResumeParams: () => capturedResumeParams,
    prepare(sql: string) {
      const stmt = (params: unknown[]) => ({
        async first() {
          if (sql.includes('SELECT id, status, stage FROM resumes')) {
            return resumeState.get(String(params[0])) || null;
          }
          return null;
        },
        async all() {
          if (sql.includes('FROM positions')) return { results: opts.positions ?? [] };
          if (sql.includes('FROM position_mappings')) return { results: opts.mappings ?? [] };
          if (sql.includes('FROM recruitment_tasks')) return { results: opts.tasks ?? [] };
          if (sql.includes('FROM interviews')) return { results: opts.interviews ?? [] };
          if (sql.includes('SELECT id, candidate_name, education, parsed_data FROM resumes')) {
            capturedResumeSql = sql;
            capturedResumeParams = params;
            // 模拟 SQL 过滤：WHERE 0 无结果；status/screening_result 是相关过滤条件之后追加的参数
            if (/WHERE \(?0\)?/.test(sql)) return { results: [] };
            let rows = [...resumeState.values()];
            const p = params.slice(0, -1); // 去掉末尾 LIMIT
            if (sql.includes('screening_result = ?')) {
              const v = String(p.pop());
              rows = rows.filter((r) => String(r.screening_result) === v);
            }
            if (sql.includes('status = ?')) {
              const v = String(p.pop());
              rows = rows.filter((r) => String(r.status) === v);
            }
            return { results: rows };
          }
          return { results: [] };
        },
        async run() {
          if (sql.includes("UPDATE resumes SET status = 'approved'")) {
            const row = resumeState.get(String(params[1]));
            if (row) {
              row.status = 'approved';
              row.stage = 'talent_pool';
              return { meta: { changes: 1 } };
            }
            return { meta: { changes: 0 } };
          }
          if (sql.includes("UPDATE resumes SET status = 'rejected'")) {
            const row = resumeState.get(String(params[1]));
            if (row) {
              row.status = 'rejected';
              row.stage = 'rejected';
              return { meta: { changes: 1 } };
            }
            return { meta: { changes: 0 } };
          }
          return { meta: { changes: 1 } };
        },
      });
      return {
        bind: (...params: unknown[]) => stmt(params),
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

function post(env: any, body: unknown) {
  return worker.fetch(new Request(`${BASE}/api/public/resumes/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': 'test-api-key' },
    body: JSON.stringify(body),
  }), env);
}

describe('POST /api/public/resumes/action', () => {
  it('requires an API key or JWT', async () => {
    const db = makeDb();
    const res = await worker.fetch(new Request(`${BASE}/api/public/resumes/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve', conditions: { related_person: '黄维' } }),
    }), makeEnv(db));
    expect(res.status).toBe(401);
  });

  it('rejects empty conditions', async () => {
    const db = makeDb();
    const res = await post(makeEnv(db), { action: 'approve', conditions: {} });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.detail).toContain('过滤条件');
  });

  it('batch approves by related_person + education_min + screening_result', async () => {
    const db = makeDb({
      positions: [POSITION_ROW],
      resumes: [
        resumeRow({ id: 'res-1', education: '硕士', parsed_data: JSON.stringify({ age: 28 }) }),
        resumeRow({ id: 'res-2', education: '本科', parsed_data: JSON.stringify({ age: 32 }) }),
        resumeRow({ id: 'res-3', education: '大专', parsed_data: JSON.stringify({ age: 25 }) }),
        resumeRow({ id: 'res-4', education: '本科', parsed_data: JSON.stringify({ age: 40 }), screening_result: '不通过' }),
      ],
    });
    const res = await post(makeEnv(db), {
      action: 'approve',
      conditions: { related_person: '黄维', education_min: '本科', screening_result: '通过' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
    expect(body.action).toBe('approve');
    expect(body.matched).toBe(2); // res-1 硕士、res-2 本科；res-3 大专排除、res-4 初筛不通过排除
    expect(body.affected).toBe(2);
    expect(db.resumeState.get('res-1')).toMatchObject({ status: 'approved', stage: 'talent_pool' });
    expect(db.resumeState.get('res-2')).toMatchObject({ status: 'approved' });
    expect(db.resumeState.get('res-3').status).toBe('pending_screening'); // 未动
    expect(db.resumeState.get('res-4').status).toBe('pending_screening'); // 未动
  });

  it('batch rejects by education (大专) + age_max', async () => {
    const db = makeDb({
      positions: [POSITION_ROW],
      resumes: [
        resumeRow({ id: 'res-1', education: '大专', parsed_data: JSON.stringify({ age: 24 }) }),
        resumeRow({ id: 'res-2', education: '大专', parsed_data: JSON.stringify({ age: 36 }) }),
        resumeRow({ id: 'res-3', education: '本科', parsed_data: JSON.stringify({ age: 22 }) }),
      ],
    });
    const res = await post(makeEnv(db), {
      action: 'reject',
      conditions: { education: '大专', age_max: 30 },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.action).toBe('reject');
    expect(body.matched).toBe(1); // res-1：大专且年龄<=30
    expect(db.resumeState.get('res-1')).toMatchObject({ status: 'rejected', stage: 'rejected' });
    expect(db.resumeState.get('res-2').status).toBe('pending_screening');
    expect(db.resumeState.get('res-3').status).toBe('pending_screening');
  });

  it('excludes resumes without an age when an age condition is set', async () => {
    const db = makeDb({
      positions: [POSITION_ROW],
      resumes: [
        resumeRow({ id: 'res-1', education: '本科', parsed_data: JSON.stringify({}) }),
        resumeRow({ id: 'res-2', education: '本科', parsed_data: JSON.stringify({ age: 30 }) }),
      ],
    });
    const res = await post(makeEnv(db), {
      action: 'approve',
      conditions: { education: '本科', age_min: 20 },
    });
    const body = await res.json() as any;
    expect(body.matched).toBe(1);
    expect(body.resume_ids).toEqual(['res-2']);
  });

  it('falls back to parsed_data.highest_degree when the education column is empty', async () => {
    const db = makeDb({
      positions: [POSITION_ROW],
      resumes: [
        resumeRow({ id: 'res-1', education: '', screening_result: '通过', parsed_data: JSON.stringify({ highest_degree: '本科', age: 28 }) }),
        resumeRow({ id: 'res-2', education: '大专', screening_result: '通过', parsed_data: JSON.stringify({ highest_degree: '本科', age: 28 }) }),
      ],
    });
    const res = await post(makeEnv(db), {
      action: 'approve',
      conditions: { screening_result: '通过', education_min: '本科' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    // res-1 学历列空但 parsed_data 是本科 → 命中；res-2 学历列是大专 → 排除
    expect(body.matched).toBe(1);
    expect(db.resumeState.get('res-1')).toMatchObject({ status: 'approved' });
    expect(db.resumeState.get('res-2').status).toBe('pending_screening');
  });

  it('returns WHERE 0 when related_person matches nothing', async () => {
    const db = makeDb({ positions: [], resumes: [resumeRow({ id: 'res-1' })] });
    const res = await post(makeEnv(db), { action: 'approve', conditions: { related_person: '不存在的人' } });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.matched).toBe(0);
  });

  it('passes status/screening_result into the resume SQL', async () => {
    const db = makeDb({
      positions: [POSITION_ROW],
      resumes: [resumeRow({ id: 'res-1' })],
    });
    await post(makeEnv(db), {
      action: 'approve',
      conditions: { related_person: '黄维', status: 'pending_screening', screening_result: '通过' },
    });
    const sql = db.capturedResumeSql();
    expect(sql).toContain('status = ?');
    expect(sql).toContain('screening_result = ?');
    expect(sql).toContain('LIMIT ?');
    expect(db.capturedResumeParams()).toEqual(['pos-1', '软件工程师', '软件工程师', 'pending_screening', '通过', 200]);
  });
});
