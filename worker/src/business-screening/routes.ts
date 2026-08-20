import { Hono } from 'hono';
import {
  createResumePushBatch,
  ensureBusinessScreeningSchema,
  insertResumePushBatchItems,
  insertResumePushBatchItemsIfAbsent,
  loadLatestResumePushBatchByInterviewer,
  loadResumePushBatchByTokenHash,
  markResumesPushed,
  recordBusinessScreeningDecision,
  refreshResumePushBatchExpiry,
  revokeActiveBusinessScreeningBatchesForResume,
} from './repository';
import {
  DEFAULT_BUSINESS_SCREENING_TITLE,
  normalizeBusinessScreeningTitle,
} from './display-title';
import { groupEligibleResumesForPush, isEligibleForPush, type PushEligibilityOptions } from './service';
import { createPublicToken, createScopePublicToken, hashPublicToken } from './token';
import { buildBusinessScreeningBatchItemVisibilityClause } from '../resume-list/business-screening-status';
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
  parsed_data?: string | null;
  gender?: string | null;
  birthday?: string | null;
  certifications?: string | null;
  self_evaluation?: string | null;
  business_screening_remark?: string | null;
  business_screened_at?: string | null;
  business_screened_by?: string | null;
  business_screening_batch_id?: string | null;
  business_screening_dispatch_group_id?: string | null;
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
  parsed_data?: string | null;
  hr_disposition?: string | null;
  business_screening_status?: string | null;
  business_screening_remark?: string | null;
  business_screened_at?: string | null;
  dispatch_group_id?: string | null;
  // 简历原文与 AI 评估（业务筛选公开页展示用）
  ocr_markdown?: string | null;
  raw_text?: string | null;
  resume_markdown?: string | null;
  ai_review?: string | null;
  ai_evaluation?: string | null;
  match_score?: number | null;
  capability_scores?: string | null;
  hard_requirement_result?: string | null;
  screening_result?: string | null;
  gender?: string | null;
  birthday?: string | null;
  certifications?: string | null;
  self_evaluation?: string | null;
}

// 业务筛选公开页透出的结构化档案（与简历详情页 Descriptions 字段一致，不含联系方式与简历原文）
export interface BusinessScreeningPublicProfile {
  highestDegree?: string;
  school?: string;
  major?: string;
  yearsOfExperience?: string;
  recentCompany?: string;
  currentTitle?: string;
  gender?: string;
  birthday?: string;
  skills?: string[];
  certifications?: string[];
  selfEvaluation?: string;
  workExperience?: Array<{ company?: string; title?: string; duration?: string; start?: string; end?: string; description?: string }>;
  educationHistory?: Array<{ school?: string; degree?: string; major?: string; start?: string; end?: string }>;
}

function toStringOrUndefined(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function toStringArrayOrUndefined(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return typeof value === 'string' && value.trim() ? [value.trim()] : undefined;
  const items = value.map((item) => toStringOrUndefined(item)).filter(Boolean) as string[];
  return items.length ? items : undefined;
}

function toHistoryOrUndefined<T>(value: unknown, map: (record: Record<string, unknown>) => T): T[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const mapped = value
    .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
    .map(map);
  return mapped.length ? mapped : undefined;
}

export function buildPublicProfile(
  parsedData: unknown,
  fallback?: {
    education?: unknown;
    workExperience?: unknown;
    gender?: unknown;
    birthday?: unknown;
    certifications?: unknown;
    selfEvaluation?: unknown;
  },
): BusinessScreeningPublicProfile | undefined {
  let parsed: Record<string, unknown> | null = null;
  if (typeof parsedData === 'string') {
    try { parsed = JSON.parse(parsedData); } catch { parsed = null; }
  } else if (typeof parsedData === 'object' && parsedData !== null) {
    parsed = parsedData as Record<string, unknown>;
  }
  // parsed_data 缺失/为空时，用简历表直接列兜底，保证公开页也有档案可看
  const pick = (parsedKey: string, fallbackValue?: unknown): unknown => {
    const v = parsed?.[parsedKey];
    return v !== undefined && v !== null && v !== '' ? v : fallbackValue;
  };

  const profile: BusinessScreeningPublicProfile = {
    highestDegree: toStringOrUndefined(pick('highest_degree', fallback?.education)),
    school: toStringOrUndefined(pick('school')),
    major: toStringOrUndefined(pick('major')),
    yearsOfExperience: toStringOrUndefined(pick('years_of_experience', fallback?.workExperience)),
    recentCompany: toStringOrUndefined(pick('recent_company')),
    currentTitle: toStringOrUndefined(pick('current_position')),
    gender: toStringOrUndefined(pick('gender', fallback?.gender)),
    birthday: toStringOrUndefined(pick('birthday', fallback?.birthday)),
    skills: toStringArrayOrUndefined(pick('skills')),
    certifications: toStringArrayOrUndefined(pick('certifications', fallback?.certifications)),
    selfEvaluation: toStringOrUndefined(pick('self_evaluation', fallback?.selfEvaluation)),
    workExperience: toHistoryOrUndefined(parsed?.work_experience, (w) => ({
      company: toStringOrUndefined(w.company),
      title: toStringOrUndefined(w.title),
      duration: toStringOrUndefined(w.duration),
      start: toStringOrUndefined(w.start),
      end: toStringOrUndefined(w.end),
      description: toStringOrUndefined(w.description),
    })),
    educationHistory: toHistoryOrUndefined(parsed?.education, (e) => ({
      school: toStringOrUndefined(e.school),
      degree: toStringOrUndefined(e.degree),
      major: toStringOrUndefined(e.major),
      start: toStringOrUndefined(e.start),
      end: toStringOrUndefined(e.end),
    })),
  };
  const hasAny = Object.values(profile).some((value) => value !== undefined);
  return hasAny ? profile : undefined;
}

export interface BusinessScreeningRouteStore {
  listResumesByIds(db: D1Database, ids: string[]): Promise<BusinessScreeningResumeRecord[]>;
  listPositionsByTitles(db: D1Database, titles: string[]): Promise<Array<{ id: string; title: string; primary_interviewer?: string | null; secondary_interviewer?: string | null; responsible_person?: string | null }>>;
  listPositionMappings(db: D1Database, rawNames: string[]): Promise<Array<{ raw_name: string; mapped_name: string }>>;
  listInterviewerDirectory(db: D1Database, names: string[]): Promise<Array<{ name: string; openId?: string | null; userId?: string | null }>>;
  // 按候选人姓名查所有简历的档案字段（同名兜底：公开页缺档案时借用系统内有解析数据的同名简历）
  findSameNameProfiles(
    db: D1Database,
    names: string[],
    excludeResumeId?: string,
  ): Promise<Array<{
    id: string;
    candidate_name?: string | null;
    screening_result?: string | null;
    mapped_position?: string | null;
    position_applied?: string | null;
    parsed_data?: string | null;
    education?: string | null;
    work_experience?: string | null;
    gender?: string | null;
    birthday?: string | null;
    certifications?: string | null;
    self_evaluation?: string | null;
  }>>;
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
      dispatchGroupId: string;
      batchTitle?: string | null;
      batchSubtitle?: string | null;
      scopeKey?: string | null;
    },
    items: CreateResumePushBatchItemInput[],
  ): Promise<void>;
  markResumesPushed(db: D1Database, resumeIds: string[], batchId: string, dispatchGroupId: string): Promise<void>;
  loadBatchByTokenHash(db: D1Database, tokenHash: string): Promise<ResumePushBatchRow | null>;
  loadBatchById(db: D1Database, batchId: string): Promise<ResumePushBatchRow | null>;
  // 查找同一面试官当前仍有效（未过期且未撤销）的批次；completed 也返回（可复用并重置 active）
  loadBatchByScope(db: D1Database, scopeKey: string, nowIso: string): Promise<ResumePushBatchRow | null>;
  // 兼容旧版“岗位+面试官” scope：切换为面试官 scope 后，优先复用该面试官已有的稳定批次链接
  loadBatchByInterviewer(db: D1Database, interviewerOpenId: string, nowIso: string): Promise<ResumePushBatchRow | null>;
  // 查找同一负责人最近的 canonical 批次；允许已过期，但不允许已撤销
  loadLatestBatchByInterviewer(db: D1Database, interviewerOpenId: string): Promise<ResumePushBatchRow | null>;
  // 列出某面试官当前有效（active/completed 且未过期）的全部批次（供 skill 模式 A 取回现有链接）
  listActiveBatchesByInterviewer(db: D1Database, interviewerName: string, nowIso: string): Promise<ResumePushBatchRow[]>;
  // 把已处理完的批次重新激活（追加新简历时复用链接）
  resetBatchActive(db: D1Database, batchId: string): Promise<void>;
  // 推送/重发时刷新固定链接的有效期
  refreshBatchExpiry(db: D1Database, batchId: string, expiresAt: string | null): Promise<void>;
  updateBatchPresentation(
    db: D1Database,
    batchId: string,
    presentation: { title?: string | null; subtitle?: string | null },
  ): Promise<void>;
  // 向批次追加简历条目（重复（batch,resume）自动忽略）
  appendBatchItemsIfAbsent(db: D1Database, items: CreateResumePushBatchItemInput[]): Promise<void>;
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
  getResumeFileBytes(env: any, resumeId: string): Promise<{ bytes: Uint8Array | null; fileName: string }>;
}

