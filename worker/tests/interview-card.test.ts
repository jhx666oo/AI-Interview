import { describe, expect, it } from 'vitest';
import { createInterviewCardRoutes, createOrReuseInterviewCardLink, deriveInterviewCardToken, type InterviewCardRouteDeps } from '../src/interview-card/routes';
import { hashPublicToken } from '../src/business-screening/token';

/**
 * 面试管理卡片路由测试
 * 用内存 FakeD1 模拟 D1，覆盖：创建/复用链接、查询列表、撤销、公开读取、过期/404。
 */

type AnyRow = Record<string, any>;

/** 简易内存 D1：只支持面试卡片路由用到的固定 SQL 形态 */
class FakeD1 {
  links: AnyRow[] = [];
  resumes: AnyRow[] = [];
  interviews: AnyRow[] = [];
  events: AnyRow[] = [];
  updated: AnyRow[] = [];

  prepare(sql: string) {
    const self = this;
    const makeStmt = (boundArgs: any[] = []) => ({
      bind: (...args: any[]) => makeStmt(args),
      first: () => self.execute(sql, boundArgs, 'first'),
      all: () => self.execute(sql, boundArgs, 'all'),
      run: () => self.execute(sql, boundArgs, 'run'),
    });
    return makeStmt();
  }

  private async execute(sql: string, params: any[], method: 'first' | 'all' | 'run'): Promise<any> {
    if (sql.includes("SET status = 'active'") && sql.includes('COALESCE(?, resume_id)')) {
      // 复用链接：刷新有效期并回填缺失的标识字段（与生产 SQL 的 COALESCE 语义一致）
      const [expiresAt, updatedAt, resumeId, candidateName, positionApplied, id] = params;
      const row = this.links.find((r) => r.id === id);
      if (row) {
        row.status = 'active';
        row.expires_at = expiresAt;
        row.updated_at = updatedAt;
        if (resumeId) row.resume_id = resumeId;
        if (candidateName) row.candidate_name = candidateName;
        if (positionApplied) row.position_applied = positionApplied;
      }
      return { meta: { changes: row ? 1 : 0 } };
    }
    if (sql.includes('UPDATE interview_card_links SET status = \'revoked\'') && sql.includes('WHERE id = ?')) {
      const [id] = params;
      const row = this.links.find((r) => r.id === id);
      if (row) { row.status = 'revoked'; this.updated.push({ id, status: 'revoked' }); }
      return { meta: { changes: row ? 1 : 0 } };
    }
    if (sql.includes('UPDATE interview_card_links SET last_accessed_at = ?')) {
      const [ts, id] = params;
      const row = this.links.find((r) => r.id === id);
      if (row) row.last_accessed_at = ts;
      return { meta: { changes: row ? 1 : 0 } };
    }
    if (sql.includes('INSERT INTO interview_card_links')) {
      // SQL 中 status='active' 为字面量，VALUES 占位符 9 个：id, resume_id, candidate_name, position_applied, token_hash, expires_at, created_by, created_at, updated_at
      const [id, resumeId, name, position, tokenHash, expiresAt, createdBy, createdAt, updatedAt] = params;
      this.links.push({
        id, resume_id: resumeId, candidate_name: name, position_applied: position,
        token_hash: tokenHash, status: 'active', expires_at: expiresAt, created_by: createdBy,
        created_at: createdAt, updated_at: updatedAt, last_accessed_at: null,
      });
      return { meta: { changes: 1 } };
    }
    if (sql.includes('FROM interview_card_links') && sql.includes('token_hash = ?')) {
      const [tokenHash] = params;
      const row = this.links.find((r) => r.token_hash === tokenHash);
      return method === 'first' ? (row || null) : { results: row ? [row] : [] };
    }
    if (sql.includes('FROM interview_card_links') && sql.includes('resume_id = ?') && sql.includes('LIMIT 1')) {
      const [resumeId] = params;
      const rows = this.links.filter((r) => r.resume_id === resumeId).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      return method === 'first' ? (rows[0] || null) : { results: rows };
    }
    if (sql.includes('FROM interview_card_links') && sql.includes('candidate_name = ?') && sql.includes('position_applied = ?') && sql.includes('LIMIT 1')) {
      const [name, position] = params;
      const rows = this.links.filter((r) => r.candidate_name === name && r.position_applied === position)
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      return method === 'first' ? (rows[0] || null) : { results: rows };
    }
    if (sql.includes('FROM interview_card_links') && sql.includes('candidate_name = ?') && sql.includes('LIMIT 1')) {
      const [name] = params;
      const rows = this.links.filter((r) => r.candidate_name === name).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      return method === 'first' ? (rows[0] || null) : { results: rows };
    }
    if (sql.includes('FROM interview_card_links') && sql.includes('LIMIT 50')) {
      // 列表查询：顺序为 resume_id / candidate_name / position_applied 的可能组合
      let rows = [...this.links];
      const hasResume = sql.includes('resume_id = ?');
      const hasName = sql.includes('candidate_name = ?');
      const hasPosition = sql.includes('position_applied = ?');
      let i = 0;
      if (hasResume) { rows = rows.filter((r) => r.resume_id === params[i++]); }
      if (hasName) { rows = rows.filter((r) => r.candidate_name === params[i++]); }
      if (hasPosition) { rows = rows.filter((r) => r.position_applied === params[i++]); }
      rows = [...rows].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      return { results: rows.slice(0, 50) };
    }
    if (sql.includes('FROM resumes') && sql.includes('WHERE id = ?')) {
      const [id] = params;
      const row = this.resumes.find((r) => r.id === id);
      return method === 'first' ? (row || null) : { results: row ? [row] : [] };
    }
    if (sql.includes('FROM resumes') && sql.includes('candidate_name = ?')) {
      const [name] = params;
      const row = this.resumes.filter((r) => r.candidate_name === name).sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
      return method === 'first' ? (row || null) : { results: row ? [row] : [] };
    }
    if (sql.includes('FROM interviews') && sql.includes('resume_id = ?')) {
      const [resumeId] = params;
      const rows = this.interviews.filter((r) => r.resume_id === resumeId);
      return { results: rows };
    }
    if (sql.includes('FROM interviews') && sql.includes('candidate_name = ?')) {
      const [name, position] = params;
      const rows = this.interviews.filter((r) => r.candidate_name === name && (!position || r.position_applied === position));
      return { results: rows };
    }
    if (sql.includes('FROM candidate_stage_events')) {
      const [resumeId] = params;
      const rows = this.events.filter((r) => r.resume_id === resumeId);
      return { results: rows };
    }
    throw new Error(`FakeD1: unsupported SQL: ${sql}`);
  }
}

