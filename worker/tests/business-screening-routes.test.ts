import { describe, expect, it } from 'vitest';
import type {
  BusinessScreeningBatchItemView,
  BusinessScreeningResumeRecord,
  BusinessScreeningRouteStore,
  BusinessScreeningRouteDeps,
} from '../src/business-screening/routes';
import { createBusinessScreeningRoutes } from '../src/business-screening/routes';
import { hashPublicToken } from '../src/business-screening/token';

type BatchRow = {
  id: string;
  interviewer_id: string | null;
  interviewer_name: string;
  interviewer_open_id: string;
  token_hash: string;
  expires_at: string | null;
  status: 'active' | 'completed' | 'revoked' | 'expired';
  created_by: string;
  created_at: string;
  last_sent_at: string | null;
  dispatch_group_id?: string | null;
  batch_title?: string | null;
  batch_subtitle?: string | null;
  scope_key?: string | null;
  rawToken?: string;
};

function buildHarness(options?: {
  resumes?: BusinessScreeningResumeRecord[];
  positions?: Array<{ id: string; title: string; primary_interviewer?: string; secondary_interviewer?: string; responsible_person?: string }>;
  positionMappings?: Array<{ raw_name: string; mapped_name: string }>;
  interviewerDirectory?: Array<{ name: string; openId?: string | null; userId?: string | null }>;
  sendFailuresByOpenId?: Record<string, string>;
  initialBatches?: BatchRow[];
  initialItems?: BusinessScreeningBatchItemView[];
  apiKeyOwnerEmail?: string | null;
}) {
  const resumes = new Map(
    (options?.resumes || [
      {
        id: 'resume-1',
        candidate_name: '候选人甲',
        email: 'jia@example.com',
        contact: '13800000000',
        screening_result: '通过',
        status: 'pending_review',
        stage: 'screening',
        hr_disposition: 'pending',
        mapped_position: '标准运营',
        position_applied: '标准运营',
        business_screening_status: 'not_ready',
        business_screening_batch_id: '',
        business_screening_dispatch_group_id: '',
        education: '本科',
        work_experience: '5年',
        ocr_markdown: '# 候选人甲\n临床护理工作 5 年，持有护士资格证。',
        match_score: 88,
        ai_review: '{"summary":"临床经验丰富","recommendation":"recommend"}',
      },
    ]).map((resume) => [resume.id, { ...resume }]),
  );
  const positions = (options?.positions || [
    { id: 'position-1', title: '标准运营', primary_interviewer: '张三', secondary_interviewer: '李四', responsible_person: '张三' },
  ]).map((position) => ({ ...position }));
  const positionMappings = (options?.positionMappings || []).map((mapping) => ({ ...mapping }));
  const interviewerDirectory = new Map(
    (options?.interviewerDirectory || [
      { name: '张三', openId: 'ou_zhang', userId: 'user-zhang' },
      { name: '李四', openId: 'ou_li', userId: 'user-li' },
    ]).map((entry) => [entry.name, { ...entry }]),
  );
  const batches = new Map((options?.initialBatches || []).map((batch) => [batch.id, { ...batch }]));
  const batchItems = (options?.initialItems || []).map((item) => ({ ...item }));
  const sentMessages: Array<{ token: string; openId: string; card: unknown }> = [];
  const createdTokens: Array<{ token: string; tokenHash: string }> = [];
  const scopeTokens = new Map<string, { token: string; tokenHash: string }>();
  let tokenCounter = 0;

  const store: BusinessScreeningRouteStore = {
    async listResumesByIds(_db, ids) {
      return ids.map((id) => resumes.get(id)).filter(Boolean) as BusinessScreeningResumeRecord[];
    },
    async listPositionsByTitles(_db, titles) {
      const allowed = new Set(titles);
      return positions.filter((position) => allowed.has(position.title));
    },
    async listPositionMappings(_db, rawNames) {
      const allowed = new Set(rawNames);
      return positionMappings.filter((mapping) => allowed.has(mapping.raw_name));
    },
    async listInterviewerDirectory(_db, names) {
      return names
        .map((name) => interviewerDirectory.get(name))
        .filter(Boolean) as Array<{ name: string; openId?: string | null; userId?: string | null }>;
    },
    async findSameNameProfiles(_db, names, excludeResumeId) {
      const allowed = new Set(names);
      const rows = [...resumes.values()]
        .filter((resume) => allowed.has(resume.candidate_name))
        .filter((resume) => resume.id !== excludeResumeId)
        .map((resume) => ({
          id: resume.id,
          candidate_name: resume.candidate_name || null,
          screening_result: resume.screening_result || null,
          mapped_position: resume.mapped_position || null,
          position_applied: resume.position_applied || null,
          parsed_data: resume.parsed_data || null,
          education: resume.education || null,
          work_experience: resume.work_experience || null,
          gender: resume.gender || null,
          birthday: resume.birthday || null,
          certifications: resume.certifications || null,
          self_evaluation: resume.self_evaluation || null,
        }));
      return rows;
    },
    async createBatch(_db, batch, items) {
      batches.set(batch.id, {
        id: batch.id,
        interviewer_id: batch.interviewerId || null,
        interviewer_name: batch.interviewerName,
        interviewer_open_id: batch.interviewerOpenId,
        token_hash: batch.tokenHash,
        expires_at: batch.expiresAt,
        status: 'active',
        created_by: batch.createdBy,
        created_at: batch.createdAt,
        last_sent_at: batch.lastSentAt || null,
        dispatch_group_id: batch.dispatchGroupId,
        batch_title: batch.batchTitle || null,
        batch_subtitle: batch.batchSubtitle || null,
        scope_key: batch.scopeKey || null,
      });
      for (const item of items) {
        const resume = resumes.get(item.resumeId);
        batchItems.push({
          id: item.id,
          batch_id: item.batchId,
          resume_id: item.resumeId,
          position_id: item.positionId || null,
          status: item.status || 'pending',
          remark: item.remark || null,
          processed_at: item.processedAt || null,
          created_at: item.createdAt || '2026-08-12T12:00:00.000Z',
          dispatch_group_id: item.dispatchGroupId,
          candidate_name: resume?.candidate_name || null,
          mapped_position: resume?.mapped_position || null,
          position_applied: resume?.position_applied || null,
          email: resume?.email || null,
          contact: resume?.contact || null,
          education: resume?.education || null,
          work_experience: resume?.work_experience || null,
          hr_disposition: resume?.hr_disposition || null,
          business_screening_status: resume?.business_screening_status || null,
          business_screening_remark: resume?.business_screening_remark || null,
          business_screened_at: resume?.business_screened_at || null,
          ocr_markdown: resume?.ocr_markdown || null,
          raw_text: resume?.raw_text || null,
          resume_markdown: resume?.resume_markdown || null,
          ai_review: resume?.ai_review || null,
          ai_evaluation: resume?.ai_evaluation || null,
          match_score: resume?.match_score ?? null,
          capability_scores: resume?.capability_scores || null,
          hard_requirement_result: resume?.hard_requirement_result || null,
          screening_result: resume?.screening_result || null,
          parsed_data: resume?.parsed_data || null,
          gender: resume?.gender || null,
          birthday: resume?.birthday || null,
          certifications: resume?.certifications || null,
          self_evaluation: resume?.self_evaluation || null,
        });
      }
    },
    async markResumesPushed(_db, resumeIds, batchId, dispatchGroupId) {
      for (const id of resumeIds) {
        const resume = resumes.get(id);
        if (!resume) continue;
        resume.hr_disposition = 'pushed';
        resume.business_screening_status = 'pending';
        resume.business_screening_batch_id = batchId;
        resume.business_screening_dispatch_group_id = dispatchGroupId;
      }
    },
    async loadBatchByTokenHash(_db, tokenHash) {
      for (const batch of batches.values()) {
        if (batch.token_hash === tokenHash) return batch;
        if (batch.rawToken && await hashPublicToken(batch.rawToken) === tokenHash) return batch;
      }
      return null;
    },
    async loadBatchById(_db, batchId) {
      return batches.get(batchId) || null;
    },
    async loadBatchByScope(_db, scopeKey, nowIso) {
      for (const batch of batches.values()) {
        if (
          batch.scope_key === scopeKey
          && (batch.status === 'active' || batch.status === 'completed')
          && (batch.expires_at === null || batch.expires_at === undefined || batch.expires_at > nowIso)
        ) return { ...batch };
      }
      return null;
    },
    async loadBatchByInterviewer(_db, interviewerOpenId, nowIso) {
      for (const batch of batches.values()) {
        if (
          batch.interviewer_open_id === interviewerOpenId
          && Boolean(batch.scope_key)
          && (batch.status === 'active' || batch.status === 'completed')
          && (batch.expires_at === null || batch.expires_at === undefined || batch.expires_at > nowIso)
        ) return { ...batch };
      }
      return null;
    },
    async loadLatestBatchByInterviewer(_db, interviewerOpenId) {
      return [...batches.values()]
        .filter((batch) => batch.interviewer_open_id === interviewerOpenId)
        .filter((batch) => Boolean(batch.scope_key))
        .filter((batch) => batch.status !== 'revoked')
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map((batch) => ({ ...batch }))[0] || null;
    },
    async listActiveBatchesByInterviewer(_db, interviewerName, nowIso) {
      const result: BatchRow[] = [];
      for (const batch of batches.values()) {
        if (
          batch.interviewer_name === interviewerName
          && (batch.status === 'active' || batch.status === 'completed')
          && (batch.expires_at === null || batch.expires_at === undefined || batch.expires_at > nowIso)
        ) result.push({ ...batch });
      }
      return result;
    },
    async resetBatchActive(_db, batchId) {
      const batch = batches.get(batchId);
      if (batch) batch.status = 'active';
    },
    async refreshBatchExpiry(_db, batchId, expiresAt) {
      const batch = batches.get(batchId);
      if (batch) batch.expires_at = expiresAt;
    },
    async updateBatchPresentation(_db, batchId, presentation) {
      const batch = batches.get(batchId);
      if (!batch) return;
      if (presentation.title !== undefined && presentation.title !== null) batch.batch_title = presentation.title;
      if (presentation.subtitle !== undefined && presentation.subtitle !== null) batch.batch_subtitle = presentation.subtitle;
    },
    async appendBatchItemsIfAbsent(_db, items) {
      for (const item of items) {
        const dup = batchItems.find((candidate) => candidate.batch_id === item.batchId && candidate.resume_id === item.resumeId);
        if (dup) continue;
        const resume = resumes.get(item.resumeId);
        batchItems.push({
          id: item.id,
          batch_id: item.batchId,
          resume_id: item.resumeId,
          position_id: item.positionId || null,
          status: item.status || 'pending',
          remark: item.remark || null,
          processed_at: item.processedAt || null,
          created_at: item.createdAt || '2026-08-12T12:00:00.000Z',
          dispatch_group_id: item.dispatchGroupId,
          candidate_name: resume?.candidate_name || null,
          mapped_position: resume?.mapped_position || null,
          position_applied: resume?.position_applied || null,
          email: resume?.email || null,
          contact: resume?.contact || null,
          education: resume?.education || null,
          work_experience: resume?.work_experience || null,
          hr_disposition: resume?.hr_disposition || null,
          business_screening_status: resume?.business_screening_status || null,
          business_screening_remark: resume?.business_screening_remark || null,
          business_screened_at: resume?.business_screened_at || null,
          ocr_markdown: resume?.ocr_markdown || null,
          raw_text: resume?.raw_text || null,
          resume_markdown: resume?.resume_markdown || null,
          ai_review: resume?.ai_review || null,
          ai_evaluation: resume?.ai_evaluation || null,
          match_score: resume?.match_score ?? null,
          capability_scores: resume?.capability_scores || null,
          hard_requirement_result: resume?.hard_requirement_result || null,
          screening_result: resume?.screening_result || null,
          parsed_data: resume?.parsed_data || null,
          gender: resume?.gender || null,
          birthday: resume?.birthday || null,
          certifications: resume?.certifications || null,
          self_evaluation: resume?.self_evaluation || null,
        });
      }
    },
    async listBatchItems(_db, batchId) {
      return batchItems.filter((item) => item.batch_id === batchId).map((item) => ({ ...item }));
    },
    async loadBatchItem(_db, batchId, resumeId) {
      const item = batchItems.find((candidate) => candidate.batch_id === batchId && candidate.resume_id === resumeId);
      return item ? { ...item } : null;
    },
    async recordDecision(_db, input) {
      const item = batchItems.find((candidate) => candidate.id === input.batchItemId && candidate.batch_id === input.batchId && candidate.resume_id === input.resumeId);
      if (!item) throw new Error('business screening batch item not found');
      const resume = resumes.get(input.resumeId);
      const nextItemStatus = input.status === 'passed' ? 'passed' : 'rejected';
      const nextResumeStatus = input.status === 'passed' ? 'approved' : 'rejected';
      const nextResumeStage = input.status === 'passed' ? 'talent_pool' : 'rejected';
      const itemDispatchGroupId = item.dispatch_group_id || item.batch_id;
      const resumeDispatchGroupId = resume?.business_screening_dispatch_group_id || resume?.business_screening_batch_id || '';
      if (
        resume
        && (
          resume.hr_disposition === 'rejected'
          || resume.status === 'approved'
          || resume.status === 'rejected'
          || resume.business_screening_status === 'passed'
          || resume.business_screening_status === 'rejected'
        )
      ) {
        if (item.status === nextItemStatus) {
          return { applied: false, idempotent: true, status: input.status };
        }
        return {
          applied: false,
          idempotent: false,
          status: resume.business_screening_status === 'passed'
            ? 'passed'
            : 'rejected',
          reason: resume.hr_disposition === 'rejected'
            ? 'HR already rejected resume'
            : 'business screening already completed',
        };
      }
      if (!resume || !itemDispatchGroupId || !resumeDispatchGroupId || itemDispatchGroupId !== resumeDispatchGroupId) {
        return {
          applied: false,
          idempotent: false,
          status: input.status,
          reason: 'business screening dispatch group changed',
        };
      }
      if (item.status !== 'pending') {
        if (item.status === nextItemStatus) {
          return { applied: false, idempotent: true, status: input.status };
        }
        return {
          applied: false,
          idempotent: false,
          status: item.status === 'passed' ? 'passed' : 'rejected',
          reason: 'business screening already completed',
        };
      }
      item.status = nextItemStatus;
      item.remark = input.remark || null;
      item.processed_at = input.screenedAt || '2026-08-12T12:00:00.000Z';
      for (const sibling of batchItems) {
        if (
          sibling.resume_id === input.resumeId
          && sibling.id !== item.id
          && sibling.status === 'pending'
          && (sibling.dispatch_group_id || sibling.batch_id) === itemDispatchGroupId
        ) {
          sibling.status = nextItemStatus;
          sibling.remark = sibling.remark ?? (input.remark || null);
          sibling.processed_at = sibling.processed_at ?? item.processed_at;
        }
      }
      if (resume) {
        if (
          resume.business_screening_status === 'not_ready'
          || resume.business_screening_status === 'pending'
        ) {
          resume.business_screening_status = input.status;
          resume.business_screening_remark = input.remark || '';
          resume.business_screened_at = item.processed_at;
          resume.business_screened_by = input.screenedBy || '';
          resume.business_screening_batch_id = input.batchId;
          resume.business_screening_dispatch_group_id = itemDispatchGroupId;
          resume.status = nextResumeStatus;
          resume.stage = nextResumeStage;
          if (nextResumeStatus === 'approved') {
            resume.approved_at = item.processed_at;
            resume.rejected_at = null;
          } else {
            resume.rejected_at = item.processed_at;
            resume.approved_at = null;
          }
        }
      }
      return { applied: true, idempotent: false, status: input.status };
    },
    async revokeActiveBatchesForResume(_db, resumeId) {
      const touchedBatchIds = new Set(
        batchItems
          .filter((item) => item.resume_id === resumeId)
          .map((item) => item.batch_id),
      );
      for (const batchId of touchedBatchIds) {
        const batch = batches.get(batchId);
        if (batch?.status === 'active') batch.status = 'revoked';
      }
    },
    async removeResumeFromBusinessScreeningBatches(_db, resumeId) {
      const before = batchItems.length;
      for (let i = batchItems.length - 1; i >= 0; i -= 1) {
        const item = batchItems[i];
        if (item.resume_id === resumeId && item.status === 'pending') batchItems.splice(i, 1);
      }
      const resume = resumes.get(resumeId);
      if (resume) {
        const bs = resume.business_screening_status;
        if (!bs || bs === 'not_ready' || bs === 'pending') {
          resume.hr_disposition = 'pending';
          resume.business_screening_status = 'not_ready';
          resume.business_screening_batch_id = null;
          resume.business_screening_dispatch_group_id = null;
        }
      }
      return { removed: before - batchItems.length };
    },
    async setBatchStatus(_db, batchId, status) {
      const batch = batches.get(batchId);
      if (batch) batch.status = status;
    },
    async setBatchLastSentAt(_db, batchId, sentAt) {
      const batch = batches.get(batchId);
      if (batch) batch.last_sent_at = sentAt;
    },
    async countPendingBatchItems(_db, batchId) {
      return batchItems.filter((item) => item.batch_id === batchId && item.status === 'pending').length;
    },
  };

  const deps: BusinessScreeningRouteDeps = {
    authMiddleware: async (c, next) => {
      const auth = c.req.header('Authorization') || '';
      if (auth === 'Bearer hr-token') {
        c.set('user', { id: 'user-hr', email: 'hr@example.com', role: 'hr', full_name: '人事甲' });
        await next();
        return;
      }
      if (auth === 'Bearer admin-token') {
        c.set('user', { id: 'user-admin', email: 'admin@example.com', role: 'admin', full_name: '管理员' });
        await next();
        return;
      }
      // 模拟线上 hybrid 鉴权：长期 API Key 兜底（视为 admin 权限）
      if (c.req.header('x-api-key') === 'test-api-key') {
        c.set('user', { id: 'api-key', email: 'api-key@system', role: 'admin', full_name: 'API Key' });
        await next();
        return;
      }
      return c.json({ detail: 'Not authenticated' }, 401);
    },
    requireRole: (roles) => async (c, next) => {
      const user = c.get('user');
      if (!user || !roles.includes(user.role)) {
        return c.json({ detail: 'Operation not permitted' }, 403);
      }
      await next();
    },
    getCurrentUserToken: async () => 'user-token',
    sendFeishuMessageToUser: async (token, openId, card) => {
      const failure = options?.sendFailuresByOpenId?.[openId];
      if (failure) throw new Error(failure);
      sentMessages.push({ token, openId, card });
      return { message_id: `msg-${openId}` };
    },
    recordResumeDecisionTimestamp: async () => {},
    now: () => '2026-08-12T12:00:00.000Z',
    uuid: () => {
      tokenCounter += 1;
      return `uuid-${tokenCounter}`;
    },
    createPublicToken: async () => {
      tokenCounter += 1;
      const token = `public-token-${tokenCounter}`;
      const next = {
        token,
        tokenHash: await hashPublicToken(token),
      };
      createdTokens.push(next);
      return next;
    },
    // 固定业务范围 token：同 scope+批次 记忆化，保证同一业务范围复用同一链接
    createScopePublicToken: async (scopeKey: string, batchId: string) => {
      const memoKey = `${scopeKey}::${batchId}`;
      const existing = scopeTokens.get(memoKey);
      if (existing) return existing;
      const existingBatch = batches.get(batchId);
      if (existingBatch?.rawToken) {
        const next = { token: existingBatch.rawToken, tokenHash: await hashPublicToken(existingBatch.rawToken) };
        scopeTokens.set(memoKey, next);
        return next;
      }
      tokenCounter += 1;
      const token = `scope-token-${tokenCounter}`;
      const next = {
        token,
        tokenHash: await hashPublicToken(token),
      };
      scopeTokens.set(memoKey, next);
      createdTokens.push({ token: next.token, tokenHash: next.tokenHash });
      return next;
    },
    getResumeFileBytes: async (_env, resumeId) => {
      return { bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]), fileName: `${resumeId}.pdf` }; // mock PDF 字节
    },
    resolveApiKeyOwnerEmail: options?.apiKeyOwnerEmail === undefined
      ? undefined
      : async () => options.apiKeyOwnerEmail as string | null,
    store,
  };

  const app = createBusinessScreeningRoutes(deps);
  const env = {
    DB: {
      prepare(sql: string) {
        return {
          bind(...values: unknown[]) {
            return {
              async run() {
                if (sql.includes('UPDATE resumes') && sql.includes("SET hr_disposition = 'rejected'")) {
                  const comment = values[0] as string;
                  const screenedAt = values[1] as string;
                  const screenedBy = values[2] as string;
                  const updatedAt = values[3] as string;
                  const resumeId = values[4] as string;
                  const resume = resumes.get(resumeId);
                  if (!resume) return { meta: { changes: 0 } };
                  const wasPushed = resume.hr_disposition === 'pushed';
                  resume.hr_disposition = 'rejected';
                  resume.hr_review = comment;
                  if (wasPushed) {
                    resume.business_screening_status = 'rejected';
                    resume.business_screening_remark = comment;
                    resume.business_screened_at = screenedAt;
                    resume.business_screened_by = screenedBy;
                  } else {
                    resume.business_screening_status = 'not_ready';
                    resume.business_screening_remark = '';
                    resume.business_screened_at = null;
                    resume.business_screened_by = '';
                  }
                  resume.status = 'rejected';
                  resume.stage = 'rejected';
                  resume.updated_at = updatedAt;
                  return { meta: { changes: 1 } };
                }
                if (sql.includes('UPDATE resumes') && sql.includes('SET screening_result = ?')) {
                  // setResumeAiResult：翻转 AI 初筛结果（manual-push / eliminate）
                  const [result, aiReview, aiEvaluation, updatedAt, resumeId] = values;
                  const resume = resumes.get(resumeId as string);
                  if (resume) {
                    resume.screening_result = result as string;
                    if (aiReview) resume.ai_review = aiReview as string;
                    if (aiEvaluation) resume.ai_evaluation = aiEvaluation as string;
                    resume.updated_at = updatedAt as string;
                  }
                  return { meta: { changes: resume ? 1 : 0 } };
                }
                return { meta: { changes: 1 } };
              },
              async first() {
                if (sql.includes('SELECT ai_review')) {
                  const resume = resumes.get(values[0] as string);
                  return resume
                    ? { ai_review: resume.ai_review ?? null, ai_evaluation: resume.ai_evaluation ?? null }
                    : null;
                }
                return null;
              },
              async all() {
                return { results: [] };
              },
            };
          },
        };
      },
    } as D1Database,
  };
  const request = (input: string, init?: RequestInit) => app.request(input, init, env);

  return {
    app,
    request,
    store,
    resumes,
    positions,
    interviewerDirectory,
    batches,
    batchItems,
    sentMessages,
    createdTokens,
  };
}

