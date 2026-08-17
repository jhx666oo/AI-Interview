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
  hit_count: 3, // SQL hit_count（"持有护士证"→持有/有护/护士/士证 命中 3 个）
};

const RESUME_NO_MATCH = {
  id: 'res-2',
  candidate_name: '张三',
  mapped_position: '护士',
  position_applied: '护士',
  status: 'pending_interview',
  ocr_markdown: '无相关工作经历。',
  hit_count: 0,
};

// 条件「持有护士证」→ 持有/有护/护士/士证 4 个 token；本条全命中 → 关键词分 100，跳过 AI
const RESUME_FULL_MATCH = {
  id: 'res-4',
  candidate_name: '赵六',
  mapped_position: '护士',
  position_applied: '护士',
  status: 'pending_interview',
  ocr_markdown: '持有护士证，完全符合条件。',
  hit_count: 4,
};

const RESUME_DOCTOR = {
  id: 'res-3',
  candidate_name: '李四',
  mapped_position: '医生',
  position_applied: '医生',
  status: 'pending_interview',
  ocr_markdown: '有医师资格，五年经验。',
  hit_count: 2,
};

type MockOpts = {
  user?: Record<string, unknown>;
  mappings?: Array<Record<string, unknown>>;
  resumes?: Array<Record<string, unknown>>;
  capture?: Array<{ sql: string; params: unknown[] }>;
  systemConfigs?: Record<string, unknown>;
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
          if (sql.includes('FROM system_configs')) return opts.systemConfigs ?? null;
          return null; // 其他 system_configs 读取（提示词等）走默认
        },
        async all() {
          if (sql.includes('FROM resumes')) {
            opts.capture?.push({ sql, params });
            // 模拟 SQL 预筛：用绑定参数里 %..% 的 LIKE 模式过滤（真实 D1 在 WHERE 里做）
            const likePatterns = (params || []).filter(
              (p) => typeof p === 'string' && /^%.+%$/.test(p),
            );
            let result = resumes;
            if (likePatterns.length > 0) {
              const textOf = (r: any) =>
                [r.ocr_markdown, r.raw_text, r.resume_markdown, r.parsed_data].filter(Boolean).join(' ').toLowerCase();
              result = resumes.filter((r) =>
                likePatterns.some((p) => textOf(r).includes(p.slice(1, -1).toLowerCase())),
              );
            }
            return { results: result };
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
    // 不再 SQL 预筛：该岗位全部简历（res-1、res-2）都返回关键词粗分，AI 后续对全量打分
    expect(body.total).toBe(2);
    expect(body.items).toHaveLength(2);
    expect(body.ai_pending).toBe(true);
    const item = body.items.find((i: any) => i.id === 'res-1');
    expect(item.standard_position).toBe('护士');
    // "持有护士证" → 持有/有护/护士/士证 共 4 个 token；res-1 命中 3 个 → 75 分（matched 列出命中词）
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

  it('does not prefilter in SQL: fetches all position resumes and caps with LIMIT', async () => {
    const capture: Array<{ sql: string; params: unknown[] }> = [];
    const db = makeDb({ resumes: [RESUME_NURSE], capture });
    await postCustomScreen(makeEnv(db), { position: '护士', condition: '持有护士证' });
    const hit = capture.find((c) => c.sql.includes('FROM resumes'));
    expect(hit).toBeTruthy();
    // 去掉 SQL 关键词预筛：不再生成 LIKE/ESCAPE 组，也不再 SELECT hit_count CASE
    expect(hit!.sql).not.toContain('LIKE');
    expect(hit!.sql).not.toContain('ESCAPE');
    expect(hit!.sql).not.toContain('AS hit_count');
    expect(hit!.sql).not.toContain('CASE WHEN');
    expect(hit!.sql).toContain('LIMIT ?');
    // 只 bind 岗位别名（mapped_position IN 与 position_applied IN 各一次）+ LIMIT 值
    expect(hit!.params).toHaveLength(3);
    expect(hit!.params[0]).toBe('护士');
    expect(hit!.params[hit!.params.length - 1]).toBe(1000);
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
    globalThis.fetch = (async (_url: unknown, init: any) => {
      // 只统计 AI 打分请求（含 #id:），忽略缺摘要简历的补解析请求
      if (String(init.body ?? '').includes('#id:')) callCount++;
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '[{"id":"res-1","score":80,"reason":"符合"},{"id":"res-4","score":95,"reason":"完全符合"}]' } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as any;

    // 全量解析：res-1 (75%) 与 res-4 (100% 命中) 都进 AI 批次打分，不再跳过明显命中
    const db = makeDb({ resumes: [RESUME_NURSE, RESUME_FULL_MATCH] });
    const res = await postScores(makeEnv(db), { position: '护士', condition: '持有护士证' });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(callCount).toBe(1); // 2 份同批
    const ids = body.scores.map((s: any) => s.id).sort();
    expect(ids).toEqual(['res-1', 'res-4']);
  });

  it('shards the pool across multiple configured LLMs concurrently', async () => {
    const calls: string[][] = [];
    globalThis.fetch = (async (_url: unknown, init: any) => {
      const body = init.body as string;
      const ids = [...body.matchAll(/#id:([A-Za-z0-9_-]+)/g)].map((m) => m[1]);
      if (ids.length) calls.push(ids);
      const content = ids.map((id) => JSON.stringify({ id, score: 80, reason: '符合' }));
      return new Response(
        JSON.stringify({ choices: [{ message: { content: `[${content.join(',')}]` } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as any;

    // 配置了 2 个 LLM（system_configs 有 2 组 key）→ 候选池分 2 片，各配置并发处理一片
    const db = makeDb({
      resumes: [RESUME_NURSE, RESUME_FULL_MATCH],
      systemConfigs: {
        llm_api_key: 'sk-a', llm_base_url: 'https://api.a.com/v1', llm_model: 'model-a',
        llm2_api_key: 'sk-b', llm2_base_url: 'https://api.b.com/v1', llm2_model: 'model-b',
      },
    });
    const res = await postScores(makeEnv(db), { position: '护士', condition: '持有护士证' });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(calls.length).toBe(2); // 两个配置各处理一片（每片 1 份 → 各 1 批）
    const seen = calls.flat();
    expect(seen.sort()).toEqual(['res-1', 'res-4']);
    expect(body.scores.map((s: any) => s.id).sort()).toEqual(['res-1', 'res-4']);
  });

  it('bounds per-config AI batch concurrency to avoid rate limiting', async () => {
    // 20 份简历 → BATCH=8 → 3 批；若全部批次同时打同一 API 会限流全挂，这里断言并发峰值 ≤ 3
    const resumes = Array.from({ length: 20 }, (_, i) => ({
      id: `res-${i + 1}`,
      candidate_name: `候选人${i + 1}`,
      mapped_position: '护士',
      position_applied: '护士',
      status: 'pending_interview',
      ocr_markdown: `第${i + 1}份简历，本人持有护士资格证和护士执业证，临床工作多年。`,
    }));
    let active = 0, peak = 0;
    const calls: string[][] = [];
    globalThis.fetch = (async (_url: unknown, init: any) => {
      active++;
      peak = Math.max(peak, active);
      try {
        const body = init.body as string;
        const ids = [...body.matchAll(/#id:([A-Za-z0-9_-]+)/g)].map((m) => m[1]);
        if (ids.length) calls.push(ids);
        await new Promise(r => setTimeout(r, 20));
        const content = ids.map((id) => JSON.stringify({ id, score: 80, reason: '符合' }));
        return new Response(
          JSON.stringify({ choices: [{ message: { content: `[${content.join(',')}]` } }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      } finally {
        active--;
      }
    }) as any;

    const db = makeDb({ resumes });
    const res = await postScores(makeEnv(db), { position: '护士', condition: '持有护士证' });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(peak).toBeLessThanOrEqual(3); // 并发受限，不打爆 API
    expect(calls.length).toBe(3); // 20 份 / BATCH 8 → 8+8+4 三批
    expect(body.scores).toHaveLength(20); // 全部简历都拿到语义分，无整批失败
    const gotIds = new Set(body.scores.map((s: any) => s.id));
    expect(gotIds).toEqual(new Set(Array.from({ length: 20 }, (_, i) => `res-${i + 1}`)));
  });

  it('keeps keyword scores when the AI call fails (returns empty scores)', async () => {
    globalThis.fetch = (async () => new Response('bad request', { status: 400 })) as any;

    const db = makeDb({ resumes: [RESUME_NURSE] });
    const res = await postScores(makeEnv(db), { position: '护士', condition: '持有护士证' });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.scores).toEqual([]);
  });

  it('surfaces the real ai_error when all AI batches fail (for diagnosis)', async () => {
    globalThis.fetch = (async () => new Response('invalid key', { status: 401 })) as any;

    const db = makeDb({ resumes: [RESUME_NURSE] });
    const res = await postScores(makeEnv(db), { position: '护士', condition: '持有护士证' });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.scores).toEqual([]);
    expect(typeof body.ai_error).toBe('string');
    expect(body.ai_error.length).toBeGreaterThan(0);
  });

  it('bounds AI latency: slow AI returns empty scores without hanging the request', async () => {
    // AI fetch 永不返回，靠全局截止时间兜底，避免超过前端请求超时。
    // 简历带摘要（hasSummary），跳过补解析，只测打分阶段不挂死。
    globalThis.fetch = (() => new Promise<never>(() => {})) as any;

    const db = makeDb({
      resumes: [{ ...RESUME_NURSE, parsed_data: JSON.stringify({ highest_degree: '大专', certifications: ['护士执业证书'] }) }],
    });
    const env = makeEnv(db, { CUSTOM_SCREEN_AI_TIMEOUT_MS: '50' });
    const res = await postScores(env, { position: '护士', condition: '持有护士证' });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.scores).toEqual([]);
  });

  it('caps AI cost: keeps max_tokens modest', async () => {
    let sentBody: any;
    globalThis.fetch = (async (url: unknown, init: any) => {
      // 只记录 AI 打分请求（含 #id:），忽略缺摘要简历的补解析请求
      if (String(init.body ?? '').includes('#id:')) sentBody = JSON.parse(init.body as string);
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '[{"id":"res-1","score":92,"reason":"持有护士执业证书"}]' } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as any;

    const db = makeDb({ resumes: [RESUME_NURSE] });
    const res = await postScores(makeEnv(db), { position: '护士', condition: '持有护士证' });
    expect(res.status).toBe(200);
    expect(sentBody.max_tokens).toBe(2048); // 8 份简历的 JSON 输出，留足空间避免截断整批空分
  });

  it('recovers scores when AI returns a single object instead of an array', async () => {
    globalThis.fetch = (async () => new Response(
      JSON.stringify({ choices: [{ message: { content: '{"id":"res-1","score":92,"reason":"持有护士执业证书，符合"}' } }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )) as any;

    const db = makeDb({ resumes: [RESUME_NURSE] });
    const res = await postScores(makeEnv(db), { position: '护士', condition: '持有护士证' });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.scores).toHaveLength(1);
    expect(body.scores[0]).toMatchObject({ id: 'res-1', score: 92 });
  });

  it('recovers complete entries from a truncated JSON array', async () => {
    // 输出被 max_tokens 截断：第二个对象不完整 → 只恢复第一个完整项，避免整批空分
    globalThis.fetch = (async () => new Response(
      JSON.stringify({ choices: [{ message: { content: '[{"id":"res-1","score":92,"reason":"符合"},{"id":"res-2","score":60,"reason":"部分符' } }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )) as any;

    const db = makeDb({ resumes: [RESUME_NURSE, RESUME_NO_MATCH] });
    const res = await postScores(makeEnv(db), { position: '护士', condition: '持有护士证' });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.scores).toHaveLength(1);
    expect(body.scores[0]).toMatchObject({ id: 'res-1', score: 92 });
  });

  it('sends the full resume text to AI, so certifications later in the resume stay visible', async () => {
    // 全文送达（非截前 400 字符）：护士证/执业证在简历中后部时 AI 也必须看得到，否则误判低分被阈值过滤漏人
    const longPrefix = '多年临床护理经历，负责病房日常护理与患者照护。'.repeat(20); // ~460 字符，不含护士证
    const longResume = {
      id: 'res-9',
      candidate_name: '美云',
      mapped_position: '护士',
      position_applied: '护士',
      status: 'pending_interview',
      ocr_markdown: `${longPrefix}\n持有护士执业证书和护士资格证，在养老院工作五年。`,
    };
    let sentText = '';
    globalThis.fetch = (async (_url: unknown, init: any) => {
      sentText = String(init.body ?? '');
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '[{"id":"res-9","score":90,"reason":"持有护士执业证书"}]' } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as any;

    const db = makeDb({ resumes: [longResume] });
    const res = await postScores(makeEnv(db), { position: '护士', condition: '有护士证' });
    expect(res.status).toBe(200);
    // 全量文本送达：中后部的资格证据与工作经历 AI 一定看得到
    expect(sentText).toContain('护士执业证书');
    expect(sentText).toContain('护士资格证');
    expect(sentText).toContain('养老院');
    expect(sentText).toContain(longPrefix.slice(0, 50)); // 简历开头也在
  });

  it('includes the AI-parsed structured summary in what is sent to the AI', async () => {
    // 原文缺失/质量差时，AI 解析摘要（证书/资质、工作经历等）仍能提供资格证据
    const resumeWithParsed = {
      id: 'res-11',
      candidate_name: '邓田利',
      mapped_position: '护士',
      position_applied: '护士',
      status: 'pending_interview',
      ocr_markdown: '',
      parsed_data: JSON.stringify({
        highest_degree: '大专',
        certifications: ['护士执业证书', '护士资格证'],
        work_experience: [{ company: '养老院', title: '护士', duration: '2020-2023', description: '负责老人日常护理' }],
      }),
    };
    let sentText = '';
    globalThis.fetch = (async (_url: unknown, init: any) => {
      sentText = String(init.body ?? '');
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '[{"id":"res-11","score":88,"reason":"持有护士执业证书"}]' } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as any;

    const db = makeDb({ resumes: [resumeWithParsed] });
    const res = await postScores(makeEnv(db), { position: '护士', condition: '有护士证' });
    expect(res.status).toBe(200);
    expect(sentText).toContain('证书/资质');
    expect(sentText).toContain('护士执业证书');
    expect(sentText).toContain('养老院');
    expect(sentText).toContain('工作经历');
  });

  it('screens only the AI-parsed summary, not the raw resume text', async () => {
    // 用户要求自定义筛选只依据 AI 解析摘要（详情页 Descriptions 同源）：有摘要时原文不作为筛选依据
    const resume = {
      id: 'res-12',
      candidate_name: '王小妹',
      mapped_position: '护士',
      position_applied: '护士',
      status: 'pending_interview',
      ocr_markdown: '这段原文不含护士证相关信息，仅作噪声。',
      parsed_data: JSON.stringify({
        highest_degree: '中专',
        certifications: ['护士执业证书'],
        work_experience: [{ company: '县医院', title: '护士', duration: '2019-2024', description: '住院部护理' }],
      }),
    };
    let sentText = '';
    globalThis.fetch = (async (_url: unknown, init: any) => {
      sentText = String(init.body ?? '');
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '[{"id":"res-12","score":86,"reason":"持有护士执业证书"}]' } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as any;

    const db = makeDb({ resumes: [resume] });
    const res = await postScores(makeEnv(db), { position: '护士', condition: '有护士证' });
    expect(res.status).toBe(200);
    expect(sentText).toContain('证书/资质');
    expect(sentText).toContain('护士执业证书');
    expect(sentText).toContain('县医院');
    expect(sentText).not.toContain('这段原文不含护士证'); // 原文不作为筛选依据
  });

  it('reparses resumes without a structured summary from raw text before scoring', async () => {
    // 没有 AI 解析摘要的简历：先用原始文本补解析出完整字段（含证书/资质），本轮就用新摘要打分
    const noSummaryResume = {
      id: 'res-13',
      candidate_name: '毛琴',
      mapped_position: '护士',
      position_applied: '护士',
      status: 'pending_interview',
      ocr_markdown: '中专毕业，在县医院做了五年护士，持有护士执业证书。',
    };
    const sentBodies: string[] = [];
    let call = 0;
    globalThis.fetch = (async (_url: unknown, init: any) => {
      call++;
      sentBodies.push(String(init.body ?? ''));
      if (call === 1) {
        // 补解析：返回完整结构化字段（含证书/资质、工作经历）
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
          highest_degree: '中专',
          certifications: ['护士执业证书', '护士资格证'],
          work_experience: [{ company: '县医院', title: '护士', duration: '2019-2024' }],
        }) } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '[{"id":"res-13","score":90,"reason":"持有护士执业证书"}]' } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as any;

    const db = makeDb({ resumes: [noSummaryResume] });
    const res = await postScores(makeEnv(db), { position: '护士', condition: '有护士证' });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.scores).toHaveLength(1);
    expect(body.scores[0]).toMatchObject({ id: 'res-13', score: 90 });
    // 补解析后的结构化摘要（证书/资质）进入 AI 打分请求
    const scoreBody = sentBodies[sentBodies.length - 1];
    expect(scoreBody).toContain('证书/资质');
    expect(scoreBody).toContain('护士执业证书');
  });

  it('degrades only abnormally long resumes to stay within the AI context budget', async () => {
    // 单份全文 9000+ 字符：超过单份上限 → 降级为「开头 + 关键词证据窗口」，
    // 末尾的资格信息仍通过证据窗口送达 AI，且不会把 9000+ 字符全塞进 prompt 爆上下文
    const filler = '从事临床护理工作，负责患者日常照护与护理记录。'.repeat(400); // ~9600 字符
    const longResume = {
      id: 'res-10',
      candidate_name: '刘彩华',
      mapped_position: '护士',
      position_applied: '护士',
      status: 'pending_interview',
      ocr_markdown: `${filler}最后一段：持有护士执业证书。`,
    };
    let sentText = '';
    globalThis.fetch = (async (_url: unknown, init: any) => {
      sentText = String(init.body ?? '');
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '[{"id":"res-10","score":85,"reason":"持有护士执业证书"}]' } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as any;

    const db = makeDb({ resumes: [longResume] });
    const res = await postScores(makeEnv(db), { position: '护士', condition: '有护士证' });
    expect(res.status).toBe(200);
    expect(sentText).toContain('护士执业证书'); // 证据窗口保留资格信息
    expect(sentText.length).toBeLessThan(7000); // 降级后单份文本受控，不把 9600+ 字符全塞进 prompt
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
