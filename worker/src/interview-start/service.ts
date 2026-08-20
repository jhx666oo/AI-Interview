/**
 * 「开始面试」流程服务层：
 * 1. 加载面试上下文（面试记录 + 简历邮箱/姓名/岗位）
 * 2. 候选人面试详情免登录链接（interview-invite）：token 由面试 id 确定性派生
 *    （SHA-256('interview-invite::' + id)），DB 只存哈希与有效期，固定 7 天、可续期，
 *    机制与业务筛选/面试卡片链接一致。
 * 3. 候选人邀请邮件发送编排（SMTP 配置来自 system_configs）。
 */

import { buildInterviewInvitationEmail, type BuiltEmail } from './email-template';
import { loadSmtpConfig, sendSmtpMail, type SmtpDeps } from './smtp';

const INVITE_TTL_DAYS = 7;
const TOKEN_PREFIX = 'ii-';
export const DEFAULT_FRONTEND_URL = 'https://ai-interview-88r.pages.dev';

export interface InterviewStartInterview {
  id: string;
  resume_id?: string | null;
  candidate_name?: string | null;
  position_applied?: string | null;
  interview_time?: string | null;
  interview_type?: string | null;
  interview_location?: string | null;
  interviewer?: string | null;
  primary_interviewer?: string | null;
  secondary_interviewer?: string | null;
  meeting_link?: string | null;
  invite_token_hash?: string | null;
  invite_expires_at?: string | null;
  status?: string | null;
  round?: number | null;
}