type HrUser = { id?: string; email?: string; role?: string; full_name?: string };

// 解析飞书卡片发送人：JWT 用户用本人；API Key 身份用配置的归属用户（未配置返回原因）
async function resolveSenderEmail(
  c: any,
  user: HrUser,
  deps: BusinessScreeningRouteDeps,
): Promise<{ email: string | null; reason?: string }> {
  if (user.id !== 'api-key') return { email: user.email || null };
  if (!deps.resolveApiKeyOwnerEmail) {
    return { email: null, reason: 'API Key 未配置飞书归属用户，无法发送业务筛选链接' };
  }
  const owner = await deps.resolveApiKeyOwnerEmail(c.env);
  if (!owner) {
    return { email: null, reason: 'API Key 未配置飞书归属用户，无法发送业务筛选链接' };
  }
  return { email: owner };
}

export interface BusinessScreeningRouteDeps {
  authMiddleware: (c: any, next: any) => Promise<Response | void>;
  requireRole: (roles: string[]) => (c: any, next: any) => Promise<Response | void>;
  getCurrentUserToken: (env: any, email: string) => Promise<string | null>;
  sendFeishuMessageToUser: (token: string, openId: string, card: unknown) => Promise<unknown>;
  recordResumeDecisionTimestamp: (db: D1Database, resumeId: string, action: 'approved' | 'rejected' | 'reset', timestamp?: string) => Promise<void>;
  now: () => string;
  uuid: () => string;
  createPublicToken: typeof createPublicToken;
  createScopePublicToken: typeof createScopePublicToken;
  store: BusinessScreeningRouteStore;
  // API Key 身份的飞书归属用户：key 推送时用该用户的飞书 token 发送卡片（未配置则无法发飞书，链接仍生成）
  resolveApiKeyOwnerEmail?: (env: any) => Promise<string | null>;
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

// 链接有效期解析：不传/非法 → 默认 30 天；0 或负数 → 永久（expires_at 为 null，永不过期）；正数 → 按天
function resolveExpiresAt(nowIso: string, raw: unknown): string | null {
  if (raw === undefined || raw === null) return plusDays(nowIso, 30);
  const days = Number(raw);
  if (!Number.isFinite(days)) return plusDays(nowIso, 30);
  if (days <= 0) return null;
  return plusDays(nowIso, Math.floor(days));
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

// 业务筛选公开页透出的候选人信息：结构化档案 + 简历原文（截断）+ AI 评估字段
const PUBLIC_RESUME_TEXT_LIMIT = 100000;

function sanitizePublicItem(item: BusinessScreeningBatchItemView) {
  const rawText = text(item.ocr_markdown) || text(item.raw_text) || text(item.resume_markdown);
  return {
    id: item.resume_id,
    candidateName: text(item.candidate_name) || '候选人',
    position: text(item.mapped_position) || text(item.position_applied) || '未分配岗位',
    education: text(item.education) || undefined,
    workExperience: text(item.work_experience) || undefined,
    status: item.status,
    remark: item.remark || undefined,
    processedAt: item.processed_at || undefined,
    contact: text(item.contact) || undefined,
    // 简历原文：MinerU OCR / 原始文本 / Markdown，取第一个非空，截断到安全长度
    resumeText: rawText ? rawText.slice(0, PUBLIC_RESUME_TEXT_LIMIT) : undefined,
    // AI 初筛评估字段（透传给公开页展示，与简历详情页一致）
    aiReview: item.ai_review || undefined,
    aiEvaluation: item.ai_evaluation || undefined,
    matchScore: item.match_score === null || item.match_score === undefined ? undefined : Number(item.match_score),
    capabilityScores: item.capability_scores || undefined,
    hardRequirementResult: item.hard_requirement_result || undefined,
    screeningResult: text(item.screening_result) || undefined,
    // 结构化档案：parsed_data 优先，缺失时用简历表直接列兜底（gender/birthday/certifications/self_evaluation 等）
    profile: buildPublicProfile(item.parsed_data, {
      education: item.education,
      workExperience: item.work_experience,
      gender: item.gender,
      birthday: item.birthday,
      certifications: item.certifications,
      selfEvaluation: item.self_evaluation,
    }),
  };
}

// 同名档案兜底：候选人自身缺结构化档案（仅完成 AI 初筛/未做字段解析）时，
// 从系统内同名的其他简历（有 parsed_data 或简历列数据）借用档案，保证业务侧能看到候选人信息。
// 同名多条时选可构建字段最多的那条；同名都缺数据时保持原样。
type SameNameProfileRow = {
  id: string;
  candidate_name?: string | null;
  screening_result?: string | null;
  mapped_position?: string | null;
  position_applied?: string | null;
  parsed_data?: string | null;
  education?: string | null;
  work_experience?: string | null;
  gender?: string | null;
  birthday?: string | null;
  certifications?: string | null;
  self_evaluation?: string | null;
};

/** 简历是否有结构化档案（parsed_data 或任一简历列非空） */
function hasResumeProfile(resume: {
  parsed_data?: unknown;
  education?: unknown;
  work_experience?: unknown;
  gender?: unknown;
  birthday?: unknown;
  certifications?: unknown;
  self_evaluation?: unknown;
}): boolean {
  return [resume.parsed_data, resume.education, resume.work_experience, resume.gender, resume.birthday, resume.certifications, resume.self_evaluation]
    .some((value) => value !== null && value !== undefined && String(value).trim() !== '');
}

/** 在同名简历行里选档案字段最全的一条（须有可构建的非空档案） */
function pickBestSameNameProfile(rows: SameNameProfileRow[]): SameNameProfileRow | null {
  let best: SameNameProfileRow | null = null;
  let bestScore = 0;
  for (const row of rows) {
    const profile = buildPublicProfile(row.parsed_data, {
      education: row.education,
      workExperience: row.work_experience,
      gender: row.gender,
      birthday: row.birthday,
      certifications: row.certifications,
      selfEvaluation: row.self_evaluation,
    });
    if (!profile) continue;
    const score = Object.values(profile).filter((value) => value !== undefined).length;
    if (score > bestScore) {
      bestScore = score;
      best = row;
    }
  }
  return best;
}

function attachSameNameProfileFallback(
  sanitized: Array<ReturnType<typeof sanitizePublicItem>>,
  rows: SameNameProfileRow[],
): void {
  if (sanitized.length === 0 || rows.length === 0) return;
  const byName = new Map<string, SameNameProfileRow[]>();
  for (const row of rows) {
    const name = text(row.candidate_name);
    if (!name) continue;
    const list = byName.get(name) || [];
    list.push(row);
    byName.set(name, list);
  }
  for (const resume of sanitized) {
    if (resume.profile) continue;
    const name = text(resume.candidateName);
    if (!name || name === '候选人') continue;
    const candidates = byName.get(name) || [];
    const best = pickBestSameNameProfile(candidates);
    if (best) {
      resume.profile = buildPublicProfile(best.parsed_data, {
        education: best.education,
        workExperience: best.work_experience,
        gender: best.gender,
        birthday: best.birthday,
        certifications: best.certifications,
        selfEvaluation: best.self_evaluation,
      });
    }
  }
}

function buildFeishuCard(input: {
  positionTitle: string;
  itemCount: number;
  url: string;
}): Record<string, unknown> {
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: `简历筛选待处理：${input.positionTitle}` },
      template: 'blue',
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `您有 ${input.itemCount} 份候选人简历待处理，已统一汇总到待筛选列表，请点击链接完成筛选`,
        },
      },
      {
        tag: 'action',
        actions: [
          {
            tag: 'button',
            type: 'primary',
            text: { tag: 'plain_text', content: '进入待筛选简历' },
            url: input.url,
          },
        ],
      },
      {
        tag: 'note',
        elements: [{ tag: 'plain_text', content: '发送自 招聘管理智能小助手' }],
      },
    ],
  };
}

