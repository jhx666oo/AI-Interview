import { describe, expect, it, afterEach } from 'vitest';
import worker, { buildPersonResumeFilter, createResumeDecisionToken } from '../src/index';

const BASE = 'http://worker.local';

const POSITION_ROW = { id: 'pos-1', title: '软件工程师' };

const RESUME_ROW = {
  id: 'res-1',
  candidate_name: '王小明',
  mapped_position: '软件工程师',
  position_applied: '软件工程师',
  status: 'pending_interview',
  stage: 'interview',
  match_score: 85,
  screening_result: '通过',
  parse_status: 'ai_screened',
  created_at: '2026-08-05 09:00:00',
  updated_at: '2026-08-05 09:00:00',
};

type MockOpts = {
  positions?: Array<Record<string, unknown>>;
  mappings?: Array<Record<string, unknown>>;
  tasks?: Array<Record<string, unknown>>;
  interviews?: Array<Record<string, unknown>>;
  resumes?: Array<Record<string, unknown>>;
  interviewerMappings?: Array<Record<string, unknown>>;
  boundUsers?: Array<Record<string, unknown>>;
  fallbackUser?: Record<string, unknown> | null;
  settingsToken?: { token: string; expiry: number } | null;
};

function makeDb(opts: MockOpts = {}) {
  const resumeState = new Map<string, Record<string, unknown>>();
  for (const r of opts.resumes ?? []) resumeState.set(String(r.id), { ...r });
  const resumeRows = (sql: string, params: unknown[]) => {
    // SELECT * FROM resumes（决策 GET/POST）
    if (sql.includes('SELECT id, candidate_name, mapped_position, position_applied, status FROM resumes')) {
      return resumeState.get(String(params[0])) || null;
    }
    if (sql.includes('SELECT id, candidate_name FROM resumes')) {
      return resumeState.get(String(params[0])) || null;
    }
    if (sql.includes('SELECT id, status, stage FROM resumes')) {
      return resumeState.get(String(params[0])) || null;
    }
    return null;
  };

  return {
    resumeState,
    prepare(sql: string) {
      const stmt = (params: unknown[]) => ({
        async first() {
          if (sql.includes('SELECT value FROM settings')) {
            if (!opts.settingsToken) return null;
            return { value: JSON.stringify(opts.settingsToken) };
          }
          if (sql.includes('SELECT open_id FROM interviewer_mappings')) {
            return opts.interviewerMappings?.[0] || null;
          }
          if (sql.includes('SELECT feishu_open_id FROM users WHERE full_name')) {
            return opts.boundUsers?.[0] || null;
          }
          if (sql.includes('SELECT email FROM users WHERE feishu_token')) {
            return opts.fallbackUser || null;
          }
          if (sql.includes('COUNT(*)') && sql.includes('FROM resumes')) {
            return { cnt: resumeState.size };
          }
          const resume = resumeRows(sql, params);
          if (resume) return resume;
          return null;
        },
        async all() {
          if (sql.includes('SELECT open_id FROM interviewer_mappings')) return { results: opts.interviewerMappings ?? [] };
          if (sql.includes('SELECT feishu_open_id FROM users WHERE full_name')) return { results: opts.boundUsers ?? [] };
          if (sql.includes('FROM positions')) return { results: opts.positions ?? [] };
          if (sql.includes('FROM position_mappings')) return { results: opts.mappings ?? [] };
          if (sql.includes('FROM recruitment_tasks')) return { results: opts.tasks ?? [] };
          if (sql.includes('FROM interviews')) return { results: opts.interviews ?? [] };
          if (sql.includes('FROM resumes')) return { results: [...resumeState.values()] };
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

describe('buildPersonResumeFilter', () => {
  it('combines positions/mappings/tasks/interviews into OR branches', async () => {
    const db = makeDb({
      positions: [POSITION_ROW],
      mappings: [{ raw_name: '研发工程师', mapped_name: '软件工程师', responsible_person: '黄维', interviewers: '[]' }],
      tasks: [{ position_name: '测试工程师', responsible_person: '', interviewers: '["黄维"]' }],
      interviews: [{ resume_id: 'res-iv-1' }],
    });
    const { where, params } = await buildPersonResumeFilter(db as any, '黄维');
    expect(where).toContain('position_id IN (?)');
    expect(where).toContain('LOWER(mapped_position) IN (?,?)');
    expect(where).toContain('LOWER(position_applied) IN (?,?,?)');
    expect(where).toContain('id IN (?)');
    expect(params).toEqual(['pos-1', '软件工程师', '测试工程师', '软件工程师', '研发工程师', '测试工程师', 'res-iv-1']);
  });

  it('returns WHERE 0 when nothing matches', async () => {
    const db = makeDb();
    const { where, params } = await buildPersonResumeFilter(db as any, '不存在的人');
    expect(where).toBe('0');
    expect(params).toEqual([]);
  });

  it('treats comma-separated interviewers as names', async () => {
    const db = makeDb({
      mappings: [{ raw_name: '前端工程师', mapped_name: '前端工程师', responsible_person: '', interviewers: '张三,黄维' }],
    });
    const { params } = await buildPersonResumeFilter(db as any, '黄维');
    expect(params).toContain('前端工程师');
  });
});

describe('GET /api/public/person/:name/resumes', () => {
  it('returns resumes with progress fields only (no sensitive fields)', async () => {
    const db = makeDb({ positions: [POSITION_ROW], resumes: [RESUME_ROW] });
    const res = await worker.fetch(new Request(`${BASE}/api/public/person/${encodeURIComponent('黄维')}/resumes`), makeEnv(db));
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.person).toBe('黄维');
    expect(body.total).toBe(1);
    expect(body.limit).toBe(50);
    expect(body.offset).toBe(0);
    expect(body.items).toHaveLength(1);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('contact');
    expect(serialized).not.toContain('email');
    expect(serialized).not.toContain('raw_text');
    expect(serialized).not.toContain('parsed_data');
  });

  it('passes limit/offset/status into the resume SQL', async () => {
    let capturedSql = '';
    let capturedParams: unknown[] = [];
    const db = {
      prepare(sql: string) {
        return {
          bind: (...params: unknown[]) => {
            if (sql.includes('FROM resumes') && sql.includes('LIMIT ? OFFSET ?')) {
              capturedSql = sql;
              capturedParams = params;
            }
            return {
              first: async () => {
                if (sql.includes('SELECT value FROM settings')) return null;
                if (sql.includes('COUNT(*)') && sql.includes('FROM resumes')) return { cnt: 1 };
                return null;
              },
              all: async () => {
                if (sql.includes('FROM positions')) return { results: [POSITION_ROW] };
                if (sql.includes('FROM resumes')) return { results: [RESUME_ROW] };
                return { results: [] };
              },
              run: async () => ({ meta: { changes: 1 } }),
            };
          },
          run: async () => ({ meta: { changes: 1 } }),
        };
      },
    };
    const env = makeEnv(db);
    const res = await worker.fetch(
      new Request(`${BASE}/api/public/person/${encodeURIComponent('黄维')}/resumes?limit=5&offset=10&status=rejected`),
      env,
    );
    expect(res.status).toBe(200);
    expect(capturedSql).toContain('LIMIT ? OFFSET ?');
    expect(capturedSql).toContain('AND status = ?');
    // 岗位标题同时匹配 mapped_position 与 position_applied 两个分支，之后是 status、limit、offset
    expect(capturedParams).toEqual(['pos-1', '软件工程师', '软件工程师', 'rejected', 5, 10]);
  });
});

describe('decision token + /api/public/resume/:id/decision', () => {
  it('rejects a bad token with 403', async () => {
    const db = makeDb({ resumes: [RESUME_ROW] });
    const res = await worker.fetch(
      new Request(`${BASE}/api/public/resume/res-1/decision?t=bogus`),
      makeEnv(db),
    );
    expect(res.status).toBe(403);
  });

  it('rejects an expired token with 403 even with a valid signature', async () => {
    const db = makeDb({ resumes: [RESUME_ROW] });
    const env = makeEnv(db);
    // 手工构造签名正确但已过期的 token
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode('test-secret'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const pastExpiry = Math.floor(Date.now() / 1000) - 100;
    const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(`res-1:${pastExpiry}`));
    const sig = btoa(String.fromCharCode(...new Uint8Array(sigBuf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const expiredToken = `${pastExpiry}.${sig}`;
    const res = await worker.fetch(new Request(`${BASE}/api/public/resume/res-1/decision?t=${expiredToken}`), env);
    expect(res.status).toBe(403);
  });

  it('shows the decision page and approves the resume', async () => {
    const db = makeDb({ resumes: [RESUME_ROW] });
    const env = makeEnv(db);
    const token = await createResumeDecisionToken(env, 'res-1');

    const page = await worker.fetch(new Request(`${BASE}/api/public/resume/res-1/decision?t=${token}`), env);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('王小明');
    expect(html).toContain('入库');

    const form = new FormData();
    form.set('token', token);
    form.set('action', 'approve');
    const res = await worker.fetch(new Request(`${BASE}/api/public/resume/res-1/decision`, { method: 'POST', body: form }), env);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('已入库');
    expect(db.resumeState.get('res-1')).toMatchObject({ status: 'approved', stage: 'talent_pool' });
  });

  it('rejects the resume from the decision page', async () => {
    const db = makeDb({ resumes: [RESUME_ROW] });
    const env = makeEnv(db);
    const token = await createResumeDecisionToken(env, 'res-1');

    const form = new FormData();
    form.set('token', token);
    form.set('action', 'reject');
    const res = await worker.fetch(new Request(`${BASE}/api/public/resume/res-1/decision`, { method: 'POST', body: form }), env);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('已不入库');
    expect(db.resumeState.get('res-1')).toMatchObject({ status: 'rejected', stage: 'rejected' });
  });
});

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('POST /api/public/person/:name/export', () => {
  it('requires an API key or JWT', async () => {
    const db = makeDb({ positions: [POSITION_ROW], resumes: [RESUME_ROW] });
    const res = await worker.fetch(
      new Request(`${BASE}/api/public/person/${encodeURIComponent('黄维')}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ form: 'cards' }),
      }),
      makeEnv(db),
    );
    expect(res.status).toBe(401);
  });

  it('returns a documented error when the person has no Feishu binding', async () => {
    const db = makeDb({ positions: [POSITION_ROW], resumes: [RESUME_ROW] });
    const res = await worker.fetch(
      new Request(`${BASE}/api/public/person/${encodeURIComponent('黄维')}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': 'test-api-key' },
        body: JSON.stringify({ form: 'cards' }),
      }),
      makeEnv(db),
    );
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.detail).toContain('未找到');
    expect(body.hint).toContain('batch-sync');
  });

  it('returns a documented error when multiple bindings match', async () => {
    const db = makeDb({
      positions: [POSITION_ROW],
      resumes: [RESUME_ROW],
      interviewerMappings: [{ open_id: 'ou_a' }, { open_id: 'ou_b' }],
    });
    const res = await worker.fetch(
      new Request(`${BASE}/api/public/person/${encodeURIComponent('黄维')}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': 'test-api-key' },
        body: JSON.stringify({ form: 'cards' }),
      }),
      makeEnv(db),
    );
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.hint).toContain('清理重复映射');
  });

  it('sends person cards when form=cards', async () => {
    const sent: Array<{ receiveId: string; content: string }> = [];
    globalThis.fetch = (async (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('/im/v1/messages')) {
        const body = JSON.parse(init?.body || '{}');
        sent.push({ receiveId: body.receive_id, content: body.content });
        return new Response(JSON.stringify({ code: 0, data: { message_id: 'msg-test' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ code: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    const db = makeDb({
      positions: [POSITION_ROW],
      resumes: [RESUME_ROW],
      interviewerMappings: [{ open_id: 'ou_huangwei' }],
      settingsToken: { token: 'bot-tok', expiry: Date.now() + 60 * 60 * 1000 },
    });
    const res = await worker.fetch(
      new Request(`${BASE}/api/public/person/${encodeURIComponent('黄维')}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': 'test-api-key' },
        body: JSON.stringify({ form: 'cards' }),
      }),
      makeEnv(db),
    );
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
    expect(body.form).toBe('cards');
    expect(body.delivered).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].receiveId).toBe('ou_huangwei');
    const card = JSON.parse(sent[0].content);
    expect(card.header.title.content).toContain('王小明');
  });
});
