import { afterEach, describe, expect, it } from 'vitest';
import worker from '../src/index';

const BASE = 'http://worker.local';
const SECRET = 'test-secret';

const MAPPINGS = [
  { raw_name: '护士', raw_names: null, mapped_name: '护士', responsible_person: '黄维' },
  { raw_name: '医生', raw_names: null, mapped_name: '医生', responsible_person: '李四' },
];

const RESUME_NURSE = {
  id: 'res-1',
  candidate_name: '王小明',
  mapped_position: '护士',
  position_applied: '护士',
  status: 'pending_interview',
  screening_result: '通过',
  ocr_markdown: '本人持有护士执业证书，在三甲医院工作三年。',
};

const RESUME_NO_MATCH = {
  id: 'res-2',
  candidate_name: '张三',
  mapped_position: '护士',
  position_applied: '护士',
  status: 'pending_interview',
  ocr_markdown: '无相关工作经历。',
};

const RESUME_DOCTOR = {
  id: 'res-3',
  candidate_name: '李四',
  mapped_position: '医生',
  position_applied: '医生',
  status: 'pending_interview',
  ocr_markdown: '持有医师执业证书。',
};

type MockOpts = {
  user?: Record<string, unknown>;
  mappings?: Array<Record<string, unknown>>;
  resumes?: Array<Record<string, unknown>>;
};