function buildHarness(options?: {
  now?: string;
  links?: AnyRow[];
  resumes?: AnyRow[];
  interviews?: AnyRow[];
  events?: AnyRow[];
  fileBytes?: Uint8Array | null;
}) {
  const db = new FakeD1();
  db.links = (options?.links || []).map((r) => ({ ...r }));
  db.resumes = (options?.resumes || []).map((r) => ({ ...r }));
  db.interviews = (options?.interviews || []).map((r) => ({ ...r }));
  db.events = (options?.events || []).map((r) => ({ ...r }));
  const fileBytes = options?.fileBytes === undefined
    ? new Uint8Array([1, 2, 3, 4])
    : options.fileBytes;

  let nowValue = options?.now || '2026-08-19T00:00:00.000Z';
  let uuidCounter = 0;
  const deps: InterviewCardRouteDeps = {
    authMiddleware: async (_c, next) => {
      // 模拟已登录用户（JWT 中间件已被调用方注入）
      await next();
    },
    now: () => nowValue,
    uuid: () => `card-${++uuidCounter}`,
    hashPublicToken,
    getResumeFileBytes: async (_env, resumeId) => ({
      bytes: fileBytes && (resumeId === 'resume-1') ? fileBytes : null,
      fileName: 'resume.pdf',
    }),
  };
  const app = createInterviewCardRoutes(deps);
  const env = { DB: db };
  return {
    app,
    db,
    env,
    setNow: (v: string) => { nowValue = v; },
  };
}

