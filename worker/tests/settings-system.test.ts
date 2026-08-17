import { describe, expect, it } from 'vitest';
import worker from '../src/index';

const SECRET = 'settings-system-test-secret';
const BASE = 'http://test.local';

/** 内存 D1 mock：system_configs 单行 + users（admin） */
function makeDb(initialLlmSlots: unknown = null) {
  const cfg: any = {
    id: 'cfg-1',
    llm_slots: initialLlmSlots === null ? null : JSON.stringify(initialLlmSlots),
    screening_rules: '',
    updated_at: '2026-08-17T00:00:00.000Z',
  };
  const users = [
    { id: 'u-admin', email: 'admin@x.com', full_name: 'Admin', role: 'admin', is_active: 1, hashed_password: 'x' },
  ];
  const runFirst = async (sql: string, args: any[]) => {
    if (/SELECT \* FROM system_configs ORDER BY updated_at DESC LIMIT 1/.test(sql)) return cfg ? { ...cfg } : null;
    if (/SELECT id FROM system_configs ORDER BY updated_at DESC LIMIT 1/.test(sql)) return cfg ? { id: cfg.id } : null;
    if (/SELECT llm_slots FROM system_configs WHERE id = \?/.test(sql)) return cfg ? { llm_slots: cfg.llm_slots } : null;
    if (/SELECT \* FROM users WHERE email = \?/.test(sql)) return users.find((u) => u.email === args[0]) || null;
    return null;
  };
  const runAll = async () => ({ results: [] });
  const runUpdate = async (sql: string, args: any[]) => {
    if (/UPDATE system_configs SET llm_slots/.test(sql)) {
      cfg.llm_slots = args[0]; // 首个参数是 llm_slots 的 JSON 字符串
    }
    return { success: true };
  };
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: any[]) {
          return {
            async first() { return runFirst(sql, args); },
            async all() { return runAll(); },
            async run() { return runUpdate(sql, args); },
          };
        },
        async first() { return runFirst(sql, []); },
        async all() { return runAll(); },
        async run() { return runUpdate(sql, []); },
      };
    },
    dump: () => JSON.parse(cfg.llm_slots || '[]'),
  };
  return db;
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

function makeEnv(db: any) {
  return {
    DB: db,
    SECRET_KEY: SECRET,
    AI_API_KEY: 'sk-test',
    AI_BASE_URL: 'https://api.deepseek.com',
    AI_MODEL: 'deepseek-v4-flash',
    AI_FALLBACK_ENABLED: 'false',
  } as any;
}