function makeDb(opts: MockOpts = {}) {
  const user = opts.user ?? { email: 'hr@x.com', full_name: '黄维', role: 'hr', is_active: 1 };
  const mappings = opts.mappings ?? MAPPINGS;
  const resumes = opts.resumes ?? [];
  return {
    prepare(sql: string) {
      const stmt = (params: unknown[]) => ({
        async first() {
          if (sql.includes('SELECT * FROM users WHERE email')) return user;
          return null; // system_configs 读取（提示词 / LLM 配置）走默认
        },
        async all() {
          if (sql.includes('FROM position_mappings') && sql.includes('responsible_person')) {
            const owner = String(params[0] ?? '');
            return { results: mappings.filter((m) => String(m.responsible_person ?? '') === owner) };
          }
          if (sql.includes('FROM position_mappings')) return { results: mappings };
          if (sql.includes('FROM resumes')) return { results: resumes };
          return { results: [] };
        },
        async run() {
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
  return {
    DB: db,
    SECRET_KEY: SECRET,
    AI_API_KEY: 'sk-test',
    AI_BASE_URL: 'https://api.deepseek.com',
    AI_MODEL: 'deepseek-v4-flash',
    AI_FALLBACK_ENABLED: 'false',
    ...overrides,
  } as any;
}

async function mintJwt(email: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const b64url = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ sub: email, exp: Math.floor(Date.now() / 1000) + 3600 }));
  const data = `${header}.${payload}`;
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  const sig = b64url(String.fromCharCode(...new Uint8Array(sigBuf)));
  return `${data}.${sig}`;
}

async function postCustomScreen(env: any, body: Record<string, unknown>) {
  const token = await mintJwt('hr@x.com');
  return worker.fetch(
    new Request(`${BASE}/api/resumes/custom-screen`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }),
    env,
  );
}

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('POST /api/resumes/custom-screen', () => {
  it('requires a non-empty condition', async () => {
    const db = makeDb({ resumes: [RESUME_NURSE] });
    const res = await postCustomScreen(makeEnv(db), { position: '护士', condition: '  ' });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.detail).toContain('筛选条件');
  });

  it('pre-filters by keyword, AI scores the pool and attaches custom_match', async () => {
    globalThis.fetch = (async () => new Response(
      JSON.stringify({ choices: [{ message: { content: '[{"id":"res-1","score":92,"reason":"持有护士执业证书，符合条件"}]' } }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )) as any;

    const db = makeDb({ resumes: [RESUME_NURSE, RESUME_NO_MATCH] });
    const res = await postCustomScreen(makeEnv(db), { position: '护士', condition: '持有护士证', threshold: 60 });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    // res-2 关键词零命中，被预筛排除
    expect(body.total).toBe(1);
    expect(body.items).toHaveLength(1);
    const item = body.items[0];
    expect(item.id).toBe('res-1');
    expect(item.standard_position).toBe('护士');
    expect(item.custom_match).toEqual({ score: 92, reason: '持有护士执业证书，符合条件', method: 'ai' });
  });

  it('falls back to keyword scoring when the AI call fails', async () => {
    globalThis.fetch = (async () => new Response('bad request', { status: 400 })) as any;

    const db = makeDb({ resumes: [RESUME_NURSE] });
    const res = await postCustomScreen(makeEnv(db), { position: '护士', condition: '持有护士证' });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    const item = body.items[0];
    // "持有护士证" → 持有/有护/护士/士证 共 4 个 token；正文命中 3 个 → 75 分
    expect(item.custom_match.method).toBe('keyword');
    expect(item.custom_match.score).toBe(75);
    expect(item.custom_match.reason).toContain('关键词命中 3/4');
  });

  it('filters a failed AI id back to keyword scoring', async () => {
    globalThis.fetch = (async () => new Response(
      JSON.stringify({ choices: [{ message: { content: '[]' } }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )) as any;

    const db = makeDb({ resumes: [RESUME_NURSE] });
    const res = await postCustomScreen(makeEnv(db), { position: '护士', condition: '持有护士证' });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.items[0].custom_match.method).toBe('keyword');
  });

  it('sorts results by score descending', async () => {
    const low = { ...RESUME_NURSE, id: 'res-low', ocr_markdown: '有护士资格证，经验一般。' };
    globalThis.fetch = (async () => new Response(
      JSON.stringify({ choices: [{ message: { content: '[{"id":"res-1","score":80,"reason":"a"},{"id":"res-low","score":55,"reason":"b"}]' } }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )) as any;

    const db = makeDb({ resumes: [low, RESUME_NURSE] });
    const res = await postCustomScreen(makeEnv(db), { position: '护士', condition: '持有护士证' });
    const body = await res.json() as any;
    expect(body.items[0].id).toBe('res-1');
    expect(body.items[1].id).toBe('res-low');
  });

  it('enforces HR owner isolation (only own positions)', async () => {
    const db = makeDb({ resumes: [RESUME_DOCTOR] });
    // 当前 HR=黄维 只负责「护士」，请求「医生」岗位不应返回任何简历
    const res = await postCustomScreen(makeEnv(db), { position: '医生', condition: '医师执业证' });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.total).toBe(0);
    expect(body.items).toEqual([]);
  });

  it('admins bypass owner isolation', async () => {
    globalThis.fetch = (async () => new Response(
      JSON.stringify({ choices: [{ message: { content: '[{"id":"res-3","score":88,"reason":"持有医师执业证"}]' } }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )) as any;

    const db = makeDb({
      user: { email: 'admin@x.com', full_name: '管理员', role: 'admin', is_active: 1 },
      resumes: [RESUME_DOCTOR],
    });
    const token = await mintJwt('admin@x.com');
    const res = await worker.fetch(
      new Request(`${BASE}/api/resumes/custom-screen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ position: '医生', condition: '医师执业证' }),
      }),
      makeEnv(db),
    );
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.total).toBe(1);
    expect(body.items[0].custom_match.method).toBe('ai');
  });

  it('bounds AI latency: slow AI falls back to keyword without hanging the request', async () => {
    // AI fetch 永不返回，靠路由内的全局截止时间兜底回退关键词，避免超过前端请求超时
    globalThis.fetch = (() => new Promise<never>(() => {})) as any;

    const db = makeDb({ resumes: [RESUME_NURSE] });
    const env = makeEnv(db, { CUSTOM_SCREEN_AI_TIMEOUT_MS: '50' });
    const res = await postCustomScreen(env, { position: '护士', condition: '持有护士证' });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.items.length).toBeGreaterThan(0);
    for (const item of body.items) {
      expect(item.custom_match.method).toBe('keyword');
    }
  });

  it('caps AI cost: requests small max_tokens and trimmed resume text', async () => {
    let sentBody: any;
    globalThis.fetch = (async (url: unknown, init: any) => {
      sentBody = JSON.parse(init.body as string);
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '[{"id":"res-1","score":92,"reason":"持有护士执业证书"}]' } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as any;

    const db = makeDb({ resumes: [RESUME_NURSE] });
    const res = await postCustomScreen(makeEnv(db), { position: '护士', condition: '持有护士证' });
    expect(res.status).toBe(200);
    expect(sentBody.max_tokens).toBe(1024);
  });
});