const sampleResume = {
  id: 'resume-1',
  candidate_name: '张三',
  position_applied: '前端工程师',
  mapped_position: '前端工程师',
  parsed_data: JSON.stringify({
    highest_degree: '本科', school: '武汉大学', major: '计算机',
    years_of_experience: 3, recent_company: '某公司', current_position: '前端开发',
    skills: ['React', 'TypeScript'], work_experience: [{ company: '某公司', title: '前端开发', start: '2022', end: '2024' }],
  }),
  education: null, work_experience: null, gender: null, birthday: null,
  certifications: null, self_evaluation: null,
  hr_review: 'HR 备注：候选人沟通能力好',
  business_screening_remark: '业务初筛通过',
  status: 'interviewing', stage: 'interview',
  created_at: '2026-08-01T00:00:00.000Z',
};

const sampleInterview = (overrides: AnyRow = {}) => ({
  id: 'iv-1',
  resume_id: 'resume-1',
  candidate_name: '张三',
  position_applied: '前端工程师',
  round: 1,
  interview_time: '2026-08-18T10:00:00.000Z',
  started_at: null,
  interview_type: 'onsite', interview_category: 'technical',
  interview_location: '3楼会议室', meeting_link: '',
  status: 'completed', result: 'passed', result2: 'pending', status2: 'pending',
  interviewer: '王面试官', primary_interviewer: '王面试官', secondary_interviewer: '',
  panel_members: '王面试官、李面试官', total_score: 85,
  scores: JSON.stringify({ 0: 8, 1: 9 }),
  evaluation: '一面评价：技术基础扎实，沟通顺畅。',
  evaluation2: '', suggestion: '建议进入二面',
  comments: JSON.stringify({ 0: '第一题回答完整', 1: '算法能力不错' }),
  created_at: '2026-08-18T09:00:00.000Z',
  ...overrides,
});

describe('deriveInterviewCardToken', () => {
  it('derives a deterministic token with the ic- prefix from the card id', async () => {
    const t1 = await deriveInterviewCardToken('card-abc');
    const t2 = await deriveInterviewCardToken('card-abc');
    const t3 = await deriveInterviewCardToken('card-xyz');
    expect(t1).toMatch(/^ic-[A-Za-z0-9_-]{28}$/);
    expect(t2).toBe(t1);
    expect(t3).not.toBe(t1);
  });
});

describe('createOrReuseInterviewCardLink service', () => {
  it('creates a link for a resume (service-level, used by interview reminders)', async () => {
    const h = buildHarness({ resumes: [sampleResume] });
    const result = await createOrReuseInterviewCardLink(h.db, {
      resumeId: 'resume-1', candidateName: '张三', positionApplied: '前端工程师', createdBy: '提醒人',
    }, { now: () => '2026-08-19T00:00:00.000Z', uuid: () => 'svc-1', hashPublicToken });

    expect(result.reused).toBe(false);
    expect(result.url).toBe(`/interview-card/${result.token}`);
    expect(result.token).toMatch(/^ic-/);
    expect(result.expires_at).toBe('2026-08-26T00:00:00.000Z');
    // 幂等：再次调用复用同一条记录，URL 不变
    const again = await createOrReuseInterviewCardLink(h.db, {
      resumeId: 'resume-1', candidateName: '张三',
    }, { now: () => '2026-08-19T00:00:00.000Z', uuid: () => 'svc-2', hashPublicToken });
    expect(again.reused).toBe(true);
    expect(again.url).toBe(result.url);
    expect(h.db.links).toHaveLength(1);
  });

  it('rejects when neither resume_id nor candidate_name is provided', async () => {
    const h = buildHarness();
    await expect(createOrReuseInterviewCardLink(h.db, {}, { now: () => '', uuid: () => 'x', hashPublicToken }))
      .rejects.toThrow('至少提供一个');
  });

  it('keeps ONE link per person across different resume ids (duplicate uploads)', async () => {
    const h = buildHarness({ resumes: [sampleResume] });
    const svc = { now: () => '2026-08-19T00:00:00.000Z', uuid: () => 'svc-a', hashPublicToken };
    // 第一份简历生成
    const first = await createOrReuseInterviewCardLink(h.db, {
      resumeId: 'resume-1', candidateName: '张三', positionApplied: '前端工程师',
    }, svc);
    // 同一人第二份简历（重复上传，不同 resume_id）：姓名+岗位兜底命中同一条
    const second = await createOrReuseInterviewCardLink(h.db, {
      resumeId: 'resume-1-dup', candidateName: '张三', positionApplied: '前端工程师',
    }, svc);
    expect(second.reused).toBe(true);
    expect(second.url).toBe(first.url);
    expect(h.db.links).toHaveLength(1);
  });

  it('keeps ONE link per person when created by name only and later reused with a resume id', async () => {
    const h = buildHarness({ resumes: [sampleResume] });
    const svc = { now: () => '2026-08-19T00:00:00.000Z', uuid: () => 'svc-b', hashPublicToken };
    // 手动面试（无简历关联）：仅按姓名创建
    const byName = await createOrReuseInterviewCardLink(h.db, {
      candidateName: '张三',
    }, svc);
    // 之后提醒推送带 resume_id：resume_id 未命中 → 仅姓名兜底命中同一条，并回填 resume_id
    const withResume = await createOrReuseInterviewCardLink(h.db, {
      resumeId: 'resume-1', candidateName: '张三', positionApplied: '前端工程师',
    }, svc);
    expect(withResume.reused).toBe(true);
    expect(withResume.url).toBe(byName.url);
    expect(h.db.links).toHaveLength(1);
    expect(h.db.links[0].resume_id).toBe('resume-1');
    expect(h.db.links[0].position_applied).toBe('前端工程师');
  });
});

