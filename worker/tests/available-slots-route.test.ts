import { describe, expect, it } from 'vitest';
import workerApp from '../src/index';

/**
 * 决定性验证：最新 main 代码里 /api/interviews/available-slots 路由是否真实可访问。
 * 回归：available-slots 路由须可达（曾因注册位置在子路由挂载之后被吞而 404，已修复移至挂载前）。
 */

function fakeD1() {
  return {
    prepare(sql: string) {
      const stmt = {
        bind: () => stmt,
        first: async () => {
          // authMiddleware 查询用户：返回 admin 用户（role=admin）使认证通过
          if (sql.includes('FROM users WHERE email')) {
            return { id: 'u1', email: 'admin@example.com', full_name: '管理员', role: 'admin', is_active: 1 };
          }
          return null;
        },
        all: async () => ({ results: [] }),
        run: async () => ({ meta: {} }),
      };
      return stmt;
    },
  } as unknown as D1Database;
}

function makeToken(secret: string): string {
  const b64u = (s: string) => Buffer.from(s).toString('base64url');
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64u(JSON.stringify({ sub: 'admin@example.com', exp: Math.floor(Date.now() / 1000) + 3600 }));
  const data = `${header}.${payload}`;
  const crypto = require('crypto');
  const sig = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

const env = {
  DB: fakeD1(),
  SECRET_KEY: 'test-secret',
  FEISHU_APP_ID: '',
  FEISHU_APP_SECRET: '',
} as any;

async function call(path: string, init: RequestInit = {}) {
  const app: any = workerApp;
  return app.fetch(new Request(`https://test.local${path}`, init), env, {});
}

describe('available-slots 路由可达性（本地最新代码）', () => {
  it('带有效 token 请求 available-slots 应返回 200（即使面试官未绑定也返回 reason 而非 404）', async () => {
    const token = makeToken('test-secret');
    // 无 query 版（排除 query 干扰）
    const resNoQuery = await call('/api/interviews/available-slots', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const textNoQuery = await resNoQuery.text();
    console.log('无query status:', resNoQuery.status, 'body:', textNoQuery.slice(0, 150));
    // 带 query 版
    const res = await call('/api/interviews/available-slots?interviewer=%E9%87%91%E7%BF%94%E7%BF%8A', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const text = await res.text();
    console.log('带query status:', res.status, 'body:', text.slice(0, 200));
    // 路由存在：auth 通过后应返回 JSON（ok:true + slots/reason），绝不是 404
    expect(res.status).not.toBe(404);
    expect(text).toContain('"ok"');
  });

  it('不带 token 返回 401（说明路由已挂全局 auth 中间件）', async () => {
    const res = await call('/api/interviews/available-slots?interviewer=test');
    expect(res.status).toBe(401);
  });

  it('对照：schedule-direct（5575 附近）路由应可达（400 缺参）', async () => {
    const token = makeToken('test-secret');
    const res = await call('/api/interviews/any-id/schedule-direct', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    console.log('schedule-direct status:', res.status);
    expect(res.status).toBe(400);
  });

  it('对照：automation-env（14570 附近）路由应可达', async () => {
    const token = makeToken('test-secret');
    const res = await call('/api/admin/automation-env', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    console.log('automation-env status:', res.status, await res.text());
    expect(res.status).not.toBe(404);
  });

  it('对照：/api/interviews（4313 列表）应可达', async () => {
    const token = makeToken('test-secret');
    const res = await call('/api/interviews', { headers: { Authorization: `Bearer ${token}` } });
    console.log('列表 status:', res.status, (await res.text()).slice(0, 80));
    expect(res.status).not.toBe(404);
  });

  it('对照：/api/interviews/available-slots-zzz（不存在）应 404', async () => {
    const token = makeToken('test-secret');
    const res = await call('/api/interviews/available-slots-zzz', { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(404);
  });
});