export interface InterviewStartContext {
  interview: InterviewStartInterview;
  candidateEmail: string | null;
  candidateName: string;
  positionName: string;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** 候选人邮箱：优先简历 email 列，缺失时从 parsed_data 兜底 */
function extractEmail(resume: any): string | null {
  const direct = text(resume?.email);
  if (direct) return direct;
  try {
    const parsed = typeof resume?.parsed_data === 'string' ? JSON.parse(resume.parsed_data) : resume?.parsed_data;
    const fromParsed = text(parsed?.email) || text(parsed?.contact?.email);
    if (fromParsed) return fromParsed;
  } catch { /* ignore */ }
  return null;
}

export async function loadInterviewStartContext(db: D1Database, interviewId: string): Promise<InterviewStartContext | null> {
  const interview = (await db.prepare('SELECT * FROM interviews WHERE id = ?').bind(interviewId).first()) as InterviewStartInterview | null;
  if (!interview) return null;

  let candidateEmail: string | null = null;
  let candidateName = text(interview.candidate_name) || '候选人';
  let positionName = text(interview.position_applied) || '应聘岗位';

  const resumeId = text(interview.resume_id);
  if (resumeId) {
    const resume: any = await db.prepare('SELECT id, candidate_name, position_applied, mapped_position, email, parsed_data FROM resumes WHERE id = ?').bind(resumeId).first();
    if (resume) {
      candidateEmail = extractEmail(resume);
      if (text(resume.candidate_name)) candidateName = text(resume.candidate_name);
      positionName = text(resume.position_applied) || text(resume.mapped_position) || positionName;
    }
  }
  return { interview, candidateEmail, candidateName, positionName };
}

// ==================== 面试时间 ====================

export interface EventTimeframe {
  startTs: number;
  endTs: number;
  timeLabel: string;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function formatLocal(ts: number): string {
  // 展示统一按北京时间（UTC+8），与输入口径一致（Workers 运行时时区固定为 UTC）
  const d = new Date(ts + 8 * 3600_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** 解析面试时间：裸的 "YYYY-MM-DD HH:mm" 按北京时间（+08:00）解析，其余交给 Date.parse */
function parseInterviewTime(raw: string): number {
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (m && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw)) {
    return Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+08:00`);
  }
  return Date.parse(raw);
}

/**
 * 解析面试时间：interview_time 可为 ISO / "YYYY-MM-DD HH:mm" 等格式
 * （无时区信息时按北京时间解析）；解析失败或缺失时回退为「当前时间 ~ +60 分钟」。
 */
export function resolveEventTimeframe(interview: InterviewStartInterview, nowMs: number = Date.now(), durationMinutes = 60): EventTimeframe {
  const raw = text(interview.interview_time);
  let startTs = NaN;
  if (raw) startTs = parseInterviewTime(raw);
  if (Number.isNaN(startTs) || startTs <= 0) startTs = nowMs;
  // 已过期的面试时间 → 从当前时间起算
  if (startTs + durationMinutes * 60_000 < nowMs) startTs = nowMs;
  const endTs = startTs + durationMinutes * 60_000;
  return {
    startTs: Math.floor(startTs / 1000),
    endTs: Math.floor(endTs / 1000),
    timeLabel: `${formatLocal(startTs)} ~ ${formatLocal(endTs)}`,
  };
}

export function interviewTypeLabel(interview: InterviewStartInterview): string {
  const type = text(interview.interview_type);
  if (type === 'onsite') return '现场面试';
  if (type === 'video' || type === 'online' || type === 'remote') return '线上面试';
  if (type === 'phone') return '电话面试';
  return type || '线上面试';
}

// ==================== 候选人免登录详情链接 ====================

/** 由面试 id 确定性派生候选人邀请 token（与业务筛选/面试卡片同机制） */
export async function deriveInterviewInviteToken(interviewId: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`interview-invite::${interviewId}`));
  const bytes = new Uint8Array(digest);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base64Url = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  return `${TOKEN_PREFIX}${base64Url.slice(0, 28)}`;
}

function addDays(nowIso: string, days: number): string {
  const date = new Date(nowIso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

export interface InterviewInviteLink {
  token: string;
  url: string;
  expiresAt: string;
  reused: boolean;
}

export interface InterviewInviteDeps {
  now: () => string;
  hashPublicToken: (token: string) => Promise<string>;
}

/** 生成或续期候选人面试详情免登录链接（同一面试 URL 恒定，复用时顺延 7 天） */
export async function ensureInterviewInvite(
  db: D1Database,
  interview: InterviewStartInterview,
  deps: InterviewInviteDeps,
): Promise<InterviewInviteLink> {
  const token = await deriveInterviewInviteToken(interview.id);
  const tokenHash = await deps.hashPublicToken(token);
  const nowIso = deps.now();
  const existingHash = text(interview.invite_token_hash);
  const existingExpiry = text(interview.invite_expires_at);
  const stillValid = existingHash === tokenHash && existingExpiry > nowIso;

  const expiresAt = stillValid ? existingExpiry : addDays(nowIso, INVITE_TTL_DAYS);
  if (!stillValid) {
    await db.prepare(
      'UPDATE interviews SET invite_token_hash = ?, invite_expires_at = ?, updated_at = ? WHERE id = ?',
    ).bind(tokenHash, expiresAt, nowIso, interview.id).run();
  }
  return { token, url: `/interview-invite/${token}`, expiresAt, reused: stillValid };
}

export function frontendBaseUrl(frontendUrl: unknown): string {
  const raw = text(frontendUrl);
  return raw ? raw.replace(/\/+$/, '') : DEFAULT_FRONTEND_URL;
}

// ==================== 候选人邮件 ====================

export type CandidateEmailStatus =
  | { status: 'sent'; to: string }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; reason: string };

export interface SendCandidateEmailInput {
  ctx: InterviewStartContext;
  meetingUrl: string | null;
  fromName: string;
  nowIso: string;
}

export interface SendCandidateEmailDeps extends SmtpDeps {
  loadConfig?: (db: D1Database) => Promise<any>;
}

export async function sendCandidateInterviewEmail(
  db: D1Database,
  input: SendCandidateEmailInput,
  deps: SendCandidateEmailDeps = {},
): Promise<CandidateEmailStatus> {
  const { ctx } = input;
  if (!ctx.candidateEmail) {
    return { status: 'skipped', reason: '候选人简历未解析到邮箱，邮件未发送（会议链接已生成，可线下告知）' };
  }
  const config = deps.loadConfig ? await deps.loadConfig(db) : await loadSmtpConfig(db);
  if (!config) {
    return { status: 'skipped', reason: 'SMTP 邮件服务未启用或配置不完整（系统设置 → 邮件设置）' };
  }
  const email: BuiltEmail = buildInterviewInvitationEmail({
    candidateName: ctx.candidateName,
    positionName: ctx.positionName,
    timeLabel: resolveEventTimeframe(ctx.interview).timeLabel,
    interviewTypeLabel: interviewTypeLabel(ctx.interview),
    location: text(ctx.interview.interview_location) || null,
    interviewerName: text(ctx.interview.primary_interviewer) || text(ctx.interview.interviewer) || null,
    meetingUrl: input.meetingUrl,
    fromName: input.fromName,
  });
  try {
    await sendSmtpMail(config, { to: ctx.candidateEmail, ...email }, deps);
  } catch (e: any) {
    return { status: 'failed', reason: `邮件发送失败：${e?.message || e}` };
  }
  try {
    await db.prepare('UPDATE interviews SET invite_email_sent_at = ?, updated_at = ? WHERE id = ?')
      .bind(input.nowIso, input.nowIso, ctx.interview.id).run();
  } catch { /* 记录发送时间失败不影响结果 */ }
  return { status: 'sent', to: ctx.candidateEmail };
}