describe('POST /api/interview-card-links', () => {
  it('creates a link for a resume and returns token/url/expires_at', async () => {
    const h = buildHarness({ resumes: [sampleResume] });
    const res = await h.app.request('/api/interview-card-links', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resume_id: 'resume-1', candidate_name: '张三', position_applied: '前端工程师' }),
    }, h.env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toMatch(/^ic-/);
    expect(body.url).toBe(`/interview-card/${body.token}`);
    expect(body.reused).toBe(false);
    expect(body.expires_at).toBe('2026-08-26T00:00:00.000Z'); // +7 天
    // DB 只存哈希，不存明文 token
    expect(h.db.links[0].token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(h.db.links[0].token_hash).not.toContain(body.token);
  });

  it('reuses the same link (same URL) when creating again for the same candidate', async () => {
    const h = buildHarness({ resumes: [sampleResume] });
    const first = await (await h.app.request('/api/interview-card-links', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resume_id: 'resume-1', candidate_name: '张三' }),
    }, h.env)).json();
    const second = await (await h.app.request('/api/interview-card-links', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resume_id: 'resume-1', candidate_name: '张三' }),
    }, h.env)).json();

    expect(second.reused).toBe(true);
    expect(second.url).toBe(first.url);
    expect(second.id).toBe(first.id);
    expect(h.db.links.length).toBe(1);
  });

  it('reactivates an expired link and keeps the URL stable', async () => {
    const h = buildHarness({ resumes: [sampleResume] });
    // 先建链接，再把时间拨到过期后，再次创建应复用同 id 且 URL 不变
    const first = await (await h.app.request('/api/interview-card-links', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resume_id: 'resume-1' }),
    }, h.env)).json();
    h.setNow('2026-09-01T00:00:00.000Z');
    const second = await (await h.app.request('/api/interview-card-links', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resume_id: 'resume-1' }),
    }, h.env)).json();
    expect(second.id).toBe(first.id);
    expect(second.url).toBe(first.url);
    expect(second.reused).toBe(true);
    expect(h.db.links[0].status).toBe('active');
    expect(h.db.links[0].expires_at).toBe('2026-09-08T00:00:00.000Z');
  });

  it('rejects when neither resume_id nor candidate_name is provided', async () => {
    const h = buildHarness();
    const res = await h.app.request('/api/interview-card-links', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    }, h.env);
    expect(res.status).toBe(400);
  });
});

