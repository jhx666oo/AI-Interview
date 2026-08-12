import { Hono } from 'hono';
import {
  createResumePushBatch,
  insertResumePushBatchItems,
  loadResumePushBatchByTokenHash,
  markResumesPushed,
  recordBusinessScreeningDecision,
  revokeActiveBusinessScreeningBatchesForResume,
} from './repository';
import { groupEligibleResumesByInterviewer, isEligibleForPush } from './service';
import { createPublicToken, hashPublicToken } from './token';
import type {
  BusinessScreeningResume,
  CreateResumePushBatchItemInput,
  RecordBusinessScreeningDecisionResult,
  ResumePushBatchRow,
} from './types';

export interface BusinessScreeningResumeRecord extends BusinessScreeningResume {
  candidate_name?: string | null;
  email?: string | null;
  contact?: string | null;
  education?: string | null;
  work_experience?: string | null;
  business_screening_remark?: string | null;
  business_screened_at?: string | null;
  business_screened_by?: string | null;
  business_screening_batch_id?: string | null;
  hr_review?: string | null;
  rejected_at?: string | null;
}

export interface BusinessScreeningBatchItemView {
  id: string;
  batch_id: string;
  resume_id: string;
  position_id: string | null;
  status: 'pending' | 'passed' | 'rejected';
  remark: string | null;
  processed_at: string | null;
  created_at: string;
  candidate_name?: string | null;
  mapped_position?: string | null;
  position_applied?: string | null;
  email?: string | null;
  contact?: string | null;
  education?: string | null;
  work_experience?: string | null;
  hr_disposition?: string | null;
  business_screening_status?: string | null;
  business_screening_remark?: string | null;
  business_screened_at?: string | null;
}

export interface BusinessScreeningRouteStore {
  listResumesByIds(db: D1Database, ids: string[]): Promise<BusinessScreeningResumeRecord[]>;
  listPositionsByTitles(db: D1Database, titles: string[]): Promise<Array<{ id: string; title: string; primary_interviewer?: string | null; secondary_interviewer?: string | null }>>;
  listInterviewerDirectory(db: D1Database, names: string[]): Promise<Array<{ name: string; openId?: string | null; userId?: string | null }>>;
  createBatch(
    db: D1Database,
    batch: {
      id: string;
      interviewerId?: string | null;
      interviewerName: string;
      interviewerOpenId: string;
      tokenHash: string;
      expiresAt: string | null;
      createdBy: string;
      createdAt: string;
      lastSentAt?: string | null;
    },
    items: CreateResumePushBatchItemInput[],
  ): Promise<void>;
  markResumesPushed(db: D1Database, resumeIds: string[], batchId: string): Promise<void>;
  loadBatchByTokenHash(db: D1Database, tokenHash: string): Promise<ResumePushBatchRow | null>;
  loadBatchById(db: D1Database, batchId: string): Promise<ResumePushBatchRow | null>;
  listBatchItems(db: D1Database, batchId: string): Promise<BusinessScreeningBatchItemView[]>;
  loadBatchItem(db: D1Database, batchId: string, resumeId: string): Promise<BusinessScreeningBatchItemView | null>;
  recordDecision(
    db: D1Database,
    input: {
      batchItemId: string;
      resumeId: string;
      batchId: string;
      status: 'passed' | 'rejected';
      remark?: string | null;
      screenedAt?: string;
      screenedBy?: string | null;
    },
  ): Promise<RecordBusinessScreeningDecisionResult>;
  revokeActiveBatchesForResume(db: D1Database, resumeId: string): Promise<void>;
  setBatchStatus(db: D1Database, batchId: string, status: 'active' | 'completed' | 'revoked' | 'expired'): Promise<void>;
  setBatchLastSentAt(db: D1Database, batchId: string, sentAt: string): Promise<void>;
  countPendingBatchItems(db: D1Database, batchId: string): Promise<number>;
}

type HrUser = { id?: string; email?: string; role?: string; full_name?: string };