function summarizeSkipReason(
  resume: BusinessScreeningResumeRecord,
  position: { id: string; title: string; primary_interviewer?: string | null; secondary_interviewer?: string | null; responsible_person?: string | null } | undefined,
  interviewerDirectory: Map<string, { name: string; openId?: string | null; userId?: string | null }>,
  options?: PushEligibilityOptions,
): string {
  if (!position) return '缺少标准岗位';
  const interviewerNames = uniqueStrings([position.responsible_person]);
  if (interviewerNames.length === 0) return '岗位未配置有效责任人';
  for (const interviewerName of interviewerNames) {
    const interviewer = interviewerDirectory.get(interviewerName) || { name: interviewerName };
    const eligibility = isEligibleForPush(resume, interviewer, options);
    if (!eligibility.ok) return eligibility.reason;
  }
  return '岗位未配置有效责任人';
}

export function createBusinessScreeningRoutes(deps: BusinessScreeningRouteDeps) {
  const app = new Hono<{ Bindings: any }>();

  // Ensure additive resumes columns and push tables exist (idempotent) before
  // any business-screening handler reads/writes them. This covers deployments
  // where only /api/resumes (not /api/init/status) has run so far.
  app.use('*', async (c, next) => {
    try {
      await ensureBusinessScreeningSchema(c.env.DB as D1Database);
    } catch (error) {
      console.error('[business-screening] schema ensure failed', error);
    }
    return next();
  });

  // 档案优选：仅完成 AI 初筛、缺结构化档案的简历（重复上传场景），
  // 自动替换为同名、AI 初筛通过、同标准岗位且档案最全的另一条简历，
  // 保证业务筛选链接推送的是有候选人档案的那条；替换后按 id 去重防重复。
  async function optimizeResumesForProfile(
    db: D1Database,
    resumes: BusinessScreeningResumeRecord[],
    resolveStandardTitle: (rawTitle: string) => string,
  ): Promise<BusinessScreeningResumeRecord[]> {
    const profileMissing = resumes.filter((resume) => !hasResumeProfile(resume));
    if (profileMissing.length === 0) return resumes;
    const names = uniqueStrings(profileMissing.map((resume) => text(resume.candidate_name)));
    if (names.length === 0) return resumes;
    const sameNameRows = await deps.store.findSameNameProfiles(db, names);
    const replacementByOriginal = new Map<string, string>();
    const replacementIds = new Set<string>();
    for (const resume of profileMissing) {
      const name = text(resume.candidate_name);
      if (!name) continue;
      const candidates = sameNameRows
        .filter((row) => row.id !== resume.id && text(row.candidate_name) === name)
        .filter((row) => text(row.screening_result) === '通过');
      const best = pickBestSameNameProfile(candidates);
      if (!best) continue;
      // 必须是同一标准岗位（保证责任人一致），避免同名不同岗张冠李戴
      const rawTitle = text(resume.mapped_position) || text(resume.position_applied);
      const bestTitle = text(best.mapped_position) || text(best.position_applied);
      if (resolveStandardTitle(rawTitle) !== resolveStandardTitle(bestTitle)) continue;
      replacementByOriginal.set(resume.id, best.id);
      replacementIds.add(best.id);
    }
    if (replacementIds.size === 0) return resumes;
    const replacementRows = await deps.store.listResumesByIds(db, [...replacementIds]);
    const replacementById = new Map(replacementRows.map((row) => [row.id, row]));
    const seen = new Set<string>();
    const optimized: BusinessScreeningResumeRecord[] = [];
    for (const resume of resumes) {
      const replacementId = replacementByOriginal.get(resume.id);
      const chosen = replacementId ? (replacementById.get(replacementId) || resume) : resume;
      if (seen.has(chosen.id)) continue;
      seen.add(chosen.id);
      optimized.push(chosen);
    }
    return optimized;
  }

  // 按面试官列出当前有效批次及其链接（供 skill 模式 A 取回已有链接交付）：
  // scope 批次可重算确定性 token 得到 url；无 scope_key 的旧批次无法反推，标记 needs_resend。
  app.get('/api/resumes/business-screening/batches', deps.authMiddleware, deps.requireRole(['admin', 'hr']), async (c) => {
    try {
      const interviewer = String(c.req.query('interviewer') || '').trim();
      if (!interviewer) return c.json({ detail: 'interviewer 参数必填（面试官姓名）' }, 400);
      const db = c.env.DB as D1Database;
      const nowIso = deps.now();
      const rows = await deps.store.listActiveBatchesByInterviewer(db, interviewer, nowIso);
      const origin = new URL(c.req.url).origin;
      const batches = [];
      for (const row of rows) {
        let url: string | null = null;
        let needsResend = false;
        if (row.scope_key && row.id) {
          const issued = await deps.createScopePublicToken(row.scope_key, row.id);
          url = `${origin}/business-screening/${issued.token}`;
        } else {
          needsResend = true;
        }
        batches.push({
          batchId: row.id,
          interviewer: row.interviewer_name,
          status: row.status,
          expiresAt: row.expires_at,
          title: row.batch_title || undefined,
          subtitle: row.batch_subtitle || undefined,
          url,
          needsResend,
        });
      }
      return c.json({ interviewer, total: batches.length, batches });
    } catch (e: any) {
      console.error(`[business-screening] 批次查询失败: ${e.message}`);
      return c.json({ detail: '批次查询失败: ' + e.message }, 500);
    }
  });

  app.post('/api/resumes/business-screening/push', deps.authMiddleware, deps.requireRole(['admin', 'hr']), async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const ids = uniqueStrings(Array.isArray(body?.ids) ? body.ids : []);
    if (ids.length === 0) {
      return c.json({ detail: 'ids must contain at least one resume id' }, 400);
    }
    const user = ((c as any).get('user') || {}) as HrUser;
    const result = await pushResumesToBusinessScreening(c.env.DB as D1Database, deps, {
      ids,
      expiresInDays: body?.expires_in_days,
      silent: body?.silent === true,
      title: body?.title,
      subtitle: body?.subtitle,
      tempLink: body?.temp_link === true,
      batchId: body?.batch_id,
      createdBy: user.email || 'system',
    }, { origin: new URL(c.req.url).origin, user, env: c.env });
    return c.json(result);
  });
  app.post('/api/resumes/:id/business-screening/reject', deps.authMiddleware, deps.requireRole(['admin', 'hr']), async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const db = c.env.DB as D1Database;
    const resumes = await deps.store.listResumesByIds(db, [id]);
    const resume = resumes[0];
    if (!resume) return c.json({ detail: 'Candidate not found' }, 404);
    if (resume.hr_disposition === 'pushed'
      && (resume.business_screening_status === 'passed' || resume.business_screening_status === 'rejected')) {
      return c.json({ detail: 'business screening already completed' }, 409);
    }

    const decisionAt = deps.now();
    const comment = text(body?.comment) || text(body?.hr_comment) || '业务筛选前 HR 淘汰';
    await db.prepare(
      `UPDATE resumes
          SET hr_disposition = 'rejected',
              hr_review = ?,
              business_screening_status = CASE
                WHEN hr_disposition = 'pushed' THEN 'rejected'
                ELSE 'not_ready'
              END,
              business_screening_remark = CASE
                WHEN hr_disposition = 'pushed' THEN ?
                ELSE ''
              END,
              business_screened_at = CASE
                WHEN hr_disposition = 'pushed' THEN ?
                ELSE NULL
              END,
              business_screened_by = CASE
                WHEN hr_disposition = 'pushed' THEN ?
                ELSE ''
              END,
              status = 'rejected',
              stage = 'rejected',
              updated_at = ?
        WHERE id = ?`,
    ).bind(comment, decisionAt, 'HR', decisionAt, id).run();
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

  // ==================== 手动推送：AI 不通过 → 改为通过并推送到业务链接 ====================
  app.post('/api/resumes/:id/business-screening/manual-push', deps.authMiddleware, deps.requireRole(['admin', 'hr']), async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const db = c.env.DB as D1Database;
    const user = ((c as any).get('user') || {}) as HrUser;
    const resume = (await deps.store.listResumesByIds(db, [id]))[0];
    if (!resume) return c.json({ detail: 'Candidate not found' }, 404);
    // 1) AI 结果改为通过
    await setResumeAiResult(db, id, '通过', 'HR 手动推送：AI 初筛不通过后人工改为通过');
    // 2) 推送到业务链接（复用统一推送服务，正常发送飞书卡片）
    const result = await pushResumesToBusinessScreening(db, deps, {
      ids: [id],
      expiresInDays: body?.expires_in_days,
      silent: body?.silent === true,
      createdBy: user.email || user.full_name || 'system',
    }, { origin: new URL(c.req.url).origin, user, env: c.env });
    const updated = (await deps.store.listResumesByIds(db, [id]))[0];
    return c.json({
      ...result,
      ai_result: updated?.screening_result || '通过',
      business_screening_status: updated?.business_screening_status || 'pending',
    });
  });

  // ==================== 手动淘汰：AI 通过 → 改为不通过并从业务链接移除 ====================
  app.post('/api/resumes/:id/business-screening/eliminate', deps.authMiddleware, deps.requireRole(['admin', 'hr']), async (c) => {
    const id = c.req.param('id');
    const db = c.env.DB as D1Database;
    const resume = (await deps.store.listResumesByIds(db, [id]))[0];
    if (!resume) return c.json({ detail: 'Candidate not found' }, 404);
    await setResumeAiResult(db, id, '不通过', 'HR 手动淘汰：AI 初筛通过后人工改为不通过');
    const { removed } = await deps.store.removeResumeFromBusinessScreeningBatches(db, id, deps.now());
    const updated = (await deps.store.listResumesByIds(db, [id]))[0];
    return c.json({
      ok: true,
      removed,
      ai_result: updated?.screening_result || '不通过',
      hr_disposition: updated?.hr_disposition || 'pending',
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
    const sanitized = items.map(sanitizePublicItem);
    // 同名档案兜底：缺档案的候选人从系统内同名简历借用完整档案（重复上传/仅初筛未解析的场景）
    const missingNames = [...new Set(
      sanitized
        .filter((resume) => !resume.profile && resume.candidateName && resume.candidateName !== '候选人')
        .map((resume) => resume.candidateName as string),
    )];
    if (missingNames.length > 0) {
      const sameNameRows = await deps.store.findSameNameProfiles(db, missingNames);
      attachSameNameProfileFallback(sanitized, sameNameRows);
    }
    return c.json({
      batch: {
        id: batch.id,
        interviewer: batch.interviewer_name,
        status: batch.status,
        expiresAt: batch.expires_at,
        lastSentAt: batch.last_sent_at,
        title: batch.batch_title || undefined,
        subtitle: batch.batch_subtitle || undefined,
      },
      resumes: sanitized,
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

  /**
   * 批量决策：对选中（默认全部）的待处理候选人一次性通过/淘汰。
   * 请求体可携带 resumeIds 精确指定目标候选人（全选后取消个别候选人的交互链路）；
   * 未传或为空数组时回退为处理全部待处理候选人。
   * 逐项复用 recordDecision（幂等/冲突语义与单条一致），
   * 处理完后若批次无待处理项则自动置为 completed。
   */
  async function handleBatchDecision(
    c: any,
    status: 'passed' | 'rejected',
  ) {
    const tokenHash = await hashPublicToken(c.req.param('token'));
    const db = c.env.DB as D1Database;
    const batch = await deps.store.loadBatchByTokenHash(db, tokenHash);
    if (!batch) return c.json({ detail: 'Not found' }, 404);

    const access = isBatchAccessible(batch, deps.now());
    if (!access.ok) {
      if (access.nextStatus) await deps.store.setBatchStatus(db, batch.id, access.nextStatus);
      return c.json({ detail: 'Link unavailable' }, access.status);
    }

    const body = await c.req.json().catch(() => ({}));
    const remark = text(body?.remark) || null;
    const requestedIds = Array.isArray(body?.resumeIds)
      ? uniqueStrings(body.resumeIds)
      : null;
    const items = await deps.store.listBatchItems(db, batch.id);
    const pendingItems = items.filter((item) => item.status === 'pending');
    const targets = requestedIds
      ? pendingItems.filter((item) => requestedIds.includes(item.resume_id))
      : pendingItems;

    let applied = 0;
    let skipped = 0;
    let failed = 0;
    for (const item of targets) {
      const result = await deps.store.recordDecision(db, {
        batchItemId: item.id,
        resumeId: item.resume_id,
        batchId: batch.id,
        status,
        remark,
        screenedAt: deps.now(),
        screenedBy: batch.interviewer_name,
      });
      if (result.applied) applied += 1;
      else if (result.idempotent) skipped += 1;
      else failed += 1;
    }

    const pendingCount = await deps.store.countPendingBatchItems(db, batch.id);
    if (pendingCount === 0) {
      await deps.store.setBatchStatus(db, batch.id, 'completed');
    }

    return c.json({
      ok: true,
      status,
      applied,
      skipped,
      failed,
      pending: targets.length,
    });
  }

  app.post('/api/public/business-screening/:token/batch/approve', async (c) => (
    handleBatchDecision(c, 'passed')
  ));
  app.post('/api/public/business-screening/:token/batch/reject', async (c) => (
    handleBatchDecision(c, 'rejected')
  ));

  // 免登录下载批次内某份简历的源文件（PDF）：校验公开 token 有效 + 简历属于该批次
  app.get('/api/public/business-screening/:token/resumes/:resumeId/file', async (c) => {
    const tokenHash = await hashPublicToken(c.req.param('token'));
    const resumeId = c.req.param('resumeId');
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

    const file = await deps.getResumeFileBytes(c.env, resumeId);
    if (!file.bytes) {
      return c.json({ detail: '该简历源文件未本地缓存，无法下载。请重新上传 PDF 或联系管理员', not_cached: true }, 404);
    }
    const isPreview = c.req.query('preview') === 'true';
    const safeName = (item.candidate_name || 'resume').replace(/[\\/:*?"<>|]/g, '_');
    return new Response(file.bytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${isPreview ? 'inline' : 'attachment'}; filename="${encodeURIComponent(safeName)}.pdf"`,
        'Cache-Control': 'private, max-age=300',
      },
    });
  });

  app.post('/api/resumes/business-screening/batches/:batchId/resend', deps.authMiddleware, deps.requireRole(['admin', 'hr']), async (c) => {
    const batchId = c.req.param('batchId');
    const db = c.env.DB as D1Database;
    const user = ((c as any).get('user') || {}) as HrUser;
    const body = await c.req.json().catch(() => ({}));
    // 静默重发：只生成链接，不自动发送飞书卡片
    const silent = body?.silent === true;
    const hasTitle = body !== null
      && typeof body === 'object'
      && Object.prototype.hasOwnProperty.call(body, 'title');
    const requestedTitle = hasTitle
      ? normalizeBusinessScreeningTitle(body.title) || DEFAULT_BUSINESS_SCREENING_TITLE
      : undefined;
    const hasSubtitle = body !== null
      && typeof body === 'object'
      && Object.prototype.hasOwnProperty.call(body, 'subtitle');
    const requestedSubtitle = hasSubtitle ? text(body.subtitle) || null : undefined;
    const batch = await deps.store.loadBatchById(db, batchId);
    if (!batch) return c.json({ detail: 'Batch not found' }, 404);

    const items = await deps.store.listBatchItems(db, batchId);
    const pendingItems = items.filter((item) => item.status === 'pending');
    if (pendingItems.length === 0) {
      return c.json({ detail: 'No pending resumes to resend' }, 409);
    }

    const sender = await resolveSenderEmail(c, user, deps);
    const currentUserToken = sender.email ? await deps.getCurrentUserToken(c.env, sender.email) : null;
    const dispatchGroupId = deps.uuid();
    const nowIso = deps.now();

    // 固定业务范围链接规则：有 scope_key 的批次重发时复用同一业务范围链接，
    // 把待处理简历追加回该 scope 当前批次；批次已过期则新建（同链接的下一周期）。
    // 无 scope_key 的历史批次回退旧行为：生成新链接并撤销原批次。
    let nextBatchId: string;
    let url: string;
    const scopeKey = batch.scope_key?.trim();
    if (scopeKey) {
      let current = await deps.store.loadBatchByScope(db, scopeKey, nowIso);
      if (!current) {
        current = await deps.store.loadLatestBatchByInterviewer(db, batch.interviewer_open_id);
      }
      nextBatchId = current ? current.id : deps.uuid();
      // 链接由 scope + batchId 确定：复用 canonical 批次 → 同一链接；推送时续期
      const tokenScopeKey = current?.scope_key?.trim() || scopeKey;
      const issued = await deps.createScopePublicToken(tokenScopeKey, nextBatchId);
      url = `${new URL(c.req.url).origin}/business-screening/${issued.token}`;
      const nextItems = pendingItems.map((item) => ({
        id: deps.uuid(),
        batchId: nextBatchId,
        resumeId: item.resume_id,
        positionId: item.position_id,
        createdAt: nowIso,
        dispatchGroupId,
      }));
      if (current) {
        await deps.store.appendBatchItemsIfAbsent(db, nextItems);
        await deps.store.resetBatchActive(db, nextBatchId);
        await deps.store.refreshBatchExpiry(db, nextBatchId, resolveExpiresAt(nowIso, body.expires_in_days));
        await deps.store.updateBatchPresentation(db, nextBatchId, {
          title: requestedTitle,
          subtitle: requestedSubtitle,
        });
      } else {
        await deps.store.createBatch(db, {
          id: nextBatchId,
          interviewerId: batch.interviewer_id,
          interviewerName: batch.interviewer_name,
          interviewerOpenId: batch.interviewer_open_id,
          tokenHash: issued.tokenHash,
          expiresAt: resolveExpiresAt(nowIso, body.expires_in_days),
          createdBy: user.email || 'system',
          createdAt: nowIso,
          lastSentAt: null,
          dispatchGroupId,
          batchTitle: requestedTitle ?? batch.batch_title ?? null,
          batchSubtitle: requestedSubtitle ?? batch.batch_subtitle ?? null,
          scopeKey,
        }, nextItems);
      }
      await deps.store.markResumesPushed(db, pendingItems.map((item) => item.resume_id), nextBatchId, dispatchGroupId);
    } else {
      const issued = await deps.createPublicToken();
      nextBatchId = deps.uuid();
      url = `${new URL(c.req.url).origin}/business-screening/${issued.token}`;
      const nextItems = pendingItems.map((item) => ({
        id: deps.uuid(),
        batchId: nextBatchId,
        resumeId: item.resume_id,
        positionId: item.position_id,
        createdAt: nowIso,
        dispatchGroupId,
      }));
      await deps.store.createBatch(db, {
        id: nextBatchId,
        interviewerId: batch.interviewer_id,
        interviewerName: batch.interviewer_name,
        interviewerOpenId: batch.interviewer_open_id,
        tokenHash: issued.tokenHash,
        expiresAt: resolveExpiresAt(nowIso, body.expires_in_days),
        createdBy: user.email || 'system',
        createdAt: nowIso,
        lastSentAt: null,
        dispatchGroupId,
        // 重发默认沿用原批次标题/说明，也可在请求体里覆盖
        batchTitle: requestedTitle ?? batch.batch_title ?? null,
        batchSubtitle: requestedSubtitle ?? batch.batch_subtitle ?? null,
      }, nextItems);
      await deps.store.markResumesPushed(db, pendingItems.map((item) => item.resume_id), nextBatchId, dispatchGroupId);
      await deps.store.setBatchStatus(db, batchId, 'revoked');
    }

    if (!silent && !currentUserToken) {
      return c.json({
        ok: false,
        resentFromBatchId: batchId,
        batchId: nextBatchId,
        itemCount: pendingItems.length,
        url,
        detail: '当前账号未授权飞书身份，无法发送业务筛选链接',
      }, 400);
    }

    const positionTitle = pendingItems
      .map((item) => text(item.mapped_position) || text(item.position_applied))
      .find((title) => title.length > 0) || '岗位';

    if (!silent) {
      try {
        const pendingCount = await deps.store.countPendingBatchItems(db, nextBatchId);
        await deps.sendFeishuMessageToUser(currentUserToken, batch.interviewer_open_id, buildFeishuCard({
          positionTitle,
          itemCount: pendingCount,
          url,
        }));
        await deps.store.setBatchLastSentAt(db, nextBatchId, deps.now());
      } catch (error) {
        return c.json({
          ok: false,
          resentFromBatchId: batchId,
          batchId: nextBatchId,
          itemCount: pendingItems.length,
          url,
          detail: error instanceof Error ? error.message : '业务筛选链接发送失败',
        }, 500);
      }
    }

    return c.json({
      ok: true,
      resentFromBatchId: batchId,
      batchId: nextBatchId,
      itemCount: pendingItems.length,
      url,
    });
  });

  return app;
}

// 档案优选：仅完成 AI 初筛、缺结构化档案的简历（重复上传场景），
// 自动替换为同名、AI 初筛通过、同标准岗位且档案最全的另一条简历，
// 保证业务筛选链接推送的是有候选人档案的那条；替换后按 id 去重防重复。
async function optimizeResumesForProfile(
  db: D1Database,
  deps: Pick<BusinessScreeningRouteDeps, 'store'>,
  resumes: BusinessScreeningResumeRecord[],
  resolveStandardTitle: (rawTitle: string) => string,
): Promise<BusinessScreeningResumeRecord[]> {
  const profileMissing = resumes.filter((resume) => !hasResumeProfile(resume));
  if (profileMissing.length === 0) return resumes;
  const names = uniqueStrings(profileMissing.map((resume) => text(resume.candidate_name)));
  if (names.length === 0) return resumes;
  const sameNameRows = await deps.store.findSameNameProfiles(db, names);
  const replacementByOriginal = new Map<string, string>();
  const replacementIds = new Set<string>();
  for (const resume of profileMissing) {
    const name = text(resume.candidate_name);
    if (!name) continue;
    const candidates = sameNameRows
      .filter((row) => row.id !== resume.id && text(row.candidate_name) === name)
      .filter((row) => text(row.screening_result) === '通过');
    const best = pickBestSameNameProfile(candidates);
    if (!best) continue;
    // 必须是同一标准岗位（保证责任人一致），避免同名不同岗张冠李戴
    const rawTitle = text(resume.mapped_position) || text(resume.position_applied);
    const bestTitle = text(best.mapped_position) || text(best.position_applied);
    if (resolveStandardTitle(rawTitle) !== resolveStandardTitle(bestTitle)) continue;
    replacementByOriginal.set(resume.id, best.id);
    replacementIds.add(best.id);
  }
  if (replacementIds.size === 0) return resumes;
  const replacementRows = await deps.store.listResumesByIds(db, [...replacementIds]);
  const replacementById = new Map(replacementRows.map((row) => [row.id, row]));
  const seen = new Set<string>();
  const optimized: BusinessScreeningResumeRecord[] = [];
  for (const resume of resumes) {
    const replacementId = replacementByOriginal.get(resume.id);
    const chosen = replacementId ? (replacementById.get(replacementId) || resume) : resume;
    if (seen.has(chosen.id)) continue;
    seen.add(chosen.id);
    optimized.push(chosen);
  }
  return optimized;
}

/**
 * 手动覆盖 AI 初筛结果（通过/不通过）：更新 screening_result 列，
 * 并同步 ai_review / ai_evaluation JSON 内的 screening_result / screening_reason，保持口径一致。
 */
async function setResumeAiResult(
  db: D1Database,
  resumeId: string,
  result: '通过' | '不通过',
  reason?: string,
): Promise<void> {
  const row = await db.prepare('SELECT ai_review, ai_evaluation FROM resumes WHERE id = ?')
    .bind(resumeId).first<{ ai_review: string | null; ai_evaluation: string | null }>();
  const patch = (raw: unknown): string | null => {
    if (typeof raw !== 'string' || !raw.trim()) return null;
    try {
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== 'object') return null;
      obj.screening_result = result;
      if (reason) obj.screening_reason = reason;
      return JSON.stringify(obj);
    } catch { return null; }
  };
  const aiReview = patch(row?.ai_review);
  const aiEvaluation = patch(row?.ai_evaluation);
  await db.prepare(
    `UPDATE resumes
        SET screening_result = ?,
            ai_review = COALESCE(?, ai_review),
            ai_evaluation = COALESCE(?, ai_evaluation),
            updated_at = ?
      WHERE id = ?`,
  ).bind(result, aiReview, aiEvaluation, new Date().toISOString(), resumeId).run();
}

export interface BusinessScreeningPushInput {
  ids: string[];
  expiresInDays?: unknown;
  /** 静默：只生成链接并加入批次，不发送飞书卡片 */
  silent?: boolean;
  /** 仅新建批次时发送飞书卡片（AI 自动推送用：追加到已有批次不重复打扰） */
  notifyNewBatchOnly?: boolean;
  title?: string | null;
  subtitle?: string | null;
  tempLink?: boolean;
  batchId?: string | null;
  createdBy?: string;
}

export interface BusinessScreeningPushResponse {
  ok: boolean;
  pushed: string[];
  skipped: Array<{ id: string; reason: string }>;
  failed: Array<{ interviewer: string; reason: string }>;
  batches: Array<{ batchId: string; interviewer: string; url: string; itemCount: number; expiresAt: string | null; title?: string; subtitle?: string }>;
}

/**
 * 统一业务筛选推送服务：把一批简历按面试官分组推送到业务筛选链接（复用固定批次/链接）。
 * 供三处复用：手动推送端点、AI 初筛通过自动推送、HR 手动把不通过改为通过后的推送。
 */
export async function pushResumesToBusinessScreening(
  db: D1Database,
  deps: BusinessScreeningRouteDeps,
  input: BusinessScreeningPushInput,
  context: { origin: string; user: HrUser | null; env: any },
): Promise<BusinessScreeningPushResponse> {
  const ids = uniqueStrings(input.ids);
  if (ids.length === 0) {
    return { ok: true, pushed: [], skipped: [], failed: [], batches: [] };
  }
  const requestedTitle = input.title !== undefined && input.title !== null
    ? normalizeBusinessScreeningTitle(input.title) || DEFAULT_BUSINESS_SCREENING_TITLE
    : undefined;
  const requestedSubtitle = input.subtitle !== undefined && input.subtitle !== null
    ? text(input.subtitle) || null
    : undefined;
  // 历史兼容参数：当前普通推送已允许任意 AI 结果，temp_link 不再额外改变推送资格
  const tempLink = input.tempLink === true;
  // 静默生成：只生成链接，不自动发送飞书卡片给面试官/业务方
  const silent = input.silent === true;
  // 仅新建批次时发送卡片（AI 自动推送：追加到已有批次不重复打扰）
  const notifyNewBatchOnly = input.notifyNewBatchOnly === true;
  const appendTo = typeof input.batchId === 'string' && input.batchId.trim()
    ? input.batchId.trim()
    : null;
  const user: HrUser = context.user || { id: 'system', email: '', role: 'system', full_name: '系统自动' };

  const nowIso = deps.now();
  const resumes = await deps.store.listResumesByIds(db, ids);
  const resumesById = new Map(resumes.map((resume) => [resume.id, resume]));
  const rawPositionTitles = uniqueStrings(resumes.map((resume) => text(resume.mapped_position) || text(resume.position_applied)));
  const mappings = await deps.store.listPositionMappings(db, rawPositionTitles);
  const standardByRaw = new Map(mappings.map((mapping) => [mapping.raw_name, mapping.mapped_name]));
  const resolveStandardTitle = (rawTitle: string): string => standardByRaw.get(rawTitle) || rawTitle;
  const positionTitles = uniqueStrings(rawPositionTitles.map(resolveStandardTitle));
  const positions = await deps.store.listPositionsByTitles(db, positionTitles);
  const positionsByTitle = new Map(positions.map((position) => [position.title, position]));
  const responsibleNames = uniqueStrings(positions.flatMap((position) => [position.responsible_person]));
  const interviewerDirectoryRows = await deps.store.listInterviewerDirectory(db, responsibleNames);
  const interviewerDirectory = new Map(interviewerDirectoryRows.map((entry) => [entry.name, entry]));

  const skipped: Array<{ id: string; reason: string }> = [];
  const eligibleResumes: BusinessScreeningResumeRecord[] = [];
  const eligibilityOptions = tempLink ? { skipAiCheck: true, skipPushStateCheck: true } : undefined;
  for (const id of ids) {
    const resume = resumesById.get(id);
    if (!resume) {
      skipped.push({ id, reason: '简历不存在' });
      continue;
    }
    const rawTitle = text(resume.mapped_position) || text(resume.position_applied);
    const positionTitle = resolveStandardTitle(rawTitle);
    const position = positionsByTitle.get(positionTitle);
    const groups = groupEligibleResumesForPush([resume], positions, interviewerDirectoryRows, resolveStandardTitle, eligibilityOptions);
    if (groups.size === 0) {
      const reason = summarizeSkipReason(resume, position, interviewerDirectory, eligibilityOptions);
      skipped.push({ id, reason });
      continue;
    }
    eligibleResumes.push(resume);
  }

  // 临时链接模式（模式 B）：直接放入用户指定简历，不做同名档案优选替换
  // （优选替换在无责任人的同名岗位组合下会异常，且临时链接本就不需要）
  const eligible = tempLink
    ? eligibleResumes
    : await optimizeResumesForProfile(db, deps, eligibleResumes, resolveStandardTitle);
  const grouped = groupEligibleResumesForPush(eligible, positions, interviewerDirectoryRows, resolveStandardTitle, eligibilityOptions);
  const sender = await resolveSenderEmail(context.env, user, deps);
  const currentUserToken = sender.email ? await deps.getCurrentUserToken(context.env, sender.email) : null;
  const keyNoSenderReason = user.id === 'api-key' && !sender.email ? sender.reason : null;
  const pushedResumeIds = uniqueStrings([...grouped.values()].flatMap((group) => group.resumes.map((resume) => resume.id)));
  const failed: Array<{ interviewer: string; reason: string }> = [];
  const batches: Array<{ batchId: string; interviewer: string; url: string; itemCount: number; expiresAt: string | null; title?: string; subtitle?: string }> = [];
  const dispatchGroupId = deps.uuid();

  for (const group of grouped.values()) {
    // 固定业务范围改为“面试官”：同一面试官跨岗位、跨多次推送复用同一个有效链接，
    // 简历只追加到同一批次；批次过期后才创建新周期链接。
    const scopeKey = group.interviewer.openId;
    // 临时链接模式（模式 B）：默认每次生成独立新批次/新链接（内容=当次范围），
    // 不复用 scope 固定批次，避免与推送链接内容互相污染；
    // 支持 input.batchId 显式指定追加到某批次（大批量分批归拢同一链接用）。
    let existing: ResumePushBatchRow | null = null;
    if (appendTo) {
      existing = await deps.store.loadBatchById(db, appendTo);
    } else if (!tempLink) {
      existing = await deps.store.loadBatchByScope(db, scopeKey, nowIso);
      // 兼容已上线的旧批次：旧版 scope_key 为“岗位::面试官”，仍沿用其原链接，
      // 后续新批次才统一写入面试官 scope。
      if (!existing) {
        existing = await deps.store.loadBatchByInterviewer(db, group.interviewer.openId, nowIso);
      }
      if (!existing) {
        existing = await deps.store.loadLatestBatchByInterviewer(db, group.interviewer.openId);
      }
    }
    const tokenScopeKey = existing?.scope_key?.trim() || scopeKey;
    const itemCreatedAt = deps.now();
    const expiresAt = resolveExpiresAt(nowIso, input.expiresInDays);
    const batchTitle = requestedTitle ?? existing?.batch_title ?? null;
    const batchSubtitle = requestedSubtitle ?? existing?.batch_subtitle ?? null;
    const isNewBatch = !existing;

    let batchId: string;
    if (existing) {
      batchId = existing.id;
      // 上一批简历已处理完（completed）时复用链接追加新简历，需重新激活
      await deps.store.resetBatchActive(db, batchId);
      await deps.store.refreshBatchExpiry(db, batchId, expiresAt);
      await deps.store.updateBatchPresentation(db, batchId, {
        title: requestedTitle,
        subtitle: requestedSubtitle,
      });
    } else {
      batchId = deps.uuid();
    }
    // 链接由 scope + batchId 确定：有效期内复用同一批次 → 同一链接；过期新建批次 → 新链接
    const issued = await deps.createScopePublicToken(tokenScopeKey, batchId);
    const url = `${context.origin}/business-screening/${issued.token}`;
    const items: CreateResumePushBatchItemInput[] = group.resumes.map((resume) => {
      const rawTitle = text(resume.mapped_position) || text(resume.position_applied);
      const standardTitle = resolveStandardTitle(rawTitle);
      return {
        id: deps.uuid(),
        batchId,
        resumeId: resume.id,
        positionId: resume.position_id || positionsByTitle.get(standardTitle)?.id || null,
        createdAt: itemCreatedAt,
        dispatchGroupId,
      };
    });

    if (existing) {
      await deps.store.appendBatchItemsIfAbsent(db, items);
    } else {
      await deps.store.createBatch(db, {
        id: batchId,
        interviewerId: group.interviewer.userId || null,
        interviewerName: group.interviewer.name,
        interviewerOpenId: group.interviewer.openId,
        tokenHash: issued.tokenHash,
        expiresAt,
        createdBy: input.createdBy || user.email || 'system',
        createdAt: nowIso,
        lastSentAt: null,
        dispatchGroupId,
        batchTitle,
        batchSubtitle,
        scopeKey,
      }, items);
    }
    await deps.store.markResumesPushed(db, group.resumes.map((resume) => resume.id), batchId, dispatchGroupId);
    const pendingCount = await deps.store.countPendingBatchItems(db, batchId);

    batches.push({
      batchId,
      interviewer: group.interviewer.name,
      url,
      itemCount: items.length,
      expiresAt,
      title: batchTitle || undefined,
      subtitle: batchSubtitle || undefined,
    });

    const shouldSendCard = !silent && (!notifyNewBatchOnly || isNewBatch);
    if (shouldSendCard) {
      if (!currentUserToken) {
        // 登录态/API Key 手动推送：记录失败原因；系统自动推送：静默跳过
        if (user.id && user.id !== 'system') {
          failed.push({
            interviewer: group.interviewer.name,
            reason: keyNoSenderReason || '当前账号未授权飞书身份，无法发送业务筛选链接',
          });
        }
        continue;
      }

      try {
        const positionTitle = group.positionTitles.length === 1
          ? group.positionTitles[0]
          : `多个岗位（${group.positionTitles.length}个）`;
        await deps.sendFeishuMessageToUser(currentUserToken, group.interviewer.openId, buildFeishuCard({
          positionTitle,
          itemCount: pendingCount,
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
  }

  return {
    ok: failed.length === 0,
    pushed: pushedResumeIds,
    skipped,
    failed,
    batches,
  };
}


async function queryAll<T>(db: D1Database, sql: string, values: unknown[]): Promise<T[]> {
  const result = await db.prepare(sql).bind(...values).all<T>();
  return result.results;
}

function placeholders(count: number): string {
  return new Array(count).fill('?').join(', ');
}

export function createD1BusinessScreeningRouteStore(resolveExactInterviewerOpenId: (db: D1Database, name: string) => Promise<string | null>): BusinessScreeningRouteStore {
  const visibleBatchItemClause = buildBusinessScreeningBatchItemVisibilityClause('r');

  return {
    async listResumesByIds(db, ids) {
      if (ids.length === 0) return [];
      return queryAll<BusinessScreeningResumeRecord>(
        db,
        `SELECT id, candidate_name, email, contact, screening_result, status, hr_disposition,
                mapped_position, position_applied, position_id, business_screening_status,
                business_screening_remark, business_screened_at, business_screened_by,
                business_screening_batch_id, business_screening_dispatch_group_id, education, work_experience, hr_review, rejected_at
           FROM resumes
          WHERE id IN (${placeholders(ids.length)})`,
        ids,
      );
    },
    async listPositionsByTitles(db, titles) {
      if (titles.length === 0) return [];
      return queryAll(db,
        `SELECT id, title, primary_interviewer, secondary_interviewer, responsible_person
           FROM positions
          WHERE title IN (${placeholders(titles.length)})`,
        titles,
      ) as Promise<Array<{ id: string; title: string; primary_interviewer?: string | null; secondary_interviewer?: string | null; responsible_person?: string | null }>>;
    },
    async listPositionMappings(db, rawNames) {
      if (rawNames.length === 0) return [];
      return queryAll(
        db,
        `SELECT raw_name, mapped_name
           FROM position_mappings
          WHERE raw_name IN (${placeholders(rawNames.length)})`,
        rawNames,
      ) as Promise<Array<{ raw_name: string; mapped_name: string }>>;
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
    async findSameNameProfiles(db, names, excludeResumeId) {
      if (names.length === 0) return [];
      const uniqueNames = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
      if (uniqueNames.length === 0) return [];
      let sql = `SELECT id, candidate_name, screening_result, mapped_position, position_applied, parsed_data, education, work_experience, gender, birthday, certifications, self_evaluation
                   FROM resumes
                  WHERE candidate_name IN (${placeholders(uniqueNames.length)})
                    AND (parsed_data IS NOT NULL OR education IS NOT NULL OR work_experience IS NOT NULL
                         OR gender IS NOT NULL OR birthday IS NOT NULL OR certifications IS NOT NULL OR self_evaluation IS NOT NULL)`;
      const values: unknown[] = [...uniqueNames];
      if (excludeResumeId) {
        sql += ' AND id != ?';
        values.push(excludeResumeId);
      }
      return queryAll<SameNameProfileRow>(db, sql, values);
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
        dispatchGroupId: batch.dispatchGroupId,
        batchTitle: batch.batchTitle || null,
        batchSubtitle: batch.batchSubtitle || null,
        scopeKey: batch.scopeKey || null,
      });
      await insertResumePushBatchItems(db, items);
    },
    async markResumesPushed(db, resumeIds, batchId, dispatchGroupId) {
      await markResumesPushed(db, resumeIds, batchId, dispatchGroupId);
    },
    async loadBatchByTokenHash(db, tokenHash) {
      return loadResumePushBatchByTokenHash(db, tokenHash);
    },
    async loadBatchById(db, batchId) {
      return await db.prepare(
        `SELECT id, interviewer_id, interviewer_name, interviewer_open_id, token_hash, expires_at, status, created_by, created_at, last_sent_at, dispatch_group_id, batch_title, batch_subtitle, scope_key
           FROM resume_push_batches
          WHERE id = ?
          LIMIT 1`,
      ).bind(batchId).first<ResumePushBatchRow>();
    },
    async loadBatchByScope(db, scopeKey, nowIso) {
      return await db.prepare(
        `SELECT id, interviewer_id, interviewer_name, interviewer_open_id, token_hash, expires_at, status, created_by, created_at, last_sent_at, dispatch_group_id, batch_title, batch_subtitle, scope_key
           FROM resume_push_batches
          WHERE scope_key = ?
            AND status IN ('active', 'completed')
            AND (expires_at IS NULL OR expires_at > ?)
          ORDER BY created_at DESC
          LIMIT 1`,
      ).bind(scopeKey, nowIso).first<ResumePushBatchRow>();
    },
    async loadBatchByInterviewer(db, interviewerOpenId, nowIso) {
      return await db.prepare(
        `SELECT id, interviewer_id, interviewer_name, interviewer_open_id, token_hash, expires_at, status, created_by, created_at, last_sent_at, dispatch_group_id, batch_title, batch_subtitle, scope_key
           FROM resume_push_batches
          WHERE interviewer_open_id = ?
            AND scope_key IS NOT NULL
            AND status IN ('active', 'completed')
            AND (expires_at IS NULL OR expires_at > ?)
          ORDER BY created_at DESC
          LIMIT 1`,
      ).bind(interviewerOpenId, nowIso).first<ResumePushBatchRow>();
    },
    async loadLatestBatchByInterviewer(db, interviewerOpenId) {
      return loadLatestResumePushBatchByInterviewer(db, interviewerOpenId);
    },
    async listActiveBatchesByInterviewer(db, interviewerName, nowIso) {
      return queryAll<ResumePushBatchRow>(
        db,
        `SELECT id, interviewer_id, interviewer_name, interviewer_open_id, token_hash, expires_at, status, created_by, created_at, last_sent_at, dispatch_group_id, batch_title, batch_subtitle, scope_key
           FROM resume_push_batches
          WHERE interviewer_name = ?
            AND status IN ('active', 'completed')
            AND (expires_at IS NULL OR expires_at > ?)
          ORDER BY created_at DESC`,
        [interviewerName, nowIso],
      );
    },
    async resetBatchActive(db, batchId) {
      await db.prepare("UPDATE resume_push_batches SET status = 'active' WHERE id = ?")
        .bind(batchId)
        .run();
    },
    async refreshBatchExpiry(db, batchId, expiresAt) {
      await refreshResumePushBatchExpiry(db, batchId, expiresAt);
    },
    async updateBatchPresentation(db, batchId, presentation) {
      await db.prepare(
        `UPDATE resume_push_batches
            SET batch_title = COALESCE(?, batch_title),
                batch_subtitle = COALESCE(?, batch_subtitle)
          WHERE id = ?`,
      ).bind(
        presentation.title ?? null,
        presentation.subtitle ?? null,
        batchId,
      ).run();
    },
    async appendBatchItemsIfAbsent(db, items) {
      await insertResumePushBatchItemsIfAbsent(db, items);
    },
    async listBatchItems(db, batchId) {
      return queryAll<BusinessScreeningBatchItemView>(
        db,
        `SELECT i.id, i.batch_id, i.resume_id, i.position_id, i.status, i.remark, i.processed_at, i.created_at, i.dispatch_group_id,
                r.candidate_name, r.mapped_position, r.position_applied, r.email, r.contact, r.education, r.work_experience, r.parsed_data,
                r.hr_disposition, r.business_screening_status, r.business_screening_remark, r.business_screened_at,
                r.ocr_markdown, r.raw_text, r.resume_markdown, r.ai_review, r.ai_evaluation, r.match_score, r.capability_scores, r.hard_requirement_result, r.screening_result, r.gender, r.birthday, r.certifications, r.self_evaluation
           FROM resume_push_batch_items i
           JOIN resumes r ON r.id = i.resume_id
          WHERE i.batch_id = ?
            AND ${visibleBatchItemClause}
          ORDER BY i.created_at ASC`,
        [batchId],
      );
    },
    async loadBatchItem(db, batchId, resumeId) {
      return await db.prepare(
        `SELECT i.id, i.batch_id, i.resume_id, i.position_id, i.status, i.remark, i.processed_at, i.created_at, i.dispatch_group_id,
                r.candidate_name, r.mapped_position, r.position_applied, r.email, r.contact, r.education, r.work_experience, r.parsed_data,
                r.hr_disposition, r.business_screening_status, r.business_screening_remark, r.business_screened_at,
                r.ocr_markdown, r.raw_text, r.resume_markdown, r.ai_review, r.ai_evaluation, r.match_score, r.capability_scores, r.hard_requirement_result, r.screening_result, r.gender, r.birthday, r.certifications, r.self_evaluation
           FROM resume_push_batch_items i
           JOIN resumes r ON r.id = i.resume_id
          WHERE i.batch_id = ? AND i.resume_id = ?
            AND ${visibleBatchItemClause}
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
           JOIN resumes r ON r.id = resume_push_batch_items.resume_id
          WHERE resume_push_batch_items.batch_id = ?
            AND resume_push_batch_items.status = 'pending'
            AND ${visibleBatchItemClause}`,
      ).bind(batchId).first<{ count: number }>();
      return Number(row?.count || 0);
    },
  };
}
