import { Hono } from 'hono';
import { buildPublicProfile, type BusinessScreeningPublicProfile } from '../business-screening/routes';
import { hashPublicToken } from '../business-screening/token';

/**
 * 面试管理卡片（Interview Card Link）
 * 把单个候选人的面试情况（各轮面试、评分评价、备注、进度时间线）汇总到一个免登录公开链接，
 * 机制与业务筛选链接一致：token 确定性派生（SHA-256('interview-card::' + id)）、
 * DB 只存哈希、固定 7 天有效、可撤销、可续期。
 * 面向受众：业务方/用人部门查看面试进度、面试官之间协作查看。
 */

const LINK_TTL_DAYS = 7;
const TOKEN_PREFIX = 'ic-';

export interface InterviewCardLinkRow {
  id: string;
  resume_id: string | null;
  candidate_name: string | null;
  position_applied: string | null;
  token_hash: string;
  status: 'active' | 'revoked';
  expires_at: string;
  created_by: string | null;
  created_at: string;
  updated_at: string | null;
  last_accessed_at: string | null;
}

export interface InterviewCardRouteDeps {
  authMiddleware: (c: any, next: any) => Promise<void>;
  now: () => string;
  uuid: () => string;
  hashPublicToken: (token: string) => Promise<string>;
}

/** 公开页透出的面试记录（不含联系方式与敏感内部字段） */
export interface InterviewCardPublicInterview {
  id: string;
  candidate_name: string | null;
  position_applied: string | null;
  round: number | null;
  interview_time: string | null;
  started_at: string | null;
  interview_type: string | null;
  interview_category: string | null;
  interview_location: string | null;
  meeting_link: string | null;
  status: string | null;
  result: string | null;
  result2: string | null;
  status2: string | null;
  interviewer: string | null;
  primary_interviewer: string | null;
  secondary_interviewer: string | null;
  panel_members: string | null;
  total_score: number | null;
  scores: Record<string, number> | null;
  evaluation: string | null;
  evaluation2: string | null;
  suggestion: string | null;
  comments: Record<string, string> | null;
}

export interface InterviewCardTimelineEvent {
  stage: string;
  action: string;
  occurred_at: string;
  actor_user_id: string | null;
  source: string;
  metadata: Record<string, unknown>;
}

export interface InterviewCardPublicView {
  card: {
    id: string;
    expires_at: string;
    created_at: string;
    status: string;
  };
  candidate: {
    resume_id: string | null;
    candidate_name: string;
    position_applied: string;
    mapped_position: string;
    hr_review: string | null;
    business_screening_remark: string | null;
    profile: BusinessScreeningPublicProfile | undefined;
  };
  interviews: InterviewCardPublicInterview[];
  timeline: InterviewCardTimelineEvent[];
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseJsonObject<T>(value: unknown): T | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? (parsed as T) : null;
  } catch {
    return null;
  }
}

function isActiveLink(row: InterviewCardLinkRow, nowIso: string): boolean {
  return row.status === 'active' && row.expires_at > nowIso;
}

/** 计算过期时间：now + N 天（保持 UTC ISO 格式，与业务筛选一致） */
function addDays(nowIso: string, days: number): string {
  const date = new Date(nowIso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

/** 由卡片 id 确定性派生公开 token（与业务筛选固定链接同机制，URL 稳定可查询） */
export async function deriveInterviewCardToken(cardId: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`interview-card::${cardId}`));
  const bytes = new Uint8Array(digest);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base64Url = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  return `${TOKEN_PREFIX}${base64Url.slice(0, 28)}`;
}

export interface InterviewCardCreateInput {
  resumeId?: string;
  candidateName?: string;
  positionApplied?: string;
  createdBy?: string;
}

export interface InterviewCardCreateResult {
  id: string;
  token: string;
  url: string;
  expires_at: string;
  status: 'active';
  reused: boolean;
}

/**
 * 生成或复用某候选人的面试卡片链接（服务层，路由与面试提醒推送共用）。
 * 同一候选人已有链接时复用同一条记录并顺延 7 天（URL 由 id 确定性派生，保持稳定）；
 * 无则新建。resume_id 与 candidate_name 至少提供其一。
 */