export interface BusinessScreeningRouteDeps {
  authMiddleware: (c: any, next: any) => Promise<Response | void>;
  requireRole: (roles: string[]) => (c: any, next: any) => Promise<Response | void>;
  getCurrentUserToken: (env: any, email: string) => Promise<string | null>;
  sendFeishuMessageToUser: (token: string, openId: string, card: unknown) => Promise<unknown>;
  recordResumeDecisionTimestamp: (db: D1Database, resumeId: string, action: 'approved' | 'rejected' | 'reset', timestamp?: string) => Promise<void>;
  now: () => string;
  uuid: () => string;
  createPublicToken: typeof createPublicToken;
  store: BusinessScreeningRouteStore;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function uniqueStrings(values: unknown[]): string[] {
  return [...new Set(values.map((value) => (typeof value === 'string' ? value.trim() : '')).filter(Boolean))];
}

function plusDays(iso: string, days: number): string {
  const at = new Date(iso);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString();
}

function isBatchAccessible(batch: ResumePushBatchRow, nowIso: string): { ok: true } | { ok: false; status: 410; nextStatus?: 'expired' } {
  if (batch.status === 'revoked' || batch.status === 'expired') {
    return { ok: false, status: 410 };
  }
  if (batch.expires_at && Date.parse(batch.expires_at) <= Date.parse(nowIso)) {
    return { ok: false, status: 410, nextStatus: 'expired' };
  }
  return { ok: true };
}

function sanitizePublicItem(item: BusinessScreeningBatchItemView) {
  return {
    id: item.resume_id,
    candidateName: text(item.candidate_name) || '候选人',
    position: text(item.mapped_position) || text(item.position_applied) || '未分配岗位',
    education: text(item.education) || undefined,
    workExperience: text(item.work_experience) || undefined,
    status: item.status,
    remark: item.remark || undefined,
    processedAt: item.processed_at || undefined,
  };
}

function buildFeishuCard(input: {
  interviewerName: string;
  itemCount: number;
  url: string;
}): Record<string, unknown> {
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: `业务筛选待处理：${input.interviewerName}` },
      template: 'blue',
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `你有 ${input.itemCount} 份候选人待处理，请通过专属链接完成业务筛选。`,
        },
      },
      {
        tag: 'action',
        actions: [
          {
            tag: 'button',
            type: 'primary',
            text: { tag: 'plain_text', content: '打开筛选链接' },
            url: input.url,
          },
        ],
      },
    ],
  };
}

function summarizeSkipReason(
  resume: BusinessScreeningResumeRecord,
  position: { id: string; title: string; primary_interviewer?: string | null; secondary_interviewer?: string | null } | undefined,
  interviewerDirectory: Map<string, { name: string; openId?: string | null; userId?: string | null }>,
): string {
  if (!position) return '缺少标准岗位';
  const interviewerNames = uniqueStrings([position.primary_interviewer, position.secondary_interviewer]);
  if (interviewerNames.length === 0) return '岗位未配置有效面试官';
  for (const interviewerName of interviewerNames) {
    const interviewer = interviewerDirectory.get(interviewerName) || { name: interviewerName };
    const eligibility = isEligibleForPush(resume, interviewer);
    if (!eligibility.ok) return eligibility.reason;
  }
  return '岗位未配置有效面试官';
}