async function authedRequest(env: any, path: string, method: string, body?: unknown) {
  const token = await mintJwt('admin@x.com');
  return worker.fetch(
    new Request(`${BASE}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  );
}

describe('AI 模型配置保存：添加新模型不覆盖已有模型', () => {
  it('存量无 id 槽位：GET 自动补 id，保存新增模型后旧模型仍在', async () => {
    // 模拟修复前保存的存量数据：无 id 的两个旧槽位
    const db = makeDb([
      { baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash', apiKey: 'sk-old-1' },
      { baseUrl: 'https://token.sensenova.cn/v1', model: 'deepseek-v4-flash', apiKey: 'sk-old-2' },
    ]);
    const env = makeEnv(db);

    // 1) 前端打开页面 GET：后端应给存量槽位补 id 并持久化
    const getRes = await authedRequest(env, '/api/settings/system', 'GET');
    expect(getRes.status).toBe(200);
    const settings = await getRes.json();
    const loaded = settings.llm_slots;
    expect(Array.isArray(loaded)).toBe(true);
    expect(loaded).toHaveLength(2);
    expect(loaded[0].id).toBeTruthy();
    expect(loaded[0].apiKeySet).toBe(true); // key 存在但不回填
    expect(loaded[0].apiKey || '').toBe('');
    const id1 = loaded[0].id;
    const id2 = loaded[1].id;

    // 补 id 已持久化到 DB
    const persisted = db.dump();
    expect(persisted).toHaveLength(2);
    expect(persisted[0].id).toBe(id1);

    // 2) 前端保存：旧槽位不重填 key（apiKey 空），新增一个模型
    const putRes = await authedRequest(env, '/api/settings/system', 'PUT', {
      llm_slots: [
        { id: id1, baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash', apiKey: '' },
        { id: id2, baseUrl: 'https://token.sensenova.cn/v1', model: 'deepseek-v4-flash', apiKey: '' },
        { baseUrl: 'https://opencode.ai/zen/v1', model: 'deepseek-v4-flash-free', apiKey: 'sk-new-3' },
      ],
    });
    expect(putRes.status).toBe(200);

    // 3) 关键断言：保存后 3 个模型都在，旧模型的 key 原样保留
    const saved = db.dump();
    expect(saved).toHaveLength(3);
    const keys = saved.map((s: any) => s.apiKey);
    expect(keys).toContain('sk-old-1'); // 第一个旧 key 保留
    expect(keys).toContain('sk-old-2'); // 第二个旧 key 保留
    expect(keys).toContain('sk-new-3'); // 新增模型写入
    expect(saved[0].id).toBe(id1); // 旧槽位 id 不变
    expect(saved[1].id).toBe(id2);
  });

  it('连续两次新增模型，旧模型都保留（模拟真实使用）', async () => {
    const db = makeDb([]); // 空配置开始
    const env = makeEnv(db);

    // 第一次保存：加 2 个
    await authedRequest(env, '/api/settings/system', 'PUT', {
      llm_slots: [
        { baseUrl: 'https://api.agnes-ai.cn/v1', model: 'agnes-2.5-flash', apiKey: 'sk-a' },
        { baseUrl: 'https://token.sensenova.cn/v1', model: 'deepseek-v4-flash', apiKey: 'sk-b' },
      ],
    });
    expect(db.dump()).toHaveLength(2);

    // 重新加载（GET 补 id）→ 前端拿到带 id 槽位
    const getRes = await authedRequest(env, '/api/settings/system', 'GET');
    const loaded = (await getRes.json()).llm_slots as any[];
    expect(loaded).toHaveLength(2);

    // 第二次保存：旧槽位不重填 key，追加 1 个新模型
    await authedRequest(env, '/api/settings/system', 'PUT', {
      llm_slots: [
        { id: loaded[0].id, baseUrl: loaded[0].baseUrl, model: loaded[0].model, apiKey: '' },
        { id: loaded[1].id, baseUrl: loaded[1].baseUrl, model: loaded[1].model, apiKey: '' },
        { baseUrl: 'https://opencode.ai/zen/v1', model: 'deepseek-v4-flash-free', apiKey: 'sk-c' },
      ],
    });
    const saved = db.dump();
    expect(saved).toHaveLength(3);
    const keys = saved.map((s: any) => s.apiKey);
    expect(keys).toContain('sk-a');
    expect(keys).toContain('sk-b');
    expect(keys).toContain('sk-c');
  });

  it('重复配置被去重，只保留第一个', async () => {
    const db = makeDb([]);
    const env = makeEnv(db);
    const putRes = await authedRequest(env, '/api/settings/system', 'PUT', {
      llm_slots: [
        { baseUrl: 'https://x.cn/v1', model: 'm1', apiKey: 'sk-dup' },
        { baseUrl: 'https://x.cn/v1/', model: 'm1', apiKey: 'sk-dup' }, // 尾部斜杠差异 + 完全重复
        { baseUrl: 'https://x.cn/v1', model: 'm1', apiKey: 'sk-other' }, // 同端点不同 key 保留
      ],
    });
    expect(putRes.status).toBe(200);
    const saved = db.dump();
    expect(saved).toHaveLength(2);
    expect(saved[0].apiKey).toBe('sk-dup');
    expect(saved[1].apiKey).toBe('sk-other');
  });
});