export async function createOrReuseInterviewCardLink(
  db: D1Database,
  input: InterviewCardCreateInput,
  deps: { now: () => string; uuid: () => string; hashPublicToken: (token: string) => Promise<string> },
): Promise<InterviewCardCreateResult> {
  const resumeId = text(input.resumeId);
  const candidateName = text(input.candidateName);
  const positionApplied = text(input.positionApplied);
  if (!resumeId && !candidateName) {
    throw new Error('resume_id 或 candidate_name 至少提供一个');
  }

  const nowIso = deps.now();
  const expiresAt = addDays(nowIso, LINK_TTL_DAYS);

  const existing = await findLinkByIdentifier(db, { resumeId, candidateName, positionApplied });
  if (existing) {
    await db.prepare(
      `UPDATE ${CARD_TABLE} SET status = 'active', expires_at = ?, updated_at = ? WHERE id = ?`,
    ).bind(expiresAt, nowIso, existing.id).run();
    const token = await deriveInterviewCardToken(existing.id);
    return {
      id: existing.id,
      token,
      url: `/interview-card/${token}`,
      expires_at: expiresAt,
      status: 'active',
      reused: true,
    };
  }

  const id = deps.uuid();
  const token = await deriveInterviewCardToken(id);
  const tokenHash = await deps.hashPublicToken(token);
  await db.prepare(
    `INSERT INTO ${CARD_TABLE} (id, resume_id, candidate_name, position_applied, token_hash, status, expires_at, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
  ).bind(
    id,
    resumeId || null,
    candidateName || null,
    positionApplied || null,
    tokenHash,
    expiresAt,
    input.createdBy || '',
    nowIso,
    nowIso,
  ).run();

  return {
    id,
    token,
    url: `/interview-card/${token}`,
    expires_at: expiresAt,
    status: 'active',
    reused: false,
  };
}

const CARD_TABLE = 'interview_card_links';

async function findLinkByIdentifier(
  db: D1Database,
  identifier: { resumeId?: string; candidateName?: string; positionApplied?: string },
): Promise<InterviewCardLinkRow | null> {
  if (text(identifier.resumeId)) {
    return (await db.prepare(
      `SELECT * FROM ${CARD_TABLE} WHERE resume_id = ? ORDER BY created_at DESC LIMIT 1`,
    ).bind(identifier.resumeId).first()) as InterviewCardLinkRow | null;
  }
  const name = text(identifier.candidateName);
  if (!name) return null;
  const position = text(identifier.positionApplied);
  if (position) {
    return (await db.prepare(
      `SELECT * FROM ${CARD_TABLE} WHERE candidate_name = ? AND position_applied = ? ORDER BY created_at DESC LIMIT 1`,
    ).bind(name, position).first()) as InterviewCardLinkRow | null;
  }
  return (await db.prepare(
    `SELECT * FROM ${CARD_TABLE} WHERE candidate_name = ? ORDER BY created_at DESC LIMIT 1`,
  ).bind(name).first()) as InterviewCardLinkRow | null;
}

export function createInterviewCardRoutes(deps: InterviewCardRouteDeps) {
  const app = new Hono();

  const cardTable = CARD_TABLE;

  // ==================== 生成 / 复用面试卡片链接（登录态） ====================
  // body: { resume_id?, candidate_name?, position_applied? }
  // 同一候选人已有链接时复用同一条记录（已过期/已撤销则刷新为 active 并顺延 7 天），
  // URL 由 id 确定性派生，因此始终稳定不变。
  app.post('/api/interview-card-links', deps.authMiddleware, async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const resumeId = text(body.resume_id);
    const candidateName = text(body.candidate_name);
    const positionApplied = text(body.position_applied);

    if (!resumeId && !candidateName) {
      return c.json({ detail: 'resume_id 或 candidate_name 至少提供一个' }, 400);
    }

    try {
      const result = await createOrReuseInterviewCardLink(c.env.DB as D1Database, {
        resumeId,
        candidateName,
        positionApplied,
        createdBy: (c.get('user') as any)?.full_name || (c.get('user') as any)?.email || '',
      }, deps);
      return c.json(result);
    } catch (e: any) {
      return c.json({ detail: e?.message || '生成失败' }, 400);
    }
  });

  // ==================== 查询候选人已有面试卡片链接（登录态） ====================
  // query: ?resume_id= / ?candidate_name= / ?position_applied=
  app.get('/api/interview-card-links', deps.authMiddleware, async (c) => {
    const db = c.env.DB as D1Database;
    const resumeId = text(c.req.query('resume_id'));
    const candidateName = text(c.req.query('candidate_name'));
    const positionApplied = text(c.req.query('position_applied'));

    const clauses: string[] = [];
    const binds: any[] = [];
    if (resumeId) { clauses.push('resume_id = ?'); binds.push(resumeId); }
    if (candidateName) { clauses.push('candidate_name = ?'); binds.push(candidateName); }
    if (positionApplied) { clauses.push('position_applied = ?'); binds.push(positionApplied); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = await db.prepare(
      `SELECT * FROM ${cardTable} ${where} ORDER BY created_at DESC LIMIT 50`,
    ).bind(...binds).all();

    const nowIso = deps.now();
    const items: any[] = [];
    for (const row of (rows.results || []) as any[]) {
      const active = isActiveLink(row as InterviewCardLinkRow, nowIso);
      items.push({
        id: row.id,
        resume_id: row.resume_id,
        candidate_name: row.candidate_name,
        position_applied: row.position_applied,
        status: row.status,
        expires_at: row.expires_at,
        created_at: row.created_at,
        last_accessed_at: row.last_accessed_at,
        active,
        url: active ? `/interview-card/${await deriveInterviewCardToken(row.id)}` : null,
      });
    }
    return c.json({ items });
  });

  // ==================== 撤销面试卡片链接（登录态） ====================
  app.delete('/api/interview-card-links/:id', deps.authMiddleware, async (c) => {
    const db = c.env.DB as D1Database;
    const result = await db.prepare(
      `UPDATE ${cardTable} SET status = 'revoked' WHERE id = ?`,
    ).bind(c.req.param('id')).run();
    if ((result.meta.changes ?? 0) === 0) return c.json({ detail: 'Not found' }, 404);
    return c.json({ ok: true });
  });

  // ==================== 公开读取：免登录打开面试管理卡片 ====================
  app.get('/api/public/interview-card/:token', async (c) => {
    const token = c.req.param('token');
    const tokenHash = await deps.hashPublicToken(token);
    const db = c.env.DB as D1Database;
    const row = (await db.prepare(
      `SELECT * FROM ${cardTable} WHERE token_hash = ?`,
    ).bind(tokenHash).first()) as InterviewCardLinkRow | null;

    if (!row) return c.json({ detail: 'Not found' }, 404);

    const nowIso = deps.now();
    if (!isActiveLink(row, nowIso)) {
      return c.json({ detail: 'Link unavailable' }, 410);
    }

    // 记录最近访问时间（不影响主流程）
    await db.prepare(
      `UPDATE ${cardTable} SET last_accessed_at = ? WHERE id = ?`,
    ).bind(nowIso, row.id).run().catch(() => {});

    const candidateName = text(row.candidate_name) || '候选人';
    const positionApplied = text(row.position_applied);

    // 1) 候选人档案：优先 resume_id，缺失时按姓名兜底
    let resumeRow: any = null;
    if (text(row.resume_id)) {
      resumeRow = await db.prepare(
        `SELECT id, candidate_name, position_applied, mapped_position, parsed_data, education, work_experience,
                gender, birthday, certifications, self_evaluation, hr_review, business_screening_remark, status, stage
         FROM resumes WHERE id = ?`,
      ).bind(row.resume_id).first();
    }
    if (!resumeRow && candidateName !== '候选人') {
      resumeRow = await db.prepare(
        `SELECT id, candidate_name, position_applied, mapped_position, parsed_data, education, work_experience,
                gender, birthday, certifications, self_evaluation, hr_review, business_screening_remark, status, stage
         FROM resumes WHERE candidate_name = ?
         ORDER BY created_at DESC LIMIT 1`,
      ).bind(candidateName).first();
    }

    const profile = resumeRow
      ? buildPublicProfile(resumeRow.parsed_data, {
          education: resumeRow.education,
          workExperience: resumeRow.work_experience,
          gender: resumeRow.gender,
          birthday: resumeRow.birthday,
          certifications: resumeRow.certifications,
          selfEvaluation: resumeRow.self_evaluation,
        })
      : undefined;

    // 2) 面试记录：优先 resume_id，缺失时按候选人姓名（+岗位）匹配手动创建的面试
    let interviews: any[] = [];
    if (text(row.resume_id)) {
      const rows = await db.prepare(
        `SELECT * FROM interviews WHERE resume_id = ?
         ORDER BY COALESCE(round, 99) ASC, COALESCE(interview_time, started_at, created_at) ASC`,
      ).bind(row.resume_id).all();
      interviews = rows.results || [];
    }
    if (interviews.length === 0 && candidateName !== '候选人') {
      const clauses = ['candidate_name = ?'];
      const binds: any[] = [candidateName];
      if (positionApplied) { clauses.push('position_applied = ?'); binds.push(positionApplied); }
      const rows = await db.prepare(
        `SELECT * FROM interviews WHERE ${clauses.join(' AND ')}
         ORDER BY COALESCE(round, 99) ASC, COALESCE(interview_time, started_at, created_at) ASC`,
      ).bind(...binds).all();
      interviews = rows.results || [];
    }

    // 3) 进度时间线
    let timeline: any[] = [];
    const resumeIdForEvents = text(row.resume_id) || resumeRow?.id;
    if (resumeIdForEvents) {
      const rows = await db.prepare(
        `SELECT stage, action, occurred_at, actor_user_id, source, metadata_json
         FROM candidate_stage_events WHERE resume_id = ?
         ORDER BY occurred_at ASC`,
      ).bind(resumeIdForEvents).all();
      timeline = rows.results || [];
    }

    return c.json({
      card: {
        id: row.id,
        expires_at: row.expires_at,
        created_at: row.created_at,
        status: row.status,
      },
      candidate: {
        resume_id: resumeRow?.id || row.resume_id || null,
        candidate_name: resumeRow?.candidate_name || candidateName,
        position_applied: resumeRow?.position_applied || positionApplied,
        mapped_position: resumeRow?.mapped_position || '',
        hr_review: resumeRow?.hr_review || null,
        business_screening_remark: resumeRow?.business_screening_remark || null,
        profile,
      },
      interviews: interviews.map((iv: any) => ({
        id: iv.id,
        candidate_name: iv.candidate_name || null,
        position_applied: iv.position_applied || null,
        round: iv.round ?? null,
        interview_time: iv.interview_time || null,
        started_at: iv.started_at || null,
        interview_type: iv.interview_type || null,
        interview_category: iv.interview_category || null,
        interview_location: iv.interview_location || null,
        meeting_link: iv.meeting_link || null,
        status: iv.status || null,
        result: iv.result || null,
        result2: iv.result2 || null,
        status2: iv.status2 || null,
        interviewer: iv.interviewer || null,
        primary_interviewer: iv.primary_interviewer || null,
        secondary_interviewer: iv.secondary_interviewer || null,
        panel_members: iv.panel_members || null,
        total_score: iv.total_score ?? null,
        scores: parseJsonObject<Record<string, number>>(iv.scores),
        evaluation: iv.evaluation || null,
        evaluation2: iv.evaluation2 || null,
        suggestion: iv.suggestion || null,
        comments: parseJsonObject<Record<string, string>>(iv.comments),
      })),
      timeline: timeline.map((e: any) => ({
        stage: e.stage,
        action: e.action,
        occurred_at: e.occurred_at,
        actor_user_id: e.actor_user_id || null,
        source: e.source || 'manual',
        metadata: parseJsonObject<Record<string, unknown>>(e.metadata_json) || {},
      })),
    } satisfies InterviewCardPublicView);
  });

  return app;
}
