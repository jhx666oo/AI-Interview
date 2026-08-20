import { Hono } from 'hono';
import { buildPublicProfile, type BusinessScreeningPublicProfile } from '../business-screening/routes';
import { hashPublicToken } from '../business-screening/token';
import {
  getTenantAccessToken,
  listFreeInterviewSlots,
  updateInterviewCalendarEventTime,
} from '../interview-start/feishu-calendar';
import { resolveExactInterviewerOpenId } from '../feishu-notifications/reminder-source';

/**
 * 面试管理卡片（Interview Card Link）
 * 把单个候选人的面试情况（各轮面试、评分评价、备注、进度时间线）汇总到一个免登录公开链接，
 * 机制与业务筛选链接一致：token 确定性派生（SHA-256('interview-card::' + id)）、
 * DB 只存哈希、固定 30 天有效、可撤销、可续期。
 * 面向受众：业务方/用人部门查看面试进度、面试官之间协作查看。
 * 这是面试管理唯一链接：看简历、填评价、改面试时间都在这里。
 */

const LINK_TTL_DAYS = 30;
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
  getResumeFileBytes: (env: any, resumeId: string) => Promise<{ bytes: Uint8Array | null; fileName: string }>;
  // 公开页「重新解析」：卡片页简历信息未提取完整时，面试官可触发 AI 重新评估（入队去重）
  enqueueResumeReprocess?: (env: any, resumeId: string) => Promise<{ jobId: string; status: 'queued' | 'running'; queued: boolean }>;
  /** 飞书应用 ID（fallback：Pages 环境变量 FEISHU_APP_ID 缺失时用于获取 tenant token） */
  appId?: string;
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
    status: string | null;
    stage: string | null;
    parse_status: string | null;
    hr_review: string | null;
    business_screening_remark: string | null;
    // 简历评估（公开页主体信息，字段口径与业务筛选公开页一致：电话可见、邮箱不暴露）
    contact: string | null;
    match_score: number | null;
    screening_result: string | null;
    ai_review: string | null;
    ai_evaluation: string | null;
    capability_scores: string | null;
    hard_requirement_result: string | null;
    ocr_markdown: string | null;
    raw_text: string | null;
    resume_markdown: string | null;
    profile: BusinessScreeningPublicProfile | undefined;
  };
  interviews: InterviewCardPublicInterview[];
  timeline: InterviewCardTimelineEvent[];
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** 秒级时间戳 → 北京时间「YYYY-MM-DD HH:mm」（interview_time 存储口径） */
function formatBeijing(ts: number): string {
  const d = new Date(ts * 1000 + 8 * 3600_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** 解析「YYYY-MM-DD HH:mm」（北京时间）→ 毫秒时间戳，非法返回 null */
function parseBeijingTime(value: string): number | null {
  const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/);
  if (!m) return null;
  const ts = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+08:00`);
  return Number.isNaN(ts) ? null : ts;
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

/**
 * 由简历 id 确定性派生公开 token（一个简历固定一个链接）：
 * token 与随机卡片 id 无关，同一份简历无论何时、经哪个入口创建，链接都恒定一致。
 * 用于「进入面试管理即有固定链接、点击卡片只是打开链接而非生成」的语义。
 */
export async function deriveResumeInterviewCardToken(resumeId: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`interview-card-resume::${resumeId}`));
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
 * 一个简历固定一个链接：
 * - 有 resume_id：严格按简历维度唯一（不因姓名相同而合并），新链接 token 由 resume_id
 *   确定性派生（URL 与卡片 id 无关、永不漂移）；已存在则复用同一条并顺延 30 天。
 * - 无 resume_id（手动面试等）：按姓名+岗位兜底复用，URL 由卡片 id 派生保持稳定。
 * resume_id 与 candidate_name 至少提供其一。
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

  // —— 简历维度固定链接：有 resume_id 时严格按简历唯一（一个简历一个链接）——
  if (resumeId) {
    const existing = (await db.prepare(
      `SELECT * FROM ${CARD_TABLE} WHERE resume_id = ? ORDER BY created_at DESC LIMIT 1`,
    ).bind(resumeId).first()) as InterviewCardLinkRow | null;
    if (existing) {
      // 复用：刷新有效期并回填缺失的标识字段（URL 由既有 id 派生，保持不变）
      await db.prepare(
        `UPDATE ${CARD_TABLE}
         SET status = 'active', expires_at = ?, updated_at = ?,
             candidate_name = COALESCE(?, candidate_name),
             position_applied = COALESCE(?, position_applied)
         WHERE id = ?`,
      ).bind(
        expiresAt, nowIso,
        candidateName || null,
        positionApplied || null,
        existing.id,
      ).run();
      const token = await resolveRowToken(existing, deps);
      return {
        id: existing.id,
        token,
        url: `/interview-card/${token}`,
        expires_at: expiresAt,
        status: 'active',
        reused: true,
      };
    }

    // 新建：token 由 resume_id 确定性派生，同一份简历永远同一链接
    const id = deps.uuid();
    const token = await deriveResumeInterviewCardToken(resumeId);
    const tokenHash = await deps.hashPublicToken(token);
    await db.prepare(
      `INSERT INTO ${CARD_TABLE} (id, resume_id, candidate_name, position_applied, token_hash, status, expires_at, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
    ).bind(
      id,
      resumeId,
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

  // —— 无 resume_id（手动面试等）：姓名+岗位兜底复用，URL 由卡片 id 派生保持稳定 ——
  const existing = await findLinkByName(db, { candidateName, positionApplied });
  if (existing) {
    await db.prepare(
      `UPDATE ${CARD_TABLE}
       SET status = 'active', expires_at = ?, updated_at = ?,
           position_applied = COALESCE(?, position_applied)
       WHERE id = ?`,
    ).bind(
      expiresAt, nowIso,
      positionApplied || null,
      existing.id,
    ).run();
    const token = await resolveRowToken(existing, deps);
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
    null,
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

/**
 * 反推一行记录当前应使用的 token（与 DB 中已存 token_hash 保持一致）：
 * - 新方案（有 resume_id）：token = deriveResumeInterviewCardToken(resume_id)，创建/复用 URL 恒定一致；
 * - 旧方案（历史行或纯姓名行）：token = deriveInterviewCardToken(id)；
 * 通过比对存储的 token_hash 区分，避免历史行在复用/列表展示时 URL 漂移。
 */
async function resolveRowToken(
  row: InterviewCardLinkRow,
  deps: { hashPublicToken: (token: string) => Promise<string> },
): Promise<string> {
  const resumeId = text(row.resume_id);
  if (resumeId) {
    const resumeToken = await deriveResumeInterviewCardToken(resumeId);
    if (row.token_hash === await deps.hashPublicToken(resumeToken)) return resumeToken;
  }
  return deriveInterviewCardToken(row.id);
}

/** 仅按姓名（+岗位）查找既有链接：用于无 resume_id 的手动面试等场景 */
async function findLinkByName(
  db: D1Database,
  identifier: { candidateName?: string; positionApplied?: string },
): Promise<InterviewCardLinkRow | null> {
  const name = text(identifier.candidateName);
  if (!name) return null;
  const position = text(identifier.positionApplied);
  if (position) {
    const row = (await db.prepare(
      `SELECT * FROM ${CARD_TABLE} WHERE candidate_name = ? AND position_applied = ? ORDER BY created_at DESC LIMIT 1`,
    ).bind(name, position).first()) as InterviewCardLinkRow | null;
    if (row) return row;
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
  // 同一候选人已有链接时复用同一条记录（已过期/已撤销则刷新为 active 并顺延 30 天），
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

  // ==================== 批量确保面试卡片链接（登录态，面试管理页进入时调用） ====================
  // body: { items: [{ resume_id, candidate_name?, position_applied? }] }
  // 为每份简历确保存在固定链接：已有则复用并续期（URL 不变），没有则按简历 id 确定性派生创建。
  // 这样「进入面试管理即有固定链接」，前端点击卡片只是打开链接、不再实时生成。
  app.post('/api/interview-card-links/batch', deps.authMiddleware, async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const rawItems = Array.isArray(body?.items) ? body.items : [];
    const db = c.env.DB as D1Database;
    const actor = (c.get('user') as any)?.full_name || (c.get('user') as any)?.email || '';
    const items: any[] = [];
    const errors: any[] = [];
    for (const raw of rawItems) {
      const resumeId = text(raw?.resume_id);
      if (!resumeId) continue;
      try {
        const result = await createOrReuseInterviewCardLink(db, {
          resumeId,
          candidateName: text(raw?.candidate_name) || undefined,
          positionApplied: text(raw?.position_applied) || undefined,
          createdBy: actor,
        }, deps);
        items.push({
          resume_id: resumeId,
          url: result.url,
          expires_at: result.expires_at,
          reused: result.reused,
        });
      } catch (e: any) {
        errors.push({ resume_id: resumeId, detail: e?.message || '生成失败' });
      }
    }
    return c.json({ items, errors });
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
        url: active ? `/interview-card/${await resolveRowToken(row as InterviewCardLinkRow, deps)}` : null,
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
    const resumeCols = `id, candidate_name, position_applied, mapped_position, parsed_data, education, work_experience,
                gender, birthday, certifications, self_evaluation, hr_review, business_screening_remark,
                status, stage, parse_status, contact, match_score, screening_result, ai_review, ai_evaluation,
                capability_scores, hard_requirement_result, ocr_markdown, raw_text, resume_markdown`;
    let resumeRow: any = null;
    if (text(row.resume_id)) {
      resumeRow = await db.prepare(
        `SELECT ${resumeCols} FROM resumes WHERE id = ?`,
      ).bind(row.resume_id).first();
    }
    if (!resumeRow && candidateName !== '候选人') {
      resumeRow = await db.prepare(
        `SELECT ${resumeCols} FROM resumes WHERE candidate_name = ?
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
        status: resumeRow?.status || null,
        stage: resumeRow?.stage || null,
        parse_status: resumeRow?.parse_status || null,
        hr_review: resumeRow?.hr_review || null,
        business_screening_remark: resumeRow?.business_screening_remark || null,
        contact: resumeRow?.contact || null,
        match_score: resumeRow?.match_score ?? null,
        screening_result: resumeRow?.screening_result || null,
        ai_review: resumeRow?.ai_review || null,
        ai_evaluation: resumeRow?.ai_evaluation || null,
        capability_scores: resumeRow?.capability_scores || null,
        hard_requirement_result: resumeRow?.hard_requirement_result || null,
        ocr_markdown: resumeRow?.ocr_markdown || null,
        raw_text: resumeRow?.raw_text || null,
        resume_markdown: resumeRow?.resume_markdown || null,
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

  // ==================== 公开写入：面试官在卡片链接内填写面试评价 ====================
  // body: { evaluation?, result?, round? }  result: 'passed' | 'failed'，round: 1 | 2
  // 语义与内部 POST /api/interviews/:id/evaluate 一致（一面通过→待二面，否则→已完成；二面→已完成）。
  // 候选人无面试记录时自动创建一面面试记录，保证「面试管理能改的，链接都能改」。
  app.post('/api/public/interview-card/:token/evaluate', async (c) => {
    const token = c.req.param('token');
    const tokenHash = await deps.hashPublicToken(token);
    const db = c.env.DB as D1Database;
    const row = (await db.prepare(
      `SELECT * FROM ${cardTable} WHERE token_hash = ?`,
    ).bind(tokenHash).first()) as InterviewCardLinkRow | null;
    if (!row) return c.json({ detail: 'Not found' }, 404);
    if (!isActiveLink(row, deps.now())) return c.json({ detail: 'Link unavailable' }, 410);

    const body = await c.req.json().catch(() => ({}));
    const evaluation = text(body.evaluation);
    const result = text(body.result);
    if (!evaluation && !result) {
      return c.json({ detail: '请填写评价或选择结果' }, 400);
    }
    if (result && result !== 'passed' && result !== 'failed') {
      return c.json({ detail: 'result 仅支持 passed / failed' }, 400);
    }
    const round = body.round === 2 ? 2 : 1;

    const resumeId = text(row.resume_id);
    // 找到该候选人关联的面试记录（优先简历维度，缺失时按姓名兜底，取第一条）
    let interview: any = null;
    if (resumeId) {
      interview = await db.prepare(
        `SELECT * FROM interviews WHERE resume_id = ?
         ORDER BY COALESCE(round, 99) ASC, COALESCE(interview_time, started_at, created_at) ASC LIMIT 1`,
      ).bind(resumeId).first();
    }
    if (!interview && text(row.candidate_name)) {
      interview = await db.prepare(
        `SELECT * FROM interviews WHERE candidate_name = ?
         ORDER BY COALESCE(round, 99) ASC, COALESCE(interview_time, started_at, created_at) ASC LIMIT 1`,
      ).bind(text(row.candidate_name)).first();
    }
    // 无面试记录：自动创建一面面试（面试管理页同步可见），再写入评价
    if (!interview) {
      const candidateName = text(row.candidate_name);
      if (!candidateName && !resumeId) {
        return c.json({ detail: '该候选人暂无可评价的面试记录' }, 404);
      }
      const nowIso = deps.now();
      const newId = deps.uuid();
      await db.prepare(
        `INSERT INTO interviews (id, resume_id, candidate_name, position_applied, round, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, 'scheduled', ?, ?)`,
      ).bind(newId, resumeId || null, candidateName, text(row.position_applied), nowIso, nowIso).run();
      interview = { id: newId };
    }

    const nowIso = deps.now();
    if (round === 1) {
      const newStatus = result === 'passed' ? 'scheduled' : 'completed';
      const updates: string[] = ['status = ?'];
      const binds: any[] = [newStatus];
      if (evaluation) { updates.push('evaluation = ?'); binds.push(evaluation); }
      if (result) { updates.push('result = ?'); binds.push(result); }
      await db.prepare(
        `UPDATE interviews SET ${updates.join(', ')}, updated_at = ? WHERE id = ?`,
      ).bind(...binds, nowIso, interview.id).run();
    } else {
      const updates: string[] = ['status2 = ?'];
      const binds: any[] = ['completed'];
      if (evaluation) { updates.push('evaluation2 = ?'); binds.push(evaluation); }
      if (result) { updates.push('result2 = ?'); binds.push(result); }
      await db.prepare(
        `UPDATE interviews SET ${updates.join(', ')}, updated_at = ? WHERE id = ?`,
      ).bind(...binds, nowIso, interview.id).run();
    }

    return c.json({ ok: true, detail: `第${round}面评价已提交`, interview_id: interview.id });
  });

  // ==================== 公开读取：推荐空闲面试时段（改时间用，interview-invite 功能迁移） ====================
  // 返回主面试官未来 2 个工作日的空闲 1 小时时段（跳过周末、避开午休），30 分钟粒度
  app.get('/api/public/interview-card/:token/slots', async (c) => {
    const token = c.req.param('token');
    const tokenHash = await deps.hashPublicToken(token);
    const db = c.env.DB as D1Database;
    const row = (await db.prepare(
      `SELECT * FROM ${cardTable} WHERE token_hash = ?`,
    ).bind(tokenHash).first()) as InterviewCardLinkRow | null;
    if (!row) return c.json({ detail: 'Not found' }, 404);
    if (!isActiveLink(row, deps.now())) return c.json({ detail: 'Link unavailable' }, 410);

    // 面试官：优先简历维度，缺失时按候选人姓名兜底（手动创建的面试无 resume_id）
    let resumeRow: any = null;
    if (text(row.resume_id)) {
      resumeRow = await db.prepare('SELECT primary_interviewer, interviewer FROM interviews WHERE resume_id = ? ORDER BY COALESCE(round, 99) ASC LIMIT 1').bind(row.resume_id).first();
    }
    if (!resumeRow && text(row.candidate_name)) {
      resumeRow = await db.prepare('SELECT primary_interviewer, interviewer FROM interviews WHERE candidate_name = ? ORDER BY COALESCE(round, 99) ASC LIMIT 1').bind(text(row.candidate_name)).first();
    }
    const primaryName = text(resumeRow?.primary_interviewer) || text(resumeRow?.interviewer);
    if (!primaryName) return c.json({ ok: true, slots: [], reason: '面试未配置面试官' });

    const openId = await resolveExactInterviewerOpenId(db, primaryName);
    if (!openId) return c.json({ ok: true, slots: [], reason: `面试官「${primaryName}」未绑定飞书身份，暂无法推荐空闲时段` });

    try {
      const feishuToken = await getTenantAccessToken(c.env, deps.appId);
      let busyError: string | null = null;
      const slots = await listFreeInterviewSlots({
        token: feishuToken,
        openId,
        fromTs: Math.floor(Date.now() / 1000),
        durationMinutes: 60,
        skipWorkdays: 2,
        workdays: 3,
      }, {
        onBusyError: (message: string) => { busyError = message; },
      });
      return c.json({
        ok: true,
        interviewer: primaryName,
        slots: slots.map((s) => ({ start: formatBeijing(s.startTs), end: formatBeijing(s.endTs) })),
        reason: slots.length === 0
          ? (busyError ? `空闲时段查询失败：${busyError}` : '未来两个工作日之后未找到空闲时段')
          : undefined,
      });
    } catch (e: any) {
      return c.json({ ok: true, slots: [], reason: `空闲时段查询失败：${e?.message || e}` });
    }
  });

  // ==================== 公开写入：改面试时间（同步飞书日程，interview-invite 功能迁移） ====================
  // body: { interview_time: "YYYY-MM-DD HH:mm" }（北京时间）
  app.post('/api/public/interview-card/:token/reschedule', async (c) => {
    const token = c.req.param('token');
    const tokenHash = await deps.hashPublicToken(token);
    const db = c.env.DB as D1Database;
    const row = (await db.prepare(
      `SELECT * FROM ${cardTable} WHERE token_hash = ?`,
    ).bind(tokenHash).first()) as InterviewCardLinkRow | null;
    if (!row) return c.json({ detail: 'Not found' }, 404);
    if (!isActiveLink(row, deps.now())) return c.json({ detail: 'Link unavailable' }, 410);

    const body = await c.req.json().catch(() => ({}));
    const interviewTime = text(body.interview_time);
    const startMs = parseBeijingTime(interviewTime);
    if (!startMs) return c.json({ detail: '面试时间格式应为 YYYY-MM-DD HH:mm' }, 400);
    if (startMs < Date.now() - 5 * 60_000) return c.json({ detail: '面试时间不能早于当前时间' }, 400);

    // 找到该候选人关联的面试记录（优先简历维度，缺失时按姓名兜底，取第一条）
    let interview: any = null;
    if (text(row.resume_id)) {
      interview = await db.prepare(
        `SELECT * FROM interviews WHERE resume_id = ?
         ORDER BY COALESCE(round, 99) ASC, COALESCE(interview_time, started_at, created_at) ASC LIMIT 1`,
      ).bind(row.resume_id).first();
    }
    if (!interview && text(row.candidate_name)) {
      interview = await db.prepare(
        `SELECT * FROM interviews WHERE candidate_name = ?
         ORDER BY COALESCE(round, 99) ASC, COALESCE(interview_time, started_at, created_at) ASC LIMIT 1`,
      ).bind(text(row.candidate_name)).first();
    }
    if (!interview) return c.json({ detail: '该候选人暂无可调整的面试记录' }, 404);

    const nowIso = deps.now();
    await db.prepare('UPDATE interviews SET interview_time = ?, updated_at = ? WHERE id = ?')
      .bind(interviewTime, nowIso, interview.id).run();

    // 同步飞书日程（已有日程才更新；失败仅提示，不阻断改时间）
    let calendarSynced = false;
    let calendarWarning: string | null = null;
    const eventId = text(interview.feishu_event_id);
    if (eventId) {
      const startTs = Math.floor(startMs / 1000);
      const result = await updateInterviewCalendarEventTime(c.env, eventId, {
        startTimestamp: startTs,
        endTimestamp: startTs + 3600,
      }, {}, deps.appId);
      calendarSynced = result.ok;
      if (!result.ok) calendarWarning = result.error || '飞书日程时间更新失败，请稍后在面试管理页确认';
    }

    return c.json({
      ok: true,
      interview_time: interviewTime,
      calendar_synced: calendarSynced,
      calendar_warning: calendarWarning,
    });
  });

  // ==================== 公开读取：免登录预览/下载候选人简历 PDF ====================
  // 与业务筛选文件端点同机制：?preview=1 inline 预览 / 默认 attachment 下载
  app.get('/api/public/interview-card/:token/file', async (c) => {
    const tokenHash = await deps.hashPublicToken(c.req.param('token'));
    const db = c.env.DB as D1Database;
    const row = (await db.prepare(
      `SELECT * FROM ${cardTable} WHERE token_hash = ?`,
    ).bind(tokenHash).first()) as InterviewCardLinkRow | null;
    if (!row) return c.json({ detail: 'Not found' }, 404);
    if (!isActiveLink(row, deps.now())) return c.json({ detail: 'Link unavailable' }, 410);

    // 与公开读取一致的简历解析：优先 resume_id，缺失时按姓名兜底
    let resumeId = text(row.resume_id);
    if (!resumeId) {
      const candidateName = text(row.candidate_name);
      if (!candidateName) return c.json({ detail: 'Not found' }, 404);
      const resumeRow = await db.prepare(
        'SELECT id FROM resumes WHERE candidate_name = ? ORDER BY created_at DESC LIMIT 1',
      ).bind(candidateName).first();
      resumeId = resumeRow?.id || '';
    }
    if (!resumeId) return c.json({ detail: 'Not found' }, 404);

    const file = await deps.getResumeFileBytes(c.env, resumeId);
    if (!file.bytes) {
      return c.json({ detail: '该简历源文件未本地缓存，无法预览。请重新上传 PDF 或联系管理员', not_cached: true }, 404);
    }
    const isPreview = c.req.query('preview') === 'true' || c.req.query('preview') === '1';
    const safeName = (text(row.candidate_name) || 'resume').replace(/[\\/:*?"<>|]/g, '_');
    return new Response(file.bytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${isPreview ? 'inline' : 'attachment'}; filename="${encodeURIComponent(safeName)}.pdf"`,
        'Cache-Control': 'private, max-age=300',
      },
    });
  });

  // 公开「重新解析」：卡片页简历信息未提取完整时，面试官可触发 AI 重新评估（免登录，凭链接 token 校验）
  app.post('/api/public/interview-card/:token/reparse', async (c) => {
    const tokenHash = await deps.hashPublicToken(c.req.param('token'));
    const db = c.env.DB as D1Database;
    const row = (await db.prepare(
      `SELECT * FROM ${CARD_TABLE} WHERE token_hash = ?`,
    ).bind(tokenHash).first()) as InterviewCardLinkRow | null;
    if (!row) return c.json({ detail: 'Not found' }, 404);
    if (!isActiveLink(row, deps.now())) return c.json({ detail: 'Link unavailable' }, 410);

    // 与公开读取一致的简历解析：优先 resume_id，缺失时按姓名兜底
    let resumeId = text(row.resume_id);
    if (!resumeId) {
      const candidateName = text(row.candidate_name);
      if (!candidateName) return c.json({ detail: 'Not found' }, 404);
      const resumeRow = await db.prepare(
        'SELECT id FROM resumes WHERE candidate_name = ? ORDER BY created_at DESC LIMIT 1',
      ).bind(candidateName).first();
      resumeId = resumeRow?.id || '';
    }
    if (!resumeId) return c.json({ detail: 'Not found' }, 404);
    if (!deps.enqueueResumeReprocess) return c.json({ detail: '重新解析暂不可用，请联系 HR' }, 503);

    try {
      const result = await deps.enqueueResumeReprocess(c.env, resumeId);
      return c.json({
        ok: true,
        resume_id: resumeId,
        job_id: result.jobId,
        queued: result.queued,
        status: result.status,
      });
    } catch (e: any) {
      return c.json({ detail: e?.message || '重新解析失败' }, 500);
    }
  });

  return app;
}