export function createBusinessScreeningRoutes(deps: BusinessScreeningRouteDeps) {
  const app = new Hono<{ Bindings: any }>();

  app.post('/api/resumes/business-screening/push', deps.authMiddleware, deps.requireRole(['admin', 'hr']), async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const ids = uniqueStrings(Array.isArray(body?.ids) ? body.ids : []);
    if (ids.length === 0) {
      return c.json({ detail: 'ids must contain at least one resume id' }, 400);
    }

    const db = c.env.DB as D1Database;
    const nowIso = deps.now();
    const user = (c.get('user') || {}) as HrUser;
    const resumes = await deps.store.listResumesByIds(db, ids);
    const resumesById = new Map(resumes.map((resume) => [resume.id, resume]));
    const positionTitles = uniqueStrings(resumes.map((resume) => text(resume.mapped_position) || text(resume.position_applied)));
    const positions = await deps.store.listPositionsByTitles(db, positionTitles);
    const positionsByTitle = new Map(positions.map((position) => [position.title, position]));
    const interviewerNames = uniqueStrings(positions.flatMap((position) => [position.primary_interviewer, position.secondary_interviewer]));
    const interviewerDirectoryRows = await deps.store.listInterviewerDirectory(db, interviewerNames);
    const interviewerDirectory = new Map(interviewerDirectoryRows.map((entry) => [entry.name, entry]));

    const skipped: Array<{ id: string; reason: string }> = [];
    const eligibleResumes: BusinessScreeningResumeRecord[] = [];
    for (const id of ids) {
      const resume = resumesById.get(id);
      if (!resume) {
        skipped.push({ id, reason: '简历不存在' });
        continue;
      }
      const positionTitle = text(resume.mapped_position) || text(resume.position_applied);
      const position = positionsByTitle.get(positionTitle);
      const reason = summarizeSkipReason(resume, position, interviewerDirectory);
      if (reason !== '岗位未配置有效面试官' || groupEligibleResumesByInterviewer([resume], positions, interviewerDirectoryRows).size === 0) {
        const groups = groupEligibleResumesByInterviewer([resume], positions, interviewerDirectoryRows);
        if (groups.size === 0) {
          skipped.push({ id, reason });
          continue;
        }
      }
      eligibleResumes.push(resume);
    }

    const grouped = groupEligibleResumesByInterviewer(eligibleResumes, positions, interviewerDirectoryRows);
    const currentUserToken = user.email ? await deps.getCurrentUserToken(c.env, user.email) : null;
    const pushedResumeIds = uniqueStrings([...grouped.values()].flatMap((group) => group.resumes.map((resume) => resume.id)));
    const failed: Array<{ interviewer: string; reason: string }> = [];
    const batches: Array<{ batchId: string; interviewer: string; url: string; itemCount: number }> = [];

    for (const group of grouped.values()) {
      const issued = await deps.createPublicToken();
      const batchId = deps.uuid();
      const url = `${new URL(c.req.url).origin}/api/public/business-screening/${issued.token}`;
      const itemCreatedAt = deps.now();
      const items: CreateResumePushBatchItemInput[] = group.resumes.map((resume) => ({
        id: deps.uuid(),
        batchId,
        resumeId: resume.id,
        positionId: resume.position_id || positionsByTitle.get(text(resume.mapped_position) || text(resume.position_applied))?.id || null,
        createdAt: itemCreatedAt,
      }));

      await deps.store.createBatch(db, {
        id: batchId,
        interviewerId: group.interviewer.userId || null,
        interviewerName: group.interviewer.name,
        interviewerOpenId: group.interviewer.openId,
        tokenHash: issued.tokenHash,
        expiresAt: plusDays(nowIso, 7),
        createdBy: user.email || 'system',
        createdAt: nowIso,
        lastSentAt: null,
      }, items);
      await deps.store.markResumesPushed(db, group.resumes.map((resume) => resume.id), batchId);

      batches.push({
        batchId,
        interviewer: group.interviewer.name,
        url,
        itemCount: items.length,
      });

      if (!currentUserToken) {
        failed.push({
          interviewer: group.interviewer.name,
          reason: '当前账号未授权飞书身份，无法发送业务筛选链接',
        });
        continue;
      }

      try {
        await deps.sendFeishuMessageToUser(currentUserToken, group.interviewer.openId, buildFeishuCard({
          interviewerName: group.interviewer.name,
          itemCount: items.length,
          url,
        }));
        await deps.store.setBatchLastSentAt(db, batchId, deps.now());
      } catch (error) {
        failed.push({
          interviewer: group.interviewer.name,
          reason: error instanceof Error ? error.message : '业务筛选链接发送失败',
        });
      }
    }

    return c.json({
      ok: failed.length === 0,
      pushed: pushedResumeIds,
      skipped,
      failed,
      batches,
    });
  });

  app.post('/api/resumes/:id/business-screening/reject', deps.authMiddleware, deps.requireRole(['admin', 'hr']), async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const db = c.env.DB as D1Database;
    const resumes = await deps.store.listResumesByIds(db, [id]);
    const resume = resumes[0];
    if (!resume) return c.json({ detail: 'Candidate not found' }, 404);
    if (resume.business_screening_status === 'passed' || resume.business_screening_status === 'rejected') {
      return c.json({ detail: 'business screening already completed' }, 409);
    }

    const decisionAt = deps.now();
    const comment = text(body?.comment) || text(body?.hr_comment) || '业务筛选前 HR 淘汰';
    await db.prepare(
      `UPDATE resumes
          SET hr_disposition = 'rejected',
              hr_review = ?,
              business_screening_status = CASE
                WHEN business_screening_status IN ('passed', 'rejected') THEN business_screening_status
                ELSE 'rejected'
              END,
              business_screening_remark = CASE
                WHEN business_screening_status IN ('passed', 'rejected') THEN business_screening_remark
                ELSE ?
              END,
              business_screened_at = CASE
                WHEN business_screening_status IN ('passed', 'rejected') THEN business_screened_at
                ELSE ?
              END,
              business_screened_by = CASE
                WHEN business_screening_status IN ('passed', 'rejected') THEN business_screened_by
                ELSE ?
              END,
              status = 'rejected',
              stage = 'rejected',
              updated_at = ?
        WHERE id = ?`,
    ).bind(comment, comment, decisionAt, 'HR', decisionAt, id).run();
    await deps.store.revokeActiveBatchesForResume(db, id);
    await deps.recordResumeDecisionTimestamp(db, id, 'rejected', decisionAt);
    const updated = (await deps.store.listResumesByIds(db, [id]))[0];
    return c.json({
      id,
      hr_disposition: updated?.hr_disposition || 'rejected',
      status: updated?.status || 'rejected',
      stage: updated?.status === 'rejected' ? 'rejected' : undefined,
      business_screening_status: updated?.business_screening_status || 'not_ready',
    });
  });

  app.get('/api/public/business-screening/:token', async (c) => {
    const tokenHash = await hashPublicToken(c.req.param('token'));
    const db = c.env.DB as D1Database;
    const batch = await deps.store.loadBatchByTokenHash(db, tokenHash);
    if (!batch) return c.json({ detail: 'Not found' }, 404);

    const access = isBatchAccessible(batch, deps.now());
    if (!access.ok) {
      if (access.nextStatus) await deps.store.setBatchStatus(db, batch.id, access.nextStatus);
      return c.json({ detail: 'Link unavailable' }, access.status);
    }

    const items = await deps.store.listBatchItems(db, batch.id);
    return c.json({
      batch: {
        id: batch.id,
        interviewer: batch.interviewer_name,
        status: batch.status,
        expiresAt: batch.expires_at,
        lastSentAt: batch.last_sent_at,
      },
      resumes: items.map(sanitizePublicItem),
    });
  });

  async function handlePublicDecision(
    c: any,
    status: 'passed' | 'rejected',
  ) {
    const tokenHash = await hashPublicToken(c.req.param('token'));
    const resumeId = c.req.param('resumeId');
    const body = await c.req.json().catch(() => ({}));
    const db = c.env.DB as D1Database;
    const batch = await deps.store.loadBatchByTokenHash(db, tokenHash);
    if (!batch) return c.json({ detail: 'Not found' }, 404);

    const access = isBatchAccessible(batch, deps.now());
    if (!access.ok) {
      if (access.nextStatus) await deps.store.setBatchStatus(db, batch.id, access.nextStatus);
      return c.json({ detail: 'Link unavailable' }, access.status);
    }

    const item = await deps.store.loadBatchItem(db, batch.id, resumeId);
    if (!item) return c.json({ detail: 'Not found' }, 404);

    const result = await deps.store.recordDecision(db, {
      batchItemId: item.id,
      resumeId,
      batchId: batch.id,
      status,
      remark: text(body?.remark) || null,
      screenedAt: deps.now(),
      screenedBy: batch.interviewer_name,
    });

    if (!result.applied && !result.idempotent && result.reason) {
      return c.json({ detail: result.reason }, 409);
    }

    const pendingCount = await deps.store.countPendingBatchItems(db, batch.id);
    if (pendingCount === 0) {
      await deps.store.setBatchStatus(db, batch.id, 'completed');
    }

    return c.json({
      ok: true,
      status: result.status,
      idempotent: result.idempotent,
    });
  }

  app.post('/api/public/business-screening/:token/resumes/:resumeId/approve', async (c) => (
    handlePublicDecision(c, 'passed')
  ));
  app.post('/api/public/business-screening/:token/resumes/:resumeId/reject', async (c) => (
    handlePublicDecision(c, 'rejected')
  ));

  app.post('/api/resumes/business-screening/batches/:batchId/resend', deps.authMiddleware, deps.requireRole(['admin', 'hr']), async (c) => {
    const batchId = c.req.param('batchId');
    const db = c.env.DB as D1Database;
    const user = (c.get('user') || {}) as HrUser;
    const batch = await deps.store.loadBatchById(db, batchId);
    if (!batch) return c.json({ detail: 'Batch not found' }, 404);

    const items = await deps.store.listBatchItems(db, batchId);
    const pendingItems = items.filter((item) => item.status === 'pending');
    if (pendingItems.length === 0) {
      return c.json({ detail: 'No pending resumes to resend' }, 409);
    }

    const currentUserToken = user.email ? await deps.getCurrentUserToken(c.env, user.email) : null;
    const issued = await deps.createPublicToken();
    const nextBatchId = deps.uuid();
    const nowIso = deps.now();
    const url = `${new URL(c.req.url).origin}/api/public/business-screening/${issued.token}`;
    const nextItems = pendingItems.map((item) => ({
      id: deps.uuid(),
      batchId: nextBatchId,
      resumeId: item.resume_id,
      positionId: item.position_id,
      createdAt: nowIso,
    }));

    await deps.store.createBatch(db, {
      id: nextBatchId,
      interviewerId: batch.interviewer_id,
      interviewerName: batch.interviewer_name,
      interviewerOpenId: batch.interviewer_open_id,
      tokenHash: issued.tokenHash,
      expiresAt: plusDays(nowIso, 7),
      createdBy: user.email || 'system',
      createdAt: nowIso,
      lastSentAt: null,
    }, nextItems);
    await deps.store.setBatchStatus(db, batchId, 'revoked');

    if (!currentUserToken) {
      return c.json({
        ok: false,
        resentFromBatchId: batchId,
        batchId: nextBatchId,
        itemCount: nextItems.length,
        url,
        detail: '当前账号未授权飞书身份，无法发送业务筛选链接',
      }, 400);
    }

    try {
      await deps.sendFeishuMessageToUser(currentUserToken, batch.interviewer_open_id, buildFeishuCard({
        interviewerName: batch.interviewer_name,
        itemCount: nextItems.length,
        url,
      }));
      await deps.store.setBatchLastSentAt(db, nextBatchId, deps.now());
    } catch (error) {
      return c.json({
        ok: false,
        resentFromBatchId: batchId,
        batchId: nextBatchId,
        itemCount: nextItems.length,
        url,
        detail: error instanceof Error ? error.message : '业务筛选链接发送失败',
      }, 500);
    }

    return c.json({
      ok: true,
      resentFromBatchId: batchId,
      batchId: nextBatchId,
      itemCount: nextItems.length,
      url,
    });
  });

  return app;
}

