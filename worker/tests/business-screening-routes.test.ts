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
    getResumeFileBytes: async (_env, resumeId) => {
      return { bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]), fileName: `${resumeId}.pdf` }; // mock PDF 字节
    },
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
                  const businessRemark = values[1] as string;
                  const screenedAt = values[2] as string;
                  const screenedBy = values[3] as string;
                  const updatedAt = values[4] as string;
                  const resumeId = values[5] as string;
                  const resume = resumes.get(resumeId);
                  if (!resume) return { meta: { changes: 0 } };
                  const currentBusinessStatus = resume.business_screening_status;
                  resume.hr_disposition = 'rejected';
                  resume.hr_review = comment;
                  if (currentBusinessStatus !== 'passed' && currentBusinessStatus !== 'rejected') {
                    resume.business_screening_status = 'rejected';
                    resume.business_screening_remark = businessRemark;
                    resume.business_screened_at = screenedAt;
                    resume.business_screened_by = screenedBy;
                  }
                  resume.status = 'rejected';
                  resume.stage = 'rejected';
                  resume.updated_at = updatedAt;
                  return { meta: { changes: 1 } };
                }
                return { meta: { changes: 1 } };
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

  it('accepts a valid long-lived API key for push and rejects a wrong key', async () => {
    const { request, createdTokens } = buildHarness();

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

  it('allows a long-lived API key to resend a batch as permanent', async () => {
    const { request, batches } = buildHarness({
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
          mapped_position: '标准运营',
          position_applied: '标准运营',
          business_screening_status: 'not_ready',
        },
      ],
    });

    const push = (ids: string[], body?: object) => request('https://ai-interview-88r.pages.dev/api/resumes/business-screening/push', {
      method: 'POST',
      headers: { Authorization: 'Bearer hr-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, ...(body || {}) }),
    });

    // 不传 expires_in_days → 默认 7 天
    const defaultResp = await push(['resume-1']);
    expect(defaultResp.status).toBe(200);
    const defaultBatch = [...batches.values()][0];
    expect(defaultBatch.expires_at).toBe('2026-08-19T12:00:00.000Z');
    await expect(defaultResp.json()).resolves.toMatchObject({
      batches: [{ expiresAt: '2026-08-19T12:00:00.000Z' }],
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
      pushed: ['resume-1'],
      skipped: [{ id: 'resume-2', reason: 'AI初筛未通过' }],
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
});