describe('GET /api/interview-card-links', () => {
  it('lists links for a resume and returns the derivable url for active links', async () => {
    const h = buildHarness({ resumes: [sampleResume] });
    const created = await (await h.app.request('/api/interview-card-links', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resume_id: 'resume-1', candidate_name: '张三' }),
    }, h.env)).json();
    const res = await h.app.request('/api/interview-card-links?resume_id=resume-1', {}, h.env);
    const body = await res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].active).toBe(true);
    expect(body.items[0].url).toBe(created.url);
  });

  it('returns url null for revoked links', async () => {
    const h = buildHarness({ resumes: [sampleResume] });
    const created = await (await h.app.request('/api/interview-card-links', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resume_id: 'resume-1' }),
    }, h.env)).json();
    await h.app.request(`/api/interview-card-links/${created.id}`, { method: 'DELETE' }, h.env);
    const body = await (await h.app.request('/api/interview-card-links?resume_id=resume-1', {}, h.env)).json();
    expect(body.items[0].active).toBe(false);
    expect(body.items[0].url).toBeNull();
  });
});

describe('DELETE /api/interview-card-links/:id', () => {
  it('revokes the link', async () => {
    const h = buildHarness({ resumes: [sampleResume] });
    const created = await (await h.app.request('/api/interview-card-links', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resume_id: 'resume-1' }),
    }, h.env)).json();
    const del = await h.app.request(`/api/interview-card-links/${created.id}`, { method: 'DELETE' }, h.env);
    expect(del.status).toBe(200);
    expect(h.db.links[0].status).toBe('revoked');
    const missing = await h.app.request('/api/interview-card-links/not-exist', { method: 'DELETE' }, h.env);
    expect(missing.status).toBe(404);
  });
});

describe('GET /api/public/interview-card/:token', () => {
  it('returns candidate profile, interviews and timeline for a valid token', async () => {
    const h = buildHarness({
      resumes: [sampleResume],
      interviews: [sampleInterview()],
      events: [
        { resume_id: 'resume-1', stage: 'interview_scheduled', action: '安排一面', occurred_at: '2026-08-17T02:00:00.000Z', actor_user_id: null, source: 'manual', metadata_json: '{}' },
        { resume_id: 'resume-1', stage: 'interview_completed', action: '完成一面', occurred_at: '2026-08-18T10:30:00.000Z', actor_user_id: null, source: 'manual', metadata_json: '{}' },
      ],
    });
    const created = await (await h.app.request('/api/interview-card-links', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resume_id: 'resume-1', candidate_name: '张三', position_applied: '前端工程师' }),
    }, h.env)).json();

    const res = await h.app.request(`/api/public/interview-card/${created.token}`, {}, h.env);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.card.expires_at).toBe(created.expires_at);
    // 候选人档案
    expect(body.candidate.candidate_name).toBe('张三');
    expect(body.candidate.resume_id).toBe('resume-1');
    expect(body.candidate.profile.highestDegree).toBe('本科');
    expect(body.candidate.profile.skills).toEqual(['React', 'TypeScript']);
    expect(body.candidate.hr_review).toContain('沟通能力');
    // 面试记录
    expect(body.interviews).toHaveLength(1);
    expect(body.interviews[0].round).toBe(1);
    expect(body.interviews[0].result).toBe('passed');
    expect(body.interviews[0].evaluation).toContain('技术基础扎实');
    expect(body.interviews[0].scores).toEqual({ 0: 8, 1: 9 });
    expect(body.interviews[0].comments).toEqual({ 0: '第一题回答完整', 1: '算法能力不错' });
    // 时间线
    expect(body.timeline.map((e: any) => e.stage)).toEqual(['interview_scheduled', 'interview_completed']);
  });

  it('matches interviews by candidate_name when resume has no interview records', async () => {
    const h = buildHarness({
      resumes: [sampleResume],
      interviews: [sampleInterview({ resume_id: null })],
    });
    const created = await (await h.app.request('/api/interview-card-links', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ candidate_name: '张三', position_applied: '前端工程师' }),
    }, h.env)).json();
    const body = await (await h.app.request(`/api/public/interview-card/${created.token}`, {}, h.env)).json();
    expect(body.interviews).toHaveLength(1);
    expect(body.interviews[0].candidate_name).toBe('张三');
  });

  it('returns 404 for an unknown token', async () => {
    const h = buildHarness();
    const res = await h.app.request('/api/public/interview-card/ic-unknown-token', {}, h.env);
    expect(res.status).toBe(404);
  });

  it('returns 410 for an expired link', async () => {
    const h = buildHarness({ resumes: [sampleResume] });
    const created = await (await h.app.request('/api/interview-card-links', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resume_id: 'resume-1' }),
    }, h.env)).json();
    h.setNow('2026-09-01T00:00:00.000Z');
    const res = await h.app.request(`/api/public/interview-card/${created.token}`, {}, h.env);
    expect(res.status).toBe(410);
  });

  it('returns 410 for a revoked link', async () => {
    const h = buildHarness({ resumes: [sampleResume] });
    const created = await (await h.app.request('/api/interview-card-links', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resume_id: 'resume-1' }),
    }, h.env)).json();
    await h.app.request(`/api/interview-card-links/${created.id}`, { method: 'DELETE' }, h.env);
    const res = await h.app.request(`/api/public/interview-card/${created.token}`, {}, h.env);
    expect(res.status).toBe(410);
  });

  it('exposes resume evaluation fields for the resume-first public page', async () => {
    const h = buildHarness({
      resumes: [{
        ...sampleResume,
        contact: '13800000000',
        email: 'secret@example.com',
        match_score: 88,
        screening_result: '通过',
        ai_review: JSON.stringify({ summary: '整体匹配', risks: ['稳定性需核实'] }),
        ocr_markdown: '# 张三的简历\n本科，3年前端经验',
        parse_status: 'ai_screened',
      }],
    });
    const created = await (await h.app.request('/api/interview-card-links', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resume_id: 'resume-1', candidate_name: '张三' }),
    }, h.env)).json();
    const body = await (await h.app.request(`/api/public/interview-card/${created.token}`, {}, h.env)).json();
    // 简历主体信息：评估、原文、电话（与业务筛选口径一致）；email 不透出
    expect(body.candidate.match_score).toBe(88);
    expect(body.candidate.screening_result).toBe('通过');
    expect(body.candidate.ai_review).toContain('整体匹配');
    expect(body.candidate.ocr_markdown).toContain('张三的简历');
    expect(body.candidate.contact).toBe('13800000000');
    expect(body.candidate).not.toHaveProperty('email');
    expect(body.candidate.parse_status).toBe('ai_screened');
  });
});