describe('business screening routes', () => {
  it('rejects an unauthenticated HR push request', async () => {
    const { request } = buildHarness();

    const response = await request('https://ai-interview-88r.pages.dev/api/resumes/business-screening/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ['resume-1'] }),
    });

    expect(response.status).toBe(401);
  });

  it('pushes AI-rejected and unevaluated resumes through the normal route', async () => {
    const { request, batches } = buildHarness({
      apiKeyOwnerEmail: 'hr@example.com',
      resumes: [
        {
          id: 'resume-ai-no',
          candidate_name: '候选人丙',
          screening_result: '不通过',
          status: 'pending_screening',
          hr_disposition: 'pending',
          mapped_position: '标准运营',
          position_applied: '标准运营',
          business_screening_status: 'not_ready',
        },
        {
          id: 'resume-unassessed',
          candidate_name: '候选人丁',
          screening_result: null,
          status: 'pending_screening',
          hr_disposition: 'pending',
          mapped_position: '标准运营',
          position_applied: '标准运营',
          business_screening_status: 'not_ready',
        },
      ],
    });
    const response = await request('https://ai-interview-88r.pages.dev/api/resumes/business-screening/push', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer hr-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ids: ['resume-ai-no', 'resume-unassessed'] }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      pushed: ['resume-ai-no', 'resume-unassessed'],
      skipped: [],
    });
    expect(batches.size).toBe(1);
  });

  it('still skips HR-rejected, stale pushed, and business-screening terminal resumes', async () => {
    const { request } = buildHarness({
      resumes: [
        {
          id: 'resume-hr-rejected',
          candidate_name: 'HR已淘汰',
          screening_result: '不通过',
          status: 'pending_review',
          hr_disposition: 'rejected',
          mapped_position: '标准运营',
          position_applied: '标准运营',
          business_screening_status: 'not_ready',
        },
        {
          id: 'resume-stale-missing',
          candidate_name: '历史脏数据缺状态',
          screening_result: null,
          status: 'pending_review',
          hr_disposition: 'pushed',
          mapped_position: '标准运营',
          position_applied: '标准运营',
        },
        {
          id: 'resume-stale-not-ready',
          candidate_name: '历史脏数据未发起',
          screening_result: null,
          status: 'pending_review',
          hr_disposition: 'pushed',
          mapped_position: '标准运营',
          position_applied: '标准运营',
          business_screening_status: 'not_ready',
        },
        {
          id: 'resume-screening-pending',
          candidate_name: '业务筛选中',
          screening_result: null,
          status: 'pending_review',
          hr_disposition: 'pushed',
          mapped_position: '标准运营',
          position_applied: '标准运营',
          business_screening_status: 'pending',
        },
        {
          id: 'resume-screening-done',
          candidate_name: '业务筛选完成',
          screening_result: null,
          status: 'approved',
          hr_disposition: 'pushed',
          mapped_position: '标准运营',
          position_applied: '标准运营',
          business_screening_status: 'passed',
        },
      ],
    });
    const response = await request('https://ai-interview-88r.pages.dev/api/resumes/business-screening/push', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer hr-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ids: [
          'resume-hr-rejected',
          'resume-stale-missing',
          'resume-stale-not-ready',
          'resume-screening-pending',
          'resume-screening-done',
        ],
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      pushed: [],
      skipped: [
        { id: 'resume-hr-rejected', reason: 'HR已淘汰该简历' },
        { id: 'resume-stale-missing', reason: '业务筛选已发起，请使用批次重发' },
        { id: 'resume-stale-not-ready', reason: '业务筛选已发起，请使用批次重发' },
        { id: 'resume-screening-pending', reason: '业务筛选已发起，请使用批次重发' },
        { id: 'resume-screening-done', reason: '业务筛选已完成' },
      ],
    });
  });

  it('lists an interviewer active batches with URLs for scope batches and flags legacy ones', async () => {
    const { request } = buildHarness({
      initialBatches: [
        {
          id: 'batch-scope-1',
          interviewer_id: 'user-zhang',
          interviewer_name: '张三',
          interviewer_open_id: 'ou_zhang',
          token_hash: 'hash-scope-1',
          expires_at: '2026-09-01T00:00:00.000Z',
          status: 'active',
          created_by: 'hr@example.com',
          created_at: '2026-08-12T00:00:00.000Z',
          last_sent_at: null,
          dispatch_group_id: 'dg-1',
          scope_key: '标准运营::ou_zhang',
        },
        {
          id: 'batch-legacy-1',
          interviewer_id: 'user-zhang',
          interviewer_name: '张三',
          interviewer_open_id: 'ou_zhang',
          token_hash: 'hash-legacy-1',
          expires_at: '2026-09-01T00:00:00.000Z',
          status: 'active',
          created_by: 'hr@example.com',
          created_at: '2026-08-01T00:00:00.000Z',
          last_sent_at: null,
          dispatch_group_id: 'dg-2',
          scope_key: null,
        },
      ],
    });

    const response = await request('https://ai-interview-88r.pages.dev/api/resumes/business-screening/batches?interviewer=%E5%BC%A0%E4%B8%89', {
      method: 'GET',
      headers: { 'x-api-key': 'test-api-key' },
    });
    expect(response.status).toBe(200);
    const json = await response.json() as any;
    expect(json.total).toBe(2);
    const scopeBatch = json.batches.find((b: any) => b.batchId === 'batch-scope-1');
    expect(scopeBatch.url).toContain('/business-screening/');
    expect(scopeBatch.needsResend).toBe(false);
    const legacyBatch = json.batches.find((b: any) => b.batchId === 'batch-legacy-1');
    expect(legacyBatch.url).toBeNull();
    expect(legacyBatch.needsResend).toBe(true);
  });

  it('temp_link mode also admits resumes already pushed into business screening', async () => {
    const { request, batches } = buildHarness({
      apiKeyOwnerEmail: 'hr@example.com',
      resumes: [{
        id: 'resume-pushed',
        candidate_name: '候选人丁',
        screening_result: '通过',
        status: 'pending_screening',
        hr_disposition: 'pushed',
        mapped_position: '标准运营',
        position_applied: '标准运营',
        business_screening_status: 'pending',
      }],
    });
    const headers = { Authorization: 'Bearer hr-token', 'Content-Type': 'application/json' };

    // 普通推送：已推送 → 跳过
    const normalResp = await request('https://ai-interview-88r.pages.dev/api/resumes/business-screening/push', {
      method: 'POST',
      headers,
      body: JSON.stringify({ ids: ['resume-pushed'] }),
    });
    await expect(normalResp.json()).resolves.toMatchObject({
      pushed: [],
      skipped: [{ id: 'resume-pushed', reason: '业务筛选已发起，请使用批次重发' }],
    });

    // temp_link：已推送的也允许进入自定义临时链接
    const tempResp = await request('https://ai-interview-88r.pages.dev/api/resumes/business-screening/push', {
      method: 'POST',
      headers,
      body: JSON.stringify({ ids: ['resume-pushed'], temp_link: true }),
    });
    expect(tempResp.status).toBe(200);
    await expect(tempResp.json()).resolves.toMatchObject({
      ok: true,
      pushed: ['resume-pushed'],
      skipped: [],
      batches: [{ interviewer: '张三', itemCount: 1 }],
    });
  });

  it('temp_link mode creates an independent link each time and never reuses the scope batch', async () => {
    const { request, batches } = buildHarness({
      apiKeyOwnerEmail: 'hr@example.com',
      resumes: [
        {
          id: 'resume-a',
          candidate_name: '候选人A',
          screening_result: '通过',
          status: 'pending_screening',
          hr_disposition: 'pending',
          mapped_position: '标准运营',
          position_applied: '标准运营',
          business_screening_status: 'not_ready',
        },
        {
          id: 'resume-b',
          candidate_name: '候选人B',
          screening_result: '通过',
          status: 'pending_screening',
          hr_disposition: 'pending',
          mapped_position: '标准运营',
          position_applied: '标准运营',
          business_screening_status: 'not_ready',
        },
      ],
    });
    const headers = { Authorization: 'Bearer hr-token', 'Content-Type': 'application/json' };

    // 两次同 scope 的 temp_link 推送 → 两个不同链接（独立新批次）
    const r1 = await request('https://ai-interview-88r.pages.dev/api/resumes/business-screening/push', {
      method: 'POST', headers,
      body: JSON.stringify({ ids: ['resume-a'], temp_link: true, title: '临时1' }),
    });
    const j1 = await r1.json() as any;
    const r2 = await request('https://ai-interview-88r.pages.dev/api/resumes/business-screening/push', {
      method: 'POST', headers,
      body: JSON.stringify({ ids: ['resume-b'], temp_link: true, title: '临时2' }),
    });
    const j2 = await r2.json() as any;
    expect(j1.batches[0].url).not.toBe(j2.batches[0].url);
    expect(batches.size).toBe(2);
  });

  it('temp_link with batch_id appends to the same batch and keeps one link', async () => {
    const { request } = buildHarness({
      apiKeyOwnerEmail: 'hr@example.com',
      resumes: [
        {
          id: 'resume-aa',
          candidate_name: '候选人AA',
          screening_result: '通过',
          status: 'pending_screening',
          hr_disposition: 'pending',
          mapped_position: '标准运营',
          position_applied: '标准运营',
          business_screening_status: 'not_ready',
        },
        {
          id: 'resume-bb',
          candidate_name: '候选人BB',
          screening_result: '通过',
          status: 'pending_screening',
          hr_disposition: 'pending',
          mapped_position: '标准运营',
          position_applied: '标准运营',
          business_screening_status: 'not_ready',
        },
      ],
    });
    const headers = { Authorization: 'Bearer hr-token', 'Content-Type': 'application/json' };

    // 第一批：生成临时批次
    const r1 = await request('https://ai-interview-88r.pages.dev/api/resumes/business-screening/push', {
      method: 'POST', headers,
      body: JSON.stringify({ ids: ['resume-aa'], temp_link: true, title: '分批临时' }),
    });
    const j1 = await r1.json() as any;
    expect(j1.batches).toHaveLength(1);
    const batchId = j1.batches[0].batchId;

    // 第二批：带 batch_id 追加到同一批次 → 同一链接
    const r2 = await request('https://ai-interview-88r.pages.dev/api/resumes/business-screening/push', {
      method: 'POST', headers,
      body: JSON.stringify({ ids: ['resume-bb'], temp_link: true, batch_id: batchId }),
    });
    const j2 = await r2.json() as any;
    expect(j2.batches).toHaveLength(1);
    expect(j2.batches[0].url).toBe(j1.batches[0].url);
    expect(j2.batches[0].itemCount).toBe(1);
  });

  it('accepts a valid long-lived API key for push and rejects a wrong key', async () => {
    const { request, createdTokens } = buildHarness({ apiKeyOwnerEmail: 'hr@example.com' });

    // 错误 key → 401
    const wrongKeyResp = await request('https://ai-interview-88r.pages.dev/api/resumes/business-screening/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'wrong-key' },
      body: JSON.stringify({ ids: ['resume-1'] }),
    });
    expect(wrongKeyResp.status).toBe(401);

    // 正确 key → 生成链接成功（与 JWT 同权）
    const okResp = await request('https://ai-interview-88r.pages.dev/api/resumes/business-screening/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'test-api-key' },
      body: JSON.stringify({ ids: ['resume-1'], expires_in_days: 7 }),
    });
    expect(okResp.status).toBe(200);
    expect(createdTokens).toHaveLength(1);
    await expect(okResp.json()).resolves.toMatchObject({
      ok: true,
      pushed: ['resume-1'],
      batches: [{ interviewer: '张三', itemCount: 1, expiresAt: '2026-08-19T12:00:00.000Z' }],
    });
  });

  it('sends the Feishu card via the configured API-key owner user', async () => {
    const { request, sentMessages } = buildHarness({
      apiKeyOwnerEmail: 'hr@example.com',
    });

    const okResp = await request('https://ai-interview-88r.pages.dev/api/resumes/business-screening/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'test-api-key' },
      body: JSON.stringify({ ids: ['resume-1'] }),
    });
    expect(okResp.status).toBe(200);
    // 归属用户已配 → 卡片成功发送给责任人，failed 为空
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].openId).toBe('ou_zhang');
    await expect(okResp.json()).resolves.toMatchObject({ ok: true, failed: [] });
  });

  it('silent push generates the link without sending any Feishu card', async () => {
    const { request, sentMessages } = buildHarness({
      apiKeyOwnerEmail: 'hr@example.com',
    });

    const okResp = await request('https://ai-interview-88r.pages.dev/api/resumes/business-screening/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'test-api-key' },
      body: JSON.stringify({ ids: ['resume-1'], silent: true, title: '静默生成' }),
    });
    expect(okResp.status).toBe(200);
    // 静默：不发飞书卡片、failed 为空、链接照常生成
    expect(sentMessages).toHaveLength(0);
    await expect(okResp.json()).resolves.toMatchObject({
      ok: true,
      pushed: ['resume-1'],
      failed: [],
      batches: [{ interviewer: '张三', itemCount: 1 }],
    });
  });

  it('silent push works without a Feishu-bound sender', async () => {
    const { request, sentMessages } = buildHarness();

    const okResp = await request('https://ai-interview-88r.pages.dev/api/resumes/business-screening/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'test-api-key' },
      body: JSON.stringify({ ids: ['resume-1'], silent: true }),
    });
    expect(okResp.status).toBe(200);
    expect(sentMessages).toHaveLength(0);
    await expect(okResp.json()).resolves.toMatchObject({
      ok: true,
      failed: [],
      batches: [{ interviewer: '张三', itemCount: 1 }],
    });
  });

  it('reports the missing-owner reason when the API key has no Feishu owner configured', async () => {
    const { request, sentMessages } = buildHarness({
      apiKeyOwnerEmail: null,
    });

    const okResp = await request('https://ai-interview-88r.pages.dev/api/resumes/business-screening/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'test-api-key' },
      body: JSON.stringify({ ids: ['resume-1'] }),
    });
    expect(okResp.status).toBe(200);
    expect(sentMessages).toHaveLength(0);
    await expect(okResp.json()).resolves.toMatchObject({
      failed: [{ interviewer: '张三', reason: expect.stringContaining('未配置飞书归属用户') }],
    });
  });

  it('allows a long-lived API key to resend a batch as permanent', async () => {
    const { request, batches } = buildHarness({
      apiKeyOwnerEmail: 'hr@example.com',
      initialBatches: [{
        id: 'batch-key-resend',
        interviewer_id: 'user-zhang',
        interviewer_name: '张三',
        interviewer_open_id: 'ou_zhang',
        token_hash: 'hash-key-resend',
        expires_at: '2026-08-19T12:00:00.000Z',
        status: 'active',
        created_by: 'hr@example.com',
        created_at: '2026-08-12T12:00:00.000Z',
        last_sent_at: null,
        rawToken: 'key-resend-token',
      }],
      initialItems: [{
        id: 'item-key-resend',
        batch_id: 'batch-key-resend',
        resume_id: 'resume-1',
        position_id: 'position-1',
        status: 'pending',
        remark: null,
        processed_at: null,
        created_at: '2026-08-12T12:00:00.000Z',
        candidate_name: '候选人甲',
        mapped_position: '标准运营',
      }],
      resumes: [{
        id: 'resume-1',
        candidate_name: '候选人甲',
        screening_result: '通过',
        status: 'pending_review',
        mapped_position: '标准运营',
        position_applied: '标准运营',
        business_screening_status: 'pending',
      }],
    });

    const response = await request('https://ai-interview-88r.pages.dev/api/resumes/business-screening/batches/batch-key-resend/resend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'test-api-key' },
      body: JSON.stringify({ expires_in_days: 0 }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      itemCount: 1,
    });
    // 新批次为永久（expires_at null），旧批次被 revoke
    const newBatch = [...batches.values()].find((batch) => batch.id !== 'batch-key-resend');
    expect(newBatch?.expires_at).toBeNull();
    expect(batches.get('batch-key-resend')?.status).toBe('revoked');
  });

  it('defaults batch expiry to 7 days and supports permanent links via expires_in_days=0', async () => {
    const { request, batches } = buildHarness({
      positions: [
        { id: 'position-1', title: '标准运营', primary_interviewer: '张三', secondary_interviewer: '李四', responsible_person: '张三' },
        { id: 'position-2', title: '运营专员', primary_interviewer: '张三', secondary_interviewer: '李四', responsible_person: '李四' },
      ],
      resumes: [
        {
          id: 'resume-1',
          candidate_name: '候选人甲',
          screening_result: '通过',
          status: 'pending_review',
          hr_disposition: 'pending',
          mapped_position: '标准运营',
          position_applied: '标准运营',
          business_screening_status: 'not_ready',
        },
        {
          id: 'resume-2',
          candidate_name: '候选人乙',
          screening_result: '通过',
          status: 'pending_review',
          hr_disposition: 'pending',
          mapped_position: '运营专员',
          position_applied: '运营专员',
          business_screening_status: 'not_ready',
        },
      ],
    });

    const push = (ids: string[], body?: object) => request('https://ai-interview-88r.pages.dev/api/resumes/business-screening/push', {
      method: 'POST',
      headers: { Authorization: 'Bearer hr-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, ...(body || {}) }),
    });

    // 不传 expires_in_days → 默认 30 天
    const defaultResp = await push(['resume-1']);
    expect(defaultResp.status).toBe(200);
    const defaultBatch = [...batches.values()][0];
    expect(defaultBatch.expires_at).toBe('2026-09-11T12:00:00.000Z');
    await expect(defaultResp.json()).resolves.toMatchObject({
      batches: [{ expiresAt: '2026-09-11T12:00:00.000Z' }],
    });

    // expires_in_days=0 → 永久（expires_at 为 null，永不过期）
    const permanentResp = await push(['resume-2'], { expires_in_days: 0 });
    expect(permanentResp.status).toBe(200);
    const permanentBatch = [...batches.values()].find((batch) => batch.id !== defaultBatch.id);
    expect(permanentBatch?.expires_at).toBeNull();
    await expect(permanentResp.json()).resolves.toMatchObject({
      batches: [{ expiresAt: null }],
    });
  });

  it('honors a custom positive expiry in days for the push batch', async () => {
    const { request, batches } = buildHarness();

    const response = await request('https://ai-interview-88r.pages.dev/api/resumes/business-screening/push', {
      method: 'POST',
      headers: { Authorization: 'Bearer hr-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ['resume-1'], expires_in_days: 30 }),
    });
    expect(response.status).toBe(200);
    const batch = [...batches.values()][0];
    expect(batch.expires_at).toBe('2026-09-11T12:00:00.000Z');
    await expect(response.json()).resolves.toMatchObject({
      batches: [{ expiresAt: '2026-09-11T12:00:00.000Z' }],
    });
  });

  it('stores and returns a custom page title/subtitle on push and exposes it on the public link', async () => {
    const { request, batches, createdTokens } = buildHarness();

    const pushResp = await request('https://ai-interview-88r.pages.dev/api/resumes/business-screening/push', {
      method: 'POST',
      headers: { Authorization: 'Bearer hr-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ids: ['resume-1'],
        title: 'IoT产品经理候选人审核',
        subtitle: '请查看 AI 初筛通过的候选人并给出入库建议',
      }),
    });
    expect(pushResp.status).toBe(200);
    const batch = [...batches.values()][0];
    expect(batch.batch_title).toBe('IoT产品经理候选人审核');
    expect(batch.batch_subtitle).toBe('请查看 AI 初筛通过的候选人并给出入库建议');
    await expect(pushResp.json()).resolves.toMatchObject({
      batches: [{ title: 'IoT产品经理候选人审核', subtitle: '请查看 AI 初筛通过的候选人并给出入库建议' }],
    });

    // 公开链接响应带出标题/说明
    const publicResp = await request(`https://ai-interview-88r.pages.dev/api/public/business-screening/${createdTokens[0].token}`, {
      method: 'GET',
    });
    expect(publicResp.status).toBe(200);
    await expect(publicResp.json()).resolves.toMatchObject({
      batch: { title: 'IoT产品经理候选人审核', subtitle: '请查看 AI 初筛通过的候选人并给出入库建议' },
    });
  });

  it('defaults to no custom title when push omits it', async () => {
    const { request, batches } = buildHarness();

    const pushResp = await request('https://ai-interview-88r.pages.dev/api/resumes/business-screening/push', {
      method: 'POST',
      headers: { Authorization: 'Bearer hr-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ['resume-1'] }),
    });
    expect(pushResp.status).toBe(200);
    const batch = [...batches.values()][0];
    expect(batch.batch_title).toBeNull();
    expect(batch.batch_subtitle).toBeNull();
    const json = await pushResp.json() as any;
    expect(json.batches[0]).not.toHaveProperty('title');
    expect(json.batches[0]).not.toHaveProperty('subtitle');
  });

  it('updates the existing stable link title when a new push supplies title', async () => {
    const { request, createdTokens, resumes } = buildHarness({ apiKeyOwnerEmail: 'hr@example.com' });

    const first = await request('https://ai-interview-88r.pages.dev/api/resumes/business-screening/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'test-api-key' },
      body: JSON.stringify({ ids: ['resume-1'], title: '旧标题' }),
    });
    const firstBody = await first.json() as any;
    const token = firstBody.batches[0].url.split('/').pop();

    // 新简历触发同 scope 的稳定链接复用；已推送简历仍按既有规则保持 pending。
    resumes.set('resume-2', {
      id: 'resume-2',
      candidate_name: '候选人乙',
      screening_result: '通过',
      status: 'pending_review',
      hr_disposition: 'pending',
      mapped_position: '标准运营',
      position_applied: '标准运营',
      business_screening_status: 'not_ready',
    });

    await request('https://ai-interview-88r.pages.dev/api/resumes/business-screening/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'test-api-key' },
      body: JSON.stringify({ ids: ['resume-2'], title: 'AI 初筛通过表' }),
    });

    const publicResponse = await request(`https://ai-interview-88r.pages.dev/api/public/business-screening/${token}`);
    await expect(publicResponse.json()).resolves.toMatchObject({
      batch: { title: 'AI 初筛通过表' },
    });
    expect(createdTokens).toHaveLength(1);
  });

  it('persists a new batch title and exposes it from the public endpoint', async () => {
    const { request } = buildHarness({ apiKeyOwnerEmail: 'hr@example.com' });
    const response = await request('https://ai-interview-88r.pages.dev/api/resumes/business-screening/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'test-api-key' },
      body: JSON.stringify({ ids: ['resume-1'], title: 'AI 初筛通过表' }),
    });
    const body = await response.json() as any;
    const token = body.batches[0].url.split('/').pop();
    expect(body.batches[0].title).toBe('AI 初筛通过表');

    const publicResponse = await request(`https://ai-interview-88r.pages.dev/api/public/business-screening/${token}`);
    await expect(publicResponse.json()).resolves.toMatchObject({
      batch: { title: 'AI 初筛通过表' },
    });
  });

  it('does not clear an existing title when the next push omits title', async () => {
    const { request, resumes } = buildHarness({ apiKeyOwnerEmail: 'hr@example.com' });
    const first = await request('https://ai-interview-88r.pages.dev/api/resumes/business-screening/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'test-api-key' },
      body: JSON.stringify({ ids: ['resume-1'], title: 'AI 初筛通过表' }),
    });
    const firstBody = await first.json() as any;
    const token = firstBody.batches[0].url.split('/').pop();

    resumes.set('resume-2', {
      id: 'resume-2',
      candidate_name: '候选人乙',
      screening_result: '通过',
      status: 'pending_review',
      hr_disposition: 'pending',
      mapped_position: '标准运营',
      position_applied: '标准运营',
      business_screening_status: 'not_ready',
    });

    await request('https://ai-interview-88r.pages.dev/api/resumes/business-screening/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'test-api-key' },
      body: JSON.stringify({ ids: ['resume-2'] }),
    });

    const publicResponse = await request(`https://ai-interview-88r.pages.dev/api/public/business-screening/${token}`);
    await expect(publicResponse.json()).resolves.toMatchObject({
      batch: { title: 'AI 初筛通过表' },
    });
  });

  it('inherits the original batch title/subtitle on resend', async () => {
    const { request, batches, createdTokens } = buildHarness({
      initialBatches: [{
        id: 'batch-title-inherit',
        interviewer_id: 'user-zhang',
        interviewer_name: '张三',
        interviewer_open_id: 'ou_zhang',
        token_hash: 'hash-title-inherit',
        expires_at: '2026-08-19T12:00:00.000Z',
        status: 'active',
        created_by: 'hr@example.com',
        created_at: '2026-08-12T12:00:00.000Z',
        last_sent_at: null,
        rawToken: 'title-inherit-token',
        batch_title: '原批次标题',
        batch_subtitle: '原批次说明',
      }],
      initialItems: [{
        id: 'item-title-inherit',
        batch_id: 'batch-title-inherit',
        resume_id: 'resume-1',
        position_id: 'position-1',
        status: 'pending',
        remark: null,
        processed_at: null,
        created_at: '2026-08-12T12:00:00.000Z',
        candidate_name: '候选人甲',
        mapped_position: '标准运营',
      }],
      resumes: [{
        id: 'resume-1',
        candidate_name: '候选人甲',
        screening_result: '通过',
        status: 'pending_review',
        mapped_position: '标准运营',
        position_applied: '标准运营',
        business_screening_status: 'pending',
      }],
    });

    // 重发：默认沿用原批次标题/说明
    const resendResp = await request('https://ai-interview-88r.pages.dev/api/resumes/business-screening/batches/batch-title-inherit/resend', {
      method: 'POST',
      headers: { Authorization: 'Bearer hr-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(resendResp.status).toBe(200);
    const resentBatch = [...batches.values()].find((batch) => batch.id !== 'batch-title-inherit');
    expect(resentBatch?.batch_title).toBe('原批次标题');
    expect(resentBatch?.batch_subtitle).toBe('原批次说明');

    // 公开链接沿用标题
    const publicResp = await request(`https://ai-interview-88r.pages.dev/api/public/business-screening/${createdTokens[0].token}`, {
      method: 'GET',
    });
    expect(publicResp.status).toBe(200);
    await expect(publicResp.json()).resolves.toMatchObject({
      batch: { title: '原批次标题', subtitle: '原批次说明' },
    });
  });

  it('normalizes explicit resend titles and defaults action-only resend titles', async () => {
    const baseBatch = {
      interviewer_id: 'user-zhang',
      interviewer_name: '张三',
      interviewer_open_id: 'ou_zhang',
      expires_at: '2026-08-19T12:00:00.000Z',
      status: 'active' as const,
      created_by: 'hr@example.com',
      created_at: '2026-08-12T12:00:00.000Z',
      last_sent_at: null,
    };
    const baseItem = {
      position_id: 'position-1',
      status: 'pending' as const,
      remark: null,
      processed_at: null,
      created_at: '2026-08-12T12:00:00.000Z',
      candidate_name: '候选人甲',
      mapped_position: '标准运营',
    };
    const baseResume = {
      id: 'resume-1',
      candidate_name: '候选人甲',
      screening_result: '通过',
      status: 'pending_review',
      mapped_position: '标准运营',
      position_applied: '标准运营',
      business_screening_status: 'pending' as const,
    };

    const cleaned = buildHarness({
      initialBatches: [{ ...baseBatch, id: 'batch-resend-cleaned', token_hash: 'hash-resend-cleaned', rawToken: 'resend-cleaned-token' }],
      initialItems: [{ ...baseItem, id: 'item-resend-cleaned', batch_id: 'batch-resend-cleaned', resume_id: 'resume-1' }],
      resumes: [baseResume],
    });
    const cleanedResponse = await cleaned.request('https://ai-interview-88r.pages.dev/api/resumes/business-screening/batches/batch-resend-cleaned/resend', {
      method: 'POST',
      headers: { Authorization: 'Bearer hr-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '  “AI 初筛通过表” 给我链接' }),
    });
    expect(cleanedResponse.status).toBe(200);
    expect([...cleaned.batches.values()].find((candidate) => candidate.id !== 'batch-resend-cleaned')?.batch_title).toBe('AI 初筛通过表');

    const fallback = buildHarness({
      initialBatches: [{ ...baseBatch, id: 'batch-resend-fallback', token_hash: 'hash-resend-fallback', rawToken: 'resend-fallback-token' }],
      initialItems: [{ ...baseItem, id: 'item-resend-fallback', batch_id: 'batch-resend-fallback', resume_id: 'resume-1' }],
      resumes: [baseResume],
    });
    const fallbackResponse = await fallback.request('https://ai-interview-88r.pages.dev/api/resumes/business-screening/batches/batch-resend-fallback/resend', {
      method: 'POST',
      headers: { Authorization: 'Bearer hr-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '查询' }),
    });
    expect(fallbackResponse.status).toBe(200);
    expect([...fallback.batches.values()].find((candidate) => candidate.id !== 'batch-resend-fallback')?.batch_title).toBe('业务筛选');
  });

  it('updates a stable resend batch title without issuing another token', async () => {
    const { request, batches, createdTokens } = buildHarness({ apiKeyOwnerEmail: 'hr@example.com' });
    const pushResponse = await request('https://ai-interview-88r.pages.dev/api/resumes/business-screening/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'test-api-key' },
      body: JSON.stringify({ ids: ['resume-1'], title: '旧标题', subtitle: '原说明' }),
    });
    const pushBody = await pushResponse.json() as any;
    const token = pushBody.batches[0].url.split('/').pop();
    const batchId = pushBody.batches[0].batchId;

    const resendResponse = await request(`https://ai-interview-88r.pages.dev/api/resumes/business-screening/batches/${batchId}/resend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'test-api-key' },
      body: JSON.stringify({ title: '  “AI 初筛通过表” 给我链接' }),
    });
    expect(resendResponse.status).toBe(200);
    await expect(resendResponse.json()).resolves.toMatchObject({ batchId });
    expect(createdTokens).toHaveLength(1);
    expect(batches.get(batchId)).toMatchObject({ batch_title: 'AI 初筛通过表', batch_subtitle: '原说明' });

    const publicResponse = await request(`https://ai-interview-88r.pages.dev/api/public/business-screening/${token}`);
    await expect(publicResponse.json()).resolves.toMatchObject({
      batch: { title: 'AI 初筛通过表', subtitle: '原说明' },
    });
  });

  it('keeps a permanent batch accessible past the default 7-day window and treats expired ones as 410', async () => {
    const { request, batches } = buildHarness({
      initialBatches: [
        {
          id: 'batch-permanent',
          interviewer_id: 'user-zhang',
          interviewer_name: '张三',
          interviewer_open_id: 'ou_zhang',
          token_hash: 'hash-permanent',
          expires_at: null,
          status: 'active',
          created_by: 'hr@example.com',
          created_at: '2026-08-01T00:00:00.000Z',
          last_sent_at: null,
          rawToken: 'permanent-token',
        },
        {
          id: 'batch-expired',
          interviewer_id: 'user-zhang',
          interviewer_name: '张三',
          interviewer_open_id: 'ou_zhang',
          token_hash: 'hash-expired',
          expires_at: '2026-08-01T00:00:00.000Z',
          status: 'active',
          created_by: 'hr@example.com',
          created_at: '2026-07-01T00:00:00.000Z',
          last_sent_at: null,
          rawToken: 'expired-token',
        },
      ],
      initialItems: [
        {
          id: 'item-permanent',
          batch_id: 'batch-permanent',
          resume_id: 'resume-1',
          position_id: 'position-1',
          status: 'pending',
          remark: null,
          processed_at: null,
          created_at: '2026-08-01T00:00:00.000Z',
          candidate_name: '候选人甲',
          mapped_position: '标准运营',
        },
      ],
      resumes: [{
        id: 'resume-1',
        candidate_name: '候选人甲',
        screening_result: '通过',
        status: 'pending_review',
        mapped_position: '标准运营',
        position_applied: '标准运营',
        business_screening_status: 'pending',
      }],
    });

    // 永久批次（expires_at=null）：即使生成已远超 7 天仍可访问
    const permanentAccess = await request('https://ai-interview-88r.pages.dev/api/public/business-screening/permanent-token', {
      method: 'GET',
    });
    expect(permanentAccess.status).toBe(200);

    // 过期批次：返回 410
    const expiredAccess = await request('https://ai-interview-88r.pages.dev/api/public/business-screening/expired-token', {
      method: 'GET',
    });
    expect(expiredAccess.status).toBe(410);
    expect(batches.get('batch-expired')?.status).toBe('expired');
  });

  it('rejects HR elimination when business screening is already completed', async () => {
    const { request } = buildHarness({
      resumes: [{
        id: 'resume-1',
        candidate_name: '候选人甲',
        screening_result: '通过',
        status: 'pending_review',
        hr_disposition: 'pushed',
        mapped_position: '标准运营',
        position_applied: '标准运营',
        business_screening_status: 'passed',
      }],
    });

    const response = await request('https://ai-interview-88r.pages.dev/api/resumes/resume-1/business-screening/reject', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer hr-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ comment: '已完成业务筛选，不允许淘汰' }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      detail: expect.stringContaining('completed'),
    });
  });

  it('does not let a stale terminal business status block HR rejection before push', async () => {
    const { request, resumes } = buildHarness({
      resumes: [{
        id: 'resume-1',
        candidate_name: '候选人甲',
        screening_result: '通过',
        status: 'pending_review',
        hr_disposition: 'pending',
        mapped_position: '标准运营',
        position_applied: '标准运营',
        business_screening_status: 'passed',
      }],
    });

    const response = await request('https://ai-interview-88r.pages.dev/api/resumes/resume-1/business-screening/reject', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer hr-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ comment: '历史未推送记录直接淘汰' }),
    });

    expect(response.status).toBe(200);
    expect(resumes.get('resume-1')).toMatchObject({
      hr_disposition: 'rejected',
      business_screening_status: 'not_ready',
      status: 'rejected',
    });
  });

  it('HR rejection revokes old public links and keeps callback state unchanged', async () => {
    const { request, resumes, batches, batchItems } = buildHarness({
      initialBatches: [{
        id: 'batch-hr-reject',
        interviewer_id: 'user-zhang',
        interviewer_name: '张三',
        interviewer_open_id: 'ou_zhang',
        token_hash: 'hash-hr-reject',
        expires_at: '2026-08-19T00:00:00.000Z',
        status: 'active',
        created_by: 'hr@example.com',
        created_at: '2026-08-12T00:00:00.000Z',
        last_sent_at: '2026-08-12T00:00:00.000Z',
        rawToken: 'hr-reject-token',
      }],
      initialItems: [{
        id: 'item-hr-reject',
        batch_id: 'batch-hr-reject',
        resume_id: 'resume-1',
        position_id: 'position-1',
        status: 'pending',
        remark: null,
        processed_at: null,
        created_at: '2026-08-12T00:00:00.000Z',
        candidate_name: '候选人甲',
        mapped_position: '标准运营',
        hr_disposition: 'pushed',
        business_screening_status: 'pending',
      }],
      resumes: [{
        id: 'resume-1',
        candidate_name: '候选人甲',
        screening_result: '通过',
        status: 'pending_review',
        stage: 'screening',
        hr_disposition: 'pushed',
        mapped_position: '标准运营',
        position_applied: '标准运营',
        business_screening_status: 'pending',
        business_screening_batch_id: 'batch-hr-reject',
      }],
    });

    const rejectResponse = await request('https://ai-interview-88r.pages.dev/api/resumes/resume-1/business-screening/reject', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer hr-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ comment: 'HR淘汰' }),
    });

    expect(rejectResponse.status).toBe(200);
    expect(batches.get('batch-hr-reject')?.status).toBe('revoked');
    expect(resumes.get('resume-1')).toMatchObject({
      hr_disposition: 'rejected',
      business_screening_status: 'rejected',
      business_screening_remark: 'HR淘汰',
      business_screened_by: 'HR',
      status: 'rejected',
      stage: 'rejected',
    });

    const callbackResponse = await request('https://ai-interview-88r.pages.dev/api/public/business-screening/hr-reject-token/resumes/resume-1/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ remark: '旧链接不应生效' }),
    });

    expect(callbackResponse.status).toBe(410);
    await expect(callbackResponse.json()).resolves.toMatchObject({
      detail: 'Link unavailable',
    });
    expect(batchItems.find((item) => item.id === 'item-hr-reject')).toMatchObject({
      status: 'pending',
      remark: null,
      processed_at: null,
    });
    expect(resumes.get('resume-1')).toMatchObject({
      hr_disposition: 'rejected',
      business_screening_status: 'rejected',
      business_screening_remark: 'HR淘汰',
      business_screened_by: 'HR',
      status: 'rejected',
      stage: 'rejected',
    });
  });

  it('groups eligible resumes by responsible person and returns public URLs', async () => {
    const { request, resumes, sentMessages } = buildHarness({
      resumes: [
        {
          id: 'resume-1',
          candidate_name: '候选人甲',
          email: 'jia@example.com',
          contact: '13800000000',
          screening_result: '通过',
          status: 'pending_review',
          hr_disposition: 'pending',
          mapped_position: '标准运营',
          position_applied: '标准运营',
          business_screening_status: 'not_ready',
        },
        {
          id: 'resume-2',
          candidate_name: '候选人乙',
          screening_result: '不通过',
          status: 'pending_review',
          hr_disposition: 'pending',
          mapped_position: '标准运营',
          position_applied: '标准运营',
          business_screening_status: 'not_ready',
        },
      ],
    });

    const response = await request('https://ai-interview-88r.pages.dev/api/resumes/business-screening/push', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer hr-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ids: ['resume-1', 'resume-2'] }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      ok: true,
      pushed: ['resume-1', 'resume-2'],
      skipped: [],
      failed: [],
    });
    expect(body.batches).toHaveLength(1);
    expect(body.batches[0].interviewer).toBe('张三');
    expect(body.batches[0].url).toMatch(/^https:\/\/ai-interview-88r\.pages\.dev\/business-screening\//);
    expect(body.batches[0].url).not.toContain('/api/public/business-screening/');
    expect(resumes.get('resume-1')).toMatchObject({
      hr_disposition: 'pushed',
      business_screening_status: 'pending',
    });
    expect(sentMessages).toHaveLength(1);
  });

  it('skips duplicate fresh pushes for resumes already in business screening and leaves resend to the batch route', async () => {
    const { request, batches, sentMessages, resumes } = buildHarness({
      resumes: [{
        id: 'resume-1',
        candidate_name: '候选人甲',
        email: 'jia@example.com',
        contact: '13800000000',
        screening_result: '通过',
        status: 'pending_review',
        stage: 'screening',
        hr_disposition: 'pushed',
        mapped_position: '标准运营',
        position_applied: '标准运营',
        business_screening_status: 'pending',
        business_screening_batch_id: 'batch-existing',
      }],
    });

    const response = await request('https://ai-interview-88r.pages.dev/api/resumes/business-screening/push', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer hr-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ids: ['resume-1'] }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      pushed: [],
      skipped: [{ id: 'resume-1', reason: '业务筛选已发起，请使用批次重发' }],
      failed: [],
      batches: [],
    });
    expect(batches.size).toBe(0);
    expect(sentMessages).toHaveLength(0);
    expect(resumes.get('resume-1')).toMatchObject({
      business_screening_status: 'pending',
      business_screening_batch_id: 'batch-existing',
    });
  });

  it('keeps successful responsible-person groups when another delivery fails', async () => {
    const { request, batches, sentMessages } = buildHarness({
      positions: [
        { id: 'position-1', title: '标准运营', primary_interviewer: '张三', secondary_interviewer: '李四', responsible_person: '张三' },
        { id: 'position-2', title: '销售', primary_interviewer: '李四', secondary_interviewer: '', responsible_person: '李四' },
      ],
      resumes: [
        {
          id: 'resume-1',
          candidate_name: '候选人甲',
          screening_result: '通过',
          status: 'pending_review',
          hr_disposition: 'pending',
          mapped_position: '标准运营',
          position_applied: '标准运营',
          business_screening_status: 'not_ready',
        },
        {
          id: 'resume-2',
          candidate_name: '候选人乙',
          screening_result: '通过',
          status: 'pending_review',
          hr_disposition: 'pending',
          mapped_position: '销售',
          position_applied: '销售',
          business_screening_status: 'not_ready',
        },
      ],
      sendFailuresByOpenId: {
        ou_li: '发送用户消息失败: mock fail',
      },
    });

    const response = await request('https://ai-interview-88r.pages.dev/api/resumes/business-screening/push', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer hr-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ids: ['resume-1', 'resume-2'] }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.pushed).toEqual(['resume-1', 'resume-2']);
    expect(body.failed).toEqual([{ interviewer: '李四', reason: expect.stringContaining('mock fail') }]);
    expect(body.batches).toHaveLength(2);
    expect(body.batches.map((batch: { interviewer: string }) => batch.interviewer).sort()).toEqual(['张三', '李四']);
    expect(sentMessages).toHaveLength(1);
    expect([...batches.values()].every((batch) => batch.status === 'active')).toBe(true);
  });

  it('returns only the token-scoped interviewer batch view and sanitizes candidate payloads', async () => {
    const { request, createdTokens } = buildHarness();

    const pushResponse = await request('https://ai-interview-88r.pages.dev/api/resumes/business-screening/push', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer hr-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ids: ['resume-1'] }),
    });
    expect(pushResponse.status).toBe(200);

    const [firstToken] = createdTokens;
    const response = await request(`https://ai-interview-88r.pages.dev/api/public/business-screening/${firstToken.token}`);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.batch.interviewer).toBe('张三');
    expect(body.resumes).toEqual([
      expect.objectContaining({
        id: 'resume-1',
        candidateName: '候选人甲',
        position: '标准运营',
        status: 'pending',
      }),
    ]);
    expect(body.resumes[0].email).toBeUndefined();
    // 电话透出给面试官（业务筛选决策需要联系候选人）
    expect(body.resumes[0].contact).toBe('13800000000');
    // 简历原文与 AI 评估字段透出（用于业务筛选页展示）
    expect(typeof body.resumes[0].resumeText).toBe('string');
    expect(body.resumes[0].matchScore).toBeDefined();
  });

  it('downloads a resume source file with the public token and batch ownership check', async () => {
    const { request, createdTokens } = buildHarness();
    await request('https://ai-interview-88r.pages.dev/api/resumes/business-screening/push', {
      method: 'POST',
      headers: { Authorization: 'Bearer hr-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ['resume-1'] }),
    });
    const [firstToken] = createdTokens;

    // 批次内简历：200 + PDF 字节 + attachment 文件名
    const ok = await request(`https://ai-interview-88r.pages.dev/api/public/business-screening/${firstToken.token}/resumes/resume-1/file`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('Content-Type')).toContain('application/pdf');
    expect(ok.headers.get('Content-Disposition')).toContain('attachment');
    const bytes = await ok.arrayBuffer();
    expect(new Uint8Array(bytes).slice(0, 4)).toEqual(new Uint8Array([0x25, 0x50, 0x44, 0x46]));

    // 非批次内简历：404
    const missing = await request(`https://ai-interview-88r.pages.dev/api/public/business-screening/${firstToken.token}/resumes/resume-999/file`);
    expect(missing.status).toBe(404);
  });

  it('blocks expired or revoked public links', async () => {
    const { request } = buildHarness({
      initialBatches: [{
        id: 'batch-expired',
        interviewer_id: 'user-zhang',
        interviewer_name: '张三',
        interviewer_open_id: 'ou_zhang',
        token_hash: 'hash-expired',
        expires_at: '2026-08-01T00:00:00.000Z',
        status: 'active',
        created_by: 'hr@example.com',
        created_at: '2026-08-01T00:00:00.000Z',
        last_sent_at: null,
        rawToken: 'expired-token',
      }],
      initialItems: [{
        id: 'item-expired',
        batch_id: 'batch-expired',
        resume_id: 'resume-1',
        position_id: 'position-1',
        status: 'pending',
        remark: null,
        processed_at: null,
        created_at: '2026-08-01T00:00:00.000Z',
        candidate_name: '候选人甲',
      }],
    });

    const response = await request('https://ai-interview-88r.pages.dev/api/public/business-screening/expired-token');

    expect(response.status).toBe(410);
  });

  it('records public approve callbacks and keeps duplicate callbacks idempotent', async () => {
    const { request, resumes } = buildHarness({
      resumes: [{
        id: 'resume-1',
        candidate_name: '候选人甲',
        email: 'jia@example.com',
        contact: '13800000000',
        screening_result: '通过',
        status: 'pending_review',
        stage: 'screening',
        hr_disposition: 'pushed',
        mapped_position: '标准运营',
        position_applied: '标准运营',
        business_screening_status: 'pending',
        business_screening_batch_id: 'batch-approve',
      }],
      initialBatches: [{
        id: 'batch-approve',
        interviewer_id: 'user-zhang',
        interviewer_name: '张三',
        interviewer_open_id: 'ou_zhang',
        token_hash: 'hash-approve',
        expires_at: '2026-08-19T00:00:00.000Z',
        status: 'active',
        created_by: 'hr@example.com',
        created_at: '2026-08-12T00:00:00.000Z',
        last_sent_at: '2026-08-12T00:00:00.000Z',
        rawToken: 'approve-token',
      }],
      initialItems: [{
        id: 'item-approve',
        batch_id: 'batch-approve',
        resume_id: 'resume-1',
        position_id: 'position-1',
        status: 'pending',
        remark: null,
        processed_at: null,
        created_at: '2026-08-12T00:00:00.000Z',
        candidate_name: '候选人甲',
        mapped_position: '标准运营',
        hr_disposition: 'pushed',
        business_screening_status: 'pending',
      }],
    });

    const first = await request('https://ai-interview-88r.pages.dev/api/public/business-screening/approve-token/resumes/resume-1/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ remark: '建议入库' }),
    });
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({
      ok: true,
      status: 'passed',
      idempotent: false,
    });
    expect(resumes.get('resume-1')).toMatchObject({
      business_screening_status: 'passed',
      status: 'approved',
      stage: 'talent_pool',
    });

    const duplicate = await request('https://ai-interview-88r.pages.dev/api/public/business-screening/approve-token/resumes/resume-1/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ remark: '重复点击' }),
    });
    expect(duplicate.status).toBe(200);
    await expect(duplicate.json()).resolves.toMatchObject({
      ok: true,
      status: 'passed',
      idempotent: true,
    });
    expect(resumes.get('resume-1')).toMatchObject({
      business_screening_status: 'passed',
      status: 'approved',
      stage: 'talent_pool',
    });
  });

  it('batch approves every pending item in the batch and completes it', async () => {
    const { request, resumes, batches } = buildHarness({
      resumes: ['resume-b1', 'resume-b2', 'resume-b3'].map((id) => ({
        id,
        candidate_name: `候选人${id}`,
        email: `${id}@example.com`,
        screening_result: '通过',
        status: 'pending_review',
        hr_disposition: 'pushed',
        mapped_position: '标准运营',
        position_applied: '标准运营',
        business_screening_status: 'pending',
        business_screening_batch_id: 'batch-batch-approve',
      })),
      initialBatches: [{
        id: 'batch-batch-approve',
        interviewer_id: 'user-zhang',
        interviewer_name: '张三',
        interviewer_open_id: 'ou_zhang',
        token_hash: 'hash-batch-approve',
        expires_at: '2026-08-19T00:00:00.000Z',
        status: 'active',
        created_by: 'hr@example.com',
        created_at: '2026-08-12T00:00:00.000Z',
        last_sent_at: '2026-08-12T00:00:00.000Z',
        rawToken: 'batch-approve-token',
      }],
      initialItems: ['resume-b1', 'resume-b2', 'resume-b3'].map((resumeId, index) => ({
        id: `item-batch-approve-${index}`,
        batch_id: 'batch-batch-approve',
        resume_id: resumeId,
        position_id: 'position-1',
        status: 'pending',
        remark: null,
        processed_at: null,
        created_at: '2026-08-12T00:00:00.000Z',
        candidate_name: `候选人${resumeId}`,
        mapped_position: '标准运营',
        hr_disposition: 'pushed',
        business_screening_status: 'pending',
      })),
    });

    const response = await request('https://ai-interview-88r.pages.dev/api/public/business-screening/batch-approve-token/batch/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      status: 'passed',
      applied: 3,
      skipped: 0,
      failed: 0,
      pending: 3,
    });
    for (const id of ['resume-b1', 'resume-b2', 'resume-b3']) {
      expect(resumes.get(id)).toMatchObject({
        business_screening_status: 'passed',
        status: 'approved',
        stage: 'talent_pool',
      });
    }
    expect(batches.get('batch-batch-approve')?.status).toBe('completed');
  });

  it('batch rejects pending items and skips already-decided ones', async () => {
    const { request, resumes, batches } = buildHarness({
      resumes: ['resume-r1', 'resume-r2'].map((id) => ({
        id,
        candidate_name: `候选人${id}`,
        screening_result: '通过',
        status: 'pending_review',
        hr_disposition: 'pushed',
        mapped_position: '标准运营',
        position_applied: '标准运营',
        business_screening_status: 'pending',
        business_screening_batch_id: 'batch-batch-reject',
      })),
      initialBatches: [{
        id: 'batch-batch-reject',
        interviewer_id: 'user-zhang',
        interviewer_name: '张三',
        interviewer_open_id: 'ou_zhang',
        token_hash: 'hash-batch-reject',
        expires_at: '2026-08-19T00:00:00.000Z',
        status: 'active',
        created_by: 'hr@example.com',
        created_at: '2026-08-12T00:00:00.000Z',
        last_sent_at: '2026-08-12T00:00:00.000Z',
        rawToken: 'batch-reject-token',
      }],
      initialItems: [
        ...['resume-r1', 'resume-r2'].map((resumeId, index) => ({
          id: `item-batch-reject-${index}`,
          batch_id: 'batch-batch-reject',
          resume_id: resumeId,
          position_id: 'position-1',
          status: 'pending' as const,
          remark: null,
          processed_at: null,
          created_at: '2026-08-12T00:00:00.000Z',
          candidate_name: `候选人${resumeId}`,
          mapped_position: '标准运营',
          hr_disposition: 'pushed',
          business_screening_status: 'pending',
        })),
        {
          id: 'item-batch-reject-done',
          batch_id: 'batch-batch-reject',
          resume_id: 'resume-r3',
          position_id: 'position-1',
          status: 'passed' as const,
          remark: '已通过',
          processed_at: '2026-08-12T12:00:00.000Z',
          created_at: '2026-08-12T00:00:00.000Z',
          candidate_name: '候选人resume-r3',
          mapped_position: '标准运营',
          hr_disposition: 'pushed',
          business_screening_status: 'passed',
        },
      ],
    });

    const response = await request('https://ai-interview-88r.pages.dev/api/public/business-screening/batch-reject-token/batch/reject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      status: 'rejected',
      applied: 2,
      skipped: 0,
      failed: 0,
      pending: 2,
    });
    for (const id of ['resume-r1', 'resume-r2']) {
      expect(resumes.get(id)).toMatchObject({
        business_screening_status: 'rejected',
        status: 'rejected',
        stage: 'rejected',
      });
    }
    expect(batches.get('batch-batch-reject')?.status).toBe('completed');
  });

  it('batch actions honor the selected resumeIds subset (select all then deselect)', async () => {
    const { request, resumes, batches } = buildHarness({
      resumes: ['resume-s1', 'resume-s2', 'resume-s3'].map((id) => ({
        id,
        candidate_name: `候选人${id}`,
        screening_result: '通过',
        status: 'pending_review',
        hr_disposition: 'pushed',
        mapped_position: '标准运营',
        position_applied: '标准运营',
        business_screening_status: 'pending',
        business_screening_batch_id: 'batch-batch-select',
      })),
      initialBatches: [{
        id: 'batch-batch-select',
        interviewer_id: 'user-zhang',
        interviewer_name: '张三',
        interviewer_open_id: 'ou_zhang',
        token_hash: 'hash-batch-select',
        expires_at: '2026-08-19T00:00:00.000Z',
        status: 'active',
        created_by: 'hr@example.com',
        created_at: '2026-08-12T00:00:00.000Z',
        last_sent_at: '2026-08-12T00:00:00.000Z',
        rawToken: 'batch-select-token',
      }],
      initialItems: ['resume-s1', 'resume-s2', 'resume-s3'].map((resumeId, index) => ({
        id: `item-batch-select-${index}`,
        batch_id: 'batch-batch-select',
        resume_id: resumeId,
        position_id: 'position-1',
        status: 'pending',
        remark: null,
        processed_at: null,
        created_at: '2026-08-12T00:00:00.000Z',
        candidate_name: `候选人${resumeId}`,
        mapped_position: '标准运营',
        hr_disposition: 'pushed',
        business_screening_status: 'pending',
      })),
    });

    // 全选后取消 resume-s2，只批量处理选中项（含不在批次内的 id 会被忽略）
    const response = await request('https://ai-interview-88r.pages.dev/api/public/business-screening/batch-select-token/batch/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resumeIds: ['resume-s1', 'resume-s3', 'resume-not-in-batch'] }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      status: 'passed',
      applied: 2,
      skipped: 0,
      failed: 0,
      pending: 2,
    });
    expect(resumes.get('resume-s1')).toMatchObject({ business_screening_status: 'passed', status: 'approved', stage: 'talent_pool' });
    expect(resumes.get('resume-s3')).toMatchObject({ business_screening_status: 'passed', status: 'approved', stage: 'talent_pool' });
    // 被取消勾选的候选人保持待处理
    expect(resumes.get('resume-s2')).toMatchObject({ business_screening_status: 'pending', status: 'pending_review' });
    // 批次内仍有待处理项，不置为 completed
    expect(batches.get('batch-batch-select')?.status).toBe('active');
  });

  it('rejects batch actions for unknown or expired tokens', async () => {
    const { request } = buildHarness({
      initialBatches: [{
        id: 'batch-expired',
        interviewer_id: 'user-zhang',
        interviewer_name: '张三',
        interviewer_open_id: 'ou_zhang',
        token_hash: 'hash-expired',
        expires_at: '2026-08-01T00:00:00.000Z',
        status: 'active',
        created_by: 'hr@example.com',
        created_at: '2026-08-01T00:00:00.000Z',
        last_sent_at: null,
        rawToken: 'expired-token',
      }],
      initialItems: [{
        id: 'item-expired',
        batch_id: 'batch-expired',
        resume_id: 'resume-1',
        position_id: 'position-1',
        status: 'pending',
        remark: null,
        processed_at: null,
        created_at: '2026-08-01T00:00:00.000Z',
        candidate_name: '候选人甲',
      }],
    });

    const notFound = await request('https://ai-interview-88r.pages.dev/api/public/business-screening/unknown-token/batch/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(notFound.status).toBe(404);

    const expired = await request('https://ai-interview-88r.pages.dev/api/public/business-screening/expired-token/batch/reject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(expired.status).toBe(410);
  });

  it('shares one dispatch group across responsible-person batches in the same push and isolates decisions', async () => {
    const { request, createdTokens, resumes, batchItems, batches } = buildHarness({
      positions: [
        { id: 'position-1', title: '标准运营', primary_interviewer: '张三', secondary_interviewer: '李四', responsible_person: '张三' },
        { id: 'position-2', title: '销售', primary_interviewer: '李四', secondary_interviewer: '', responsible_person: '李四' },
      ],
      resumes: [
        {
          id: 'resume-1',
          candidate_name: '候选人甲',
          screening_result: '通过',
          status: 'pending_review',
          hr_disposition: 'pending',
          mapped_position: '标准运营',
          position_applied: '标准运营',
          business_screening_status: 'not_ready',
        },
        {
          id: 'resume-2',
          candidate_name: '候选人乙',
          screening_result: '通过',
          status: 'pending_review',
          hr_disposition: 'pending',
          mapped_position: '销售',
          position_applied: '销售',
          business_screening_status: 'not_ready',
        },
      ],
    });

    const pushResponse = await request('https://ai-interview-88r.pages.dev/api/resumes/business-screening/push', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer hr-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ids: ['resume-1', 'resume-2'] }),
    });
    expect(pushResponse.status).toBe(200);
    expect(createdTokens).toHaveLength(2);
    const dispatchGroups = new Set([...batches.values()].map((batch) => batch.dispatch_group_id));
    expect(dispatchGroups.size).toBe(1);

    const firstDecision = await request(`https://ai-interview-88r.pages.dev/api/public/business-screening/${createdTokens[0].token}/resumes/resume-1/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ remark: '张三建议入库' }),
    });

    expect(firstDecision.status).toBe(200);
    await expect(firstDecision.json()).resolves.toMatchObject({
      ok: true,
      status: 'passed',
      idempotent: false,
    });
    expect(resumes.get('resume-1')).toMatchObject({
      business_screening_status: 'passed',
      status: 'approved',
      stage: 'talent_pool',
    });

    const wrongBatchDecision = await request(`https://ai-interview-88r.pages.dev/api/public/business-screening/${createdTokens[0].token}/resumes/resume-2/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ remark: '不属于本批次' }),
    });
    expect(wrongBatchDecision.status).toBe(404);

    const siblingDecision = await request(`https://ai-interview-88r.pages.dev/api/public/business-screening/${createdTokens[1].token}/resumes/resume-1/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ remark: '李四试图改判他人简历' }),
    });

    expect(siblingDecision.status).toBe(404);
    expect(resumes.get('resume-1')).toMatchObject({
      business_screening_status: 'passed',
      status: 'approved',
      stage: 'talent_pool',
      business_screening_remark: '张三建议入库',
    });
    expect(batchItems.filter((item) => item.resume_id === 'resume-1')).toEqual([
      expect.objectContaining({ status: 'passed' }),
    ]);
  });

  it('maps raw resume positions to standard positions via position_mappings before pushing', async () => {
    const { request, sentMessages, resumes } = buildHarness({
      positionMappings: [
        { raw_name: 'IoT产品经理（双休｜入职五险一金）', mapped_name: '标准运营' },
      ],
      resumes: [{
        id: 'resume-1',
        candidate_name: '候选人甲',
        screening_result: '通过',
        status: 'pending_review',
        hr_disposition: 'pending',
        mapped_position: 'IoT产品经理（双休｜入职五险一金）',
        position_applied: 'IoT产品经理（双休｜入职五险一金）',
        business_screening_status: 'not_ready',
      }],
    });

    const response = await request('https://ai-interview-88r.pages.dev/api/resumes/business-screening/push', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer hr-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ids: ['resume-1'] }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      pushed: ['resume-1'],
      skipped: [],
      failed: [],
      batches: [{ interviewer: '张三' }],
    });
    expect(sentMessages).toHaveLength(1);
    expect(resumes.get('resume-1')).toMatchObject({
      hr_disposition: 'pushed',
      business_screening_status: 'pending',
    });
  });

  it('skips resumes whose raw position has no mapping and no matching position title', async () => {
    const { request, sentMessages } = buildHarness({
      resumes: [{
        id: 'resume-1',
        candidate_name: '候选人甲',
        screening_result: '通过',
        status: 'pending_review',
        hr_disposition: 'pending',
        mapped_position: '未知岗位XYZ',
        position_applied: '未知岗位XYZ',
        business_screening_status: 'not_ready',
      }],
    });

    const response = await request('https://ai-interview-88r.pages.dev/api/resumes/business-screening/push', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer hr-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ids: ['resume-1'] }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      pushed: [],
      skipped: [{ id: 'resume-1', reason: '缺少标准岗位' }],
      failed: [],
      batches: [],
    });
    expect(sentMessages).toHaveLength(0);
  });

  it('rejects the opposite public callback after a completion has already been recorded', async () => {
    const { request, resumes } = buildHarness({
      initialBatches: [{
        id: 'batch-opposite',
        interviewer_id: 'user-zhang',
        interviewer_name: '张三',
        interviewer_open_id: 'ou_zhang',
        token_hash: 'hash-opposite',
        expires_at: '2026-08-19T00:00:00.000Z',
        status: 'active',
        created_by: 'hr@example.com',
        created_at: '2026-08-12T00:00:00.000Z',
        last_sent_at: '2026-08-12T00:00:00.000Z',
        rawToken: 'opposite-token',
      }],
      initialItems: [{
        id: 'item-opposite',
        batch_id: 'batch-opposite',
        resume_id: 'resume-1',
        position_id: 'position-1',
        status: 'passed',
        remark: '已入库',
        processed_at: '2026-08-12T01:00:00.000Z',
        created_at: '2026-08-12T00:00:00.000Z',
        candidate_name: '候选人甲',
        mapped_position: '标准运营',
        hr_disposition: 'pushed',
        business_screening_status: 'passed',
      }],
      resumes: [{
        id: 'resume-1',
        candidate_name: '候选人甲',
        screening_result: '通过',
        status: 'approved',
        stage: 'talent_pool',
        hr_disposition: 'pushed',
        mapped_position: '标准运营',
        position_applied: '标准运营',
        business_screening_status: 'passed',
        business_screening_batch_id: 'batch-opposite',
      }],
    });

    const response = await request('https://ai-interview-88r.pages.dev/api/public/business-screening/opposite-token/resumes/resume-1/reject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ remark: '反向改判' }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      detail: expect.stringContaining('already'),
    });
    expect(resumes.get('resume-1')).toMatchObject({
      business_screening_status: 'passed',
      status: 'approved',
      stage: 'talent_pool',
    });
  });

  it('rejects callbacks from a revoked older batch and leaves all state untouched', async () => {
    const { request, resumes, batchItems } = buildHarness({
      initialBatches: [
        {
          id: 'batch-a',
          interviewer_id: 'user-zhang',
          interviewer_name: '张三',
          interviewer_open_id: 'ou_zhang',
          token_hash: 'hash-a',
          expires_at: '2026-08-19T00:00:00.000Z',
          status: 'revoked',
          created_by: 'hr@example.com',
          created_at: '2026-08-12T00:00:00.000Z',
          last_sent_at: '2026-08-12T00:00:00.000Z',
          rawToken: 'token-a',
        },
        {
          id: 'batch-b',
          interviewer_id: 'user-zhang',
          interviewer_name: '张三',
          interviewer_open_id: 'ou_zhang',
          token_hash: 'hash-b',
          expires_at: '2026-08-19T00:00:00.000Z',
          status: 'active',
          created_by: 'hr@example.com',
          created_at: '2026-08-12T01:00:00.000Z',
          last_sent_at: '2026-08-12T01:00:00.000Z',
          rawToken: 'token-b',
        },
      ],
      initialItems: [
        {
          id: 'item-a',
          batch_id: 'batch-a',
          resume_id: 'resume-1',
          position_id: 'position-1',
          status: 'pending',
          remark: null,
          processed_at: null,
          created_at: '2026-08-12T00:00:00.000Z',
          candidate_name: '候选人甲',
          mapped_position: '标准运营',
          hr_disposition: 'pushed',
          business_screening_status: 'pending',
        },
        {
          id: 'item-b',
          batch_id: 'batch-b',
          resume_id: 'resume-1',
          position_id: 'position-1',
          status: 'pending',
          remark: null,
          processed_at: null,
          created_at: '2026-08-12T01:00:00.000Z',
          candidate_name: '候选人甲',
          mapped_position: '标准运营',
          hr_disposition: 'pushed',
          business_screening_status: 'pending',
        },
      ],
      resumes: [{
        id: 'resume-1',
        candidate_name: '候选人甲',
        screening_result: '通过',
        status: 'pending_review',
        stage: 'screening',
        hr_disposition: 'pushed',
        mapped_position: '标准运营',
        position_applied: '标准运营',
        business_screening_status: 'pending',
        business_screening_batch_id: 'batch-b',
      }],
    });

    const staleApprove = await request('https://ai-interview-88r.pages.dev/api/public/business-screening/token-a/resumes/resume-1/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ remark: '建议入库' }),
    });

    expect(staleApprove.status).toBe(410);
    await expect(staleApprove.json()).resolves.toMatchObject({
      detail: 'Link unavailable',
    });
    expect(resumes.get('resume-1')).toMatchObject({
      business_screening_status: 'pending',
      business_screening_batch_id: 'batch-b',
      status: 'pending_review',
      stage: 'screening',
    });
    expect(resumes.get('resume-1')).not.toHaveProperty('business_screening_remark');
    expect(resumes.get('resume-1')).not.toHaveProperty('business_screened_by');
    expect(resumes.get('resume-1')).not.toHaveProperty('business_screened_at');
    expect(batchItems.find((item) => item.id === 'item-a')).toMatchObject({
      status: 'pending',
      remark: null,
      processed_at: null,
    });
    expect(batchItems.find((item) => item.id === 'item-b')).toMatchObject({
      status: 'pending',
      remark: null,
      processed_at: null,
    });
  });

  it('conflicts active stale old-group callbacks and leaves resume plus items untouched', async () => {
    const { request, resumes, batchItems } = buildHarness({
      initialBatches: [
        {
          id: 'batch-old-active',
          interviewer_id: 'user-zhang',
          interviewer_name: '张三',
          interviewer_open_id: 'ou_zhang',
          token_hash: 'hash-old-active',
          expires_at: '2026-08-19T00:00:00.000Z',
          status: 'active',
          created_by: 'hr@example.com',
          created_at: '2026-08-12T00:00:00.000Z',
          last_sent_at: '2026-08-12T00:00:00.000Z',
          dispatch_group_id: 'dispatch-old',
          rawToken: 'old-active-token',
        },
        {
          id: 'batch-current',
          interviewer_id: 'user-li',
          interviewer_name: '李四',
          interviewer_open_id: 'ou_li',
          token_hash: 'hash-current',
          expires_at: '2026-08-19T01:00:00.000Z',
          status: 'active',
          created_by: 'hr@example.com',
          created_at: '2026-08-12T01:00:00.000Z',
          last_sent_at: '2026-08-12T01:00:00.000Z',
          dispatch_group_id: 'dispatch-current',
          rawToken: 'current-token',
        },
      ],
      initialItems: [
        {
          id: 'item-old-active',
          batch_id: 'batch-old-active',
          resume_id: 'resume-1',
          position_id: 'position-1',
          status: 'pending',
          remark: null,
          processed_at: null,
          created_at: '2026-08-12T00:00:00.000Z',
          dispatch_group_id: 'dispatch-old',
          candidate_name: '候选人甲',
          mapped_position: '标准运营',
          hr_disposition: 'pushed',
          business_screening_status: 'pending',
        },
        {
          id: 'item-current',
          batch_id: 'batch-current',
          resume_id: 'resume-1',
          position_id: 'position-1',
          status: 'pending',
          remark: null,
          processed_at: null,
          created_at: '2026-08-12T01:00:00.000Z',
          dispatch_group_id: 'dispatch-current',
          candidate_name: '候选人甲',
          mapped_position: '标准运营',
          hr_disposition: 'pushed',
          business_screening_status: 'pending',
        },
      ],
      resumes: [{
        id: 'resume-1',
        candidate_name: '候选人甲',
        screening_result: '通过',
        status: 'pending_review',
        stage: 'screening',
        hr_disposition: 'pushed',
        mapped_position: '标准运营',
        position_applied: '标准运营',
        business_screening_status: 'pending',
        business_screening_batch_id: 'batch-current',
        business_screening_dispatch_group_id: 'dispatch-current',
      }],
    });

    const response = await request('https://ai-interview-88r.pages.dev/api/public/business-screening/old-active-token/resumes/resume-1/reject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ remark: '旧活跃批次不应生效' }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      detail: 'business screening dispatch group changed',
    });
    expect(resumes.get('resume-1')).toMatchObject({
      business_screening_status: 'pending',
      business_screening_batch_id: 'batch-current',
      business_screening_dispatch_group_id: 'dispatch-current',
      status: 'pending_review',
      stage: 'screening',
    });
    expect(batchItems.find((item) => item.id === 'item-old-active')).toMatchObject({
      status: 'pending',
      remark: null,
      processed_at: null,
      dispatch_group_id: 'dispatch-old',
    });
    expect(batchItems.find((item) => item.id === 'item-current')).toMatchObject({
      status: 'pending',
      remark: null,
      processed_at: null,
      dispatch_group_id: 'dispatch-current',
    });
  });

  it('keeps public errors generic and free of unrelated ids', async () => {
    const { request } = buildHarness({
      initialBatches: [{
        id: 'batch-generic',
        interviewer_id: 'user-zhang',
        interviewer_name: '张三',
        interviewer_open_id: 'ou_zhang',
        token_hash: 'hash-generic',
        expires_at: '2026-08-19T00:00:00.000Z',
        status: 'active',
        created_by: 'hr@example.com',
        created_at: '2026-08-12T00:00:00.000Z',
        last_sent_at: '2026-08-12T00:00:00.000Z',
        rawToken: 'generic-token',
      }],
      initialItems: [{
        id: 'item-generic',
        batch_id: 'batch-generic',
        resume_id: 'resume-1',
        position_id: 'position-1',
        status: 'pending',
        remark: null,
        processed_at: null,
        created_at: '2026-08-12T00:00:00.000Z',
        candidate_name: '候选人甲',
      }],
    });

    const response = await request('https://ai-interview-88r.pages.dev/api/public/business-screening/generic-token/resumes/resume-404/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ remark: '伪造简历 id' }),
    });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.detail).not.toContain('resume-404');
    expect(body.detail).not.toContain('generic-token');
    expect(body.detail).not.toContain('ou_zhang');
  });

  it('records public reject callbacks as terminal rejected resumes while preserving business rejection state', async () => {
    const { request, resumes } = buildHarness({
      initialBatches: [{
        id: 'batch-reject',
        interviewer_id: 'user-zhang',
        interviewer_name: '张三',
        interviewer_open_id: 'ou_zhang',
        token_hash: 'hash-reject',
        expires_at: '2026-08-19T00:00:00.000Z',
        status: 'active',
        created_by: 'hr@example.com',
        created_at: '2026-08-12T00:00:00.000Z',
        last_sent_at: '2026-08-12T00:00:00.000Z',
        rawToken: 'reject-token',
      }],
      initialItems: [{
        id: 'item-reject',
        batch_id: 'batch-reject',
        resume_id: 'resume-1',
        position_id: 'position-1',
        status: 'pending',
        remark: null,
        processed_at: null,
        created_at: '2026-08-12T00:00:00.000Z',
        candidate_name: '候选人甲',
        mapped_position: '标准运营',
        hr_disposition: 'pushed',
        business_screening_status: 'pending',
      }],
      resumes: [{
        id: 'resume-1',
        candidate_name: '候选人甲',
        screening_result: '通过',
        status: 'pending_review',
        stage: 'screening',
        hr_disposition: 'pushed',
        mapped_position: '标准运营',
        position_applied: '标准运营',
        business_screening_status: 'pending',
        business_screening_batch_id: 'batch-reject',
      }],
    });

    const response = await request('https://ai-interview-88r.pages.dev/api/public/business-screening/reject-token/resumes/resume-1/reject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ remark: '不入库' }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      status: 'rejected',
      idempotent: false,
    });
    expect(resumes.get('resume-1')).toMatchObject({
      business_screening_status: 'rejected',
      status: 'rejected',
      stage: 'rejected',
    });
  });

  it('reissues only the selected batch on resend and revokes the old link', async () => {
    const { request, batches, batchItems, sentMessages, createdTokens, resumes } = buildHarness({
      initialBatches: [{
        id: 'batch-old',
        interviewer_id: 'user-zhang',
        interviewer_name: '张三',
        interviewer_open_id: 'ou_zhang',
        token_hash: 'hash-old',
        expires_at: '2026-08-19T00:00:00.000Z',
        status: 'active',
        created_by: 'hr@example.com',
        created_at: '2026-08-12T00:00:00.000Z',
        last_sent_at: '2026-08-12T00:00:00.000Z',
        rawToken: 'old-token',
      }],
      initialItems: [
        {
          id: 'item-pending',
          batch_id: 'batch-old',
          resume_id: 'resume-1',
          position_id: 'position-1',
          status: 'pending',
          remark: null,
          processed_at: null,
          created_at: '2026-08-12T00:00:00.000Z',
          candidate_name: '候选人甲',
          mapped_position: '标准运营',
          hr_disposition: 'pushed',
          business_screening_status: 'pending',
        },
        {
          id: 'item-complete',
          batch_id: 'batch-old',
          resume_id: 'resume-2',
          position_id: 'position-1',
          status: 'passed',
          remark: '已入库',
          processed_at: '2026-08-12T01:00:00.000Z',
          created_at: '2026-08-12T00:00:00.000Z',
          candidate_name: '候选人乙',
          mapped_position: '标准运营',
          hr_disposition: 'pushed',
          business_screening_status: 'passed',
        },
      ],
      resumes: [
        {
          id: 'resume-1',
          candidate_name: '候选人甲',
          screening_result: '通过',
          status: 'pending_review',
          hr_disposition: 'pushed',
          mapped_position: '标准运营',
          position_applied: '标准运营',
          business_screening_status: 'pending',
          business_screening_batch_id: 'batch-old',
        },
        {
          id: 'resume-2',
          candidate_name: '候选人乙',
          screening_result: '通过',
          status: 'pending_review',
          hr_disposition: 'pushed',
          mapped_position: '标准运营',
          position_applied: '标准运营',
          business_screening_status: 'passed',
          business_screening_batch_id: 'batch-old',
        },
      ],
    });

    const response = await request('https://ai-interview-88r.pages.dev/api/resumes/business-screening/batches/batch-old/resend', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer hr-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      ok: true,
      resentFromBatchId: 'batch-old',
      itemCount: 1,
    });
    expect(body.url).toMatch(/^https:\/\/ai-interview-88r\.pages\.dev\/business-screening\//);
    expect(body.url).not.toContain('/api/public/business-screening/');
    expect(batches.get('batch-old')?.status).toBe('revoked');
    expect([...batches.values()].some((batch) => batch.id !== 'batch-old' && batch.status === 'active')).toBe(true);
    expect(batchItems.filter((item) => item.batch_id !== 'batch-old')).toHaveLength(1);
    expect(sentMessages).toHaveLength(1);
    expect(createdTokens).toHaveLength(1);

    const newLinkDecision = await request(`https://ai-interview-88r.pages.dev/api/public/business-screening/${createdTokens[0].token}/resumes/resume-1/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ remark: '重发后入库' }),
    });

    expect(newLinkDecision.status).toBe(200);
    await expect(newLinkDecision.json()).resolves.toMatchObject({
      ok: true,
      status: 'passed',
      idempotent: false,
    });
    expect(resumes.get('resume-1')).toMatchObject({
      business_screening_status: 'passed',
      status: 'approved',
      stage: 'talent_pool',
      business_screening_remark: '重发后入库',
    });

    const staleDecision = await request('https://ai-interview-88r.pages.dev/api/public/business-screening/old-token/resumes/resume-1/reject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ remark: '过期链接不应生效' }),
    });

    expect(staleDecision.status).toBe(410);
    expect(resumes.get('resume-1')).toMatchObject({
      business_screening_status: 'passed',
      status: 'approved',
      stage: 'talent_pool',
      business_screening_remark: '重发后入库',
    });
  });

  it('picks the same-name resume with a profile when pushing a profile-missing candidate', async () => {
    const { request, batches, createdTokens } = buildHarness({
      resumes: [
        {
          id: 'resume-meina-no-profile',
          candidate_name: '王美娜',
          email: 'meina@example.com',
          contact: '13800000000',
          screening_result: '通过',
          status: 'pending_review',
          stage: 'screening',
          hr_disposition: 'pending',
          mapped_position: '标准运营',
          position_applied: '标准运营',
          business_screening_status: 'not_ready',
          business_screening_batch_id: '',
          business_screening_dispatch_group_id: '',
          ocr_markdown: '# 王美娜 简历原文内容',
          ai_review: '{"match_score":3.6}',
          // 无 parsed_data / education / work_experience —— 模拟仅初筛未解析
        },
        {
          id: 'resume-meina-with-profile',
          candidate_name: '王美娜',
          email: 'meina2@example.com',
          contact: '13811111111',
          screening_result: '通过',
          status: 'pending_review',
          stage: 'screening',
          hr_disposition: 'pending',
          mapped_position: '标准运营',
          position_applied: '标准运营',
          business_screening_status: 'not_ready',
          business_screening_batch_id: '',
          business_screening_dispatch_group_id: '',
          parsed_data: JSON.stringify({
            highest_degree: '本科',
            school: '长沙大学',
            major: '信息管理',
            years_of_experience: 10,
            recent_company: '小米科技',
            current_position: '高级产品经理',
            gender: '女',
            skills: ['Axure', 'RAG'],
          }),
        },
      ],
    });

    const pushResp = await request('https://ai-interview-88r.pages.dev/api/resumes/business-screening/push', {
      method: 'POST',
      headers: { Authorization: 'Bearer hr-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ['resume-meina-no-profile'] }),
    });
    expect(pushResp.status).toBe(200);
    const pushBody = await pushResp.json() as any;
    // 推送结果应指向有档案的那条（resume-meina-with-profile），且批次成员为有档案记录
    expect(pushBody.pushed).toEqual(['resume-meina-with-profile']);

    const publicResp = await request(`https://ai-interview-88r.pages.dev/api/public/business-screening/${createdTokens[0].token}`, {
      method: 'GET',
    });
    expect(publicResp.status).toBe(200);
    const publicBody = await publicResp.json() as any;
    expect(publicBody.resumes).toHaveLength(1);
    expect(publicBody.resumes[0].id).toBe('resume-meina-with-profile');
    expect(publicBody.resumes[0].profile).toMatchObject({
      highestDegree: '本科',
      school: '长沙大学',
      gender: '女',
    });
  });

  it('keeps profile-missing candidate when no same-name profile exists', async () => {
    const { request, createdTokens } = buildHarness({
      resumes: [
        {
          id: 'resume-solo-no-profile',
          candidate_name: '李四',
          email: 'li@example.com',
          contact: '13900000000',
          screening_result: '通过',
          status: 'pending_review',
          stage: 'screening',
          hr_disposition: 'pending',
          mapped_position: '标准运营',
          position_applied: '标准运营',
          business_screening_status: 'not_ready',
          business_screening_batch_id: '',
          business_screening_dispatch_group_id: '',
          ocr_markdown: '# 李四 简历原文',
          ai_review: '{"match_score":4.0}',
        },
      ],
    });

    const pushResp = await request('https://ai-interview-88r.pages.dev/api/resumes/business-screening/push', {
      method: 'POST',
      headers: { Authorization: 'Bearer hr-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ['resume-solo-no-profile'] }),
    });
    expect(pushResp.status).toBe(200);
    const pushBody = await pushResp.json() as any;
    expect(pushBody.pushed).toEqual(['resume-solo-no-profile']);

    const publicResp = await request(`https://ai-interview-88r.pages.dev/api/public/business-screening/${createdTokens[0].token}`, {
      method: 'GET',
    });
    const publicBody = await publicResp.json() as any;
    expect(publicBody.resumes[0].profile).toBeUndefined();
  });

  it('reuses the same link for the same interviewer across positions and pushes', async () => {
    const { request, batches, batchItems } = buildHarness({
      positions: [
        { id: 'position-1', title: '标准运营', primary_interviewer: '张三', secondary_interviewer: '李四', responsible_person: '张三' },
        { id: 'position-2', title: '硬件工程师', primary_interviewer: '张三', secondary_interviewer: '李四', responsible_person: '张三' },
      ],
      resumes: [
        {
          id: 'resume-a1',
          candidate_name: '甲',
          screening_result: '通过',
          status: 'pending_review',
          stage: 'screening',
          hr_disposition: 'pending',
          mapped_position: '标准运营',
          position_applied: '标准运营',
          business_screening_status: 'not_ready',
        },
        {
          id: 'resume-a2',
          candidate_name: '乙',
          screening_result: '通过',
          status: 'pending_review',
          stage: 'screening',
          hr_disposition: 'pending',
          mapped_position: '标准运营',
          position_applied: '标准运营',
          business_screening_status: 'not_ready',
        },
        {
          id: 'resume-b1',
          candidate_name: '丙',
          screening_result: '通过',
          status: 'pending_review',
          stage: 'screening',
          hr_disposition: 'pending',
          mapped_position: '硬件工程师',
          position_applied: '硬件工程师',
          business_screening_status: 'not_ready',
        },
      ],
    });
    const push = (ids: string[]) => request('https://ai-interview-88r.pages.dev/api/resumes/business-screening/push', {
      method: 'POST',
      headers: { Authorization: 'Bearer hr-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });

    // 首次推送：生成链接
    const first = await push(['resume-a1']);
    expect(first.status).toBe(200);
    const firstBody = await first.json() as any;
    expect(firstBody.batches).toHaveLength(1);
    const firstUrl = firstBody.batches[0].url;

    // 同一面试官再次推送（同一岗位）：链接完全不变，简历追加到同一批次
    const second = await push(['resume-a2']);
    expect(second.status).toBe(200);
    const secondBody = await second.json() as any;
    expect(secondBody.batches[0].url).toBe(firstUrl);
    expect(batches.size).toBe(1);
    expect(batchItems.filter((item) => item.resume_id === 'resume-a1' || item.resume_id === 'resume-a2')).toHaveLength(2);

    // 公开链接可见两份简历
    const publicResp = await request(firstUrl.replace('https://ai-interview-88r.pages.dev/business-screening/', 'https://ai-interview-88r.pages.dev/api/public/business-screening/'), { method: 'GET' });
    expect(publicResp.status).toBe(200);
    const publicBody = await publicResp.json() as any;
    expect(publicBody.resumes.map((r: any) => r.id).sort()).toEqual(['resume-a1', 'resume-a2']);

    // 同一面试官收到不同岗位的简历：仍复用同一个链接，简历继续追加
    const other = await push(['resume-b1']);
    expect(other.status).toBe(200);
    const otherBody = await other.json() as any;
    expect(otherBody.batches).toHaveLength(1);
    expect(otherBody.batches[0].url).toBe(firstUrl);
    expect(batches.size).toBe(1);
    expect(batchItems.filter((item) => ['resume-a1', 'resume-a2', 'resume-b1'].includes(item.resume_id))).toHaveLength(3);

    const mergedPublicResp = await request(firstUrl.replace('https://ai-interview-88r.pages.dev/business-screening/', 'https://ai-interview-88r.pages.dev/api/public/business-screening/'), { method: 'GET' });
    expect(mergedPublicResp.status).toBe(200);
    const mergedPublicBody = await mergedPublicResp.json() as any;
    expect(mergedPublicBody.resumes.map((r: any) => r.id).sort()).toEqual(['resume-a1', 'resume-a2', 'resume-b1']);
  });

  it('reuses an expired canonical interviewer link and refreshes its expiry', async () => {
    const { request, batches, createdTokens } = buildHarness({
      initialBatches: [{
        id: 'batch-expired-canonical',
        interviewer_id: 'user-zhang',
        interviewer_name: '张三',
        interviewer_open_id: 'ou_zhang',
        token_hash: 'hash-expired-canonical',
        expires_at: '2026-08-01T12:00:00.000Z',
        status: 'expired',
        created_by: 'hr@example.com',
        created_at: '2026-08-01T00:00:00.000Z',
        last_sent_at: '2026-08-01T00:00:00.000Z',
        scope_key: 'ou_zhang',
        rawToken: 'expired-canonical-token',
      }],
    });

    const response = await request('https://ai-interview-88r.pages.dev/api/resumes/business-screening/push', {
      method: 'POST',
      headers: { Authorization: 'Bearer hr-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ['resume-1'] }),
    });

    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.batches[0].batchId).toBe('batch-expired-canonical');
    expect(body.batches[0].url).toBe('https://ai-interview-88r.pages.dev/business-screening/expired-canonical-token');
    expect(createdTokens).toHaveLength(0);
    expect(batches.get('batch-expired-canonical')).toMatchObject({
      status: 'active',
      expires_at: '2026-09-11T12:00:00.000Z',
    });
  });

  it('sends the same unified URL and total pending count on repeated reminders', async () => {
    const { request, sentMessages } = buildHarness({
      positions: [
        { id: 'position-1', title: '标准运营', responsible_person: '张三' },
        { id: 'position-2', title: '硬件工程师', responsible_person: '张三' },
      ],
      resumes: [
        {
          id: 'resume-1', candidate_name: '候选人甲', screening_result: '通过', status: 'pending_review',
          mapped_position: '标准运营', position_applied: '标准运营', business_screening_status: 'not_ready',
        },
        {
          id: 'resume-2', candidate_name: '候选人乙', screening_result: '通过', status: 'pending_review',
          mapped_position: '硬件工程师', position_applied: '硬件工程师', business_screening_status: 'not_ready',
        },
      ],
    });

    const push = (id: string) => request('https://ai-interview-88r.pages.dev/api/resumes/business-screening/push', {
      method: 'POST',
      headers: { Authorization: 'Bearer hr-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [id] }),
    });
    await push('resume-1');
    await push('resume-2');

    expect(sentMessages).toHaveLength(2);
    const cards = sentMessages.map((message) => message.card as any);
    const urls = cards.map((card) => card.elements[1].actions[0].url);
    expect(urls[1]).toBe(urls[0]);
    expect(cards[0].elements[0].text.content).toContain('1 份');
    expect(cards[1].elements[0].text.content).toContain('2 份');
    expect(cards[1].elements[0].text.content).toContain('统一汇总');
  });

  it('reuses the canonical link when an expired batch reminder is resent', async () => {
    const { request, batches, sentMessages, createdTokens } = buildHarness({
      initialBatches: [{
        id: 'batch-expired-resend',
        interviewer_id: 'user-zhang',
        interviewer_name: '张三',
        interviewer_open_id: 'ou_zhang',
        token_hash: 'hash-expired-resend',
        expires_at: '2026-08-01T12:00:00.000Z',
        status: 'expired',
        created_by: 'hr@example.com',
        created_at: '2026-08-01T00:00:00.000Z',
        last_sent_at: '2026-08-01T00:00:00.000Z',
        scope_key: 'ou_zhang',
        rawToken: 'expired-resend-token',
      }],
      initialItems: [{
        id: 'item-expired-resend',
        batch_id: 'batch-expired-resend',
        resume_id: 'resume-1',
        position_id: 'position-1',
        status: 'pending',
        remark: null,
        processed_at: null,
        created_at: '2026-08-01T00:00:00.000Z',
        candidate_name: '候选人甲',
        mapped_position: '标准运营',
        position_applied: '标准运营',
        hr_disposition: 'pushed',
        business_screening_status: 'pending',
      }],
      resumes: [{
        id: 'resume-1',
        candidate_name: '候选人甲',
        screening_result: '通过',
        status: 'pending_review',
        hr_disposition: 'pushed',
        mapped_position: '标准运营',
        position_applied: '标准运营',
        business_screening_status: 'pending',
        business_screening_batch_id: 'batch-expired-resend',
      }],
    });

    const response = await request('https://ai-interview-88r.pages.dev/api/resumes/business-screening/batches/batch-expired-resend/resend', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer hr-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      batchId: 'batch-expired-resend',
      url: 'https://ai-interview-88r.pages.dev/business-screening/expired-resend-token',
      itemCount: 1,
    });
    expect(createdTokens).toHaveLength(0);
    expect(batches.get('batch-expired-resend')).toMatchObject({
      status: 'active',
      expires_at: '2026-09-11T12:00:00.000Z',
    });
    expect(sentMessages).toHaveLength(1);
    expect((sentMessages[0].card as any).elements[1].actions[0].url)
      .toBe('https://ai-interview-88r.pages.dev/business-screening/expired-resend-token');
  });
});

describe('manual-push / eliminate（AI 结果与业务链接联动）', () => {
  it('manual-push 把 AI 不通过改为通过并推送到业务链接', async () => {
    const { request, resumes } = buildHarness({
      positions: [{ id: 'position-1', title: '标准运营', primary_interviewer: '张三', secondary_interviewer: '', responsible_person: '张三' }],
      resumes: [{
        id: 'resume-manual-push',
        candidate_name: '候选人乙',
        email: 'yi@example.com',
        screening_result: '不通过',
        status: 'pending_review',
        stage: 'screening',
        hr_disposition: 'pending',
        mapped_position: '标准运营',
        position_applied: '标准运营',
        business_screening_status: 'not_ready',
      }],
    });

    const response = await request('https://ai-interview-88r.pages.dev/api/resumes/resume-manual-push/business-screening/manual-push', {
      method: 'POST',
      headers: { Authorization: 'Bearer hr-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ai_result).toBe('通过');
    expect(body.pushed).toEqual(['resume-manual-push']);
    expect(body.ok).toBe(true);
    expect(resumes.get('resume-manual-push')).toMatchObject({
      screening_result: '通过',
      hr_disposition: 'pushed',
      business_screening_status: 'pending',
    });
  });

  it('eliminate 把 AI 通过改为不通过并从业务链接移除、可再次推送', async () => {
    const { request, resumes, batchItems, batches } = buildHarness({
      positions: [{ id: 'position-1', title: '标准运营', primary_interviewer: '张三', secondary_interviewer: '', responsible_person: '张三' }],
      resumes: [{
        id: 'resume-eliminate',
        candidate_name: '候选人丙',
        email: 'bing@example.com',
        screening_result: '通过',
        status: 'pending_review',
        stage: 'screening',
        hr_disposition: 'pushed',
        mapped_position: '标准运营',
        position_applied: '标准运营',
        business_screening_status: 'pending',
        business_screening_batch_id: 'batch-elim',
        business_screening_dispatch_group_id: 'dg-elim',
      }],
      initialBatches: [{
        id: 'batch-elim',
        interviewer_id: 'user-zhang',
        interviewer_name: '张三',
        interviewer_open_id: 'ou_zhang',
        token_hash: 'hash-elim',
        expires_at: '2026-08-19T00:00:00.000Z',
        status: 'active',
        created_by: 'hr@example.com',
        created_at: '2026-08-12T00:00:00.000Z',
        last_sent_at: null,
        scope_key: 'ou_zhang',
        rawToken: 'elim-token',
      }],
      initialItems: [{
        id: 'item-elim',
        batch_id: 'batch-elim',
        resume_id: 'resume-eliminate',
        position_id: 'position-1',
        status: 'pending',
        remark: null,
        processed_at: null,
        created_at: '2026-08-12T00:00:00.000Z',
        candidate_name: '候选人丙',
        mapped_position: '标准运营',
        hr_disposition: 'pushed',
        business_screening_status: 'pending',
      }],
    });

    const response = await request('https://ai-interview-88r.pages.dev/api/resumes/resume-eliminate/business-screening/eliminate', {
      method: 'POST',
      headers: { Authorization: 'Bearer hr-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.removed).toBe(1);
    expect(body.ai_result).toBe('不通过');
    expect(resumes.get('resume-eliminate')).toMatchObject({
      screening_result: '不通过',
      hr_disposition: 'pending',
      business_screening_status: 'not_ready',
    });
    // 未决条目已从批次移除，批次本身仍有效
    expect(batchItems.filter((item) => item.resume_id === 'resume-eliminate')).toHaveLength(0);
    expect(batches.get('batch-elim')?.status).toBe('active');

    // 淘汰后可再次手动推送（AI 不通过 → 通过 → 推送）
    const rePush = await request('https://ai-interview-88r.pages.dev/api/resumes/resume-eliminate/business-screening/manual-push', {
      method: 'POST',
      headers: { Authorization: 'Bearer hr-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(rePush.status).toBe(200);
    const reBody = await rePush.json();
    expect(reBody.pushed).toEqual(['resume-eliminate']);
    expect(resumes.get('resume-eliminate')).toMatchObject({ screening_result: '通过', hr_disposition: 'pushed' });
  });

  it('eliminate 对业务已终态的简历不改动推送状态', async () => {
    const { request, resumes } = buildHarness({
      resumes: [{
        id: 'resume-terminal',
        candidate_name: '候选人丁',
        screening_result: '通过',
        status: 'approved',
        stage: 'talent_pool',
        hr_disposition: 'pushed',
        mapped_position: '标准运营',
        position_applied: '标准运营',
        business_screening_status: 'passed',
      }],
    });
    const response = await request('https://ai-interview-88r.pages.dev/api/resumes/resume-terminal/business-screening/eliminate', {
      method: 'POST',
      headers: { Authorization: 'Bearer hr-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ai_result).toBe('不通过');
    // 业务已通过为终态：只翻转 AI 结果，不重置推送状态
    expect(resumes.get('resume-terminal')).toMatchObject({
      screening_result: '不通过',
      hr_disposition: 'pushed',
      business_screening_status: 'passed',
      status: 'approved',
    });
  });

  it('manual-push / eliminate 对不存在的简历返回 404', async () => {
    const { request } = buildHarness();
    const push = await request('https://ai-interview-88r.pages.dev/api/resumes/not-exist/business-screening/manual-push', {
      method: 'POST', headers: { Authorization: 'Bearer hr-token', 'Content-Type': 'application/json' }, body: JSON.stringify({}),
    });
    expect(push.status).toBe(404);
    const elim = await request('https://ai-interview-88r.pages.dev/api/resumes/not-exist/business-screening/eliminate', {
      method: 'POST', headers: { Authorization: 'Bearer hr-token', 'Content-Type': 'application/json' }, body: JSON.stringify({}),
    });
    expect(elim.status).toBe(404);
  });
});
