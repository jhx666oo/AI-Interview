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

// 条件「持有护士证」→ 持有/有护/护士/士证 4 个 token；本条全命中 → 关键词分 100，跳过 AI
const RESUME_FULL_MATCH = {
  id: 'res-4',
  candidate_name: '赵六',
  mapped_position: '护士',
  position_applied: '护士',
  status: 'pending_interview',
  ocr_markdown: '持有护士证，完全符合条件。',
};

const RESUME_DOCTOR = {
  id: 'res-3',
  candidate_name: '李四',
  mapped_position: '医生',
  position_applied: '医生',
  status: 'pending_interview',
  ocr_markdown: '有医师资格，五年经验。',
};

type MockOpts = {
  user?: Record<string, unknown>;
  mappings?: Array<Record<string, unknown>>;
  resumes?: Array<Record<string, unknown>>;
  capture?: Array<{ sql: string; params: unknown[] }>;
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
          if (sql.includes('FROM resumes')) {
            opts.capture?.push({ sql, params });
            return { results: resumes };
          }
          if (sql.includes('FROM position_mappings') && sql.includes('responsible_person')) {
            const owner = String(params[0] ?? '');
            return { results: mappings.filter((m) => String(m.responsible_person ?? '') === owner) };
          }
          if (sql.includes('FROM position_mappings')) return { results: mappings };
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

async function authedRequest(env: any, path: string, method: string, body: Record<string, unknown>, email = 'hr@x.com') {
  const token = await mintJwt(email);
  return worker.fetch(
    new Request(`${BASE}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined,
    }),
    env,
  );
}

const postCustomScreen = (env: any, body: Record<string, unknown>) => authedRequest(env, '/api/resumes/custom-screen', 'POST', body);
const postScores = (env: any, body: Record<string, unknown>, email?: string) => authedRequest(env, '/api/resumes/custom-screen/scores', 'POST', body, email);

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('POST /api/resumes/custom-screen（第一层：关键词立即返回）', () => {
  it('requires a non-empty condition', async () => {
    const db = makeDb({ resumes: [RESUME_NURSE] });
    const res = await postCustomScreen(makeEnv(db), { position: '护士', condition: '  ' });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.detail).toContain('筛选条件');
  });

  it('returns keyword scores immediately and does not call the AI', async () => {
    // 若 POST 阶段误调 AI，会走到网络 fetch，这里直接抛错暴露
    globalThis.fetch = (() => { throw new Error('POST /custom-screen 不应调用 AI'); }) as any;

    const db = makeDb({ resumes: [RESUME_NURSE, RESUME_NO_MATCH] });
    const res = await postCustomScreen(makeEnv(db), { position: '护士', condition: '持有护士证', threshold: 60 });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    // res-2 关键词零命中，被预筛排除
    expect(body.total).toBe(1);
    expect(body.items).toHaveLength(1);
    expect(body.ai_pending).toBe(true);
    const item = body.items[0];
    expect(item.id).toBe('res-1');
    expect(item.standard_position).toBe('护士');
    // "持有护士证" → 持有/有护/护士/士证 共 4 个 token；正文命中 3 个 → 75 分
    expect(item.custom_match).toEqual({ score: 75, reason: '关键词命中 3/4：持有、有护、护士', method: 'keyword' });
  });

  it('sorts keyword-phase results by score descending', async () => {
    const db = makeDb({ resumes: [RESUME_FULL_MATCH, RESUME_NURSE] });
    const res = await postCustomScreen(makeEnv(db), { position: '护士', condition: '持有护士证' });
    const body = await res.json() as any;
    // 全命中 res-4 (100) 应排在 res-1 (75) 之前
    expect(body.items[0].id).toBe('res-4');
    expect(body.items[1].id).toBe('res-1');
  });

  it('prefilters candidates in SQL via LIKE and caps the transfer with LIMIT', async () => {
    const capture: Array<{ sql: string; params: unknown[] }> = [];
    const db = makeDb({ resumes: [RESUME_NURSE], capture });
    await postCustomScreen(makeEnv(db), { position: '护士', condition: '持有护士证' });
    const hit = capture.find((c) => c.sql.includes('FROM resumes'));
    expect(hit).toBeTruthy();
    // "持有护士证" → 持有/有护/护士/士证 4 个 len>=2 token → 4 组 LIKE（每组 4 列 = 16 个 ESCAPE）
    const escapes = (hit!.sql.match(/ESCAPE/g) || []).length;
    expect(escapes).toBe(16);
    expect(hit!.sql).toContain('LIMIT ?');
    expect(hit!.params).toContain('%持有%');
    expect(hit!.params).toContain('%士证%');
    // 2 个岗位参数 + 16 个 LIKE 参数 + 末尾的 LIMIT 值
    expect(hit!.params).toHaveLength(19);
    expect(hit!.params[hit!.params.length - 1]).toBe(1000);
  });

  it('excludes single-char tokens from the SQL LIKE prefilter', async () => {
    const capture: Array<{ sql: string; params: unknown[] }> = [];
    const db = makeDb({ resumes: [RESUME_NURSE], capture });
    await postCustomScreen(makeEnv(db), { position: '护士', condition: 'C语言' });
    const hit = capture.find((c) => c.sql.includes('FROM resumes'));
    // 只有 "语言" 1 个 len>=2 token → 1 组 LIKE（4 个 ESCAPE）；"c" 不进入 SQL
    const escapes = (hit!.sql.match(/ESCAPE/g) || []).length;
    expect(escapes).toBe(4);
    expect(hit!.params).not.toContain('%c%');
    expect(hit!.params).toContain('%语言%');
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
});

describe('POST /api/resumes/custom-screen/scores（第二层：AI 语义分后台补齐）', () => {
  it('returns AI semantic scores for keyword-matched resumes', async () => {
    globalThis.fetch = (async () => new Response(
      JSON.stringify({ choices: [{ message: { content: '[{"id":"res-1","score":92,"reason":"持有护士执业证书，符合条件"}]' } }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )) as any;

    const db = makeDb({ resumes: [RESUME_NURSE, RESUME_NO_MATCH] });
    const res = await postScores(makeEnv(db), { position: '护士', condition: '持有护士证', threshold: 60 });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ai_pending).toBe(false);
    expect(body.scores).toHaveLength(1);
    expect(body.scores[0]).toMatchObject({ id: 'res-1', score: 92 });
  });

  it('AI-scores all keyword-matched resumes including obvious hits (>=80%)', async () => {
    let callCount = 0;
    globalThis.fetch = (async () => { callCount++; return new Response(
      JSON.stringify({ choices: [{ message: { content: '[{"id":"res-1","score":80,"reason":"符合"},{"id":"res-4","score":95,"reason":"完全符合"}]' } }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ); }) as any;

    // 全量解析：res-1 (75%) 与 res-4 (100% 命中) 都进 AI 批次打分，不再跳过明显命中
    const db = makeDb({ resumes: [RESUME_NURSE, RESUME_FULL_MATCH] });
    const res = await postScores(makeEnv(db), { position: '护士', condition: '持有护士证' });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(callCount).toBe(1); // 2 份同批
    const ids = body.scores.map((s: any) => s.id).sort();
    expect(ids).toEqual(['res-1', 'res-4']);
  });

  it('keeps keyword scores when the AI call fails (returns empty scores)', async () => {
    globalThis.fetch = (async () => new Response('bad request', { status: 400 })) as any;

    const db = makeDb({ resumes: [RESUME_NURSE] });
    const res = await postScores(makeEnv(db), { position: '护士', condition: '持有护士证' });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.scores).toEqual([]);
  });

  it('bounds AI latency: slow AI returns empty scores without hanging the request', async () => {
    // AI fetch 永不返回，靠全局截止时间兜底，避免超过前端请求超时
    globalThis.fetch = (() => new Promise<never>(() => {})) as any;

    const db = makeDb({ resumes: [RESUME_NURSE] });
    const env = makeEnv(db, { CUSTOM_SCREEN_AI_TIMEOUT_MS: '50' });
    const res = await postScores(env, { position: '护士', condition: '持有护士证' });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.scores).toEqual([]);
  });

  it('caps AI cost: requests small max_tokens', async () => {
    let sentBody: any;
    globalThis.fetch = (async (url: unknown, init: any) => {
      sentBody = JSON.parse(init.body as string);
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '[{"id":"res-1","score":92,"reason":"持有护士执业证书"}]' } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as any;

    const db = makeDb({ resumes: [RESUME_NURSE] });
    const res = await postScores(makeEnv(db), { position: '护士', condition: '持有护士证' });
    expect(res.status).toBe(200);
    expect(sentBody.max_tokens).toBe(512);
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
    const res = await postScores(makeEnv(db), { position: '医生', condition: '医师执业证' }, 'admin@x.com');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.scores.length).toBeGreaterThan(0);
    expect(body.scores[0].id).toBe('res-3');
  });

  it('validates missing position/condition', async () => {
    const db = makeDb({ resumes: [] });
    const res = await postScores(makeEnv(db), {});
    expect(res.status).toBe(400);
  });
});