describe('GET /api/public/interview-card/:token/file', () => {
  it('serves the resume PDF for a valid token (inline preview vs attachment)', async () => {
    const h = buildHarness({ resumes: [sampleResume], fileBytes: new Uint8Array([9, 9, 9]) });
    const created = await (await h.app.request('/api/interview-card-links', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resume_id: 'resume-1', candidate_name: '张三' }),
    }, h.env)).json();

    const preview = await h.app.request(`/api/public/interview-card/${created.token}/file?preview=1`, {}, h.env);
    expect(preview.status).toBe(200);
    expect(preview.headers.get('content-type')).toBe('application/pdf');
    expect(preview.headers.get('content-disposition')).toContain('inline');

    const download = await h.app.request(`/api/public/interview-card/${created.token}/file`, {}, h.env);
    expect(download.status).toBe(200);
    expect(download.headers.get('content-disposition')).toContain('attachment');
  });

  it('falls back to candidate_name lookup when the card has no resume_id', async () => {
    const h = buildHarness({ resumes: [sampleResume], fileBytes: new Uint8Array([7]) });
    const created = await (await h.app.request('/api/interview-card-links', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ candidate_name: '张三' }),
    }, h.env)).json();
    const res = await h.app.request(`/api/public/interview-card/${created.token}/file`, {}, h.env);
    expect(res.status).toBe(200);
  });

  it('returns 404 when no cached PDF exists and 410 for expired links', async () => {
    const h = buildHarness({ resumes: [sampleResume], fileBytes: null });
    const created = await (await h.app.request('/api/interview-card-links', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resume_id: 'resume-1' }),
    }, h.env)).json();
    const missing = await h.app.request(`/api/public/interview-card/${created.token}/file`, {}, h.env);
    expect(missing.status).toBe(404);

    const h2 = buildHarness({ resumes: [sampleResume] });
    const created2 = await (await h2.app.request('/api/interview-card-links', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resume_id: 'resume-1' }),
    }, h2.env)).json();
    h2.setNow('2026-09-01T00:00:00.000Z');
    const expired = await h2.app.request(`/api/public/interview-card/${created2.token}/file`, {}, h2.env);
    expect(expired.status).toBe(410);
  });
});
