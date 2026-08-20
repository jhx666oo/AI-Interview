import { Hono } from 'hono';

/**
 * 候选人面试详情免登录页（Interview Invite）
 * 「开始面试」流程给候选人邮件附带的公开链接，token 由面试 id 确定性派生、
 * DB 只存哈希（interviews.invite_token_hash）、固定 7 天有效。
 * 只透出候选人本人可见的面试安排信息，不含任何内部评估/评分/联系方式。
 * 另提供面试官改时间能力：GET slots（未来工作日空闲时段点选）+ POST reschedule（改时间并同步飞书日程）。
 */

import {
  getTenantAccessToken,
  listFreeInterviewSlots,
  updateInterviewCalendarEventTime,
} from './feishu-calendar';
import { resolveExactInterviewerOpenId } from '../feishu-notifications/reminder-source';

export interface InterviewInviteRouteDeps {
  now: () => string;
  hashPublicToken: (token: string) => Promise<string>;
}

export interface InterviewInvitePublicView {
  interview: {
    id: string;
    candidate_name: string;
    position_applied: string;
    interview_time: string | null;
    interview_type: string | null;
    interview_location: string | null;
    meeting_link: string | null;
    round: number | null;
    interviewer: string | null;
    primary_interviewer: string | null;
    secondary_interviewer: string | null;
    status: string | null;
  };
  invite: {
    expires_at: string;
  };
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

interface InviteRow {
  id: string;
  candidate_name: string | null;
  position_applied: string | null;
  interview_time: string | null;
  interview_type: string | null;
  interview_location: string | null;
  meeting_link: string | null;
  round: number | null;
  interviewer: string | null;
  primary_interviewer: string | null;
  secondary_interviewer: string | null;
  status: string | null;
  invite_token_hash: string | null;
  invite_expires_at: string | null;
  feishu_event_id: string | null;
  [key: string]: unknown;
}

/** 按 token 哈希取有效面试记录（存在且未过期），失败返回 404/410 响应体类型 */
async function loadInviteRow(
  c: any,
  tokenHash: string,
  nowIso: string,
): Promise<InviteRow | null> {
  let row: any;
  try {
    row = await (c.env.DB as D1Database).prepare(
      `SELECT * FROM interviews WHERE invite_token_hash = ?`,
    ).bind(tokenHash).first();
  } catch {
    return null;
  }
  if (!row) return null;
  if (text(row.invite_token_hash) !== tokenHash || !text(row.invite_expires_at) || row.invite_expires_at <= nowIso) {
    return null;
  }
  return row as InviteRow;
}

export function createInterviewStartRoutes(deps: InterviewInviteRouteDeps) {
  const app = new Hono();

  // ==================== 公开读取：免登录查看面试详情（候选人视角） ====================
  app.get('/api/public/interview-invite/:token', async (c) => {
    const token = c.req.param('token');
    const tokenHash = await deps.hashPublicToken(token);
    const db = c.env.DB as D1Database;
    const nowIso = deps.now();

    const row = await loadInviteRow(c, tokenHash, nowIso);
    if (!row) {
      const exists = await db.prepare('SELECT id FROM interviews WHERE invite_token_hash = ?').bind(tokenHash).first();
      return c.json({ detail: exists ? 'Link unavailable' : 'Not found' }, exists ? 410 : 404);
    }

    return c.json({
      interview: {
        id: row.id,
        candidate_name: text(row.candidate_name) || '候选人',
        position_applied: text(row.position_applied) || '',
        interview_time: text(row.interview_time) || null,
        interview_type: text(row.interview_type) || null,
        interview_location: text(row.interview_location) || null,
        meeting_link: text(row.meeting_link) || null,
        round: row.round ?? null,
        interviewer: text(row.interviewer) || null,
        primary_interviewer: text(row.primary_interviewer) || null,
        secondary_interviewer: text(row.secondary_interviewer) || null,
        status: text(row.status) || null,
      },
      invite: {
        expires_at: row.invite_expires_at,
      },
    } satisfies InterviewInvitePublicView);
  });

  // ==================== 公开读取：推荐空闲面试时段（面试官改时间用） ====================
  // 返回主面试官未来 2 个工作日的空闲 1 小时时段（跳过周末、避开午休），30 分钟粒度
  app.get('/api/public/interview-invite/:token/slots', async (c) => {
    const token = c.req.param('token');
    const tokenHash = await deps.hashPublicToken(token);
    const row = await loadInviteRow(c, tokenHash, deps.now());
    if (!row) return c.json({ detail: 'Link unavailable' }, 410);

    const primaryName = text(row.primary_interviewer) || text(row.interviewer);
    if (!primaryName) return c.json({ ok: true, slots: [], reason: '面试未配置面试官' });

    const openId = await resolveExactInterviewerOpenId(c.env.DB as D1Database, primaryName);
    if (!openId) return c.json({ ok: true, slots: [], reason: `面试官「${primaryName}」未绑定飞书身份，暂无法推荐空闲时段` });

    try {
      const feishuToken = await getTenantAccessToken(c.env);
      const slots = await listFreeInterviewSlots({
        token: feishuToken,
        openId,
        fromTs: Math.floor(Date.now() / 1000),
        durationMinutes: 60,
        workdays: 2,
      });
      return c.json({
        ok: true,
        interviewer: primaryName,
        slots: slots.map((s) => ({ start: formatBeijing(s.startTs), end: formatBeijing(s.endTs) })),
      });
    } catch (e: any) {
      return c.json({ ok: true, slots: [], reason: `空闲时段查询失败：${e?.message || e}` });
    }
  });

  // ==================== 公开写入（已关闭） ====================
  // 面试时间必须由登录后的系统流程变更，并通过自动化队列同步日历。
  app.post('/api/public/interview-invite/:token/reschedule', async (c) => {
    return c.json({
      detail: '公开改期入口已关闭，请登录系统后在面试管理页调整时间',
      code: 'PUBLIC_WRITE_DISABLED',
      retryable: false,
    }, 410);
  });

  return app;
}
