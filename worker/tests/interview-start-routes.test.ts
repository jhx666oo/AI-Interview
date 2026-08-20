import { describe, expect, it } from 'vitest';
import { hashPublicToken } from '../src/business-screening/token';
import { createInterviewStartRoutes, type InterviewInviteRouteDeps } from '../src/interview-start/routes';

/**
 * 候选人面试详情免登录端点测试：
 * 有效 token 返回脱敏视图；未知 token 404；过期/哈希不符 410；响应不泄露内部评估字段。
 */

class FakeD1 {
  interviews: any[];
  constructor(interviews: any[]) {
    this.interviews = interviews.map((r) => ({ ...r }));
  }
  prepare(sql: string) {
    const self = this;
    const makeStmt = (params: any[] = []) => ({
      bind: (...args: any[]) => makeStmt(args),
      first: async () => {
        if (sql.includes('WHERE invite_token_hash = ?')) {
          // __force_match：模拟「查到了记录但存储哈希与 token 不符」的异常场景（走 410 分支）
          const forced = self.interviews.find((r) => r.__force_match);
          if (forced) return forced;
          return self.interviews.find((r) => r.invite_token_hash === params[0]) || null;
        }
        return null;
      },
      all: async () => ({ results: [] }),
      run: async () => ({ meta: {} }),
    });
    return makeStmt();
  }
}

const NOW = '2026-08-19T04:00:00.000Z';

function buildHarness(interviews: any[]) {
  const deps: InterviewInviteRouteDeps = { now: () => NOW, hashPublicToken };
  const app = createInterviewStartRoutes(deps);
  return { app, env: { DB: new FakeD1(interviews) } };
}

async function tokenFor(id: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`interview-invite::${id}`));
  const bytes = new Uint8Array(digest);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base64Url = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  return `ii-${base64Url.slice(0, 28)}`;
}

describe('GET /api/public/interview-invite/:token', () => {
  it('有效 token → 返回候选人可见的面试安排', async () => {
    const interviewId = 'itv-1';
    const token = await tokenFor(interviewId);
    const h = buildHarness([{
      id: interviewId,
      candidate_name: '张三',
      position_applied: '前端工程师',
      interview_time: '2026-08-20 14:00',
      interview_type: 'video',
      interview_location: '',
      meeting_link: 'https://vc.feishu.cn/j/abc',
      round: 2,
      interviewer: '张三', // 该列历史数据存候选人名，不应作为面试官透出由前端去重
      primary_interviewer: '李四',
      secondary_interviewer: '',
      status: 'in_progress',
      invite_token_hash: await hashPublicToken(token),
      invite_expires_at: '2026-08-25T00:00:00.000Z',
    }]);

    const res = await h.app.request(`/api/public/interview-invite/${token}`, {}, h.env as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.interview.candidate_name).toBe('张三');
    expect(body.interview.position_applied).toBe('前端工程师');
    expect(body.interview.meeting_link).toBe('https://vc.feishu.cn/j/abc');
    expect(body.interview.primary_interviewer).toBe('李四');
    expect(body.interview.round).toBe(2);
    expect(body.invite.expires_at).toBe('2026-08-25T00:00:00.000Z');
    // 脱敏：不包含内部评估/评分/联系方式字段
    const json = JSON.stringify(body);
    expect(json).not.toContain('evaluation');
    expect(json).not.toContain('scores');
    expect(json).not.toContain('email');
    expect(json).not.toContain('contact');
  });

  it('未知 token → 404', async () => {
    const h = buildHarness([]);
    const res = await h.app.request('/api/public/interview-invite/ii-unknown', {}, h.env as any);
    expect(res.status).toBe(404);
  });

  it('已过期 → 410', async () => {
    const interviewId = 'itv-2';
    const token = await tokenFor(interviewId);
    const h = buildHarness([{
      id: interviewId,
      candidate_name: '李四',
      invite_token_hash: await hashPublicToken(token),
      invite_expires_at: '2026-08-10T00:00:00.000Z',
    }]);
    const res = await h.app.request(`/api/public/interview-invite/${token}`, {}, h.env as any);
    expect(res.status).toBe(410);
  });

  it('哈希不匹配（token 与记录不符）→ 410', async () => {
    const interviewId = 'itv-3';
    const token = await tokenFor(interviewId);
    const h = buildHarness([{
      id: interviewId,
      __force_match: true,
      invite_token_hash: 'different-hash',
      invite_expires_at: '2026-08-25T00:00:00.000Z',
    }]);
    const res = await h.app.request(`/api/public/interview-invite/${token}`, {}, h.env as any);
    expect(res.status).toBe(410);
  });

  it('缺失有效期 → 410', async () => {
    const interviewId = 'itv-4';
    const token = await tokenFor(interviewId);
    const h = buildHarness([{
      id: interviewId,
      invite_token_hash: await hashPublicToken(token),
      invite_expires_at: '',
    }]);
    const res = await h.app.request(`/api/public/interview-invite/${token}`, {}, h.env as any);
    expect(res.status).toBe(410);
  });
});