async function queryAll<T>(db: D1Database, sql: string, values: unknown[]): Promise<T[]> {
  const result = await db.prepare(sql).bind(...values).all<T>();
  return result.results;
}

function placeholders(count: number): string {
  return new Array(count).fill('?').join(', ');
}

export function createD1BusinessScreeningRouteStore(resolveExactInterviewerOpenId: (db: D1Database, name: string) => Promise<string | null>): BusinessScreeningRouteStore {
  return {
    async listResumesByIds(db, ids) {
      if (ids.length === 0) return [];
      return queryAll<BusinessScreeningResumeRecord>(
        db,
        `SELECT id, candidate_name, email, contact, screening_result, status, hr_disposition,
                mapped_position, position_applied, position_id, business_screening_status,
                business_screening_remark, business_screened_at, business_screened_by,
                business_screening_batch_id, education, work_experience, hr_review, rejected_at
           FROM resumes
          WHERE id IN (${placeholders(ids.length)})`,
        ids,
      );
    },
    async listPositionsByTitles(db, titles) {
      if (titles.length === 0) return [];
      return queryAll(db,
        `SELECT id, title, primary_interviewer, secondary_interviewer
           FROM positions
          WHERE title IN (${placeholders(titles.length)})`,
        titles,
      ) as Promise<Array<{ id: string; title: string; primary_interviewer?: string | null; secondary_interviewer?: string | null }>>;
    },
    async listInterviewerDirectory(db, names) {
      const result: Array<{ name: string; openId?: string | null; userId?: string | null }> = [];
      for (const name of names) {
        const openId = await resolveExactInterviewerOpenId(db, name);
        const user = await db.prepare(
          `SELECT id
             FROM users
            WHERE full_name = ?
            LIMIT 1`,
        ).bind(name).first<{ id: string }>();
        result.push({
          name,
          openId,
          userId: user?.id || null,
        });
      }
      return result;
    },
    async createBatch(db, batch, items) {
      await createResumePushBatch(db, {
        id: batch.id,
        interviewerId: batch.interviewerId || null,
        interviewerName: batch.interviewerName,
        interviewerOpenId: batch.interviewerOpenId,
        tokenHash: batch.tokenHash,
        expiresAt: batch.expiresAt,
        createdBy: batch.createdBy,
        createdAt: batch.createdAt,
        lastSentAt: batch.lastSentAt || null,
      });
      await insertResumePushBatchItems(db, items);
    },
    async markResumesPushed(db, resumeIds, batchId) {
      await markResumesPushed(db, resumeIds, batchId);
    },
    async loadBatchByTokenHash(db, tokenHash) {
      return loadResumePushBatchByTokenHash(db, tokenHash);
    },
    async loadBatchById(db, batchId) {
      return await db.prepare(
        `SELECT id, interviewer_id, interviewer_name, interviewer_open_id, token_hash, expires_at, status, created_by, created_at, last_sent_at
           FROM resume_push_batches
          WHERE id = ?
          LIMIT 1`,
      ).bind(batchId).first<ResumePushBatchRow>();
    },
    async listBatchItems(db, batchId) {
      return queryAll<BusinessScreeningBatchItemView>(
        db,
        `SELECT i.id, i.batch_id, i.resume_id, i.position_id, i.status, i.remark, i.processed_at, i.created_at,
                r.candidate_name, r.mapped_position, r.position_applied, r.email, r.contact, r.education, r.work_experience,
                r.hr_disposition, r.business_screening_status, r.business_screening_remark, r.business_screened_at
           FROM resume_push_batch_items i
           JOIN resumes r ON r.id = i.resume_id
          WHERE i.batch_id = ?
          ORDER BY i.created_at ASC`,
        [batchId],
      );
    },
    async loadBatchItem(db, batchId, resumeId) {
      return await db.prepare(
        `SELECT i.id, i.batch_id, i.resume_id, i.position_id, i.status, i.remark, i.processed_at, i.created_at,
                r.candidate_name, r.mapped_position, r.position_applied, r.email, r.contact, r.education, r.work_experience,
                r.hr_disposition, r.business_screening_status, r.business_screening_remark, r.business_screened_at
           FROM resume_push_batch_items i
           JOIN resumes r ON r.id = i.resume_id
          WHERE i.batch_id = ? AND i.resume_id = ?
          LIMIT 1`,
      ).bind(batchId, resumeId).first<BusinessScreeningBatchItemView>();
    },
    async recordDecision(db, input) {
      return recordBusinessScreeningDecision(db, input);
    },
    async revokeActiveBatchesForResume(db, resumeId) {
      await revokeActiveBusinessScreeningBatchesForResume(db, resumeId);
    },
    async setBatchStatus(db, batchId, status) {
      await db.prepare('UPDATE resume_push_batches SET status = ? WHERE id = ?')
        .bind(status, batchId)
        .run();
    },
    async setBatchLastSentAt(db, batchId, sentAt) {
      await db.prepare('UPDATE resume_push_batches SET last_sent_at = ? WHERE id = ?')
        .bind(sentAt, batchId)
        .run();
    },
    async countPendingBatchItems(db, batchId) {
      const row = await db.prepare(
        `SELECT COUNT(*) as count
           FROM resume_push_batch_items
          WHERE batch_id = ? AND status = 'pending'`,
      ).bind(batchId).first<{ count: number }>();
      return Number(row?.count || 0);
    },
  };
}
