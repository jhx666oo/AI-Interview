import { Hono } from 'hono';

/**
 * 候选人面试详情免登录页（Interview Invite）
 * 「开始面试」流程给候选人邮件附带的公开链接，token 由面试 id 确定性派生、
 * DB 只存哈希（interviews.invite_token_hash）、固定 7 天有效。
 * 只透出候选人本人可见的面试安排信息，不含任何内部评估/评分/联系方式。
 */

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

export function createInterviewStartRoutes(deps: InterviewInviteRouteDeps) {
  const app = new Hono();

  // ==================== 公开读取：免登录查看面试详情（候选人视角） ====================
  app.get('/api/public/interview-invite/:token', async (c) => {
    const token = c.req.param('token');
    const tokenHash = await deps.hashPublicToken(token);
    const db = c.env.DB as D1Database;

    let row: any;
    try {
      row = await db.prepare(
        `SELECT id, candidate_name, position_applied, interview_time, interview_type, interview_location,
                meeting_link, round, interviewer, primary_interviewer, secondary_interviewer, status,
                invite_token_hash, invite_expires_at
         FROM interviews WHERE invite_token_hash = ?`,
      ).bind(tokenHash).first();
    } catch {
      return c.json({ detail: 'Interview invite unavailable' }, 410);
    }

    if (!row) return c.json({ detail: 'Not found' }, 404);
    const nowIso = deps.now();
    if (text(row.invite_token_hash) !== tokenHash || !text(row.invite_expires_at) || row.invite_expires_at <= nowIso) {
      return c.json({ detail: 'Link unavailable' }, 410);
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

  return app;
}