describe('POST /api/public/interview-invite/:token/reschedule', () => {
  async function makeHarness(overrides: any = {}) {
    const interviewId = 'itv-rs';
    const token = await tokenFor(interviewId);
    const h = buildHarness([{
      id: interviewId,
      candidate_name: '张三',
      interview_time: '2026-08-20 14:00',
      primary_interviewer: '李四',
      status: 'scheduled',
      invite_token_hash: await hashPublicToken(token),
      invite_expires_at: '2026-08-25T00:00:00.000Z',
      ...overrides,
    }]);
    return { h, token };
  }

  it('有效 token + 合法未来时间 → 更新成功（无日程时不同步飞书）', async () => {
    const { h, token } = await makeHarness();
    const res = await h.app.request(`/api/public/interview-invite/${token}/reschedule`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ interview_time: '2026-08-21 10:00' }),
    }, h.env as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.interview_time).toBe('2026-08-21 10:00');
    expect(body.calendar_synced).toBe(false);
  });

  it('非法时间格式 → 400', async () => {
    const { h, token } = await makeHarness();
    const res = await h.app.request(`/api/public/interview-invite/${token}/reschedule`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ interview_time: '下周一下午' }),
    }, h.env as any);
    expect(res.status).toBe(400);
  });

  it('过去时间 → 400', async () => {
    const { h, token } = await makeHarness();
    const res = await h.app.request(`/api/public/interview-invite/${token}/reschedule`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ interview_time: '2020-01-01 09:00' }),
    }, h.env as any);
    expect(res.status).toBe(400);
  });

  it('过期链接 → 410', async () => {
    const { h, token } = await makeHarness({ invite_expires_at: '2026-08-10T00:00:00.000Z' });
    const res = await h.app.request(`/api/public/interview-invite/${token}/reschedule`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ interview_time: '2026-08-21 10:00' }),
    }, h.env as any);
    expect(res.status).toBe(410);
  });
});

describe('GET /api/public/interview-invite/:token/slots', () => {
  it('面试官未绑定飞书 → 返回空列表与原因', async () => {
    const interviewId = 'itv-slots';
    const token = await tokenFor(interviewId);
    const h = buildHarness([{
      id: interviewId,
      candidate_name: '张三',
      primary_interviewer: '李四',
      invite_token_hash: await hashPublicToken(token),
      invite_expires_at: '2026-08-25T00:00:00.000Z',
    }]);
    const res = await h.app.request(`/api/public/interview-invite/${token}/slots`, {}, h.env as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.slots).toEqual([]);
    expect(body.reason).toContain('未绑定');
  });

  it('面试未配置面试官 → 返回原因', async () => {
    const interviewId = 'itv-slots2';
    const token = await tokenFor(interviewId);
    const h = buildHarness([{
      id: interviewId,
      candidate_name: '张三',
      invite_token_hash: await hashPublicToken(token),
      invite_expires_at: '2026-08-25T00:00:00.000Z',
    }]);
    const body = await (await h.app.request(`/api/public/interview-invite/${token}/slots`, {}, h.env as any)).json();
    expect(body.slots).toEqual([]);
    expect(body.reason).toContain('未配置面试官');
  });
});
