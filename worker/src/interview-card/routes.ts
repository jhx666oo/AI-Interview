import { Hono } from 'hono';
import { buildInterviewCardView, type InterviewCardLinkStatus } from './view-model';

type Row = Record<string, any>;

export interface InterviewCardRouteDeps {
  hashToken?: (token: string) => Promise<string>;
  readFile?: (env: any, resumeId: string) => Promise<{ bytes: Uint8Array | null; fileName: string }>;
}

export interface EnsureInterviewCardInput {
  interviewId: string;
  resumeId?: string | null;
  createdBy?: string | null;
  expiresInDays?: number;
  tokenFactory?: () => string;
}

function parseTime(value: unknown): number {
  const time = new Date(String(value || '')).getTime();
  return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
}

async function sha256Token(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Create one stable, expiring read-only link for an interview reminder. */
export async function ensureInterviewCard(db: any, input: EnsureInterviewCardInput): Promise<{ token: string; expiresAt: string }> {
  const interviewId = String(input.interviewId || '').trim();
  if (!interviewId) throw new Error('interviewId is required');
  const now = new Date();
  const nowIso = now.toISOString();
  const days = Math.min(Math.max(Number(input.expiresInDays || 7), 1), 90);
  const expiresAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
  const token = input.tokenFactory?.() || `ic-${crypto.randomUUID()}`;
  const tokenHash = await sha256Token(token);
  await db.prepare(
    `INSERT INTO interview_cards
      (id, token_hash, interview_id, resume_id, status, expires_at, created_by, created_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`
  ).bind(
    crypto.randomUUID(), tokenHash, interviewId, input.resumeId || null,
    expiresAt, input.createdBy || null, nowIso,
  ).run();
  return { token, expiresAt };
}

async function defaultReadFile(env: any, resumeId: string): Promise<{ bytes: Uint8Array | null; fileName: string }> {
  const row = await env.DB.prepare('SELECT content, kv_key, file_name FROM resume_files WHERE id = ?').bind(resumeId).first() as Row | null;
  const fileName = String(row?.file_name || 'resume.pdf');
  if (row?.content) {
    const binary = atob(String(row.content));
    return { bytes: Uint8Array.from(binary, (char) => char.charCodeAt(0)), fileName };
  }
  if (env.RESUMES_KV) {
    const value = await env.RESUMES_KV.get(String(row?.kv_key || `kv_${resumeId}`), 'arrayBuffer');
    if (value) return { bytes: new Uint8Array(value), fileName };
  }
  return { bytes: null, fileName };
}

function activeCard(card: Row | null): boolean {
  if (!card || String(card.status || 'active') !== 'active') return false;
  if (card.expires_at && parseTime(card.expires_at) <= Date.now()) return false;
  return true;
}

function publicCardUrlToken(card: Row, rawToken: string): Row {
  // Keep the bearer token in memory only; never persist or expose it from D1.
  return { ...card, public_token: rawToken };
}

async function loadCardContext(env: any, rawToken: string, deps: InterviewCardRouteDeps) {
  const db = env.DB;
  const tokenHash = await (deps.hashToken || sha256Token)(rawToken);
  const card = await db.prepare(
    'SELECT id, token_hash, interview_id, resume_id, status, expires_at, created_at FROM interview_cards WHERE token_hash = ? LIMIT 1',
  ).bind(tokenHash).first() as Row | null;
  if (!card) return { kind: 'missing' as const };
  if (!activeCard(card)) return { kind: 'expired' as const };
  const interview = card.interview_id
    ? await db.prepare('SELECT * FROM interviews WHERE id = ?').bind(card.interview_id).first() as Row | null
    : null;
  let resume: Row | null = null;
  let resumeLinkStatus: InterviewCardLinkStatus = 'missing';
  const explicitResumeId = String(card.resume_id || interview?.resume_id || '').trim();
  if (explicitResumeId) {
    resume = await db.prepare('SELECT * FROM resumes WHERE id = ?').bind(explicitResumeId).first() as Row | null;
    resumeLinkStatus = resume ? 'linked' : 'missing';
  } else if (interview?.candidate_name) {
    const candidates = await db.prepare(
      'SELECT * FROM resumes WHERE candidate_name = ? AND (position_id = ? OR mapped_position = ? OR position_applied = ?) ORDER BY updated_at DESC',
    ).bind(interview.candidate_name, interview.position_id || '', interview.position_applied || '', interview.position_applied || '').all();
    if (candidates.results?.length === 1) {
      resume = candidates.results[0] as Row;
      resumeLinkStatus = 'linked';
    } else if ((candidates.results?.length || 0) > 1) {
      resumeLinkStatus = 'ambiguous';
    }
  }
  const interviews = resume?.id
    ? ((await db.prepare('SELECT * FROM interviews WHERE resume_id = ? ORDER BY round ASC, interview_time ASC, created_at ASC').bind(resume.id).all()).results || []) as Row[]
    : interview ? [interview] : [];
  const timeline = resume?.id
    ? ((await db.prepare('SELECT * FROM candidate_stage_events WHERE resume_id = ? ORDER BY occurred_at ASC').bind(resume.id).all()).results || []) as Row[]
    : [];
  const file = resume?.id ? await (deps.readFile || defaultReadFile)(env, resume.id).catch(() => ({ bytes: null, fileName: 'resume.pdf' })) : { bytes: null, fileName: 'resume.pdf' };
  return { kind: 'ok' as const, card: publicCardUrlToken(card, rawToken), interview, resume, resumeLinkStatus, interviews, timeline, fileAvailable: Boolean(file.bytes) };
}

export function createInterviewCardRoutes(deps: InterviewCardRouteDeps = {}) {
  const app = new Hono<{ Bindings: any }>();

  app.get('/api/public/interview-card/:token', async (c) => {
    try {
      const context = await loadCardContext(c.env, c.req.param('token'), deps);
      if (context.kind === 'missing') return c.json({ detail: '链接无效或不存在' }, 404);
      if (context.kind === 'expired') return c.json({ detail: '链接已失效，请联系 HR 重新生成' }, 410);
      const body = buildInterviewCardView(context);
      return c.json(body, 200, { 'Cache-Control': 'no-store' });
    } catch (error) {
      console.error('[interview-card] load failed', error);
      return c.json({ detail: '加载面试详情失败' }, 500);
    }
  });

  app.get('/api/public/interview-card/:token/file', async (c) => {
    try {
      const context = await loadCardContext(c.env, c.req.param('token'), deps);
      if (context.kind === 'missing') return c.json({ detail: '链接无效或不存在' }, 404);
      if (context.kind === 'expired') return c.json({ detail: '链接已失效，请联系 HR 重新生成' }, 410);
      if (!context.resume?.id) return c.json({ detail: '该候选人未关联简历文件' }, 404);
      const file = await (deps.readFile || defaultReadFile)(c.env, context.resume.id);
      if (!file.bytes) return c.json({ detail: '该候选人未关联简历文件' }, 404);
      const disposition = c.req.query('preview') === '1' ? 'inline' : 'attachment';
      return new Response(file.bytes, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `${disposition}; filename="${encodeURIComponent(file.fileName || 'resume.pdf')}"`,
          'Cache-Control': 'no-store',
        },
      });
    } catch (error) {
      console.error('[interview-card] file load failed', error);
      return c.json({ detail: '简历文件读取失败' }, 500);
    }
  });

  return app;
}

export { sha256Token };
