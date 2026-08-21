import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createOrGetActiveJob, recoverStaleResumeProcessingJobs } from './resume-processing/job-repository';
import { normalizeResumeFields } from './resume-processing/fields';
import { ensureResumeListSchema, exposeStructuredEvaluation, RESUME_LIST_COMPATIBILITY_MIGRATIONS } from './resume-schema';
import { assertShareDataMode, createShareExpiry, hashShareToken, isShareLinkActive, toPublicBoardRow, toShanghaiSnapshotDate } from './recruiting-operations/share-links';
import { createUploadRoutes } from './resume-uploads/routes';
import { createMaintenanceRoutes } from './resume-maintenance/routes';
import { handleR2Upload } from './resume-uploads/refactored-upload';
import { handleOptimizedResumeList } from './resume-list/optimized-handler';
import {
  exposeBusinessScreeningState,
  isBusinessScreeningStatusFilter,
  matchesBusinessScreeningStatusFilter,
} from './resume-list/business-screening-status';
import { filterDimensionScoresToConfigured, normalizeDimensionScores, normalizeScreeningEvaluation, requireCompleteScreeningEvaluation } from './resume-processing/dimension-scores';
import { buildScreeningRulesPrompt, evaluateWeightedScreening, normalizeScreeningPrompt, WEIGHTED_SCREENING_DIMENSION_NAMES, WEIGHTED_SCREENING_PROMPT } from './resume-processing/weighted-screening';
import { DEFAULT_SCREENING_RULES, normalizeScreeningRuleValues, resolveScreeningRules, type ResolvedScreeningRules, type ScreeningRuleValues } from './resume-processing/screening-rules';
import { enqueueResumeReprocess, enqueueResumeReprocessBatchForIds, recoverStalledHistoricalResumeReprocess, ResumeNotFoundError, selectVisibleResumeIdsForReprocess, startHistoricalResumeReprocess, selectResumeIdsForBatchScope } from './resume-processing/reprocess';
import { cancelReprocessBatch, getReprocessBatchView, getActiveReprocessBatchView, appendEvaluationJobProjection } from './resume-processing/batch-repository';
import type { ReprocessScope, ResumeProcessingQueueMessage } from './resume-processing/types';
import { logResumeProcessing, logResumeProcessingError } from './resume-processing/logging';
import { buildCapabilityDimensionsFullText, normalizeCapabilityDimensionsForStorage } from './position-capability-sync';
import { fetchFeishuLinkContent } from './feishu-link';
import { mergeLlmSlots } from './llm-slots';
import { aiScreeningResultFromScore, normalizeAiScreeningResult } from './ai-screening-result';
import { buildScreeningQueuePersistence } from './resume-processing/screening-queue-evaluation';
import { buildFeishuScreeningMirror } from './resume-processing/screening-mirror';
import { buildPositionMappingFromRows, resolveMappedPosition } from './position-mapping';
import { mergeInterviewerDirectoryEntries } from './interviewer-directory';
import {
  buildPositionDefaultsIndex,
  resolvePositionDefaults,
  resolveInterviewAssignments as resolveInterviewAssignmentsFromDefaults,
  resolveStoredInterviewAssignments,
} from './interviewer-assignment';
import { buildInterviewReminderView, deliverInterviewReminder } from './feishu-notifications/interview-reminder';
import { loadInterviewReminderSource, resolveExactInterviewerOpenId, resolveReminderInterviewer } from './feishu-notifications/reminder-source';
import { markUserTokenRefreshFailed, saveRefreshedUserToken } from './feishu-notifications/user-token-storage';
import { ensureBusinessScreeningSchema } from './business-screening/repository';
import { createBusinessScreeningRoutes, createD1BusinessScreeningRouteStore } from './business-screening/routes';
import { createPublicToken, createScopePublicToken, hashPublicToken } from './business-screening/token';
import { syncAiResultToBusinessScreening, buildBusinessScreeningAutoLinkDeps } from './business-screening/auto-link';
import { createInterviewCardRoutes, createOrReuseInterviewCardLink } from './interview-card/routes';
import { createInterviewAutomationRoutes } from './interview-automation/routes';
import { createInterviewCalendarEvent, findFirstFreeInterviewSlot, listFreeInterviewSlots, updateInterviewCalendarEventTime } from './interview-start/feishu-calendar';
import { findAvailableMeetingRooms } from './interview-start/meeting-rooms';
import { sendInterviewerInterviewReminder, sendFeishuTextMessage } from './interview-start/reminders';
import {
  frontendBaseUrl,
  loadInterviewStartContext,
  parseInterviewTimeToMs,
  resolveEventTimeframe,
  sendCandidateInterviewEmail,
} from './interview-start/service';
import { isSmtpConfigured } from './interview-start/smtp';
import { createPublicQueryRoutes } from './public-api/routes';
import { resolveInterviewerName } from './public-api/helpers';
import { getMiaodaMailSyncConfig } from './mail-sync/config';
import {
  assertDailyReportDate,
  claimScreeningQueueRecord,
  commitScreeningDecisionAtomically,
  DailyReportDeliveryError,
  generateAndPersistDailyReport,
  generatePersistAndDeliverDailyReport,
  getShanghaiReportDate,
  mapHrDecision,
  recordResumeDecisionTimestamp,
  releaseScreeningQueueClaim,
  runDailyReportPipeline,
  sendStoredDailyReport,
  DailyReportTargetMissingError,
  type DailyReportGenerationDependencies,
} from './daily-reports/service';
import type { DailyReportSnapshot } from './daily-reports/report';


import type { ShareExpiryOption } from './recruiting-operations/types';
import { buildResumeIngestionIdentity } from './recruiting-operations/resume-ingestion';
import { loadD1DashboardOverlay, type D1DashboardOverlay } from './recruiting-operations/d1-dashboard-overlay';
import { buildDashboardV3, scopeDashboardV3Board } from './recruiting-operations/dashboard-v3';
import { buildDashboardReconciliation } from './recruiting-operations/dashboard-reconciliation';
import { normalizeFeishuPositionRecord, type FeishuBoardSourceRecord, type FeishuPositionMetric } from './recruiting-operations/feishu-board-source';
import {
  buildDashboardFeishuSources,
  listDashboardBitableRecords,
  type DashboardFeishuSourceEnv,
} from './recruiting-operations/dashboard-feishu-user-source';
import { loadStaticDashboardPositions, STATIC_DASHBOARD_SNAPSHOT_DATE, STATIC_DASHBOARD_UPDATED_AT } from './recruiting-operations/dashboard-static-source';
import type { DashboardV3Board } from './recruiting-operations/dashboard-v3-types';
import {
  buildRecruitingBoard,
  getBoardFirstInterviewCount,
  getBoardInterviewPassCondition,
  groupBoardRows,
  toPublicRecruitingBoard as toPublicRecruitingBoardV2,
} from './recruiting-operations/dashboard';
import type { RecruitingBoard, RecruitingBoardPositionRow } from './recruiting-operations/dashboard';
import { InterviewAutomationRepository } from './interview-automation/repository';
import { enqueueInterviewAutomation } from './interview-automation/enqueue';
import type { InterviewAutomationQueueMessage } from './interview-automation/types';

export {
  getBoardFirstInterviewCount,
  getBoardInterviewPassCondition,
  groupBoardRows,
} from './recruiting-operations/dashboard';
export type { RecruitingBoard, RecruitingBoardDivisionRow, RecruitingBoardPositionRow } from './recruiting-operations/dashboard';

interface Env extends DashboardFeishuSourceEnv {
  DB: D1Database;
  SECRET_KEY: string;
  AI_API_KEY: string;
  AI_BASE_URL: string;
  AI_MODEL?: string;
  AI_DAILY_TOKEN_LIMIT?: string;
  AI_FALLBACK_ENABLED?: string;
  AI: Ai;
  FEISHU_APP_ID?: string;
  FEISHU_APP_SECRET?: string;
  FEISHU_BITABLE_APP_TOKEN?: string;
  FEISHU_REQUISITION_TABLE_ID?: string;
  FEISHU_POSITION_TABLE_ID?: string;
  FEISHU_TALENT_TABLE_ID?: string;
  FEISHU_ZHIPEI_RECRUITMENT_TABLE_ID?: string;
  FEISHU_YANGLAO_RECRUITMENT_TABLE_ID?: string;
  // 仪表盘专用：使用已 OAuth 授权用户读取两张有权限的多维表
  FEISHU_DASHBOARD_USER_EMAIL?: string;
  FEISHU_DASHBOARD_ZHIPEI_APP_TOKEN?: string;
  FEISHU_DASHBOARD_ZHIPEI_TABLE_ID?: string;
  FEISHU_DASHBOARD_ZHIPEI_VIEW_ID?: string;
  FEISHU_DASHBOARD_YANGLAO_APP_TOKEN?: string;
  FEISHU_DASHBOARD_YANGLAO_TABLE_ID?: string;
  FEISHU_DASHBOARD_YANGLAO_VIEW_ID?: string;
  FEISHU_RECRUITMENT_GROUP_CHAT_ID?: string;
  FEISHU_OAUTH_REDIRECT_URI?: string;
  RESUMES_KV?: KVNamespace;
  CRON_SECRET?: string;
  RESUME_UPLOAD_API_KEY?: string; // 对外简历上传接口的 API Key（x-api-key header）
  MIAODA_API_KEY?: string; // 妙搭邮件同步 OpenAPI 鉴权密钥
  MIAODA_MAIL_SYNC_BASE_URL?: string; // 妙搭邮件同步 OpenAPI 基础地址
  RESUME_PROCESSING_QUEUE: Queue<ResumeProcessingQueueMessage>;
  INTERVIEW_AUTOMATION_QUEUE?: Queue<InterviewAutomationQueueMessage>;
  INTERVIEW_AUTOMATION_ENABLED?: string;
  FEISHU_RECRUITMENT_CALENDAR_ID?: string;
}

// 飞书配置（非敏感 ID 类配置；appSecret 必须通过环境变量 FEISHU_APP_SECRET 提供：
// 生产 = wrangler pages secret put，本地 = frontend/.dev.vars，均不入库）
const FEISHU_CONFIG = {
  appId: 'cli_aad2cb7fab385cb6',
  appToken: 'NVh9bDiNRaF0ZysxjeLc5ID2n9c',
  // 招聘任务表：含招聘岗位、部门、城市、人数、紧急度、JD等具体需求数据
  requisitionTableId: 'tblEiMBFXcvSspQd',
  // 年度招聘需求表：含岗位定义、薪资范围、能力维度等模板数据
  positionTableId: 'tblnT0AHtiLsvMeB',
  // 人才库表：小七系统写入的已入库候选人数据
  talentTableId: 'tblWkwsoTIPhzusI',
  // 审核人 open_id（AI分析后发卡片给谁）
  reviewerOpenId: 'ou_7c59c0b6f4be0717cc9202aa261ae04a',
  // 招聘群 Chat ID（用于「提醒面试官」推送）
  recruitmentGroupChatId: '',
  // 面试官 open_id 映射（姓名 → open_id，用于提醒面试官）
  interviewerOpenIds: {
    "曾颖": "ou_39a7046c231335fd28f0cedc61c30185",
    "杜雁玲": "ou_a6087857e92467972ad2070ca5219dca",
    "王彦强": "ou_66f58c7b6db1e92d637d03ada32dc0d7",
    "徐晟": "ou_54e99e9c884841558c968ee0bfda7c9c",
    "何雨菱": "ou_6ef1ac4432e825acd26c2a3bc7202fea",
    "石磊": "ou_dbc15e29e3d189ac73440e1edb7c6625",
    "韩悦": "ou_4b554b16837fb118405d1b75397729e",
    "李兴": "ou_5f8edce3b1180dda025ffcca2cad5e41",
    "王邺辉": "ou_6f57a77b82a1bd53c845a66e27af3170",
    "严鹏": "ou_ef906466a58b71dc3d6d27d7ce0f68cc",
    "魏冰": "ou_3772f691a70f636db73173f6326f03b",
    "黄雁": "ou_b41ffd621300271ce7241b8e2439f6a",
    "魏秋柠": "ou_35683c77de559475379929138391eac",
    "林烽": "ou_975ee740fe8c2e2ea0ce2f1db999bf5f",
    "丰文杰": "ou_c4589dc9d7d49793d14d93a636f85aa1",
    "胡顺": "ou_1f014a0f2fa5f2889917435e1ec01381",
    "张继鹏": "ou_dc096d1c92efacac5d1cbcf550016e2b",
    "彭创": "ou_00c40dbb8254f9db022c52b1a0868fe8",
    "陈宇佳": "ou_ebeb4c63d55ed4c9ac736dd3941e69f",
    "王嘉伟": "ou_f818646bc1578fcef79e7bdf24fed7b0",
    "宗莎": "ou_0bacd6231d3eda000a86e070cc19674c",
    "谭维": "ou_63b2097647cb67d74446219b69ef5d5",
    "欧阳剑": "ou_2127d082f0c3517ae18989ed17b0fb1d",
    "吴思为": "ou_af4f671ef7f608a1d47035a386db8f7e",
    "李博": "ou_1622b65c8d2af2a302afed7983ba9e51",
    "李双": "ou_38313f315accf8f1b38583242b04db2f",
    "范金荣": "ou_b43dbc4416047f4808ad5655b6e49f09",
    "黄维": "ou_a4289f67a7465b16a97db8d16987d6e3",
    "帕合尔尼沙·阿不里孜": "ou_60410a0f83db41fb936a6b76ee575cc1",
  } as Record<string, string>,
  // 默认 HR open_id（作为面试官提醒的兜底）
  defaultHrOpenId: 'ou_7c59c0b6f4be0717cc9202aa261ae04a',
  // Drive 目标文件夹 Token（上传简历用）
  driveFolderToken: '',
};

// 简单内存缓存，减少飞书 Bitable 重复请求
const BITABLE_CACHE_TTL = 300_000; // 5分钟，减少飞书 API 重复请求
const bitableCache = new Map<string, { data: any[]; expiry: number }>();

// CORS 白名单：仅允许已知前端域名
const ALLOWED_ORIGINS = [
  'http://localhost:5173',   // Vite dev server
  'http://localhost:4173',   // Vite preview
  'http://localhost:8000',   // wrangler pages dev
  'https://ai-interview-88r.pages.dev', // 生产
];

function getAllowedOrigin(origin: string | undefined | null): string | null {
  if (origin && ALLOWED_ORIGINS.includes(origin)) return origin;
  return null;
}

const app = new Hono<{ Bindings: Env }>();
app.use('*', cors({
  origin: (origin) => getAllowedOrigin(origin) ?? '',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  maxAge: 86400,
}));

// ==================== Crypto Utilities ====================

async function hmacSha256(key: string, message: string): Promise<ArrayBuffer> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw', enc.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  );
  return crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message));
}

function bufToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function b64ToBuf(s: string): Uint8Array {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}


// ==================== Resume File Storage（KV 优先，D1 兜底）====================
// 简历 PDF 不存 D1（SQLITE_TOOBIG ~1.6MB 限制），优先存 KV（25MB 限制）；
// D1 resume_files 只留元数据，旧数据（content 列有 base64）继续兼容。
async function storeResumeFile(
  env: Env,
  id: string,
  fileName: string,
  fileSize: number,
  bytes: ArrayBuffer | Uint8Array,
): Promise<void> {
  const key = 'kv_' + id;
  const body = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const kv = env.RESUMES_KV;
  if (kv) {
    await kv.put(key, body, { metadata: { fileName, fileSize } });
    await env.DB.prepare(
      "INSERT OR REPLACE INTO resume_files (id, kv_key, file_name, file_size, content, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))"
    ).bind(id, key, fileName, fileSize, '').run();
    return;
  }
  const b64 = bufToB64(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer);
  await env.DB.prepare(
    "INSERT OR REPLACE INTO resume_files (id, kv_key, file_name, file_size, content, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))"
  ).bind(id, key, fileName, fileSize, b64).run();
}

export async function getResumeFileBytes(
  env: Env,
  id: string,
): Promise<{ bytes: Uint8Array | null; fileName: string }> {
  const row: any = await env.DB.prepare('SELECT content, kv_key, file_name FROM resume_files WHERE id = ?').bind(id).first();
  if (row?.content) {
    return { bytes: b64ToBuf(row.content), fileName: row.file_name || 'resume.pdf' };
  }
  const kv = env.RESUMES_KV;
  if (kv) {
    const value = await kv.get(row?.kv_key || 'kv_' + id, 'arrayBuffer');
    if (value) return { bytes: new Uint8Array(value), fileName: row?.file_name || 'resume.pdf' };
  }
  return { bytes: null, fileName: row?.file_name || 'resume.pdf' };
}

async function deleteResumeFile(env: Env, id: string): Promise<void> {
  try {
    const row: any = await env.DB.prepare('SELECT kv_key FROM resume_files WHERE id = ?').bind(id).first();
    const kv = env.RESUMES_KV;
    if (kv) {
      const keys = row?.kv_key ? [row.kv_key, 'kv_' + id] : ['kv_' + id];
      await Promise.all(keys.map((key) => kv.delete(key).catch(() => {})));
    }
  } catch {}
}

function b64url(s: string): string {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlBuf(buf: ArrayBuffer): string {
  return bufToB64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function createJwt(secretKey: string, email: string): Promise<string> {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const exp = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
  const payload = b64url(JSON.stringify({ sub: email, exp }));
  const data = `${header}.${payload}`;
  const sig = await hmacSha256(secretKey, data);
  return `${data}.${b64urlBuf(sig)}`;
}

async function verifyJwt(secretKey: string, token: string): Promise<any | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts;
  const data = `${header}.${payload}`;
  const expectedSig = b64urlBuf(await hmacSha256(secretKey, data));
  if (sig !== expectedSig) return null;
  try {
    const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const obj = JSON.parse(decoded);
    if (obj.exp && obj.exp < Math.floor(Date.now() / 1000)) return null;
    return obj;
  } catch { return null; }
}

async function hashPassword(secretKey: string, password: string): Promise<string> {
  return bufToB64(await hmacSha256(secretKey, password));
}

async function verifyPassword(secretKey: string, password: string, hash: string): Promise<boolean> {
  const computed = await hashPassword(secretKey, password);
  // timing-safe 比较：将两个 base64 字符串转为等长 Uint8Array 后常量时间比较，防止时序侧信道
  try {
    const a = new TextEncoder().encode(computed);
    const b = new TextEncoder().encode(hash);
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
  } catch {
    return false;
  }
}


// ==================== AI Helper ====================

// 从 system_configs 读取自定义 prompt，没有则返回 null
export async function getCustomPrompt(env: Env, key: string): Promise<{ system: string; user: string } | null> {
  try {
    const row = await env.DB.prepare(
      'SELECT prompt_configs FROM system_configs ORDER BY updated_at DESC LIMIT 1'
    ).first() as any;
    if (!row?.prompt_configs) return null;
    const configs = JSON.parse(row.prompt_configs);
    const prompts = configs.prompts || configs;
    return prompts[key] || null;
  } catch {
    return null;
  }
}

// 获取 AI prompt：优先读取用户自定义模板，否则返回默认值
export async function getAIPrompt(env: Env, key: string, defaultPrompt: { system: string; user: string }): Promise<{ system: string; user: string }> {
  const custom = await getCustomPrompt(env, key);
  const prompt = custom?.system && custom?.user
    ? { system: custom.system, user: custom.user }
    : defaultPrompt;
  return normalizeScreeningPrompt(key, prompt);
}

// 纠正常见的错误 Base URL（DeepSeek 官方地址是 api.deepseek.com，不是 platform.deepseek.com）
function normalizeBaseUrl(raw: string | undefined | null): string {
  const u = (raw || '').trim();
  if (!u) return '';
  const lower = u.toLowerCase().replace(/\/+$/, '');
  // platform.deepseek.com / platform.deepseek.com/v1 等均指向错误域名
  if (lower.includes('platform.deepseek.com')) {
    return 'https://api.deepseek.com';
  }
  return u.replace(/\/+$/, '');
}

// 兼容旧版固定 4 槽位格式：llm*/llm2*/llm3*/llm4* 列名
function validLLMSlotKey(k: string): boolean {
  return /^llm\d*_base_url$/i.test(k) || /^llm\d*_model$/i.test(k) || /^llm\d*_api_key$/i.test(k);
}

// 从 system_configs 行中读取动态 LLM 配置（llm_slots JSON 列）；
// 若列不存在或为空，则回退到旧 4 槽位列（llm*/llm2*/llm3*/llm4*）以兼容老数据。
// 第 1 槽支持环境变量兜底（本地 dev），其余槽必须显式配置 API Key。
// 仅返回已填写 API Key 的配置，按保存顺序排列。
async function getLLMConfigs(env: Env): Promise<Array<{ apiKey: string; baseUrl: string; model: string }>> {
  let cfg: any = {};
  try {
    const row = await env.DB.prepare(
      'SELECT llm_slots, llm_api_key, llm_base_url, llm_model, llm2_api_key, llm2_base_url, llm2_model, llm3_api_key, llm3_base_url, llm3_model, llm4_api_key, llm4_base_url, llm4_model FROM system_configs ORDER BY updated_at DESC LIMIT 1'
    ).first() as any;
    if (row) cfg = row;
  } catch (e) {
    console.error('[AI] getLLMConfigs read failed:', e);
  }
  // 优先读新列：JSON 数组 [{baseUrl, model, apiKey}, ...]
  const rawSlots: any = cfg.llm_slots;
  const slots = Array.isArray(rawSlots)
    ? rawSlots.filter((s: any) => s && typeof s === 'object')
    : [];
  if (slots.length > 0) {
    const configs: Array<{ apiKey: string; baseUrl: string; model: string }> = [];
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      const apiKey = String(s.apiKey || s.api_key || '').trim();
      const baseUrl = normalizeBaseUrl(String(s.baseUrl || s.base_url || ''));
      const model = String(s.model || '').trim();
      if (!apiKey) continue;
      configs.push({ apiKey, baseUrl: baseUrl || 'https://api.deepseek.com', model: model || 'deepseek-chat' });
    }
    return configs;
  }
  // 回退：旧 4 槽位列
  const groups = [
    { apiKey: cfg.llm_api_key, baseUrl: cfg.llm_base_url, model: cfg.llm_model },
    { apiKey: cfg.llm2_api_key, baseUrl: cfg.llm2_base_url, model: cfg.llm2_model },
    { apiKey: cfg.llm3_api_key, baseUrl: cfg.llm3_base_url, model: cfg.llm3_model },
    { apiKey: cfg.llm4_api_key, baseUrl: cfg.llm4_base_url, model: cfg.llm4_model },
  ];
  const configs: Array<{ apiKey: string; baseUrl: string; model: string }> = [];
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    const apiKey = (g.apiKey && String(g.apiKey).trim()) || (i === 0 ? (env.AI_API_KEY && String(env.AI_API_KEY).trim()) || '' : '');
    const baseUrl = normalizeBaseUrl(g.baseUrl) || (i === 0 ? (env.AI_BASE_URL || 'https://api.deepseek.com') : 'https://api.deepseek.com');
    const model = (g.model && String(g.model).trim()) || (i === 0 ? (env.AI_MODEL || 'deepseek-v4-flash') : '');
    if (apiKey) configs.push({ apiKey, baseUrl, model: model || 'deepseek-chat' });
  }
  return configs;
}

// ==================== AI 每日 Token 限额（防止调试耗光额度）====================
// 测试阶段不限制 AI 每日 token；正式启用成本治理时改为有限数值。
const DEFAULT_DAILY_TOKEN_LIMIT: number | null = null;

function getDailyTokenLimit(_env: Env): number | null {
  return DEFAULT_DAILY_TOKEN_LIMIT;
  /* 成本治理恢复时启用：
  const v = env.AI_DAILY_TOKEN_LIMIT ? parseInt(env.AI_DAILY_TOKEN_LIMIT, 10) : NaN;
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_DAILY_TOKEN_LIMIT;
  */
}

function todayStr(): string {
  // 以 UTC+8 计算“今日”，与国内使用习惯一致
  const now = new Date(Date.now() + 8 * 3600 * 1000);
  return now.toISOString().slice(0, 10); // YYYY-MM-DD
}

async function ensureAiUsageTable(env: Env): Promise<void> {
  try {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS ai_usage (date TEXT PRIMARY KEY, total_tokens INTEGER DEFAULT 0, updated_at TEXT)`
    ).run();
  } catch (e) {
    console.error('[AI] ensureAiUsageTable failed:', e);
  }
}

async function getTodayTokenUsage(env: Env): Promise<number> {
  try {
    const row = await env.DB.prepare('SELECT total_tokens FROM ai_usage WHERE date = ?')
      .bind(todayStr()).first() as any;
    return row?.total_tokens || 0;
  } catch {
    return 0;
  }
}

async function addTokenUsage(env: Env, tokens: number): Promise<void> {
  if (!tokens || tokens <= 0) return;
  try {
    await env.DB.prepare(
      `INSERT INTO ai_usage (date, total_tokens, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(date) DO UPDATE SET total_tokens = total_tokens + excluded.total_tokens, updated_at = excluded.updated_at`
    ).bind(todayStr(), tokens, new Date().toISOString()).run();
  } catch (e) {
    console.error('[AI] addTokenUsage failed:', e);
  }
}

export type AIProvider = 'configured_api' | 'workers_ai';

export type AICallMetadata = {
  provider: AIProvider;
  model: string;
  attempt: number;
  responseChars: number;
  finishReason?: string | null;
  contentChars?: number;
  reasoningChars?: number;
};

export type AICallResult = {
  text: string;
  metadata: AICallMetadata;
};

export type AICallOptions = {
  structured?: boolean;
  maxTokens?: number;
  temperature?: number;
  /** 多配置时起始尝试的配置下标（默认随机）；用于批量任务把并发分摊到不同模型 */
  startIndex?: number;
};

const AI_RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
// 动态 AI 模型槽位上限，超出部分前端隐藏「添加」按钮；旧列 llm2*/llm3*/llm4* 仍兼容读取
export const LLM_SLOT_MAX = 20;

export const AI_REQUEST_TIMEOUT_MS = 90_000;

function isRetryableHttpStatus(status: number): boolean {
  return AI_RETRYABLE_STATUS.has(status);
}

function sleepAI(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildAICallError(code: string, message: string): Error & { code: string } {
  const error = new Error(`${code}: ${message}`) as Error & { code: string };
  error.code = code;
  return error;
}

/**
 * Main AI entry used by the resume consumer. Records which provider/model was
 * actually used, how many attempts were made, and the response length, so batch
 * failures are diagnosable.
 *
 * 配置了多组模型时按优先级从高到低依次尝试，上一组失败（含超时/格式错误/空响应）
 * 自动降级到下一组；全部失败后若 AI_FALLBACK_ENABLED 为 true 才显式降级到 Workers AI。
 */
export async function callAIWithMetadata(
  env: Env,
  systemPrompt: string,
  userPrompt: string,
  model?: string,
  options: AICallOptions = {},
): Promise<AICallResult> {
  const llmConfigs = await getLLMConfigs(env);
  if (llmConfigs.length > 0) {
    // 多配置时默认随机起点：批量并发任务会自然分摊到不同模型（避免全部挤在配置 1）。
    // 从起点按顺序环绕尝试，失败自动降级到下一个模型（含环绕回起点），
    // 即"某个模型报错时由下一个模型顶上"，直到全部尝试完。
    const start = options.startIndex !== undefined
      ? ((options.startIndex % llmConfigs.length) + llmConfigs.length) % llmConfigs.length
      : Math.floor(Math.random() * llmConfigs.length);
    let lastError: unknown = null;
    for (let step = 0; step < llmConfigs.length; step++) {
      const i = (start + step) % llmConfigs.length;
      try {
        return await callConfiguredAIWithMetadata(env, llmConfigs[i], systemPrompt, userPrompt, model, options);
      } catch (error) {
        lastError = error;
        if (step < llmConfigs.length - 1) {
          try {
            console.log(JSON.stringify({
              scope: 'resume-processing',
              event: 'ai.request.fallback',
              provider: 'configured_api',
              config_index: i + 1,
              reason: String((error as any)?.message || error).slice(0, 200),
            }));
          } catch { /* logging must never break the request */ }
        }
      }
    }
    const fallbackEnabled = (env.AI_FALLBACK_ENABLED || '').toLowerCase() === 'true';
    if (!fallbackEnabled) throw lastError || new Error('AI API 调用失败：所有配置均未返回结果');
    try {
      console.log(JSON.stringify({
        scope: 'resume-processing',
        event: 'ai.request.fallback',
        provider: 'configured_api',
        reason: 'all configured providers failed',
      }));
    } catch { /* logging must never break the request */ }
    // explicit fallback to Workers AI below
  }

  if (!env.AI) {
    if (llmConfigs.length > 0) {
      throw new Error('AI API 调用失败且 Workers AI 不可用，请检查 API 配置或 Cloudflare 绑定');
    }
    throw new Error('AI 未配置：请在系统设置中填写 API Key，或在 wrangler.toml 中启用 [ai] 绑定以使用 Cloudflare Workers AI（免费）');
  }
  const text = await runWorkersAI(env, systemPrompt, userPrompt, options);
  return { text, metadata: { provider: 'workers_ai', model: 'workers_ai', attempt: 1, responseChars: text.length } };
}

/** Compatibility wrapper: existing callers keep receiving a plain string. */
export async function callAI(
  env: Env,
  systemPrompt: string,
  userPrompt: string,
  model?: string,
  options: AICallOptions = {},
): Promise<string> {
  const result = await callAIWithMetadata(env, systemPrompt, userPrompt, model, options);
  return result.text;
}

async function runWorkersAI(
  env: Env,
  systemPrompt: string,
  userPrompt: string,
  options: AICallOptions = {},
): Promise<string> {
  const aiModel = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
  async function runModel(name: string): Promise<string> {
    const result: any = await Promise.race([
      env.AI!.run(name, {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: options.maxTokens ?? 4096,
        ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
        ...(options.structured ? { response_format: { type: 'json_object' } } : {}),
      }),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error('Workers AI 调用超时（30s）')), 30000)
      ),
    ]);
    // Handle various response formats from Workers AI
    if (typeof result === 'string') return result;
    if (result?.choices?.[0]?.message?.content) return result.choices[0].message.content;
    if (typeof result?.response === 'string') return result.response;
    if (typeof result?.result?.response === 'string') return result.result.response;
    if (result instanceof Response) return await result.text();
    if (result?.response instanceof ReadableStream) {
      return await new Response(result.response).text();
    }
    return JSON.stringify(result);
  }
  try {
    return await runModel(aiModel);
  } catch (primaryErr: any) {
    try {
      return await runModel('@cf/meta/llama-3.1-8b-instruct');
    } catch (fallbackErr: any) {
      throw new Error(`AI inference failed: ${primaryErr.message}; fallback: ${fallbackErr.message}`);
    }
  }
}

// 调用配置的 API（90 秒超时）。仅对可重试错误码做有限重试（最多 3 次总尝试），
// 格式错误（400/401/403/404）不重试，直接抛出由调用方决定是否显式 fallback。
async function callConfiguredAIWithMetadata(
  env: Env, llm: { apiKey: string; baseUrl: string; model: string },
  systemPrompt: string, userPrompt: string, model?: string, options: AICallOptions = {},
): Promise<AICallResult> {
  // —— 每日 token 限额检查（防止调试耗光额度）——
  await ensureAiUsageTable(env);
  const limit = getDailyTokenLimit(env);
  const usedToday = await getTodayTokenUsage(env);
  if (limit !== null && usedToday >= limit) {
    throw new Error(`AI 已达每日 token 限额（上限 ${limit}，今日已用 ${usedToday}）。为防止额度被耗光已暂停调用，请明日再试，或调高 AI_DAILY_TOKEN_LIMIT。`);
  }

  const baseUrl = llm.baseUrl.replace(/\/+$/, '');
  let aiModel = llm.model || model || 'deepseek-chat';
  if (aiModel === 'deepseek-v4-flash' && baseUrl.includes('api.deepseek.com')) aiModel = 'deepseek-chat';

  const url = baseUrl.endsWith('/v1') ? `${baseUrl}/chat/completions` : `${baseUrl}/v1/chat/completions`;
  let lastError: any = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    const controller = new AbortController();
    const timeoutError = new Error('AI API 调用超时（90s），请检查网络或服务状态');
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        reject(timeoutError);
      }, AI_REQUEST_TIMEOUT_MS);
    });
    try {
      const resp = await Promise.race([
        fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${llm.apiKey}`,
          },
          body: JSON.stringify({
            model: aiModel,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            max_tokens: options.maxTokens ?? 4096,
            ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
            ...(options.structured ? { response_format: { type: 'json_object' } } : {}),
          }),
          signal: controller.signal,
        }),
        timeoutPromise,
      ]);

      if (!resp.ok) {
        const errText = await Promise.race([resp.text(), timeoutPromise]);
        const status = resp.status;
        if (status === 400 && options.structured && /response_format|json_object/i.test(errText)) {
          throw buildAICallError('AI_JSON_MODE_UNSUPPORTED', errText.slice(0, 200));
        }
        if (isRetryableHttpStatus(status) && attempt < 3) {
          await sleepAI(attempt * 1000);
          continue;
        }
        throw new Error(`AI API error ${status}: ${errText.slice(0, 200)}`);
      }

      // The upstream can resolve fetch() while leaving the response body open.
      // Keep the same lease for the complete request, including JSON parsing.
      const data: any = await Promise.race([resp.json(), timeoutPromise]);
      const totalTokens = data?.usage?.total_tokens || 0;
      if (totalTokens > 0) await addTokenUsage(env, totalTokens);
      const choice = data?.choices?.[0];
      const message = choice?.message;
      const text = typeof message?.content === 'string' ? message.content : '';
      const reasoningChars = typeof message?.reasoning_content === 'string'
        ? message.reasoning_content.length
        : 0;
      if (!text.trim()) {
        const detail = reasoningChars > 0 ? '仅返回 reasoning_content' : '未返回 message.content';
        throw buildAICallError('AI_RESPONSE_EMPTY', detail);
      }
      return {
        text,
        metadata: {
          provider: 'configured_api',
          model: aiModel,
          attempt,
          responseChars: text.length,
          finishReason: choice?.finish_reason ?? null,
          contentChars: text.length,
          reasoningChars,
        },
      };
    } catch (e: any) {
      if (e === timeoutError || e?.name === 'AbortError') {
        throw timeoutError;
      }
      lastError = e;
      // 部分推理模型偶发只返回 reasoning_content，下一次请求通常能返回
      // 正常的 message.content。有限重试，避免把一次上游空响应直接记为失败。
      if (e?.code === 'AI_RESPONSE_EMPTY' && attempt < 3) {
        await sleepAI(attempt * 1000);
        continue;
      }
      if (attempt < 3 && isRetryableHttpStatus(Number(e?.status))) {
        await sleepAI(attempt * 1000);
        continue;
      }
      throw lastError;
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
  }

  throw lastError || new Error('AI API 调用失败');
}


// 获取岗位要求（从 position_mappings → positions 链路）
async function getPositionRequirements(env: Env, positionName: string): Promise<any> {
  if (!positionName) return null;
  let mappedName = '';
  try {
    const pmRow = await env.DB.prepare('SELECT mapped_name FROM position_mappings WHERE raw_name LIKE ? LIMIT 1').bind(`%${positionName}%`).first() as any;
    if (pmRow?.mapped_name) mappedName = pmRow.mapped_name;
  } catch {}
  if (!mappedName) mappedName = positionName;

  try {
    const posRow = await env.DB.prepare(
      'SELECT title, description, requirements, personalized_requirements, capability_dimensions, screening_rules FROM positions WHERE title = ? LIMIT 1'
    ).bind(mappedName).first() as any;
    const positionTitle = posRow?.title || mappedName;
    let dimensions = normalizeCapabilityDimensions(posRow?.capability_dimensions || []);
    let personalizedRequirements = posRow?.personalized_requirements || '';

    // 岗位管理的新数据写入独立能力维度表，优先使用其中的名称、描述和权重。
    try {
      const dimRow = await env.DB.prepare(
        'SELECT dimensions_json, personalized_requirements FROM capability_dimensions WHERE position_name = ? LIMIT 1'
      ).bind(positionTitle).first() as any;
      if (dimRow?.dimensions_json) {
        const configured = normalizeCapabilityDimensions(dimRow.dimensions_json);
        if (configured.length > 0) dimensions = configured;
      }
      if (dimRow?.personalized_requirements) personalizedRequirements = dimRow.personalized_requirements;
    } catch {}

    if (!posRow && dimensions.length === 0) return null;
    let hardRequirements: any[] = [];
    try {
      const requisition = await env.DB.prepare(
        'SELECT hard_requirements FROM job_requisitions WHERE title = ? LIMIT 1'
      ).bind(positionTitle).first() as any;
      if (requisition?.hard_requirements) {
        const parsed = typeof requisition.hard_requirements === 'string'
          ? JSON.parse(requisition.hard_requirements)
          : requisition.hard_requirements;
        hardRequirements = Array.isArray(parsed) ? parsed : [];
      }
    } catch {}
    return {
      positionTitle,
      description: posRow?.description || '',
      requirements: posRow?.requirements || '',
      personalized_requirements: personalizedRequirements,
      capability_dimensions: dimensions,
      hard_requirements: hardRequirements,
      screeningRules: resolveScreeningRules(await getSystemScreeningRules(env.DB), posRow?.screening_rules),
    };
  } catch { return null; }
}

export type CapabilityDimension = { name: string; weight: number; description: string };

/** Convert historical dimension formats into a stable shape used by AI scoring. */
export function normalizeCapabilityDimensions(value: unknown): CapabilityDimension[] {
  let source: unknown = value;
  if (typeof source === 'string') {
    try { source = JSON.parse(source); } catch { source = source.split(/[、,，\n]/).filter(Boolean); }
  }
  if (!Array.isArray(source)) return [];
  const dimensions = source.map((item: any) => {
    if (typeof item === 'string') return { name: item.trim(), weight: 0, description: '' };
    return {
      name: String(item?.name || item?.title || '').trim(),
      weight: Number.isFinite(Number(item?.weight)) && Number(item?.weight) >= 0 ? Number(item.weight) : 0,
      description: String(item?.description || item?.definition || '').trim(),
    };
  }).filter((item: CapabilityDimension) => item.name);
  return dimensions;
}

export function weightedScore(items: Array<{ score: unknown; weight?: unknown }>): number | null {
  const valid = items.map(item => ({ score: Number(item.score), weight: Number(item.weight) || 0 }))
    .filter(item => Number.isFinite(item.score));
  if (!valid.length) return null;
  const totalWeight = valid.reduce((sum, item) => sum + Math.max(0, item.weight), 0);
  const score = totalWeight > 0
    ? valid.reduce((sum, item) => sum + item.score * Math.max(0, item.weight), 0) / totalWeight
    : valid.reduce((sum, item) => sum + item.score, 0) / valid.length;
  return Math.round(score * 10) / 10;
}

type HardRequirement = { field?: string; name?: string; operator?: string; value?: unknown; required?: unknown };

/** Missing candidate fields are deliberately marked for manual review, never rejected. */
export function evaluateHardRequirements(candidate: Record<string, any>, requirements: HardRequirement[]) {
  const unmet_items: string[] = [];
  const unknown_items: string[] = [];
  for (const requirement of requirements || []) {
    const field = String(requirement.field || requirement.name || '').trim();
    if (!field) continue;
    const actual = candidate[field];
    if (actual === null || actual === undefined || actual === '') {
      unknown_items.push(field);
      continue;
    }
    const expected = requirement.value ?? requirement.required;
    const operator = String(requirement.operator || 'equals').toLowerCase();
    const numericActual = Number(actual);
    let passed = true;
    if (operator === 'between' && Array.isArray(expected) && expected.length >= 2) {
      passed = Number.isFinite(numericActual) && numericActual >= Number(expected[0]) && numericActual <= Number(expected[1]);
    } else if (operator === 'gte' || operator === '>=' || operator === 'min') {
      passed = Number.isFinite(numericActual) && numericActual >= Number(expected);
    } else if (operator === 'lte' || operator === '<=' || operator === 'max') {
      passed = Number.isFinite(numericActual) && numericActual <= Number(expected);
    } else if (operator === 'in' && Array.isArray(expected)) {
      passed = expected.map(String).includes(String(actual));
    } else if (operator === 'contains') {
      passed = String(actual).includes(String(expected ?? ''));
    } else {
      passed = String(actual) === String(expected ?? '');
    }
    if (!passed) unmet_items.push(field);
  }
  const passed = unmet_items.length === 0;
  return {
    passed,
    unmet_items,
    unknown_items,
    message: !requirements?.length ? '无硬性要求配置' : !passed
      ? `存在 ${unmet_items.length} 项不满足的硬性条件`
      : unknown_items.length ? `有 ${unknown_items.length} 项待人工复核，其余硬性条件通过` : '硬性条件通过',
  };
}

/** Adds configured weight and deterministic hard-condition data without replacing AI evidence. */
export function enrichScreeningEvaluation(
  evaluation: Record<string, any>,
  configuredDimensionInput: unknown,
  hardRequirements: HardRequirement[] = [],
  candidateFields: Record<string, any> = {},
  screeningRules: ScreeningRuleValues = DEFAULT_SCREENING_RULES,
): any {
  evaluation = normalizeScreeningEvaluation(evaluation);
  const configured_dimensions = normalizeCapabilityDimensions(configuredDimensionInput);
  const configuredByName = new Map(configured_dimensions.map(item => [item.name, item]));
  const dimensions = filterDimensionScoresToConfigured(
    normalizeDimensionScores(evaluation),
    [...configured_dimensions.map(item => item.name), ...WEIGHTED_SCREENING_DIMENSION_NAMES],
  ).map((item: any) => ({
    ...item,
    weight: configuredByName.get(item.name)?.weight,
  }));
  const weightedScreening = evaluateWeightedScreening({ ...evaluation, dimensions }, configured_dimensions, screeningRules);
  return {
    ...evaluation,
    ...weightedScreening,
    match_score: weightedScreening.weighted_score,
    configured_dimensions,
    hard_requirement_result: evaluateHardRequirements({ ...candidateFields, ...evaluation }, hardRequirements),
  };
}

// WEIGHTED_SCREENING_PROMPT imported from ./resume-processing/weighted-screening

// 构建 AI 初筛 prompt（移植自 zpzt 项目）
function buildAIScreeningPrompt(resumeText: string, positionReq: any | null, extraContext?: { location?: string, salary?: string, metaInfo?: string }): { systemPrompt: string, userPrompt: string } {
  let positionSections = '';
  if (positionReq) {
    const dimsText = (positionReq.capability_dimensions || []).map((d: any) =>
      `  - ${d.name}${d.description ? `：${d.description}` : ''}`
    ).join('\n');
    positionSections = [
      '',
      `【应聘岗位：${positionReq.positionTitle}】`,
      positionReq.description ? `\n岗位职责：\n${positionReq.description}` : '',
      positionReq.requirements ? `\n岗位要求：\n${positionReq.requirements}` : '',
      positionReq.personalized_requirements ? `\n个性化要求：\n${positionReq.personalized_requirements}` : '',
      dimsText ? `\n能力维度（需要逐项评估）：\n${dimsText}` : '',
    ].filter(Boolean).join('\n');
  }

  let extraInfo = '';
  if (extraContext) {
    const parts: string[] = [];
    if (extraContext.location) parts.push(`地点：${extraContext.location}`);
    if (extraContext.salary) parts.push(`期望薪资：${extraContext.salary}`);
    if (extraContext.metaInfo) parts.push(`简历备注：${extraContext.metaInfo}`);
    if (parts.length > 0) extraInfo = `\n【简历来源信息】\n${parts.join('\n')}`;
  }

  const systemPrompt = `你是一位资深招聘专家和简历解析助手。请解析以下简历文本，提取完整信息并进行AI初筛评估。返回JSON格式（不要加markdown代码块），包含三部分：

第一部分 - 基础信息：
- candidate_name: 候选人姓名（全名）
- gender: 性别（男/女）
- age: 年龄（数字）
- phone: 手机号码
- email: 电子邮箱
- highest_degree: 最高学历
- school: 毕业院校
- major: 专业
- graduation_year: 毕业年份
- years_of_experience: 工作年限（数字）
- current_company: 目前/最近所在公司
- current_position: 目前/最近职位
- salary_expectation: 期望薪资（如果有）
- skills: 技能列表（数组）
- certifications: 证书/资质（数组）
- work_experience: 工作经历数组，每个包含 { company, title, duration, description, achievements }
- education: 教育经历数组，每个包含 { school, degree, major, duration }

第二部分 - AI初筛评估：
- position: 应聘岗位
- advantage (优势分析): 用中文描述3-5个核心优势
- risk (风险点/劣势分析): 用中文描述2-4个劣势或风险
- match_score: 非权威参考值（不要据此决定是否通过）
- recommendation: 推荐建议（"strongly_recommend"/"recommend"/"neutral"/"not_recommend"/"strongly_not_recommend"）
- summary: 综合分析摘要（中文，2-3句话）
- suggested_questions: 建议面试问题（中文，3-5个）
- dimensions: 必须且只能包含七项 ${WEIGHTED_SCREENING_DIMENSION_NAMES.join('、')}，每个包含 { name, score(0-5), reason }。关键词匹配达到 2 分、避坑雷区达到 5 分后，才进入服务端加权判定。

${WEIGHTED_SCREENING_PROMPT}

第三部分 - 个性化需求匹配（如果岗位有个性化需求）：
- personalized_match_score: 个性化需求匹配度（0-100的整数）
- personalized_met_items: 已满足的个性化需求列表（数组）
- personalized_unmet_items: 未满足的个性化需求列表（数组）`;

  const userPrompt = [
    `简历文本（请提取完整信息）：\n${resumeText}`,
    positionSections,
    positionReq?.screeningRules ? buildScreeningRulesPrompt(positionReq.screeningRules) : '',
    extraInfo,
  ].filter(Boolean).join('\n');

  return { systemPrompt, userPrompt };
}

// AI 简历初筛分析：返回结构化评估结果（移植 zpzt 的完整 prompt 逻辑）
async function callAIScreening(env: Env, resumeText: string, positionReq?: any | null, extraContext?: { location?: string, salary?: string, metaInfo?: string }): Promise<any> {
  const { systemPrompt, userPrompt } = buildAIScreeningPrompt(resumeText, positionReq || null, extraContext);
  const result = await callAI(env, systemPrompt, userPrompt);
  if (!result) return null;
  let parsed: any;
  try { parsed = extractJSON(result); } catch { parsed = { raw_response: result, summary: result }; }
  // Flatten nested structure
  const flattened: any = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      Object.assign(flattened, v);
    } else {
      flattened[k] = v;
    }
  }
  const completeEvaluation = requireCompleteScreeningEvaluation({ ...parsed, ...flattened });
  const screeningRules = positionReq?.screeningRules || resolveScreeningRules(await getSystemScreeningRules(env.DB));
  return enrichScreeningEvaluation(
    completeEvaluation,
    positionReq?.capability_dimensions || [],
    positionReq?.hard_requirements || [],
    {},
    screeningRules,
  );
}

export function extractJSON(text: string): any {
  if (typeof text !== 'string') return text;
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  // 1) 直接解析
  try { return JSON.parse(cleaned); } catch { /* ignore */ }
  // 2) 括号配平：找到首个 { 或 [，匹配到对应的闭合括号（支持嵌套）
  const firstOpen = Math.min(
    cleaned.indexOf('{') >= 0 ? cleaned.indexOf('{') : Infinity,
    cleaned.indexOf('[') >= 0 ? cleaned.indexOf('[') : Infinity
  );
  if (firstOpen < Infinity) {
    const openCh = cleaned[firstOpen];
    const closeCh = openCh === '{' ? '}' : ']';
    let depth = 0;
    for (let i = firstOpen; i < cleaned.length; i++) {
      if (cleaned[i] === openCh) depth++;
      else if (cleaned[i] === closeCh) {
        depth--;
        if (depth === 0) {
          const candidate = cleaned.slice(firstOpen, i + 1);
          try { return JSON.parse(candidate); } catch { /* ignore */ }
          break;
        }
      }
    }
  }
  // 3) 容错：把常见的非 JSON 前缀去掉后再试一次（处理「根据您提供的…：{...}」）
  const m = cleaned.match(/[\[{][\s\S]*[}\]]/);
  if (m) {
    try { return JSON.parse(m[0]); } catch { /* ignore */ }
  }
  // 4) 实在解析不出，返回原始文本（避免直接抛错导致整个 AI 功能崩溃）
  return cleaned;
}

// 解析 AI 生成的 JD 结果：优先取严格 JSON；模型返回 Markdown 时自动提取「岗位职责」与「任职要求」小节
export function parseJDResult(result: string): { description: string; requirements: string } {
  if (typeof result !== 'string' || !result.trim()) {
    return { description: '', requirements: '' };
  }
  // 1) 尝试 JSON（兼容 extractJSON 的容错）
  let parsed: any = null;
  try {
    const extracted = extractJSON(result);
    if (extracted && typeof extracted === 'object' && !Array.isArray(extracted)) {
      parsed = extracted;
    }
  } catch { /* ignore */ }
  if (parsed && (parsed.description || parsed.requirements)) {
    return {
      description: typeof parsed.description === 'string' ? parsed.description : '',
      requirements: typeof parsed.requirements === 'string' ? parsed.requirements : '',
    };
  }
  // 2) Markdown 兜底：按常见小节标题切分
  const sectionRegex = /^#{1,4}\s*(岗位职责|工作职责|职责描述|职位描述|岗位描述|岗位要求|任职要求|职位要求|任职资格|招聘要求|加分项|我们提供|福利待遇)[^\n]*$/gm;
  const headings: { title: string; index: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = sectionRegex.exec(result)) !== null) {
    headings.push({ title: m[1], index: m.index });
  }
  const isDescTitle = (t: string) => /职责|描述/.test(t) && !/要求|资格/.test(t);
  const isReqTitle = (t: string) => /要求|资格|条件/.test(t);
  const descIdx = headings.findIndex((h) => isDescTitle(h.title));
  const reqIdx = headings.findIndex((h) => isReqTitle(h.title));
  const extractSection = (start: number, end: number): string => {
    const text = result.slice(start, end).replace(/^#{1,4}\s*[^\n]*\n+/gm, '').trim();
    return text.replace(/^[-*]\s+/gm, '').trim();
  };
  let description = '';
  let requirements = '';
  if (descIdx >= 0) {
    const start = headings[descIdx].index;
    // 取下一个标题作为结束；若下一个就是任职要求，则职责段截止到它之前
    let end = result.length;
    const next = headings.find((h) => h.index > start && h !== headings[descIdx]);
    if (next && reqIdx >= 0 && headings[reqIdx].index > start) {
      end = headings[reqIdx].index;
    } else if (next) {
      end = next.index;
    }
    description = extractSection(start, end);
  }
  if (reqIdx >= 0) {
    const start = headings[reqIdx].index;
    let end = result.length;
    const next = headings.find((h) => h.index > start && h !== headings[reqIdx]);
    if (next) end = next.index;
    requirements = extractSection(start, end);
  }
  if (description || requirements) {
    return { description, requirements };
  }
  // 3) 完全无法解析时整体作为描述返回
  return { description: result.trim(), requirements: '' };
}

// 将 AI 原始结果规范化为 SSE 输出（兼容 JDGeneratorModal 的 JSON 结构）
function jdSSEBody(result: string): string {
  const { description, requirements } = parseJDResult(result);
  const payload = JSON.stringify({ description, requirements });
  return sseBody(payload);
}

// ==================== D1 Helpers ====================

const ENUM_FIELDS = new Set([
  'role', 'status', 'urgency', 'position_type', 'screening_result', 'stage',
  'reject_reason_category', 'result', 'interview_type', 'interview_category',
  'test_type', 'channel_type', 'overall_result', 'employment_type',
  'contract_type', 'trigger_type', 'node_type', 'question_generation_status',
  'parse_status', 'recommendation'
]);
function transformRow(row: Record<string, any>): Record<string, any> {
  if (!row) return row;
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(row)) {
    if (typeof value === 'number' && (value === 0 || value === 1) && /^is_/.test(key)) {
      result[key] = value === 1;
    } else if (typeof value === 'string' && value.length > 0 && (value[0] === '{' || value[0] === '[')) {
      try { result[key] = JSON.parse(value); } catch { result[key] = value; }
    } else if (ENUM_FIELDS.has(key) && typeof value === 'string') {
      result[key] = value.toLowerCase();
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function normalizeResumeEditPayload(body: Record<string, unknown>): Record<string, string> {
  const updates: Record<string, string> = {};
  for (const field of ['candidate_name', 'email', 'contact']) {
    if (body[field] === undefined) continue;
    updates[field] = typeof body[field] === 'string'
      ? body[field].trim()
      : String(body[field] ?? '').trim();
  }
  return updates;
}



// ==================== 日报详情：按负责人分组查询候选人 ====================
/**
 * 按负责人分组查询当日通过 AI 初筛的候选人明细
 * 用于日报表格展示和飞书卡片发送
 */
async function queryDailyCandidatesByOwner(
  db: D1Database,
  reportDate: string,
  allowLegacyCreatedAtFallback = false,
): Promise<{
  groups: Array<{
    responsible_person: string;
    candidates: Array<{
      name: string;
      education: string;
      age: number | null;
      gender: string;
      position: string;
      city: string;
      ai_summary: string;
      recommendation: string;
      resume_id: string;
    }>;
  }>;
  stats: { total: number; by_person: Record<string, number> };
}> {
  const date = assertDailyReportDate(reportDate);
  const utcStartMs = Date.parse(`${date}T00:00:00.000+08:00`);
  const utcStart = new Date(utcStartMs).toISOString();
  const utcEnd = new Date(utcStartMs + 86_400_000).toISOString();
  const candidateLimit = 1_000;

  // 查询通过 AI 初筛的简历，关联负责人
  const selectSql = `
    SELECT r.id, r.candidate_name, r.mapped_position, r.position_applied, r.screening_result,
           r.ai_evaluation, r.parsed_data, r.gender, r.education, r.birthday, r.created_at,
           COALESCE(p.responsible_person, pm.responsible_person, '') as responsible_person
    FROM resumes r
    LEFT JOIN positions p ON r.position_id = p.id
    LEFT JOIN position_mappings pm ON (r.mapped_position = pm.mapped_name OR r.position_applied = pm.raw_name)
  `;
  let result;
  try {
    result = await db.prepare(`${selectSql}
      WHERE datetime(r.approved_at) >= datetime(?) AND datetime(r.approved_at) < datetime(?)
      ORDER BY r.approved_at DESC
      LIMIT ${candidateLimit + 1}
    `).bind(utcStart, utcEnd).all();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/no such column:\s*(?:r\.)?approved_at/i.test(message)) throw error;
    if (!allowLegacyCreatedAtFallback) {
      return { groups: [], stats: { total: 0, by_person: {} } };
    }
    result = await db.prepare(`${selectSql}
      WHERE r.screening_result = '通过'
        AND datetime(r.created_at) >= datetime(?) AND datetime(r.created_at) < datetime(?)
      ORDER BY r.created_at DESC
      LIMIT ${candidateLimit + 1}
    `).bind(utcStart, utcEnd).all();
  }
  const rows = result.results || [];
  if (rows.length > candidateLimit) {
    throw new Error(`daily report candidate details exceeds hard limit ${candidateLimit}`);
  }

  const groupMap = new Map<string, any[]>();
  const personOrder = ['何雨菱', '杜雁玲', '魏秋柠'];

  for (const row of rows) {
    const r = row as any;
    const person = r.responsible_person || '未分配';
    if (!groupMap.has(person)) groupMap.set(person, []);

    let parsed: any = {};
    try { parsed = typeof r.parsed_data === 'string' ? JSON.parse(r.parsed_data) : (r.parsed_data || {}); } catch {}

    let evaluation: any = {};
    try { evaluation = typeof r.ai_evaluation === 'string' ? JSON.parse(r.ai_evaluation) : (r.ai_evaluation || {}); } catch {}

    // 计算年龄
    let age: number | null = null;
    if (parsed.age) {
      age = parseInt(parsed.age) || null;
    } else if (r.birthday) {
      try { const b = new Date(r.birthday); const diff = Date.now() - b.getTime(); age = Math.floor(diff / (365.25 * 24 * 3600 * 1000)); } catch {}
    }

    // 城市优先从 parsed_data.city 取，其次从 position_applied 取（部分简历岗位名存的是城市）
    let city = parsed.city || '';
    if (!city && r.position_applied && !r.mapped_position) city = r.position_applied;

    groupMap.get(person)!.push({
      name: r.candidate_name || '',
      education: parsed.highest_degree || r.education || '',
      age,
      gender: parsed.gender || r.gender || '',
      position: r.mapped_position || r.position_applied || '',
      city,
      ai_summary: evaluation.summary || '',
      recommendation: evaluation.recommendation || '',
      resume_id: r.id,
    });
  }

  // 按指定顺序排序负责人
  const groups = personOrder
    .filter(p => groupMap.has(p))
    .map(p => ({ responsible_person: p, candidates: groupMap.get(p)! }));

  // 添加未分配的
  if (groupMap.has('未分配')) {
    groups.push({ responsible_person: '未分配', candidates: groupMap.get('未分配')! });
  }

  const total = rows.length;
  const by_person: Record<string, number> = {};
  for (const [person, candidates] of groupMap) {
    by_person[person] = candidates.length;
  }

  return { groups, stats: { total, by_person } };
}

function prepareValue(v: any): any {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}

function validCol(name: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
}

// 系统设置 PUT 时仅持久化可写字段：跳过只读的掩码标记（_set/_last4），
// 并跳过空 API Key（避免把已保存的 Key 误清空）
function shouldPersistSystemConfigField(k: string, v: unknown): boolean {
  if (!validCol(k)) return false;
  if (['id', 'updated_at'].includes(k)) return false;
  if (k.endsWith('_set') || k.endsWith('_last4')) return false;
  // 新格式：llm_slots 列直接存 JSON 数组；空数组不写入（避免覆盖已有数据）
  if (k === 'llm_slots') return v !== undefined && v !== null && (!Array.isArray(v) || v.length > 0);
  // 旧格式兼容：llmN_* 列仍允许写入（不影响新字段读取）
  if (validLLMSlotKey(k)) return true;
  if (/^llm\d*_api_key$/.test(k) && (!v || !String(v).trim())) return false;
  return true;
}

async function syncCapabilityDimensionsForPosition(db: D1Database, positionName: string, value: unknown): Promise<void> {
  if (!positionName) return;
  const dimensions = normalizeCapabilityDimensionsForStorage(value);
  const dimensionsJson = JSON.stringify(dimensions);
  const fullText = buildCapabilityDimensionsFullText(dimensions);
  const existing = await db.prepare(
    'SELECT id FROM capability_dimensions WHERE position_name = ? LIMIT 1',
  ).bind(positionName).first() as any;
  if (existing?.id) {
    await db.prepare(
      'UPDATE capability_dimensions SET dimensions_json = ?, full_text = ?, updated_at = ? WHERE id = ?',
    ).bind(dimensionsJson, fullText, now(), existing.id).run();
  } else {
    await db.prepare(
      'INSERT INTO capability_dimensions (id, position_name, dimensions_json, full_text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(uuid(), positionName, dimensionsJson, fullText, now(), now()).run();
  }
}

async function syncPositionDimensionsForCapabilityRecord(db: D1Database, positionName: string, value: unknown): Promise<void> {
  if (!positionName) return;
  const dimensions = normalizeCapabilityDimensionsForStorage(value);
  await db.prepare(
    'UPDATE positions SET capability_dimensions = ?, updated_at = ? WHERE title = ?',
  ).bind(JSON.stringify(dimensions), now(), positionName).run();
}

function uuid(): string {
  return crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function safeJsonParse(v: any): any {
  if (!v || typeof v !== 'string') return null;
  try { return JSON.parse(v); } catch { return null; }
}

// ==================== 操作日志（结构化埋点） ====================

/**
 * 核心业务链路结构化日志（写入 D1 operation_logs 表）
 * 失败不影响主流程（只 console.error）
 */
async function logOperation(
  env: Env,
  entry: {
    action: string;            // resume.create / interview.create / interview.notify / feishu.sync / interview.evaluate ...
    entityType?: string;
    entityId?: string | number;
    actor?: string;            // 操作人 email 或 system/cron
    status?: 'success' | 'failure';
    detail?: string;
  }
): Promise<void> {
  try {
    await env.DB.prepare(
      'INSERT INTO operation_logs (action, entity_type, entity_id, actor, status, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      entry.action,
      entry.entityType || null,
      entry.entityId != null ? String(entry.entityId) : null,
      entry.actor || 'system',
      entry.status || 'success',
      entry.detail ? entry.detail.substring(0, 2000) : null,
      now()
    ).run();
  } catch (e: any) {
    console.error(`[logOperation] 写操作日志失败(${entry.action}): ${e.message}`);
  }
}

export type BulkApprovalResult = {
  approved: string[];
  skipped: Array<{ id: string; reason: 'not_found' | 'already_approved' | 'already_rejected' }>;
  failed: Array<{ id: string; reason: string }>;
};

/**
 * Updates D1 one resume at a time so a malformed or deleted row never aborts
 * the rest of a selected batch. Feishu is deliberately handled by the route
 * after a D1 success; the list and dashboard both read D1 as their source of truth.
 */
export async function approveBatch(db: D1Database, resumeIds: string[], actor = 'system'): Promise<BulkApprovalResult> {
  const result: BulkApprovalResult = { approved: [], skipped: [], failed: [] };
  const uniqueIds = [...new Set(resumeIds.filter((id): id is string => typeof id === 'string' && id.length > 0))];

  for (const id of uniqueIds) {
    try {
      const resume = await db.prepare('SELECT id, status, stage FROM resumes WHERE id = ?').bind(id).first<any>();
      if (!resume) {
        result.skipped.push({ id, reason: 'not_found' });
        continue;
      }
      if (resume.status === 'approved' && resume.stage === 'talent_pool') {
        result.skipped.push({ id, reason: 'already_approved' });
        continue;
      }

      const decisionAt = now();
      const update = await db.prepare("UPDATE resumes SET status = 'approved', stage = 'talent_pool', updated_at = ? WHERE id = ?")
        .bind(decisionAt, id)
        .run();
      if (!update.meta.changes) {
        result.skipped.push({ id, reason: 'not_found' });
        continue;
      }
      await recordResumeDecisionTimestamp(db, id, 'approved', decisionAt);

      result.approved.push(id);
      try {
        await db.prepare(
          'INSERT INTO operation_logs (action, entity_type, entity_id, actor, status, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).bind('resume.approve_to_talent_pool', 'resume', id, actor, 'success', '批量入库', now()).run();
      } catch (error: any) {
        console.error(`[approveBatch] 操作日志写入失败(${id}): ${error?.message || error}`);
      }
    } catch (error: any) {
      console.error(`[approveBatch] 入库失败(${id}): ${error?.message || error}`);
      result.failed.push({ id, reason: error?.message || 'database_error' });
    }
  }

  return result;
}

/**
 * Approves one resume through the D1 source of truth and returns its updated
 * row. Newly uploaded resumes use a D1 UUID and may not have a Feishu record,
 * so callers must not require a Feishu lookup for this operation to succeed.
 */
export async function approveSingleResume(db: D1Database, resumeId: string, actor = 'system'): Promise<Record<string, any> | null> {
  const result = await approveBatch(db, [resumeId], actor);
  const accepted = result.approved.includes(resumeId)
    || result.skipped.some((item) => item.id === resumeId && item.reason === 'already_approved');
  if (!accepted) return null;

  const row = await db.prepare('SELECT * FROM resumes WHERE id = ?').bind(resumeId).first<Record<string, any>>();
  return row ? transformRow(row) : null;
}

/**
 * Marks resumes as rejected (不入库) in D1, one at a time so a malformed or
 * deleted row never aborts the rest of a batch. Mirrors approveBatch; used by
 * the person-resume delivery flows (Feishu cards + decision page).
 */
export async function rejectBatch(db: D1Database, resumeIds: string[], actor = 'system'): Promise<BulkApprovalResult> {
  const result: BulkApprovalResult = { approved: [], skipped: [], failed: [] };
  const uniqueIds = [...new Set(resumeIds.filter((id): id is string => typeof id === 'string' && id.length > 0))];

  for (const id of uniqueIds) {
    try {
      const resume = await db.prepare('SELECT id, status, stage FROM resumes WHERE id = ?').bind(id).first<any>();
      if (!resume) {
        result.skipped.push({ id, reason: 'not_found' });
        continue;
      }
      if (resume.status === 'rejected') {
        result.skipped.push({ id, reason: 'already_rejected' });
        continue;
      }

      const decisionAt = now();
      const update = await db.prepare("UPDATE resumes SET status = 'rejected', stage = 'rejected', updated_at = ? WHERE id = ?")
        .bind(decisionAt, id)
        .run();
      if (!update.meta.changes) {
        result.skipped.push({ id, reason: 'not_found' });
        continue;
      }
      await recordResumeDecisionTimestamp(db, id, 'rejected', decisionAt);

      result.approved.push(id);
      try {
        await db.prepare(
          'INSERT INTO operation_logs (action, entity_type, entity_id, actor, status, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).bind('resume.reject_from_talent_review', 'resume', id, actor, 'success', '批量不入库', now()).run();
      } catch (error: any) {
        console.error(`[rejectBatch] 操作日志写入失败(${id}): ${error?.message || error}`);
      }
    } catch (error: any) {
      console.error(`[rejectBatch] 不入库失败(${id}): ${error?.message || error}`);
      result.failed.push({ id, reason: error?.message || 'database_error' });
    }
  }

  return result;
}

// ==================== Auth Middleware ====================

async function getUser(db: D1Database, email: string): Promise<any | null> {
  const row = await db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
  return row ? transformRow(row) : null;
}

const authMiddleware = async (c: any, next: any) => {
  const auth = c.req.header('Authorization') || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return c.json({ detail: 'Not authenticated' }, 401);
  const payload = await verifyJwt(c.env.SECRET_KEY, match[1]);
  if (!payload) return c.json({ detail: 'Invalid token' }, 401);
  const user = await getUser(c.env.DB, payload.sub);
  if (!user) return c.json({ detail: 'User not found' }, 401);
  if (!user.is_active) return c.json({ detail: 'Account disabled' }, 403);
  c.set('user', user);
  await next();
};

// 业务筛选路由组鉴权：JWT 优先，长期 API Key 兜底（x-api-key 视为 admin/hr 权限）。
// API Key 支持让 skill/第三方环境持长期凭证即可随时生成 7 天单开链接，无需每月换 JWT。
const businessScreeningAuthMiddleware = async (c: any, next: any) => {
  const auth = c.req.header('Authorization') || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (match) {
    const payload = await verifyJwt(c.env.SECRET_KEY, match[1]);
    if (payload) {
      const user = await getUser(c.env.DB, payload.sub);
      if (user && user.is_active) {
        c.set('user', user);
        await next();
        return;
      }
    }
    return c.json({ detail: 'Not authenticated' }, 401);
  }
  const apiKey = c.req.header('x-api-key') || '';
  if (apiKey && c.env.RESUME_UPLOAD_API_KEY && apiKey === c.env.RESUME_UPLOAD_API_KEY) {
    c.set('user', { id: 'api-key', email: 'api-key@system', role: 'admin', full_name: 'API Key' });
    await next();
    return;
  }
  return c.json({ detail: 'Not authenticated' }, 401);
};

function serializeUser(user: any) {
  const { hashed_password, plain_password, feishu_token, feishu_refresh_token, feishu_token_expires_at, feishu_token_failed_at, ...rest } = user;
  return {
    ...rest,
    has_password: !!hashed_password,
    has_feishu: !!(feishu_token || rest.feishu_open_id),
    feishu_token_failed: !!feishu_token_failed_at,  // token 刷新失败，需要重新授权
  };
}

function requireRole(roles: string[]) {
  return async (c: any, next: any) => {
    const user = c.get('user');
    if (!user || !roles.includes(user.role)) {
      return c.json({ detail: 'Operation not permitted' }, 403);
    }
    await next();
  };
}

// 安排面试：查「面试官 + 操作人」未来公共空闲时段（供弹窗推荐，自动定日程）
app.get('/api/interviews/available-slots', authMiddleware, requireRole(['admin', 'hr']), async (c) => {
  try {
    const interviewer = String(c.req.query('interviewer') || '').trim();
    if (!interviewer) return c.json({ ok: true, slots: [], reason: '请先选择一面面试官' });
    const db = c.env.DB as D1Database;
    const openIds: string[] = [];
    const names: string[] = [];
    // 一面面试官
    const interviewerOid = await resolveExactInterviewerOpenId(db, interviewer);
    if (!interviewerOid) return c.json({ ok: true, slots: [], reason: `面试官「${interviewer}」未绑定飞书身份，暂无法推荐空闲时段` });
    openIds.push(interviewerOid);
    names.push(interviewer);
    // 操作人（当前登录用户）
    const me = ((c.get('user') as any)?.full_name || '').trim();
    if (me && me !== interviewer) {
      const myOid = await resolveExactInterviewerOpenId(db, me);
      if (myOid) { openIds.push(myOid); names.push(me); }
    }

    const token = await getFeishuToken(c.env);
    const fromTs = Math.floor(Date.now() / 1000);
    // 查每个参与人的空闲，取交集（所有人都有空的时段才推荐）
    const slotSets: Array<Map<number, { startTs: number; endTs: number }>> = [];
    for (const oid of openIds) {
      const slots = await listFreeInterviewSlots({
        token,
        openId: oid,
        fromTs,
        durationMinutes: 60,
        skipWorkdays: 2,
        workdays: 3,
      });
      slotSets.push(new Map(slots.map((s) => [s.startTs, s])));
    }
    const first = slotSets[0];
    const common = [...first.values()].filter((s) => slotSets.every((set) => set.has(s.startTs))).sort((a, b) => a.startTs - b.startTs);

    return c.json({
      ok: true,
      interviewer,
      participants: names,
      slots: common.map((s) => ({ start: formatBeijingSlot(s.startTs), end: formatBeijingSlot(s.endTs) })),
    });
  } catch (e: any) {
    return c.json({ ok: true, slots: [], reason: `空闲时段查询失败：${e?.message || e}` });
  }
});

// 安排面试：查空闲会议室（D5 栋优先）——供弹窗自动填充「面试地点」
app.get('/api/meeting-rooms/available', authMiddleware, async (c) => {
  try {
    const startAt = String(c.req.query('start_at') || '').trim();
    const durationMinutes = Math.min(480, Math.max(30, Number(c.req.query('duration_minutes')) || 60));
    let startTs = startAt ? (parseInterviewTimeToMs(startAt) ?? Date.parse(startAt)) : NaN;
    if (Number.isNaN(startTs)) startTs = Date.now() + 60 * 60_000;
    const endTs = startTs + durationMinutes * 60_000;

    const token = await getFeishuToken(c.env);
    let has_d5 = false;
    let rooms: any[] = [];
    try {
      const found = await findAvailableMeetingRooms({ token, startTs, endTs });
      has_d5 = found.has_d5;
      rooms = found.rooms;
    } catch (e: any) {
      // 分阶段返回错误详情，便于定位是列表拉取还是忙闲查询失败
      return c.json({ ok: true, has_d5: false, rooms: [], reason: `空闲会议室查询失败（${e?.message || e}）` });
    }
    return c.json({
      ok: true,
      has_d5,
      rooms: rooms.map((r) => ({ room_id: r.room_id, name: r.name, path: r.path, capacity: r.capacity })),
    });
  } catch (e: any) {
    return c.json({ ok: true, rooms: [], reason: `空闲会议室查询失败：${e?.message || e}` });
  }
});

const businessScreeningRoutes = createBusinessScreeningRoutes({
  authMiddleware: businessScreeningAuthMiddleware,
  requireRole,
  getCurrentUserToken: (env, email) => getValidUserAccessToken(env, email),
  sendFeishuMessageToUser,
  recordResumeDecisionTimestamp,
  now,
  uuid,
  createPublicToken,
  createScopePublicToken,
  getResumeFileBytes,
  resolveApiKeyOwnerEmail: async (env) => {
    const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(BUSINESS_SCREENING_KEY_OWNER_SETTING).first() as any;
    return typeof row?.value === 'string' && row.value.trim() ? row.value.trim() : null;
  },
  enqueueAutomation: async (env, input) => {
    if (String(env.INTERVIEW_AUTOMATION_ENABLED || '').toLowerCase() !== 'true' || !env.INTERVIEW_AUTOMATION_QUEUE) return;
    const repo = new InterviewAutomationRepository(env.DB, { uuid, now });
    await enqueueInterviewAutomation(repo, env.INTERVIEW_AUTOMATION_QUEUE, input);
  },
  // 公开页「重新解析」：凭链接 token 免登录触发 AI 重新评估（入队去重）
  enqueueResumeReprocess: async (env, resumeId) => enqueueResumeReprocess(env.DB, env.RESUME_PROCESSING_QUEUE, resumeId),
  store: createD1BusinessScreeningRouteStore(resolveExactInterviewerOpenId),
});
app.route('/', businessScreeningRoutes);

// AI 初筛结果自动联动业务筛选（由简历处理队列在初筛完成后调用）：
// 通过 → 自动推送到业务链接；不通过 → 自动从业务链接移除。失败不影响主流程。
export async function autoLinkAiResultToBusinessScreening(env: any, resumeId: string): Promise<void> {
  try {
    const db = env?.DB as D1Database;
    if (!db) return;
    await syncAiResultToBusinessScreening(db, buildBusinessScreeningAutoLinkDeps(), resumeId);
  } catch (error: any) {
    console.error(`[auto-link] AI初筛业务联动失败 resume=${resumeId}: ${error?.message || error}`);
  }
}

// 面试管理卡片：单个候选人面试情况汇总的免登录公开链接（固定 7 天有效，可撤销/续期）
const interviewCardRoutes = createInterviewCardRoutes({
  authMiddleware: businessScreeningAuthMiddleware,
  now,
  uuid,
  hashPublicToken,
  getResumeFileBytes,
  // 公开页「重新解析」：凭链接 token 免登录触发 AI 重新评估（入队去重）
  enqueueResumeReprocess: async (env, resumeId) => enqueueResumeReprocess(env.DB, env.RESUME_PROCESSING_QUEUE, resumeId),
  // 飞书应用 ID fallback（Pages 环境变量缺失时 slots/reschedule 获取 tenant token 用）
  appId: FEISHU_CONFIG.appId,
});
app.route('/', interviewCardRoutes);

const interviewAutomationRoutes = createInterviewAutomationRoutes({
  authMiddleware,
  now,
  uuid,
});
app.route('/', interviewAutomationRoutes);
// API Key 飞书归属用户：key 推送时用该用户的飞书 token 发送卡片（管理员配置）
const BUSINESS_SCREENING_KEY_OWNER_SETTING = 'business_screening_key_owner';

app.get('/api/settings/business-screening-key-owner', authMiddleware, requireRole(['admin']), async (c) => {
  const row = await c.env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(BUSINESS_SCREENING_KEY_OWNER_SETTING).first() as any;
  return c.json({ owner_email: row?.value || null });
});

app.put('/api/settings/business-screening-key-owner', authMiddleware, requireRole(['admin']), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const ownerEmail = typeof body.owner_email === 'string' ? body.owner_email.trim() : '';
  if (!ownerEmail) {
    await c.env.DB.prepare('DELETE FROM settings WHERE key = ?').bind(BUSINESS_SCREENING_KEY_OWNER_SETTING).run();
    return c.json({ ok: true, owner_email: null });
  }
  const nowIso = new Date().toISOString();
  await c.env.DB.prepare(
    'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?'
  ).bind(BUSINESS_SCREENING_KEY_OWNER_SETTING, ownerEmail, nowIso, ownerEmail, nowIso).run();
  return c.json({ ok: true, owner_email: ownerEmail });
});

// 全面公开只读查询 API（2026-08-14）：两档鉴权（无 key 公开脱敏 / x-api-key 完整），
// 姓名容错（编辑距离 ≤ 1）。person/:name/resumes 由既有路由处理，不在此重复注册。
const publicQueryRoutes = createPublicQueryRoutes({
  buildPersonResumeFilter,
});
app.route('/', publicQueryRoutes);

// HR 权限隔离：非 admin 用户自动过滤为自己的数据
function getOwnerName(c: any): string | null {
  const user = c.get('user');
  if (!user || user.role === 'admin') return null;
  // HR 用户：用 full_name 作为 responsible_person 过滤条件
  return user.full_name || null;
}

// ==================== Health Check ====================

app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString(), ai_binding: !!c.env.AI }));

// ==================== Auth Routes ====================

app.post('/api/auth/token', async (c) => {
  const text = await c.req.text();
  const params = new URLSearchParams(text);
  const username = params.get('username') || '';
  const password = params.get('password') || '';
  if (!username || !password) return c.json({ detail: 'Missing credentials' }, 400);

  const user = await getUser(c.env.DB, username);
  if (!user) return c.json({ detail: 'Invalid credentials' }, 401);

  const ok = await verifyPassword(c.env.SECRET_KEY, password, user.hashed_password);
  if (!ok) return c.json({ detail: 'Invalid credentials' }, 401);

  const token = await createJwt(c.env.SECRET_KEY, username);
  return c.json({ access_token: token, token_type: 'bearer' });
});

app.get('/api/auth/me', authMiddleware, (c) => {
  const user = c.get('user');
  return c.json(serializeUser(user));
});

app.get('/api/auth/me/token', authMiddleware, async (c) => {
  const user = c.get('user');
  const token = await createJwt(c.env.SECRET_KEY, user.email);
  return c.json({ token });
});

app.put('/api/auth/me', authMiddleware, async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const updates: Record<string, any> = {};
  for (const k of ['full_name', 'feishu_open_id', 'feishu_name']) {
    if (body[k] !== undefined) updates[k] = body[k];
  }
  if (Object.keys(updates).length === 0) return c.json(serializeUser(user));
  const setClause = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  await c.env.DB.prepare(`UPDATE users SET ${setClause}, updated_at = ? WHERE id = ?`)
    .bind(...Object.values(updates), now(), user.id).run();
  const updated = await getUser(c.env.DB, user.email);
  return c.json(serializeUser(updated));
});

app.put('/api/auth/change-password', authMiddleware, async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const ok = await verifyPassword(c.env.SECRET_KEY, body.current_password || '', user.hashed_password);
  if (!ok) return c.json({ detail: 'Current password incorrect' }, 400);
  const newHash = await hashPassword(c.env.SECRET_KEY, body.new_password || '');
  await c.env.DB.prepare('UPDATE users SET hashed_password = ?, updated_at = ? WHERE id = ?')
    .bind(newHash, now(), user.id).run();
  return c.json({ detail: 'Password changed' });
});

// 飞书 OAuth 回调地址（生产默认地址；本地开发自动用请求来源）
const FEISHU_REDIRECT_URI = 'https://ai-interview-88r.pages.dev/api/auth/feishu-callback';

// 根据请求来源动态生成 OAuth 回调地址
function getFeishuRedirectUri(c: any): string {
  if (c.env.FEISHU_OAUTH_REDIRECT_URI) return c.env.FEISHU_OAUTH_REDIRECT_URI;
  try {
    const origin = new URL(c.req.url).origin;
    // 本地开发：Vite dev server 在 5173，wrangler pages dev 在 8000
    // Vite proxy 会把 origin 改成 127.0.0.1:8000，所以统一用 localhost:5173
    if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
      return 'http://localhost:5173/api/auth/feishu-callback';
    }
  } catch {}
  return FEISHU_REDIRECT_URI;
}

// 飞书 OAuth：获取 app_id 等配置
app.get('/api/auth/feishu/config', async (c) => {
  const appId = c.env.FEISHU_APP_ID || FEISHU_CONFIG.appId;
  return c.json({ app_id: appId });
});

// 飞书 OAuth：获取授权链接
app.get('/api/auth/feishu-oauth-url', authMiddleware, async (c) => {
  const user = c.get('user');
  const token = await createJwt(c.env.SECRET_KEY, user.email);
  const baseUrl = getFeishuRedirectUri(c);
  const appId = c.env.FEISHU_APP_ID || FEISHU_CONFIG.appId;
  const scope = 'im:message im:message.send_as_user contact:user.base:readonly bitable:app:readonly offline_access';
  const oauthUrl = `https://accounts.feishu.cn/open-apis/authen/v1/authorize?client_id=${appId}&redirect_uri=${encodeURIComponent(baseUrl)}&response_type=code&state=${token}&scope=${encodeURIComponent(scope)}`;
  return c.json({ url: oauthUrl });
});

// 飞书 OAuth：管理员为指定用户生成授权链接
app.post('/api/auth/feishu-oauth-url', authMiddleware, requireRole(['admin']), async (c) => {
  const body = await c.req.json();
  const email = body.email;
  if (!email) return c.json({ detail: 'email required' }, 400);
  const token = await createJwt(c.env.SECRET_KEY, email);
  const baseUrl = getFeishuRedirectUri(c);
  const appId = c.env.FEISHU_APP_ID || FEISHU_CONFIG.appId;
  const scope = 'im:message im:message.send_as_user contact:user.base:readonly bitable:app:readonly offline_access';
  const oauthUrl = `https://accounts.feishu.cn/open-apis/authen/v1/authorize?client_id=${appId}&redirect_uri=${encodeURIComponent(baseUrl)}&response_type=code&state=${token}&scope=${encodeURIComponent(scope)}`;
  return c.json({ url: oauthUrl, email });
});

// 飞书 OAuth：回调处理
app.get('/api/auth/feishu-callback', async (c) => {
  try {
    const code = c.req.query('code') || '';
    const state = c.req.query('state') || '';
    if (!code) {
      console.error('[FeishuOAuth] 缺少 code 参数');
      return c.redirect('/settings/profile?feishu_error=1&err=missing_code');
    }

    // 从 state 解析 JWT 获取用户身份
    let userEmail = '';
    const payload = await verifyJwt(c.env.SECRET_KEY, state);
    if (payload && payload.sub) {
      userEmail = payload.sub;
    } else {
      // JWT 解析失败，尝试直接使用 state 作为 email
      userEmail = state.includes('@') ? state : '';
    }
    if (!userEmail) {
      console.error(`[FeishuOAuth] 无法从 state 解析用户身份: ${state.substring(0, 50)}...`);
      return c.redirect('/settings/profile?feishu_error=1&err=bad_state');
    }

    // 用 code 换 user_access_token
    const appId = c.env.FEISHU_APP_ID || FEISHU_CONFIG.appId;
    const appSecret = c.env.FEISHU_APP_SECRET;
    if (!appSecret) {
      console.error('[FeishuOAuth] FEISHU_APP_SECRET 未配置（wrangler pages secret put FEISHU_APP_SECRET）');
      return c.redirect('/settings/profile?feishu_error=1&err=secret_missing');
    }

    console.log(`[FeishuOAuth] 交换 token: email=${userEmail}, appId=${appId}, code=${code.substring(0, 20)}...`);

    const redirectUri = getFeishuRedirectUri(c);
    const tokenResp = await fetch('https://open.feishu.cn/open-apis/authen/v2/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: appId,
        client_secret: appSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });
    const tokenData = await tokenResp.json() as any;
    // v2 顶层返回 access_token/refresh_token（无 data 包裹），防御性兜底
    const userAccessToken = tokenData.access_token || tokenData.data?.access_token || '';
    const refreshToken = tokenData.refresh_token || tokenData.data?.refresh_token || '';
    const expiresIn = tokenData.expires_in || tokenData.data?.expires_in || 7200;
    if (!userAccessToken) {
      console.error(`[FeishuOAuth] token 交换失败: code=${tokenData.code}, msg=${tokenData.msg}, raw=${JSON.stringify(tokenData)}`);
      return c.redirect(`/settings/profile?feishu_error=1&err=${encodeURIComponent('token交换失败:' + tokenData.code + ' ' + tokenData.msg)}`);
    }

    console.log(`[FeishuOAuth] token 交换成功, 获取用户信息...`);

    const userInfoResp = await fetch('https://open.feishu.cn/open-apis/authen/v1/user_info', {
      headers: { Authorization: `Bearer ${userAccessToken}` },
    });
    const userInfoData = await userInfoResp.json() as any;
    console.log(`[FeishuOAuth] userinfo 响应: code=${userInfoData.code}, open_id=${userInfoData.data?.open_id || userInfoData.open_id || '(空)'}, name=${userInfoData.data?.name || userInfoData.name || '(空)'}`);
    // v2 userinfo 顶层返回，防御性兜底
    const feishuOpenId = userInfoData.open_id || userInfoData.sub || userInfoData.data?.open_id || '';
    const feishuName = userInfoData.name || userInfoData.nickname || userInfoData.data?.name || '';

    console.log(`[FeishuOAuth] 用户信息: openId=${feishuOpenId}, name=${feishuName}, 更新 ${userEmail}...`);

    if (feishuOpenId) {
      const expiresAt = Date.now() + (expiresIn - 300) * 1000; // 提前 5 分钟过期
      await c.env.DB.prepare(
        'UPDATE users SET feishu_open_id = ?, feishu_name = ?, feishu_token = ?, feishu_refresh_token = ?, feishu_token_expires_at = ?, updated_at = ? WHERE email = ?'
      ).bind(feishuOpenId, feishuName, userAccessToken, refreshToken, expiresAt, now(), userEmail).run();
    }

    console.log(`[FeishuOAuth] 绑定成功, 跳转`);
    return c.redirect('/settings/profile?feishu_bound=1');
  } catch (e: any) {
    console.error(`[FeishuOAuth] 异常: ${e.message}\n${e.stack || ''}`);
    return c.redirect(`/settings/profile?feishu_error=1&err=${encodeURIComponent('exception:' + e.message)}`);
  }
});

// 更新飞书 OAuth 绑定信息
app.put('/api/auth/me/feishu', authMiddleware, async (c) => {
  const user = c.get('user');
  const { feishu_open_id, feishu_name } = await c.req.json();
  await c.env.DB.prepare('UPDATE users SET feishu_open_id = ?, feishu_name = ?, updated_at = ? WHERE id = ?')
    .bind(feishu_open_id || '', feishu_name || '', now(), user.id).run();
  const updated = await getUser(c.env.DB, user.email);
  return c.json(serializeUser(updated));
});

app.get('/api/auth/users', authMiddleware, requireRole(['admin', 'hr']), async (c) => {
  const result = await c.env.DB.prepare('SELECT * FROM users ORDER BY created_at DESC').all();
  const users = result.results.map(serializeUser);
  const currentUser = c.get('user');
  // HR 用户只看基本信息，不暴露密码
  if (currentUser?.role !== 'admin') {
    return c.json(users.map((u: any) => ({
      id: u.id, email: u.email, full_name: u.full_name, role: u.role, is_active: u.is_active
    })));
  }
  return c.json(users);
});

app.post('/api/auth/users', authMiddleware, requireRole(['admin']), async (c) => {
  const body = await c.req.json();
  const id = uuid();
  const password = body.password || '123456';
  const hash = await hashPassword(c.env.SECRET_KEY, password);
  await c.env.DB.prepare(
    'INSERT INTO users (id, email, hashed_password, full_name, role, is_active, feishu_open_id, feishu_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, \'\', \'\', ?, ?)'
  ).bind(id, body.email, hash, body.full_name || '', (body.role || 'hr').toLowerCase(), now(), now()).run();
  const user = await getUser(c.env.DB, body.email);
  const serialized = serializeUser(user);
  // 安全修复 2026-07-24：不再在响应体回传明文密码，避免密码经网络/日志/缓存泄露。
  // 初始密码由 admin 在创建时自行设定（body.password），未设定时为默认值，需引导用户首次登录改密。
  return c.json({ ...serialized, password_set: !!body.password });
});

app.put('/api/auth/users/:id', authMiddleware, requireRole(['admin']), async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const updates: Record<string, any> = {};
  for (const k of ['full_name', 'email', 'role']) {
    if (body[k] !== undefined) updates[k] = k === 'role' ? body[k].toLowerCase() : body[k];
  }
  if (body.is_active !== undefined) updates.is_active = body.is_active ? 1 : 0;
  if (body.password) updates.hashed_password = await hashPassword(c.env.SECRET_KEY, body.password);
  if (Object.keys(updates).length === 0) return c.json({ detail: 'No updates' });
  const setClause = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  await c.env.DB.prepare(`UPDATE users SET ${setClause}, updated_at = ? WHERE id = ?`)
    .bind(...Object.values(updates), now(), id).run();
  const row = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
  return c.json(serializeUser(transformRow(row)));
});

app.put('/api/auth/users/:id/role', authMiddleware, requireRole(['admin']), async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  await c.env.DB.prepare('UPDATE users SET role = ?, updated_at = ? WHERE id = ?')
    .bind((body.role || 'hr').toLowerCase(), now(), id).run();
  const row = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
  return c.json(serializeUser(transformRow(row)));
});

app.get('/api/auth/users/:id/status', authMiddleware, requireRole(['admin']), async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB.prepare('SELECT is_active FROM users WHERE id = ?').bind(id).first();
  if (!row) return c.json({ detail: 'User not found' }, 404);
  return c.json({ is_active: row.is_active === 1 });
});

app.put('/api/auth/users/:id/password', authMiddleware, requireRole(['admin']), async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const newPassword = body.password || '123456';
  const hash = await hashPassword(c.env.SECRET_KEY, newPassword);
  await c.env.DB.prepare('UPDATE users SET hashed_password = ?, updated_at = ? WHERE id = ?')
    .bind(hash, now(), id).run();
  // 安全修复 2026-07-24：不再回传明文密码。密码由 admin 在请求中设定（body.password），
  // 未设定时使用默认值，需引导用户首次登录后修改。
  return c.json({ success: true, used_default: !body.password });
});

app.delete('/api/auth/users/:id', authMiddleware, requireRole(['admin']), async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
  return c.json({ detail: 'User deleted' });
});

app.get('/api/auth/interviewers', authMiddleware, async (c) => {
  const users = await c.env.DB.prepare(
    "SELECT id, full_name, email FROM users WHERE lower(role) != 'admin' AND is_active = 1"
  ).all();
  let mappings: { results?: unknown[] } = { results: [] };
  try {
    mappings = await c.env.DB.prepare('SELECT id, name FROM interviewer_mappings ORDER BY name').all();
  } catch {
    // Older databases may not have the optional mappings table yet.
  }
  return c.json(mergeInterviewerDirectoryEntries(
    (users.results || []) as any[],
    (mappings.results || []) as any[],
  ));
});

// GET /api/question-banks — 题库列表
app.get('/api/question-banks', authMiddleware, async (c) => {
  const result = await c.env.DB.prepare("SELECT id, name, category, questions FROM question_banks ORDER BY created_at DESC").all();
  const banks = (result.results || []).map((row: any) => ({
    id: row.id,
    name: row.name,
    category: row.category || 'technical',
    question_count: row.questions ? (() => { try { return JSON.parse(row.questions).length; } catch { return 0; } })() : 0,
  }));
  return c.json(banks);
});

// ==================== Dashboard Routes ====================

// 构建负责人过滤条件（返回 SQL 片段 + 参数）
export function getDashboardOwner(c: any): string | null {
  const user = c.get('user');
  // An HR user's owner boundary is server-controlled. Only admins may choose
  // another owner through the query parameter.
  if (!user || user.role !== 'admin') return user?.full_name || '__no_dashboard_owner__';
  return c.req.query('responsible_person') || null;
}

function buildOwnerFilter(c: any): { where: string; params: any[] } {
  const owner = getDashboardOwner(c);
  if (!owner) return { where: '', params: [] };
  return { where: 'AND responsible_person = ?', params: [owner] };
}

// 构建基于 positions 表的负责人过滤（用于 resumes/interviews/offers 等关联表）
function buildOwnerPosFilter(c: any): { wherePos: string; whereResume: string; params: any[] } {
  const owner = getDashboardOwner(c);
  if (!owner) return { wherePos: '', whereResume: '', params: [] };
  const p = [owner];
  return {
    wherePos: 'AND responsible_person = ?',
    whereResume: 'AND (position_id IN (SELECT id FROM positions WHERE responsible_person = ?) OR position_applied IN (SELECT raw_name FROM position_mappings WHERE responsible_person = ?) OR mapped_position IN (SELECT mapped_name FROM position_mappings WHERE responsible_person = ?))',
    params: [owner, owner, owner],
  };
}

// 解析 interviewers 字段（可能是 JSON 数组字符串、数组、或逗号分隔字符串）
function extractPersonNames(value: any): string[] {
  if (value == null || value === '') return [];
  const arr = Array.isArray(value) ? value : safeJsonParse(value);
  if (Array.isArray(arr)) {
    return arr.map(String).map((s) => s.trim()).filter((s) => s.length > 0);
  }
  return String(value).split(/[,，;；]/).map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * 按人构建简历过滤条件（"某人的相关简历"）：
 * 某人是岗位负责人/面试官（positions）、岗位映射责任人/面试官（position_mappings）、
 * 招聘任务责任人/面试官（recruitment_tasks）、或面试记录里的面试官（interviews）时，
 * 该岗位/该简历都算"相关"。返回 1 个简历 WHERE（各分支 OR 组合）。
 */
export async function buildPersonResumeFilter(db: D1Database, name: string): Promise<{ where: string; params: any[] }> {
  const clauses: string[] = [];
  const params: any[] = [];

  // 1. positions：负责人 / 一二面面试官
  const posIds: string[] = [];
  const posTitles: string[] = [];
  try {
    const posRows = await db.prepare(
      'SELECT id, title FROM positions WHERE responsible_person = ? OR primary_interviewer = ? OR secondary_interviewer = ?'
    ).bind(name, name, name).all();
    for (const r of (posRows.results || []) as any[]) {
      if (r.id) posIds.push(r.id);
      if (r.title) posTitles.push(r.title);
    }
  } catch { /* positions 表缺失时忽略 */ }

  // 2. position_mappings：责任人 / 面试官
  const rawNames: string[] = [];
  const mappedNames: string[] = [];
  try {
    const mapRows = await db.prepare('SELECT raw_name, mapped_name, responsible_person, interviewers FROM position_mappings').all();
    for (const r of (mapRows.results || []) as any[]) {
      if (r.responsible_person === name || extractPersonNames(r.interviewers).includes(name)) {
        if (r.raw_name) rawNames.push(r.raw_name);
        if (r.mapped_name) mappedNames.push(r.mapped_name);
      }
    }
  } catch { /* position_mappings 表可能不存在 */ }

  // 3. recruitment_tasks：责任人 / 面试官
  const taskPositionNames: string[] = [];
  try {
    const taskRows = await db.prepare('SELECT position_name, responsible_person, interviewers FROM recruitment_tasks').all();
    for (const r of (taskRows.results || []) as any[]) {
      if (r.responsible_person === name || extractPersonNames(r.interviewers).includes(name)) {
        if (r.position_name) taskPositionNames.push(r.position_name);
      }
    }
  } catch { /* recruitment_tasks 表可能不存在 */ }

  // 4. interviews：面试官姓名匹配（interviewer_id 存的是 user id 不是姓名，不做姓名匹配）
  const interviewResumeIds: string[] = [];
  try {
    const ivRows = await db.prepare(
      'SELECT resume_id FROM interviews WHERE interviewer = ? OR primary_interviewer = ? OR secondary_interviewer = ?'
    ).bind(name, name, name).all();
    for (const r of (ivRows.results || []) as any[]) {
      if (r.resume_id) interviewResumeIds.push(r.resume_id);
    }
  } catch { /* interviews 表可能不存在 */ }

  // 5. 组合简历 WHERE（各分支有数据才加入）
  if (posIds.length > 0) {
    clauses.push(`position_id IN (${posIds.map(() => '?').join(',')})`);
    params.push(...posIds);
  }

  const mappedNamesSet = [...new Set([...posTitles, ...mappedNames, ...taskPositionNames].map((s) => s.toLowerCase()))];
  if (mappedNamesSet.length > 0) {
    clauses.push(`LOWER(mapped_position) IN (${mappedNamesSet.map(() => '?').join(',')})`);
    params.push(...mappedNamesSet);
  }

  const appliedNamesSet = [...new Set([...posTitles, ...rawNames, ...taskPositionNames].map((s) => s.toLowerCase()))];
  if (appliedNamesSet.length > 0) {
    clauses.push(`LOWER(position_applied) IN (${appliedNamesSet.map(() => '?').join(',')})`);
    params.push(...appliedNamesSet);
  }

  if (interviewResumeIds.length > 0) {
    clauses.push(`id IN (${interviewResumeIds.map(() => '?').join(',')})`);
    params.push(...interviewResumeIds);
  }

  if (clauses.length === 0) return { where: '0', params: [] };
  return { where: `(${clauses.join(' OR ')})`, params };
}

app.get('/api/dashboard/stats', authMiddleware, async (c) => {
  const db = c.env.DB;
  const owner = getDashboardOwner(c);
  const p1 = owner ? [owner] : [];
  const p2 = owner ? [owner, owner, owner] : [];

  const activePos = owner
    ? await db.prepare("SELECT COUNT(*) as cnt FROM positions WHERE status IN ('open','published') AND responsible_person = ?").bind(...p1).first()
    : await db.prepare("SELECT COUNT(*) as cnt FROM positions WHERE status IN ('open','published')").first();
  const pendingResumes = owner
    ? await db.prepare("SELECT COUNT(*) as cnt FROM resumes WHERE status IN ('pending_screening','pending_review','pending_dept_review','pending_hr_decision') AND (position_id IN (SELECT id FROM positions WHERE responsible_person = ?) OR position_applied IN (SELECT raw_name FROM position_mappings WHERE responsible_person = ?) OR mapped_position IN (SELECT mapped_name FROM position_mappings WHERE responsible_person = ?))").bind(...p2).first()
    : await db.prepare("SELECT COUNT(*) as cnt FROM resumes WHERE status IN ('pending_screening','pending_review','pending_dept_review','pending_hr_decision')").first();
  const todayInterviews = await db.prepare("SELECT COUNT(*) as cnt FROM interviews WHERE date(interview_time) = date('now')").first();
  return c.json({
    stats: {
      active_positions: (activePos as any)?.cnt || 0,
      pending_resumes: (pendingResumes as any)?.cnt || 0,
      today_interviews: (todayInterviews as any)?.cnt || 0,
      trends: { active_positions: 0, pending_resumes: 0, today_interviews: 0 }
    },
    recent_activities: []
  });
});

app.get('/api/dashboard/funnel', authMiddleware, async (c) => {
  const db = c.env.DB;
  const { whereResume: rw, params: rp } = buildOwnerPosFilter(c);
  const row = await db.prepare(
    `SELECT COUNT(*) as total,
       SUM(CASE WHEN stage = 'new' THEN 1 ELSE 0 END) as new_cnt,
       SUM(CASE WHEN stage = 'screening' THEN 1 ELSE 0 END) as screening_cnt,
       SUM(CASE WHEN stage = 'interview' THEN 1 ELSE 0 END) as interview_cnt,
       SUM(CASE WHEN stage = 'offer' THEN 1 ELSE 0 END) as offer_cnt,
       SUM(CASE WHEN stage = 'hired' THEN 1 ELSE 0 END) as hired_cnt
     FROM resumes WHERE 1=1 ${rw}`
  ).bind(...rp).first() as any;
  const totalResumes = row?.total || 0;
  const stages = [
    { stage: 'new', stage_name: '新简历', count: row?.new_cnt || 0 },
    { stage: 'screening', stage_name: '筛选中', count: row?.screening_cnt || 0 },
    { stage: 'interview', stage_name: '面试中', count: row?.interview_cnt || 0 },
    { stage: 'offer', stage_name: 'Offer', count: row?.offer_cnt || 0 },
    { stage: 'hired', stage_name: '已入职', count: row?.hired_cnt || 0 },
  ];
  const result = stages.map(s => ({
    ...s,
    percentage: totalResumes > 0 ? Math.round(s.count / totalResumes * 100) : 0
  }));
  return c.json({ stages: result, total_resumes: totalResumes, conversion_rate: totalResumes > 0 ? Math.round((result[4].count / totalResumes) * 100) : 0 });
});

app.get('/api/dashboard/positions', authMiddleware, dashboardPositionsHandler);
app.get('/api/dashboard/positions-detail', authMiddleware, dashboardPositionsHandler);

function makeRecruitingBoardResponse(positions: RecruitingBoardPositionRow[]) {
  return buildRecruitingBoard(positions, { dataMode: 'live', updatedAt: now() });
}

export async function createDashboardSnapshot(
  db: D1Database,
  snapshotDate: string,
  board: RecruitingBoard,
  generatedBy: string,
  generatedAt: string,
) {
  const present = await db.prepare('SELECT id FROM dashboard_snapshots WHERE snapshot_date = ?').bind(snapshotDate).first();
  if (present) throw new Error('snapshot already exists');
  const row = {
    id: uuid(),
    snapshot_date: snapshotDate,
    payload_json: JSON.stringify({ ...board, data_mode: 'snapshot', snapshot_date: snapshotDate }),
    generated_at: generatedAt,
    generated_by: generatedBy,
    created_at: generatedAt,
  };
  try {
    await db.prepare(
      'INSERT INTO dashboard_snapshots (id, snapshot_date, payload_json, generated_at, generated_by, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(row.id, row.snapshot_date, row.payload_json, row.generated_at, row.generated_by, row.created_at).run();
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE constraint failed: dashboard_snapshots.snapshot_date')) {
      throw new Error('snapshot already exists');
    }
    throw error;
  }
  return row;
}

export async function createDashboardV3Snapshot(
  db: D1Database,
  snapshotDate: string,
  board: DashboardV3Board,
  generatedBy: string,
  generatedAt: string,
) {
  const present = await db.prepare('SELECT id FROM dashboard_snapshots WHERE snapshot_date = ?').bind(snapshotDate).first();
  if (present) throw new Error('snapshot already exists');
  const row = {
    id: uuid(),
    snapshot_date: snapshotDate,
    payload_json: JSON.stringify({ ...board, data_mode: 'snapshot', snapshot_date: snapshotDate, schema_version: 'dashboard-v3' }),
    generated_at: generatedAt,
    generated_by: generatedBy,
    created_at: generatedAt,
  };
  await db.prepare(
    'INSERT INTO dashboard_snapshots (id, snapshot_date, payload_json, generated_at, generated_by, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).bind(row.id, row.snapshot_date, row.payload_json, row.generated_at, row.generated_by, row.created_at).run();
  return row;
}

export async function readDashboardSnapshot(db: D1Database, snapshotDate: string): Promise<RecruitingBoard | null> {
  const row = await db.prepare('SELECT payload_json FROM dashboard_snapshots WHERE snapshot_date = ?').bind(snapshotDate).first<{ payload_json: string }>();
  return row ? JSON.parse(row.payload_json) as RecruitingBoard : null;
}

async function readDashboardSnapshotById(db: D1Database, snapshotId: string): Promise<RecruitingBoard | null> {
  const row = await db.prepare('SELECT payload_json FROM dashboard_snapshots WHERE id = ?').bind(snapshotId).first<{ payload_json: string }>();
  return row ? JSON.parse(row.payload_json) as RecruitingBoard : null;
}

function applyRecruitingBoardOwnerScope(board: RecruitingBoard, owner: string | null): RecruitingBoard {
  if (!owner) return board;
  return buildRecruitingBoard(
    board.divisions.flatMap((division) => division.positions).filter((position) => position.hrbp === owner),
    { dataMode: board.data_mode, updatedAt: board.updated_at, snapshotDate: board.snapshot_date },
  );
}

async function loadLiveRecruitingBoard(db: D1Database, owner: string | null): Promise<RecruitingBoard> {
  return makeRecruitingBoardResponse(await getDashboardPositionRowsForOwner(db, owner));
}

app.get('/api/dashboard/recruiting-board', authMiddleware, async (c) => {
  const mode = c.req.query('mode') || 'live';
  if (mode !== 'live' && mode !== 'snapshot') return c.json({ detail: 'Invalid dashboard data mode' }, 400);
  const owner = getDashboardOwner(c);

  let board: RecruitingBoard | null;
  if (mode === 'snapshot') {
    const snapshotDate = c.req.query('snapshot_date');
    if (!snapshotDate) return c.json({ detail: 'snapshot_date is required' }, 400);
    board = await readDashboardSnapshot(c.env.DB, snapshotDate);
    if (!board) return c.json({ detail: 'Snapshot not found' }, 404);
  } else {
    board = await loadLiveRecruitingBoard(c.env.DB, owner);
  }
  return c.json(mode === 'snapshot' ? applyRecruitingBoardOwnerScope(board, owner) : board);
});

function dashboardRecruitmentTableIds(env: Env): { zhipei: string; yanglao: string } {
  return {
    zhipei: env.FEISHU_ZHIPEI_RECRUITMENT_TABLE_ID || env.FEISHU_REQUISITION_TABLE_ID || FEISHU_CONFIG.requisitionTableId,
    yanglao: env.FEISHU_YANGLAO_RECRUITMENT_TABLE_ID || env.FEISHU_POSITION_TABLE_ID || FEISHU_CONFIG.positionTableId,
  };
}

async function loadFeishuDashboardPositions(env: Env, userEmail?: string): Promise<FeishuPositionMetric[]> {
  const dedicatedSources = buildDashboardFeishuSources(env);
  let sourceRecords: Array<{ table: 'zhipei' | 'yanglao'; records: any[] }>;

  if (dedicatedSources) {
    const email = env.FEISHU_DASHBOARD_USER_EMAIL?.trim() || userEmail?.trim();
    if (!email) {
      throw new Error('Dashboard Feishu user email is not configured');
    }
    const accessToken = await getValidUserAccessToken(env, email);
    if (!accessToken) {
      throw new Error(`Dashboard Feishu user token is not authorized for ${email}`);
    }
    sourceRecords = await Promise.all(dedicatedSources.map(async (source) => ({
      table: source.key,
      records: await listDashboardBitableRecords(accessToken, source),
    })));
  } else {
    const tableIds = dashboardRecruitmentTableIds(env);
    const [zhipeiRecords, yanglaoRecords] = await Promise.all([
      bitableListRecords(env, tableIds.zhipei),
      bitableListRecords(env, tableIds.yanglao),
    ]);
    sourceRecords = [
      { table: 'zhipei', records: zhipeiRecords },
      { table: 'yanglao', records: yanglaoRecords },
    ];
  }

  const records: FeishuBoardSourceRecord[] = [
    ...sourceRecords.flatMap(({ table, records: rows }) => rows.map((record: any) => ({
      record_id: String(record.record_id || record.id || ''),
      fields: record.fields || {},
      table,
    }))),
  ];
  return records.map(normalizeFeishuPositionRecord).filter((position): position is FeishuPositionMetric => Boolean(position));
}

function filterV3OverlayForOwner(overlay: D1DashboardOverlay, positions: FeishuPositionMetric[], owner: string | null): D1DashboardOverlay {
  if (!owner) return overlay;
  const allowedIds = new Set(positions.filter((position) => position.hrbps.includes(owner)).map((position) => position.feishu_record_id));
  return {
    ...overlay,
    byPosition: Object.fromEntries(Object.entries(overlay.byPosition).filter(([positionId]) => allowedIds.has(positionId))),
    d1OnlyPositions: overlay.d1OnlyPositions.filter((position) => position.hrbps.includes(owner)),
  };
}

async function readLatestV3Snapshot(db: D1Database): Promise<DashboardV3Board | null> {
  const rows = await db.prepare('SELECT payload_json FROM dashboard_snapshots ORDER BY snapshot_date DESC LIMIT 10').all();
  for (const row of rows.results || []) {
    try {
      const payload = JSON.parse(String((row as any).payload_json || '{}')) as DashboardV3Board;
      if (payload.schema_version === 'dashboard-v3') return payload;
    } catch { /* ignore malformed legacy snapshots */ }
  }
  return null;
}

async function loadLiveDashboardV3(db: D1Database, env: Env, owner: string | null, userEmail?: string): Promise<DashboardV3Board> {
  const allPositions = await loadFeishuDashboardPositions(env, userEmail);
  const positions = owner ? allPositions.filter((position) => position.hrbps.includes(owner)) : allPositions;
  const overlay = filterV3OverlayForOwner(await loadD1DashboardOverlay(db, positions), positions, owner);
  return buildDashboardV3({
    feishuPositions: positions,
    d1Overlay: overlay,
    baseline: await readLatestV3Snapshot(db),
    dataMode: 'live',
    dataSource: 'feishu',
    updatedAt: now(),
  });
}

async function loadStaticDashboardV3(db: D1Database, owner: string | null): Promise<DashboardV3Board> {
  const allPositions = loadStaticDashboardPositions();
  const positions = owner ? allPositions.filter((position) => position.hrbps.includes(owner)) : allPositions;
  const overlay = filterV3OverlayForOwner(await loadD1DashboardOverlay(db, positions), positions, owner);
  return buildDashboardV3({
    feishuPositions: positions,
    d1Overlay: overlay,
    dataMode: 'live',
    dataSource: 'static_excel',
    snapshotDate: STATIC_DASHBOARD_SNAPSHOT_DATE,
    updatedAt: STATIC_DASHBOARD_UPDATED_AT,
  });
}

async function readDashboardV3Snapshot(db: D1Database, snapshotDate: string): Promise<DashboardV3Board | null> {
  const row = await db.prepare('SELECT payload_json FROM dashboard_snapshots WHERE snapshot_date = ?').bind(snapshotDate).first<{ payload_json: string }>();
  if (!row) return null;
  try {
    const payload = JSON.parse(row.payload_json) as DashboardV3Board;
    return payload.schema_version === 'dashboard-v3' ? payload : null;
  } catch {
    return null;
  }
}

function filterDashboardV3Owner(board: DashboardV3Board, owner: string | null): DashboardV3Board {
  return scopeDashboardV3Board(board, owner);
}

app.get('/api/dashboard/recruiting-board-v3', authMiddleware, async (c) => {
  const mode = c.req.query('mode') || 'live';
  if (mode !== 'live' && mode !== 'snapshot') return c.json({ detail: 'Invalid dashboard data mode' }, 400);
  const source = c.req.query('source') || 'static';
  if (source !== 'static' && source !== 'feishu') return c.json({ detail: 'Invalid dashboard data source' }, 400);
  const owner = getDashboardOwner(c);
  const dashboardUserEmail = (c as any).get('user')?.email as string | undefined;
  try {
    if (mode === 'snapshot') {
      const snapshotDate = c.req.query('snapshot_date');
      if (!snapshotDate) return c.json({ detail: 'snapshot_date is required' }, 400);
      const board = await readDashboardV3Snapshot(c.env.DB, snapshotDate);
      if (!board) return c.json({ detail: 'Dashboard v3 snapshot not found' }, 404);
      return c.json(filterDashboardV3Owner(board, owner));
    }
    return c.json(source === 'static'
      ? await loadStaticDashboardV3(c.env.DB, owner)
      : await loadLiveDashboardV3(c.env.DB, c.env, owner, dashboardUserEmail));
  } catch (error: any) {
    console.error('[DashboardV3] load failed:', error);
    return c.json({ detail: '仪表盘 v3 数据加载失败', code: 'DASHBOARD_V3_SOURCE_ERROR' }, 502);
  }
});

app.post('/api/dashboard/recruiting-board-v3/sync', authMiddleware, requireRole(['admin']), async (c) => {
  try {
    const dashboardUserEmail = (c as any).get('user')?.email as string | undefined;
    return c.json(await loadLiveDashboardV3(c.env.DB, c.env, null, dashboardUserEmail));
  } catch (error) {
    console.error('[DashboardV3] manual Feishu sync failed:', error);
    return c.json({ detail: '飞书数据同步失败，请确认招聘表权限后重试', code: 'DASHBOARD_V3_SYNC_ERROR' }, 502);
  }
});

app.get('/api/dashboard/recruiting-board-v3/reconciliation', authMiddleware, requireRole(['admin']), async (c) => {
  try {
    const dashboardUserEmail = (c as any).get('user')?.email as string | undefined;
    const positions = await loadFeishuDashboardPositions(c.env, dashboardUserEmail);
    const overlay = await loadD1DashboardOverlay(c.env.DB, positions);
    return c.json(buildDashboardReconciliation(positions, overlay, now()));
  } catch (error) {
    console.error('[DashboardV3] reconciliation failed:', error);
    return c.json({ detail: '仪表盘对账数据加载失败', code: 'DASHBOARD_V3_RECONCILIATION_ERROR' }, 502);
  }
});

app.get('/api/dashboard/snapshots', authMiddleware, async (c) => {
  const result = await c.env.DB.prepare(
    'SELECT id, snapshot_date, generated_at FROM dashboard_snapshots ORDER BY snapshot_date DESC',
  ).all();
  return c.json({ snapshots: result.results || [] });
});

const DASHBOARD_EXCEL_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_DASHBOARD_EXCEL_BASE64_LENGTH = 4_000_000;

type DashboardExcelArchiveRow = {
  id: string;
  snapshot_date: string;
  file_type?: string;
  file_name: string;
  content_type: string;
  file_size: number;
  content_base64?: string;
  generated_at: string;
};

function dashboardExcelArchiveMetadata(row: DashboardExcelArchiveRow) {
  return {
    id: row.id,
    snapshot_date: row.snapshot_date,
    file_type: row.file_type || 'dashboard',
    file_name: row.file_name,
    content_type: row.content_type || DASHBOARD_EXCEL_CONTENT_TYPE,
    file_size: Number(row.file_size || 0),
    generated_at: row.generated_at,
  };
}

function dashboardExcelByteLength(contentBase64: string): number | null {
  const normalized = contentBase64.replace(/\s+/g, '');
  if (!normalized || normalized.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) return null;
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor(normalized.length * 3 / 4) - padding);
}

function decodeDashboardExcel(contentBase64: string): Uint8Array | null {
  const normalized = contentBase64.replace(/\s+/g, '');
  if (dashboardExcelByteLength(normalized) === null) return null;
  try {
    const binary = atob(normalized);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

app.get('/api/dashboard/excel-archives', authMiddleware, async (c) => {
  const result = await c.env.DB.prepare(
    'SELECT id, snapshot_date, file_type, file_name, content_type, file_size, generated_at FROM dashboard_excel_archives ORDER BY snapshot_date DESC, generated_at DESC',
  ).all<DashboardExcelArchiveRow>();
  return c.json({ archives: (result.results || []).map(dashboardExcelArchiveMetadata) });
});

app.get('/api/dashboard/excel-archives/:id/download', authMiddleware, async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB.prepare(
    'SELECT id, snapshot_date, file_type, file_name, content_type, file_size, content_base64, generated_at FROM dashboard_excel_archives WHERE id = ?',
  ).bind(id).first<DashboardExcelArchiveRow>();
  if (!row || !row.content_base64) return c.json({ detail: 'Excel archive not found' }, 404);
  const bytes = decodeDashboardExcel(row.content_base64);
  if (!bytes) return c.json({ detail: 'Excel archive content is invalid' }, 500);
  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': row.content_type || DASHBOARD_EXCEL_CONTENT_TYPE,
      'Content-Length': String(bytes.byteLength),
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(row.file_name)}`,
      'Cache-Control': 'private, no-store',
    },
  });
});

app.post('/api/dashboard/excel-archives', authMiddleware, requireRole(['admin']), async (c) => {
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  const snapshotDate = typeof body?.snapshot_date === 'string' ? body.snapshot_date.trim() : '';
  const fileType = typeof body?.file_type === 'string' && /^[a-z0-9_-]{1,32}$/i.test(body.file_type.trim())
    ? body.file_type.trim()
    : 'dashboard';
  const fileName = typeof body?.file_name === 'string' ? body.file_name.trim() : '';
  const contentBase64 = typeof body?.content_base64 === 'string' ? body.content_base64.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)) return c.json({ detail: 'snapshot_date must use YYYY-MM-DD' }, 400);
  if (!fileName || !/\.xlsx$/i.test(fileName)) return c.json({ detail: 'file_name must be an .xlsx file' }, 400);
  if (!contentBase64 || contentBase64.length > MAX_DASHBOARD_EXCEL_BASE64_LENGTH) {
    return c.json({ detail: 'Excel archive is empty or too large' }, 413);
  }
  const fileSize = dashboardExcelByteLength(contentBase64);
  if (!fileSize) return c.json({ detail: 'content_base64 is invalid' }, 400);

  const generatedAt = now();
  const user = (c as any).get('user') as any;
  const generatedBy = String(user?.email || 'unknown');
  const existing = await c.env.DB.prepare(
    'SELECT id FROM dashboard_excel_archives WHERE snapshot_date = ? AND file_type = ?',
  ).bind(snapshotDate, fileType).first<{ id: string }>();
  const id = existing?.id || uuid();

  if (existing) {
    await c.env.DB.prepare(
      'UPDATE dashboard_excel_archives SET file_name = ?, content_type = ?, file_size = ?, content_base64 = ?, generated_at = ?, generated_by = ? WHERE id = ?',
    ).bind(fileName, DASHBOARD_EXCEL_CONTENT_TYPE, fileSize, contentBase64, generatedAt, generatedBy, id).run();
  } else {
    await c.env.DB.prepare(
      'INSERT INTO dashboard_excel_archives (id, snapshot_date, file_type, file_name, content_type, file_size, content_base64, generated_at, generated_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(id, snapshotDate, fileType, fileName, DASHBOARD_EXCEL_CONTENT_TYPE, fileSize, contentBase64, generatedAt, generatedBy, generatedAt).run();
  }

  return c.json(dashboardExcelArchiveMetadata({
    id,
    snapshot_date: snapshotDate,
    file_type: fileType,
    file_name: fileName,
    content_type: DASHBOARD_EXCEL_CONTENT_TYPE,
    file_size: fileSize,
    generated_at: generatedAt,
  }), existing ? 200 : 201);
});

app.post('/api/dashboard/snapshots', authMiddleware, requireRole(['admin']), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const hasSuppliedDate = body !== null && typeof body === 'object'
    && (Object.hasOwn(body, 'date') || Object.hasOwn(body, 'snapshot_date'));
  if (c.req.query('date') !== undefined || c.req.query('snapshot_date') !== undefined || hasSuppliedDate) {
    return c.json({ detail: 'Snapshots can only be created for today' }, 400);
  }

  const generatedAt = now();
  const snapshotDate = toShanghaiSnapshotDate(new Date(generatedAt));
  const user = (c as any).get('user') as any;
  try {
    const snapshot = await createDashboardSnapshot(
      c.env.DB,
      snapshotDate,
      await loadLiveRecruitingBoard(c.env.DB, null),
      user.email,
      generatedAt,
    );
    return c.json({ id: snapshot.id, snapshot_date: snapshot.snapshot_date, generated_at: snapshot.generated_at }, 201);
  } catch (error) {
    if (error instanceof Error && error.message === 'snapshot already exists') return c.json({ detail: error.message }, 409);
    throw error;
  }
});

app.post('/api/dashboard/snapshots-v3', authMiddleware, requireRole(['admin']), async (c) => {
  const generatedAt = now();
  const snapshotDate = toShanghaiSnapshotDate(new Date(generatedAt));
  const user = c.get('user') as any;
  try {
    const snapshot = await createDashboardV3Snapshot(
      c.env.DB,
      snapshotDate,
      await loadLiveDashboardV3(c.env.DB, c.env, null),
      user.email,
      generatedAt,
    );
    return c.json({ id: snapshot.id, snapshot_date: snapshot.snapshot_date, generated_at: snapshot.generated_at, schema_version: 'dashboard-v3' }, 201);
  } catch (error) {
    if (error instanceof Error && error.message === 'snapshot already exists') return c.json({ detail: error.message }, 409);
    return c.json({ detail: 'Dashboard v3 snapshot creation failed' }, 500);
  }
});

type SharedBoardResult = { status: 200; body: Record<string, unknown> } | { status: 404; body: null };

const PUBLIC_BOARD_KPI_FIELDS = [
  'active_positions',
  'total_headcount',
  'total_resumes',
  'first_interview',
  'offers',
  'hired',
] as const;
const HR_OWNER_SCOPE_PREFIX = '__owner__:';
const DASHBOARD_VERSION_SCOPE_PREFIX = '__dashboard_version__:';
type PublicShareScope = { owner: string | null; divisions: string[]; dashboardVersion: 'v2' | 'v3' };

function toPublicRecruitingBoard(board: Record<string, any>, scope: PublicShareScope): Record<string, unknown> {
  if (board.version === 'v2') return toPublicRecruitingBoardV2(board as RecruitingBoard, scope) as unknown as Record<string, unknown>;
  if (board.schema_version === 'dashboard-v3') {
    const scopedPositions = (board.positions || []).filter((position: any) =>
      (!scope.owner || (position.hrbps || []).includes(scope.owner))
      && (!scope.divisions.length || scope.divisions.includes(position.department)),
    );
    const scopedDepartments = new Set(scopedPositions.map((position: any) => position.department));
    const publicPosition = (position: any) => ({
      position_id: position.position_id,
      department: position.department,
      position_name: position.position_name,
      display_name: position.display_name,
      city: position.city,
      hrbps: position.hrbps,
      priority: position.priority,
      status: position.status,
      headcount: position.headcount,
      resume_push: position.resume_push,
      first_scheduled: position.first_scheduled,
      first_pass: position.first_pass,
      second_pass: position.second_pass,
      final_pass: position.final_pass,
      offers: position.offers,
      hired: position.hired,
      elapsed_days: position.elapsed_days,
      weekly_target: position.weekly_target,
      notes: position.notes,
      data_sources: position.data_sources,
      unmatched: position.unmatched,
    });
    const divisions = (board.divisions || [])
      .filter((division: any) => scopedDepartments.has(division.department))
      .map((division: any) => ({
        department: division.department,
        hrbps: division.hrbps,
        totals: division.totals,
        funnel: division.funnel,
        p0_position_count: division.p0_position_count,
        p1_position_count: division.p1_position_count,
        completed_position_count: division.completed_position_count,
        in_progress_position_count: division.in_progress_position_count,
        in_progress_average_elapsed_days: division.in_progress_average_elapsed_days,
        positions: division.positions.filter((position: any) => scopedPositions.some((item: any) => item.position_id === position.position_id)).map(publicPosition),
      }));
    const hrbps = (board.hrbps || []).filter((hrbp: any) => !scope.owner || hrbp.name === scope.owner);
    return {
      schema_version: 'dashboard-v3',
      data_mode: board.data_mode,
      snapshot_date: board.snapshot_date || null,
      updated_at: board.updated_at,
      kpis: board.kpis,
      funnel: board.funnel,
      totals: board.totals,
      insights: board.insights,
      weekly_dynamic: board.weekly_dynamic,
      divisions,
      hrbps,
      positions: scopedPositions.map(publicPosition),
      p2_positions: (board.p2_positions || []).filter((position: any) =>
        (!scope.owner || (position.hrbps || []).includes(scope.owner))
        && (!scope.divisions.length || scope.divisions.includes(position.department)),
      ).map(publicPosition),
    };
  }
  const scopedRows = scope.divisions.length
    ? (board.rows || []).filter((row: any) => scope.divisions.includes(row.division))
    : (board.rows || []);
  const scopedPositions = scopedRows.flatMap((row: any) => row.positions || []);
  const scopedKpis = scopedPositions.reduce((totals: Record<string, number>, position: any) => ({
    active_positions: totals.active_positions + (position.status === '招聘中' ? 1 : 0),
    total_headcount: totals.total_headcount + (position.status === '招聘中' ? position.headcount || 0 : 0),
    total_resumes: totals.total_resumes + (position.total_resumes || 0),
    first_interview: totals.first_interview + (position.first_interview || 0),
    offers: totals.offers + (position.offers || 0),
    hired: totals.hired + (position.hired || 0),
  }), { active_positions: 0, total_headcount: 0, total_resumes: 0, first_interview: 0, offers: 0, hired: 0 });
  const publicRows = scopedRows.map((row: any) => ({
    ...toPublicBoardRow({
      division: row.division,
      hrbp: row.hrbp,
      urgency: row.priority,
      headcount: row.headcount,
      total_resumes: row.total_resumes,
      first_interview: row.first_interview,
      first_interview_passed: row.first_pass,
      second_interview_passed: row.second_pass,
      third_interview_passed: row.third_pass,
      pass_rate: row.pass_rate,
      offer_count: row.offers,
      onboarded_count: row.hired,
      remark: row.notes,
      status: row.status,
    }),
    positions: (row.positions || []).map((position: any) => toPublicBoardRow({
      division: position.division,
      hrbp: position.hrbp,
      position: position.position,
      urgency: position.priority,
      headcount: position.headcount,
      total_resumes: position.total_resumes,
      first_interview: position.first_interview,
      first_interview_passed: position.first_pass,
      second_interview_passed: position.second_pass,
      third_interview_passed: position.third_pass,
      pass_rate: position.first_interview ? Math.round(position.first_pass / position.first_interview * 100) : null,
      offer_count: position.offers,
      onboarded_count: position.hired,
      remark: position.notes,
      status: position.status,
    })),
  }));
  return {
    version: board.version,
    updated_at: board.updated_at,
    kpis: Object.fromEntries(PUBLIC_BOARD_KPI_FIELDS
      .map((field) => [field, scopedKpis[field]])),
    rows: publicRows,
  };
}

function parsePublicShareScope(link: any): PublicShareScope {
  const parsedValues = typeof link.scope_ids === 'string' ? safeJsonParse(link.scope_ids) : [];
  const values: string[] = Array.isArray(parsedValues)
    ? parsedValues.filter((value: unknown): value is string => typeof value === 'string')
    : [];
  const ownerValue = values.find((value) => value.startsWith(HR_OWNER_SCOPE_PREFIX));
  const dashboardVersionValue = values.find((value) => value.startsWith(DASHBOARD_VERSION_SCOPE_PREFIX));
  return {
    owner: ownerValue ? ownerValue.slice(HR_OWNER_SCOPE_PREFIX.length) || null : null,
    divisions: link.scope_type === 'divisions'
      ? values.filter((value) => !value.startsWith(HR_OWNER_SCOPE_PREFIX) && !value.startsWith(DASHBOARD_VERSION_SCOPE_PREFIX))
      : [],
    dashboardVersion: dashboardVersionValue?.slice(DASHBOARD_VERSION_SCOPE_PREFIX.length) === 'v3' ? 'v3' : 'v2',
  };
}

/** Validates a token before calculating and exposing a privacy-safe board. */
export async function getSharedBoard(
  db: D1Database,
  token: string,
  at = new Date(),
  loadBoard?: (scope: PublicShareScope, link: Record<string, any>) => Promise<Record<string, any> | null>,
): Promise<SharedBoardResult> {
  const tokenHash = await hashShareToken(token);
  const link = await db.prepare(
    'SELECT scope_type, scope_ids, expires_at, revoked_at, data_mode, snapshot_id FROM dashboard_share_links WHERE token_hash = ?'
  ).bind(tokenHash).first() as any;
  if (!link || !isShareLinkActive(link, at)) return { status: 404, body: null };

  const scope = parsePublicShareScope(link);
  const dataMode = link.data_mode || 'live';
  let board: Record<string, any> | null;
  if (dataMode === 'snapshot') {
    if (typeof link.snapshot_id !== 'string' || !link.snapshot_id) return { status: 404, body: null };
    board = await readDashboardSnapshotById(db, link.snapshot_id);
  } else if (dataMode === 'live') {
    board = loadBoard ? await loadBoard(scope, link) : { version: 'v1', updated_at: at.toISOString(), kpis: {}, rows: [] };
  } else {
    return { status: 404, body: null };
  }
  if (!board) return { status: 404, body: null };
  if (board.version === 'v2' && scope.owner) {
    board = applyRecruitingBoardOwnerScope(board as RecruitingBoard, scope.owner);
  } else if (board.schema_version === 'dashboard-v3' && scope.owner) {
    board = scopeDashboardV3Board(board as DashboardV3Board, scope.owner);
  }
  return { status: 200, body: toPublicRecruitingBoard(board, scope) };
}

function createShareToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return b64urlBuf(bytes.buffer);
}

function serializeShareLink(link: any) {
  return {
    id: link.id,
    scope_type: link.scope_type,
    scope_ids: safeJsonParse(link.scope_ids) || [],
    expires_at: link.expires_at,
    revoked_at: link.revoked_at,
    data_mode: link.data_mode || 'live',
    snapshot_id: link.snapshot_id || null,
    created_by: link.created_by,
    created_at: link.created_at,
  };
}

app.post('/api/dashboard/share-links', authMiddleware, requireRole(['admin', 'hr']), async (c) => {
  const body = await c.req.json().catch(() => ({})) as any;
  const expiry = body.expiry as ShareExpiryOption;
  if (!['1d', '7d', '30d', 'permanent'].includes(expiry)) return c.json({ detail: 'Invalid share expiry' }, 400);
  const dataMode = body.data_mode ?? 'live';
  const snapshotId = body.snapshot_id ?? null;
  try {
    assertShareDataMode(dataMode, snapshotId);
  } catch (error) {
    return c.json({ detail: error instanceof Error ? error.message : 'Invalid dashboard data mode' }, 400);
  }
  if (dataMode === 'snapshot') {
    const snapshot = await c.env.DB.prepare('SELECT id FROM dashboard_snapshots WHERE id = ?').bind(snapshotId).first();
    if (!snapshot) return c.json({ detail: 'Snapshot not found' }, 404);
  }
  const user = c.get('user') as any;
  const isAdmin = user.role === 'admin';
  const scopeType = isAdmin && body.scope_type === 'divisions' ? 'divisions' : 'all';
  const dashboardVersion = body.dashboard_version === 'v3' ? 'v3' : 'v2';
  const baseScopeIds = isAdmin
    ? (Array.isArray(body.scope_ids) ? body.scope_ids.filter((value: unknown): value is string => typeof value === 'string' && value.trim().length > 0) : [])
    : (user.full_name ? [`${HR_OWNER_SCOPE_PREFIX}${user.full_name}`] : []);
  const scopeIds = [...baseScopeIds, `${DASHBOARD_VERSION_SCOPE_PREFIX}${dashboardVersion}`];
  if (!isAdmin && scopeIds.length === 0) return c.json({ detail: 'HR profile must include a full name before sharing' }, 400);
  if (scopeType === 'divisions' && scopeIds.length === 0) return c.json({ detail: 'Division scope requires at least one division' }, 400);

  const token = createShareToken();
  const expiresAt = createShareExpiry(expiry)?.toISOString() || null;
  const id = uuid();
  const createdAt = now();
  await c.env.DB.prepare(
    'INSERT INTO dashboard_share_links (id, token_hash, scope_type, scope_ids, expires_at, revoked_at, data_mode, snapshot_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)'
  ).bind(id, await hashShareToken(token), scopeType, JSON.stringify(scopeIds), expiresAt, dataMode, snapshotId, user.email, createdAt).run();
  return c.json({ link: { id, scope_type: scopeType, scope_ids: scopeIds, expires_at: expiresAt, revoked_at: null, data_mode: dataMode, snapshot_id: snapshotId, created_by: user.email, created_at: createdAt }, token }, 201);
});

app.get('/api/dashboard/share-links', authMiddleware, requireRole(['admin', 'hr']), async (c) => {
  const user = c.get('user');
  const isAdmin = user.role === 'admin';
  const query = isAdmin
    ? c.env.DB.prepare('SELECT * FROM dashboard_share_links ORDER BY created_at DESC')
    : c.env.DB.prepare('SELECT * FROM dashboard_share_links WHERE created_by = ? ORDER BY created_at DESC').bind(user.email);
  const result = await query.all();
  return c.json({ links: (result.results || []).map(serializeShareLink) });
});

app.delete('/api/dashboard/share-links/:id', authMiddleware, requireRole(['admin', 'hr']), async (c) => {
  const user = c.get('user');
  const isAdmin = user.role === 'admin';
  const statement = isAdmin
    ? c.env.DB.prepare('UPDATE dashboard_share_links SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').bind(now(), c.req.param('id'))
    : c.env.DB.prepare('UPDATE dashboard_share_links SET revoked_at = ? WHERE id = ? AND created_by = ? AND revoked_at IS NULL').bind(now(), c.req.param('id'), user.email);
  const result = await statement.run();
  if (!result.meta.changes) return c.json({ detail: 'Share link not found' }, 404);
  return c.json({ ok: true });
});

app.get('/api/shared/dashboard/:token', async (c) => {
  const result = await getSharedBoard(
    c.env.DB,
    c.req.param('token'),
    new Date(),
    async (scope) => scope.dashboardVersion === 'v3'
      ? loadLiveDashboardV3(c.env.DB, c.env, scope.owner)
      : loadLiveRecruitingBoard(c.env.DB, scope.owner),
  );
  return result.status === 404 ? c.notFound() : c.json(result.body);
});

async function dashboardPositionsHandler(c: any) {
  return c.json(await getDashboardPositionRows(c));
}

async function getDashboardPositionRows(c: any): Promise<RecruitingBoardPositionRow[]> {
  return getDashboardPositionRowsForOwner(c.env.DB, getDashboardOwner(c));
}

export async function getDashboardPositionRowsForOwner(db: D1Database, owner: string | null): Promise<RecruitingBoardPositionRow[]> {
  const ow = owner ? 'AND responsible_person = ?' : '';
  const op = owner ? [owner] : [];
  const positions = await db.prepare(`SELECT * FROM positions WHERE 1=1 ${ow} ORDER BY created_at DESC`).bind(...op).all();
  const positionRows = positions.results || [];

  const pIds = positionRows.map((p: any) => p.id);
  let posFilter = '';
  let posParams: any[] = [];
  if (pIds.length > 0) {
    const placeholders = pIds.map(() => '?').join(',');
    posFilter = `AND position_id IN (${placeholders})`;
    posParams = pIds;
  } else if (ow) {
    // owner 有选中但无岗位 → 全部返回 0
    return [];
  }

  const bindAll = (sql: string) => db.prepare(sql).bind(...posParams).all();

  const [
    knownPositions, mappings, resumes, iv1Scheduled, iv1Pass, iv2Pass, iv3Pass, offerCounts, hiredCounts
  ] = await Promise.all([
    owner ? db.prepare('SELECT id FROM positions').bind().all() : Promise.resolve(positions),
    db.prepare(`SELECT raw_name, raw_names, mapped_name, responsible_person FROM position_mappings ${owner ? 'WHERE responsible_person = ?' : ''}`).bind(...op).all(),
    db.prepare('SELECT id, position_id, position_applied, mapped_position, parse_status FROM resumes').bind().all(),
    bindAll(`SELECT position_id, COUNT(*) as cnt FROM interviews WHERE round = 1 ${posFilter} GROUP BY position_id`),
    bindAll(`SELECT position_id, COUNT(*) as cnt FROM interviews WHERE ${getBoardInterviewPassCondition(1)} ${posFilter} GROUP BY position_id`),
    bindAll(`SELECT position_id, COUNT(*) as cnt FROM interviews WHERE ${getBoardInterviewPassCondition(2)} ${posFilter} GROUP BY position_id`),
    bindAll(`SELECT position_id, COUNT(*) as cnt FROM interviews WHERE ${getBoardInterviewPassCondition(3)} ${posFilter} GROUP BY position_id`),
    bindAll(`SELECT position_id, COUNT(*) as cnt FROM offers WHERE status NOT IN ('draft','cancelled') ${posFilter} GROUP BY position_id`),
    bindAll(`SELECT position_id, COUNT(*) as cnt FROM onboarding_records WHERE status = 'onboarded' ${posFilter} GROUP BY position_id`),
  ]);

  const toMap = (result: { results?: any[] }) => new Map((result.results || []).map((row: any) => [row.position_id, row.cnt || 0]));
  const normalizePositionName = (value: unknown) => typeof value === 'string' ? value.trim().toLocaleLowerCase('zh-CN') : '';
  const positionById = new Map(positionRows.map((position: any) => [position.id, position]));
  const knownPositionIds = new Set((knownPositions.results || []).map((position: any) => position.id));
  const positionByTitle = new Map<string, any | null>();
  for (const position of positionRows) {
    const title = normalizePositionName(position.title);
    if (!title) continue;
    if (!positionByTitle.has(title)) {
      positionByTitle.set(title, position);
      continue;
    }
    const current = positionByTitle.get(title);
    if (current && current.id !== position.id) positionByTitle.set(title, null);
  }

  const mappedTitleByAlias = new Map<string, string | null>();
  const addMappingAlias = (alias: unknown, mappedName: unknown) => {
    const key = normalizePositionName(alias);
    const target = normalizePositionName(mappedName);
    if (!key || !target) return;
    if (!mappedTitleByAlias.has(key)) {
      mappedTitleByAlias.set(key, target);
      return;
    }
    const current = mappedTitleByAlias.get(key);
    if (current !== target) mappedTitleByAlias.set(key, null);
  };
  for (const mapping of mappings.results || []) {
    addMappingAlias(mapping.raw_name, mapping.mapped_name);
    addMappingAlias(mapping.mapped_name, mapping.mapped_name);
    if (typeof mapping.raw_names === 'string' && mapping.raw_names) {
      try {
        const aliases = JSON.parse(mapping.raw_names);
        if (Array.isArray(aliases)) for (const alias of aliases) addMappingAlias(alias, mapping.mapped_name);
      } catch { /* malformed legacy aliases are ignored */ }
    }
  }

  const resolvePosition = (name: unknown) => {
    const normalized = normalizePositionName(name);
    if (!normalized) return null;
    const direct = positionByTitle.get(normalized);
    if (direct) return direct;
    const mappedTitle = mappedTitleByAlias.get(normalized);
    return mappedTitle ? positionByTitle.get(mappedTitle) || null : null;
  };
  const rMap = new Map<string, number>();
  const aiScreenedMap = new Map<string, number>();
  const unmatchedRows = new Map<string, RecruitingBoardPositionRow>();
  for (const resume of resumes.results || []) {
    const positionId = typeof resume.position_id === 'string' ? resume.position_id.trim() : '';
    const directPosition = positionId ? positionById.get(positionId) : null;
    if (positionId && !directPosition && knownPositionIds.has(positionId)) continue;
    const candidates = [resume.mapped_position, resume.position_applied];
    const fallbackPosition = candidates.map(resolvePosition).find(Boolean);
    const position = directPosition || fallbackPosition;
    if (position) {
      rMap.set(position.id, (rMap.get(position.id) || 0) + 1);
      if (resume.parse_status === 'ai_screened') aiScreenedMap.set(position.id, (aiScreenedMap.get(position.id) || 0) + 1);
      continue;
    }

    const ownerRelated = !owner || candidates.some((name) => mappedTitleByAlias.has(normalizePositionName(name)));
    if (!ownerRelated) continue;
    const label = candidates.find((name) => typeof name === 'string' && name.trim())?.trim() || '未知岗位';
    const unmatchedId = `unmatched:${normalizePositionName(label) || resume.id}`;
    const unmatched = unmatchedRows.get(unmatchedId) || {
      position_id: unmatchedId,
      division: '',
      hrbp: owner || '',
      position: label,
      priority: 'P2' as const,
      headcount: 0,
      total_resumes: 0,
      ai_screened: 0,
      first_interview: 0,
      first_pass: 0,
      second_pass: 0,
      third_pass: 0,
      offers: 0,
      hired: 0,
      notes: '未匹配到岗位档案',
      status: '未匹配',
      unmatched: true,
    };
    unmatched.total_resumes += 1;
    unmatched.ai_screened += resume.parse_status === 'ai_screened' ? 1 : 0;
    unmatchedRows.set(unmatchedId, unmatched);
  }
  const f1SchedMap = toMap(iv1Scheduled);
  const f1PassMap = toMap(iv1Pass);
  const f2PassMap = toMap(iv2Pass);
  const f3PassMap = toMap(iv3Pass);
  const oMap = toMap(offerCounts);
  const hMap = toMap(hiredCounts);

  const matchedRows = positionRows.map((pos: any) => {
    const totalResumes = rMap.get(pos.id) || 0;
    const firstInterview = getBoardFirstInterviewCount(f1SchedMap.get(pos.id) || 0, f1PassMap.get(pos.id) || 0);
    const firstPass = f1PassMap.get(pos.id) || 0;
    const secondPass = f2PassMap.get(pos.id) || 0;
    const thirdPass = f3PassMap.get(pos.id) || 0;
    const offers = oMap.get(pos.id) || 0;
    const hired = hMap.get(pos.id) || 0;
    const statusMap: Record<string, string> = {
      'open': '招聘中', 'published': '招聘中', 'closed': '已完成',
      'draft': '草稿', 'paused': '暂停', 'cancelled': '已终止',
    };
    const displayStatus = statusMap[pos.status] || pos.status;
    const priorityMap: Record<string, 'P0' | 'P1' | 'P2'> = { high: 'P0', medium: 'P1', low: 'P2' };
    return {
      position_id: pos.id,
      division: pos.department || '',
      hrbp: pos.responsible_person || '',
      position: pos.title,
      priority: priorityMap[pos.urgency] || 'P2',
      headcount: pos.headcount || 1,
      total_resumes: totalResumes,
      ai_screened: aiScreenedMap.get(pos.id) || 0,
      first_interview: firstInterview,
      first_pass: firstPass,
      second_pass: secondPass,
      third_pass: thirdPass,
      offers,
      hired,
      notes: '',
      status: displayStatus,
    };
  });
  return [...matchedRows, ...unmatchedRows.values()];
}

// AI 每日 token 用量查询
app.get('/api/ai-usage', authMiddleware, async (c) => {
  try {
    await ensureAiUsageTable(c.env);
    const limit = getDailyTokenLimit(c.env);
    const used = await getTodayTokenUsage(c.env);
    const recent = await c.env.DB.prepare(
      'SELECT date, total_tokens FROM ai_usage ORDER BY date DESC LIMIT 14'
    ).all();
    return c.json({
      date: todayStr(),
      used_today: used,
      daily_limit: limit,
      remaining: Math.max(0, limit - used),
      exceeded: used >= limit,
      model: c.env.AI_MODEL || 'deepseek-v4-flash',
      history: recent.results || [],
    });
  } catch (e: any) {
    return c.json({ detail: String(e?.message || e) }, 500);
  }
});

// 评估维度设置（简历 AI 评估用）
app.get('/api/settings/evaluation-dimensions', authMiddleware, async (c) => {
  // 从 D1 settings 表读取，如无则返回默认值
  try {
    const row = await c.env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind('evaluation_dimensions').first() as any;
    if (row?.value) return c.json(JSON.parse(row.value));
  } catch (e) { /* ignore */ }
  return c.json([
    { key: '核心画像', label: '核心画像', weight: 25 },
    { key: '核心职责', label: '核心职责', weight: 22 },
    { key: '任职要求', label: '任职要求', weight: 22 },
    { key: '企业背景', label: '企业背景', weight: 13 },
    { key: '加分项', label: '加分项', weight: 10 },
    { key: '关键词匹配', label: '关键词匹配', weight: 0, isGate: true },
    { key: '避坑雷区', label: '避坑雷区', weight: 0, isGate: true },
  ]);
});

app.put('/api/settings/evaluation-dimensions', authMiddleware, async (c) => {
  try {
    const body = await c.req.json();
    const items = body.items || [];
    const db = c.env.DB;
    // 确保 settings 表存在
    await db.prepare(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT DEFAULT (datetime('now')))`).run();
    await db.prepare(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)`)
      .bind('evaluation_dimensions', JSON.stringify(items), new Date().toISOString()).run();
    return c.json({ ok: true, count: items.length });
  } catch (e: any) {
    return c.json({ detail: String(e?.message || e) }, 500);
  }
});

// 兼容名（部分前端调 /capability-dimension-names 不带 /api 前缀的旧路径）
app.get('/capability-dimension-names', (c) => c.redirect('/api/capability-dimension-names'));

app.get('/api/dashboard/interviewers', authMiddleware, async (c) => {
  const db = c.env.DB;
  const interviewers = await db.prepare("SELECT * FROM users WHERE lower(role) = 'interviewer'").all();
  // 单条聚合查询替代 N*3 次逐条查询（修复 N+1）
  const aggRows = await db.prepare(
    `SELECT interviewer_id,
       COUNT(*) as total,
       SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
       SUM(CASE WHEN status IN ('scheduled','in_progress') THEN 1 ELSE 0 END) as pending
     FROM interviews GROUP BY interviewer_id`
  ).all();
  const aggMap = new Map((aggRows.results || []).map((r: any) => [r.interviewer_id, r]));
  const result = interviewers.results.map((u: any) => {
    const agg = aggMap.get(u.id);
    const totalCnt = agg?.total || 0;
    const completedCnt = agg?.completed || 0;
    return {
      id: u.id, name: u.full_name, total_interviews: totalCnt,
      completed_interviews: completedCnt, pending_interviews: agg?.pending || 0,
      completion_rate: totalCnt > 0 ? Math.round(completedCnt / totalCnt * 100) : 0,
      avg_score: null, score_std: null, consistency_rating: 'N/A'
    };
  });
  return c.json(result);
});

app.get('/api/dashboard/overview', authMiddleware, async (c) => {
  const db = c.env.DB;
  const owner = getDashboardOwner(c);

  const posWhere = owner ? 'WHERE responsible_person = ?' : '';
  const posParams = owner ? [owner] : [];
  const ivWhere = owner ? 'WHERE position_id IN (SELECT id FROM positions WHERE responsible_person = ?)' : '';
  const resWhere = owner ? 'WHERE (position_id IN (SELECT id FROM positions WHERE responsible_person = ?) OR position_applied IN (SELECT raw_name FROM position_mappings WHERE responsible_person = ?) OR mapped_position IN (SELECT mapped_name FROM position_mappings WHERE responsible_person = ?))' : '';
  const resParams = owner ? [owner, owner, owner] : [];
  const obWhere = owner ? 'WHERE responsible_person = ?' : '';
  const ofWhere = owner ? 'WHERE status NOT IN (\'draft\',\'cancelled\') AND position_id IN (SELECT id FROM positions WHERE responsible_person = ?)' : '';

  const q = (sql: string, params: any[] = []) => params.length ? db.prepare(sql).bind(...params).first() : db.prepare(sql).first();

  const ap = await q(`SELECT COUNT(*) as cnt FROM positions ${posWhere}`, posParams);
  const th = await q(`SELECT COALESCE(SUM(headcount),0) as cnt FROM positions ${posWhere}`, posParams);
  const tr = await q(`SELECT COUNT(*) as cnt FROM resumes ${resWhere}`, resParams);
  const si = await q(`SELECT COUNT(*) as cnt FROM interviews ${ivWhere ? ivWhere + ' AND status = \'scheduled\'' : "WHERE status = 'scheduled'"}`, posParams);
  const ci = await q(`SELECT COUNT(*) as cnt FROM interviews ${ivWhere ? ivWhere + ' AND status = \'completed\'' : "WHERE status = 'completed'"}`, posParams);
  const pi = await q(`SELECT COUNT(*) as cnt FROM interviews ${ivWhere ? ivWhere + ' AND (result = \'pass\' OR status2 = \'passed\')' : "WHERE (result = 'pass' OR status2 = 'passed')"}`, posParams);
  const of = await q(`SELECT COUNT(*) as cnt FROM offers ${ofWhere || "WHERE status NOT IN ('draft','cancelled')"}`, posParams);
  const hi = await q(`SELECT COUNT(*) as cnt FROM onboarding_records ${obWhere ? obWhere + ' AND status = \'onboarded\'' : "WHERE status = 'onboarded'"}`, posParams);
  const po = await q(`SELECT COUNT(*) as cnt FROM onboarding_records ${obWhere ? obWhere + ' AND status = \'pending\'' : "WHERE status = 'pending'"}`, posParams);

  const trVal = (tr as any)?.cnt || 0;
  const siVal = (si as any)?.cnt || 0;
  const ciVal = (ci as any)?.cnt || 0;
  const piVal = (pi as any)?.cnt || 0;
  const ofVal = (of as any)?.cnt || 0;
  const hiVal = (hi as any)?.cnt || 0;

  const pushConversionRate = trVal > 0 ? Math.round((siVal + ciVal) / trVal * 100) : 0;
  const interviewPassRate = ciVal > 0 ? Math.round(piVal / ciVal * 100) : 0;
  const offerConversionRate = piVal > 0 ? Math.round(ofVal / piVal * 100) : 0;
  const hireConversionRate = ofVal > 0 ? Math.round(hiVal / ofVal * 100) : 0;

  return c.json({
    overview: {
      active_positions: (ap as any)?.cnt || 0, total_headcount: (th as any)?.cnt || 0, total_resumes: trVal,
      scheduled_interviews: siVal, push_conversion_rate: pushConversionRate,
      interview_pass_rate: interviewPassRate, offers: ofVal,
      offer_conversion_rate: offerConversionRate, hired: hiVal,
      hire_conversion_rate: hireConversionRate, pending_onboarding: (po as any)?.cnt || 0,
      last_updated: new Date().toISOString(),
    },
    funnel: {
      stages: [
        { name: '简历推送', count: trVal }, { name: '安排面试', count: siVal + ciVal },
        { name: '面试通过', count: piVal }, { name: '发放Offer', count: ofVal },
        { name: '已入职', count: hiVal },
      ],
    },
    divisions: await (async () => {
      try {
        const ownerCond = owner ? 'AND p.responsible_person = ?' : '';
        const ownerParams = owner ? [owner] : [];
        // 按部门聚合：岗位数、编制数、活跃岗位数
        const deptRows = await db.prepare(
          `SELECT p.department, COUNT(*) as pos_cnt, COALESCE(SUM(p.headcount),0) as hc,
            COUNT(CASE WHEN p.status IN ('open','published') THEN 1 END) as active_cnt
           FROM positions p WHERE p.department != '' ${ownerCond}
           GROUP BY p.department ORDER BY pos_cnt DESC`
        ).bind(...ownerParams).all();
        // 按部门查简历数（通过 position_applied → positions.title → department）
        const resumeRows = await db.prepare(
          `SELECT p.department, COUNT(DISTINCT r.id) as r_cnt
           FROM positions p LEFT JOIN resumes r ON r.position_applied = p.title OR r.position_id = p.id
           WHERE p.department != '' GROUP BY p.department`
        ).all();
        const rMap = new Map((resumeRows.results || []).map((r: any) => [r.department, r.r_cnt || 0]));
        // 按部门查面试数
        const ivRows = await db.prepare(
          `SELECT p.department, COUNT(DISTINCT i.id) as iv_cnt
           FROM positions p LEFT JOIN interviews i ON i.position_id = p.id
           WHERE p.department != '' GROUP BY p.department`
        ).all();
        const ivMap = new Map((ivRows.results || []).map((r: any) => [r.department, r.iv_cnt || 0]));
        return (deptRows.results || []).map((d: any) => ({
          name: d.department,
          hrbp: '',
          active_positions: d.active_cnt || 0,
          total_headcount: d.hc || 0,
          total_resumes: rMap.get(d.department) || 0,
          scheduled_interviews: ivMap.get(d.department) || 0,
          interview_pass_rate: 0,
          hired: 0,
          funnel: {
            stages: [
              { name: '简历', count: rMap.get(d.department) || 0 },
              { name: '面试', count: ivMap.get(d.department) || 0 },
              { name: 'Offer', count: 0 },
              { name: '入职', count: 0 },
            ],
          },
        }));
      } catch { return []; }
    })(),
  });
});

app.get('/api/dashboard/hr-stats', authMiddleware, async (c) => {
  const db = c.env.DB;
  const { where: ow, params: op } = buildOwnerFilter(c);
  const totalReq = await db.prepare(`SELECT COUNT(*) as cnt FROM job_requisitions ${ow ? 'WHERE 1=1 ' + ow : ''}`).bind(...op).first();
  const pendingReq = await db.prepare(`SELECT COUNT(*) as cnt FROM job_requisitions WHERE status = 'pending' ${ow ? 'AND 1=1 ' + ow : ''}`).bind(...op).first();
  const approvedReq = await db.prepare(`SELECT COUNT(*) as cnt FROM job_requisitions WHERE status = 'approved' ${ow ? 'AND 1=1 ' + ow : ''}`).bind(...op).first();
  const tpSize = await db.prepare("SELECT COUNT(*) as cnt FROM talent_pool").first();
  const obCnt = await db.prepare(`SELECT COUNT(*) as cnt FROM onboarding_records ${ow ? 'WHERE 1=1 ' + ow : ''}`).bind(...op).first();
  const pbCnt = await db.prepare(`SELECT COUNT(*) as cnt FROM probation_records ${ow ? 'WHERE 1=1 ' + ow : ''}`).bind(...op).first();
  return c.json({
    total_requisitions: totalReq?.cnt || 0, pending_requisitions: pendingReq?.cnt || 0,
    approved_requisitions: approvedReq?.cnt || 0, talent_pool_size: tpSize?.cnt || 0,
    onboarding_count: obCnt?.cnt || 0, probation_count: pbCnt?.cnt || 0
  });
});

app.get('/api/dashboard/timeline', authMiddleware, async (c) => {
  const days = parseInt(c.req.query('days') || '30');
  const result = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    result.push({
      date: d.toISOString().slice(0, 10),
      resumes_received: 0, interviews_scheduled: 0
    });
  }
  return c.json(result);
});

app.get('/api/dashboard/ai-insights', authMiddleware, async (c) => {
  const db = c.env.DB;
  const { where: ow, params: op } = buildOwnerFilter(c);
  const { whereResume: rw, params: rp } = buildOwnerPosFilter(c);
  const totalResumes = await db.prepare(`SELECT COUNT(*) as cnt FROM resumes WHERE 1=1 ${rw}`).bind(...rp).first();
  const pendingResumes = await db.prepare(`SELECT COUNT(*) as cnt FROM resumes WHERE status LIKE 'pending%' ${rw}`).bind(...rp).first();
  const totalPositions = await db.prepare(`SELECT COUNT(*) as cnt FROM positions WHERE 1=1 ${ow}`).bind(...op).first();
  const activePositions = await db.prepare(`SELECT COUNT(*) as cnt FROM positions WHERE status IN ('open','published') ${ow}`).bind(...op).first();
  const totalInterviews = await db.prepare("SELECT COUNT(*) as cnt FROM interviews").first();
  const completedInterviews = await db.prepare(`SELECT COUNT(*) as cnt FROM interviews WHERE status = 'completed'`).first();
  const stats = {
    total_resumes: totalResumes?.cnt || 0, pending_resumes: pendingResumes?.cnt || 0,
    total_positions: totalPositions?.cnt || 0, active_positions: activePositions?.cnt || 0,
    total_interviews: totalInterviews?.cnt || 0, completed_interviews: completedInterviews?.cnt || 0,
  };
  const deptResult = await db.prepare(`SELECT department, COUNT(*) as cnt FROM positions ${ow ? 'WHERE 1=1 ' + ow : ''} GROUP BY department ORDER BY cnt DESC LIMIT 10`).bind(...op).all();
  const departmentDist = deptResult.results.map((r: any) => ({ department: r.department, count: r.cnt }));
  const stageResult = await db.prepare(`SELECT stage, COUNT(*) as cnt FROM resumes ${rw ? 'WHERE 1=1 ' + rw : ''} GROUP BY stage`).bind(...rp).all();
  const stageDist = stageResult.results.map((r: any) => ({ stage: r.stage, count: r.cnt }));
  const systemPrompt = `You are an expert HR data analyst AI. Analyze the recruitment data and provide insights in Chinese. Return a JSON object with:
- summary: overall summary in Chinese (2-3 sentences)
- bottlenecks: array of { area, description } in Chinese
- recommendations: array of { priority, action } in Chinese
- predictions: array of { metric, prediction } in Chinese`;
  const userPrompt = `Recruitment Data:\n${JSON.stringify(stats, null, 2)}\n\nDepartment Distribution:\n${JSON.stringify(departmentDist, null, 2)}\n\nResume Stage Distribution:\n${JSON.stringify(stageDist, null, 2)}\n\nPlease analyze and provide insights.`;
  try {
    const result = await callAI(c.env, systemPrompt, userPrompt);
    let insights: any;
    try { insights = extractJSON(result); } catch { insights = { summary: result, bottlenecks: [], recommendations: [], predictions: [] }; }
    return c.json(insights);
  } catch (err: any) {
    return c.json({ detail: 'AI insights failed', error: err.message }, 500);
  }
});

// ==================== Generic CRUD Factory ====================

type FilterConfig = Record<string, 'like' | 'eq'>;

function makeListHandler(table: string, filters: FilterConfig = {}) {
  return async (c: any) => {
    const db = c.env.DB;
    let sql = `SELECT * FROM ${table}`;
    const conditions: string[] = [];
    const binds: any[] = [];
    for (const [col, mode] of Object.entries(filters)) {
      const val = c.req.query(col);
      if (val !== undefined && val !== '' && validCol(col)) {
        if (mode === 'like') {
          conditions.push(`${col} LIKE ?`);
          binds.push(`%${val}%`);
        } else {
          conditions.push(`${col} = ?`);
          binds.push(val);
        }
      }
    }
    // Also allow ad-hoc query params for known columns
    const search = c.req.query('search');
    if (search) {
      conditions.push(`(candidate_name LIKE ? OR email LIKE ?)`);
      binds.push(`%${search}%`, `%${search}%`);
    }
    if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY created_at DESC';
    const result = await db.prepare(sql).bind(...binds).all();
    return c.json(result.results.map(transformRow));
  };
}

function makeGetHandler(table: string) {
  return async (c: any) => {
    const row = await c.env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(c.req.param('id')).first();
    if (!row) return c.json({ detail: 'Not found' }, 404);
    return c.json(transformRow(row));
  };
}

function makeCreateHandler(table: string) {
  return async (c: any) => {
    const body = await c.req.json();
    const cols: string[] = [];
    const vals: any[] = [];
    if (!body.id) { cols.push('id'); vals.push(uuid()); }
    cols.push('created_at'); vals.push(now());
    cols.push('updated_at'); vals.push(now());
    for (const [k, v] of Object.entries(body)) {
      if (validCol(k) && !['id', 'created_at', 'updated_at'].includes(k)) {
        cols.push(k);
        vals.push(prepareValue(v));
      }
    }
    const placeholders = cols.map(() => '?').join(', ');
    const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`;
    await c.env.DB.prepare(sql).bind(...vals).run();
    const id = vals[0];
    const row = await c.env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first();
    if (table === 'positions' && Object.prototype.hasOwnProperty.call(body, 'capability_dimensions')) {
      await syncCapabilityDimensionsForPosition(c.env.DB, row?.title || body.title || '', body.capability_dimensions);
    }
    if (table === 'capability_dimensions' && Object.prototype.hasOwnProperty.call(body, 'dimensions_json')) {
      await syncPositionDimensionsForCapabilityRecord(c.env.DB, row?.position_name || body.position_name || '', body.dimensions_json);
    }
    return c.json(transformRow(row));
  };
}

function makeUpdateHandler(table: string) {
  return async (c: any) => {
    const id = c.req.param('id');
    const body = await c.req.json();
    const cols: string[] = [];
    const vals: any[] = [];
    for (const [k, v] of Object.entries(body)) {
      if (validCol(k) && !['id', 'created_at'].includes(k)) {
        cols.push(k);
        vals.push(prepareValue(v));
      }
    }
    cols.push('updated_at'); vals.push(now());
    if (cols.length <= 1) return c.json({ detail: 'No updates' });
    const setClause = cols.map(k => `${k} = ?`).join(', ');
    await c.env.DB.prepare(`UPDATE ${table} SET ${setClause} WHERE id = ?`).bind(...vals, id).run();
    const row = await c.env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first();
    if (table === 'positions' && Object.prototype.hasOwnProperty.call(body, 'capability_dimensions')) {
      await syncCapabilityDimensionsForPosition(c.env.DB, row?.title || body.title || '', body.capability_dimensions);
    }
    if (table === 'capability_dimensions' && Object.prototype.hasOwnProperty.call(body, 'dimensions_json')) {
      await syncPositionDimensionsForCapabilityRecord(c.env.DB, row?.position_name || body.position_name || '', body.dimensions_json);
    }
    return c.json(transformRow(row));
  };
}

function makeDeleteHandler(table: string) {
  return async (c: any) => {
    await c.env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(c.req.param('id')).run();
    return c.json({ detail: 'Deleted' });
  };
}

function registerCrud(prefix: string, table: string, filters: FilterConfig = {}) {
  app.get(`/api/${prefix}`, authMiddleware, makeListHandler(table, filters));
  app.post(`/api/${prefix}`, authMiddleware, makeCreateHandler(table));
  app.get(`/api/${prefix}/:id`, authMiddleware, makeGetHandler(table));
  app.put(`/api/${prefix}/:id`, authMiddleware, makeUpdateHandler(table));
  app.delete(`/api/${prefix}/:id`, authMiddleware, makeDeleteHandler(table));
}

// ==================== Bitable-backed CRUD helpers (直接读写飞书多维表格) ====================

// 招聘任务表 → 需求管理 的字段映射
const FEISHU_REQUISITION_FIELDS: Record<string, string> = {
  title: '招聘岗位',
  department: '二级部门',
  department_3rd: '三级部门',
  city: '招聘城市',
  headcount: '招聘人数',
  urgency: '紧急度',
  status: '招聘状态',
  reason: '招聘理由',
  notes: '说明',
  description: '招聘JD',
  requirements: '岗位职责与任职要求',
  capability_requirements: '岗位能力提取',
  capability_dimensions: '岗位能力维度要求',
  city_tier: '城市等级',
  in_budget: '是否在编制内',
  responsible_person: '责任人',
  recruitment_account: '招聘账号',
  start_date: '开始招聘',
  end_date: '结束招聘',
  hr_interviewer: 'HR二面',
  biz_interviewer: '业务一面',
  final_interviewer: '终面',
};

// 人才库表 → 人才库/简历管理的字段映射
const FEISHU_TALENT_FIELDS: Record<string, string> = {
  candidate_name: '姓名',
  position_applied: '面试岗位',
  mapped_position: '招聘岗位匹配',
  gender: '性别',
  city: '城市',
  age: '年龄',
  education: '学历',
  ai_evaluation: 'AI简历评估',
  screening_result: 'AI简历初筛结果',
  advantage: '优势分析',
  risk: '风险点',
  hr_review: 'HR复核结果',
  interview_suggestion: '一面建议',
  interview_questions: '面试问题建议',
  notes: '备注-手动',
  reserve_type: '储备人才类型-手动',
  job_description: '岗位JD',
  capability_dimensions: '岗位能力维度要求',
  source_id: 'SourceID',
  biz_owner: '业务负责人',
  biz_review: '业务复核结果',
  biz_reviewer_2: '二面负责人',
  biz_reviewer_3: '三面负责人',
  hr_pass_date: 'HR初筛通过日期',
  attachment: '简历附件-批量导入',
  create_time: '创建时间',
};

function getBitableTableId(env: Env, type: 'requisition' | 'talent' | 'interview'): string {
  if (type === 'requisition') return env.FEISHU_REQUISITION_TABLE_ID || FEISHU_CONFIG.requisitionTableId;
  if (type === 'interview') return 'tblsKkEvvxYssrvB';
  return env.FEISHU_TALENT_TABLE_ID || FEISHU_CONFIG.talentTableId;
}

function feishuFieldsToRecord(fields: Record<string, string>, data: any): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [engKey, cnKey] of Object.entries(fields)) {
    if (data[engKey] !== undefined && data[engKey] !== null) {
      result[cnKey] = data[engKey];
    }
  }
  return result;
}

function recordToFeishuFields(fields: Record<string, string>, record: any): Record<string, any> {
  const fb = record.fields || {};
  const result: Record<string, any> = {};
  for (const [engKey, cnKey] of Object.entries(fields)) {
    let val = fb[cnKey];
    if (val !== undefined && val !== null) {
      result[engKey] = val;
    }
  }
  // also include record_id
  result.feishu_record_id = record.record_id;
  return result;
}

function getFirstRichText(v: any): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) {
    // Rich text: [{text: '...', type: 'text'}, ...]
    return v.map((seg: any) => (typeof seg === 'string' ? seg : (seg.text || seg.content || ''))).join('');
  }
  if (typeof v === 'object') {
    if (v.text) return v.text;
    if (v.content) return v.content;
  }
  return String(v);
}

function getFirstValue(v: any): string | null {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v.length > 0 ? String(v[0]) : null;
  if (typeof v === 'object' && v.name) return v.name;
  if (typeof v === 'object' && v.text) return v.text;
  return String(v);
}

function getFirstObj(v: any): any {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v.length > 0 ? v[0] : null;
  return v;
}

// 从飞书人才库记录转成前端可用的格式
function parseTalentRecord(record: any): any {
  const f = record.fields || {};
  const rawAiEval = f['AI简历评估'];
  const aiEvalStr = typeof rawAiEval === 'object' ? JSON.stringify(rawAiEval) : String(rawAiEval || '');
  const rawAdvantage = f['优势分析'];
  const advantageStr = typeof rawAdvantage === 'object' ? JSON.stringify(rawAdvantage) : String(rawAdvantage || '');
  const rawRisk = f['风险点'];
  const riskStr = typeof rawRisk === 'object' ? JSON.stringify(rawRisk) : String(rawRisk || '');

  return {
    id: record.record_id,
    candidate_name: getFirstValue(f['姓名']) || '',
    position_applied: getFirstValue(f['面试岗位']) || getFirstValue(f['招聘岗位']) || '',
    mapped_position: getFirstValue(f['招聘岗位匹配']) || '',
    gender: getFirstValue(f['性别']) || '',
    city: getFirstValue(f['城市']) || '',
    age: f['年龄'] || null,
    education: getFirstValue(f['学历']) || '',
    ai_evaluation: aiEvalStr,
    ai_review: aiEvalStr, // 兼容前端两个字段名
    screening_result: normalizeAiScreeningResult(getFirstValue(f['AI简历初筛结果'])),
    advantage: advantageStr,
    risk: riskStr,
    hr_review: getFirstValue(f['HR复核结果']) || '',
    interview_suggestion: getFirstValue(f['一面建议']) || '',
    interview_questions: getFirstValue(f['面试问题建议']) || '',
    notes: getFirstValue(f['备注-手动']) || '',
    reserve_type: getFirstValue(f['储备人才类型-手动']) || '',
    source_id: getFirstValue(f['SourceID']) || '',
    biz_owner: getFirstValue(f['业务负责人']) || '',
    biz_review: getFirstValue(f['业务复核结果']) || '',
    hr_pass_date: f['HR初筛通过日期'] || null,
    create_time: f['创建时间'] || f['创建时间-测试'] || null,
    status: mapHrReviewToStatus(getFirstValue(f['HR复核结果']) || ''),
    match_score: mapAIResultToScore(getFirstValue(f['AI简历初筛结果']) || '', aiEvalStr),
    feishu_record_id: record.record_id,
    phone: getFirstValue(f['手机']) || '',
    email: getFirstValue(f['邮箱']) || getFirstValue(f['SourceID']) || '',
    work_years: f['工作年限'] || null,
    skills: getFirstValue(f['技能']) || '',
    work_experience: getFirstValue(f['工作经历']) || '',
    // 保留原始字段以便扩展
    _raw_fields: f,
    // 简历附件信息（原始 PDF）
    resume_file: extractResumeFile(f['简历附件-批量导入']),
    // 从 AI 评估结果中提取结构化字段（不再伪造）
    parsed_data: parseAIEvalForFields(rawAiEval, aiEvalStr, f),
  };
}

function parseD1TalentRow(row: any): Record<string, any> {
  let parsed: Record<string, any> = {};
  if (typeof row?.parsed_data === 'string') {
    try {
      const value = JSON.parse(row.parsed_data);
      if (value && typeof value === 'object' && !Array.isArray(value)) parsed = value;
    } catch {}
  } else if (row?.parsed_data && typeof row.parsed_data === 'object') {
    parsed = row.parsed_data;
  }

  const first = (...values: any[]) => values.find((value) => value !== undefined && value !== null && String(value).trim() !== '') || '';
  // 排序时间用 updated_at（入库/审批操作会更新它），让最新入库的简历排最前
  const timeSrc = row?.updated_at || row?.created_at || '';
  const createdAt = timeSrc ? Date.parse(String(timeSrc)) : NaN;
  const item: Record<string, any> = {
    id: row?.id || '',
    candidate_name: first(row?.candidate_name, parsed.name, parsed.candidate_name),
    position_applied: first(row?.position_applied, parsed.position_applied),
    mapped_position: first(row?.mapped_position, parsed.mapped_position, parsed.standard_position),
    standard_position: first(row?.standard_position, parsed.standard_position),
    gender: first(row?.gender, parsed.gender),
    city: first(row?.city, parsed.city),
    age: first(row?.age, parsed.age),
    education: (() => {
      const raw = first(row?.education, parsed.highest_degree);
      return Array.isArray(raw) ? '' : raw;
    })(),
    hr_review: first(row?.hr_review),
    status: first(row?.status),
    stage: first(row?.stage),
    create_time: Number.isFinite(createdAt) ? createdAt : null,
    feishu_record_id: '',
    parsed_data: parsed,
  };

  return item;
}

/**
 * Talent-pool data is historically stored in Feishu, while newer uploads are
 * stored only in D1. Merge both projections so approved D1-only resumes are
 * visible to the talent-pool and interview-management screens.
 */
export function mergeTalentPoolItems(feishuItems: any[], d1Rows: any[]): any[] {
  const merged = (feishuItems || []).map((item) => ({ ...item }));
  const byId = new Map<string, any>();

  for (const item of merged) {
    const key = String(item.feishu_record_id || item.id || '');
    if (key) byId.set(key, item);
  }

  for (const row of d1Rows || []) {
    const d1Item = parseD1TalentRow(row);
    const key = String(d1Item.id || '');
    if (!key) continue;

    const existing = byId.get(key);
    if (!existing) {
      merged.push(d1Item);
      byId.set(key, d1Item);
      continue;
    }

    // Keep Feishu's richer fields, but let D1's approval/status win because
    // the approval endpoint writes D1 before attempting Feishu write-back.
    for (const [field, value] of Object.entries(d1Item)) {
      if (field === 'status' || field === 'stage' || field === 'hr_review' || (value !== '' && value !== null && value !== undefined)) {
        existing[field] = value;
      }
    }
    existing.feishu_record_id = existing.feishu_record_id || key;
  }

  return merged;
}

// 从 AI 评估纯文本中提取字段 + 飞书目字列 → 拼成右侧面板所需的完整 parsed_data
// 飞书 AI 评估格式示例：性别：男\n学历：本科\n学校：XX大学\n专业：计算机科学\n年龄：25岁
function parseAIEvalForFields(rawAiEval: any, aiEvalStr: string, f: any): Record<string, any> {
  // ---- 路径 A1：飞书目字列直接取值（最可靠）----
  const colHighestDegree = getFirstValue(f['学历']) || '';
  const colGender = getFirstValue(f['性别']) || '';
  const colPhone = getFirstValue(f['手机']) || '';
  const colEmail = getFirstValue(f['邮箱']) || '';
  const colCity = getFirstValue(f['城市']) || '';
  const colSkills = getFirstValue(f['技能']) || '';
  const colWorkExp = getFirstValue(f['工作经历']) || '';
  const colWorkYears = f['工作年限'];

  // ---- 路径 A2：从飞书 AI 简历评估纯文本中正则提取 ----
  const evalText = aiEvalStr || '';
  // 归一化：统一全角/半角冒号、去除多余空白
  const normalized = evalText.replace(/：/g, ':').replace(/\n+/g, '\n');

  // 正则提取常见字段模式（中文标签+冒号+值）
  const reExtract = (label: string): string => {
    const m = normalized.match(new RegExp(`${label}\\s*[:：]\\s*([^\\n，。;；]+)`, 'i'));
    return (m?.[1] || '').trim().replace(/[（(][^)）]*[)）]/g, '').trim();
  };

  const evalSchool = reExtract('学校') || reExtract('毕业院校') || reExtract('院校');
  const evalMajor = reExtract('专业');
  const evalAge = reExtract('年龄');
  const evalGender = reExtract('性别');
  const evalHighestDegree = reExtract('学历');
  const evalRecentCompany = reExtract('公司') || reExtract('当前公司') || reExtract('最近公司') || reExtract('目前公司') || reExtract('工作单位');

  // 第一次提取可能没命中的备用标签
  const evalSchool2 = reExtract('毕业学校') || reExtract('本科院校');
  const finalSchool = evalSchool || evalSchool2;

  // 提取工作年限数字
  let evalWorkYears: number | null = null;
  const wyMatch = normalized.match(/(?:工作年限|工作经验|经验)[:：]\s*(\d+\.?\d*)\s*(?:年|y|Y)/i);
  if (wyMatch) evalWorkYears = parseFloat(wyMatch[1]);

  // 提取技能列表（从"技能"或"专业技能"段落后提取逗号/顿号分隔的技能）
  let evalSkillsList: string[] = [];
  const skillsBlock = normalized.match(/(?:技能|专业技能|技术栈|擅长)[:：]\s*([^\n]+)/i);
  if (skillsBlock) {
    evalSkillsList = skillsBlock[1]
      .split(/[,，、；;]/)
      .map(s => s.trim())
      .filter(s => s.length > 1 && s.length < 30);
  }

  // 提取优势/风险（从 AI 评估中摘取段落）
  const advMatch = normalized.match(/(?:优势分析|优势|核心优势)[:：]?\s*\n?([\s\S]*?)(?=(?:风险|能力维度|面试问题|建议追问|互动引导|$))/i);
  const riskMatch = normalized.match(/(?:风险点|风险分析|潜在风险)[:：]?\s*\n?([\s\S]*?)(?=(?:能力维度|面试问题|建议追问|互动引导|$))/i);

  // 提取 自我评价 段落（通常在简历开头或末尾）
  const selfEvalMatch = normalized.match(/(?:自我评价|个人评价|自我介绍|个人总结)[:：]?\s*\n?([\s\S]*?)(?=(?:\n\n|\n(?:教育|工作|项目|技能|证书|优势|风险)))/i);

  // ---- 合并结果：飞书列 优先，AI 提取 补充 ----
  const highest_degree = colHighestDegree || evalHighestDegree;
  const gender = colGender || evalGender;
  const school = finalSchool;
  const major = evalMajor;
  const phone = colPhone;
  const email = colEmail;
  const city = colCity;
  const years_of_experience = colWorkYears ? Number(colWorkYears) : (evalWorkYears ?? null);
  const skills = colSkills
    ? colSkills.split(/[,，、；;]/).map((s: string) => s.trim()).filter((s: string) => s.length > 1)
    : evalSkillsList;
  const recent_company = evalRecentCompany;

  // 飞书 AI 评估中的完整分析文本
  const advantageText = advMatch?.[1]?.trim() || '';
  const riskText = riskMatch?.[1]?.trim() || '';
  const selfEvalText = selfEvalMatch?.[1]?.trim() || '';

  // work_experience: 优先飞书目字列，缺失则从 AI 评估中提取段落
  const work_experience = colWorkExp || '';
  // 尝试将工作经历文本按段落拆分为数组
  let workExpArr: any[] = [];
  if (work_experience) {
    workExpArr = [{ description: work_experience }];
  }

  return {
    highest_degree,
    school,
    major,
    years_of_experience,
    recent_company,
    phone,
    email,
    contact: phone || email || '',
    gender,
    city,
    age: evalAge ? parseInt(evalAge) : null,
    birthday: '',  // AI 评估中通常无出生年月
    current_position: '',
    skills,
    work_experience: workExpArr,
    education: [] as any[],
    certifications: [] as string[],
    self_evaluation: selfEvalText,
    advantage: advantageText,
    risk: riskText,
    work_experience_summary: work_experience,
    // 标记数据来源
    _source: 'feishu_ai_eval',
  };
}

// resolvePositionTitle: 将用户/文件名解析出的岗位名匹配到系统标准岗位名
// 依次尝试：精确匹配 → 去掉括号后缀匹配（产品运营经理（双休）→ 产品运营经理）→ 包含匹配
export async function resolvePositionTitle(db: any, positionName: string): Promise<string> {
  if (!positionName) return positionName;
  const trimmed = String(positionName).trim();
  if (!trimmed) return positionName;
  try {
    const exact = await db.prepare('SELECT title FROM positions WHERE title = ? LIMIT 1').bind(trimmed).first();
    if (exact?.title) return exact.title;
    // 去掉括号内容（全角/半角/书名号）后匹配
    const stripped = trimmed.replace(/[（(【\[][^）)】\]]*[）)】\]]/g, '').trim();
    if (stripped && stripped !== trimmed) {
      const byStripped = await db.prepare('SELECT title FROM positions WHERE title = ? LIMIT 1').bind(stripped).first();
      if (byStripped?.title) return byStripped.title;
    }
    // 包含匹配：岗位名包含库中标题，或库中标题包含岗位名
    const like = await db.prepare("SELECT title FROM positions WHERE ? LIKE '%' || title || '%' OR title LIKE '%' || ? || '%' LIMIT 1").bind(trimmed, trimmed).first();
    if (like?.title) return like.title;
  } catch {}
  return positionName;
}

// getPositionContext: 根据岗位名查询上下文（标准岗位名、能力维度、个性化需求、薪资范围）
export async function getSystemScreeningRules(db: any): Promise<unknown> {
  try {
    const row = await db.prepare(
      'SELECT screening_rules FROM system_configs ORDER BY updated_at DESC LIMIT 1'
    ).first();
    return row?.screening_rules || null;
  } catch {
    return null;
  }
}

export async function getPositionContext(db: any, positionName: string): Promise<{
  standardPosition: string;
  description: string;
  requirements: string;
  capabilityDimensions: string;
  personalizedRequirements: string;
  salaryRange: string;
  screeningRules: ResolvedScreeningRules;
}> {
  const systemScreeningRules = await getSystemScreeningRules(db);
  const result = {
    standardPosition: positionName,
    description: '',
    requirements: '',
    capabilityDimensions: '',
    personalizedRequirements: '',
    salaryRange: '',
    screeningRules: resolveScreeningRules(systemScreeningRules),
  };
  if (!positionName) return result;

  // 1. 岗位映射：查找标准岗位名
  try {
    const mapping = await db.prepare(
      'SELECT mapped_name FROM position_mappings WHERE raw_name = ? LIMIT 1'
    ).bind(positionName).first();
    if (mapping?.mapped_name && mapping.mapped_name !== positionName) {
      result.standardPosition = mapping.mapped_name;
    }
  } catch {}

  let lookupName = result.standardPosition || positionName;
  // 若精确岗位名匹配不到，尝试模糊匹配标准岗位名（去掉括号后缀等）
  const resolvedTitle = await resolvePositionTitle(db, lookupName);
  if (resolvedTitle !== lookupName) {
    result.standardPosition = resolvedTitle;
    lookupName = resolvedTitle;
  }

  // 2. 能力维度：从 positions 表读取
  try {
    const pos = await db.prepare(
      'SELECT description, requirements, personalized_requirements, capability_dimensions, salary_range, screening_rules FROM positions WHERE title = ? LIMIT 1'
    ).bind(lookupName).first();
    if (pos) {
      result.screeningRules = resolveScreeningRules(systemScreeningRules, pos.screening_rules);
      result.description = String(pos.description || '');
      result.requirements = String(pos.requirements || '');
      if (pos.personalized_requirements) {
        result.personalizedRequirements = String(pos.personalized_requirements);
      }
      if (pos.capability_dimensions) {
        let dims = pos.capability_dimensions;
        try { dims = JSON.parse(dims); if (Array.isArray(dims)) dims = dims.map((d: any) => typeof d === 'object' ? ((d.name || d.title || '') + '：' + (d.description || d.definition || '')) : String(d)).join('\n\n'); } catch {}
        result.capabilityDimensions = String(dims);
      }
      if (pos.salary_range) result.salaryRange = pos.salary_range;
    }
  } catch {}

  // 2b. 补充：从 capability_dimensions 独立表读取（岗位管理页可能只写这张表）
  try {
    const dimRow = await db.prepare(
      'SELECT dimensions_json, personalized_requirements FROM capability_dimensions WHERE position_name = ? LIMIT 1'
    ).bind(lookupName).first() as any;
    if (dimRow?.dimensions_json) {
      let dims = dimRow.dimensions_json;
      try { dims = JSON.parse(dims); if (Array.isArray(dims)) dims = dims.map((d: any) => typeof d === 'object' ? ((d.name || d.title || '') + '：' + (d.description || d.definition || '')) : String(d)).join('\n\n'); } catch {}
      if (dims && String(dims) !== '[]') result.capabilityDimensions = String(dims);
    }
    if (dimRow?.personalized_requirements && !result.personalizedRequirements) {
      result.personalizedRequirements = String(dimRow.personalized_requirements);
    }
  } catch {}

  // 3. 个性化需求：从 job_requisitions 表读取
  try {
    const req = await db.prepare(
      'SELECT personalized_requirements FROM job_requisitions WHERE title = ? LIMIT 1'
    ).bind(lookupName).first();
    if (req?.personalized_requirements) {
      let preq = req.personalized_requirements;
      try {
        const obj = JSON.parse(preq);
        if (typeof obj === 'object' && !Array.isArray(obj)) {
          preq = Object.entries(obj).filter(([_,v]) => v).map(([k,v]) => `${k}: ${v}`).join('; ');
        }
      } catch {}
      result.personalizedRequirements = String(preq);
    }
  } catch {}

  return result;
}

// 三级降级获取简历文本，供 batch-auto-screen 使用
async function getResumeTextForScreening(env: Env, row: any): Promise<{ text: string; source: string }> {
  // 1. ocr_markdown 已有（MinerU 已处理）
  if (row.ocr_markdown && row.ocr_markdown.length > 50) {
    return { text: row.ocr_markdown, source: 'ocr_markdown' };
  }
  // 2. raw_text 已有缓存
  if (row.raw_text && row.raw_text.length > 50) {
    return { text: row.raw_text, source: 'raw_text' };
  }
  // 3. 尝试从飞书下载 PDF → MinerU OCR
  try {
    const tableId = getBitableTableId(env, 'talent');
    const record = await bitableGetRecord(env, tableId, row.id);
    if (record) {
      const f = record.fields || {};
      for (const [, fieldValue] of Object.entries(f)) {
        if (Array.isArray(fieldValue) && fieldValue.length > 0) {
          const item = fieldValue[0] as any;
          const dlUrl = item?.url || item?.download_url || item?.tmp_url;
          if (dlUrl) {
            const feishuToken = await getFeishuToken(env);
            const dlResp = await fetch(dlUrl, { headers: { Authorization: `Bearer ${feishuToken}` } });
            if (dlResp.ok) {
              const pdfBytes = new Uint8Array(await dlResp.arrayBuffer());
              // MinerU sign
              const signResp = await fetch(`${MINERU_BASE()}/api/v1/agent/parse/file`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ file_name: `${row.candidate_name || 'resume'}.pdf`, language: 'ch', is_ocr: true, enable_table: true, enable_formula: false }),
              });
              const signData: any = await signResp.json().catch(() => ({}));
              if (signData?.data?.file_url && signData?.data?.task_id) {
                await fetch(signData.data.file_url, { method: 'PUT', body: pdfBytes, headers: { 'Content-Type': '' } });
                let markdown = '';
                for (let i = 0; i < 20; i++) {
                  const pollResp = await fetch(`${MINERU_BASE()}/api/v1/agent/parse/${signData.data.task_id}`);
                  const pollData: any = await pollResp.json().catch(() => ({}));
                  if (pollData?.data?.state === 'done') {
                    const mdResp = await fetch(pollData.data.markdown_url);
                    markdown = await mdResp.text();
                    break;
                  }
                  if (pollData?.data?.state === 'failed') break;
                  await new Promise(r => setTimeout(r, 2000));
                }
                if (markdown && markdown.length > 50) {
                  // 顺便缓存 ocr_markdown
                  try { await env.DB.prepare('UPDATE resumes SET ocr_markdown=?, ocr_status=? WHERE id=?').bind(markdown.substring(0, 200000), 'ocr_done', row.id).run(); } catch {}
                  return { text: markdown, source: 'mineru_ocr_ondemand' };
                }
              }
            }
            break;
          }
        }
      }
    }
  } catch { /* fall through */ }

  // 4. 兜底：从 parsed_data 构造结构化摘要块
  const pd = typeof row.parsed_data === 'string' ? (() => { try { return JSON.parse(row.parsed_data); } catch { return {}; } })() : (row.parsed_data || {});
  const parts: string[] = [];
  if (pd.highest_degree) parts.push(`学历：${pd.highest_degree}`);
  if (pd.school) parts.push(`学校：${pd.school}`);
  if (pd.major) parts.push(`专业：${pd.major}`);
  if (pd.years_of_experience) parts.push(`工作年限：${pd.years_of_experience}年`);
  if (pd.recent_company) parts.push(`最近公司：${pd.recent_company}`);
  if (Array.isArray(pd.skills) && pd.skills.length) parts.push(`技能：${pd.skills.join('、')}`);
  if (pd.self_evaluation) parts.push(`自我评价：${pd.self_evaluation}`);
  if (pd.work_experience_summary) parts.push(`工作经历：${pd.work_experience_summary}`);
  const summary = parts.join('\n');
  return { text: summary, source: 'parsed_summary' };
}

// 将 AI 初筛结果 + 评估文本映射为匹配度分数
function mapAIResultToScore(screeningResult: string, aiEvalText: string): number {
  const r = (screeningResult || '').trim();
  if (r.includes('不通过') || r.includes('淘汰') || r.includes('存疑') || r.includes('不推荐')) return 30;
  if (r.includes('通过') || r.includes('推荐')) return 85;
  // 从文本中尝试提取分数
  const extracted = extractScoreFromEval(aiEvalText);
  if (extracted !== null && extracted >= 0 && extracted <= 100) return extracted;
  return 50; // 默认中间值
}

// 从 Bitable 附件字段提取简历文件信息
function extractResumeFile(fieldValue: any): { file_token?: string; name?: string; size?: number; download_url?: string } | null {
  if (!fieldValue) return null;
  if (Array.isArray(fieldValue) && fieldValue.length > 0) {
    const first = fieldValue[0];
    return {
      file_token: first.file_token || '',
      name: first.name || '',
      size: first.size || 0,
      download_url: first.download_url || first.tmp_url || '',
    };
  }
  return null;
}

// 从 position_mappings 表构建 raw_name → mapped_name 映射
async function buildPositionMapping(db: any): Promise<Map<string, string>> {
  const mappings = await db.prepare('SELECT raw_name, raw_names, mapped_name FROM position_mappings').all();
  return buildPositionMappingFromRows(mappings.results || []);
}

// 从招聘任务记录转成前端可用的格式
function parseRequisitionRecord(record: any): any {
  const f = record.fields || {};
  const headcount = f['招聘人数'] || 1;
  const urgency = mapUrgency(f['紧急度']);
  const status = mapStatus(f['招聘状态']);

  return {
    id: record.record_id,
    title: getFirstValue(f['招聘岗位']) || '(未命名岗位)',
    department: getFirstValue(f['二级部门']) || '',
    department_3rd: getFirstValue(f['三级部门']) || '',
    city: getFirstValue(f['招聘城市']) || '',
    headcount: typeof headcount === 'number' ? headcount : parseInt(String(headcount)) || 1,
    urgency,
    status,
    reason: getFirstValue(f['招聘理由']) || '',
    notes: getFirstValue(f['说明']) || '',
    description: getFirstRichText(f['招聘JD']) || '',
    requirements: getFirstRichText(f['岗位职责与任职要求']) || '',
    capability_requirements: getFirstValue(f['岗位能力提取']) || '',
    capability_dimensions: getFirstValue(f['岗位能力维度要求']) || '',
    city_tier: getFirstValue(f['城市等级']) || '',
    in_budget: getFirstValue(f['是否在编制内']) || '',
    responsible_person: getUserName(f['责任人']) || getFirstValue(f['招聘账号']) || '',
    recruitment_account: getFirstValue(f['招聘账号']) || '',
    hr_interviewer: getUserName(f['HR二面']),
    biz_interviewer: getUserName(f['业务一面']),
    final_interviewer: getUserName(f['终面']),
    primary_interviewer: getUserName(f['业务一面']) || '',
    secondary_interviewer: getUserName(f['HR二面']) || '',
    start_date: f['开始招聘'] || null,
    end_date: f['结束招聘'] || null,
    employment_type: 'full_time',
    salary_range: getFirstValue(f['薪资范围']) || getFirstValue(f['薪酬']) || getFirstValue(f['薪资']) || getFirstValue(f['薪资预算']) || getFirstValue(f['薪酬范围']) || '',
    budget: f['预算'] || f['招聘预算'] || f['人力预算'] || f['HC预算'] || null,
    expected_date: f['期望到岗'] || f['到岗日期'] || f['期望到岗日期'] || f['期望入职日期'] || f['到岗时间'] || f['开始招聘'] || null,
    feishu_record_id: record.record_id,
  };
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== 'string' || !value.trim()) return value;
  try {
    return JSON.parse(value);
  } catch {
    // D1 rows created by the Feishu sync may contain ordinary text rather than JSON.
    return value;
  }
}

function parseCityField(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const parsed = parseJsonValue(value);
  if (Array.isArray(parsed)) return parsed;
  if (typeof parsed === 'string') {
    return parsed.split(/[,，\n]/).map((city) => city.trim()).filter(Boolean);
  }
  return [];
}

/** Normalize form text back to the canonical JSON representation used by D1. */
export function serializeRequisitionJsonField(field: string, value: unknown): string {
  if (field === 'city') return JSON.stringify(parseCityField(value));
  const fallback = field === 'personalized_requirements' ? {} : [];
  if (value === null || value === undefined) return JSON.stringify(fallback);
  if (typeof value === 'string' && !value.trim()) return JSON.stringify(fallback);
  return JSON.stringify(parseJsonValue(value));
}

/** Convert structured D1 values into the editable TextArea contract. */
function formatEditableJsonField(value: unknown): string {
  if (value === null || value === undefined) return '';
  const parsed = parseJsonValue(value);
  if (typeof parsed === 'string') return parsed;
  if (Array.isArray(parsed)) return parsed.length > 0 ? JSON.stringify(parsed, null, 2) : '';
  if (parsed && typeof parsed === 'object') {
    return Object.keys(parsed).length > 0 ? JSON.stringify(parsed, null, 2) : '';
  }
  return parsed === null || parsed === undefined ? '' : String(parsed);
}

export function parseD1RequisitionRow(row: Record<string, any>): Record<string, any> {
  const item = transformRow(row);
  item.id = row.id;
  item.title = row.title || '(未命名岗位)';
  item.headcount = Number(row.headcount) || 1;
  item.city = parseCityField(row.city);
  item.hard_requirements = formatEditableJsonField(row.hard_requirements);
  item.personalized_requirements = formatEditableJsonField(row.personalized_requirements);
  item.feishu_record_id = row.feishu_record_id || '';
  return item;
}

export function filterD1Requisitions(
  rows: Array<Record<string, any>>,
  filters: { status?: string; department?: string; responsible_person?: string } = {},
): Array<Record<string, any>> {
  return rows.filter((row) => {
    if (filters.status && row.status !== filters.status) return false;
    if (filters.department && !String(row.department || '').includes(filters.department)) return false;
    if (filters.responsible_person && row.responsible_person !== filters.responsible_person) return false;
    return true;
  });
}

function extractScoreFromEval(evalStr: string): number | null {
  if (!evalStr) return null;
  const match = evalStr.match(/匹配[度分][：:]\s*(\d+)/);
  if (match) return parseInt(match[1]);
  const match2 = evalStr.match(/(\d+)\s*分/);
  if (match2) return parseInt(match2[1]);
  return null;
}

function mapHrReviewToStatus(review: string): string {
  const map: Record<string, string> = {
    '通过': 'approved',
    '未通过': 'rejected',
    '可进入面试': 'pending_interview',
    '待定': 'pending_review',
    '储备': 'waitlist',
  };
  return map[review] || 'pending_screening';
}

// 从 Bitable 用户字段提取 Feishu 用户信息（open_id, name）
// Bitable 用户字段格式: { users: [{ id: "ou_xxx", name: "张三", ... }] }
function extractFeishuUsers(fieldValue: any): Array<{ open_id: string; name: string; email?: string }> {
  if (!fieldValue) return [];
  // 可能是 { users: [...] } 格式
  if (fieldValue.users && Array.isArray(fieldValue.users)) {
    return fieldValue.users.map((u: any) => ({
      open_id: u.id || '',
      name: u.name || '',
      email: u.email || '',
    })).filter(u => u.open_id);
  }
  // 也可能是数组格式 [{ id: "ou_xxx", ... }]
  if (Array.isArray(fieldValue)) {
    return fieldValue.map((u: any) => ({
      open_id: u.id || '',
      name: u.name || '',
      email: u.email || '',
    })).filter(u => u.open_id);
  }
  return [];
}

function mapUrgency(v: any): string {
  const map: Record<string, string> = { '紧急': 'urgent', '普通': 'medium', '不急': 'low', '1': 'urgent', '2': 'medium', '3': 'low' };
  // 数字类型
  if (typeof v === 'number') return map[String(v)] || String(v);
  // 字符串
  if (typeof v === 'string') return map[v] || v;
  // 对象（飞书选择框/用户字段等）
  if (typeof v === 'object' && v) {
    const s = (typeof v.text === 'string' ? v.text : '') || (typeof v.name === 'string' ? v.name : '') || String(v);
    return map[s] || s;
  }
  return 'medium';
}

function mapUrgencyToChinese(v: string): string {
  const map: Record<string, string> = { 'urgent': '紧急', 'normal': '中', 'medium': '中', 'low': '低', 'high': '高' };
  return map[v] || v;
}

function mapStatus(v: any): string {
  const s = typeof v === 'object' && v ? (v.text || v.name || '') : String(v || '');
  const map: Record<string, string> = {
    '招聘中': 'open',
    '待招聘': 'recruiting',
    '已入职': 'hired',
    '暂停': 'paused',
    '已完成': 'closed',
    '已关闭': 'closed',
    '已终止': 'cancelled',
    '入职中': 'onboarding',
    '储备简历': 'pool',
  };
  return map[s] || s;
}

function getUserName(v: any): string {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) {
    const first = v[0];
    if (!first) return '';
    if (first.name) return first.name;
    if (first.text) return first.text;
    return String(first);
  }
  if (v.name) return v.name;
  if (v.text) return v.text;
  return String(v);
}

async function bitableListRecords(env: Env, tableId: string, pageSize = 500): Promise<any[]> {
  // 缓存命中
  const cached = bitableCache.get(tableId);
  if (cached && Date.now() < cached.expiry) {
    return cached.data;
  }

  const token = await getFeishuToken(env);
  const appToken = env.FEISHU_BITABLE_APP_TOKEN || FEISHU_CONFIG.appToken;
  const allRecords: any[] = [];
  let pageToken: string | null = null;

  do {
    let url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records?page_size=${pageSize}`;
    if (pageToken) url += `&page_token=${pageToken}`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data: any = await resp.json();
    if (!data.data) throw new Error(`Failed to get records: ${JSON.stringify(data)}`);
    allRecords.push(...(data.data.items || []));
    pageToken = data.data.page_token || null;
    if (!data.data.has_more) break;
  } while (pageToken);

  // 写入缓存
  bitableCache.set(tableId, { data: allRecords, expiry: Date.now() + BITABLE_CACHE_TTL });

  return allRecords;
}

async function bitableGetRecord(env: Env, tableId: string, recordId: string): Promise<any | null> {
  const token = await getFeishuToken(env);
  const appToken = env.FEISHU_BITABLE_APP_TOKEN || FEISHU_CONFIG.appToken;
  const resp = await fetch(
    `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data: any = await resp.json();
  return data.data?.record || null;
}

async function bitableCreateRecord(env: Env, tableId: string, fields: Record<string, any>): Promise<string | null> {
  // 增量更新缓存：不删全量，新记录插入头部
  const cached = bitableCache.get(tableId);
  const token = await getFeishuToken(env);
  const appToken = env.FEISHU_BITABLE_APP_TOKEN || FEISHU_CONFIG.appToken;
  const resp = await fetch(
    `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ fields }),
    }
  );
  const data: any = await resp.json();
  const newId = data.data?.record?.record_id;
  // 增量更新缓存：新记录插入头部，不用重拉全量
  if (newId && cached) {
    cached.data.unshift({ record_id: newId, fields: { ...fields, '创建时间': Date.now() } });
    cached.expiry = Date.now() + BITABLE_CACHE_TTL;
  }
  return newId || null;
}

async function bitableUpdateRecord(env: Env, tableId: string, recordId: string, fields: Record<string, any>): Promise<boolean> {
  // 增量更新缓存：更新已有记录，不删全量
  const cached = bitableCache.get(tableId);
  const token = await getFeishuToken(env);
  const appToken = env.FEISHU_BITABLE_APP_TOKEN || FEISHU_CONFIG.appToken;
  const resp = await fetch(
    `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ fields }),
    }
  );
  const data: any = await resp.json();
  if (data.data?.record && cached) {
    // 更新缓存中对应记录
    const idx = cached.data.findIndex((r: any) => r.record_id === recordId);
    if (idx >= 0) cached.data[idx] = { record_id: recordId, fields: { ...cached.data[idx].fields, ...fields } };
    cached.expiry = Date.now() + BITABLE_CACHE_TTL;
  }
  return !!data.data?.record;
}

async function bitableDeleteRecord(env: Env, tableId: string, recordId: string): Promise<boolean> {
  bitableCache.delete(tableId);
  const token = await getFeishuToken(env);
  const appToken = env.FEISHU_BITABLE_APP_TOKEN || FEISHU_CONFIG.appToken;
  const resp = await fetch(
    `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  const data: any = await resp.json();
  return data.code === 0;
}

// ==================== Special GET routes (before CRUD to avoid :id matching) ====================

app.get('/api/resumes/my-reviews', authMiddleware, async (c) => {
  const user = c.get('user');
  const result = await c.env.DB.prepare('SELECT * FROM department_reviews WHERE reviewer_id = ? AND is_completed = 0').bind(user.id).all();
  return c.json(result.results.map(transformRow));
});

// 面试列表 — 覆盖 CRUD 默认查询，左连接获取候选人姓名和岗位名称
app.get('/api/interviews', authMiddleware, async (c) => {
  const user = c.get('user');
  let sql = `SELECT 
    i.*,
    r.candidate_name AS _candidate_name,
    p.title AS _position_title
  FROM interviews i
  LEFT JOIN resumes r ON i.resume_id = r.id
  LEFT JOIN positions p ON i.position_id = p.id`;
  const binds: any[] = [];
  const conditions: string[] = [];

  // 面试官只能看自己的面试
  if (user?.role === 'interviewer') {
    conditions.push('i.interviewer_id = ?');
    binds.push(user.id);
  }

  // 非管理员：只显示自己负责岗位的面试记录（通过 position_mappings 匹配）
  if (user?.role !== 'admin' && user?.full_name) {
    conditions.push("(r.position_applied IN (SELECT raw_name FROM position_mappings WHERE responsible_person = ?) OR r.mapped_position IN (SELECT mapped_name FROM position_mappings WHERE responsible_person = ?) OR i.position_id IN (SELECT id FROM positions WHERE responsible_person = ?))");
    binds.push(user.full_name, user.full_name, user.full_name);
  }

  const status = c.req.query('status');
  if (status) {
    conditions.push('i.status = ?');
    binds.push(status);
  }

  const name = c.req.query('name');
  if (name) {
    conditions.push('i.interviewer LIKE ?');
    binds.push(`%${name}%`);
  }

  const ownerName = c.req.query('owner_name');
  if (ownerName) {
    conditions.push("(r.position_applied IN (SELECT raw_name FROM position_mappings WHERE responsible_person = ?) OR r.mapped_position IN (SELECT mapped_name FROM position_mappings WHERE responsible_person = ?) OR i.position_id IN (SELECT id FROM positions WHERE responsible_person = ?))");
    binds.push(ownerName, ownerName, ownerName);
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }
  // 按简历入库时间倒序（入库越晚越靠前）；无关联简历时回退到面试创建时间
  sql += ' ORDER BY COALESCE(r.created_at, i.created_at) DESC';

  // 可选服务端分页（向后兼容：不传 page/pageSize 时返回全量数组）
  const page = parseInt(c.req.query('page') || '0', 10);
  const pageSize = parseInt(c.req.query('pageSize') || '0', 10);

  const [positionRows, mappingRows] = await Promise.all([
    c.env.DB.prepare('SELECT id, title, primary_interviewer, secondary_interviewer FROM positions').all(),
    c.env.DB.prepare('SELECT raw_name, raw_names, mapped_name FROM position_mappings').all(),
  ]);
  const positionDefaultsIndex = buildPositionDefaultsIndex(
    (positionRows.results || []) as any[],
    (mappingRows.results || []) as any[],
  );
  const formatInterviewRow = (row: any) => {
    const resolvedPosition = resolvePositionDefaults(positionDefaultsIndex, row);
    const assignment = resolveStoredInterviewAssignments(row, resolvedPosition);
    return {
      ...transformRow(row),
      primary_interviewer: assignment.primaryInterviewer,
      secondary_interviewer: assignment.secondaryInterviewer,
      interviewer: assignment.interviewer,
      standard_position: resolvedPosition?.title || row._position_title || row.position_applied || row.position_id || '',
      resume: { candidate_name: row._candidate_name || row.candidate_name || '未知' },
      position: { title: resolvedPosition?.title || row._position_title || row.position_applied || row.position_id || '未知岗位' },
    };
  };

  if (page > 0 && pageSize > 0) {
    // 先查总数
    const countSql = `SELECT COUNT(*) as total FROM (${sql})`;
    const countRow = await c.env.DB.prepare(countSql).bind(...binds).first();
    const total = (countRow as any)?.total || 0;
    // 分页查询
    const offset = (page - 1) * pageSize;
    const pagedSql = `${sql} LIMIT ? OFFSET ?`;
    const { results } = await c.env.DB.prepare(pagedSql).bind(...binds, pageSize, offset).all();
    return c.json({
      items: results.map(formatInterviewRow),
      total, page, pageSize,
    });
  }

  const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json(results.map(formatInterviewRow));
});

// ==================== CRUD Registration ====================

// ==================== 岗位管理：从飞书同步 ====================

/**
 * 从飞书招聘任务表同步岗位到 positions 表
 * POST /api/positions/sync-from-feishu
 */
app.post('/api/positions/sync-from-feishu', authMiddleware, async (c) => {
  try {
    const tableId = getBitableTableId(c.env, 'requisition');
    const records = await bitableListRecords(c.env, tableId);
    const positionMappings = await buildPositionMapping(c.env.DB);
    
    // 按标准岗位聚合，避免同一岗位存在多个原始名称时只取到一条空配置。
    const parsedByTitle = new Map<string, any>();
    for (const rec of records) {
      const parsed = parseRequisitionRecord(rec);
      const title = resolveMappedPosition(positionMappings, parsed.title);
      if (!title || title === '(未命名岗位)') continue;
      const existing = parsedByTitle.get(title);
      if (!existing) {
        parsedByTitle.set(title, { ...parsed, title });
        continue;
      }
      for (const field of [
        'department', 'city', 'description', 'requirements', 'responsible_person',
        'salary_range', 'primary_interviewer', 'secondary_interviewer',
      ]) {
        if (!existing[field] && parsed[field]) existing[field] = parsed[field];
      }
      if ((!existing.headcount || existing.headcount === 1) && parsed.headcount > 1) {
        existing.headcount = parsed.headcount;
      }
    }

    let created = 0;
    let updated = 0;
    const skipped = Math.max(0, records.length - parsedByTitle.size);

    for (const parsed of parsedByTitle.values()) {
      const title = parsed.title;
      
      // 检查是否已存在
      const existing = await c.env.DB.prepare(
        'SELECT id FROM positions WHERE title = ? LIMIT 1'
      ).bind(title).first();
      
      if (existing) {
        // 更新
        await c.env.DB.prepare(
          `UPDATE positions SET 
            department = ?, location = ?, headcount = ?,
            urgency = ?, status = ?, description = ?, requirements = ?,
            responsible_person = ?, salary_range = ?,
            primary_interviewer = ?, secondary_interviewer = ?,
            updated_at = ?
           WHERE id = ?`
        ).bind(
          parsed.department || '', parsed.city || '',
          parsed.headcount || 1, parsed.urgency || 'normal', parsed.status || 'open',
          parsed.description || '', parsed.requirements || '',
          parsed.responsible_person || '', parsed.salary_range || '',
          parsed.primary_interviewer || '', parsed.secondary_interviewer || '',
          now(), existing.id
        ).run();
        updated++;
      } else {
        // 新建
        const id = uuid();
        await c.env.DB.prepare(
          `INSERT INTO positions (id, title, department, location, headcount, 
            urgency, status, description, requirements, responsible_person, salary_range,
            primary_interviewer, secondary_interviewer,
            created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          id, title,
          parsed.department || '', parsed.city || '',
          parsed.headcount || 1, parsed.urgency || 'normal', parsed.status || 'open',
          parsed.description || '', parsed.requirements || '',
          parsed.responsible_person || '', parsed.salary_range || '',
          parsed.primary_interviewer || '', parsed.secondary_interviewer || '',
          now(), now()
        ).run();
        created++;
      }

    }
    
    return c.json({
      ok: true,
      message: `同步完成：新增 ${created} 个岗位，更新 ${updated} 个，跳过 ${skipped} 个`,
      created,
      updated,
      skipped,
    });
  } catch (e: any) {
    console.error(`[PositionSync] 失败: ${e.message}`);
    return c.json({ detail: '同步失败: ' + e.message }, 500);
  }
});

/**
 * 岗位模板同步 - 核心逻辑（可复用）
 */
async function syncPositionTemplates(env: Env, db: any): Promise<{ count: number; salaryMap: Map<string, string> }> {
  const tableId = env.FEISHU_POSITION_TABLE_ID || FEISHU_CONFIG.positionTableId;
  const records = await bitableListRecords(env, tableId);
  const now = new Date().toISOString();
  let count = 0;
  const salaryMap = new Map<string, string>();

  for (const rec of records) {
    const f = rec.fields || {};
    const title = getFirstValue(f['岗位名称']) || getFirstValue(f['招聘岗位']) || '';
    if (!title) continue;

    const salaryRange = getFirstValue(f['薪资范围']) || getFirstValue(f['薪酬范围']) || '';
    if (salaryRange) salaryMap.set(title, salaryRange);

    const capabilityDims = getFirstValue(f['能力维度']) || getFirstValue(f['岗位能力维度要求']) || '';

    const existing = await db.prepare(
      'SELECT id FROM positions WHERE title = ? LIMIT 1'
    ).bind(title).first();

    if (existing) {
      await db.prepare(
        `UPDATE positions SET salary_range = COALESCE(NULLIF(?, ''), salary_range),
         capability_dimensions = COALESCE(NULLIF(?, ''), capability_dimensions),
         updated_at = ? WHERE id = ?`
      ).bind(salaryRange, capabilityDims, now, existing.id).run();
      count++;
    } else {
      const id = crypto.randomUUID();
      await db.prepare(
        `INSERT INTO positions (id, title, salary_range, capability_dimensions, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'open', ?, ?)`
      ).bind(id, title, salaryRange, capabilityDims, now, now).run();
      count++;
    }
  }
  return { count, salaryMap };
}

/**
 * 岗位模板同步 - 从飞书年度招聘需求表读取岗位模板数据
 * POST /api/positions/sync-template-from-feishu
 */
app.post('/api/positions/sync-template-from-feishu', authMiddleware, async (c) => {
  try {
    const { count } = await syncPositionTemplates(c.env, c.env.DB);
    return c.json({ ok: true, message: `模板同步完成：${count} 个岗位已更新`, count });
  } catch (e: any) {
    console.error(`[PositionTemplateSync] 失败: ${e.message}`);
    return c.json({ detail: '模板同步失败: ' + e.message }, 500);
  }
});

app.post('/api/requisitions/sync-from-feishu', authMiddleware, async (c) => {
  try {
    // 先同步岗位模板（直接拿到 salaryMap）
    let templateSalaryMap = new Map<string, string>();
    try {
      const result = await syncPositionTemplates(c.env, c.env.DB);
      templateSalaryMap = result.salaryMap;
      console.log(`[RequisitionSync] 模板同步: ${result.count} 岗位, 薪资映射: ${templateSalaryMap.size} 条`);
      // 打印所有薪资映射（诊断用）
      const sample = Array.from(templateSalaryMap.entries()).slice(0, 5).map(([k,v]) => `${k}=${v}`).join(', ');
      console.log(`[RequisitionSync] 薪资映射样例: ${sample}`);
    } catch (te: any) {
      console.warn(`[RequisitionSync] 模板同步失败（继续）: ${te.message}`);
      // 尝试单独测试飞书连通性
      try {
        const testRecords = await bitableListRecords(c.env, c.env.FEISHU_POSITION_TABLE_ID || FEISHU_CONFIG.positionTableId);
        console.log(`[RequisitionSync] 飞书连通正常，模板表记录数: ${testRecords.length}`);
      } catch (te2: any) {
        console.error(`[RequisitionSync] 飞书连通失败: ${te2.message}`);
      }
    }

    const tableId = getBitableTableId(c.env, 'requisition');
    const records = await bitableListRecords(c.env, tableId);

    const synced = new Set<string>();
    let created = 0;
    let updated = 0;
    let skipped = 0;

    // D1兜底：如果直接map为空，从 positions 表补充
    if (templateSalaryMap.size === 0) {
      try {
        const positions = await c.env.DB.prepare(
          'SELECT title, salary_range FROM positions WHERE salary_range IS NOT NULL AND salary_range != \'\''
        ).all();
        for (const p of (positions.results || []) as any[]) {
          if (p.title && p.salary_range) templateSalaryMap.set(p.title, p.salary_range);
        }
      } catch {}
    }

    for (const rec of records) {
      const parsed = parseRequisitionRecord(rec);
      const title = parsed.title;
      if (!title || title === '(未命名岗位)' || synced.has(title)) {
        skipped++;
        continue;
      }
      synced.add(title);

      // 如果飞书没有薪资范围，从模板表交叉引用
      if (!parsed.salary_range && templateSalaryMap.has(title)) {
        parsed.salary_range = templateSalaryMap.get(title) || '';
      }

      // 按 feishu_record_id 或 title 去重
      const existing = await c.env.DB.prepare(
        'SELECT id FROM job_requisitions WHERE feishu_record_id = ? OR title = ? LIMIT 1'
      ).bind(parsed.feishu_record_id, title).first();

      if (existing) {
        // 更新
        await c.env.DB.prepare(
          `UPDATE job_requisitions SET
            title = ?, department = ?, city = ?, headcount = ?,
            urgency = ?, status = ?, reason = ?, notes = ?,
            description = ?, requirements = ?,
            hr_interviewer = ?, biz_interviewer = ?, final_interviewer = ?,
            responsible_person = ?, salary_range = ?, budget = ?, expected_date = ?,
            feishu_record_id = ?, updated_at = ?
           WHERE id = ?`
        ).bind(
          title,
          parsed.department || '', parsed.city || '',
          parsed.headcount || 1, parsed.urgency || 'normal', parsed.status || 'open',
          parsed.reason || '', parsed.notes || '',
          parsed.description || '', parsed.requirements || '',
          parsed.hr_interviewer || '', parsed.biz_interviewer || '', parsed.final_interviewer || '',
          parsed.responsible_person || '', parsed.salary_range || '', parsed.budget ?? null, parsed.expected_date || null,
          parsed.feishu_record_id,
          now(), existing.id
        ).run();
        updated++;
      } else {
        // 新建
        const id = uuid();
        await c.env.DB.prepare(
          `INSERT INTO job_requisitions (id, title, department, city, headcount,
            urgency, status, reason, notes, description, requirements,
            hr_interviewer, biz_interviewer, final_interviewer,
            responsible_person, salary_range, budget, expected_date,
            feishu_record_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          id, title,
          parsed.department || '', parsed.city || '',
          parsed.headcount || 1, parsed.urgency || 'normal', parsed.status || 'open',
          parsed.reason || '', parsed.notes || '',
          parsed.description || '', parsed.requirements || '',
          parsed.hr_interviewer || '', parsed.biz_interviewer || '', parsed.final_interviewer || '',
          parsed.responsible_person || '', parsed.salary_range || '', parsed.budget ?? null, parsed.expected_date || null,
          parsed.feishu_record_id,
          now(), now()
        ).run();
        created++;
      }
    }

    return c.json({
      ok: true,
      message: `同步完成：新增 ${created} 条，更新 ${updated} 条，跳过 ${skipped} 条`,
      created,
      updated,
      skipped,
      total: records.length,
    });
  } catch (e: any) {
    console.error(`[RequisitionSync] 失败: ${e.message}`);
    return c.json({ detail: '同步失败: ' + e.message }, 500);
  }
});

registerCrud('positions', 'positions', { title: 'like', status: 'eq', department: 'like', responsible_person: 'eq' });
// interviews → 保留 D1（面试记录暂不迁移）
registerCrud('interviews', 'interviews', { position_id: 'eq', status: 'eq' });
registerCrud('background-checks', 'background_checks', { status: 'eq' });
// 入职状态变更 → 自动同步试用期
app.put('/api/onboarding/:id', authMiddleware, async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const db = c.env.DB;
  const now = new Date().toISOString();

  try {
    // 1. 更新入职记录
    const existing = await db.prepare('SELECT * FROM onboarding_records WHERE id = ?').bind(id).first() as any;
    if (!existing) return c.json({ detail: 'Not found' }, 404);

    const cols: string[] = [];
    const vals: any[] = [];
    for (const [k, v] of Object.entries(body)) {
      if (['id', 'created_at'].includes(k)) continue;
      cols.push(k); vals.push(v);
    }
    cols.push('updated_at'); vals.push(now);
    const setClause = cols.map(c => `${c} = ?`).join(', ');
    await db.prepare(`UPDATE onboarding_records SET ${setClause} WHERE id = ?`).bind(...vals, id).run();

    // 2. 状态变为"入职中" → 自动创建试用期记录
    const newStatus = body.status || existing.status;
    if (newStatus === 'in_progress') {
      const existPb = await db.prepare('SELECT id FROM probation_records WHERE onboarding_id = ?').bind(id).first();
      if (!existPb) {
        const pbId = 'pb_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
        const start = new Date().toISOString().slice(0, 10);
        const endDate = new Date(Date.now() + 90 * 86400000);
        const end = endDate.toISOString().slice(0, 10);
        const empName = body.candidate_name || existing.candidate_name || '';

        await db.prepare(`INSERT INTO probation_records
          (id, onboarding_id, resume_id, position_id, employee_name, employee_id,
           probation_start, probation_end, probation_months, monthly_reviews, final_assessment, result, notes, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
          pbId, id, existing.resume_id, existing.position_id || '', empName, existing.employee_id,
          start, end, 3, '[]', null, 'pending',
          `由入职状态变更为"入职中"自动生成`, now, now
        ).run();
        console.log(`[Onboarding→Probation] 自动创建试用期记录: ${pbId} (${empName})`);
      }
    }

    // 3. 返回更新后的记录
    const updated = await db.prepare('SELECT * FROM onboarding_records WHERE id = ?').bind(id).first();
    return c.json(updated);
  } catch (e: any) {
    return c.json({ detail: e.message }, 500);
  }
});

registerCrud('onboarding', 'onboarding_records', { status: 'eq', responsible_person: 'eq' });
registerCrud('probation', 'probation_records', { status: 'eq', result: 'eq', responsible_person: 'eq' });

// ==================== Onboarding / Probation 数据同步 ====================

// 从 approved 简历派生入职记录
app.post('/api/onboarding/sync-from-resumes', authMiddleware, async (c) => {
  const db = c.env.DB;
  try {
    // 获取所有状态为 approved 的简历
    const approved = await db.prepare('SELECT id, candidate_name, position_applied, mapped_position, position_id, status, created_at FROM resumes WHERE status = ?').bind('approved').all();
    let created = 0;
    let skipped = 0;
    const now = new Date().toISOString();

    for (const r of approved.results) {
      const exist = await db.prepare('SELECT id FROM onboarding_records WHERE resume_id = ?').bind(r.id).first();
      if (exist) { skipped++; continue; }

      const id = 'ob_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
      const empId = 'EMP' + String(created + 1).padStart(3, '0');

      // 优先用 mapped_position，其次 position_applied
      let positionTitle = (r.mapped_position || r.position_applied || '待定') as string;
      if (typeof positionTitle === 'object' || positionTitle === '[object Object]') positionTitle = '待定';

      await db.prepare(`INSERT INTO onboarding_records
        (id, resume_id, position_id, candidate_name, employee_id, onboard_date, department, position_title,
         contract_signed, contract_type, accounts_created, equipment_assigned, orientation_completed, orientation_date, status, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`      ).bind(
        id, r.id, r.position_id || '', r.candidate_name, empId,
        new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10), '',
        positionTitle, 0, 'fixed_term', 0, 0, 0, null,
        'pending', '从已通过候选人自动生成', now, now
      ).run();
      created++;
    }
    return c.json({ ok: true, message: `入职记录同步完成：新增 ${created} 条，跳过 ${skipped} 条`, created, skipped });
  } catch (e: any) {
    console.error(`[OnboardingSync] 失败: ${e.message}`);
    return c.json({ detail: '同步失败: ' + e.message }, 500);
  }
});

// 从已完成 (completed) 入职记录派生试用期记录
app.post('/api/probation/sync-from-onboarding', authMiddleware, async (c) => {
  const db = c.env.DB;
  try {
    const completed = await db.prepare('SELECT * FROM onboarding_records WHERE status = ?').bind('completed').all();
    let created = 0;
    let skipped = 0;
    const now = new Date().toISOString();

    for (const ob of completed.results) {
      const exist = await db.prepare('SELECT id FROM probation_records WHERE onboarding_id = ?').bind(ob.id).first();
      if (exist) { skipped++; continue; }

      const id = 'pb_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
      const start = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const end = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);

      await db.prepare(`INSERT INTO probation_records
        (id, onboarding_id, resume_id, position_id, employee_name, employee_id,
         probation_start, probation_end, probation_months, monthly_reviews, final_assessment, result, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
        id, ob.id, ob.resume_id, ob.position_id || '', ob.candidate_name, ob.employee_id,
        start, end, 3, '[]', null, 'pending',
        '从已完成入职记录自动生成', now, now
      ).run();
      created++;
    }
    return c.json({ ok: true, message: `试用期记录同步完成：新增 ${created} 条，跳过 ${skipped} 条`, created, skipped, note: '提示：需要入职状态为 completed 才会生成试用期记录' });
  } catch (e: any) {
    console.error(`[ProbationSync] 失败: ${e.message}`);
    return c.json({ detail: '同步失败: ' + e.message }, 500);
  }
});

// 从 approved 简历派生面试记录
app.post('/api/interviews/sync-from-resumes', authMiddleware, async (c) => {
  const db = c.env.DB;
  try {
    // 获取已 approved 的简历（已通过 AI 初筛 + HR 复核）
    const approved = await db.prepare("SELECT id, candidate_name, position_applied, mapped_position, position_id FROM resumes WHERE status = 'approved'").all();
    const positions = await db.prepare("SELECT id, title, primary_interviewer, secondary_interviewer FROM positions LIMIT 20").all();
    const posList = positions.results as any[];
    let created = 0, skipped = 0;
    const now = new Date().toISOString();

    for (const r of approved.results) {
      const exist = await db.prepare('SELECT id FROM interviews WHERE resume_id = ?').bind(r.id).first();
      if (exist) { skipped++; continue; }

      // 匹配岗位：优先用 mapped_position 模糊匹配 positions 表
      let posId = r.position_id || '' as string;
      let posTitle = (r.mapped_position || r.position_applied || '') as string;
      let interviewer = '';

      if (!posId && posList.length > 0 && posTitle) {
        const matched = posList.find((p: any) => p.title && posTitle.includes(p.title)) || posList[0];
        posId = matched.id;
        posTitle = matched.title;
        interviewer = matched.primary_interviewer || '';
      }

      const id = 'iv_fs_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
      const interviewDate = new Date(Date.now() + 7 * 86400000).toISOString().replace('T', ' ').slice(0, 19);

      await db.prepare(`INSERT INTO interviews (id, resume_id, position_id, interviewer, round, interview_time, interview_type, interview_location, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, ?, 'onsite', '待定', 'scheduled', ?, ?)`)
        .bind(id, r.id, posId, interviewer, interviewDate, now, now).run();
      created++;
    }
    return c.json({ ok: true, message: `面试记录同步完成：新增 ${created} 条，跳过 ${skipped} 条`, created, skipped, source: 'approved 简历' });
  } catch (e: any) {
    console.error(`[InterviewSync] 失败: ${e.message}`);
    return c.json({ detail: '同步失败: ' + e.message }, 500);
  }
});

registerCrud('workflows', 'workflows', { status: 'eq' });
registerCrud('workflow-nodes', 'workflow_nodes', { workflow_id: 'eq' });
registerCrud('workflow-edges', 'workflow_edges', { workflow_id: 'eq' });
registerCrud('workflow-executions', 'workflow_executions', { workflow_id: 'eq', status: 'eq' });

// ==================== 需求管理（D1 主数据源） ====================

app.get('/api/requisitions', authMiddleware, async (c) => {
  try {
    const result = await c.env.DB.prepare(
      'SELECT * FROM job_requisitions ORDER BY datetime(created_at) DESC, rowid DESC'
    ).all();
    const statusFilter = c.req.query('status');
    const deptFilter = c.req.query('department');
    const ownerFilter = c.req.query('responsible_person');
    let filtered = filterD1Requisitions((result.results || []) as Array<Record<string, any>>, {
      status: statusFilter,
      department: deptFilter,
      responsible_person: ownerFilter,
    });

    // 非管理员：只显示自己是责任人的需求
    const currentUser = c.get('user');
    if (currentUser?.role !== 'admin' && currentUser?.full_name) {
      filtered = filtered.filter(i => i.responsible_person === currentUser.full_name);
    }

    return c.json(filtered.map(parseD1RequisitionRow));
  } catch (e: any) {
    console.error(`[Requisition] D1 列表失败: ${e.message}`);
    return c.json({ detail: '读取需求失败: ' + e.message }, 500);
  }
});

app.get('/api/requisitions/:id', authMiddleware, async (c) => {
  try {
    const id = c.req.param('id');
    const row = await c.env.DB.prepare(
      'SELECT * FROM job_requisitions WHERE id = ? OR feishu_record_id = ?'
    ).bind(id, id).first() as Record<string, any> | null;
    if (!row) return c.json({ detail: 'Not found' }, 404);
    return c.json(parseD1RequisitionRow(row));
  } catch (e: any) {
    return c.json({ detail: e.message }, 500);
  }
});

app.post('/api/requisitions', authMiddleware, async (c) => {
  try {
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ detail: '请求体不是合法的 JSON' }, 400);
    }
    // 必填与长度校验（修复零校验产生脏数据 2026-07-24）
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return c.json({ detail: '请求体格式错误' }, 400);
    }
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) {
      return c.json({ detail: '岗位名称（title）为必填项' }, 400);
    }
    if (title.length > 200) {
      return c.json({ detail: '岗位名称长度不能超过 200 个字符' }, 400);
    }
    if (typeof body.department === 'string' && body.department.length > 200) {
      return c.json({ detail: '部门名称长度不能超过 200 个字符' }, 400);
    }
    if (typeof body.description === 'string' && body.description.length > 20000) {
      return c.json({ detail: '职位描述长度不能超过 20000 个字符' }, 400);
    }
    const d1Id = uuid();
    await c.env.DB.prepare(
      `INSERT INTO job_requisitions (
        id, title, department, headcount, employment_type, salary_range, budget, urgency, expected_date,
        description, requirements, status, city, hard_requirements, personalized_requirements,
        hr_interviewer, biz_interviewer, final_interviewer, responsible_person, reason, notes,
        feishu_record_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      d1Id, title, body.department || '', Number(body.headcount) || 1, body.employment_type || 'full_time',
      body.salary_range || '', body.budget ?? null, body.urgency || 'medium', body.expected_date || null,
      body.description || '', body.requirements || '', body.status || 'draft',
      serializeRequisitionJsonField('city', body.city),
      serializeRequisitionJsonField('hard_requirements', body.hard_requirements),
      serializeRequisitionJsonField('personalized_requirements', body.personalized_requirements),
      body.hr_interviewer || '', body.biz_interviewer || '', body.final_interviewer || '',
      body.responsible_person || '', body.reason || '', body.notes || '', '', now(), now()
    ).run();

    // 返回以 D1 数据为准
    const row = await c.env.DB.prepare(
      'SELECT * FROM job_requisitions WHERE id = ?'
    ).bind(d1Id).first() as any;
    return c.json(parseD1RequisitionRow(row));
  } catch (e: any) {
    return c.json({ detail: '创建需求失败: ' + e.message }, 500);
  }
});

app.put('/api/requisitions/:id', authMiddleware, async (c) => {
  try {
    const body = await c.req.json();
    const id = c.req.param('id');
    const sets: string[] = [];
    const vals: any[] = [];
    const jsonFields = new Set(['city', 'hard_requirements', 'personalized_requirements']);
    const editableFields = [
      'title', 'department', 'headcount', 'employment_type', 'salary_range', 'budget', 'urgency', 'expected_date',
      'description', 'requirements', 'status', 'hr_interviewer', 'biz_interviewer', 'final_interviewer',
      'responsible_person', 'reason', 'notes', 'city', 'hard_requirements', 'personalized_requirements',
    ];
    for (const field of editableFields) {
      if (body[field] === undefined) continue;
      sets.push(`${field} = ?`);
      vals.push(jsonFields.has(field) ? serializeRequisitionJsonField(field, body[field]) : body[field]);
    }

    if (sets.length > 0) {
      await c.env.DB.prepare(
        `UPDATE job_requisitions SET ${sets.join(', ')}, updated_at = ? WHERE id = ? OR feishu_record_id = ?`
      ).bind(...vals, now(), id, id).run();
    }

    const row = await c.env.DB.prepare(
      'SELECT * FROM job_requisitions WHERE id = ? OR feishu_record_id = ?'
    ).bind(id, id).first() as any;
    if (!row) return c.json({ detail: 'Not found' }, 404);
    return c.json(parseD1RequisitionRow(row));
  } catch (e: any) {
    return c.json({ detail: '更新失败: ' + e.message }, 500);
  }
});

app.delete('/api/requisitions/:id', authMiddleware, async (c) => {
  try {
    const id = c.req.param('id');
    await c.env.DB.prepare(
      'DELETE FROM job_requisitions WHERE id = ? OR feishu_record_id = ?'
    ).bind(id, id).run();
    return c.json({ detail: 'Deleted' });
  } catch (e: any) {
    return c.json({ detail: '删除失败: ' + e.message }, 500);
  }
});

// ---- 人才库：直读飞书人才库表 ----
app.get('/api/talent-pool', authMiddleware, async (c) => {
  try {
    // v2.0: 不再默认从飞书拉取，只返回本地 D1 数据
    // 飞书数据通过手动点击「从飞书同步」按钮导入
    let d1Rows: any[] = [];
    try {
      const result = await c.env.DB.prepare("SELECT * FROM resumes WHERE status = 'approved'").all();
      d1Rows = result.results || [];
    } catch (error: any) {
      console.error(`[TalentPool] D1 query failed: ${error?.message || error}`);
    }
    let items = d1Rows.map(parseD1TalentRow);
    try {
      const mappings = await c.env.DB.prepare('SELECT raw_name, raw_names, mapped_name FROM position_mappings').all();
      const positionMap = buildPositionMappingFromRows(mappings.results || []);
      items = items.map((item: any) => ({
        ...item,
        standard_position: resolveMappedPosition(positionMap, item.mapped_position || item.position_applied || ''),
      }));
    } catch {}

    const nameFilter = c.req.query('candidate_name');
    const statusFilter = c.req.query('status');
    const responsiblePerson = c.req.query('responsible_person');
    let filtered = items;

    // 负责人筛选：通过 position_mappings 表匹配 mapped_position → responsible_person
    if (responsiblePerson) {
      const mapRows = await c.env.DB.prepare(
        'SELECT mapped_name FROM position_mappings WHERE responsible_person = ?'
      ).bind(responsiblePerson).all();
      const personPositions = new Set((mapRows.results || []).map((r: any) => r.mapped_name.trim().toLowerCase()));
      // 也查 positions 表
      const posRows = await c.env.DB.prepare(
        'SELECT title FROM positions WHERE responsible_person = ?'
      ).bind(responsiblePerson).all();
      for (const r of (posRows.results || [])) personPositions.add((r as any).title.trim().toLowerCase());
      filtered = filtered.filter((i: any) => {
        const pos = (i.mapped_position || i.position_applied || '').trim().toLowerCase();
        return personPositions.has(pos);
      });
    }

    if (statusFilter) {
      filtered = filtered.filter(i => i.status === statusFilter);
    } else {
      // 默认不显示待初筛和已淘汰的，人才库只展示已入库的
      filtered = filtered.filter(i => i.status !== 'pending_screening' && i.status !== 'rejected');
    }
    if (nameFilter) filtered = filtered.filter(i => i.candidate_name?.includes(nameFilter));

    // 按入库时间倒序：最新入库排最前面（create_time 为飞书多维表格的毫秒时间戳）
    filtered.sort((a: any, b: any) => {
      const aTime = Number(a.create_time) || 0;
      const bTime = Number(b.create_time) || 0;
      return bTime - aTime;
    });

    return c.json(filtered);
  } catch (e: any) {
    console.error(`[Bitable] 人才库列表失败: ${e.message}`);
    return c.json({ detail: '读取飞书数据失败: ' + e.message }, 500);
  }
});

app.get('/api/talent-pool/:id', authMiddleware, async (c) => {
  try {
    const tableId = getBitableTableId(c.env, 'talent');
    const record = await bitableGetRecord(c.env, tableId, c.req.param('id'));
    if (!record) return c.json({ detail: 'Not found' }, 404);
    return c.json(parseTalentRecord(record));
  } catch (e: any) {
    return c.json({ detail: e.message }, 500);
  }
});

app.post('/api/talent-pool', authMiddleware, async (c) => {
  try {
    const body = await c.req.json();
    const tableId = getBitableTableId(c.env, 'talent');
    const fields = feishuFieldsToRecord(FEISHU_TALENT_FIELDS, body);
    const recordId = await bitableCreateRecord(c.env, tableId, fields);
    if (!recordId) return c.json({ detail: 'Create failed' }, 500);
    const record = await bitableGetRecord(c.env, tableId, recordId);
    return c.json(parseTalentRecord(record));
  } catch (e: any) {
    return c.json({ detail: '创建失败: ' + e.message }, 500);
  }
});

app.put('/api/talent-pool/:id', authMiddleware, async (c) => {
  try {
    const body = await c.req.json();
    const tableId = getBitableTableId(c.env, 'talent');
    const fields = feishuFieldsToRecord(FEISHU_TALENT_FIELDS, body);
    await bitableUpdateRecord(c.env, tableId, c.req.param('id'), fields);
    const record = await bitableGetRecord(c.env, tableId, c.req.param('id'));
    return c.json(parseTalentRecord(record));
  } catch (e: any) {
    return c.json({ detail: '更新失败: ' + e.message }, 500);
  }
});

app.delete('/api/talent-pool/:id', authMiddleware, async (c) => {
  try {
    const tableId = getBitableTableId(c.env, 'talent');
    await bitableDeleteRecord(c.env, tableId, c.req.param('id'));
    return c.json({ detail: 'Deleted' });
  } catch (e: any) {
    return c.json({ detail: '删除失败: ' + e.message }, 500);
  }
});

app.post('/api/talent-pool/:id/notify-interview', authMiddleware, async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    const name = body?.name || '候选人';
    const position = body?.position || '';

    // 查飞书招聘任务表，找到匹配岗位的面试官
    const requisitionTableId = getBitableTableId(c.env, 'requisition');
    const reqs = await bitableListRecords(c.env, requisitionTableId);
    const matched = reqs.find(r => {
      const f = r.fields || {};
      const posName = f['招聘岗位'] ? (Array.isArray(f['招聘岗位']) ? String(f['招聘岗位'][0] || '') : String(f['招聘岗位'])) : '';
      return position && posName.includes(position);
    });

    const interviewers: string[] = [];
    if (matched) {
      const f = matched.fields || {};
      const hrNames = getUserName(f['HR二面']);
      const bizNames = getUserName(f['业务一面']);
      if (hrNames) interviewers.push(hrNames);
      if (bizNames) interviewers.push(bizNames);
    }

    // 发飞书群消息
    const token = await getFeishuToken(c.env);
    const chatId = FEISHU_CONFIG.recruitmentGroupChatId;
    if (chatId) {
      const msg = {
        msg_type: 'interactive',
        content: JSON.stringify({
          config: { wide_screen_mode: true },
          header: { title: { tag: 'plain_text', content: `🎯 面试安排提醒` }, template: 'blue' },
          elements: [
            { tag: 'div', text: { tag: 'lark_md', content: `**候选人：** ${name}\n**面试岗位：** ${position || '未指定'}` } },
            { tag: 'hr' },
            { tag: 'div', text: { tag: 'lark_md', content: `请相关面试官尽快安排面试。` } },
            { tag: 'note', elements: [{ tag: 'plain_text', content: `来自 AI 智能面试系统` }] }
          ]
        })
      };
      await fetch(`https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ receive_id: chatId, ...msg }),
      });
    }

    return c.json({ ok: true, detail: `已通知面试官安排 ${name} 的面试` });
  } catch (e: any) {
    return c.json({ detail: '通知失败: ' + e.message }, 500);
  }
});

// ---- 面试管理：评价（替换旧评分/AI流程） ----

// 面试官提交评价与结果（支持一面/二面）
app.post('/api/interviews/:id/evaluate', authMiddleware, async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    const { evaluation, result, round } = body;  // result: 'passed' | 'failed', round: 1 | 2
    if (!evaluation && !result) {
      return c.json({ detail: '请填写评价或选择结果' }, 400);
    }
    const r = round === 2 ? 2 : 1;

    if (r === 1) {
      const newStatus = result === 'passed' ? 'scheduled' : 'completed';  // 一面通过→待面试(进入二面)，否则→已完成
      const updates: string[] = ['status = ?'];
      const binds: any[] = [newStatus];
      if (evaluation) { updates.push('evaluation = ?'); binds.push(evaluation); }
      if (result) { updates.push('result = ?'); binds.push(result); }
      binds.push(id);
      await c.env.DB.prepare(
        `UPDATE interviews SET ${updates.join(', ')} WHERE id = ?`
      ).bind(...binds).run();
    } else {
      const updates: string[] = ['status2 = ?'];
      const binds: any[] = ['completed'];
      if (evaluation) { updates.push('evaluation2 = ?'); binds.push(evaluation); }
      if (result) { updates.push('result2 = ?'); binds.push(result); }
      binds.push(id);
      await c.env.DB.prepare(
        `UPDATE interviews SET ${updates.join(', ')} WHERE id = ?`
      ).bind(...binds).run();
    }

    // 埋点：面试评估提交
    await logOperation(c.env, {
      action: 'interview.evaluate',
      entityType: 'interview',
      entityId: id,
      actor: c.get('user')?.email,
      detail: JSON.stringify({ round: r, result: result || '' }),
    });

    return c.json({ ok: true, detail: `第${r}面评价已提交` });
  } catch (e: any) {
    return c.json({ detail: '提交失败: ' + e.message }, 500);
  }
});

export const resolveInterviewAssignments = resolveInterviewAssignmentsFromDefaults;
export { resolveStoredInterviewAssignments } from './interviewer-assignment';

async function findPositionByName(db: any, positionName: unknown): Promise<any | null> {
  const rawName = typeof positionName === 'string' ? positionName.trim() : '';
  if (!rawName) return null;
  const direct = await db.prepare(
    'SELECT id, title, primary_interviewer, secondary_interviewer FROM positions WHERE title = ? LIMIT 1'
  ).bind(rawName).first();
  if (direct) return direct;

  const mappings = await db.prepare(
    'SELECT raw_name, raw_names, mapped_name FROM position_mappings'
  ).all();
  const mappedName = resolveMappedPosition(
    buildPositionMappingFromRows(mappings.results || []),
    rawName,
  );
  if (!mappedName || mappedName === rawName) return null;
  return db.prepare(
    'SELECT id, title, primary_interviewer, secondary_interviewer FROM positions WHERE title = ? LIMIT 1'
  ).bind(mappedName).first();
}


// 从人才库创建面试（人才库"面试"按钮调用）
app.post('/api/interviews/create-from-talent', authMiddleware, async (c) => {
  try {
    const body = await c.req.json();
    const { candidate_name, position_applied, city, feishu_record_id, interviewer_name, secondary_interviewer, interview_time } = body;
    const currentUser = c.get('user');

    if (!candidate_name) {
      return c.json({ detail: '缺少候选人信息' }, 400);
    }

    // 如果前端传了面试官名字，优先使用
    let interviewerOpenIds: string[] = [];
    let interviewerNames: string[] = [];
    let matchedReqRecordId: string | null = null;
    let matchedReqTitle: string = '';
    let pendingCandidates: string[] = [];

    if (interviewer_name) {
      interviewerNames.push(interviewer_name);
      const openId = await getInterviewerOpenId(c.env, interviewer_name);
      if (openId) interviewerOpenIds.push(openId);
    }

    // 如果没有传面试官名字，从招聘任务表查找
    if (!interviewer_name) {
    const requisitionTableId = getBitableTableId(c.env, 'requisition');

    const reqs = await bitableListRecords(c.env, requisitionTableId);
    // 1. 精确匹配：状态=招聘中 + 招聘岗位 + 城市
    const matchedReq = reqs.find((r: any) => {
      const f = r.fields || {};
      const status = getFirstValue(f['招聘状态']) || '';
      if (status !== '招聘中') return false;
      const posName = getFirstValue(f['招聘岗位']) || '';
      const reqCity = getFirstValue(f['招聘城市']) || '';
      return posName === position_applied && (!city || !reqCity || reqCity === city);
    }) || reqs.find((r: any) => {
      // 2. 降级匹配：状态=招聘中 + 岗位包含关系 + 城市
      const f = r.fields || {};
      const status = getFirstValue(f['招聘状态']) || '';
      if (status !== '招聘中') return false;
      const posName = getFirstValue(f['招聘岗位']) || '';
      const reqCity = getFirstValue(f['招聘城市']) || '';
      return posName && position_applied && position_applied.includes(posName) && (!city || !reqCity || reqCity === city);
    });

    if (matchedReq) {
      const mf = matchedReq.fields || {};
      matchedReqRecordId = matchedReq.record_id;
      matchedReqTitle = getFirstValue(mf['招聘岗位']) || '';
    }

    // 查找该任务下"业务复核=通过 + 一面建议为空"的候选人
    if (matchedReqRecordId) {
      try {
        // 从人才库找当前候选人所在的同一任务的所有候选人
        // 按"二级部门+三级部门+招聘岗位+城市"匹配
        const talentTableId = getBitableTableId(c.env, 'talent');
        const allTalent = await bitableListRecords(c.env, talentTableId);
        const mf = matchedReq.fields || {};
        const matchDept2 = getFirstValue(mf['二级部门']) || '';
        const matchDept3 = getFirstValue(mf['三级部门']) || '';
        const matchPos = getFirstValue(mf['招聘岗位']) || '';
        const matchCity = getFirstValue(mf['招聘城市']) || '';

        for (const t of allTalent) {
          const tf = t.fields || {};
          const tName = getFirstValue(tf['姓名']) || '';
          if (!tName) continue;
          // 跳过当前候选人自己
          if (tName === candidate_name) continue;
          // 业务复核=通过
          const bizReview = getFirstValue(tf['业务复核结果']) || '';
          if (bizReview !== '通过') continue;
          // 一面建议为空
          const interviewAdvice = getFirstValue(tf['一面建议']) || '';
          if (interviewAdvice && interviewAdvice.trim() !== '') continue;

          // 岗位匹配
          const tPos = getFirstValue(tf['面试岗位']) || getFirstValue(tf['招聘岗位']) || '';
          if (tPos && matchPos && tPos !== matchPos) continue;
          const tCity = getFirstValue(tf['城市']) || '';
          if (tCity && matchCity && tCity !== matchCity) continue;

          pendingCandidates.push(tName);
        }
      } catch (e: any) {
        console.error(`查找待面试候选人失败: ${e.message}`);
      }
    }
    } // end if (!interviewer_name)

    // 创建面试记录
    const interviewId = crypto.randomUUID();

    // 从岗位管理读取一面/二面默认面试官；岗位名支持原始岗位、别名和标准岗位名。
    let positionInterviewers: any = null;
    try {
      positionInterviewers = await findPositionByName(c.env.DB, position_applied);
    } catch {}
    const assignment = resolveInterviewAssignments({ interviewer_name, secondary_interviewer }, positionInterviewers);
    const interviewerStr = assignment.primaryInterviewer || assignment.interviewer;
    if (assignment.primaryInterviewer && interviewerNames.length === 0) {
      interviewerNames.push(assignment.primaryInterviewer);
      const openId = await getInterviewerOpenId(c.env, assignment.primaryInterviewer);
      if (openId) interviewerOpenIds.push(openId);
    }

    await c.env.DB.prepare(
      `INSERT INTO interviews (id, resume_id, candidate_name, interviewer, position_id, position_applied, status, created_at, comments, primary_interviewer, secondary_interviewer)
       VALUES (?, ?, ?, ?, ?, ?, 'awaiting_schedule', datetime('now'), ?, ?, ?)`
    ).bind(
      interviewId,
      feishu_record_id || '',
      candidate_name,
      interviewerStr,
      positionInterviewers?.id || position_applied || '',
      positionInterviewers?.title || resolveMappedPosition(await buildPositionMapping(c.env.DB), position_applied || ''),
      '',
      assignment.primaryInterviewer,
      assignment.secondaryInterviewer,
    ).run();

    // == 定日程：按选定的空闲时段创建飞书会议（失败不阻断面试创建） ==
    const scheduledTime = String(interview_time || '').trim();
    const timeMs = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(scheduledTime)
      ? Date.parse(`${scheduledTime.replace(' ', 'T')}:00+08:00`)
      : Number.NaN;
    let createdMeetingLink = '';
    if (Number.isFinite(timeMs) && timeMs > Date.now() - 5 * 60_000) {
      try {
        const startTs = Math.floor(timeMs / 1000);
        const event = await createInterviewCalendarEvent(c.env, {
          summary: `面试 - ${candidate_name} - ${position_applied} - 第1轮`,
          description: `候选人：${candidate_name}\n应聘岗位：${position_applied}\n面试时间：${scheduledTime}\n由 AI-Interview 安排面试流程自动创建。`,
          startTimestamp: startTs,
          endTimestamp: startTs + 3600,
          attendeeOpenIds: interviewerOpenIds,
        }, {}, FEISHU_CONFIG.appId);
        if (event.eventId || event.meetingUrl) {
          createdMeetingLink = event.meetingUrl || '';
          await c.env.DB.prepare(
            'UPDATE interviews SET interview_time = ?, meeting_link = ?, feishu_event_id = ?, updated_at = ? WHERE id = ?',
          ).bind(scheduledTime, createdMeetingLink, event.eventId, now(), interviewId).run();
        }
      } catch (e: any) {
        console.error(`[create-from-talent] 创建飞书会议失败（不影响面试创建）: ${e?.message || e}`);
      }
    }

    // == 完整流程（异步）：①提醒面试官（带面试卡片链接/简历）②发候选人邮件（含会议链接） ==
    const operatorName = currentUser?.full_name || currentUser?.email || '系统';
    c.executionCtx.waitUntil((async () => {
      try {
        const ctx = await loadInterviewStartContext(c.env.DB as D1Database, interviewId);
        if (ctx) {
          // ① 提醒面试官：文本 + 面试卡片链接（链接内含候选人简历、可填评价）
          const userToken = currentUser?.email ? await getValidUserAccessToken(c.env, currentUser.email) : null;
          const reminder = await sendInterviewerInterviewReminder(c.env, c.env.DB as D1Database, {
            interviewId,
            userToken: userToken || await getFeishuToken(c.env),
            operatorName,
            userEmail: currentUser?.email,
          }, {
            now, uuid, hashPublicToken, getResumeFileBytes,
            getBotToken: getFeishuToken,
            refreshUserToken: async (email: string) => {
              const refreshed = await refreshUserAccessToken(c.env, email);
              return refreshed?.access_token || null;
            },
          });
          if (reminder.ok) {
            console.log(`[create-from-talent] 面试官提醒已发送 ${reminder.interviewerName} link=${reminder.cardLinkUrl || '-'}`);
          } else {
            console.warn(`[create-from-talent] 面试官提醒未发送: ${reminder.reason || '未知'}`);
          }
          // ② 候选人邮件（含会议链接；无邮箱或 SMTP 未配置则跳过）
          if (ctx.candidateEmail && createdMeetingLink) {
            const smtpRow = await c.env.DB.prepare(
              'SELECT smtp_host, smtp_port, smtp_username, smtp_password, mail_from, mail_from_name, mail_enabled FROM system_configs ORDER BY updated_at DESC LIMIT 1',
            ).first() as any;
            if (isSmtpConfigured(smtpRow)) {
              const configRow = await c.env.DB.prepare('SELECT mail_from_name FROM system_configs ORDER BY updated_at DESC LIMIT 1').first() as any;
              const result = await sendCandidateInterviewEmail(c.env.DB as D1Database, {
                ctx,
                meetingUrl: createdMeetingLink,
                fromName: (configRow?.mail_from_name && String(configRow.mail_from_name).trim()) || '招聘系统',
                nowIso: now(),
              });
              console.log(`[create-from-talent] 候选人邮件 ${result.status}${result.status === 'sent' ? ` -> ${result.to}` : `: ${result.reason}`}`);
            }
          }
        }
      } catch (e: any) {
        console.error(`[create-from-talent] 安排面试后续流程异常: ${e?.message || e}`);
      }
    })());

    // == 给面试官发飞书私信 ==
    const notificationResults: string[] = [];
    if (interviewerOpenIds.length > 0) {
      try {
        const token = await getFeishuToken(c.env);
        const operatorName = currentUser?.name || currentUser?.email || '系统管理员';
        for (const openId of interviewerOpenIds) {
          // 构建卡片内容
          const cardElements: any[] = [
            { tag: 'div', text: { tag: 'lark_md', content: `**候选人：** ${candidate_name}\n**面试岗位：** ${matchedReqTitle || position_applied || '未指定'}` } },
            { tag: 'hr' },
          ];

          // 列出该任务下待面试的其他候选人
          if (pendingCandidates.length > 0) {
            cardElements.push({
              tag: 'div',
              text: { tag: 'lark_md', content: `**同岗位待面试候选人：**\n${pendingCandidates.map((n, i) => `${i + 1}. ${n}`).join('\n')}` }
            });
            cardElements.push({ tag: 'hr' });
          }

          cardElements.push(
            { tag: 'div', text: { tag: 'lark_md', content: `${operatorName} 为候选人安排了面试，请留意后续会议邀请，及时查看候选人简历，面试结束后在系统内填写评价。` } },
            { tag: 'action', actions: [{ tag: 'button', text: { tag: 'plain_text', content: '🔍 查看候选人' }, type: 'primary', url: `https://ai-interview-88r.pages.dev/talent-pool` }] },
            { tag: 'note', elements: [{ tag: 'plain_text', content: `${operatorName} | AI 智能面试系统` }] }
          );

          const cardContent = {
            config: { wide_screen_mode: true },
            header: { title: { tag: 'plain_text', content: `🎯 面试安排通知` }, template: 'blue' },
            elements: cardElements,
          };

          const resp = await fetch(`https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({
              receive_id: openId,
              msg_type: 'interactive',
              content: JSON.stringify(cardContent),
            }),
          });
          const result: any = await resp.json();
          if (result.code === 0) {
            notificationResults.push(`✅ ${openId} 发送成功`);
          } else {
            notificationResults.push(`❌ ${openId} 发送失败: ${result.code} ${JSON.stringify(result.msg || result)}`);
          }
        }
      } catch (e: any) {
        notificationResults.push(`❌ 通知异常: ${e.message}`);
      }
    } else {
      notificationResults.push('⚠️ 未找到匹配面试官，未发送通知');
    }

    // 返回创建的面试记录
    const row = await c.env.DB.prepare('SELECT * FROM interviews WHERE id = ?').bind(interviewId).first();
    return c.json({
      ...row,
      resume: { candidate_name: candidate_name },
      position: { title: positionInterviewers?.title || position_applied || '未知岗位' },
      interviewer_list: interviewerNames,
      _notification: notificationResults,
    });
  } catch (e: any) {
    return c.json({ detail: '创建面试失败: ' + e.message }, 500);
  }
});

// 已有面试记录的「安排/改期」：直连飞书 HTTP 建/改会议（不依赖异步队列/AUTOMATION 配置）
app.post('/api/interviews/:id/schedule-direct', authMiddleware, requireRole(['admin', 'hr']), async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const startAt = String(body?.start_at || '').trim();
    const timeMs = Date.parse(startAt);
    if (!Number.isFinite(timeMs)) return c.json({ detail: 'start_at 必须为 ISO 时间（如 2026-08-25T10:00:00+08:00）' }, 400);
    const duration = Math.max(30, Math.min(480, Number(body?.duration_minutes) || 60));
    const db = c.env.DB as D1Database;
    const interview = await db.prepare('SELECT * FROM interviews WHERE id = ?').bind(id).first() as any;
    if (!interview) return c.json({ detail: '面试记录不存在' }, 404);

    const startTs = Math.floor(timeMs / 1000);
    const endTs = startTs + duration * 60;
    const timeLabel = formatBeijingSlot(startTs);
    const interviewType = String(body?.interview_type || interview.interview_type || 'video').trim();
    const isOffline = interviewType === 'onsite' || interviewType === 'offline';
    const interviewLocation = String(body?.interview_location || '').trim() || String(interview.interview_location || '').trim();
    let meetingLink = String(interview.meeting_link || '').trim();
    let eventId = String(interview.feishu_event_id || '').trim();

    // 线下面试：不建飞书会议（无会议链接）；线上面试：建/改飞书会议
    if (!isOffline) {
      if (eventId) {
        // 已有日程 → 直连飞书改时间
        const upd = await updateInterviewCalendarEventTime(c.env, eventId, {
          startTimestamp: startTs,
          endTimestamp: endTs,
        }, {}, FEISHU_CONFIG.appId);
        if (!upd.ok) return c.json({ detail: upd.error || '更新飞书日程失败' }, 500);
      } else {
        // 无日程 → 直连飞书建会议
        // 日程参与人：主/副面试官（解析到飞书 open_id 才邀请，失败不阻塞），
        // 使日程自带的「面试前 30 分钟提醒」能触达面试官（第二次提醒）。
        const attendeeNames = [...new Set(
          [String(interview.primary_interviewer || '').trim(), String(interview.secondary_interviewer || '').trim()].filter(Boolean),
        )];
        const attendeeOpenIds: string[] = [];
        for (const name of attendeeNames) {
          try {
            const openId = await resolveExactInterviewerOpenId(db, name);
            if (openId) attendeeOpenIds.push(openId);
          } catch (e: any) {
            console.warn(`[schedule-direct] 面试官 ${name} 参与人解析失败，跳过: ${e?.message || e}`);
          }
        }
        const event = await createInterviewCalendarEvent(c.env, {
          summary: `面试 - ${interview.candidate_name || '候选人'} - ${interview.position_applied || '应聘岗位'} - 第${interview.round || 1}轮`,
          description: `候选人：${interview.candidate_name || ''}\n应聘岗位：${interview.position_applied || ''}\n面试时间：${timeLabel}\n由 AI-Interview 安排面试流程自动创建。`,
          startTimestamp: startTs,
          endTimestamp: endTs,
          attendeeOpenIds,
        }, {}, FEISHU_CONFIG.appId);
        eventId = event.eventId;
        meetingLink = event.meetingUrl || '';
      }
    } else {
      // 线下面试：清空/保留会议链接语义——线下不保留历史会议链接
      meetingLink = '';
      eventId = '';
    }

    await db.prepare(
      'UPDATE interviews SET interview_time = ?, interview_type = ?, meeting_link = ?, feishu_event_id = ?, interview_location = ?, updated_at = ? WHERE id = ?',
    ).bind(timeLabel, interviewType, meetingLink, eventId, interviewLocation, now(), id).run();

    // 完整流程（异步）：提醒面试官（线上带会议链接/线下带地点）+ 发候选人邮件（线上带链接/线下不带）
    const currentUser = c.get('user') as { email?: string; full_name?: string } | undefined;
    const operatorName = currentUser?.full_name || currentUser?.email || '系统';
    c.executionCtx.waitUntil((async () => {
      try {
        const ctx = await loadInterviewStartContext(db, id);
        if (ctx) {
          const userToken = currentUser?.email ? await getValidUserAccessToken(c.env, currentUser.email) : null;
          const reminder = await sendInterviewerInterviewReminder(c.env, db, {
            interviewId: id,
            userToken: userToken || await getFeishuToken(c.env),
            operatorName,
            userEmail: currentUser?.email,
            meetingLink: isOffline ? null : meetingLink,
            interviewTypeLabel: isOffline ? '线下面试' : '线上面试',
          }, {
            now, uuid, hashPublicToken, getResumeFileBytes,
            getBotToken: getFeishuToken,
            refreshUserToken: async (email: string) => {
              const refreshed = await refreshUserAccessToken(c.env, email);
              return refreshed?.access_token || null;
            },
          });
          console.log(`[schedule-direct] 面试官提醒 ${reminder.ok ? '已发送' : '未发送: ' + reminder.reason}`);
          if (ctx.candidateEmail && (meetingLink || isOffline)) {
            const smtpRow = await db.prepare(
              'SELECT smtp_host, smtp_port, smtp_username, smtp_password, mail_from, mail_from_name, mail_enabled FROM system_configs ORDER BY updated_at DESC LIMIT 1',
            ).first() as any;
            if (isSmtpConfigured(smtpRow)) {
              const configRow = await db.prepare('SELECT mail_from_name FROM system_configs ORDER BY updated_at DESC LIMIT 1').first() as any;
              const result = await sendCandidateInterviewEmail(db, {
                ctx,
                meetingUrl: isOffline ? null : meetingLink,
                offline: isOffline,
                fromName: (configRow?.mail_from_name && String(configRow.mail_from_name).trim()) || '招聘系统',
                nowIso: now(),
              });
              console.log(`[schedule-direct] 候选人邮件 ${result.status}${result.status === 'sent' ? ` -> ${result.to}` : `: ${result.reason}`}`);
            }
          }
        }
      } catch (e: any) {
        console.error(`[schedule-direct] 后续流程异常: ${e?.message || e}`);
      }
    })());

    return c.json({ ok: true, interview_time: timeLabel, meeting_link: meetingLink, calendar_event_id: eventId });
  } catch (e: any) {
    console.error(`[schedule-direct] 直连安排日程失败: ${e?.message || e}`);
    return c.json({ detail: `直连安排日程失败: ${e?.message || e}` }, 500);
  }
});

// ---- 简历上传：上传 PDF → D1 存储 → 存 Bitable ----
app.post('/api/resumes', authMiddleware, async (c) => {
  const uploadStartedAt = Date.now();
  try {
    const formData = await c.req.formData();
    const file = formData.get('file') as File | null;
    let positionId = formData.get('position_id') as string;

    if (!file || !file.name) {
      return c.json({ detail: '请上传简历文件' }, 400);
    }
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      return c.json({ detail: '仅支持 PDF 格式' }, 400);
    }
    logResumeProcessing('upload.legacy.start', {
      fileNameLength: file.name.length,
      fileSize: file.size,
      positionId: positionId || undefined,
    });

    // Feature Flag: 开启 R2 直传时走新路径，替代 Base64 存 D1
    const r2UploadEnabled = (c.env.DIRECT_R2_UPLOAD || '').toLowerCase() === 'true';
    if (r2UploadEnabled && c.env.RESUME_ARTIFACTS) {
      const now = () => new Date().toISOString();
      const result = await handleR2Upload(c, formData, parsedCandidateName, parsedPositionName, positionId, now);
      return result;
    }


    const fileBuffer = await file.arrayBuffer();
    const fileSize = file.size;

    // 上传必须先可用：D1 UUID 是唯一事实来源；飞书回写由后台任务负责。
    // 不能以飞书网络成功作为简历入库的前置条件。
    const tableId = getBitableTableId(c.env, 'talent');
    const fields: Record<string, any> = {};

    // 从文件名智能提取姓名和岗位
    // 支持格式：【岗位_城市_薪资】姓名_年限.pdf  或  姓名_岗位_城市.pdf
    let parsedPositionName = '';
    let parsedCandidateName = '';
    const bracketMatch = file.name.match(/^【(.+?)】(.+?)\.pdf$/i);
    if (bracketMatch) {
      // 格式：【社群用户运营专员_杭州_6-8K】曹圣培_3年.pdf
      parsedPositionName = bracketMatch[1].split('_')[0] || '';
      parsedCandidateName = bracketMatch[2].split('_')[0] || '';
    } else {
      // 旧格式：姓名_岗位_城市.pdf（取前两个下划线分段）
      const parts = file.name.replace(/\.pdf$/i, '').split('_');
      if (parts.length >= 2) {
        parsedCandidateName = parts[0] || '';
        parsedPositionName = parts[1] || '';
      }
    }

    const displayName = parsedCandidateName || file.name.replace(/\.pdf$/i, '');
    const fileNameWithoutExt = file.name.replace(/\.pdf$/i, '');
    fields['姓名'] = displayName;

    // 如果有解析出的岗位名，直接写入
    if (parsedPositionName) {
      fields['招聘岗位匹配'] = parsedPositionName;
    }

    // 如果没有传入 position_id，但从文件名解析出了岗位名，尝试自动匹配
    if (!positionId && parsedPositionName) {
      try {
        const matchedPos = await c.env.DB.prepare(
          'SELECT id, title FROM positions WHERE title = ? LIMIT 1'
        ).bind(parsedPositionName).first<any>();
        if (matchedPos) {
          positionId = matchedPos.id;
          fields['面试岗位'] = matchedPos.title;
        }
      } catch {}
    }

    // 如果有 position_id，尝试匹配岗位
    if (positionId) {
      try {
        const origin = new URL(c.req.url).origin;
        const posResp = await fetch(
          `${origin}/api/positions/${positionId}`,
          { headers: { Authorization: c.req.header('Authorization') || '' } }
        );
        if (posResp.ok) {
          const posData: any = await posResp.json();
          if (posData?.title) {
            fields['面试岗位'] = posData.title;
          }
        }
      } catch {}
    }

    const recordId = crypto.randomUUID();

    // 文件哈希去重（外部调用方可传 file_sha256；本地上传缺失时由 Worker 计算）
    let fileSha256 = ((formData.get('file_sha256') as string) || '').trim().toLowerCase();
    if (!fileSha256) fileSha256 = await sha256Hex(fileBuffer);
    const ingestion = buildResumeIngestionIdentity({
      source: 'local_upload',
      receivedAt: now(),
      fileSha256,
    });
    if (fileSha256) {
      try {
        const existingByHash = await c.env.DB.prepare(
          'SELECT id, candidate_name FROM resumes WHERE file_sha256 = ? LIMIT 1'
        ).bind(fileSha256).first<any>();
        if (existingByHash) {
          logResumeProcessing('upload.legacy.dedup_hit', { existingId: existingByHash.id, fileSha256: fileSha256.substring(0, 16) });
          return c.json({
            id: existingByHash.id,
            candidate_name: existingByHash.candidate_name,
            dedup: true,
            detail: '文件已存在，返回已有记录',
          }, 200);
        }
      } catch (e) {
        logResumeProcessingError('upload.legacy.dedup_check_error', e, { fileSha256: fileSha256.substring(0, 16) });
      }
    }

    // 2. 保存 PDF：优先 KV（大文件），D1 只留元数据
    try {
      await storeResumeFile(c.env, recordId, file.name, fileSize, fileBuffer);
      logResumeProcessing('upload.legacy.file_saved', { resumeId: recordId, fileSize });
    } catch (e: any) {
      logResumeProcessingError('upload.legacy.file_save_error', e, { resumeId: recordId, fileSize });
      return c.json({ detail: '保存文件失败: ' + e.message }, 500);
    }

    // 埋点：简历/候选人创建
    await logOperation(c.env, {
      action: 'resume.create',
      entityType: 'resume',
      entityId: recordId,
      actor: c.get('user')?.email,
      detail: JSON.stringify({ file: file.name, size: fileSize, candidate: displayName }),
    });

    // 3. AI 解析简历（单阶段：前端 pdfjs-dist 提取纯文本 → AI 结构化提取字段）
    // 注意：deepseek-v4-flash 是文本模型，无法直接处理 PDF base64，
    // 所以必须由前端 pdfjs-dist 完成 PDF→文本 这一步。
    const frontendRawText = (formData.get('raw_text') as string) || '';
    const ocrPending = (formData.get('ocr_pending') as string) === 'true';
    let extractedText = frontendRawText || '';

    // —— 扫描件/OCR 模式：前端 pdfjs 抽不到文本，先建空记录返回 id，由前端走 MinerU 流程后回填 ——
    if (ocrPending && !extractedText) {
      try {
        await c.env.DB.prepare(
          'INSERT INTO resumes (id, candidate_name, position_applied, mapped_position, parsed_data, raw_text, parse_status, ocr_status, file_sha256, resume_received_at, resume_source, resume_source_record_id, resume_ingest_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(
          recordId,
          displayName,
          parsedPositionName || '',
          parsedPositionName || '',
          JSON.stringify({ name: displayName }),
          '',
          'ocr_processing',
          'ocr_processing',
          fileSha256 || null,
          ingestion.receivedAt,
          ingestion.source,
          ingestion.sourceRecordId,
          ingestion.ingestKey,
          now()
        ).run();
      } catch (dbErr: any) {
        logResumeProcessingError('upload.legacy.ocr_pending_db_error', dbErr, { resumeId: recordId });
      }
      const job = await createOrGetActiveJob(c.env.DB, recordId);
      logResumeProcessing('upload.legacy.queue_send.start', { resumeId: recordId, jobId: job.id, ocrPending: true });
      await c.env.RESUME_PROCESSING_QUEUE.send({ jobId: job.id, resumeId: recordId });
      logResumeProcessing('upload.legacy.queue_send.ok', { resumeId: recordId, jobId: job.id, totalDurationMs: Date.now() - uploadStartedAt });
      return c.json({
        id: recordId,
        job_id: job.id,
        candidate_name: displayName,
        status: 'queued',
        parse_status: 'queued',
        detail: '扫描简历已入队，正在后台 OCR 解析...',
      }, 202);
    }
    let parsedName = fileNameWithoutExt;
    let parsedGender = '';
    let parsedAge: number | null = null;
    let parsedEducation = '';
    let parsedSchool = '';
    let parsedMajor = '';
    let parsedCity = '';
    let parsedAdvantage = '';
    let parsedRisk = '';
    let parsedEval = '';
    let parsedPhone = '';
    let parsedEmail = '';
    let parsedSkills: string[] = [];
    let parsedWorkYears: number | null = null;
    let parsedRecentCompany = '';
    let parsedCurrentPosition = '';
    let parsedExperience: string = '';
    let aiParseFailed = false;

    // === 保存前端文本到 raw_text（异步初筛需要） ===
    if (extractedText && extractedText.length > 20) {
      try {
        await c.env.DB.prepare('UPDATE resumes SET raw_text = ?, updated_at = ? WHERE id = ?')
          .bind(extractedText.substring(0, 200000), now(), recordId).run();
      } catch {}
    }

    // === 写 D1 resumes 表（立即完成，不阻塞） ===
    // === 解析 positionId（可能是 UUID 或名字）为岗位名 ===
    let resolvedPositionName = parsedPositionName || '';
    if (positionId) {
      // 先查 positions 表（UUID → title）
      try {
        const pos = await c.env.DB.prepare('SELECT title FROM positions WHERE id = ?').bind(positionId).first() as any;
        if (pos?.title) resolvedPositionName = pos.title;
      } catch {}
      // 如果没查到，再看是否是名字本身（不是 UUID 格式）
      if (!resolvedPositionName && !/^[0-9a-f]{8}-/.test(positionId)) {
        resolvedPositionName = positionId;
      }
    }

    const mappedPos = resolvedPositionName || parsedPositionName || '';
    try {
      const existing = await c.env.DB.prepare('SELECT id FROM resumes WHERE id = ?').bind(recordId).first();
      if (existing) {
        await c.env.DB.prepare(
          'UPDATE resumes SET candidate_name=?, position_applied=?, mapped_position=?, raw_text=?, parse_status=?, resume_received_at=COALESCE(NULLIF(resume_received_at, \'\'), ?), resume_source=COALESCE(NULLIF(resume_source, \'\'), ?), resume_source_record_id=COALESCE(NULLIF(resume_source_record_id, \'\'), ?), resume_ingest_key=COALESCE(NULLIF(resume_ingest_key, \'\'), ?), updated_at=? WHERE id=?'
        ).bind(displayName, mappedPos, mappedPos, extractedText?.substring(0, 200000) || '', 'pending_screening', ingestion.receivedAt, ingestion.source, ingestion.sourceRecordId, ingestion.ingestKey, now(), recordId).run();
      } else {
        await c.env.DB.prepare(
          'INSERT INTO resumes (id, candidate_name, position_applied, mapped_position, parsed_data, raw_text, parse_status, file_sha256, resume_received_at, resume_source, resume_source_record_id, resume_ingest_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(recordId, displayName, mappedPos, mappedPos, JSON.stringify({ name: displayName }), extractedText?.substring(0, 200000) || '', 'pending_screening', fileSha256 || null, ingestion.receivedAt, ingestion.source, ingestion.sourceRecordId, ingestion.ingestKey, now()).run();
      }
    } catch (dbErr: any) {
      logResumeProcessingError('upload.legacy.db_error', dbErr, { resumeId: recordId });
    }

    // 后台队列是 AI/OCR 的唯一执行入口。前端关闭、刷新或网络波动都不会中断。
    const job = await createOrGetActiveJob(c.env.DB, recordId);
    logResumeProcessing('upload.legacy.queue_send.start', { resumeId: recordId, jobId: job.id, ocrPending: false });
    await c.env.RESUME_PROCESSING_QUEUE.send({ jobId: job.id, resumeId: recordId });
    logResumeProcessing('upload.legacy.queue_send.ok', { resumeId: recordId, jobId: job.id, totalDurationMs: Date.now() - uploadStartedAt });
    return c.json({
      id: recordId,
      job_id: job.id,
      candidate_name: displayName,
      parse_status: 'queued',
      detail: '简历已入队，正在后台处理',
    }, 202);

    // === 旧的同步 AI 初筛路径（不可达，待后续移除）===
    try {
      const resume = await c.env.DB.prepare('SELECT * FROM resumes WHERE id = ?').bind(recordId).first() as any;
      if (resume) {
        const { text: resumeText } = await getResumeTextForScreening(c.env, resume);
        if (resumeText && resumeText.length >= 20) {
          const posName = resume.position_applied || resume.mapped_position || positionId || parsedPositionName || '';
          const posCtx = await getPositionContext(c.env.DB, posName);
          const screenPrompt = await getAIPrompt(c.env, 'resume_screening', {
            system: `你是一位资深的 HR 招聘评估 AI。${WEIGHTED_SCREENING_PROMPT}`,
            user: '岗位：{position}\n能力维度：{capability_dimensions}\n简历：{resume_text}\n字段：{fields}'
          });
          const screenUserText = screenPrompt.user
            .replace('{position}', posCtx.standardPosition || posName)
            .replace('{capability_dimensions}', posCtx.capabilityDimensions || '')
            .replace('{resume_text}', resumeText)
            .replace('{fields}', '{}');
          const prompt = { system: screenPrompt.system, user: screenUserText };
          const aiResp = await callAI(c.env, prompt.system, prompt.user);
          if (aiResp) {
            let parsed: any;
            try { parsed = extractJSON(aiResp); } catch { parsed = { summary: aiResp }; }
            const evaluation = enrichScreeningEvaluation(parsed, [], [], {});
            const matchScore = evaluation.weighted_score;
            const screeningResult = evaluation.screening_result;
            const aiEvalObj: any = { ...evaluation, match_score: matchScore };
            const aiReview = JSON.stringify({ ...evaluation, match_score: matchScore, strengths: parsed.strengths || [], risks: parsed.risks || [], suggested_questions: parsed.suggested_questions || [] });
            await c.env.DB.prepare('UPDATE resumes SET ai_review=?, ai_evaluation=?, match_score=?, screening_result=?, parse_status=?, updated_at=? WHERE id=?')
              .bind(aiReview, JSON.stringify(aiEvalObj), matchScore, screeningResult, 'ai_screened', now(), recordId).run();
            try {
              await bitableUpdateRecord(c.env, tableId, recordId, {
                'AI简历评估': JSON.stringify(aiEvalObj),
                'AI简历初筛结果': screeningResult,
                '优势分析': (parsed.strengths || []).join('\n'),
                '风险点': (parsed.risks || []).join('\n'),
              });
            } catch {}
          }
        }
      }
    } catch (screeningErr: any) {
      console.error('[Upload] AI 初筛失败:', screeningErr.message);
      // 初筛失败不影响返回，状态保持 pending_screening
    }

    // === 返回结果（含 AI 初筛结果）===
    const record = await bitableGetRecord(c.env, tableId, recordId);
    if (record) return c.json(parseTalentRecord(record));
    return c.json({ id: recordId, candidate_name: displayName, status: 'uploaded', parse_status: 'pending_screening', detail: '简历已上传，AI 初筛完成' });

  } catch (e: any) {
    logResumeProcessingError('upload.legacy.error', e, { totalDurationMs: Date.now() - uploadStartedAt });
    return c.json({ detail: '上传简历失败: ' + e.message }, 500);
  }
});

// ==================== 对外简历上传接口（供外部系统调用，走与手动上传一致的异步处理链路）====================
// 认证：x-api-key: <RESUME_UPLOAD_API_KEY>（推荐），也兼容现有 Bearer JWT。
// 请求（multipart/form-data）：
//   file            必填，PDF 简历文件
//   position_applied 可选，岗位名（不传则尝试从文件名解析）
//   candidate_name   可选，候选人姓名（不传则尝试从文件名解析）
//   raw_text         可选，调用方已提取的简历文本（提供后跳过 MinerU OCR）
//   source           可选，来源标识（默认 external）
// 处理：保存文件 → 建 D1 记录 → 入队（OCR/字段提取/AI 初筛由后台消费者完成）→ 返回 202
app.post('/api/resumes/external', async (c) => {
  // —— 认证：x-api-key 或 Bearer JWT ——
  let actor = 'external-api';
  const apiKey = c.req.header('x-api-key') || '';
  const auth = c.req.header('Authorization') || '';
  const authMatch = auth.match(/^Bearer\s+(.+)$/i);
  if (apiKey && c.env.RESUME_UPLOAD_API_KEY && apiKey === c.env.RESUME_UPLOAD_API_KEY) {
    // 有效 API Key
  } else if (authMatch) {
    const payload = await verifyJwt(c.env.SECRET_KEY, authMatch[1]);
    if (!payload) return c.json({ detail: 'Invalid token' }, 401);
    const user = await getUser(c.env.DB, payload.sub);
    if (!user || !user.is_active) return c.json({ detail: 'Not authorized' }, 401);
    actor = user.email;
  } else {
    return c.json({ detail: 'Missing API key or token' }, 401);
  }

  try {
    const formData = await c.req.formData();
    const file = formData.get('file') as File | null;
    const positionApplied = (formData.get('position_applied') as string) || '';
    const candidateName = (formData.get('candidate_name') as string) || '';
    const rawText = (formData.get('raw_text') as string) || '';
    const source = (formData.get('source') as string) || 'external';
    const sourceRecordId = (formData.get('source_record_id') as string) || '';

    if (!file || !file.name) {
      return c.json({ detail: '请上传简历文件（file 字段）' }, 400);
    }
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      return c.json({ detail: '仅支持 PDF 格式' }, 400);
    }

    const fileBuffer = await file.arrayBuffer();
    const recordId = crypto.randomUUID();
    const fileSha256 = ((formData.get('file_sha256') as string) || '').trim().toLowerCase() || await sha256Hex(fileBuffer);
    const ingestion = buildResumeIngestionIdentity({
      source: 'external_api',
      sourceRecordId,
      fileSha256,
      receivedAt: now(),
    });

    const existingByIngestion = await c.env.DB.prepare(
      'SELECT id, candidate_name FROM resumes WHERE file_sha256 = ? OR resume_ingest_key = ? LIMIT 1'
    ).bind(fileSha256, ingestion.ingestKey).first<any>().catch(() => null);
    if (existingByIngestion) {
      return c.json({
        id: existingByIngestion.id,
        candidate_name: existingByIngestion.candidate_name,
        dedup: true,
        detail: '简历已接收，返回已有记录',
      }, 200);
    }

    // 从文件名解析姓名和岗位（与手动上传一致）
    let parsedPositionName = '';
    let parsedCandidateName = '';
    const bracketMatch = file.name.match(/^【(.+?)】(.+?)\.pdf$/i);
    if (bracketMatch) {
      parsedPositionName = bracketMatch[1].split('_')[0] || '';
      parsedCandidateName = bracketMatch[2].split('_')[0] || '';
    } else {
      const parts = file.name.replace(/\.pdf$/i, '').split('_');
      if (parts.length >= 2) {
        parsedCandidateName = parts[0] || '';
        parsedPositionName = parts[1] || '';
      }
    }

    const displayName = candidateName || parsedCandidateName || file.name.replace(/\.pdf$/i, '');
    const positionName = positionApplied || parsedPositionName || '';

    // 保存 PDF：优先 KV（大文件），D1 只留元数据
    try {
      await storeResumeFile(c.env, recordId, file.name, file.size, fileBuffer);
    } catch (e: any) {
      return c.json({ detail: '保存文件失败: ' + e.message }, 500);
    }

    // 建简历记录（有 raw_text 则直接可用，否则等后台 OCR）
    const hasRawText = rawText && rawText.trim().length >= 20;
    let ocrMarkdown = '';
    // 如果没有 raw_text，由 Pages Worker 直接调用 MinerU OCR（消费者 Worker 的 OCR 链路不可靠）
    if (!hasRawText) {
      try {
        const mineruBase = (c.env.MINERU_BASE || 'https://mineru.net').replace(/\/+$/, '');
        // ① 获取签名上传 URL
        const signResp = await fetch(`${mineruBase}/api/v1/agent/parse/file`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            file_name: `${recordId}.pdf`,
            language: 'ch',
            is_ocr: true,
            enable_table: true,
            enable_formula: false,
          }),
        });
        const signData: any = await signResp.json().catch(() => ({}));
        const taskId = signData?.data?.task_id;
        const uploadUrl = signData?.data?.file_url;
        if (taskId && uploadUrl) {
          // ② 上传文件到 MinerU
          const binary = new Uint8Array(fileBuffer);
          await fetch(uploadUrl, { method: 'PUT', body: binary });
          // ③ 轮询 MinerU 结果（最多等 60 秒）
          for (let i = 0; i < 12; i++) {
            await new Promise((r) => setTimeout(r, 5000));
            const statusResp = await fetch(`${mineruBase}/api/v1/agent/parse/${taskId}`);
            const statusData: any = await statusResp.json().catch(() => ({}));
            const state = statusData?.data?.state;
            if (state === 'done') {
              const mdUrl = statusData.data.markdown_url;
              if (mdUrl) {
                const mdResp = await fetch(mdUrl);
                if (mdResp.ok) ocrMarkdown = await mdResp.text();
              }
              break;
            }
            if (state === 'failed') break;
          }
          // 即使 OCR 没完成，简历也先入队（消费者会重试处理）
        }
      } catch (e) {
        console.error('[ExternalUpload] OCR 失败（不影响入队）:', e);
      }
    }
    try {
      await c.env.DB.prepare(
        'INSERT INTO resumes (id, candidate_name, position_applied, mapped_position, parsed_data, raw_text, ocr_markdown, parse_status, ocr_status, status, file_sha256, resume_received_at, resume_source, resume_source_record_id, resume_ingest_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(
        recordId,
        displayName,
        positionName,
        positionName,
        JSON.stringify({ name: displayName, source }),
        hasRawText ? rawText.substring(0, 200000) : (ocrMarkdown || ''),
        ocrMarkdown || '',
        (hasRawText || ocrMarkdown) ? 'pending_screening' : 'ocr_processing',
        (hasRawText || ocrMarkdown) ? 'none' : 'ocr_processing',
        'pending_screening',
        fileSha256,
        ingestion.receivedAt,
        ingestion.source,
        ingestion.sourceRecordId,
        ingestion.ingestKey,
        now(),
        now()
      ).run();
    } catch (dbErr: any) {
      console.error('[ExternalUpload] D1 写入失败:', dbErr.message);
      return c.json({ detail: '创建简历记录失败: ' + dbErr.message }, 500);
    }

    // 埋点
    await logOperation(c.env, {
      action: 'resume.create',
      entityType: 'resume',
      entityId: recordId,
      actor,
      detail: JSON.stringify({ file: file.name, size: file.size, candidate: displayName, source: 'external-api:' + source }),
    });

    // 入队：后台消费者负责 OCR（如需）→ 字段提取 → AI 初筛 → 更新 D1（前端列表自动可见）
    const job = await createOrGetActiveJob(c.env.DB, recordId);
    await c.env.RESUME_PROCESSING_QUEUE.send({ jobId: job.id, resumeId: recordId });

    return c.json({
      id: recordId,
      job_id: job.id,
      candidate_name: displayName,
      position_applied: positionName,
      status: 'queued',
      parse_status: hasRawText ? 'queued' : 'ocr_queued',
      detail: '简历已接收，正在后台解析（字段提取 + AI 初筛）...',
    }, 202);
  } catch (e: any) {
    return c.json({ detail: '上传简历失败: ' + e.message }, 500);
  }
});

// ==================== MinerU 文档解析代理（Agent 轻量 API，免登录）====================
// 背景：扫描件/图片型简历用 pdfjs 抽不到文本，需经 MinerU 转成 Markdown 后再走现有 callAI 结构化抽取。
// 模式：前端签名上传（文件不经过 D1，避免 Pages 无 R2 的限制）。
//   sign  → 代理 POST /api/v1/agent/parse/file 拿 task_id + file_url
//   status→ 代理 GET  /api/v1/agent/parse/{task_id}，done 时下载 markdown_url 返回文本
//   ocr-parse → 收 markdown，写入 ocr_markdown 并复用现有 callAI 结构化抽取落库
const MINERU_BASE = (c?: any) => ((c?.env?.MINERU_BASE as string) || 'https://mineru.net');

// ① 获取 MinerU 签名上传 URL（前端再 PUT 直传文件）
app.post('/api/mineru/sign', authMiddleware, async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const fileName: string = body.file_name || '';
    const isOcr: boolean = !!body.is_ocr;
    if (!fileName) return c.json({ detail: 'file_name 必填' }, 400);
    const resp = await fetch(`${MINERU_BASE(c)}/api/v1/agent/parse/file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file_name: fileName,
        language: 'ch',
        enable_table: true,
        is_ocr: isOcr,
        enable_formula: false,
      }),
    });
    const data: any = await resp.json().catch(() => ({}));
    if (data?.code !== 0 || !data?.data?.task_id) {
      // -30001 超10MB / -30002 类型 / -30003 超20页 / -30004 参数
      const errCode = data?.data?.err_code ?? data?.code;
      const retry = false;
      return c.json({ detail: data?.msg || 'MinerU 签名失败', err_code: errCode, retry }, 502);
    }
    return c.json({ task_id: data.data.task_id, file_url: data.data.file_url });
  } catch (e: any) {
    return c.json({ detail: 'MinerU sign 失败: ' + e.message, retry: true }, 502);
  }
});

// ② 轮询 MinerU 解析状态；done 时下载 markdown 返回文本
app.get('/api/mineru/status/:task_id', authMiddleware, async (c) => {
  const taskId = c.req.param('task_id');
  try {
    const resp = await fetch(`${MINERU_BASE(c)}/api/v1/agent/parse/${taskId}`, { method: 'GET' });
    const data: any = await resp.json().catch(() => ({}));
    const state = data?.data?.state;
    if (state === 'done') {
      const mdUrl = data.data.markdown_url;
      if (!mdUrl) return c.json({ status: 'failed', detail: '缺少 markdown_url' }, 502);
      const mdResp = await fetch(mdUrl);
      const md = await mdResp.text();
      return c.json({ status: 'done', markdown: md, task_id: taskId });
    }
    if (state === 'failed') {
      return c.json({ status: 'failed', detail: data?.data?.err_msg || '解析失败', err_code: data?.data?.err_code }, 200);
    }
    return c.json({ status: 'processing', state, task_id: taskId });
  } catch (e: any) {
    return c.json({ status: 'failed', detail: 'MinerU 状态查询失败: ' + e.message, retry: true }, 502);
  }
});

// ③ 接收前端回传的 markdown，写库并触发结构化抽取（复用上传路径的 callAI 逻辑）
app.post('/api/resumes/:id/ocr-parse', authMiddleware, async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const markdown: string = (body.markdown || '').toString();
  const resume = await c.env.DB.prepare('SELECT * FROM resumes WHERE id = ?').bind(id).first() as any;
  if (!resume) return c.json({ detail: 'Resume not found' }, 404);
  if (!markdown || markdown.length < 20) return c.json({ detail: 'markdown 内容过短，无法解析' }, 400);

  // 写回 ocr 原文
  try {
    await c.env.DB.prepare('UPDATE resumes SET ocr_markdown=?, ocr_status=?, updated_at=? WHERE id=?')
      .bind(markdown.substring(0, 200000), 'ocr_done', now(), id).run();
  } catch {}

  // 复用上传路径的解析 prompt + callAI 结构化抽取
  let parsedName = resume.candidate_name || '';
  let parsedGender = '';
  let parsedAge: number | null = null;
  let parsedEducation = '';
  let parsedSchool = '';
  let parsedMajor = '';
  let parsedCity = '';
  let parsedAdvantage = '';
  let parsedRisk = '';
  let parsedEval = '';
  let parsedPhone = '';
  let parsedEmail = '';
  let parsedSkills: string[] = [];
  let parsedWorkYears: number | null = null;
  let parsedRecentCompany = '';
  let parsedCurrentPosition = '';
  let parsedExperience = '';
  let parsedBirthday = '';
  let parsedWorkExpArr: any[] = [];
  let parsedEduArr: any[] = [];
  let parsedCerts: string[] = [];
  let parsedSelfEval = '';
  let aiParseFailed = false;

  try {
    const customPrompt = await getCustomPrompt(c.env, 'parse_resume_pdf');
    let systemPrompt: string, userPrompt: string;
    if (customPrompt?.system && customPrompt?.user) {
      let sp = customPrompt.system, up = customPrompt.user;
      if (sp.includes('{candidate_name}')) sp = sp.replace(/\{candidate_name\}/g, parsedName);
      if (up.includes('{candidate_name}')) up = up.replace(/\{candidate_name\}/g, parsedName);
      if (up.includes('{resume_text}')) up = up.replace(/\{resume_text\}/g, markdown);
      systemPrompt = sp; userPrompt = up;
    } else {
      // 默认 prompt：在原有字段基础上扩展 TalentFlow 式数组维度
      systemPrompt = `你是一个专业的简历解析助手。请从简历文本（可能来自 OCR/文档解析的 Markdown）中提取以下所有信息，并用JSON格式返回（不要加markdown代码块）。找不到的字段设为null或空字符串/空数组。

{
  "name": "候选人姓名",
  "gender": "性别（男/女）",
  "age": 年龄数字或null,
  "birthday": "出生年月（如 1990-01，推断不出可null）",
  "phone": "手机号码",
  "email": "电子邮箱",
  "highest_degree": "最高学历（如：本科/硕士/博士）",
  "school": "毕业院校",
  "major": "专业",
  "city": "所在城市",
  "years_of_experience": "工作年限（数字）",
  "skills": ["技能1", "技能2", "..."],
  "recent_company": "目前/最近所在公司",
  "current_position": "目前/最近职位",
  "work_experience": [{"company":"","title":"","start":"","end":"","duration":"","description":"","achievements":""}],
  "education": [{"school":"","degree":"","major":"","start":"","end":""}],
  "certifications": ["证书/资质1", "证书/资质2"],
  "self_evaluation": "候选人自我介绍/自我评价摘要",
  "work_experience_summary": "工作经历摘要（200字以内）",
  "advantage": "候选人核心优势分析（3-5个优势，200字以内）",
  "risk": "候选人潜在风险点（200字以内）",
  "evaluation": "综合评估（100字以内）"
}`;
      userPrompt = `以下是一份简历的文本内容，请从中提取所有字段信息：\n\n${markdown}`;
    }
    const aiResp = await callAI(c.env, systemPrompt, userPrompt);
    if (aiResp) {
      const parsed: any = JSON.parse(extractJSON(aiResp) || '{}');
      parsedName = parsed.name || parsedName;
      parsedGender = parsed.gender || '';
      parsedAge = parsed.age || null;
      parsedBirthday = parsed.birthday || '';
      parsedEducation = parsed.highest_degree || parsed.education || '';
      parsedSchool = parsed.school || '';
      parsedMajor = parsed.major || '';
      parsedCity = parsed.city || '';
      parsedAdvantage = parsed.advantage || '';
      parsedRisk = parsed.risk || '';
      parsedEval = parsed.evaluation || '';
      parsedPhone = parsed.phone || '';
      parsedEmail = parsed.email || '';
      parsedSkills = Array.isArray(parsed.skills) ? parsed.skills : [];
      parsedWorkYears = parsed.years_of_experience || parsed.work_years || null;
      parsedExperience = parsed.work_experience_summary || '';
      parsedRecentCompany = parsed.recent_company || parsed.current_company || '';
      parsedCurrentPosition = parsed.current_position || '';
      parsedWorkExpArr = Array.isArray(parsed.work_experience) ? parsed.work_experience : [];
      parsedEduArr = Array.isArray(parsed.education) ? parsed.education : [];
      parsedCerts = Array.isArray(parsed.certifications) ? parsed.certifications : [];
      parsedSelfEval = parsed.self_evaluation || '';
    }
  } catch (aiErr: any) {
    aiParseFailed = true;
    console.error(`[OCR-Parse] AI parsing failed: ${aiErr.message}`);
  }

  // 写 D1 parsed_data（标准字段集 + 扩展数组）
  try {
    const parsedData = JSON.stringify({
      name: parsedName,
      gender: parsedGender,
      age: parsedAge,
      birthday: parsedBirthday,
      highest_degree: parsedEducation,
      school: parsedSchool,
      major: parsedMajor,
      city: parsedCity,
      phone: parsedPhone,
      email: parsedEmail,
      skills: parsedSkills,
      years_of_experience: parsedWorkYears,
      recent_company: parsedRecentCompany,
      current_position: parsedCurrentPosition,
      position_applied: resume.position_applied || '',
      advantage: parsedAdvantage,
      risk: parsedRisk,
      evaluation: parsedEval,
      work_experience: parsedWorkExpArr,
      education: parsedEduArr,
      certifications: parsedCerts,
      self_evaluation: parsedSelfEval,
    });
    await c.env.DB.prepare(
      'UPDATE resumes SET parsed_data=?, raw_text=?, resume_markdown=?, gender=?, birthday=?, work_experience=?, education=?, certifications=?, self_evaluation=?, parse_status=?, updated_at=? WHERE id=?'
    ).bind(
      parsedData,
      markdown.substring(0, 200000),
      markdown.substring(0, 200000),
      parsedGender || null,
      parsedBirthday || null,
      JSON.stringify(parsedWorkExpArr),
      JSON.stringify(parsedEduArr),
      JSON.stringify(parsedCerts),
      parsedSelfEval || null,
      aiParseFailed ? 'needs_manual' : 'ocr_done',
      now(),
      id
    ).run();
  } catch (dbErr: any) {
    console.error('[OCR-Parse] D1 写入失败:', dbErr.message);
  }

  // 同步写回飞书（复用上传路径的字段映射，含扩展字段）
  try {
    const tableId = getBitableTableId(c.env, 'talent');
    const updateFields: Record<string, any> = {};
    if (parsedName) updateFields['姓名'] = parsedName;
    if (parsedGender) updateFields['性别'] = parsedGender;
    if (parsedAge) updateFields['年龄'] = parsedAge;
    if (parsedEducation) updateFields['学历'] = parsedEducation;
    if (parsedCity) updateFields['城市'] = parsedCity;
    if (parsedAdvantage) updateFields['优势分析'] = parsedAdvantage;
    if (parsedRisk) updateFields['风险点'] = parsedRisk;
    if (parsedPhone) updateFields['手机'] = parsedPhone;
    if (parsedEmail) updateFields['邮箱'] = parsedEmail;
    if (parsedWorkYears) updateFields['工作年限'] = parsedWorkYears;
    if (parsedSkills.length) updateFields['技能'] = parsedSkills.join(', ');
    if (parsedExperience) updateFields['工作经历'] = parsedExperience;
    if (resume.position_applied) updateFields['面试岗位'] = resume.position_applied;
    if (parsedRecentCompany) updateFields['最近公司'] = parsedRecentCompany;
    if (parsedCurrentPosition) updateFields['最近职位'] = parsedCurrentPosition;
    if (parsedSelfEval) updateFields['自我评价'] = parsedSelfEval;
    const evalSummary = [parsedEval || '', parsedAdvantage ? `\n优势:\n${parsedAdvantage}` : '', parsedRisk ? `\n风险:\n${parsedRisk}` : ''].filter(Boolean).join('\n');
    if (evalSummary) updateFields['AI简历评估'] = evalSummary;
    await bitableUpdateRecord(c.env, tableId, id, updateFields);
  } catch (e: any) {
    console.error(`[OCR-Parse] 同步到飞书失败: ${e.message}`);
  }

  return c.json({ detail: 'OCR parse completed', id, parse_status: aiParseFailed ? 'needs_manual' : 'ocr_done' });
});

function ageFromBirthday(value: unknown): number | undefined {
  if (!value) return undefined;
  const birth = new Date(String(value));
  if (Number.isNaN(birth.getTime())) return undefined;
  return Math.floor((Date.now() - birth.getTime()) / (365.25 * 24 * 3600 * 1000));
}

function applyParsedResumeFields(item: Record<string, any>): void {
  if (!item.parsed_data || typeof item.parsed_data !== 'object') return;
  const fields = normalizeResumeFields(item.parsed_data);
  item.parsed_data = fields;
  if (fields.age) item.age = fields.age;
  else if (!item.age) item.age = ageFromBirthday(fields.birthday);
  if (fields.gender && !item.gender) item.gender = fields.gender;
  if (fields.highest_degree && !item.education) item.education = fields.highest_degree;
  if (fields.school) item.school = fields.school;
  if (fields.major) item.major = fields.major;
  if (fields.phone && !item.phone) item.phone = fields.phone;
  if (fields.skills) item.skills = fields.skills;
  if (fields.years_of_experience) item.work_years = fields.years_of_experience;
}

// 将 resumes 表一行转为前端卡片字段（列表路由与自定义筛选共用，保证两种场景卡片一致）
function serializeResumeCardRow(r: any): any {
  const item: any = exposeBusinessScreeningState({ ...r });
  // 字段别名映射（前端期望的字段名）
  if (r.contact) item.phone = r.contact; // contact → phone
  if (r.birthday) { // birthday → age
    try { const b = new Date(r.birthday); const diff = Date.now() - b.getTime(); item.age = Math.floor(diff / (365.25 * 24 * 3600 * 1000)); } catch {}
  }
  if (r.ai_review) { try { item.ai_review = JSON.parse(r.ai_review); } catch { item.ai_review = r.ai_review; } }
  exposeStructuredEvaluation(item);
  if (r.parsed_data) { try { item.parsed_data = JSON.parse(r.parsed_data); } catch {} }
  if (r.capability_scores) { try { item.capability_scores = JSON.parse(r.capability_scores); } catch {} }
  if (r.hard_requirement_result) { try { item.hard_requirement_result = JSON.parse(r.hard_requirement_result); } catch {} }
  if (item.screening_result || r.screening_result) {
    const sr = item.screening_result || r.screening_result;
    item.screening_result = normalizeAiScreeningResult(sr);
    item.screening_label = item.screening_result;
  }
  // 从 parsed_data 提取前端需要的字段
  applyParsedResumeFields(item);
  return item;
}

// ==================== 自定义筛选：岗位文本全文匹配 + 符合程度 ====================

// 默认打分提示词（可在系统设置「提示词模板」按 resume_custom_screen 覆盖）
const DEFAULT_CUSTOM_SCREEN_PROMPT = {
  system: '你是资深招聘筛选助手，只返回 JSON，禁止输出 JSON 之外的任何文字或代码块。根据给定的筛选条件逐份评估简历的符合程度，输出 JSON 数组（必须数组，不要单个对象），数组元素为 {"id":"简历id","score":0到100的整数,"reason":"中文依据一句话，20字以内"}。未提及该条件的简历 score 给低分。',
  user: '岗位：{position}\n筛选条件：{condition}\n\n简历列表（每份以 #id 开头）：\n{resumes}\n\n请对列表中的每一份简历各输出一条评分项，返回 JSON 数组。',
};

// 把条件分词：英文/数字词块 + 中文双字滑窗 bigram
function tokenizeCondition(condition: string): string[] {
  const tokens = new Set<string>();
  const trimmed = condition.trim().toLowerCase();
  if (!trimmed) return [];
  for (const m of trimmed.match(/[a-z0-9][a-z0-9._-]*/g) || []) tokens.add(m);
  const cjk = trimmed.replace(/[a-z0-9][a-z0-9._-]*/g, ' ').replace(/[^一-鿿]/g, '');
  for (const run of cjk.match(/[一-鿿]+/g) || []) {
    if (run.length === 1) { tokens.add(run); continue; }
    for (let i = 0; i < run.length - 1; i++) tokens.add(run.slice(i, i + 2));
  }
  return [...tokens];
}

// 把 AI 解析的结构化字段转成标签化可读文本（简历详情页 Descriptions 同源信息）。
// 相比 raw JSON，清晰标注的「证书/资质」「工作经历」等让自定义筛选 AI 打分更易命中资格证据。
function buildStructuredResumeText(p: any): string {
  if (!p || typeof p !== 'object') return '';
  const lines: string[] = [];
  const scalar = (label: string, v: unknown) => {
    const s = String(v ?? '').trim();
    if (s && s !== 'null' && s !== 'undefined') lines.push(`${label}：${s}`);
  };
  const list = (label: string, v: unknown, fmt: (item: any) => string) => {
    const arr = Array.isArray(v) ? v : (typeof v === 'string' && v.trim() ? [v] : []);
    const items = arr.map(fmt).filter((s) => String(s).trim());
    if (items.length) lines.push(`${label}：${items.join('；')}`);
  };
  scalar('学历', p.highest_degree);
  scalar('毕业院校', p.school);
  scalar('专业', p.major);
  scalar('工作年限', p.years_of_experience);
  scalar('最近公司', p.recent_company);
  scalar('性别', p.gender);
  scalar('出生年月', p.birthday);
  scalar('当前职位', p.current_position);
  scalar('电话', p.phone);
  scalar('自我评价', p.self_evaluation);
  list('技能', p.skills, (i) => String(i).trim());
  list('证书/资质', p.certifications, (i) => String(i).trim());
  list('工作经历', p.work_experience, (w) => {
    const head = [w?.company, w?.title, w?.duration || (w?.start && w?.end ? `${w.start}~${w.end}` : '')]
      .filter((s) => String(s || '').trim()).join('·');
    const desc = String(w?.description || '').trim();
    return head + (desc ? `：${desc}` : '');
  });
  list('教育经历', p.education, (e) => [e?.school, e?.degree, e?.major, e?.start && e?.end ? `${e.start}~${e.end}` : '']
    .filter((s) => String(s || '').trim()).join('·'));
  return lines.join('\n');
}

// 自定义筛选依据：只用 AI 解析的结构化摘要（简历详情页 Descriptions 同源信息，含证书/资质/工作经历等）。
// 无 parsed_data 或解析失败时回退原文全文，保证仍有筛选依据；hasSummary 标记供缺摘要简历即时补解析。
function buildCustomScreenResumeText(r: any): { text: string; hasSummary: boolean } {
  if (r.parsed_data) {
    try {
      const parsed = typeof r.parsed_data === 'string' ? JSON.parse(r.parsed_data) : r.parsed_data;
      const structured = buildStructuredResumeText(parsed);
      if (structured) return { text: `【AI 解析摘要】\n${structured}`, hasSummary: true };
    } catch {}
  }
  return { text: buildResumeFullText(r), hasSummary: false };
}

// 纯原文文本（不含 AI 摘要），供缺摘要简历补解析用。
function buildResumeRawText(r: any): string {
  return [r.ocr_markdown, r.raw_text, r.resume_markdown].filter(Boolean).join('\n');
}

// 用原始文本对缺结构化摘要的简历补解析，生成覆盖详情页 Descriptions 的完整字段（含证书/资质、工作经历、
// 教育经历），合并写回 parsed_data，返回新摘要文本；失败返回空串，调用方保持原文本兜底。
async function tryParseResumeStructuredFields(env: any, row: any, text: string): Promise<string> {
  try {
    const sys = `你是一个简历解析助手。请从简历文本中提取以下字段，用 JSON 返回。找不到的字段设为空字符串或空数组。只返回 JSON，不要输出任何其他文字。

{
  "highest_degree": "最高学历，如 大专/本科/硕士/博士",
  "school": "毕业院校全称",
  "major": "专业全称",
  "years_of_experience": "工作年限（数字）",
  "recent_company": "最近任职公司",
  "current_position": "最近职位",
  "gender": "性别",
  "birthday": "出生年月",
  "phone": "手机号",
  "skills": ["技能1", "技能2"],
  "certifications": ["证书/资格证/执业证，如 护士执业证书、护士资格证"],
  "self_evaluation": "自我评价原文",
  "work_experience": [{"company":"公司","title":"职位","duration":"起止时间","description":"职责描述"}],
  "education": [{"school":"学校","degree":"学历","major":"专业","start":"开始时间","end":"结束时间"}]
}`;
    const resp = await Promise.race([
      callAI(env, sys, text.slice(0, 4000)),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('REPARSE_TIMEOUT')), Math.max(3000, Number(env?.CUSTOM_SCREEN_AI_TIMEOUT_MS) || 20000))),
    ]);
    if (!resp) return '';
    // extractJSON 对合法 JSON 已返回解析对象；仅当返回字符串（解析失败）时才二次兜底
    let parsed: any = extractJSON(resp);
    if (typeof parsed === 'string') {
      try { parsed = JSON.parse(parsed || '{}'); } catch { parsed = {}; }
    }
    if (!parsed || typeof parsed !== 'object') return '';
    const structured = buildStructuredResumeText(parsed);
    if (!structured) return '';
    // 合并已有 parsed_data 的既有字段（如飞书元数据），避免覆盖丢失
    const existing = (() => { try { return JSON.parse(row.parsed_data); } catch { return {}; } })();
    const merged = { ...existing, ...parsed };
    await env.DB.prepare('UPDATE resumes SET parsed_data=?, updated_at=datetime(\'now\') WHERE id=?')
      .bind(JSON.stringify(merged), row.id).run().catch(() => {});
    return `【AI 解析摘要】\n${structured}`;
  } catch (e) {
    console.warn(`[custom-screen] 简历补解析失败（${row?.id}）：${(e as Error)?.message}`);
    return '';
  }
}

// 组装简历全文：AI 解析摘要（结构化，最前，信息最可靠）+ 原始文本。
function buildResumeFullText(r: any): string {
  let summary = '';
  if (r.parsed_data) {
    try {
      const parsed = typeof r.parsed_data === 'string' ? JSON.parse(r.parsed_data) : r.parsed_data;
      const structured = buildStructuredResumeText(parsed);
      if (structured) summary = `【AI 解析摘要】\n${structured}`;
    } catch {}
  }
  const parts = [summary, r.ocr_markdown, r.raw_text, r.resume_markdown].filter(Boolean);
  return parts.join('\n');
}

// 关键词命中：返回命中的 token 数与命中的 token 列表
function countTokenHits(text: string, tokens: string[]): { hits: number; matched: string[] } {
  const lower = text.toLowerCase();
  let hits = 0;
  const matched: string[] = [];
  for (const t of tokens) {
    if (lower.includes(t)) { hits++; matched.push(t); }
  }
  return { hits, matched };
}

// 关键词回退打分：命中占比 → 0-100
function keywordMatchScore(hits: number, totalTokens: number): number {
  if (totalTokens <= 0) return 0;
  return Math.min(100, Math.round((hits / totalTokens) * 100));
}

// 送 AI 的简历摘录：保留简历开头（个人信息/教育），再拼接筛选关键词命中位置附近的证据窗口。
// 之前只取前 400 字符，护士证/执业证等资格信息在简历中后部时 AI 完全看不到 → 误判低分 → 被阈值过滤漏人。
function buildAIResumeExcerpt(combined: string, tokens: string[], maxLen = 1200): string {
  if (!combined) return '';
  if (combined.length <= maxLen) return combined;
  const lower = combined.toLowerCase();
  const spans: Array<[number, number]> = [];
  for (const t of tokens) {
    if (!t) continue;
    let idx = lower.indexOf(t);
    while (idx !== -1) {
      spans.push([Math.max(0, idx - 200), Math.min(combined.length, idx + t.length + 300)]);
      idx = lower.indexOf(t, idx + t.length);
    }
  }
  if (spans.length === 0) return combined.slice(0, maxLen);
  spans.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
    else merged.push([...s]);
  }
  // 预算：开头 1/3 + 证据窗口 2/3
  const head = combined.slice(0, Math.floor(maxLen / 3));
  let budget = maxLen - head.length;
  const parts = [head];
  for (const [start, end] of merged) {
    const seg = combined.slice(start, end).trim();
    if (!seg || parts.includes(seg)) continue;
    if (seg.length <= budget) { parts.push(seg); budget -= seg.length; }
    else { parts.push(seg.slice(0, budget)); break; }
  }
  return parts.join('\n');
}

// 送 AI 的简历文本：默认全量（用户要求全量匹配，防止资格信息在简历后部被漏看）。
// 仅当单份简历异常长、或一批简历累计字符超模型上下文预算时，才对超长简历降级为
// 「开头 + 关键词证据窗口」，避免整批请求超上下文报错导致整批空分。
const AI_RESUME_FULL_LIMIT = 6000; // 单份全文超过此长度才降级摘录
const AI_BATCH_CHAR_BUDGET = 30000; // 每批累计文本预算（约 2 万 token 中文），超过则摘录最长简历
function buildAIResumeBlocks(
  batch: Array<{ row: any; combined: string }>,
  tokens: string[],
): string[] {
  const blocks = batch.map(({ row, combined }) => ({
    id: row.id,
    text: combined.length > AI_RESUME_FULL_LIMIT ? buildAIResumeExcerpt(combined, tokens, AI_RESUME_FULL_LIMIT) : combined,
  }));
  let total = blocks.reduce((sum, b) => sum + b.text.length, 0);
  if (total > AI_BATCH_CHAR_BUDGET) {
    for (const b of [...blocks].sort((a, b) => b.text.length - a.text.length)) {
      if (total <= AI_BATCH_CHAR_BUDGET) break;
      if (b.text.length > AI_RESUME_FULL_LIMIT) continue; // 已是最长档摘录，不再压缩
      const short = buildAIResumeExcerpt(b.text, tokens);
      total -= b.text.length - short.length;
      b.text = short;
    }
  }
  return blocks.map((b) => `#id:${b.id}\n${b.text}`);
}

app.get('/api/resumes', authMiddleware, async (c) => {
  try {
    // Feature Flag: 开启 SQL 分页查询时走优化路径，不 select 长文本列
    const sqlListEnabled = (c.env.RESUME_SQL_LIST || '').toLowerCase() === 'true';
    if (sqlListEnabled) {
      return await handleOptimizedResumeList(c);
    }
    // 纯 D1 驱动：直接从 resumes 表读取，不依赖飞书
    const d1Rows = await c.env.DB.prepare(
      'SELECT id, candidate_name, email, contact, position_applied, mapped_position, status, stage, match_score, ai_review, ai_evaluation, screening_result, parsed_data, parse_status, raw_text, resume_markdown, ocr_markdown, ocr_status, hr_review, hr_disposition, business_screening_status, gender, birthday, education, work_experience, certifications, self_evaluation, hard_requirement_result, capability_scores, three_layer_match, feishu_file_token, mineru_task_id, mineru_status, file_sha256, resume_received_at, resume_source, resume_source_record_id, resume_ingest_key, datetime(created_at) as created_at, datetime(updated_at) as updated_at FROM resumes ORDER BY created_at DESC, updated_at DESC'
    ).all();
    let items = (d1Rows.results || []).map((r: any) => serializeResumeCardRow(r));

    const statusFilter = c.req.query('status');
    const candidateNameFilter = (c.req.query('candidate_name') || '').trim();
    const screeningResultFilter = c.req.query('screening_result');
    const businessScreeningStatusFilterRaw = c.req.query('business_screening_status');
    const businessScreeningStatusFilter = isBusinessScreeningStatusFilter(businessScreeningStatusFilterRaw)
      ? businessScreeningStatusFilterRaw
      : null;
    const fileSha256Filter = c.req.query('file_sha256');
    const positionFilter = c.req.query('position');
    const majorFilter = c.req.query('major');
    const minAgeRaw = parseInt(c.req.query('min_age') || '', 10);
    const maxAgeRaw = parseInt(c.req.query('max_age') || '', 10);
    const minAge = Number.isFinite(minAgeRaw) ? minAgeRaw : null;
    const maxAge = Number.isFinite(maxAgeRaw) ? maxAgeRaw : null;
    const genders = (c.req.query('genders') || '')
      .split(',')
      .map((s: string) => s.trim())
      .filter(Boolean);
    let filtered = items;
    if (candidateNameFilter) {
      const keyword = candidateNameFilter.toLocaleLowerCase();
      filtered = filtered.filter((i: any) => String(i.candidate_name || '').toLocaleLowerCase().includes(keyword));
    }
    if (statusFilter) {
      if (statusFilter === 'pending_screening') {
        filtered = filtered.filter(i => i.status === 'pending_screening' && (!i.screening_result || i.screening_result === '' || i.screening_result === 'pending'));
      } else {
        filtered = filtered.filter(i => i.status === statusFilter);
      }
    }
    if (screeningResultFilter) filtered = filtered.filter(i => i.screening_result === screeningResultFilter);
    if (businessScreeningStatusFilter) {
      filtered = filtered.filter((i: any) => matchesBusinessScreeningStatusFilter(i, businessScreeningStatusFilter));
    }
    if (fileSha256Filter) filtered = filtered.filter(i => i.file_sha256 === fileSha256Filter);
    // 列表返回标准岗位名：优先岗位映射（raw_name → mapped_name），未映射时保留原岗位名
    try {
      const positionMap = await buildPositionMapping(c.env.DB);
      filtered = filtered.map((i: any) => {
        const raw = i.mapped_position || i.position_applied || '';
        i.standard_position = resolveMappedPosition(positionMap, raw);
        return i;
      });
    } catch {}
    // position 参数为标准岗位名（mapped_name）：匹配映射表里对应的所有原始岗位名，
    // 同时也匹配已直接存储标准岗位名的简历。
    if (positionFilter) {
      const positionMap = await buildPositionMapping(c.env.DB);
      filtered = filtered.filter((i: any) => {
        const raw = i.mapped_position || i.position_applied || '';
        return raw === positionFilter || resolveMappedPosition(positionMap, raw) === positionFilter;
      });
    }
    if (majorFilter) filtered = filtered.filter(i => (i.major || '').includes(majorFilter));
    if (c.req.query('education')) {
      const eduFilter = c.req.query('education');
      filtered = filtered.filter(i => (i.education || '').includes(eduFilter));
    }
    const educationMinFilter = c.req.query('education_min');
    if (educationMinFilter) {
      const minLevel = educationLevel(educationMinFilter);
      if (minLevel >= 0) {
        filtered = filtered.filter((i: any) => educationLevel(i.education) >= minLevel);
      }
    }
    if (minAge !== null || maxAge !== null) {
      filtered = filtered.filter((i: any) => {
        const age = typeof i.age === 'number' && Number.isFinite(i.age)
          ? i.age
          : (i.age != null && i.age !== '' ? Number(String(i.age).match(/\d+(?:\.\d+)?/)?.[0]) : null);
        if (age === null || !Number.isFinite(age)) return false;
        if (minAge !== null && age < minAge) return false;
        if (maxAge !== null && age > maxAge) return false;
        return true;
      });
    }
    if (genders.length > 0) {
      filtered = filtered.filter((i: any) => {
        const gender = i.gender === '男' || i.gender === '女' ? i.gender : '未识别';
        return genders.includes(gender);
      });
    }

    // 权限隔离：HR 自动只看自己负责的岗位
    let ownerFilter = c.req.query('responsible_person') || getOwnerName(c);
    if (ownerFilter) {
      try {
        const mappings = await c.env.DB.prepare(
          "SELECT raw_name, mapped_name FROM position_mappings WHERE responsible_person = ?"
        ).bind(ownerFilter).all();
        const ownerPositions = new Set<string>();
        for (const m of mappings.results || []) {
          if (m.raw_name) ownerPositions.add(m.raw_name);
          if (m.mapped_name) ownerPositions.add(m.mapped_name);
        }
        if (          ownerPositions.size > 0) {
          filtered = filtered.filter((i: any) => {
            const pos = i.mapped_position || i.position_applied || '';
            return ownerPositions.has(pos);
          });
        }
      } catch (e) {}
    }

    // 分页支持（修复冷启动/大列表返回 2026-07-24）：
    // 传 page/page_size 时返回 { items, total, page, page_size }；不传时保持全量数组（向后兼容）。
    await appendEvaluationJobProjection(c.env.DB, filtered);
    const pageParam = c.req.query('page');
    const pageSizeParam = c.req.query('page_size');
    if (pageParam || pageSizeParam) {
      const page = Math.max(1, parseInt(pageParam || '1', 10) || 1);
      const pageSize = Math.min(200, Math.max(1, parseInt(pageSizeParam || '20', 10) || 20));
      const total = filtered.length;
      const start = (page - 1) * pageSize;
      const paged = filtered.slice(start, start + pageSize);
      return c.json({ items: paged, total, page, page_size: pageSize });
    }

    return c.json(filtered);
  } catch (e: any) {
    console.error(`[Bitable] 简历列表失败: ${e.message}`);
    return c.json({ detail: '读取飞书数据失败: ' + e.message }, 500);
  }
});

// 构建自定义筛选候选池：岗位别名 + HR 权限隔离 + 全量简历进 AI 语义匹配（两阶段路由共用，保证同一候选池）。
// 不再做 SQL 关键词预筛（预筛漏持证者），候选池 = 该岗位全部有文本的简历，AI 分片并发对全量打分。
// LIMIT 仅防极端大岗位：与 aiScoreCustomScreenPool 的 AI_HARD_CAP 对齐（>cap 的部分保留关键词分不达显）。
const CUSTOM_SCREEN_POOL_CAP = 1000;

async function buildCustomScreenPool(
  env: any,
  position: string,
  condition: string,
  owner: string | null,
): Promise<{ pool: Array<{ row: any; hits: number; matched: string[]; combined: string; hasSummary: boolean }>; tokens: string[]; positionMap: Map<string, string> }> {
  // 岗位别名：标准岗位名 + 映射表里映射到该标准名的全部原始岗位名（与列表路由 position 过滤语义一致）
  const aliasRaws = new Set<string>([position]);
  try {
    const mappings = await env.DB.prepare('SELECT raw_name, raw_names, mapped_name FROM position_mappings').all();
    for (const row of mappings.results || []) {
      if (String(row.mapped_name || '').trim() === position) {
        if (row.raw_name && String(row.raw_name).trim()) aliasRaws.add(String(row.raw_name).trim());
        if (row.raw_names) {
          try {
            const parsed = typeof row.raw_names === 'string' ? JSON.parse(row.raw_names) : row.raw_names;
            if (Array.isArray(parsed)) for (const a of parsed) if (typeof a === 'string' && a.trim()) aliasRaws.add(a.trim());
          } catch {}
        }
      }
    }
  } catch {}

  const placeholders = [...aliasRaws].map(() => '?').join(', ');

  const tokens = tokenizeCondition(condition);

  // 不再 SQL 关键词预筛：直接把该岗位全部有文本的简历交给 AI 语义打分（简历量小时全量匹配提示词，
  // 靠多模型分片并发提速）。之前预筛按条件开头通用词截断候选池，导致持护士资格证/执业证的人被排除。
  // LIMIT 仅防极端大岗位（cap 与 AI 全量打分上限一致），命中/匹配由 JS 侧对全文精确计数。
  const rows = await env.DB.prepare(
    `SELECT id, candidate_name, contact, position_applied, mapped_position, status, screening_result, business_screening_status, hr_disposition, gender, birthday, education, hard_requirement_result, capability_scores, match_score, ai_review, ai_evaluation, parsed_data, raw_text, resume_markdown, ocr_markdown, datetime(created_at) as created_at, datetime(updated_at) as updated_at
     FROM resumes
     WHERE (mapped_position IN (${placeholders}) OR position_applied IN (${placeholders}))
       AND (ocr_markdown IS NOT NULL OR raw_text IS NOT NULL OR resume_markdown IS NOT NULL OR parsed_data IS NOT NULL)
     ORDER BY created_at DESC, updated_at DESC
     LIMIT ?`
  ).bind(...aliasRaws, ...aliasRaws, CUSTOM_SCREEN_POOL_CAP).all();
  let candidates = (rows.results || []) as any[];

  // HR 权限隔离：非 admin 只筛选自己负责的岗位（与列表路由逻辑一致）
  if (owner) {
    try {
      const ownerRows = await env.DB.prepare('SELECT raw_name, mapped_name FROM position_mappings WHERE responsible_person = ?').bind(owner).all();
      const ownerPositions = new Set<string>();
      for (const m of ownerRows.results || []) {
        if (m.raw_name) ownerPositions.add(String(m.raw_name));
        if (m.mapped_name) ownerPositions.add(String(m.mapped_name));
      }
      if (ownerPositions.size > 0) {
        candidates = candidates.filter((i: any) => {
          const pos = i.mapped_position || i.position_applied || '';
          return ownerPositions.has(pos);
        });
      }
    } catch {}
  }

  const positionMap = await buildPositionMapping(env.DB).catch(() => new Map<string, string>());

  // 全量进候选池：JS 精确计数关键词命中（供第一阶段关键词粗分与排序），combined 供 AI 打分。
  // 筛选依据只用 AI 解析摘要；无摘要的简历回退原文，并标记 hasSummary=false 供补解析。
  const poolRows: Array<{ row: any; hits: number; matched: string[]; combined: string; hasSummary: boolean }> = [];
  for (const row of candidates) {
    const built = buildCustomScreenResumeText(row);
    const r = countTokenHits(built.text, tokens);
    poolRows.push({ row, hits: r.hits, matched: r.matched, combined: built.text, hasSummary: built.hasSummary });
  }
  poolRows.sort((a, b) => b.hits - a.hits);
  return { pool: poolRows, tokens, positionMap };
}

// AI 语义打分：对候选池全部简历做语义评分（不再做关键词预筛，直接让 AI 按完整筛选条件逐份匹配，
// 用户要求全量解析保准度）。并发分批 + 全局截止时间兜底；超时/失败批次回退关键词分（不返回该 id 即可）。
// 简历数超 AI_HARD_CAP 时只对前 cap 份打分（防极端大岗位请求爆炸），其余保留关键词分。
async function aiScoreCustomScreenPool(
  env: any,
  pool: Array<{ row: any; hits: number; matched: string[]; combined: string; hasSummary: boolean }>,
  position: string,
  condition: string,
): Promise<{ scores: Array<{ id: string; score: number; reason: string }>; error?: string }> {
  if (pool.length === 0) return { scores: [] };

  const AI_HARD_CAP = 1000; // 与候选池 cap 一致：全量简历交给 AI 打分（用户要求全量解析保准度，慢可以接受）
  let eligible = pool;
  if (eligible.length > AI_HARD_CAP) {
    eligible = pool.slice(0, AI_HARD_CAP);
    console.warn(`[custom-screen] 简历 ${pool.length} 份，AI 只对前 ${AI_HARD_CAP} 份打分，其余保留关键词分`);
  }

  const BATCH = 8;
  // 生成速度是主要瓶颈（DeepSeek 约 30-60 token/s，8 份简历的 JSON 输出需 5-17s），
  // 批内超时给足余量；各批并发执行，总耗时 ≈ 最慢单批，远小于前端 90s 请求超时。
  // 之前 6s 必超时 → 每批都失败 → 前端一直拿到空分。
  const AI_TIMEOUT_MS = Math.max(3000, Number(env.CUSTOM_SCREEN_AI_TIMEOUT_MS) || 30000);
  const tokens = tokenizeCondition(condition);
  const chunk = <T>(arr: T[]): T[][] => {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += BATCH) out.push(arr.slice(i, i + BATCH));
    return out;
  };

  async function scoreBatch(
    batch: Array<{ row: any; hits: number; matched: string[]; combined: string; hasSummary: boolean }>,
    config?: { apiKey: string; baseUrl: string; model: string },
  ): Promise<Map<string, { id: string; score: number; reason: string }>> {
    const prompt = await getAIPrompt(env, 'resume_custom_screen', DEFAULT_CUSTOM_SCREEN_PROMPT);
    const resumeBlock = buildAIResumeBlocks(batch, tokens).join('\n\n');
    const userText = prompt.user
      .replace('{position}', position)
      .replace('{condition}', condition)
      .replace('{resumes}', resumeBlock);
    const textPromise = config
      ? callConfiguredAIWithMetadata(env, config, prompt.system, userText, 'deepseek-v4-flash', {
          structured: true,
          temperature: 0,
          maxTokens: 2048, // 8 份简历的 JSON 输出，1024 在 reason 写长时易截断 → 解析失败 → 整批空分
        }).then(r => r.text)
      : callAI(env, prompt.system, userText, 'deepseek-v4-flash', {
          structured: true,
          temperature: 0,
          maxTokens: 2048,
        });
    const resultText = await Promise.race([
      textPromise,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('CUSTOM_SCREEN_AI_TIMEOUT')), AI_TIMEOUT_MS)),
    ]);
    // 解析容错：优先取数组；兼容模型返回单个对象（{"id":...,"score":...}）而非数组；
    // 数组解析失败时从原始文本逐项提取 {"id":"...",...} 对象（截断恢复），保证该批尽量不整批空分。
    const parsed = extractJSON(resultText);
    let list: any[] = Array.isArray(parsed) ? parsed : (parsed?.items || parsed?.results || []);
    if (Array.isArray(list) && list.length === 0 && parsed && typeof parsed === 'object' && parsed?.id) {
      list = [parsed];
    }
    if (!Array.isArray(list) || list.length === 0) {
      const recovered = (String(resultText).match(/\{[^{}]*"id"\s*:\s*"[^"]+"[^{}]*\}/g) || [])
        .map((s) => { try { return JSON.parse(s); } catch { return null; } })
        .filter(Boolean);
      if (recovered.length > 0) list = recovered;
    }
    const out = new Map<string, { id: string; score: number; reason: string }>();
    for (const entry of Array.isArray(list) ? list : []) {
      const id = String(entry?.id ?? '');
      if (!id) continue;
      const score = Math.max(0, Math.min(100, Math.round(Number(entry?.score) || 0)));
      out.set(id, { id, score, reason: String(entry?.reason ?? '').slice(0, 120) });
    }
    return out;
  }

  // 缺 AI 解析摘要的简历：用原始文本即时补解析（写回库），本轮即用新摘要打分，避免原文漏信息或原文本作依据。
  // 补解析失败不影响其他简历，保持原文本兜底。并发受限，防止补解析打爆 API。
  const CONCURRENCY = Math.max(1, Number(env.CUSTOM_SCREEN_MAX_CONCURRENCY) || 3);
  const mapLimit = async <T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> => {
    const out: R[] = new Array(items.length);
    let cursor = 0;
    const worker = async () => {
      while (cursor < items.length) {
        const idx = cursor++;
        out[idx] = await fn(items[idx]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
    return out;
  };

  const missingSummary = eligible.filter((p) => !p.hasSummary);
  if (missingSummary.length > 0) {
    const reparsed = await mapLimit(missingSummary, CONCURRENCY, async (p) => {
      const raw = buildResumeRawText(p.row);
      if (!raw || raw.trim().length < 20) return { id: p.row.id, summary: '' };
      const summary = await tryParseResumeStructuredFields(env, p.row, raw);
      return { id: p.row.id, summary };
    });
    const byId = new Map(reparsed.filter((r) => r.summary).map((r) => [r.id, r.summary]));
    if (byId.size > 0) {
      eligible = eligible.map((p) => {
        const s = byId.get(p.row.id);
        return s ? { ...p, combined: s, hasSummary: true } : p;
      });
      console.warn(`[custom-screen] 已补解析 ${byId.size} 份缺摘要简历`);
    }
  }

  // 多配置并发：配置 ≥2 时把候选池均分成 N 片，各账号并发处理自己那份，整体耗时 ≈ 单片耗时，更快。
  // 每个简历只由一个模型筛选，不做多模型综合评分。单配置保持原有 callAI 降级语义。
  const configs = await getLLMConfigs(env).catch(() => [] as Array<{ apiKey: string; baseUrl: string; model: string }>);
  const groups: Array<{
    config?: { apiKey: string; baseUrl: string; model: string };
    batches: Array<Array<{ row: any; hits: number; matched: string[]; combined: string; hasSummary: boolean }>>;
  }> = [];
  if (configs.length >= 2) {
    const size = Math.ceil(eligible.length / configs.length);
    for (let i = 0; i < configs.length; i++) {
      const shard = eligible.slice(i * size, (i + 1) * size);
      if (shard.length > 0) groups.push({ config: configs[i], batches: chunk(shard) });
    }
  } else {
    groups.push({ batches: chunk(eligible) });
  }

  let firstError: string | null = null;
  const perGroup = await Promise.all(groups.map(({ config, batches }) =>
    mapLimit(batches, CONCURRENCY, async (b) => {
      const fallbackToKeywords = (e: unknown) => {
        const msg = String((e as Error)?.message || e).slice(0, 300);
        firstError = firstError || msg;
        console.warn(`[custom-screen] AI 打分批次失败，回退关键词：${msg}`);
        return new Map<string, { id: string; score: number; reason: string }>();
      };
      try {
        return await scoreBatch(b, config);
      } catch (e) {
        // 超时不换模型重试（避免叠加等待拖长任务，直接回退关键词）；
        // 明确报错（HTTP 错误/解析失败等）则换模型顶上重试一次——
        // 改用全局 callAI（多配置随机起点 + 自动环绕降级，由下一个可用模型接手）。
        const isTimeout = String((e as Error)?.message || e).includes('CUSTOM_SCREEN_AI_TIMEOUT');
        if (!isTimeout) {
          try {
            return await scoreBatch(b, undefined);
          } catch (e2) {
            return fallbackToKeywords(e2);
          }
        }
        return fallbackToKeywords(e);
      }
    })
  ));
  const scores = new Map<string, { id: string; score: number; reason: string }>();
  for (const group of perGroup) for (const m of group) for (const [id, v] of m) scores.set(id, v);
  const list = [...scores.values()];
  // 没有拿到任何 AI 分时，把具体原因回传给前端（超时/调用失败/返回内容无法解析），避免前端只显示笼统报错
  if (list.length === 0) {
    const msg = firstError || 'AI 返回内容无法解析为评分（可能是输出被截断或格式不符），请稍后重试或检查模型配置';
    return { scores: list, error: msg };
  }
  return { scores: list };
}

/**
 * POST /api/resumes/custom-screen
 * 自定义筛选（第一层）：关键词打分立即返回（毫秒级卡片），AI 语义分由 /custom-screen/scores 后台补齐。
 */
app.post('/api/resumes/custom-screen', authMiddleware, async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const position = String(body.position || '').trim();
    const condition = String(body.condition || '').trim();
    if (!position) return c.json({ detail: '缺少岗位参数' }, 400);
    if (!condition) return c.json({ detail: '请输入筛选条件' }, 400);
    if (position.length > 200) return c.json({ detail: '岗位名称过长（最多 200 字）' }, 400);
    if (condition.length > 2000) return c.json({ detail: '筛选条件过长（最多 2000 字）' }, 400);
    const threshold = Number.isFinite(Number(body.threshold))
      ? Math.max(0, Math.min(100, Math.round(Number(body.threshold))))
      : 60;
    const owner = getOwnerName(c);

    const { pool, tokens, positionMap } = await buildCustomScreenPool(c.env as any, position, condition, owner);
    if (tokens.length === 0) return c.json({ detail: '筛选条件无法识别' }, 400);

    // 组装卡片字段 + custom_match（符合程度 + 理由 + 打分方式）
    const items = pool.map(({ row, hits, matched }) => {
      let item: any;
      try {
        item = serializeResumeCardRow(row);
      } catch (e) {
        console.warn(`[custom-screen] 简历卡片序列化失败（${row.id}）：${(e as Error)?.message}`);
        item = { id: row.id, candidate_name: row.candidate_name || '未知' };
      }
      const raw = row.mapped_position || row.position_applied || '';
      item.standard_position = resolveMappedPosition(positionMap, raw);
      item.custom_match = {
        score: keywordMatchScore(hits, tokens.length),
        reason: matched.length
          ? `关键词命中 ${matched.length}/${tokens.length}：${matched.join('、')}`
          : `关键词命中 ${hits}/${tokens.length}`,
        method: 'keyword' as const,
      };
      return item;
    });
    items.sort((a: any, b: any) => b.custom_match.score - a.custom_match.score);

    return c.json({ items, total: items.length, position, condition, threshold, ai_pending: true });
  } catch (e: any) {
    console.error(`[custom-screen] 自定义筛选失败: ${e.message}`);
    return c.json({ detail: '自定义筛选失败: ' + e.message }, 500);
  }
});

/**
 * POST /api/resumes/custom-screen/scores
 * 自定义筛选（第二层）：对候选池全部命中简历做 AI 语义打分，返回 {id, score, reason}。
 * 并发分批、每批全局截止时间兜底；整体耗时 ≈ 最慢单批（~6s）+ 批数/并发，前端取回后合并并重排。
 */
app.post('/api/resumes/custom-screen/scores', authMiddleware, async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const position = String(body.position || '').trim();
    const condition = String(body.condition || '').trim();
    if (!position || !condition) return c.json({ detail: '缺少岗位或筛选条件' }, 400);
    if (condition.length > 2000) return c.json({ detail: '筛选条件过长（最多 2000 字）' }, 400);
    const owner = getOwnerName(c);
    const { pool, tokens } = await buildCustomScreenPool(c.env as any, position, condition, owner);
    if (tokens.length === 0) return c.json({ scores: [], total: 0 });
    const result = await aiScoreCustomScreenPool(c.env as any, pool, position, condition);
    return c.json({
      scores: result.scores,
      total: pool.length,
      ai_pending: false,
      ...(result.error ? { ai_error: result.error } : {}),
    });
  } catch (e: any) {
    console.error(`[custom-screen] AI 语义分计算失败: ${e.message}`);
    return c.json({ detail: 'AI 语义分计算失败: ' + e.message }, 500);
  }
});

/**
 * POST /api/resumes/sync-from-feishu
 * 把飞书人才库多维表格的简历实时数据同步进 D1 resumes 表，
 * 供仪表盘看板 / 招聘漏斗 / 招聘日报等基于 D1 统计的模块使用。
 * stage 依据 AI初筛结果 + HR复核结果 派生；status 复用 parseTalentRecord 的映射。
 */
app.post('/api/resumes/sync-from-feishu', authMiddleware, async (c) => {
  try {
    const tableId = getBitableTableId(c.env, 'talent');
    const records = await bitableListRecords(c.env, tableId);

    // 岗位映射：raw_name / raw_names 两种结构都兼容
      let posMap = new Map<string, string>();
      try {
        const mps = await c.env.DB.prepare('SELECT raw_name, raw_names, mapped_name FROM position_mappings').all();
        posMap = buildPositionMappingFromRows(mps.results || []);
      } catch {}

    let created = 0, updated = 0, needsScreening = 0;
    for (const rec of records) {
      const item = parseTalentRecord(rec);
      const screening = item.screening_result || '';   // AI简历初筛结果：通过/淘汰
      const hr = item.hr_review || '';                  // HR复核结果：通过/未通过/(空)

      // 派生 pipeline 阶段（漏斗用）
      let stage = 'new';
      if (hr === '通过') stage = 'interview';
      else if (screening === '通过') stage = 'screening';

      // status 复用已有映射（approved/rejected/pending_screening...）
      const status = item.status || 'pending_screening';

      const positionName = resolveMappedPosition(posMap, item.mapped_position || item.position_applied || '');
      const mappedPos = positionName || item.mapped_position || item.position_applied || '';
      const id = item.id; // = 飞书 record_id，保证幂等
      const ingestion = buildResumeIngestionIdentity({
        source: 'feishu',
        sourceRecordId: String(item.feishu_record_id || id || ''),
        receivedAt: item.created_at || now(),
      });
      const existing = await c.env.DB.prepare('SELECT id FROM resumes WHERE id = ? LIMIT 1').bind(id).first();

      // 合并 parsed_data：AI 解析字段（学校/专业/技能等）+ 飞书元数据（保持兼容）
      const aiFields = item.parsed_data || {};
      const mergedParsedData = {
        ...aiFields,
        // 补充飞书元数据字段（前端/ai-screen 可能依赖）
        position_applied: item.position_applied || '',
        standard_position: positionName,
        city: item.city || aiFields.city || '',
        education: item.education || '',
        gender: item.gender || aiFields.gender || '',
        age: item.age ?? aiFields.age ?? null,
        advantage: item.advantage || aiFields.advantage || '',
        risk: item.risk || aiFields.risk || '',
        interview_suggestion: item.interview_suggestion || '',
        interview_questions: item.interview_questions || '',
        notes: item.notes || '',
        reserve_type: item.reserve_type || '',
        biz_owner: item.biz_owner || '',
        biz_review: item.biz_review || '',
        hr_pass_date: item.hr_pass_date || null,
        // 标记解析状态：如果学校/专业为空且无 ocr，后续可触发 MinerU 兜底
        _parse_source: aiFields._source || 'feishu',
        _need_ocr: (!aiFields.school && !aiFields.major) ? true : false,
      };

      // 检测是否需要自动 AI 初筛（飞书侧未完成解析/评估时由本系统补齐）
      const feishuAiEval = item.ai_evaluation || '';
      const feishuScreening = item.screening_result || '';
      const fieldIncomplete = !aiFields.highest_degree && !aiFields.school;
      const needsAutoScreen = (!feishuScreening || feishuAiEval.length < 50 || fieldIncomplete);
      const parseStatus = needsAutoScreen ? 'pending_screening' : 'completed';
      if (needsAutoScreen) needsScreening++;

      if (existing) {
        await c.env.DB.prepare(
          `UPDATE resumes SET candidate_name=?, email=?, position_applied=?, mapped_position=?, match_score=?, screening_result=?, ai_review=?, hr_review=?, status=?, stage=?, parsed_data=?, parse_status=?, resume_received_at=COALESCE(NULLIF(resume_received_at, ''), ?), resume_source=COALESCE(NULLIF(resume_source, ''), ?), resume_source_record_id=COALESCE(NULLIF(resume_source_record_id, ''), ?), resume_ingest_key=COALESCE(NULLIF(resume_ingest_key, ''), ?) WHERE id=?`
        ).bind(
          item.candidate_name || '', item.email || '', item.position_applied || '', mappedPos,
          item.match_score ?? null,
          screening, item.ai_evaluation || '', hr, status, stage,
          JSON.stringify(mergedParsedData),
          parseStatus,
          ingestion.receivedAt,
          ingestion.source,
          ingestion.sourceRecordId,
          ingestion.ingestKey,
          id
        ).run();
        updated++;
      } else {
        await c.env.DB.prepare(
          `INSERT INTO resumes (id, candidate_name, email, position_applied, mapped_position, match_score, screening_result, ai_review, hr_review, status, stage, parsed_data, parse_status, resume_received_at, resume_source, resume_source_record_id, resume_ingest_key, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          id, item.candidate_name || '', item.email || '', item.position_applied || '', mappedPos, item.match_score ?? null,
          screening, item.ai_evaluation || '', hr, status, stage,
          JSON.stringify(mergedParsedData),
          parseStatus,
          ingestion.receivedAt,
          ingestion.source,
          ingestion.sourceRecordId,
          ingestion.ingestKey,
          now()
        ).run();
        created++;
      }

      // 需要 AI 初筛/字段补全的简历，自动入队让后台消费者处理（OCR → 字段提取 → AI 初筛）
      if (needsAutoScreen) {
        try {
          const job = await createOrGetActiveJob(c.env.DB, id);
          await c.env.RESUME_PROCESSING_QUEUE.send({ jobId: job.id, resumeId: id });
        } catch (e) {
          console.error(`[ResumeSyncFeishu] Failed to queue resume ${id}:`, e);
        }
      }
    }

    // 统计需要 OCR 兜底的简历数
    let needsOcr = 0;
    try {
      const needRows = await c.env.DB.prepare(
        `SELECT COUNT(*) AS cnt FROM resumes WHERE parsed_data LIKE '%"_need_ocr":true%' AND (ocr_status IS NULL OR ocr_status != 'ocr_done')`
      ).all();
      needsOcr = (needRows?.results?.[0] as any)?.cnt || 0;
    } catch {}

    // 埋点：飞书简历同步
    await logOperation(c.env, {
      action: 'feishu.sync',
      entityType: 'resume',
      actor: c.get('user')?.email,
      detail: JSON.stringify({ created, updated, total: records.length, needs_ocr: needsOcr }),
    });
    return c.json({ ok: true, message: `简历同步完成：新增 ${created} 条，更新 ${updated} 条${needsOcr ? `，${needsOcr} 条需要 OCR 兜底` : ''}${needsScreening ? `，${needsScreening} 条待 AI 初筛` : ''}`, created, updated, total: records.length, needs_ocr: needsOcr, needs_screening: needsScreening });
  } catch (e: any) {
    return c.json({ detail: '简历同步失败: ' + e.message }, 500);
  }
});

// 批量 MinerU OCR 兜底：对飞书未成功解析的简历（_need_ocr: true），
// 下载 PDF → MinerU OCR → callAI 结构化抽取 → 更新 parsed_data
app.post('/api/resumes/batch-ocr-mineru', authMiddleware, async (c) => {
  const results: any[] = [];
  try {
    const rows = await c.env.DB.prepare(
      `SELECT id, candidate_name, position_applied FROM resumes WHERE parsed_data LIKE '%"_need_ocr":true%' AND (ocr_status IS NULL OR ocr_status != 'ocr_done') LIMIT 5`
    ).all();
    for (const row of (rows.results || []) as any[]) {
      try {
        // 1. 尝试从飞书获取 PDF
        const tableId = getBitableTableId(c.env, 'talent');
        const record = await bitableGetRecord(c.env, tableId, row.id);
        let pdfBytes: Uint8Array | null = null;
        if (record) {
          const f = record.fields || {};
          for (const [, fieldValue] of Object.entries(f)) {
            if (Array.isArray(fieldValue) && fieldValue.length > 0) {
              const item = fieldValue[0] as any;
              const dlUrl = item?.url || item?.download_url || item?.tmp_url;
              if (dlUrl) {
                const feishuToken = await getFeishuToken(c.env);
                const dlResp = await fetch(dlUrl, { headers: { Authorization: `Bearer ${feishuToken}` } });
                if (dlResp.ok) pdfBytes = new Uint8Array(await dlResp.arrayBuffer());
                break;
              }
            }
          }
        }
        // 2. 尝试从本地缓存获取（KV 新数据 + D1 旧数据）
        if (!pdfBytes) {
          const file = await getResumeFileBytes(c.env, row.id);
          if (file.bytes) pdfBytes = file.bytes;
        }
        if (!pdfBytes) { results.push({ id: row.id, status: 'no_pdf' }); continue; }

        // 3. MinerU sign
        const signResp = await fetch(`${MINERU_BASE(c)}/api/v1/agent/parse/file`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file_name: `${row.candidate_name || 'resume'}.pdf`, language: 'ch', is_ocr: true, enable_table: true, enable_formula: false }),
        });
        const signData: any = await signResp.json().catch(() => ({}));
        if (!signData?.data?.file_url || !signData?.data?.task_id) { results.push({ id: row.id, status: 'sign_failed' }); continue; }
        const { file_url, task_id } = signData.data;

        // 4. PUT 上传（空 Content-Type，兼容 MinerU 签名）
        const putResp = await fetch(file_url, { method: 'PUT', body: pdfBytes, headers: { 'Content-Type': '' } });
        if (!putResp.ok) { results.push({ id: row.id, status: 'upload_failed' }); continue; }

        // 5. 轮询等待 done
        let markdown = '';
        for (let i = 0; i < 40; i++) {
          const pollResp = await fetch(`${MINERU_BASE(c)}/api/v1/agent/parse/${task_id}`);
          const pollData: any = await pollResp.json().catch(() => ({}));
          if (pollData?.data?.state === 'done') {
            const mdResp = await fetch(pollData.data.markdown_url);
            markdown = await mdResp.text();
            break;
          }
          if (pollData?.data?.state === 'failed') { results.push({ id: row.id, status: 'ocr_failed' }); break; }
          await new Promise(r => setTimeout(r, 3000));
        }
        if (!markdown) { results.push({ id: row.id, status: 'ocr_timeout' }); continue; }

        // 6. 保存 ocr_markdown 并更新 parsed_data
        await c.env.DB.prepare('UPDATE resumes SET ocr_markdown=?, ocr_status=?, updated_at=? WHERE id=?')
          .bind(markdown.substring(0, 200000), 'ocr_done', now(), row.id).run();

        // 7. callAI 结构化抽取 & 合并到 parsed_data
        try {
          const customPrompt = await getCustomPrompt(c.env, 'parse_resume_pdf');
          let systemPrompt: string, userPrompt: string;
          if (customPrompt?.system && customPrompt?.user) {
            systemPrompt = customPrompt.system.replace(/\{candidate_name\}/g, row.candidate_name || '');
            userPrompt = customPrompt.user.replace(/\{candidate_name\}/g, row.candidate_name || '').replace(/\{resume_text\}/g, markdown);
          } else {
            systemPrompt = `你是一个专业的简历解析助手。请从以下 OCR 文本中提取所有字段，用 JSON 返回：{name, gender, age, highest_degree, school, major, years_of_experience, recent_company, current_position, phone, email, skills:[], work_experience:[{company,title,start,end}], education:[{school,degree,major,start,end}], certifications:[], self_evaluation, advantage, risk, evaluation}`;
            userPrompt = `简历文本：\n\n${markdown}`;
          }
          const aiResp = await callAI(c.env, systemPrompt, userPrompt);
          if (aiResp) {
            const parsed: any = JSON.parse(extractJSON(aiResp) || '{}');
            // 合并：保留飞书原有元数据 + OCR 解析字段
            const existingData = JSON.parse((await c.env.DB.prepare('SELECT parsed_data FROM resumes WHERE id = ?').bind(row.id).first() as any)?.parsed_data || '{}');
            const merged = {
              ...existingData,
              highest_degree: parsed.highest_degree || existingData.highest_degree || '',
              school: parsed.school || existingData.school || '',
              major: parsed.major || existingData.major || '',
              years_of_experience: parsed.years_of_experience ?? existingData.years_of_experience ?? null,
              recent_company: parsed.recent_company || existingData.recent_company || '',
              current_position: parsed.current_position || existingData.current_position || '',
              phone: parsed.phone || existingData.phone || '',
              gender: parsed.gender || existingData.gender || '',
              age: parsed.age ?? existingData.age ?? null,
              skills: Array.isArray(parsed.skills) ? parsed.skills : (existingData.skills || []),
              work_experience: Array.isArray(parsed.work_experience) ? parsed.work_experience : (existingData.work_experience || []),
              education: Array.isArray(parsed.education) ? parsed.education : (existingData.education || []),
              certifications: Array.isArray(parsed.certifications) ? parsed.certifications : (existingData.certifications || []),
              self_evaluation: parsed.self_evaluation || existingData.self_evaluation || '',
              _parse_source: 'mineru_ocr',
              _need_ocr: false,
            };
            await c.env.DB.prepare('UPDATE resumes SET parsed_data=?, parse_status=?, updated_at=? WHERE id=?')
              .bind(JSON.stringify(merged), 'completed', now(), row.id).run();
          }
        } catch (aiErr: any) {
          // AI 抽取失败不阻塞（ocr_markdown 已留存）
          console.error(`[Batch-OCR] AI parse failed for ${row.id}: ${aiErr.message}`);
        }

        results.push({ id: row.id, candidate_name: row.candidate_name, status: 'done' });
      } catch (e: any) {
        results.push({ id: row.id, status: 'error', detail: e.message });
      }
    }
    return c.json({ ok: true, results, count: results.length });
  } catch (e: any) {
    return c.json({ detail: '批量 OCR 失败: ' + e.message }, 500);
  }
});

// 批量 AI 初筛 + 字段解析：对飞书未完成评估的简历（parse_status='pending_screening'），
// 分两步调 callAI：①字段解析更新 parsed_data ②AI 初筛评分更新 ai_evaluation/screening_result
// 批量 AI 初筛：完全复用 ai-screen 路由的 prompt 和解析逻辑
app.post('/api/resumes/batch-auto-screen', authMiddleware, async (c) => {
  // 兼容旧客户端：统一委托到批量队列入口。
  const owner = getOwnerName(c);
  const ownerWhere = owner
    ? ` AND (position_id IN (SELECT id FROM positions WHERE responsible_person = ?) OR position_applied IN (SELECT raw_name FROM position_mappings WHERE responsible_person = ?) OR mapped_position IN (SELECT mapped_name FROM position_mappings WHERE responsible_person = ?))`
    : '';
  const ownerParams = owner ? [owner, owner, owner] : [];
  const rows = await c.env.DB.prepare(`SELECT id FROM resumes WHERE 1=1${ownerWhere}`).bind(...ownerParams).all();
  const result = await enqueueResumeReprocessBatchForIds(c.env.DB, c.env.RESUME_PROCESSING_QUEUE, (rows.results || []).map((row: any) => row.id));
  return c.json({ ok: true, ...result }, 202);

  /* Legacy synchronous implementation retained below for source compatibility only. */
  const results: any[] = [];
  try {
    const rows = await c.env.DB.prepare(
      `SELECT * FROM resumes WHERE parse_status = 'pending_screening' LIMIT 5`
    ).all();
    for (const row of (rows.results || []) as any[]) {
      const rid = row.id;
      const name = row.candidate_name || '';
      try {
        // 获取简历文本
        const { text: resumeText } = await getResumeTextForScreening(c.env, row);
        if (!resumeText || resumeText.length < 20) {
          results.push({ id: rid, candidate_name: name, status: 'no_text' });
          continue;
        }

        // callAI #1 — 字段解析：从简历文本提取结构化字段，更新 parsed_data
        let enrichedParsedData: any = typeof row.parsed_data === 'string'
          ? (() => { try { return JSON.parse(row.parsed_data); } catch { return {}; } })()
          : (row.parsed_data || {});
        let parseError = '';
        let parseResp: any = null;
        try {
          const parseSysPrompt = `你是一个简历解析助手。请从简历文本中提取以下字段，用 JSON 返回。重视教育背景部分。找不到的设为 null。

{"highest_degree":"最高学历(本科/硕士/博士)","school":"毕业院校全称","major":"专业全称","years_of_experience":"工作年限数字","recent_company":"最近公司","current_position":"最近职位","phone":"手机号","email":"邮箱","skills":["技能1","技能2"],"self_evaluation":"自我评价"}`;
          parseResp = await callAI(c.env, parseSysPrompt, resumeText);
          if (parseResp) {
            const parsed: any = JSON.parse(extractJSON(parseResp) || '{}');
            enrichedParsedData = {
              ...enrichedParsedData,
              highest_degree: parsed.highest_degree || enrichedParsedData.highest_degree || '',
              school: parsed.school || enrichedParsedData.school || '',
              major: parsed.major || enrichedParsedData.major || '',
              years_of_experience: parsed.years_of_experience ?? enrichedParsedData.years_of_experience ?? null,
              recent_company: parsed.recent_company || enrichedParsedData.recent_company || '',
              current_position: parsed.current_position || enrichedParsedData.current_position || '',
              phone: parsed.phone || enrichedParsedData.phone || '',
              email: parsed.email || enrichedParsedData.email || '',
              skills: Array.isArray(parsed.skills) ? parsed.skills : (enrichedParsedData.skills || []),
              self_evaluation: parsed.self_evaluation || enrichedParsedData.self_evaluation || '',
              _parse_source: 'ai_field_parse',
            };
            await c.env.DB.prepare('UPDATE resumes SET parsed_data=? WHERE id=?')
              .bind(JSON.stringify(enrichedParsedData), rid).run();
          }
        } catch (parseErr: any) {
          parseError = `parse_failed:${(parseErr.message||'').slice(0,80)}|resp_type:${typeof parseResp}|len:${(String(parseResp||'')).length}`;
          console.error(`[Batch-Auto-Screen] Field parse failed for ${rid}: ${parseErr.message}`);
          // 字段解析失败不阻塞，继续用已有 parsed_data
        }

        // callAI #2 — AI 初筛评分（与 ai-screen 路由完全一致）
        const posCtx = await getPositionContext(c.env.DB, row.position_applied || '');
        const prompt = await getAIPrompt(c.env, 'resume_screening', {
          system: `你是一位资深的 HR 招聘评估 AI。请基于「候选人结构化信息 + 简历全文 + 岗位要求 + 能力维度 + 个性化要求」进行综合评估，用中文返回 JSON 对象：

- match_score: 非权威参考值；${WEIGHTED_SCREENING_PROMPT}
- recommendation: 推荐建议，取值 "strongly_recommend" / "recommend" / "neutral" / "not_recommend" / "strongly_not_recommend"
- summary: 候选人综合摘要（中文，2-3 句）
- strengths: 3-5 个核心优势（中文数组）
- risks: 2-4 个潜在风险（中文数组）
- suggested_questions: 3-5 个建议面试问题（中文数组）
- dimensions: 必须且只能包含 ${WEIGHTED_SCREENING_DIMENSION_NAMES.join('、')}；每项格式为 { "name": "指定维度名", "score": 0-5 的整数, "reason": "打分依据（中文，1-2 句）" }。`,
          user: ''
        });

        // 从 parsed_data 构造结构化摘要块（使用刚解析的 enrichedParsedData）
        let structuredBlock = '';
        try {
          const pd = enrichedParsedData;
          const parts: string[] = [];
          if (pd.name || name) parts.push(`- 姓名：${pd.name || name}`);
          if (pd.highest_degree) parts.push(`- 学历：${pd.highest_degree}${pd.school ? `（${pd.school}${pd.major ? ' ' + pd.major : ''}）` : ''}`);
          if (pd.years_of_experience !== undefined && pd.years_of_experience !== null && pd.years_of_experience !== '')
            parts.push(`- 工作年限：${pd.years_of_experience}年`);
          if (pd.recent_company) parts.push(`- 最近公司：${pd.recent_company}${pd.current_position ? ' / ' + pd.current_position : ''}`);
          if (Array.isArray(pd.skills) && pd.skills.length) parts.push(`- 技能：${pd.skills.join('、')}`);
          if (pd.advantage) parts.push(`- 优势：${pd.advantage}`);
          if (pd.risk) parts.push(`- 风险点：${pd.risk}`);
          if (parts.length) structuredBlock = `\n候选人结构化信息（已解析字段）：\n${parts.join('\n')}\n`;
        } catch {}

        const userPrompt = `Job Position:\nTitle: ${posCtx.standardPosition}\n` +
          (posCtx.salaryRange ? `Salary: ${posCtx.salaryRange}\n` : '') +
          `Department: \nDescription: \nRequirements: \n` +
          (posCtx.capabilityDimensions ? `\nCapability Dimensions (能力维度):\n${posCtx.capabilityDimensions}\n` : '') +
          (posCtx.personalizedRequirements ? `\nPersonalized Requirements (个性化要求):\n${posCtx.personalizedRequirements}\n` : '') +
          structuredBlock +
          `\nCandidate Resume (full text):\n${resumeText}\n\nPlease analyze and return the JSON assessment.`;

        const result = await callAI(c.env, prompt.system, userPrompt);
        if (!result || result.length < 10) {
          results.push({ id: rid, candidate_name: name, status: 'no_response' });
          continue;
        }

        // 解析（与 ai-screen 路由一致：extractJSON 直接调用，失败用 raw）
        let parsed: any;
        try { parsed = extractJSON(result); } catch { parsed = { raw_response: result, summary: result }; }
        const positionRequirements = await getPositionRequirements(c.env, row.position_applied || row.mapped_position || '');
        const enrichedEvaluation = enrichScreeningEvaluation(
          parsed && typeof parsed === 'object' ? parsed : { summary: String(parsed || '') },
          positionRequirements?.capability_dimensions || [],
          positionRequirements?.hard_requirements || [],
          enrichedParsedData,
        );

        const matchScore = enrichedEvaluation.weighted_score;
        const screeningResult = enrichedEvaluation.screening_result;

        // ai_evaluation 与 ai-screen 路由格式一致
        const aiEvalObj: any = { summary: enrichedEvaluation.summary || '', match_score: matchScore, weighted_score: enrichedEvaluation.weighted_score, screening_result: screeningResult, screening_reason: enrichedEvaluation.screening_reason, gate_results: enrichedEvaluation.gate_results, configured_dimensions: enrichedEvaluation.configured_dimensions, recommendation: enrichedEvaluation.recommendation || '', dimensions: enrichedEvaluation.dimensions || [] };
        const aiReviewText = JSON.stringify({
          summary: enrichedEvaluation.summary || '', match_score: matchScore, weighted_score: enrichedEvaluation.weighted_score, screening_result: screeningResult, screening_reason: enrichedEvaluation.screening_reason, gate_results: enrichedEvaluation.gate_results, recommendation: enrichedEvaluation.recommendation || '',
          strengths: enrichedEvaluation.strengths || [], risks: enrichedEvaluation.risks || [],
          suggested_questions: enrichedEvaluation.suggested_questions || [], dimensions: aiEvalObj.dimensions || [],
        });

        await c.env.DB.prepare(
          `UPDATE resumes SET ai_review=?, ai_evaluation=?, match_score=?, screening_result=?, hard_requirement_result=?, parse_status='ai_screened', updated_at=? WHERE id=?`
        ).bind(aiReviewText, JSON.stringify(aiEvalObj), matchScore, screeningResult, JSON.stringify(enrichedEvaluation.hard_requirement_result), now(), rid).run();

        // 写回飞书
        try {
          const tid = getBitableTableId(c.env, 'talent');
          await bitableUpdateRecord(c.env, tid, rid, {
            'AI简历评估': JSON.stringify(aiEvalObj),
            'AI简历初筛结果': screeningResult,
            '优势分析': (parsed.strengths || []).join('\n'),
            '风险点': (parsed.risks || []).join('\n'),
          });
        } catch {}

        results.push({ id: rid, candidate_name: name, status: 'done', match_score: matchScore, screening_result: screeningResult, parse_error: parseError || undefined });
      } catch (e: any) {
        results.push({ id: rid, candidate_name: name, status: 'error', detail: e.message });
      }
    }
    return c.json({ ok: true, results, count: results.length });
  } catch (e: any) {
    return c.json({ detail: '批量 AI 初筛失败: ' + e.message }, 500);
  }
});

app.get('/api/resumes/:id', authMiddleware, async (c) => {
  try {
    const resumeId = c.req.param('id');
    // D1 是新上传与处理状态的事实来源；飞书只作为可选协作镜像。
    // 不能因飞书暂未回写/网络失败而把已入库的简历误报 404。
    const d1Row = await c.env.DB.prepare('SELECT * FROM resumes WHERE id = ?').bind(resumeId).first() as any;
    if (d1Row) {
      const item: any = transformRow(d1Row);
      for (const key of ['parsed_data', 'ai_review', 'ai_evaluation', 'work_experience', 'education', 'certifications']) {
        if (typeof item[key] === 'string') item[key] = safeJsonParse(item[key]) || item[key];
      }
      exposeStructuredEvaluation(item);
      if (item.screening_result) {
        item.screening_result = normalizeAiScreeningResult(item.screening_result);
        item.screening_label = item.screening_result;
      }
      applyParsedResumeFields(item);
      try {
        const map = await buildPositionMapping(c.env.DB);
        item.standard_position = resolveMappedPosition(map, item.position_applied || item.mapped_position || '');
      } catch { item.standard_position = item.position_applied || item.mapped_position || ''; }
      return c.json(item);
    }

    // 旧飞书记录兼容：仅对历史数据使用飞书作为回退。
    const tableId = getBitableTableId(c.env, 'talent');
    const record = await bitableGetRecord(c.env, tableId, resumeId);
    if (!record) return c.json({ detail: 'Not found' }, 404);
    const item = parseTalentRecord(record);
    // 加载岗位映射
    try {
      const map = await buildPositionMapping(c.env.DB);
      item.standard_position = resolveMappedPosition(map, item.position_applied || item.mapped_position || '');
    } catch { item.standard_position = item.position_applied || ''; }
    // 合并 D1 中的 AI 初筛结果（飞书没有这些字段）
    try {
      const d1Row = await c.env.DB.prepare(
        'SELECT match_score, ai_review, ai_evaluation, screening_result, parsed_data, parse_status, ocr_markdown, raw_text FROM resumes WHERE id = ?'
      ).bind(c.req.param('id')).first() as any;
      if (d1Row) {
        if (d1Row.match_score != null) item.match_score = d1Row.match_score;
        if (d1Row.ai_review) {
          try { item.ai_review = JSON.parse(d1Row.ai_review); } catch { item.ai_review = d1Row.ai_review; }
        }
        if (d1Row.ai_evaluation) {
          item.ai_evaluation = safeJsonParse(d1Row.ai_evaluation) || item.ai_evaluation;
        }
        if (d1Row.screening_result) item.screening_result = d1Row.screening_result;
        if (d1Row.parsed_data) {
          try { item.parsed_data = JSON.parse(d1Row.parsed_data); } catch { item.parsed_data = d1Row.parsed_data; }
        }
        if (d1Row.parse_status) item.parse_status = d1Row.parse_status;
      }
    } catch {}
    exposeStructuredEvaluation(item);
    if (item.screening_result) {
      item.screening_result = normalizeAiScreeningResult(item.screening_result);
      item.screening_label = item.screening_result;
    }
    return c.json(item);
  } catch (e: any) {
    return c.json({ detail: e.message }, 500);
  }
});

app.put('/api/resumes/:id', authMiddleware, requireRole(['admin', 'hr']), async (c) => {
  try {
    const resumeId = c.req.param('id');
    const existing = await c.env.DB.prepare('SELECT id FROM resumes WHERE id = ?').bind(resumeId).first();
    if (!existing) return c.json({ detail: 'Not found' }, 404);

    const body = await c.req.json().catch(() => ({}));
    const updates = normalizeResumeEditPayload(body && typeof body === 'object' ? body : {});
    const fields = Object.keys(updates);
    if (fields.length === 0) return c.json({ detail: 'No editable fields' }, 400);

    const assignments = fields.map((field) => `${field} = ?`).join(', ');
    await c.env.DB.prepare(
      `UPDATE resumes SET ${assignments}, updated_at = ? WHERE id = ?`
    ).bind(...fields.map((field) => updates[field]), now(), resumeId).run();

    const row = await c.env.DB.prepare('SELECT * FROM resumes WHERE id = ?').bind(resumeId).first() as Record<string, any> | null;
    if (!row) return c.json({ detail: 'Not found' }, 404);
    const item = transformRow(row);
    for (const key of ['parsed_data', 'ai_review', 'ai_evaluation', 'work_experience', 'education', 'certifications']) {
      if (typeof item[key] === 'string') item[key] = safeJsonParse(item[key]) || item[key];
    }
    applyParsedResumeFields(item);
    exposeStructuredEvaluation(item);
    return c.json(item);
  } catch (e: any) {
    return c.json({ detail: '更新失败: ' + e.message }, 500);
  }
});

// 下载简历附件（原始 PDF）- 302 重定向到飞书附件直链
// 支持 Authorization header 或 ?token= 查询参数
app.get('/api/resumes/:id/file', async (c) => {
  try {
    // 鉴权：检查 header 或 query param
    const auth = c.req.header('Authorization') || '';
    const queryToken = c.req.query('token') || '';
    let token = '';
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (match) {
      token = match[1];
    } else if (queryToken) {
      token = queryToken;
    }
    if (!token) return c.json({ detail: 'Not authenticated' }, 401);
    const payload = await verifyJwt(c.env.SECRET_KEY, token);
    if (!payload) return c.json({ detail: 'Invalid token' }, 401);

    const isDownload = c.req.query('download') === 'true';

    const recordId = c.req.param('id');

    // 1. 【优先】本地文件缓存（KV 新数据 + D1 旧数据）— 不依赖飞书 API，本地上传的 PDF 直接返回
    try {
      const file = await getResumeFileBytes(c.env, recordId);
      if (file.bytes) {
        const disposition = isDownload ? 'attachment' : 'inline';
        return new Response(file.bytes, { status: 200, headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `${disposition}; filename="${file.fileName || 'resume.pdf'}"`,
          'Access-Control-Allow-Origin': getAllowedOrigin(c.req.header('origin')) || '',
        }});
      }
    } catch {}

    // 2. 不再从飞书拉取 PDF，只返回本地缓存的简历文件
    return c.json({ detail: '该简历文件未本地缓存，无法预览。请重新上传 PDF 或联系管理员', not_cached: true }, 404);
  } catch (e: any) {
    return c.json({ detail: '下载简历文件失败: ' + e.message }, 500);
  }
});

// 批量缓存：遍历所有人才库记录，把附件下载到 D1 缓存，便于后续直接预览
app.post('/api/resumes/cache-files', authMiddleware, async (c) => {
  try {
    const tableId = getBitableTableId(c.env, 'talent');
    const records = await bitableListRecords(c.env, tableId);
    let cached = 0;
    let skipped = 0;
    let failed = 0;

    for (const record of records) {
      const rid = record.record_id;
      const f = record.fields || {};

      // 先检查是否已在缓存中
      const existing: any = await c.env.DB.prepare('SELECT id FROM resume_files WHERE id = ?').bind(rid).first().catch(() => null);
      if (existing) { skipped++; continue; }

      // 扫描附件字段
      let fileToken = '';
      let tmpUrl = '';
      for (const [fieldName, fieldValue] of Object.entries(f)) {
        if (Array.isArray(fieldValue) && fieldValue.length > 0) {
          const item = fieldValue[0];
          if (item && typeof item === 'object') {
            if (item.file_token) {
              fileToken = item.file_token;
              tmpUrl = item.tmp_url || '';
              break;
            }
            if (item.link && item.link.includes('/download/all/')) {
              const linkMatch = item.link.match(/\/download\/all\/([^\/\?]+)/);
              if (linkMatch) { fileToken = linkMatch[1]; tmpUrl = item.link; break; }
            }
          }
        }
      }

      if (!fileToken) { failed++; continue; }

      // 尝试下载
      const downloadUrl = tmpUrl || `https://ywwlaii6ga7.feishu.cn/space/api/box/stream/download/all/${fileToken}?mount_node_token=${FEISHU_CONFIG.appToken}&mount_point=bitable`;
      const resp = await downloadFeishuAttachment(c.env, fileToken, downloadUrl);
      if (resp) {
        const blob = await resp.clone().arrayBuffer();
        const candidateName = f['姓名'] || 'resume';
        await storeResumeFile(c.env, rid, candidateName + '.pdf', blob.byteLength, blob);
        cached++;
      } else {
        failed++;
      }
    }

    return c.json({ total: records.length, cached, skipped, failed });
  } catch (e: any) {
    return c.json({ detail: '批量缓存失败: ' + e.message }, 500);
  }
});

// 批量清除除指定记录外的人才库数据（用于测试）
// 前端直连飞书 CDN 下载后，上传到 Worker 缓存到 D1
app.post('/api/resumes/:id/cache-file', async (c) => {
  try {
    // 鉴权：支持 JWT token 或 secret 参数（用于脚本批量上传）
    const auth = c.req.header('Authorization') || '';
    const queryToken = c.req.query('token') || '';
    const adminSecret = c.req.query('secret') || '';
    let authorized = false;

    // 方法 1：JWT token
    if (auth || queryToken) {
      const token = auth.match(/^Bearer\s+(.+)$/i)?.[1] || queryToken;
      if (token) {
        const payload = await verifyJwt(c.env.SECRET_KEY, token);
        if (payload) authorized = true;
      }
    }
    // 方法 2：admin secret（与 SECRET_KEY 相同）
    if (!authorized && adminSecret && adminSecret === c.env.SECRET_KEY) {
      authorized = true;
    }
    if (!authorized) return c.json({ detail: 'Not authenticated' }, 401);

    const id = c.req.param('id');
    let ab: ArrayBuffer;
    let candidateName: string;

    const contentType = c.req.header('Content-Type') || '';
    if (contentType.includes('json')) {
      // JSON 模式：接收 base64 编码的文件内容
      const body = await c.req.json();
      if (!body.file_b64) return c.json({ detail: '请提供 file_b64' }, 400);
      const bin = b64ToBuf(body.file_b64);
      ab = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer;
      candidateName = body.name || 'resume';
    } else {
      // FormData 模式：接收 multipart 上传
      const formData = await c.req.formData();
      const file = formData.get('file') as File | null;
      if (!file) return c.json({ detail: '请上传 PDF 文件' }, 400);
      ab = await file.arrayBuffer();
      candidateName = formData.get('name')?.toString() || file.name.replace(/\.pdf$/i, '');
    }

    // 检查内容是否为有效 PDF（以 %PDF 开头）
    const header = new Uint8Array(ab.slice(0, 5));
    const pdfHeader = new TextDecoder().decode(header);
    if (pdfHeader !== '%PDF-') {
      return c.json({ detail: '不是有效的 PDF 文件' }, 400);
    }
    await storeResumeFile(c.env, id, candidateName + '.pdf', ab.byteLength, ab);
    return c.json({ success: true, file_size: ab.byteLength });
  } catch (e) {
    return c.json({ detail: '缓存失败: ' + ((e as any).message || e) }, 500);
  }
});

// 获取飞书附件直链（供前端浏览器直接下载）
app.get('/api/resumes/:id/file-info', authMiddleware, async (c) => {
  try {
    const tableId = getBitableTableId(c.env, 'talent');
    const record = await bitableGetRecord(c.env, tableId, c.req.param('id'));
    if (!record) return c.json({ detail: 'Not found' }, 404);
    const f = record.fields || {};

    let fileToken = '';
    let feishuUrl = '';
    let candidateName = f['姓名'] || 'resume';

    for (const [fieldName, fieldValue] of Object.entries(f)) {
      if (Array.isArray(fieldValue) && fieldValue.length > 0) {
        const item = fieldValue[0];
        if (item && typeof item === 'object') {
          if (item.file_token) {
            fileToken = item.file_token;
            if (item.tmp_url) feishuUrl = item.tmp_url;
            break;
          }
          if (item.link && item.link.includes('/download/all/')) {
            const linkMatch = item.link.match(/\/download\/all\/([^\/\?]+)/);
            if (linkMatch) { fileToken = linkMatch[1]; feishuUrl = item.link; break; }
          }
        }
      }
    }

    if (!fileToken) return c.json({ detail: '未找到附件' }, 404);

    if (!feishuUrl) {
      const feishuHost = c.env.FEISHU_HOST || 'ywwlaii6ga7';
      const mountToken = c.env.FEISHU_BASE_TOKEN || 'NVh9bDiNRaF0ZysxjeLc5ID2n9c';
      feishuUrl = `https://${feishuHost}.feishu.cn/space/api/box/stream/download/all/${fileToken}?mount_node_token=${mountToken}&mount_point=bitable`;
    }

    return c.json({ fileToken, feishuUrl, candidateName });
  } catch (e: any) {
    return c.json({ detail: e.message }, 500);
  }
});

app.post('/api/resumes/clear-all-except', authMiddleware, async (c) => {
  try {
    const body = await c.req.json();
    const keepIds: string[] = body.keep_ids || [];
    const tableId = getBitableTableId(c.env, 'talent');
    const records = await bitableListRecords(c.env, tableId);
    const toDelete = records.filter((r: any) => !keepIds.includes(r.record_id));
    let deleted = 0;
    for (const r of toDelete) {
      await bitableDeleteRecord(c.env, tableId, r.record_id);
      deleted++;
    }
    return c.json({ deleted, total_before: records.length, kept: keepIds.length });
  } catch (e: any) {
    return c.json({ detail: '清除失败: ' + e.message }, 500);
  }
});

app.delete('/api/resumes/:id', authMiddleware, async (c) => {
  try {
    const resumeId = c.req.param('id');
    // 先删除计算真相源，避免 UI 显示已删但刷新后 D1 记录复活。
    await deleteResumeFile(c.env, resumeId);
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM resume_processing_jobs WHERE resume_id = ?').bind(resumeId),
      c.env.DB.prepare('DELETE FROM resume_files WHERE id = ?').bind(resumeId),
      c.env.DB.prepare('DELETE FROM resumes WHERE id = ?').bind(resumeId),
    ]);

    // 飞书是异步镜像；其网络失败不应回滚已经完成的本地删除。
    const tableId = getBitableTableId(c.env, 'talent');
    try { await bitableDeleteRecord(c.env, tableId, resumeId); } catch {}
    return c.json({ detail: 'Deleted' });
  } catch (e: any) {
    return c.json({ detail: '删除失败: ' + e.message }, 500);
  }
});

app.post('/api/resumes/:id/retry-processing', authMiddleware, async (c) => {
  const resumeId = c.req.param('id');
  try {
    const result = await enqueueResumeReprocess(c.env.DB, c.env.RESUME_PROCESSING_QUEUE, resumeId);
    return c.json({ job_id: result.jobId, parse_status: result.status === 'running' ? 'processing' : 'queued', queued: result.queued, detail: result.queued ? '已重新入队' : '任务已在处理中' }, 202);
  } catch (error) {
    if (error instanceof ResumeNotFoundError) return c.json({ detail: 'Resume not found' }, 404);
    console.error(`[retry-processing] ${resumeId} failed`, error);
    return c.json({ detail: '重新入队失败' }, 500);
  }
});

// 统一的批量重新评估入口：选中简历时只处理选中项，否则处理当前用户可见的全部简历。
export async function handleBatchResumeReprocess(c: any) {
  try {
    const body = await c.req.json().catch(() => ({}));
    const requestedIds = Array.isArray(body?.ids) ? body.ids : [];
    if (requestedIds.some((id: unknown) => typeof id !== 'string' || id.trim() === '')) {
      return c.json({ detail: 'ids must only contain resume ids' }, 400);
    }

    const owner = getOwnerName(c);
    if (requestedIds.length === 0) {
      const result = await startHistoricalResumeReprocess(c.env.DB, c.env.RESUME_PROCESSING_QUEUE, owner);
      return c.json({ ok: true, ...result }, 202);
    }
    if (requestedIds.length > 50) return c.json({ detail: '一次最多提交 50 份简历' }, 400);
    const ids = await selectVisibleResumeIdsForReprocess(c.env.DB, requestedIds, owner);
    const result = await enqueueResumeReprocessBatchForIds(c.env.DB, c.env.RESUME_PROCESSING_QUEUE, ids);

    return c.json({
      ok: true,
      ...result,
      requested: requestedIds.length > 0 ? requestedIds.length : result.requested,
    }, 202);
  } catch (error: any) {
    console.error('[batch-reprocess] failed', error);
    return c.json({ detail: '批量重新评估失败: ' + (error?.message || error) }, 500);
  }
}

app.post('/api/resumes/batch-reprocess', authMiddleware, handleBatchResumeReprocess);

// 新建 scope 参数批量重评入口
export async function handleScopedBatchResumeReprocess(c: any) {
  try {
    await recoverStaleResumeProcessingJobs(c.env.DB).catch((error) => {
      console.error('[scoped-batch-reprocess] stale job recovery failed', error);
    });
    const body = await c.req.json().catch(() => ({}));
    const scope = body?.scope;
    const ids = body?.ids;

    const hasScope = scope !== undefined && scope !== null;
    const hasIds = Array.isArray(ids) && ids.length > 0;
    if (hasScope && hasIds) {
      return c.json({ detail: '不能同时传递 scope 和 ids' }, 400);
    }
    if (!hasScope && !hasIds) {
      return c.json({ detail: '必须传递 scope 或 ids' }, 400);
    }
    if (hasScope && scope !== 'all' && scope !== 'incomplete_or_failed') {
      return c.json({ detail: '非法 scope 参数' }, 400);
    }

    const owner = getOwnerName(c);

    if (hasIds) {
      const validIds = ids.filter((id: unknown): id is string => typeof id === 'string' && id.trim() !== '');
      if (validIds.length > 50) return c.json({ detail: '一次最多提交 50 份简历' }, 400);
      const visibleIds = await selectVisibleResumeIdsForReprocess(c.env.DB, validIds, owner);
      const result = await enqueueResumeReprocessBatchForIds(c.env.DB, c.env.RESUME_PROCESSING_QUEUE, visibleIds);
      return c.json({ ok: true, ...result, requested: validIds.length }, 202);
    }

    // scope-based path
    const rows = await selectResumeIdsForBatchScope(c.env.DB, scope as ReprocessScope, owner);
    if (rows.length === 0) {
      return c.json({ ok: true, batch_id: null, scope, total: 0, queued: 0, already_processing: 0, skipped: 0, failed: 0, message: '当前没有需要重新评估的简历' });
    }

    // Reconcile a previously materialized batch before checking for conflicts.
    // A batch can be logically finished while its row still says `running` if
    // the final worker update was interrupted; treating that stale row as active
    // would block retries of failed/incomplete resumes forever.
    const activeView = await getActiveReprocessBatchView(c.env.DB, owner);
    if (activeView && (activeView.status === 'queued' || activeView.status === 'running')) {
      return c.json({ detail: '当前已有活动批次在处理中，请稍后再试', batch_id: activeView.batch_id }, 409);
    }

    const result = await startHistoricalResumeReprocess(
      c.env.DB,
      c.env.RESUME_PROCESSING_QUEUE,
      owner,
      scope as ReprocessScope,
    );

    return c.json({
      ok: true,
      ...result,
      scope,
      total: rows.length,
    }, 202);
  } catch (error: any) {
    console.error('[scoped-batch-reprocess] failed', error);
    return c.json({ detail: '批量重新评估失败: ' + (error?.message || error) }, 500);
  }
}

app.post('/api/resumes/batch-reprocess-scoped', authMiddleware, handleScopedBatchResumeReprocess);

// 查询当前用户活动批次
app.get('/api/resumes/reprocess-batches/active', authMiddleware, async (c) => {
  try {
    const owner = getOwnerName(c);
    const active = await c.env.DB.prepare(
      `SELECT id FROM resume_reprocess_batches
       WHERE (${owner ? 'owner=?' : 'owner IS NULL'}) AND status IN ('queued', 'running')
       ORDER BY created_at DESC LIMIT 1`,
    ).bind(...(owner ? [owner] : [])).first() as { id?: string } | null;
    if (active?.id) {
      await recoverStalledHistoricalResumeReprocess(c.env.DB, c.env.RESUME_PROCESSING_QUEUE, active.id, owner).catch((error) => {
        console.error('[reprocess-batches/active] recovery failed', error);
      });
    }
    const view = await getActiveReprocessBatchView(c.env.DB, owner);
    return c.json({ batch: view || null });
  } catch (error: any) {
    console.error('[reprocess-batches/active] failed', error);
    return c.json({ detail: '查询失败: ' + error.message }, 500);
  }
});

// 查询指定批次
app.get('/api/resumes/reprocess-batches/:batchId', authMiddleware, async (c) => {
  try {
    const batchId = c.req.param('batchId');
    const owner = getOwnerName(c);
    await recoverStalledHistoricalResumeReprocess(c.env.DB, c.env.RESUME_PROCESSING_QUEUE, batchId, owner).catch((error) => {
      console.error('[reprocess-batches/:batchId] recovery failed', error);
    });
    const view = await getReprocessBatchView(c.env.DB, batchId, owner);
    if (!view) {
      return c.json({ detail: '批次不存在或无权限' }, 404);
    }
    return c.json(view);
  } catch (error: any) {
    console.error('[reprocess-batches/:batchId] failed', error);
    return c.json({ detail: '查询失败: ' + error.message }, 500);
  }
});

// 停止当前用户的批量重新评估。已完成的单份评估保留，排队中的任务取消。
app.post('/api/resumes/reprocess-batches/:batchId/cancel', authMiddleware, async (c) => {
  try {
    const batchId = c.req.param('batchId');
    const owner = getOwnerName(c);
    const cancelled = await cancelReprocessBatch(c.env.DB, batchId, owner);
    if (!cancelled) {
      return c.json({ detail: '批次不存在或无权限' }, 404);
    }
    const view = await getReprocessBatchView(c.env.DB, batchId, owner);
    if (!view) return c.json({ detail: '批次不存在或无权限' }, 404);
    return c.json(view);
  } catch (error: any) {
    console.error('[reprocess-batches/:batchId/cancel] failed', error);
    return c.json({ detail: '停止批量重新评估失败: ' + error.message }, 500);
  }
});

// 批量清除已淘汰（HR复核结果='未通过'）
app.post('/api/resumes/clear-rejected', authMiddleware, async (c) => {
  try {
    const result = await c.env.DB.prepare("DELETE FROM resumes WHERE status = 'rejected'").run();
    return c.json({ deleted: (result as any)?.meta?.changes || 0 });
  } catch (e: any) {
    return c.json({ detail: '清除失败: ' + e.message }, 500);
  }
});

// ==================== Resume Special Actions ====================

app.post('/api/resumes/batch', authMiddleware, async (c) => {
  // 批量上传已改为前端循环单文件异步接口，此路由保留兼容
  const contentType = c.req.header('content-type') || '';
  if (contentType.includes('multipart/form-data')) {
    // 前端 FormData → 按单文件循环处理
    const formData = await c.req.formData();
    const files = formData.getAll('files');
    let positionId = formData.get('position_id') as string;
    const results: any[] = [];
    for (const f of files) {
      try {
        const singleForm = new FormData();
        singleForm.append('file', f);
        if (positionId) singleForm.append('position_id', positionId);
        const origin = new URL(c.req.url).origin;
        const resp = await fetch(origin + '/api/resumes', {
          method: 'POST',
          headers: { 'Authorization': c.req.header('Authorization') || '' },
          body: singleForm,
        });
        const r: any = await resp.json();
        results.push(r);
      } catch (e) { results.push({ error: String(e) }); }
    }
    return c.json({ created: results.length, results });
  }
  // 兼容旧 JSON body 格式
  try {
    const body = await c.req.json();
    const results = [];
    for (const item of (body.items || body || [])) {
      const id = uuid();
      const cols = ['id', 'created_at'];
      const vals: any[] = [id, now()];
      for (const [k, v] of Object.entries(item)) {
        if (validCol(k) && !['id', 'created_at'].includes(k)) {
          cols.push(k);
          vals.push(prepareValue(v));
        }
      }
      const placeholders = cols.map(() => '?').join(', ');
      await c.env.DB.prepare(`INSERT INTO resumes (${cols.join(', ')}) VALUES (${placeholders})`).bind(...vals).run();
      results.push(id);
    }
    return c.json({ created: results.length, ids: results });
  } catch {
    return c.json({ detail: '批量上传请使用前端逐文件方式或 JSON body' }, 400);
  }
});

app.post('/api/resumes/:id/reparse', authMiddleware, async (c) => {
  const id = c.req.param('id');
  const startedAt = Date.now();
  logResumeProcessing('reparse.request.start', { resumeId: id });
  // 兼容旧客户端：重新解析统一走队列消费者，确保字段提取、能力维度评分和初筛使用同一套流程。
  try {
    const result = await enqueueResumeReprocess(c.env.DB, c.env.RESUME_PROCESSING_QUEUE, id);
    logResumeProcessing('reparse.request.ok', {
      resumeId: id,
      jobId: result.jobId,
      queued: result.queued,
      status: result.status,
      durationMs: Date.now() - startedAt,
    });
    return c.json({ id, job_id: result.jobId, parse_status: result.status === 'running' ? 'processing' : 'queued', queued: result.queued, detail: result.queued ? '已提交重新评估任务' : '任务已在处理中' }, 202);
  } catch (error) {
    if (error instanceof ResumeNotFoundError) {
      logResumeProcessing('reparse.request.not_found', { resumeId: id, durationMs: Date.now() - startedAt });
      return c.json({ detail: 'Resume not found' }, 404);
    }
    logResumeProcessingError('reparse.request.error', error, { resumeId: id, durationMs: Date.now() - startedAt });
    return c.json({ detail: '重新评估失败' }, 500);
  }

  /* Legacy synchronous implementation retained below for source compatibility only. */
  const resume = await c.env.DB.prepare('SELECT * FROM resumes WHERE id = ?').bind(id).first() as any;
  if (!resume) return c.json({ detail: 'Resume not found' }, 404);
  let rawText = resume.ocr_markdown || resume.raw_text || resume.resume_markdown || '';
  let parsedDataText = '';
  try { parsedDataText = resume.parsed_data ? (typeof resume.parsed_data === 'string' ? resume.parsed_data : JSON.stringify(resume.parsed_data)) : ''; } catch { parsedDataText = ''; }
  // 文本为空：尝试用已解析的结构化字段（如飞书同步来的简历）作为 reparse 输入
  let reparseSource = rawText ? 'text' : (parsedDataText ? 'parsed' : 'none');
  const candidateName = resume.candidate_name || resume.parsed_name || '';

  // 加载岗位上下文（用于增强 reparse 的 prompt）
  let reparsePosName = resume.position_applied || '';
  const reparsePosContext = reparsePosName ? await getPositionContext(c.env.DB, reparsePosName) : null;

  // 构建追加到 userPrompt 的岗位背景文本
  let appendContext = '';
  if (reparsePosContext) {
    appendContext += `\n岗位背景：\n- 标准岗位：${reparsePosContext.standardPosition}\n`;
    if (reparsePosContext.capabilityDimensions) appendContext += `- 能力维度：${reparsePosContext.capabilityDimensions}\n`;
    if (reparsePosContext.personalizedRequirements) appendContext += `- 个性化要求：${reparsePosContext.personalizedRequirements}\n`;
  }

  // 优先读取数据库中的自定义 prompt，key 为 resume_screening
  const customPrompt = await getCustomPrompt(c.env, 'resume_screening');
  let systemPrompt: string, userPrompt: string;
  // reparse 输入文本：优先 raw_text，其次 parsed_data（飞书同步简历）
  const reparseInputText = rawText || parsedDataText;
  if (customPrompt) {
    const normalizedPrompt = normalizeScreeningPrompt('resume_screening', customPrompt!);
    let sp = normalizedPrompt.system;
    let up = normalizedPrompt.user;
    if (up.includes('{position}')) up = up.replace(/\{position\}/g, candidateName);
    if (up.includes('{resume_text}')) up = up.replace(/\{resume_text\}/g, reparseInputText);
    if (up.includes('{fields}')) up = up.replace(/\{fields\}/g, '{}');
    if (up.includes('{capability_dimensions}')) up = up.replace(/\{capability_dimensions\}/g, reparsePosContext?.capabilityDimensions || '');
    systemPrompt = sp;
    userPrompt = up;
  } else {
    // 默认配置（中文增强版）
    systemPrompt = `你是一位资深招聘专家和简历解析助手。请解析以下简历文本，提取完整信息并进行AI初筛评估。返回JSON格式（不要加markdown代码块），包含两部分：

第一部分 - 基础信息：
- candidate_name: 候选人姓名（全名）
- gender: 性别（男/女）
- age: 年龄（数字）
- phone: 手机号码
- email: 电子邮箱
- highest_degree: 最高学历
- school: 毕业院校
- major: 专业
- graduation_year: 毕业年份
- years_of_experience: 工作年限（数字）
- current_company: 目前/最近所在公司
- current_position: 目前/最近职位
- salary_expectation: 期望薪资（如果有）
- skills: 技能列表（数组）
- certifications: 证书/资质（数组）
- work_experience: 工作经历数组，每个包含 { company, title, duration, description, achievements }
- education: 教育经历数组，每个包含 { school, degree, major, duration }

第二部分 - AI初筛评估：
- position: 应聘岗位（从文件名或文本中提取）
- advantage (优势分析): 用中文描述3-5个核心优势
- risk (风险点/劣势分析): 用中文描述2-4个劣势或风险
- match_score: 非权威参考值；${WEIGHTED_SCREENING_PROMPT}
- recommendation: 推荐建议（"strongly_recommend"/"recommend"/"neutral"/"not_recommend"/"strongly_not_recommend"）
- summary: 综合分析摘要（中文，2-3句话）
- suggested_questions: 建议面试问题（中文，3-5个）
- dimensions: 必须且只能包含 ${WEIGHTED_SCREENING_DIMENSION_NAMES.join('、')}；每项包含 { name, score(0-5), reason }。`;
    const inputHint = reparseSource === 'parsed' ? '已解析的结构化字段（来自飞书同步）：' : '简历文本（请提取完整信息）：';
    userPrompt = inputHint + appendContext + '\n\n' + reparseInputText;
  }
  // 既无原文也无结构化字段：尝试从 PDF 提取文本
  if (reparseSource === 'none') {
    try {
      const mineruBase = (c.env.MINERU_BASE || 'https://mineru.net').replace(/\/+$/, '');
      let pdfUrl = resume.file_path || '';
      let pdfBytes: ArrayBuffer | null = null;

      // 优先从 feishu_file_token 下载
      if (resume.feishu_file_token) {
        try {
          const feishuToken = await getFeishuToken(c.env);
          const dlUrl = `https://open.feishu.cn/open-apis/drive/v1/medias/${resume.feishu_file_token}/download`;
          const dlResp = await fetch(dlUrl, { headers: { Authorization: `Bearer ${feishuToken}` } });
          if (dlResp.ok) pdfBytes = await dlResp.arrayBuffer();
        } catch {}
      }

      // 其次从 file_path URL 下载
      if (!pdfBytes && pdfUrl) {
        try {
          const dlResp = await fetch(pdfUrl);
          if (dlResp.ok) pdfBytes = await dlResp.arrayBuffer();
        } catch {}
      }

      // 最后从 resume_files 表（KV/D1 存储）读取
      if (!pdfBytes) {
        try {
          const fileResult = await getResumeFileBytes(c.env, id);
          if (fileResult.bytes && fileResult.bytes.length > 100) {
            pdfBytes = fileResult.bytes.buffer;
          }
        } catch {}
      }

      if (pdfBytes && pdfBytes.byteLength > 100) {
        // MinerU OCR
        const signResp = await fetch(`${mineruBase}/api/v1/agent/parse/file`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file_name: `${resume.candidate_name || 'resume'}.pdf`, language: 'ch', is_ocr: true, enable_table: true, enable_formula: false }),
        });
        const signData: any = await signResp.json().catch(() => ({}));
        if (signData?.data?.file_url && signData?.data?.task_id) {
          await fetch(signData.data.file_url, { method: 'PUT', body: pdfBytes, headers: { 'Content-Type': '' } });
          let markdown = '';
          for (let i = 0; i < 20; i++) {
            const pollResp = await fetch(`${mineruBase}/api/v1/agent/parse/${signData.data.task_id}`);
            const pollData: any = await pollResp.json().catch(() => ({}));
            if (pollData?.data?.state === 'done') {
              const mdResp = await fetch(pollData.data.markdown_url);
              if (mdResp.ok) markdown = await mdResp.text();
              break;
            }
            if (pollData?.data?.state === 'failed') break;
            await new Promise(r => setTimeout(r, 2000));
          }
          if (markdown && markdown.length > 50) {
            rawText = markdown;
            reparseSource = 'text';
            // 缓存 OCR 结果
            try { await c.env.DB.prepare('UPDATE resumes SET ocr_markdown=?, ocr_status=? WHERE id=?').bind(markdown.substring(0, 200000), 'ocr_done', id).run(); } catch {}
          }
        }
      }
    } catch (e: any) {
      console.error(`[reparse] PDF extraction failed: ${e.message}`);
    }
  }

  // 仍然无文本：返回错误
  if (reparseSource === 'none') {
    return c.json({ detail: '找不到简历 PDF，无法提取文本重新解析。请重新上传 PDF 再试', need_manual: true }, 400);
  }
  try {
    const result = await callAI(c.env, systemPrompt, userPrompt);
    let parsed: any;
    try { parsed = extractJSON(result); } catch { parsed = { raw_response: result }; }
    // Flatten nested structure (some AI models wrap Basic Info / AI Screening as sub-objects)
    const flattened: any = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
        Object.assign(flattened, v);
      } else {
        flattened[k] = v;
      }
    }
    // Ensure we keep anything from the original parsed that wasn't in sub-objects
    const merged = { ...parsed, ...flattened };
    // 归一化 parsed_data 为标准字段集（兼容 AI 返回的新旧字段名）
    const normalized: any = { ...merged };
    if (!normalized.highest_degree && normalized.education) normalized.highest_degree = normalized.education;
    if (!normalized.years_of_experience && normalized.work_years) normalized.years_of_experience = normalized.work_years;
    if (!normalized.recent_company && normalized.current_company) normalized.recent_company = normalized.current_company;
    if (normalized.highest_degree) delete normalized.education;
    if (normalized.years_of_experience !== undefined) delete normalized.work_years;
    if (normalized.recent_company) delete normalized.current_company;
    // Build ai_review as structured JSON object (not markdown string)
    // Load capability dimensions for enrichment
    let enrichedEval: any = merged;
    let configuredDimensions: CapabilityDimension[] = [];
    try {
      let posName = merged.position || resume.position_applied || resume.standard_position || '';
      if (posName) {
        // 通过岗位映射表解析标准岗位名
        try {
          const mapping = await c.env.DB.prepare(
            'SELECT mapped_name FROM position_mappings WHERE raw_name = ? LIMIT 1'
          ).bind(posName).first() as any;
          if (mapping?.mapped_name) posName = mapping.mapped_name;
        } catch {}
        // 尝试模糊匹配
        const resolved = await resolvePositionTitle(c.env.DB, posName).catch(() => posName);
        if (resolved && resolved !== posName) posName = resolved;
      }
      if (posName) {
        const posRow = await c.env.DB.prepare(
          'SELECT title, capability_dimensions FROM positions WHERE title = ? LIMIT 1'
        ).bind(posName).first() as any;
        configuredDimensions = normalizeCapabilityDimensions(posRow?.capability_dimensions || []);
        // 如果 positions 表没有，从 capability_dimensions 独立表补充
        if (configuredDimensions.length === 0) {
          try {
            const dimRow = await c.env.DB.prepare(
              'SELECT dimensions_json FROM capability_dimensions WHERE position_name = ? LIMIT 1'
            ).bind(posName).first() as any;
            if (dimRow?.dimensions_json) {
              configuredDimensions = normalizeCapabilityDimensions(dimRow.dimensions_json);
            }
          } catch {}
        }
      }
    } catch (e: any) {
      console.error(`[Reparse] enrichment failed: ${e.message}`);
    }
    enrichedEval = enrichScreeningEvaluation(merged, configuredDimensions, [], normalized);
    const aiReview = enrichedEval;
    // Keep variables for Feishu sync compatibility
    const advantage = merged.advantage || merged.advantages || '';
    const risk = merged.risk || merged.risks || '';
    const pos = merged.position || '';
    const matchScore = enrichedEval.weighted_score ?? null;
    const recommendation = merged.recommendation || '';
    const enrichedScore = enrichedEval.weighted_score ?? null;
    await c.env.DB.prepare(
      'UPDATE resumes SET parsed_data = ?, ai_review = ?, ai_evaluation = ?, match_score = ?, screening_result = ?, parse_status = ? WHERE id = ?'
    ).bind(
      JSON.stringify(normalized),
      JSON.stringify(aiReview || normalized),
      JSON.stringify(enrichedEval),
      enrichedScore,
      enrichedEval.screening_result,
      'reparsed',
      id
    ).run();

    // 同步写回飞书多维表格（人才库表）
    try {
      const talentTableId = getBitableTableId(c.env, 'talent');
      await bitableUpdateRecord(c.env, talentTableId, id, buildFeishuScreeningMirror({
        ...enrichedEval,
        advantage,
        risk,
      }));
    } catch (e: any) {
      console.error(`[Reparse] 同步到飞书失败: ${e.message}`);
    }

    return c.json({ detail: 'Reparse completed', id, parsed_data: merged, ai_review: aiReview });
  } catch (err: any) {
    return c.json({ detail: 'Reparse failed', error: err.message }, 500);
  }
});

app.post('/api/resumes/:id/ai-screen', authMiddleware, async (c) => {
  const id = c.req.param('id');
  // 兼容旧客户端：AI 初筛与重新解析共用同一个队列处理流程。
  try {
    const result = await enqueueResumeReprocess(c.env.DB, c.env.RESUME_PROCESSING_QUEUE, id);
    return c.json({ id, job_id: result.jobId, parse_status: result.status === 'running' ? 'processing' : 'queued', queued: result.queued, detail: result.queued ? '已提交重新评估任务' : '任务已在处理中' }, 202);
  } catch (error) {
    if (error instanceof ResumeNotFoundError) return c.json({ detail: 'Resume not found' }, 404);
    console.error(`[ai-screen] ${id} failed`, error);
    return c.json({ detail: '重新评估失败' }, 500);
  }

  /* Legacy synchronous implementation retained below for source compatibility only. */
  const resume = await c.env.DB.prepare('SELECT * FROM resumes WHERE id = ?').bind(id).first() as any;
  if (!resume) return c.json({ detail: 'Resume not found' }, 404);
  let position: any = null;
  if (resume.position_id) {
    position = await c.env.DB.prepare('SELECT * FROM positions WHERE id = ?').bind(resume.position_id).first() as any;
  }
  // 三级降级获取文本：ocr_markdown → raw_text → 飞书PDF+MinerU → parsed_data摘要
  const { text: resumeText, source: textSource } = await getResumeTextForScreening(c.env, resume);
  if (!resumeText || resumeText.length < 20) return c.json({ detail: '该简历未提取到文本内容，无法进行 AI 评估', need_manual: true }, 400);
  const posTitle = position?.title || resume.position_applied || resume.position_id || 'Unknown';
  const posDesc = position?.description || '';
  const posReq = position?.requirements || '';
  const posDept = position?.department || '';
  const posSalary = position?.salary_range || '';
  const prompt = await getAIPrompt(c.env, 'resume_screening', {
    system: `你是一位资深的 HR 招聘评估 AI。请基于「候选人结构化信息 + 简历全文 + 岗位要求 + 能力维度 + 个性化要求」进行综合评估，用中文返回 JSON 对象：

- match_score: 非权威参考值；${WEIGHTED_SCREENING_PROMPT}
- recommendation: 推荐建议，取值 "strongly_recommend" / "recommend" / "neutral" / "not_recommend" / "strongly_not_recommend"
- summary: 候选人综合摘要（中文，2-3 句）
- strengths: 3-5 个核心优势（中文数组）
- risks: 2-4 个潜在风险（中文数组）
- suggested_questions: 3-5 个建议面试问题（中文数组）
- dimensions: 必须且只能包含 ${WEIGHTED_SCREENING_DIMENSION_NAMES.join('、')}；每项格式为 { "name": "指定维度名", "score": 0-5 的整数, "reason": "打分依据（中文，1-2 句）" }。`,
    user: ''
  });
  const systemPrompt = prompt.system;

  // 加载岗位上下文
  const posContext = await getPositionContext(c.env.DB, posTitle);

  // 从已解析的结构化字段构造摘要块（基于解析出的 PDF 字段，而非仅纯文本）
  let structuredBlock = '';
  let candidateFields: Record<string, any> = {};
  try {
    const pd = typeof resume.parsed_data === 'string' ? JSON.parse(resume.parsed_data || '{}') : (resume.parsed_data || {});
    candidateFields = pd && typeof pd === 'object' ? pd : {};
    const parts: string[] = [];
    if (pd.name) parts.push(`- 姓名：${pd.name}`);
    if (pd.highest_degree) parts.push(`- 学历：${pd.highest_degree}${pd.school ? `（${pd.school}${pd.major ? ' ' + pd.major : ''}）` : ''}`);
    if (pd.years_of_experience !== undefined && pd.years_of_experience !== null && pd.years_of_experience !== '')
      parts.push(`- 工作年限：${pd.years_of_experience}年`);
    if (pd.recent_company) parts.push(`- 最近公司：${pd.recent_company}${pd.current_position ? ' / ' + pd.current_position : ''}`);
    if (Array.isArray(pd.skills) && pd.skills.length) parts.push(`- 技能：${pd.skills.join('、')}`);
    if (pd.advantage) parts.push(`- 优势：${pd.advantage}`);
    if (pd.risk) parts.push(`- 风险点：${pd.risk}`);
    if (parts.length) structuredBlock = `\n候选人结构化信息（已解析字段）：\n${parts.join('\n')}\n`;
  } catch {}

  const userPrompt = `Job Position:\nTitle: ${posContext.standardPosition}\n` +
    (posContext.salaryRange ? `Salary: ${posContext.salaryRange}\n` : '') +
    `Department: ${posDept}\nDescription: ${posDesc}\nRequirements: ${posReq}\n` +
    (posContext.capabilityDimensions ? `\nCapability Dimensions (能力维度):\n${posContext.capabilityDimensions}\n` : '') +
    (posContext.personalizedRequirements ? `\nPersonalized Requirements (个性化要求):\n${posContext.personalizedRequirements}\n` : '') +
    structuredBlock +
    `\nCandidate Resume (full text):\n${resumeText}\n\nPlease analyze and return the JSON assessment.`;
  try {
    const result = await callAI(c.env, systemPrompt, userPrompt);
    let parsed: any;
    try { parsed = extractJSON(result); } catch { parsed = { raw_response: result, summary: result }; }
    const positionRequirements = await getPositionRequirements(c.env, posTitle);
    const enrichedEvaluation = enrichScreeningEvaluation(
      parsed && typeof parsed === 'object' ? parsed : { summary: String(parsed || '') },
      positionRequirements?.capability_dimensions || position?.capability_dimensions || [],
      positionRequirements?.hard_requirements || [],
      candidateFields,
    );
    // ai_evaluation：写入能力维度评分明细 JSON（格式与前端 parseScoreDetail 兼容：{dimensions:[{name,score,reason}]}）
    const aiEvalObj: any = { summary: enrichedEvaluation.summary || '', match_score: enrichedEvaluation.weighted_score ?? null, weighted_score: enrichedEvaluation.weighted_score, screening_result: enrichedEvaluation.screening_result, screening_reason: enrichedEvaluation.screening_reason, gate_results: enrichedEvaluation.gate_results, configured_dimensions: enrichedEvaluation.configured_dimensions, recommendation: enrichedEvaluation.recommendation || '', dimensions: enrichedEvaluation.dimensions || [] };
    const aiEvalText = JSON.stringify(aiEvalObj);
    // ai_review：完整评估 JSON（供详情页展示）
    const aiReviewText = JSON.stringify({
      summary: enrichedEvaluation.summary || '',
      match_score: enrichedEvaluation.weighted_score ?? null,
      weighted_score: enrichedEvaluation.weighted_score,
      screening_result: enrichedEvaluation.screening_result,
      screening_reason: enrichedEvaluation.screening_reason,
      gate_results: enrichedEvaluation.gate_results,
      recommendation: enrichedEvaluation.recommendation || '',
      strengths: enrichedEvaluation.strengths || [],
      risks: enrichedEvaluation.risks || [],
      suggested_questions: enrichedEvaluation.suggested_questions || [],
      dimensions: aiEvalObj.dimensions || [],
    });
    await c.env.DB.prepare(
      'UPDATE resumes SET ai_review = ?, ai_evaluation = ?, match_score = ?, screening_result = ?, hard_requirement_result = ?, parse_status = ?, updated_at = ? WHERE id = ?'
    ).bind(aiReviewText, aiEvalText, enrichedEvaluation.weighted_score ?? null, enrichedEvaluation.screening_result, JSON.stringify(enrichedEvaluation.hard_requirement_result), 'ai_screened', now(), id).run();

    // 同步写回飞书多维表格（人才库表）
    try {
      const talentTableId = getBitableTableId(c.env, 'talent');
      const strengths = Array.isArray(parsed.strengths) ? parsed.strengths.join('\n') : (parsed.strengths || '');
      const risks = Array.isArray(parsed.risks) ? parsed.risks.join('\n') : (parsed.risks || '');
      await bitableUpdateRecord(c.env, talentTableId, id, buildFeishuScreeningMirror({
        ...enrichedEvaluation,
        strengths,
        risks,
      }));
    } catch (e: any) {
      console.error(`[AIScreen] 同步到飞书失败: ${e.message}`);
    }

    // 顺手缓存 PDF 到 D1，便于后续预览
    try {
      const existingFile: any = await c.env.DB.prepare('SELECT id FROM resume_files WHERE id = ?').bind(id).first();
      if (!existingFile) {
        const talentTableId = getBitableTableId(c.env, 'talent');
        const record = await bitableGetRecord(c.env, talentTableId, id);
        if (record) {
          const f = record.fields || {};
          // 扫描附件字段
          for (const [fieldName, fieldValue] of Object.entries(f)) {
            if (Array.isArray(fieldValue) && fieldValue.length > 0) {
              const item = fieldValue[0];
              if (item && typeof item === 'object' && (item.file_token || item.link)) {
                const fileToken = item.file_token || '';
                const tmpUrl = item.tmp_url || '';
                // 优先用 tmp_url，失败再拼内部 URL
                const dlUrl = tmpUrl || (fileToken ? `https://ywwlaii6ga7.feishu.cn/space/api/box/stream/download/all/${fileToken}?mount_node_token=${FEISHU_CONFIG.appToken}&mount_point=bitable` : '');
                if (fileToken || tmpUrl) {
                  const dlResp = await downloadFeishuAttachment(c.env, fileToken, dlUrl);
                  if (dlResp) {
                    const blob = await dlResp.arrayBuffer();
                    await storeResumeFile(c.env, id, (f['姓名'] || 'resume') + '.pdf', blob.byteLength, blob);
                  }
                }
                break;
              }
            }
          }
        }
      }
    } catch (e: any) {
      console.error(`[AIScreen] 缓存PDF失败: ${e.message}`);
    }

    return c.json({ success: true, ai_review: parsed });
  } catch (err: any) {
    return c.json({ detail: 'AI screening failed', error: err.message }, 500);
  }
});

app.post('/api/resumes/:id/confirm-rejection', authMiddleware, async (c) => {
  const id = c.req.param('id');
  const decisionAt = now();
  await c.env.DB.prepare("UPDATE resumes SET status = 'rejected', stage = 'rejected', updated_at = ? WHERE id = ?").bind(decisionAt, id).run();
  await recordResumeDecisionTimestamp(c.env.DB, id, 'rejected', decisionAt);
  const row = await c.env.DB.prepare('SELECT * FROM resumes WHERE id = ?').bind(id).first();
  return c.json(transformRow(row));
});

app.post('/api/resumes/:id/override-rejection', authMiddleware, async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare("UPDATE resumes SET status = 'pending_review', stage = 'screening', updated_at = ? WHERE id = ?").bind(now(), id).run();
  await recordResumeDecisionTimestamp(c.env.DB, id, 'reset');
  const row = await c.env.DB.prepare('SELECT * FROM resumes WHERE id = ?').bind(id).first();
  return c.json(transformRow(row));
});

// 简历管理页面：入库 → 先更新 D1，再尽力回写飞书多维表格
app.post('/api/resumes/:id/approve-to-talent-pool', authMiddleware, async (c) => {
  const id = c.req.param('id');
  const actor = c.get('user')?.email || 'system';
  const d1Resume = await approveSingleResume(c.env.DB, id, actor);
  const talentTableId = getBitableTableId(c.env, 'talent');
  try {
    let record = await bitableGetRecord(c.env, talentTableId, id);
    if (record) {
      await bitableUpdateRecord(c.env, talentTableId, id, { 'HR复核结果': '通过' });
      record = await bitableGetRecord(c.env, talentTableId, id);
      if (record) return c.json(parseTalentRecord(record));
    }
  } catch (error: any) {
    // D1 入库已经完成；飞书回写失败不应把新上传的简历误报成 404。
    console.error(`[approve-to-talent-pool] 飞书回写失败(${id}): ${error?.message || error}`);
  }

  if (d1Resume) return c.json(d1Resume);
  return c.json({ detail: 'Candidate not found' }, 404);
});

app.post('/api/resumes/batch-approve-to-talent-pool', authMiddleware, requireRole(['admin', 'hr']), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const ids = Array.isArray(body.ids) ? body.ids : [];
  if (ids.length === 0) return c.json({ detail: 'ids must contain at least one resume id' }, 400);
  if (ids.some((id: unknown) => typeof id !== 'string' || id.length === 0)) {
    return c.json({ detail: 'ids must only contain resume ids' }, 400);
  }

  const result = await approveBatch(c.env.DB, ids, c.get('user')?.email || 'system');
  const talentTableId = getBitableTableId(c.env, 'talent');
  for (const id of result.approved) {
    try {
      await bitableUpdateRecord(c.env, talentTableId, id, { 'HR复核结果': '通过' });
    } catch (error: any) {
      console.error(`[batch-approve-to-talent-pool] 飞书回写失败(${id}): ${error?.message || error}`);
    }
  }
  return c.json(result);
});

app.post('/api/resumes/:id/reject-from-screening', authMiddleware, async (c) => {
  const id = c.req.param('id');
  const decisionAt = now();
  await c.env.DB.prepare("UPDATE resumes SET status = 'rejected', stage = 'rejected', updated_at = ? WHERE id = ?").bind(decisionAt, id).run();
  await recordResumeDecisionTimestamp(c.env.DB, id, 'rejected', decisionAt);
  return c.json({ status: 'rejected' });
});

// 重置简历到待初筛状态（清除 HR复核结果）
app.post('/api/resumes/:id/reset-to-pending', authMiddleware, async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare("UPDATE resumes SET status = 'pending_screening', stage = 'new', screening_result = '', updated_at = ? WHERE id = ?").bind(now(), id).run();
  await recordResumeDecisionTimestamp(c.env.DB, id, 'reset');
  return c.json({ status: 'pending_screening' });
});


app.get('/api/resumes/:id/department-reviews', authMiddleware, async (c) => {
  const result = await c.env.DB.prepare('SELECT * FROM department_reviews WHERE resume_id = ?').bind(c.req.param('id')).all();
  return c.json(result.results.map(transformRow));
});

app.post('/api/resumes/:id/department-reviews', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const body = await c.req.json();
  const reviewId = uuid();
  await c.env.DB.prepare(
    'INSERT INTO department_reviews (id, resume_id, reviewer_id, technical_score, experience_score, overall_score, recommendation, comment, is_completed, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)'
  ).bind(reviewId, id, user.id, body.technical_score, body.experience_score, body.overall_score, body.recommendation, body.comment, now(), now()).run();
  const row = await c.env.DB.prepare('SELECT * FROM department_reviews WHERE id = ?').bind(reviewId).first();
  return c.json(transformRow(row));
});

app.post('/api/resumes/:id/hr-decision', authMiddleware, async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  let decision;
  try {
    decision = mapHrDecision(body.decision);
  } catch (error: any) {
    return c.json({ detail: error.message }, 400);
  }
  const decisionAt = now();
  await c.env.DB.prepare('UPDATE resumes SET status = ?, stage = ?, hr_review = ?, updated_at = ? WHERE id = ?')
    .bind(decision.status, decision.stage, body.hr_comment || body.comment || '', decisionAt, id).run();
  await recordResumeDecisionTimestamp(c.env.DB, id, decision.event, decisionAt);
  const row = await c.env.DB.prepare('SELECT * FROM resumes WHERE id = ?').bind(id).first();
  return c.json(transformRow(row));
});

app.post('/api/resumes/:id/transfer', authMiddleware, async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  await c.env.DB.prepare('UPDATE resumes SET position_id = ? WHERE id = ?').bind(body.position_id, id).run();
  const row = await c.env.DB.prepare('SELECT * FROM resumes WHERE id = ?').bind(id).first();
  return c.json(transformRow(row));
});

// ==================== Interview Actions ====================

/** 秒级时间戳 → 北京时间「YYYY-MM-DD HH:mm」（interview_time 存储口径） */
function formatBeijingSlot(ts: number): string {
  const d = new Date(ts * 1000 + 8 * 3600_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

app.get('/api/interviews/:id/questions', authMiddleware, async (c) => {
  const row = await c.env.DB.prepare('SELECT questions FROM interviews WHERE id = ?').bind(c.req.param('id')).first();
  if (!row) return c.json({ detail: 'Not found' }, 404);
  let qs = [];
  if (row.questions) { try { qs = JSON.parse(row.questions); } catch { qs = []; } }
  return c.json(qs);
});

app.post('/api/interviews/:id/start', authMiddleware, async (c) => {
  const id = c.req.param('id');
  const current = await c.env.DB.prepare('SELECT id, status FROM interviews WHERE id = ?').bind(id).first() as any;
  if (!current) return c.json({ detail: 'Interview not found' }, 404);
  if (!['awaiting_schedule', 'scheduled', 'notification_partial'].includes(String(current.status || ''))) {
    return c.json({ detail: '仅待安排或已安排的面试可开始', code: 'INTERVIEW_NOT_SCHEDULED' }, 409);
  }
  const startedAt = now();
  await c.env.DB.prepare(
    "UPDATE interviews SET status = 'in_progress', started_at = ?, updated_at = ? WHERE id = ?",
  ).bind(startedAt, startedAt, id).run();

  // ===== 开始面试联动流程：①飞书会议日程（自动创建会议链接）②候选人免登录详情链接 ③候选人邮件 =====
  const startFlow: {
    meeting_link: string | null;
    calendar_event_id: string | null;
    candidate_email: string | null;
    email_status: 'queued' | 'skipped';
    email_detail: string;
    card_link: string | null;
    warnings: string[];
  } = {
    meeting_link: null,
    calendar_event_id: null,
    candidate_email: null,
    email_status: 'skipped',
    email_detail: '',
    card_link: null,
    warnings: [],
  };

  const startCtx = await loadInterviewStartContext(c.env.DB as D1Database, id);
  // 面试形式：线下（onsite/offline）不建飞书会议，提醒/邮件不带会议链接
  const isOffline = ['onsite', 'offline'].includes(String(startCtx?.interview.interview_type || '').trim());
  if (startCtx) {
    startFlow.candidate_email = startCtx.candidateEmail;
    const existingMeetingLink = String(startCtx.interview.meeting_link || '').trim();

    // 1) 飞书会议日程（已有会议链接则跳过创建）
    if (existingMeetingLink) {
      startFlow.meeting_link = existingMeetingLink;
    } else {
      try {
        // 面试时段：优先按主面试官当天空闲匹配（上班 9:30-18:30、午休 11:30-13:30、时长 1 小时）。
        // 找到新空闲段则写回 interview_time（系统展示/候选人邮件同步新时间）；
        // 找不到 / 主面试官无 open_id / 查询失败 → 回退原定时间并告警。
        const primaryName = String(startCtx.interview.primary_interviewer || '').trim()
          || String(startCtx.interview.interviewer || '').trim();
        let timeframe = resolveEventTimeframe(startCtx.interview);
        if (primaryName) {
          try {
            const primaryOpenId = await resolveExactInterviewerOpenId(c.env.DB as D1Database, primaryName);
            if (primaryOpenId) {
              const freeSlotTs = await findFirstFreeInterviewSlot({
                token: await getFeishuToken(c.env),
                openId: primaryOpenId,
                fromTs: Math.floor(Date.now() / 1000),
                durationMinutes: 60,
              });
              if (freeSlotTs) {
                const startLabel = formatBeijingSlot(freeSlotTs);
                const endLabel = formatBeijingSlot(freeSlotTs + 3600);
                timeframe = { startTs: freeSlotTs, endTs: freeSlotTs + 3600, timeLabel: `${startLabel} ~ ${endLabel}` };
                if (startLabel !== String(startCtx.interview.interview_time || '').trim()) {
                  await c.env.DB.prepare('UPDATE interviews SET interview_time = ?, updated_at = ? WHERE id = ?')
                    .bind(startLabel, now(), id).run();
                  startFlow.warnings.push(`已按主面试官空闲时间将面试调整为 ${startLabel}`);
                }
              } else {
                startFlow.warnings.push('主面试官未来两个工作日之后无连续 1 小时空档，已按原定时间安排，请与面试官确认');
              }
            }
          } catch (e: any) {
            startFlow.warnings.push(`空闲时间查询失败，已按原定时间安排：${e?.message || e}`);
          }
        }
        // 日程参与人：主/副面试官（解析到飞书 open_id 才邀请，失败不阻塞）——仅线上面试建会议
        if (!isOffline) {
          const attendeeNames = [...new Set(
            [String(startCtx.interview.primary_interviewer || '').trim(), String(startCtx.interview.secondary_interviewer || '').trim()].filter(Boolean),
          )];
          const attendeeOpenIds: string[] = [];
          for (const name of attendeeNames) {
            const openId = await resolveExactInterviewerOpenId(c.env.DB as D1Database, name);
            if (openId) attendeeOpenIds.push(openId);
          }
          const event = await createInterviewCalendarEvent(c.env, {
            summary: `面试 - ${startCtx.candidateName} - ${startCtx.positionName}`,
            description: [
              `候选人：${startCtx.candidateName}`,
              `应聘岗位：${startCtx.positionName}`,
              `面试时间：${timeframe.timeLabel}`,
              '',
              '由 AI-Interview「开始面试」流程自动创建。',
            ].join('\n'),
            startTimestamp: timeframe.startTs,
            endTimestamp: timeframe.endTs,
            attendeeOpenIds,
          }, {}, FEISHU_CONFIG.appId);
          startFlow.calendar_event_id = event.eventId;
          if (event.meetingUrl) {
            await c.env.DB.prepare('UPDATE interviews SET meeting_link = ?, feishu_event_id = ?, updated_at = ? WHERE id = ?')
              .bind(event.meetingUrl, event.eventId, now(), id).run();
            startFlow.meeting_link = event.meetingUrl;
          } else {
            await c.env.DB.prepare('UPDATE interviews SET feishu_event_id = ?, updated_at = ? WHERE id = ?')
              .bind(event.eventId, now(), id).run();
            startFlow.warnings.push('飞书日程已创建，但会议链接尚未生成，请稍后刷新面试详情或手动补充会议链接');
          }
          startFlow.warnings.push(...event.attendeeErrors);
        } else {
          startFlow.warnings.push('线下面试：已按主面试官空闲时间排定，未创建视频会议');
        }
      } catch (e: any) {
        startFlow.warnings.push(`飞书会议日程创建失败：${e?.message || e}`);
      }
    }

    // 2) 候选人邮件（异步）
    try {
      const configRow = await c.env.DB.prepare('SELECT frontend_url, mail_from_name FROM system_configs ORDER BY updated_at DESC LIMIT 1').first() as any;
      const fromName = (configRow?.mail_from_name && String(configRow.mail_from_name).trim()) || '招聘系统';

      // 邮件状态同步预检（实际发送异步执行）
      if (!startCtx.candidateEmail) {
        startFlow.email_status = 'skipped';
        startFlow.email_detail = '候选人简历未解析到邮箱，邮件未发送';
      } else {
        const smtpRow = await c.env.DB.prepare('SELECT smtp_host, smtp_port, smtp_username, smtp_password, mail_from, mail_from_name, mail_enabled FROM system_configs ORDER BY updated_at DESC LIMIT 1').first() as any;
        if (!isSmtpConfigured(smtpRow)) {
          startFlow.email_status = 'skipped';
          startFlow.email_detail = 'SMTP 邮件服务未启用或配置不完整（系统设置 → 邮件设置），邮件未发送';
        } else {
          startFlow.email_status = 'queued';
          c.executionCtx.waitUntil((async () => {
            try {
              const result = await sendCandidateInterviewEmail(c.env.DB as D1Database, {
                ctx: startCtx,
                meetingUrl: isOffline ? null : startFlow.meeting_link,
                offline: isOffline,
                fromName,
                nowIso: now(),
              });
              if (result.status === 'failed') {
                console.error(`[InterviewStart] 候选人邮件发送失败: ${result.reason}`);
              } else {
                console.log(`[InterviewStart] 候选人邮件 ${result.status}${result.status === 'sent' ? ` -> ${result.to}` : `: ${result.reason}`}`);
              }
            } catch (e: any) {
              console.error(`[InterviewStart] 候选人邮件任务异常: ${e?.message || e}`);
            }
          })());
        }
      }
    } catch (e: any) {
      startFlow.warnings.push(`候选人邮件预检失败：${e?.message || e}`);
    }

    // 4) 面试卡片固定链接（一个简历一个链接，供面试官提醒 / 面试管理列展示 / 前端弹窗）
    try {
      const cfgRow = await c.env.DB.prepare('SELECT frontend_url FROM system_configs ORDER BY updated_at DESC LIMIT 1').first() as any;
      const cardBaseUrl = frontendBaseUrl(cfgRow?.frontend_url);
      const card = await createOrReuseInterviewCardLink(c.env.DB as D1Database, {
        resumeId: String(startCtx.interview.resume_id || '').trim() || undefined,
        candidateName: startCtx.candidateName !== '候选人' ? startCtx.candidateName : undefined,
        positionApplied: startCtx.positionName !== '应聘岗位' ? startCtx.positionName : undefined,
        createdBy: (c.get('user') as any)?.full_name || (c.get('user') as any)?.email || 'system',
      }, { now, uuid, hashPublicToken });
      startFlow.card_link = `${cardBaseUrl}${card.url}`;
    } catch (e: any) {
      startFlow.warnings.push(`面试卡片链接生成失败：${e?.message || e}`);
    }

    // 5) 面试官提醒①：创建日程后给主面试官发面试提醒（卡片 + 简历 + 卡片链接）（异步）
    const reminderUser = c.get('user') as { email?: string; full_name?: string } | undefined;
    c.executionCtx.waitUntil((async () => {
      try {
        const userToken = reminderUser?.email
          ? await getValidUserAccessToken(c.env, reminderUser.email)
          : null;
        const result = await sendInterviewerInterviewReminder(c.env, c.env.DB as D1Database, {
          interviewId: id,
          userToken: userToken || await getFeishuToken(c.env),
          operatorName: reminderUser?.full_name || reminderUser?.email || '系统',
          userEmail: reminderUser?.email,
          meetingLink: isOffline ? null : startFlow.meeting_link,
          interviewTypeLabel: isOffline ? '线下面试' : '线上面试',
        }, {
          now, uuid, hashPublicToken,
          getResumeFileBytes,
          getBotToken: getFeishuToken,
          refreshUserToken: async (email: string) => {
            const refreshed = await refreshUserAccessToken(c.env, email);
            return refreshed?.access_token || null;
          },
        });
        if (!result.ok) {
          console.warn(`[InterviewStart] 面试官提醒未发送: ${result.reason || '未知原因'}`);
        } else {
          console.log(`[InterviewStart] 面试官提醒已发送 ${result.interviewerName} link=${result.cardLinkUrl || '-'}`);
        }
      } catch (e: any) {
        console.error(`[InterviewStart] 面试官提醒异常: ${e?.message || e}`);
      }
    })());
  }

  const row = await c.env.DB.prepare('SELECT * FROM interviews WHERE id = ?').bind(id).first() as any;

  // 异步通知面试官（沿用原有逻辑）
  if (row) {
    c.executionCtx.waitUntil((async () => {
      try {
        // 找到对应简历信息
        const resumeId = row.resume_id;
        let candidateName = '未知';
        let positionName = '未知岗位';
        if (resumeId) {
          const resume = await c.env.DB.prepare('SELECT * FROM resumes WHERE id = ?').bind(resumeId).first() as any;
          if (resume) {
            candidateName = resume.candidate_name || '未知';
            const parsed = safeJsonParse(resume.parsed_data);
            positionName = (parsed && typeof parsed === 'object' && !Array.isArray(parsed)
              ? String((parsed as any).target_position || '')
              : '') || resume.mapped_position || resume.position_applied || '未知岗位';
          }
        }
        const fakeRecord = { candidate_name: candidateName, mapped_position: positionName, position_applied: positionName };
        await notifyInterviewersForCandidate(c.env, fakeRecord, c.get('user'));
      } catch (e: any) {
        console.error(`开始面试通知失败: ${e.message}`);
      }
    })());
  }

  return c.json({ ...transformRow(row), start_flow: startFlow });
});

// 从人才库一键开始面试 → 创建面试记录 + 通知面试官
app.post('/api/interviews/start-from-talent-pool/:talentId', authMiddleware, async (c) => {
  const talentId = c.req.param('talentId');
  const talent = await c.env.DB.prepare('SELECT * FROM talent_pool WHERE id = ?').bind(talentId).first() as any;
  if (!talent) return c.json({ detail: 'Talent not found' }, 404);

  const candidateName = talent.candidate_name || '未知';
  const posName = talent.position_applied || talent.current_title || '未知岗位';
  const resumeId = talent.resume_id || null;
  const city = talent.city || '';
  const aiEval = talent.ai_evaluation || '';

  // 创建面试记录
  const interviewId = uuid();
  await c.env.DB.prepare(
    `INSERT INTO interviews (id, resume_id, interviewer, status, created_at)
     VALUES (?, ?, ?, 'scheduled', ?)`
  ).bind(interviewId, resumeId, candidateName, now()).run();

  // 异步通知面试官
  c.executionCtx.waitUntil((async () => {
    try {
      const fakeRecord = {
        candidate_name: candidateName,
        mapped_position: posName,
        position_applied: posName,
        city: city,
        ai_analysis: aiEval,
      };
      await notifyInterviewersForCandidate(c.env, fakeRecord, c.get('user'));
    } catch (e: any) {
      console.error(`通知面试官失败: ${e.message}`);
    }
  })());

  const row = await c.env.DB.prepare('SELECT * FROM interviews WHERE id = ?').bind(interviewId).first();
  return c.json({ ...transformRow(row), talent_id: talentId });
});

// 删除面试记录
app.delete('/api/interviews/:id', authMiddleware, async (c) => {
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT id FROM interviews WHERE id = ?').bind(id).first();
  if (!existing) return c.json({ detail: '记录不存在' }, 404);
  await c.env.DB.prepare('DELETE FROM interviews WHERE id = ?').bind(id).run();
  return c.json({ ok: true, message: '已删除' });
});

app.post('/api/interviews/:id/cancel', authMiddleware, async (c) => {
  const id = c.req.param('id');
  const interview = await c.env.DB.prepare('SELECT * FROM interviews WHERE id = ?').bind(id).first() as any;
  if (!interview) return c.json({ detail: 'Interview not found' }, 404);
  if (interview.status === 'cancelled') {
    return c.json({ ok: true, id, status: 'cancelled', already_cancelled: true });
  }

  // 取消只改变面试状态，保留人才库、候选人和历史事实，便于恢复与审计。
  const updatedAt = now();
  await c.env.DB.prepare(
    "UPDATE interviews SET status = 'cancelled', updated_at = ? WHERE id = ?",
  ).bind(updatedAt, id).run();
  return c.json({ ok: true, id, status: 'cancelled' });
});

// 更新面试（编辑所有字段）
app.put('/api/interviews/:id', authMiddleware, async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const updates: string[] = [];
  const binds: any[] = [];
  const fields = ['position_applied', 'primary_interviewer', 'secondary_interviewer',
    'interview_time', 'interview_location', 'status', 'status2',
    'evaluation', 'evaluation2', 'result', 'result2'];
  for (const f of fields) {
    if (body[f] !== undefined) {
      updates.push(`${f} = ?`);
      binds.push(body[f]);
    }
  }
  if (updates.length > 0) {
    updates.push('updated_at = ?');
    binds.push(now());
    binds.push(id);
    await c.env.DB.prepare(`UPDATE interviews SET ${updates.join(', ')} WHERE id = ?`).bind(...binds).run();
  }
  const iv = await c.env.DB.prepare("SELECT * FROM interviews WHERE id=?").bind(id).first();
  return c.json(iv ? transformRow(iv) : null);
});

// 手动新建面试（status 默认 scheduled；编辑弹窗对未安排候选人传 awaiting_schedule 表示「待安排」）
app.post('/api/interviews', authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const id = crypto.randomUUID();
  const time = body.interview_time || '';
  const status = ['scheduled', 'awaiting_schedule', 'manual_review'].includes(String(body.status || ''))
    ? String(body.status)
    : 'scheduled';
  let position: any = null;
  try {
    position = await findPositionByName(c.env.DB, body.position_applied);
  } catch {}
  const assignment = resolveInterviewAssignments(body, position);
  await c.env.DB.prepare(
    `INSERT INTO interviews (id, candidate_name, position_id, position_applied, interviewer, primary_interviewer, secondary_interviewer, interview_time, interview_location, status, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(id, body.candidate_name || '', position?.id || '', position?.title || body.position_applied || '',
    assignment.interviewer, assignment.primaryInterviewer,
    assignment.secondaryInterviewer,
    time, body.interview_location || '', status, now()).run();
  // 埋点：面试安排创建
  await logOperation(c.env, {
    action: 'interview.create',
    entityType: 'interview',
    entityId: id,
    actor: c.get('user')?.email,
    detail: JSON.stringify({ candidate: body.candidate_name || '', time, interviewer: body.primary_interviewer || body.interviewer || '' }),
  });
  return c.json({ ok: true, id });
});

app.post('/api/interviews/:id/score', authMiddleware, async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  await c.env.DB.prepare('UPDATE interviews SET scores = ?, total_score = ?, comments = ?, evaluation = ?, suggestion = ?, status = ? WHERE id = ?')
    .bind(JSON.stringify(body.scores || {}), body.total_score, JSON.stringify(body.comments || {}), body.evaluation || '', body.suggestion || '', body.status || 'completed', id).run();
  // 埋点：面试打分
  await logOperation(c.env, {
    action: 'interview.score',
    entityType: 'interview',
    entityId: id,
    actor: c.get('user')?.email,
    detail: JSON.stringify({ total_score: body.total_score, status: body.status || 'completed' }),
  });
  const row = await c.env.DB.prepare('SELECT * FROM interviews WHERE id = ?').bind(id).first();
  return c.json(transformRow(row));
});

app.post('/api/interviews/:id/confirm', authMiddleware, async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  await c.env.DB.prepare('UPDATE interviews SET result = ?, status = ? WHERE id = ?').bind(body.result || 'passed', 'completed', id).run();
  const row = await c.env.DB.prepare('SELECT * FROM interviews WHERE id = ?').bind(id).first();
  return c.json(transformRow(row));
});

app.get('/api/interviews/export', authMiddleware, async (c) => {
  return c.json([]);
});

app.post('/api/positions/:id/ai-match', authMiddleware, async (c) => {
  const id = c.req.param('id');
  const position = await c.env.DB.prepare('SELECT * FROM positions WHERE id = ?').bind(id).first() as any;
  if (!position) return c.json({ detail: 'Position not found' }, 404);
  const resumes = await c.env.DB.prepare('SELECT id, candidate_name, resume_markdown, raw_text, match_score FROM resumes WHERE position_id = ?').bind(id).all();
  const posInfo = { title: position.title, description: position.description, requirements: position.requirements, department: position.department, salary_range: position.salary_range };
  const systemPrompt = 'You are an expert HR matching AI. Given a job position and a list of candidates, rank them by suitability. Respond in Chinese. Return a JSON array of objects with:\n- resume_id: the candidate id\n- candidate_name: the candidate name\n- match_score: integer 0-100\n- ranking_reason: brief reason for the ranking in Chinese';
  const candidateList = resumes.results.map((r: any) => ({ id: r.id, name: r.candidate_name, resume: (r.resume_markdown || r.raw_text || '').substring(0, 500) }));
  const userPrompt = `Position: ${JSON.stringify(posInfo)}\n\nCandidates:\n${JSON.stringify(candidateList, null, 2)}\n\nRank these candidates by suitability for the position. Return a JSON array.`;
  try {
    const result = await callAI(c.env, systemPrompt, userPrompt);
    let ranking: any[];
    try { ranking = extractJSON(result); if (!Array.isArray(ranking)) ranking = [ranking]; } catch { ranking = []; }
    return c.json({ position_id: id, rankings: ranking });
  } catch (err: any) {
    return c.json({ detail: 'AI matching failed', error: err.message }, 500);
  }
});

﻿// ==================== AI Enhancement Routes ====================

// SSE body helper: emit content chunk then a done marker
function sseBody(content: string): string {
  return `data: ${JSON.stringify({ content })}\n\ndata: ${JSON.stringify({ done: true })}\n\n`;
}

// 一键生成评分维度（能力维度）的默认提示词，可通过系统设置「提示词管理」覆盖
const DEFAULT_CAPABILITY_DIMENSIONS_PROMPT = {
  system: `你是一名资深招聘专家。根据岗位名称和岗位要求材料，将岗位要求拆解到固定的 7 个评分维度中，用于 AI 简历初筛打分。

固定维度及权重（严格按此输出这 7 个维度，不要增减、不要改名）：
1. 核心画像 — weight 25
2. 核心职责 — weight 22
3. 任职要求 — weight 22
4. 企业背景 — weight 13
5. 加分项 — weight 10
6. 关键词匹配 — weight 0（硬门槛，一票否决）
7. 避坑雷区 — weight 0（硬门槛，一票否决）

要求：
1. 只输出严格的 JSON 数组，不要包含 markdown 代码块标记或任何额外说明；
2. 每项格式为 {"name": "维度名称", "definition": "简要定义", "behavior": "典型行为表现或考察要点", "weight": 权重整数}；
3. definition 和 behavior 必须尽量摘录岗位要求材料中的原文，不要改写、不要总结归纳、不要自行补充材料中不存在的内容；材料中确实没有对应内容的维度填「无」；
4. weight 严格使用上面给定的固定值。`,
  user: `岗位名称：{position_title}

岗位要求材料：
{material}

{job_extra}

请根据以上内容，将岗位要求拆解到固定的 7 个评分维度中，输出 JSON 数组。`,
};

// AI 一键生成岗位评分维度（能力维度）：支持飞书链接或岗位要求文本
app.post('/api/positions/generate-capability-dimensions', authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { title, source_link, source_text, job_description, job_requirements } = body;
  const hasText = String(source_text || '').trim() || String(job_description || '').trim() || String(job_requirements || '').trim();
  if (!source_link && !hasText) {
    return c.json({ detail: '请提供飞书链接或岗位要求文本作为生成依据' }, 400);
  }

  let material = '';
  if (source_link && String(source_link).trim()) {
    try {
      material = await fetchFeishuLinkContent(c.env, String(source_link).trim(), c.env.FEISHU_APP_ID || FEISHU_CONFIG.appId);
    } catch (err: any) {
      return c.json({ detail: `飞书链接内容读取失败：${err.message}。请确认链接格式正确且当前飞书应用可访问，或改用「岗位要求文本」粘贴内容。` }, 422);
    }
  } else if (String(source_text || '').trim()) {
    material = String(source_text).trim();
  }
  const extra = [String(job_description || '').trim(), String(job_requirements || '').trim()].filter(Boolean).join('\n');

  // 参考来源元信息：让前端能核对 AI 实际依据了哪些内容，保证生成可追溯、可验证
  const trimmedLink = source_link ? String(source_link).trim() : '';
  const reference = {
    from_link: !!trimmedLink,
    source_link: trimmedLink,
    material_chars: material.length,
    material_preview: material.slice(0, 150),
    job_description_chars: String(job_description || '').trim().length,
    job_requirements_chars: String(job_requirements || '').trim().length,
  };

  const prompt = await getAIPrompt(c.env, 'generate_capability_dimensions', DEFAULT_CAPABILITY_DIMENSIONS_PROMPT);
  // user 模板支持变量插值：{position_title} / {material} / {job_extra}；未配置自定义模板时用默认
  const userTemplate = (prompt.user && String(prompt.user).trim()) ? String(prompt.user) : DEFAULT_CAPABILITY_DIMENSIONS_PROMPT.user;
  const userPrompt = userTemplate
    .replaceAll('{position_title}', title || '未指定')
    .replaceAll('{material}', material)
    .replaceAll('{job_extra}', extra ? `岗位职责/任职要求补充：\n${extra}` : '');
  try {
    const result = await callAI(c.env, prompt.system, userPrompt);
    let parsed: any = extractJSON(result);
    if (!Array.isArray(parsed)) {
      parsed = parsed && Array.isArray(parsed.dimensions) ? parsed.dimensions : [parsed];
    }
    const dimensions = normalizeCapabilityDimensionsForStorage(parsed);
    if (!dimensions.length) return c.json({ detail: 'AI 未能生成有效评分维度，请重试或调整输入内容' }, 502);
    return c.json({ dimensions, reference });
  } catch (err: any) {
    return c.json({ detail: 'AI 生成失败', error: err.message }, 500);
  }
});

// JD generation (streaming SSE, compatible with JDGeneratorModal)
app.post('/api/positions/generate-jd-stream', authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { title, department, location, salary_range } = body;
  if (!title) return c.json({ detail: 'position title required' }, 400);
  const prompt = await getAIPrompt(c.env, 'generate_jd', {
    system: `你是一名资深招聘专家。根据职位信息生成专业的职位描述(JD)。只用中文回答。返回严格的 JSON,格式为 {"description": "详细职责描述", "requirements": "任职要求,多条用换行分隔"}。不要包含 markdown 代码块标记或额外说明。`,
    user: ''
  });
  const systemPrompt = prompt.system;
  const userPrompt = `职位名称: ${title}\n部门: ${department || '未指定'}\n工作地点: ${location || '未指定'}\n薪资范围: ${salary_range || '面议'}\n\n请生成该职位的详细职责描述和任职要求。`;
  try {
    const result = await callAI(c.env, systemPrompt, userPrompt);
    return new Response(jdSSEBody(result), { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } });
  } catch (err: any) {
    return new Response(`data: ${JSON.stringify({ error: err.message })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
  }
});

// JD refinement chat (streaming SSE)
app.post('/api/positions/chat-jd-stream', authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const messages: any[] = body.messages || [];
  const currentDesc = body.current_description || '';
  const currentReq = body.current_requirements || '';
  const userMsgs = messages.filter((m: any) => m.role === 'user').map((m: any) => m.content).join('\n');
  const prompt = await getAIPrompt(c.env, 'generate_jd', {
    system: `你是一名资深招聘专家,正在帮用户修改职位描述(JD)。根据用户反馈修改当前 JD。只用中文回答。返回严格的 JSON: {"description": "修改后的详细职责描述", "requirements": "修改后的任职要求"}。不要包含 markdown 代码块标记或额外说明。`,
    user: ''
  });
  const systemPrompt = prompt.system;
  const userPrompt = `当前职位描述:\n${currentDesc}\n\n当前任职要求:\n${currentReq}\n\n用户修改意见:\n${userMsgs || '请优化完善'}\n\n请据此修改 JD 并返回完整 JSON。`;
  try {
    const result = await callAI(c.env, systemPrompt, userPrompt);
    return new Response(jdSSEBody(result), { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } });
  } catch (err: any) {
    return new Response(`data: ${JSON.stringify({ error: err.message })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
  }
});

// Interview comprehensive AI analysis — generates evaluation + suggestion
app.post('/api/interviews/:id/ai-analysis', authMiddleware, async (c) => {
  const id = c.req.param('id');
  const interview = await c.env.DB.prepare('SELECT * FROM interviews WHERE id = ?').bind(id).first() as any;
  if (!interview) return c.json({ detail: 'Interview not found' }, 404);
  let resume: any = null;
  if (interview.resume_id) resume = await c.env.DB.prepare('SELECT id, candidate_name, resume_markdown, raw_text, match_score FROM resumes WHERE id = ?').bind(interview.resume_id).first() as any;
  let position: any = null;
  if (interview.position_id) position = await c.env.DB.prepare('SELECT title, description, requirements, department FROM positions WHERE id = ?').bind(interview.position_id).first() as any;

  let scores: Record<string, number> = {};
  let comments: Record<string, string> = {};
  let questions: any[] = [];
  try { scores = JSON.parse(interview.scores || '{}'); } catch {}
  try { comments = JSON.parse(interview.comments || '{}'); } catch {}
  try { questions = JSON.parse(interview.questions || '[]'); } catch {}

  const scoreList = Object.entries(scores).map(([k, v]) => `第${Number(k) + 1}题: ${v}分`).join('; ');
  const commentList = Object.entries(comments).map(([k, v]) => `第${Number(k) + 1}题评语: ${v}`).join('\n');
  const questionList = questions.map((q: any, i: number) => `${i + 1}. ${q.question || q.title || ''} (类型:${q.type || '未分类'}, 难度:${q.difficulty || '未知'})`).join('\n');
  const scoreValues = Object.values(scores);
  const avg = scoreValues.length > 0 ? (scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length).toFixed(1) : 'N/A';

  const prompt = await getAIPrompt(c.env, 'generate_interview_evaluation', {
    system: `你是一名资深招聘面试官 AI。根据面试评分、面试官评语、面试题表现和候选人简历,生成一份结构化的候选人面试综合评估报告。用中文回答,使用 Markdown 格式,包含以下部分:## 综合评价、## 候选人优势、## 风险与不足、## 改进建议、## 录用建议。在"## 录用建议"部分给出明确结论(推荐录用/待定/不推荐)和简短理由。`,
    user: ''
  });
  const systemPrompt = prompt.system;
  const userPrompt = `候选人: ${resume?.candidate_name || '未知'}\n应聘岗位: ${position?.title || '未知'}\n岗位要求: ${position?.requirements || '无'}\n平均得分: ${avg}/10\n\n面试题:\n${questionList || '无'}\n\n评分明细: ${scoreList || '无'}\n\n面试官评语:\n${commentList || '无'}\n\n候选人简历摘要:\n${(resume?.resume_markdown || resume?.raw_text || '').substring(0, 800)}\n\n请生成综合评估报告。`;

  try {
    const evaluation = await callAI(c.env, systemPrompt, userPrompt);
    let suggestion = '';
    const m = evaluation.match(/录用建议[：:]*\s*([^\n]+)/);
    if (m) suggestion = m[1].trim();
    if (!suggestion) suggestion = evaluation.slice(-100).replace(/[#*\n]/g, '').trim();
    await c.env.DB.prepare('UPDATE interviews SET evaluation = ?, suggestion = ?, result = ? WHERE id = ?')
      .bind(evaluation, suggestion, 'pending', id).run();
    const row = await c.env.DB.prepare('SELECT * FROM interviews WHERE id = ?').bind(id).first();
    return c.json(transformRow(row));
  } catch (err: any) {
    return c.json({ detail: 'AI analysis failed', error: err.message }, 500);
  }
});

// AI recommend positions for a talent pool candidate
app.post('/api/talent-pool/:id/ai-recommend', authMiddleware, async (c) => {
  const id = c.req.param('id');
  const talent = await c.env.DB.prepare('SELECT * FROM talent_pool WHERE id = ?').bind(id).first() as any;
  if (!talent) return c.json({ detail: 'Talent not found' }, 404);
  const positions = await c.env.DB.prepare("SELECT id, title, department, requirements, salary_range, status FROM positions WHERE status IN ('open','published') ORDER BY created_at DESC LIMIT 20").all();
  const systemPrompt = '你是一名资深猎头 AI。根据候选人背景和现有在招岗位,推荐最合适的岗位并说明理由。只用中文回答。返回 JSON 数组,每项含 {"position_id": "岗位ID", "position_title": "岗位名称", "match_score": 0-100整数, "reason": "推荐理由"}。不要包含 markdown 代码块标记或额外说明。';
  const candidateInfo = { name: talent.candidate_name, current_title: talent.current_title, skills: talent.skills, experience_years: talent.experience_years, education: talent.education, expected_salary: talent.expected_salary, tags: talent.tags };
  const userPrompt = `候选人信息:\n${JSON.stringify(candidateInfo, null, 2)}\n\n在招岗位列表:\n${JSON.stringify(positions.results.map((p: any) => ({ id: p.id, title: p.title, department: p.department, requirements: p.requirements, salary_range: p.salary_range })), null, 2)}\n\n请推荐最匹配的岗位(最多5个),按匹配度从高到低排序。`;
  try {
    const result = await callAI(c.env, systemPrompt, userPrompt);
    let recommendations: any[];
    try { recommendations = extractJSON(result); if (!Array.isArray(recommendations)) recommendations = [recommendations]; } catch { recommendations = []; }
    return c.json({ talent_id: id, recommendations });
  } catch (err: any) {
    return c.json({ detail: 'AI recommend failed', error: err.message }, 500);
  }
});

// AI probation assessment from monthly reviews
app.post('/api/probation/:id/ai-assessment', authMiddleware, async (c) => {
  const id = c.req.param('id');
  const record = await c.env.DB.prepare('SELECT * FROM probation_records WHERE id = ?').bind(id).first() as any;
  if (!record) return c.json({ detail: 'Probation record not found' }, 404);
  let reviews: any[] = [];
  try { reviews = JSON.parse(record.monthly_reviews || '[]'); } catch {}
  let position: any = null;
  if (record.position_id) position = await c.env.DB.prepare('SELECT title, requirements FROM positions WHERE id = ?').bind(record.position_id).first() as any;
  const prompt = await getAIPrompt(c.env, 'generate_interview_evaluation', {
    system: `你是一名资深 HR 顾问 AI。根据员工试用期月度评审记录,生成试用期综合评估报告。用中文回答,使用 Markdown 格式,包含:## 总体表现、## 优势、## 不足与改进、## 转正建议(明确给出建议转正/延长试用期/不予转正及理由)。`,
    user: ''
  });
  const systemPrompt = prompt.system;
  const userPrompt = `员工: ${record.employee_name}\n岗位: ${position?.title || '未知'}\n岗位要求: ${position?.requirements || '无'}\n试用期月数: ${record.probation_months || 3}\n\n月度评审记录:\n${reviews.length > 0 ? JSON.stringify(reviews, null, 2) : '暂无月度评审记录'}\n\n请生成试用期综合评估报告。`;
  try {
    const assessment = await callAI(c.env, systemPrompt, userPrompt);
    await c.env.DB.prepare('UPDATE probation_records SET final_assessment = ?, updated_at = ? WHERE id = ?')
      .bind(assessment, now(), id).run();
    const row = await c.env.DB.prepare('SELECT * FROM probation_records WHERE id = ?').bind(id).first();
    return c.json(transformRow(row));
  } catch (err: any) {
    return c.json({ detail: 'AI assessment failed', error: err.message }, 500);
  }
});

// AI generate/refine job description from a requisition
app.post('/api/requisitions/:id/ai-jd', authMiddleware, async (c) => {
  const id = c.req.param('id');
  const req = await c.env.DB.prepare('SELECT * FROM job_requisitions WHERE id = ? OR feishu_record_id = ?').bind(id, id).first() as any;
  if (!req) return c.json({ detail: 'Requisition not found' }, 404);
  const prompt = await getAIPrompt(c.env, 'generate_jd', {
    system: `你是一名资深招聘专家。根据招聘需求信息生成专业的职位描述和任职要求。只用中文回答。返回严格的 JSON: {"description": "详细职责描述", "requirements": "任职要求,多条用换行分隔"}。不要包含 markdown 代码块标记或额外说明。`,
    user: ''
  });
  const systemPrompt = prompt.system;
  const userPrompt = `职位名称: ${req.title}\n部门: ${req.department}\n招聘人数: ${req.headcount || 1}\n用工类型: ${req.employment_type || 'full_time'}\n薪资范围: ${req.salary_range || '面议'}\n紧急程度: ${req.urgency || 'medium'}\n现有描述: ${req.description || '无'}\n现有要求: ${req.requirements || '无'}\n\n请生成或完善该职位的描述和任职要求。`;
  try {
    const result = await callAI(c.env, systemPrompt, userPrompt);
    if (!result || !result.trim()) {
      return c.json({ detail: 'AI 未返回有效内容，请检查「AI 模型配置」中的 API Key 是否有效（DeepSeek key 失效或额度不足会导致此问题）' }, 500);
    }
    const parsed = parseJDResult(result);
    if (!parsed.description && !parsed.requirements) {
      return c.json({ detail: 'AI 返回内容无法解析为 JD 结构，请检查模型配置或稍后重试' }, 500);
    }
    await c.env.DB.prepare('UPDATE job_requisitions SET description = ?, requirements = ?, updated_at = ? WHERE id = ? OR feishu_record_id = ?')
      .bind(parsed.description, parsed.requirements, now(), id, id).run();
    const row = await c.env.DB.prepare('SELECT * FROM job_requisitions WHERE id = ? OR feishu_record_id = ?').bind(id, id).first();
    return c.json(transformRow(row));
  } catch (err: any) {
    return c.json({ detail: 'AI generate failed', error: err.message }, 500);
  }
});


// ==================== Requisition Actions ====================

app.post('/api/requisitions/:id/approve', authMiddleware, async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  await c.env.DB.prepare("UPDATE job_requisitions SET status = 'approved', approved_by = ?, approved_at = ? WHERE id = ?").bind(user.id, now(), id).run();
  const row = await c.env.DB.prepare('SELECT * FROM job_requisitions WHERE id = ?').bind(id).first();
  return c.json(transformRow(row));
});

app.post('/api/requisitions/:id/reject', authMiddleware, async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  await c.env.DB.prepare("UPDATE job_requisitions SET status = 'rejected', rejection_reason = ? WHERE id = ?").bind(body.reason || '', id).run();
  const row = await c.env.DB.prepare('SELECT * FROM job_requisitions WHERE id = ?').bind(id).first();
  return c.json(transformRow(row));
});

// ==================== Talent Pool Actions ====================

app.post('/api/talent-pool/:id/contact', authMiddleware, async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare("UPDATE talent_pool SET status = 'contacted', last_contacted_at = ? WHERE id = ?").bind(now(), id).run();
  const row = await c.env.DB.prepare('SELECT * FROM talent_pool WHERE id = ?').bind(id).first();
  return c.json(transformRow(row));
});

// ==================== Probation Actions ====================

app.post('/api/probation/:id/confirm', authMiddleware, async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  await c.env.DB.prepare("UPDATE probation_records SET result = ?, confirmed_at = ?, confirmed_by = ?, new_title = ?, salary_adjustment = ? WHERE id = ?")
    .bind(body.result || 'confirmed', now(), user.id, body.new_title || null, body.salary_adjustment || null, id).run();
  const row = await c.env.DB.prepare('SELECT * FROM probation_records WHERE id = ?').bind(id).first();
  return c.json(transformRow(row));
});

app.post('/api/probation/:id/review', authMiddleware, async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const existing = await c.env.DB.prepare('SELECT monthly_reviews FROM probation_records WHERE id = ?').bind(id).first();
  let reviews = [];
  if (existing?.monthly_reviews) { try { reviews = JSON.parse(existing.monthly_reviews); } catch { reviews = []; } }
  reviews.push(body);
  await c.env.DB.prepare('UPDATE probation_records SET monthly_reviews = ? WHERE id = ?').bind(JSON.stringify(reviews), id).run();
  return c.json({ detail: 'Review added' });
});

// ==================== Workflow Actions ====================

app.post('/api/workflows/:id/publish', authMiddleware, async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare("UPDATE workflows SET status = 'published', published_at = ? WHERE id = ?").bind(now(), id).run();
  const row = await c.env.DB.prepare('SELECT * FROM workflows WHERE id = ?').bind(id).first();
  return c.json(transformRow(row));
});

app.post('/api/workflows/:id/execute', authMiddleware, async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const execId = uuid();
  await c.env.DB.prepare(
    'INSERT INTO workflow_executions (id, workflow_id, status, trigger_type, triggered_by, started_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(execId, id, 'running', 'manual', user.id, now(), now()).run();
  const row = await c.env.DB.prepare('SELECT * FROM workflow_executions WHERE id = ?').bind(execId).first();
  return c.json(transformRow(row));
});

// ==================== Settings Routes ====================

app.get('/api/settings/system', authMiddleware, requireRole(['admin']), async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM system_configs ORDER BY updated_at DESC LIMIT 1').first();
  if (!row) return c.json({});
  const result = transformRow(row);
  // 安全处理：不返回完整 API Key，仅返回是否已设置及末4位（兼容旧 llm*_api_key 列）
  for (const suffix of ['', '2', '3', '4']) {
    const key = `llm${suffix}_api_key`;
    const rawKey = String(row[key] || '').trim();
    result[`llm${suffix}_api_key_set`] = rawKey.length > 0;
    result[`llm${suffix}_api_key_last4`] = rawKey.length >= 4 ? rawKey.slice(-4) : null;
    delete result[key];
  }
  // 将 llm_slots JSON 列解包为扁平字段（兼容前端旧版本读取）；若列为 null/空则保留旧列的 _set/_last4 标记
  if (result.llm_slots && Array.isArray(result.llm_slots)) {
    // 存量数据补齐稳定 id（一次性修复：无 id 的旧槽位在前端保存时可能被过滤丢失）
    let needPersist = false;
    const persistSlots = result.llm_slots.map((s: any) => {
      if (!s.id) needPersist = true;
      return {
        id: s.id || uuid(),
        baseUrl: String(s.baseUrl || s.base_url || '').trim(),
        model: String(s.model || '').trim(),
        apiKey: String(s.apiKey || s.api_key || '').trim(),
      };
    });
    result.llm_slots = persistSlots.map((s: any) => ({
      id: s.id,
      baseUrl: s.baseUrl,
      model: s.model,
      apiKey: '', // 安全：绝不回填完整 API Key，仅提供是否已设置与末4位
      apiKeySet: !!(s.apiKey && String(s.apiKey).trim()),
      apiKeyLast4: s.apiKey && String(s.apiKey).trim().length >= 4 ? String(s.apiKey).trim().slice(-4) : null,
    }));
    if (needPersist && row.id) {
      try {
        await c.env.DB.prepare('UPDATE system_configs SET llm_slots = ?, updated_at = ? WHERE id = ?')
          .bind(JSON.stringify(persistSlots), now(), row.id).run();
      } catch { /* 补齐失败不影响本次读取 */ }
    }
  }
  return c.json(result);
});

app.put('/api/settings/system', authMiddleware, requireRole(['admin']), async (c) => {
  const body = await c.req.json();
  const existing = await c.env.DB.prepare('SELECT id FROM system_configs ORDER BY updated_at DESC LIMIT 1').first();

  // 其余字段按通用规则持久化（llm_slots 单独处理，避免空数组被跳过或覆盖已有数据）
  const otherBody = { ...body };
  delete otherBody.llm_slots;

  // 1) llm_slots 处理：
  //    - 请求携带 llm_slots 时：合并保存（未重填 key 的已存槽位沿用原 key + 精确去重）
  //    - 请求未携带且旧列为空时：从旧 4 槽位（llm*/llm2*/llm3*/llm4*）自动迁移
  let llmSlotsJson: string | null = null;
  const hasBodySlots = Object.prototype.hasOwnProperty.call(body, 'llm_slots');
  if (hasBodySlots) {
    const curRow = existing
      ? await c.env.DB.prepare('SELECT llm_slots FROM system_configs WHERE id = ?').bind(existing.id).first().catch(() => null) as any
      : null;
    llmSlotsJson = JSON.stringify(mergeLlmSlots(curRow?.llm_slots, body.llm_slots));
  } else if (existing) {
    try {
      const row = await c.env.DB.prepare('SELECT llm_slots FROM system_configs WHERE id = ?').bind(existing.id).first() as any;
      if (!row?.llm_slots || row.llm_slots === 'null' || row.llm_slots === '') {
        const oldRow = await c.env.DB.prepare(
          'SELECT llm_api_key, llm_base_url, llm_model, llm2_api_key, llm2_base_url, llm2_model, llm3_api_key, llm3_base_url, llm3_model, llm4_api_key, llm4_base_url, llm4_model FROM system_configs WHERE id = ?'
        ).bind(existing.id).first() as any;
        if (oldRow) {
          const oldSlots = [
            { apiKey: oldRow.llm_api_key, baseUrl: oldRow.llm_base_url, model: oldRow.llm_model },
            { apiKey: oldRow.llm2_api_key, baseUrl: oldRow.llm2_base_url, model: oldRow.llm2_model },
            { apiKey: oldRow.llm3_api_key, baseUrl: oldRow.llm3_base_url, model: oldRow.llm3_model },
            { apiKey: oldRow.llm4_api_key, baseUrl: oldRow.llm4_base_url, model: oldRow.llm4_model },
          ].filter((s: any) => s.apiKey && String(s.apiKey).trim());
          if (oldSlots.length > 0) {
            llmSlotsJson = JSON.stringify(oldSlots.map((s: any) => ({ id: uuid(), ...s })));
          }
        }
      }
    } catch {}
  }

  // 2) 写入其他字段 + llm_slots
  if (existing) {
    const cols: string[] = [];
    const vals: any[] = [];
    if (llmSlotsJson !== null) { cols.push('llm_slots'); vals.push(llmSlotsJson); }
    for (const [k, v] of Object.entries(otherBody)) {
      if (shouldPersistSystemConfigField(k, v)) {
        cols.push(k);
        vals.push(prepareValue(v));
      }
    }
    cols.push('updated_at'); vals.push(now());
    const setClause = cols.map(k => `${k} = ?`).join(', ');
    await c.env.DB.prepare(`UPDATE system_configs SET ${setClause} WHERE id = ?`).bind(...vals, existing.id).run();
  } else {
    const id = uuid();
    const cols = ['id', 'updated_at'];
    const vals: any[] = [id, now()];
    if (llmSlotsJson !== null) { cols.push('llm_slots'); vals.push(llmSlotsJson); }
    for (const [k, v] of Object.entries(otherBody)) {
      if (shouldPersistSystemConfigField(k, v)) {
        cols.push(k);
        vals.push(prepareValue(v));
      }
    }
    const placeholders = cols.map(() => '?').join(', ');
    await c.env.DB.prepare(`INSERT INTO system_configs (${cols.join(', ')}) VALUES (${placeholders})`).bind(...vals).run();
  }
  const row = await c.env.DB.prepare('SELECT * FROM system_configs ORDER BY updated_at DESC LIMIT 1').first();
  return c.json(transformRow(row));
});

app.get('/api/settings/screening-rules', authMiddleware, requireRole(['admin']), async (c) => {
  const row = await c.env.DB.prepare(
    'SELECT screening_rules FROM system_configs ORDER BY updated_at DESC LIMIT 1'
  ).first() as any;
  const resolved = resolveScreeningRules(row?.screening_rules);
  return c.json({
    rules: {
      keyword_match_min_score: resolved.keyword_match_min_score,
      red_flag_min_score: resolved.red_flag_min_score,
      weighted_score_min: resolved.weighted_score_min,
    },
    source: resolved.source,
    defaults: DEFAULT_SCREENING_RULES,
  });
});

app.put('/api/settings/screening-rules', authMiddleware, requireRole(['admin']), async (c) => {
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  const allowedKeys = ['keyword_match_min_score', 'red_flag_min_score', 'weighted_score_min'];
  if (!body || Object.keys(body).length !== allowedKeys.length || allowedKeys.some((key) => !Object.prototype.hasOwnProperty.call(body, key))) {
    return c.json({ detail: '必须完整提供三个初筛阈值字段' }, 400);
  }

  const rules = normalizeScreeningRuleValues(body);
  if (!rules) return c.json({ detail: '初筛阈值必须是 0-5 范围内的合法数值' }, 400);

  const existing = await c.env.DB.prepare(
    'SELECT id FROM system_configs ORDER BY updated_at DESC LIMIT 1'
  ).first() as any;
  const serialized = JSON.stringify(rules);
  if (existing?.id) {
    await c.env.DB.prepare('UPDATE system_configs SET screening_rules = ?, updated_at = ? WHERE id = ?')
      .bind(serialized, now(), existing.id).run();
  } else {
    await c.env.DB.prepare('INSERT INTO system_configs (id, screening_rules, updated_at) VALUES (?, ?, ?)')
      .bind(uuid(), serialized, now()).run();
  }

  return c.json({ rules, source: 'system', defaults: DEFAULT_SCREENING_RULES });
});

// 连通性测试：对指定模型配置发一条最小的 Chat Completions 请求，验证可达且可用。
// 支持两种入参：显式传 { base_url, model, api_key } 测试未保存的临时值；
// 或传 { index } 测试已保存的第 index（0~3）组配置（用于表单中 Key 未回显的场景）。
app.post('/api/settings/system/test', authMiddleware, requireRole(['admin']), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  let baseUrl = normalizeBaseUrl(body.base_url);
  let model = String(body.model || '').trim();
  let apiKey = String(body.api_key || '').trim();

  if (!apiKey && body.index !== undefined) {
    // 优先读新格式：llm_slots[index]
    const row = await c.env.DB.prepare('SELECT llm_slots FROM system_configs ORDER BY updated_at DESC LIMIT 1').first() as any;
    const slots = Array.isArray(row?.llm_slots) ? row.llm_slots : [];
    const slot = slots[Number(body.index)];
    if (slot?.apiKey) {
      apiKey = String(slot.apiKey).trim();
      baseUrl = normalizeBaseUrl(slot.baseUrl) || baseUrl;
      model = String(slot.model || '').trim() || model;
    } else {
      // 回退旧 4 槽位列
      const prefix = ['llm', 'llm2', 'llm3', 'llm4'][Number(body.index)] || 'llm';
      const r2 = await c.env.DB.prepare(
        `SELECT ${prefix}_base_url, ${prefix}_model, ${prefix}_api_key FROM system_configs ORDER BY updated_at DESC LIMIT 1`
      ).first() as any;
      if (r2?.[`${prefix}_api_key`]) {
        apiKey = String(r2[`${prefix}_api_key`]).trim();
        baseUrl = normalizeBaseUrl(r2[`${prefix}_base_url`]) || baseUrl;
        model = String(r2[`${prefix}_model`] || '').trim() || model;
      }
    }
  }

  if (!baseUrl || !model || !apiKey) {
    return c.json({ ok: false, message: '请完整填写 Base URL / 模型名称 / API Key 后再测试' }, 400);
  }
  const url = baseUrl.endsWith('/v1') ? `${baseUrl}/chat/completions` : `${baseUrl}/v1/chat/completions`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20_000);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
      }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const errText = (await resp.text()).slice(0, 200);
      return c.json({ ok: false, message: `HTTP ${resp.status}：${errText}` });
    }
    const data: any = await resp.json().catch(() => null);
    const content = data?.choices?.[0]?.message?.content;
    if (content === undefined) {
      return c.json({ ok: false, message: '响应格式异常：未返回 choices[0].message.content' });
    }
    return c.json({ ok: true, message: '连接成功，模型可用' });
  } catch (e: any) {
    const msg = e?.name === 'AbortError' ? '连接超时（20 秒）' : String(e?.message || e).slice(0, 200);
    return c.json({ ok: false, message: msg });
  } finally {
    clearTimeout(timeoutId);
  }
});

app.get('/api/settings/mail', authMiddleware, async (c) => {
  const row = await c.env.DB.prepare('SELECT smtp_host, smtp_port, smtp_username, smtp_password, mail_from, mail_from_name, mail_enabled, frontend_url FROM system_configs ORDER BY updated_at DESC LIMIT 1').first();
  const data = transformRow(row) || {};
  delete data.smtp_password; // 密码不回显
  return c.json({ ...data, smtp_password_set: Boolean((row as any)?.smtp_password) });
});

// 保存 SMTP 配置（邮件设置页）。smtp_password 仅在提供非空值时覆盖，避免误清空。
app.put('/api/settings/mail', authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const str = (v: any): string | null => (typeof v === 'string' ? v.trim() : null);

  const fields: Record<string, any> = {
    smtp_host: str(body.smtp_host),
    smtp_port: Number(body.smtp_port) || 465,
    smtp_username: str(body.smtp_username),
    mail_from: str(body.mail_from),
    mail_from_name: str(body.mail_from_name) || '招聘系统',
    mail_enabled: body.mail_enabled ? 1 : 0,
    frontend_url: str(body.frontend_url),
    updated_at: now(),
  };
  if (typeof body.smtp_password === 'string' && body.smtp_password.trim()) {
    fields.smtp_password = body.smtp_password.trim();
  }

  const existing = await c.env.DB.prepare('SELECT id FROM system_configs ORDER BY updated_at DESC LIMIT 1').first() as any;
  const rowId = existing?.id || uuid();

  if (existing) {
    const sets = Object.keys(fields).map((k) => `${k} = ?`).join(', ');
    await c.env.DB.prepare(`UPDATE system_configs SET ${sets} WHERE id = ?`)
      .bind(...Object.values(fields), rowId).run();
  } else {
    const cols = Object.keys(fields);
    await c.env.DB.prepare(`INSERT INTO system_configs (id, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`)
      .bind(rowId, ...Object.values(fields)).run();
  }

  const row = await c.env.DB.prepare('SELECT smtp_host, smtp_port, smtp_username, mail_from, mail_from_name, mail_enabled, frontend_url, smtp_password FROM system_configs WHERE id = ?').bind(rowId).first() as any;
  return c.json({
    ok: true,
    smtp_host: row?.smtp_host || null,
    smtp_port: row?.smtp_port ?? 465,
    smtp_username: row?.smtp_username || null,
    mail_from: row?.mail_from || null,
    mail_from_name: row?.mail_from_name || '招聘系统',
    mail_enabled: row?.mail_enabled ?? 0,
    frontend_url: row?.frontend_url || null,
    smtp_password_set: Boolean(row?.smtp_password),
  });
});

app.get('/api/settings/prompts', authMiddleware, async (c) => {
  const row = await c.env.DB.prepare('SELECT prompt_configs FROM system_configs ORDER BY updated_at DESC LIMIT 1').first();
  if (!row?.prompt_configs) return c.json({ prompts: { generate_capability_dimensions: { ...DEFAULT_CAPABILITY_DIMENSIONS_PROMPT } } });
  try {
    const configs = JSON.parse(row.prompt_configs);
    // 确保返回的结构始终包含 prompts 字段
    const result = typeof configs.prompts === 'object' ? configs : { prompts: configs };
    // 过滤掉已废弃的提示词 key（不展示在前端）
    const deprecatedKeys = ['analyze_resume', 'generate_interview_questions', 'generate_interview_evaluation', 'generate_interview_evaluation_from_transcript', 'generate_coding_test_evaluation'];
    for (const key of deprecatedKeys) {
      delete result.prompts[key];
    }
    for (const key of ['resume_screening', 'resume_screening_supplement']) {
      const prompt = result.prompts[key];
      if (prompt?.system && prompt?.user) {
        result.prompts[key] = normalizeScreeningPrompt(key, prompt);
      }
    }
    // 自定义筛选提示词模板始终可调节：未保存过则注入默认模板（避免老用户看不到该 tab）
    if (!result.prompts.resume_custom_screen?.system || !result.prompts.resume_custom_screen?.user) {
      result.prompts.resume_custom_screen = { ...DEFAULT_CUSTOM_SCREEN_PROMPT };
    }
    // 评分维度生成提示词：未保存过则注入默认模板，保证「提示词管理」可见可编辑
    if (!result.prompts.generate_capability_dimensions?.system || !result.prompts.generate_capability_dimensions?.user) {
      result.prompts.generate_capability_dimensions = { ...DEFAULT_CAPABILITY_DIMENSIONS_PROMPT };
    }
    return c.json(result);
  } catch { return c.json({ prompts: {} }); }
});

// 变量列表必须在 :key 通配路由之前注册
app.get('/api/settings/prompts/variables', authMiddleware, async (c) => {
  const variables_by_prompt: Record<string, Array<{ name: string; description: string }>> = {
    generate_jd: [
      { name: 'position_title', description: '岗位名称' },
      { name: 'department', description: '所属部门' },
      { name: 'requirements', description: '岗位要求' },
      { name: 'salary_range', description: '薪资范围' },
    ],

    generate_resume_markdown: [
      { name: 'candidate_name', description: '候选人姓名' },
      { name: 'resume_text', description: '简历原始文本' },
      { name: 'position', description: '应聘岗位' },
    ],
    parse_resume_pdf: [
      { name: 'candidate_name', description: '候选人姓名（从文件名提取）' },
      { name: 'resume_text', description: '简历PDF的base64文本内容' },
    ],
    generate_daily_report: [
      { name: 'report_date', description: '日报日期' },
      { name: 'stats_data', description: '统计数据（JSON格式）' },
    ],
    resume_extract_fields: [
      { name: 'resume_text', description: '简历原始文本' },
    ],
    resume_screening: [
      { name: 'position', description: '应聘岗位' },
      { name: 'resume_text', description: '简历原始文本' },
      { name: 'fields', description: '已提取的简历字段（JSON格式）' },
      { name: 'capability_dimensions', description: '能力维度清单（含描述）' },
    ],
    resume_screening_supplement: [
      { name: 'resume_text', description: '简历原始文本' },
      { name: 'fields', description: '已提取的简历字段（JSON格式）' },
      { name: 'capability_dimensions', description: '能力维度清单（含描述）' },
      { name: 'job_description', description: '岗位职责与要求' },
      { name: 'personalized_requirements', description: '个性化需求' },
      { name: 'missing_dimensions', description: '缺失待补充的能力维度名称' },
    ],
    resume_custom_screen: [
      { name: 'position', description: '应聘岗位' },
      { name: 'condition', description: '自定义筛选条件' },
      { name: 'resumes', description: '待评估的简历列表（每份含 #id 前缀）' },
    ],
    generate_capability_dimensions: [
      { name: 'position_title', description: '岗位名称' },
      { name: 'material', description: '岗位要求材料（飞书链接抓取内容或粘贴文本）' },
      { name: 'job_extra', description: '岗位职责/任职要求补充信息' },
    ],
  };
  const all_variables: Record<string, string> = {};
  for (const [, vars] of Object.entries(variables_by_prompt)) {
    for (const v of vars) {
      if (!all_variables[v.name]) {
        all_variables[v.name] = v.description;
      }
    }
  }
  return c.json({ variables_by_prompt, all_variables });
});

app.get('/api/settings/prompts/:key', authMiddleware, async (c) => {
  const row = await c.env.DB.prepare('SELECT prompt_configs FROM system_configs ORDER BY updated_at DESC LIMIT 1').first();
  if (!row?.prompt_configs) return c.json({ detail: 'Not found' }, 404);
  try {
    const configs = JSON.parse(row.prompt_configs);
    const key = c.req.param('key');
    const prompt = configs.prompts?.[key] || configs[key];
    if (!prompt) return c.json({ detail: 'Not found' }, 404);
    return c.json(
      prompt?.system && prompt?.user ? normalizeScreeningPrompt(key, prompt) : prompt,
    );
  } catch { return c.json({ detail: 'Not found' }, 404); }
});

app.put('/api/settings/prompts/:key', authMiddleware, async (c) => {
  try {
    const key = c.req.param('key');
    const body = await c.req.json();
    const { system, user } = body;
    if (!system || !user) {
      return c.json({ detail: 'system 和 user 字段为必填' }, 400);
    }
    const normalizedPrompt = normalizeScreeningPrompt(key, { system, user });

    const row = await c.env.DB.prepare('SELECT id, prompt_configs FROM system_configs ORDER BY updated_at DESC LIMIT 1').first();
    let configs: any = {};
    if (row?.prompt_configs) {
      try { configs = JSON.parse(row.prompt_configs); } catch { configs = {}; }
    }
    if (!configs.prompts) configs.prompts = {};
    configs.prompts[key] = normalizedPrompt;

    if (row) {
      await c.env.DB.prepare('UPDATE system_configs SET prompt_configs = ?, updated_at = ? WHERE id = ?')
        .bind(JSON.stringify(configs), now(), (row as any).id).run();
    } else {
      const id = uuid();
      await c.env.DB.prepare('INSERT INTO system_configs (id, prompt_configs, updated_at) VALUES (?, ?, ?)')
        .bind(id, JSON.stringify(configs), now()).run();
    }
    return c.json({ detail: 'Prompt updated', key });
  } catch (e: any) {
    return c.json({ detail: '更新失败: ' + e.message }, 500);
  }
});

// 初始化默认提示词模版
app.post('/api/settings/prompts/seed-defaults', authMiddleware, async (c) => {
  const now = new Date().toISOString();
  const defaults: Record<string, { system: string; user: string }> = {
    generate_jd: {
      system: '你是一位资深的招聘专家和岗位分析师。请根据提供的岗位信息，生成一份专业、详细的职位描述(JD)。',
      user: '请根据以下岗位信息生成JD：\n\n岗位名称：{candidate_name}\n部门：{department}\n\n请包括：岗位职责、任职要求、加分项。'
    },

    parse_resume_pdf: {
      system: '你是一个PDF简历文本提取助手。请将PDF base64数据转换为结构化Markdown文本，保留所有可读信息。',
      user: '以下是一份PDF简历的base64编码数据，请提取其中所有可读文本并转为Markdown格式（保留所有信息）：\n\n{resume_text}'
    },
    generate_resume_markdown: {
      system: '你是一位专业的简历格式化专家。请将简历信息整理为清晰美观的Markdown格式。',
      user: '请将以下候选人信息整理为Markdown格式的简历：\n\n姓名：{candidate_name}\n{resume_text}'
    },
    generate_daily_report: {
      system: '你是招聘数据分析专家。根据招聘统计数据生成一份简洁的日报摘要（中文），包含：整体进展概述、关键指标分析、风险提示、明日建议。控制在300字以内。',
      user: '日期：{report_date}\n统计数据：{stats_data}'
    },
    generate_interview_questions: {
      system: '你是一位资深的面试官和技术专家。请根据岗位要求和候选人背景，生成专业、有针对性的面试题目。',
      user: '请根据以下信息生成面试题目：\n\n岗位：{candidate_name}\n候选人背景：{resume_text}\n\n请生成技术题、行为题、情景题各若干道。'
    },
    generate_interview_evaluation: {
      system: '你是一位资深的面试评估专家。请根据面试录音转写内容，生成客观、全面的面试评价。',
      user: '请根据以下面试记录生成评价：\n\n{resume_text}\n\n请从技术能力、沟通表达、综合素质三个维度评分并给出评语。'
    },
    generate_interview_evaluation_from_transcript: {
      system: '你是一位资深的面试评估专家。请根据面试转写文本，生成客观、全面的面试评价报告。',
      user: '请根据以下面试转写内容生成评价：\n\n{resume_text}\n\n请输出综合评价和各维度评分。'
    },
    generate_coding_test_evaluation: {
      system: '你是一位资深的技术面试官和代码评审专家。请根据候选人的笔试代码，给出专业的代码评价。',
      user: '请评价以下代码：\n\n{resume_text}\n\n请从代码质量、算法思路、时间复杂度、改进建议等方面评价。'
    },
    resume_extract_fields: {
      system: '你是专业的简历字段提取助手，只返回 JSON 对象，不要输出其他任何内容，不要用 markdown 代码块包裹。工作经历必须完整提取、不得省略。',
      user: '从以下简历文本中提取字段并严格使用这些英文键：name, phone, email, gender, birthday, highest_degree, school, major, years_of_experience, recent_company, current_position, skills, certifications, self_evaluation, work_experience, education。\n\n提取规则：\n- email：提取候选人的电子邮箱地址，简历中没有邮箱则填 null；\n- work_experience：数组，每个元素包含 { company, title, duration, description, achievements }；必须完整提取简历中出现的每一段工作经历，不得省略任何公司或时间段；description 尽可能参考原文完整保留职责与成果细节（含项目成果、数据指标），仅当单段描述超过 300 字时才用 AI 压缩概括（压缩后仍须保留关键职责与成果），禁止只写公司名；\n- skills、certifications、education 使用数组；\n- 其余字段找不到时填 null。\n\n只返回 JSON 对象。\n\n{resume_text}'
    },
    resume_screening: {
      system: `你是资深招聘评估AI，只返回JSON。${WEIGHTED_SCREENING_PROMPT}`,
      user: '岗位：{position}\n简历：{resume_text}\n字段：{fields}\n\n请返回JSON：{"match_score":"非权威参考值","recommendation":"strongly_recommend/recommend/neutral/not_recommend/strongly_not_recommend","summary":"综合分析（中文2-3句）","strengths":"优势分析（中文）","risks":"风险点（中文）","suggested_questions":["问题1","问题2"],"dimensions":[{"name":"七个指定维度之一","score":0,"reason":"中文依据"}]}'
    },
    resume_screening_supplement: {
      system: `你是专业人才能力量化评估专家，只返回JSON。${WEIGHTED_SCREENING_PROMPT}`,
      user: '# 人才能力评估AI打分提示词\n\n## 角色定位\n你是一名专业的人才能力量化评估专家，具备严谨客观的评分准则与标准化输出能力。你的核心任务是**100%基于PDF解析后的原文内容**，对照指定的能力维度清单逐项打分，评分需紧密结合岗位职责要求与招聘方个性化需求，最终输出**可直接用于前端页面渲染的标准化结构化数据**，禁止输出任何无依据的主观推断与补充信息。\n\n## 核心评分规则\n### 基础准则\n- **原文唯一依据原则**：仅以简历文本中明确表述的经历、成果、技能、资质为评分依据；原文未提及的维度，统一标记为「信息不足」，不得随意赋分或主观推断。\n- **岗位对标原则**：每项能力的评分高低，需结合岗位职责对该能力的要求层级与应用场景判断。\n- **需求加权原则**：个性化需求中明确强调的核心维度，需严格提高评估标准，并在评分说明中重点标注匹配程度。\n- **统一分制规则**：全程采用1-5分整数评分制\n  - 5分：远超岗位要求，具备深度经验与可验证的突出成果\n  - 4分：完全满足岗位要求，具备明确的相关实践经验\n  - 3分：基本符合岗位要求，有一定基础但经验深度不足\n  - 2分：仅部分匹配要求，相关经验薄弱\n  - 1分：完全不符合岗位要求\n  - N/A：原文无对应信息，无法评估\n\n## 输入材料\n### 简历原文\n{resume_text}\n\n### 已提取字段\n{fields}\n\n### 能力维度清单（需逐项评估）\n{capability_dimensions}\n\n### 岗位职责与要求\n{job_description}\n\n### 个性化需求\n{personalized_requirements}'
    },
    resume_custom_screen: {
      system: DEFAULT_CUSTOM_SCREEN_PROMPT.system,
      user: DEFAULT_CUSTOM_SCREEN_PROMPT.user,
    },
  };

  try {
    const row = await c.env.DB.prepare('SELECT id, prompt_configs FROM system_configs ORDER BY updated_at DESC LIMIT 1').first() as any;
    let configs: any = {};
    if (row?.prompt_configs) {
      try { configs = JSON.parse(row.prompt_configs); } catch { configs = {}; }
      // 清理已废弃的提示词 key（不再使用的旧 key）
      const deprecatedKeys = ['analyze_resume', 'generate_interview_questions', 'generate_interview_evaluation', 'generate_interview_evaluation_from_transcript', 'generate_coding_test_evaluation'];
      if (configs.prompts) {
        for (const key of deprecatedKeys) {
          delete configs.prompts[key];
        }
      }
      configs.prompts = { ...defaults, ...(configs.prompts || {}) };
      await c.env.DB.prepare('UPDATE system_configs SET prompt_configs = ?, updated_at = ? WHERE id = ?')
        .bind(JSON.stringify(configs), now, row.id).run();
    } else {
      configs = { prompts: defaults };
      const id = 'default_' + Date.now();
      await c.env.DB.prepare('INSERT INTO system_configs (id, prompt_configs, updated_at) VALUES (?, ?, ?)')
        .bind(id, JSON.stringify(configs), now).run();
    }
    return c.json({ ok: true, seeded: Object.keys(defaults).length });
  } catch (e: any) {
    return c.json({ detail: '初始化失败: ' + e.message }, 500);
  }
});

// 批量删除提示词模板
app.post('/api/settings/prompts/remove', authMiddleware, async (c) => {
  try {
    const body = await c.req.json();
    const keys: string[] = Array.isArray(body.keys) ? body.keys : [];
    if (keys.length === 0) return c.json({ detail: '请指定要删除的 key' }, 400);

    const row = await c.env.DB.prepare('SELECT id, prompt_configs FROM system_configs ORDER BY updated_at DESC LIMIT 1').first();
    if (!row?.prompt_configs) return c.json({ detail: '未找到提示词配置', removed: 0 });

    let configs: any = {};
    try { configs = JSON.parse(row.prompt_configs); } catch { configs = {}; }
    if (!configs.prompts) return c.json({ detail: '未找到提示词配置', removed: 0 });

    let removed = 0;
    for (const k of keys) {
      if (configs.prompts[k]) {
        delete configs.prompts[k];
        removed++;
      }
    }

    await c.env.DB.prepare('UPDATE system_configs SET prompt_configs = ?, updated_at = ? WHERE id = ?')
      .bind(JSON.stringify(configs), now(), (row as any).id).run();
    return c.json({ detail: `已删除 ${removed} 个提示词`, removed });
  } catch (e: any) {
    return c.json({ detail: '删除失败: ' + e.message }, 500);
  }
});

app.post('/api/settings/mail/test', authMiddleware, async (c) => {
  return c.json({ detail: 'Mail sending not available in serverless mode' });
});

// ==================== 邮箱简历同步（妙搭 OpenAPI 代理） ====================
async function callMiaoda(c: any, path: string, options?: { method?: string; body?: any }): Promise<Response> {
  const { baseUrl, apiKey } = getMiaodaMailSyncConfig(c.env);
  const url = `${baseUrl}${path}`;
  const headers: Record<string, string> = {
    'Authorization': 'Bearer ' + apiKey,
    'Accept': 'application/json',
  };
  if (options?.body) {
    headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(url, {
    method: options?.method || 'GET',
    headers,
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });
  console.log('[Miaoda]', options?.method || 'GET', path, '->', response.status);
  return response;
}

// 获取所有邮箱配置
app.get('/api/settings/mail/sync', authMiddleware, async (c) => {
  try {
    const res = await callMiaoda(c, '/configs');
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { return c.json({ detail: '妙搭返回非JSON: ' + text.slice(0, 200) }, 502); }
    return c.json(data);
  } catch (e: any) {
    return c.json({ detail: '获取邮箱配置失败: ' + e.message }, 500);
  }
});

// 创建邮箱配置
app.post('/api/settings/mail/sync', authMiddleware, async (c) => {
  try {
    const body = await c.req.json();
    const res = await callMiaoda(c, '/configs', { method: 'POST', body });
    const text = await res.text();
    // 尝试解析 JSON，失败则返回原始文本
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return c.json({ detail: '妙搭返回非JSON: ' + text.slice(0, 200) }, 502);
    }
    return c.json(data);
  } catch (e: any) {
    return c.json({ detail: '创建邮箱配置失败: ' + e.message }, 500);
  }
});

// 更新邮箱配置
app.put('/api/settings/mail/sync/:id', authMiddleware, async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    const res = await callMiaoda(c, '/configs/' + id, { method: 'PUT', body });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { return c.json({ detail: '妙搭返回非JSON: ' + text.slice(0, 200) }, 502); }
    return c.json(data);
  } catch (e: any) {
    return c.json({ detail: '更新邮箱配置失败: ' + e.message }, 500);
  }
});

// 删除邮箱配置
app.delete('/api/settings/mail/sync/:id', authMiddleware, async (c) => {
  try {
    const id = c.req.param('id');
    const res = await callMiaoda(c, '/configs/' + id, { method: 'DELETE' });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { return c.json({ detail: '妙搭返回非JSON: ' + text.slice(0, 200) }, 502); }
    return c.json(data);
  } catch (e: any) {
    return c.json({ detail: '删除邮箱配置失败: ' + e.message }, 500);
  }
});

// 测试连接
app.post('/api/mail/sync/test', authMiddleware, async (c) => {
  try {
    const { configId } = await c.req.json();
    const res = await callMiaoda(c, '/test-connection', { method: 'POST', body: { configId } });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { return c.json({ detail: '妙搭返回非JSON: ' + text.slice(0, 200) }, 502); }
    return c.json(data);
  } catch (e: any) {
    return c.json({ detail: '测试连接失败: ' + e.message }, 500);
  }
});

// 启用/停用邮箱配置
app.post('/api/mail/sync/toggle', authMiddleware, async (c) => {
  try {
    const { configId, enabled } = await c.req.json();
    const res = await callMiaoda(c, '/toggle', { method: 'POST', body: { configId, enabled } });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { return c.json({ detail: '妙搭返回非JSON: ' + text.slice(0, 200) }, 502); }
    return c.json(data);
  } catch (e: any) {
    return c.json({ detail: '操作失败: ' + e.message }, 500);
  }
});

// 触发扫描（支持单个 configId 或批量 configIds）
app.post('/api/mail/sync/trigger', authMiddleware, async (c) => {
  try {
    const body = await c.req.json();
    const configIds: string[] = body.configIds || (body.configId ? [body.configId] : []);
    if (configIds.length === 0) {
      return c.json({ detail: '请指定 configId 或 configIds' }, 400);
    }
    const results = [];
    for (const configId of configIds) {
      const res = await callMiaoda(c, '/trigger', { method: 'POST', body: { configId } });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 200) }; }
      results.push({ configId, ...data });
    }
    return c.json({ results });
  } catch (e: any) {
    return c.json({ detail: '触发扫描失败: ' + e.message }, 500);
  }
});

// 查询扫描进度
app.get('/api/mail/sync/status/:configId', authMiddleware, async (c) => {
  try {
    const configId = c.req.param('configId');
    const res = await callMiaoda(c, '/scan-status/' + configId);
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { return c.json({ detail: '妙搭返回非JSON: ' + text.slice(0, 200) }, 502); }  return c.json(data);
  } catch (e: any) {
    return c.json({ detail: '查询扫描状态失败: ' + e.message }, 500);
  }
});

// 取消扫描
app.post('/api/mail/sync/cancel', authMiddleware, async (c) => {
  try {
    const { configId } = await c.req.json();
    const res = await callMiaoda(c, '/scan-status/' + configId + '/cancel', { method: 'POST' });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { return c.json({ detail: '妙搭返回非JSON: ' + text.slice(0, 200) }, 502); }  return c.json(data);
  } catch (e: any) {
    return c.json({ detail: '取消扫描失败: ' + e.message }, 500);
  }
});

// 获取同步日志
app.get('/api/mail/sync/logs', authMiddleware, async (c) => {
  try {
    const configId = c.req.query('configId') || '';
    const page = c.req.query('page') || '1';
    const pageSize = c.req.query('pageSize') || '20';
    const status = c.req.query('status') || '';
    let path = '/logs?page=' + page + '&pageSize=' + pageSize;
    if (configId) path += '&configId=' + encodeURIComponent(configId);
    if (status) path += '&status=' + encodeURIComponent(status);
    const res = await callMiaoda(c, path);
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { return c.json({ detail: '妙搭返回非JSON: ' + text.slice(0, 200) }, 502); }  return c.json(data);
  } catch (e: any) {
    return c.json({ detail: '获取同步日志失败: ' + e.message }, 500);
  }
});

// 获取同步统计
app.get('/api/mail/sync/logs/stats', authMiddleware, async (c) => {
  try {
    const configId = c.req.query('configId') || '';
    let path = '/logs/stats';
    if (configId) path += '?configId=' + encodeURIComponent(configId);
    const res = await callMiaoda(c, path);
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { return c.json({ detail: '妙搭返回非JSON: ' + text.slice(0, 200) }, 502); }  return c.json(data);
  } catch (e: any) {
    return c.json({ detail: '获取同步统计失败: ' + e.message }, 500);
  }
});

// 重试失败记录
app.post('/api/mail/sync/retry-failed', authMiddleware, async (c) => {
  try {
    const { configId } = await c.req.json();
    const res = await callMiaoda(c, '/retry-failed', { method: 'POST', body: { configId } });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { return c.json({ detail: '妙搭返回非JSON: ' + text.slice(0, 200) }, 502); }  return c.json(data);
  } catch (e: any) {
    return c.json({ detail: '重试失败: ' + e.message }, 500);
  }
});

// 重试单条失败记录
app.post('/api/mail/sync/retry-single', authMiddleware, async (c) => {
  try {
    const { logId } = await c.req.json();
    const res = await callMiaoda(c, '/retry-single', { method: 'POST', body: { logId } });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { return c.json({ detail: '妙搭返回非JSON: ' + text.slice(0, 200) }, 502); }  return c.json(data);
  } catch (e: any) {
    return c.json({ detail: '重试失败: ' + e.message }, 500);
  }
});

// ==================== 面试官映射管理 ====================

app.get('/api/settings/interviewers', authMiddleware, async (c) => {
  try {
    const rows = await c.env.DB.prepare('SELECT * FROM interviewer_mappings ORDER BY name').all();
    return c.json(rows.results || []);
  } catch (e: any) {
    // 表可能还不存在，返回空
    return c.json([]);
  }
});

// 从飞书通讯录搜索用户 open_id（使用 Contact API 获取全量用户后过滤）
app.get('/api/settings/interviewers/search', authMiddleware, async (c) => {
  const query = c.req.query('q') || '';
  if (!query || query.length < 1) return c.json([]);
  try {
    const token = await getFeishuToken(c.env);
    const resp = await fetch(
      'https://open.feishu.cn/open-apis/contact/v3/users?page_size=50&user_id_type=open_id',
      { headers: { 'Authorization': `Bearer ${token}` } }
    ).then(r => r.json()) as any;
    const items = resp?.data?.items || [];
    const q = query.toLowerCase();
    const users = items
      .filter((u: any) => {
        const name = (u.name || '').toLowerCase();
        const email = (u.email || '').toLowerCase();
        return name.includes(q) || email.includes(q);
      })
      .map((u: any) => ({
        name: u.name || '',
        open_id: u.open_id || '',
      }));
    return c.json(users);
  } catch (e: any) {
    return c.json({ detail: '搜索失败: ' + e.message }, 500);
  }
});

/**
 * 从飞书通讯录批量查询用户 open_id，写入 interviewer_mappings 表
 * 用于让未 OAuth 绑定的面试官也能收到飞书通知
 * 注意：通讯录API返回的 open_id 是当前应用(cli_aad2cb7fab385cb6)的，可用于发消息
 */
async function batchSyncFeishuOpenIds(env: Env, names: string[]): Promise<{ synced: number; notFound: string[]; details: string[] }> {
  const token = await getFeishuToken(env);

  // 1. 获取应用通讯录授权范围（部门列表 + 用户列表）
  const scopeResp = await fetch('https://open.feishu.cn/open-apis/contact/v3/scopes', {
    headers: { Authorization: `Bearer ${token}` },
  }).then(r => r.json()) as any;
  if (scopeResp.code !== 0) throw new Error(`获取通讯录范围失败: ${scopeResp.code} ${scopeResp.msg}`);

  const deptIds: string[] = scopeResp?.data?.department_ids || [];
  const scopeUserIds: string[] = scopeResp?.data?.user_ids || [];
  console.log(`[BatchSyncOpenIds] 授权范围: ${deptIds.length}个部门, ${scopeUserIds.length}个用户`);

  // 2. 遍历每个授权部门，拉取部门下所有用户（find_by_department 自动包含子部门）
  const allUsers: Array<{ name: string; open_id: string }> = [];
  for (const deptId of deptIds) {
    let pageToken = '';
    let hasMore = true;
    let pageCount = 0;
    while (hasMore && pageCount < 20) {
      const url = `https://open.feishu.cn/open-apis/contact/v3/users/find_by_department?department_id=${deptId}&page_size=50&user_id_type=open_id${pageToken ? `&page_token=${pageToken}` : ''}`;
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()) as any;
      if (resp.code !== 0) {
        console.warn(`[BatchSyncOpenIds] 部门 ${deptId} 拉取失败: ${resp.code} ${resp.msg}`);
        break;
      }
      const items = resp?.data?.items || [];
      for (const u of items) {
        if (u.name && u.open_id) allUsers.push({ name: u.name, open_id: u.open_id });
      }
      hasMore = resp?.data?.has_more === true;
      pageToken = resp?.data?.page_token || '';
      pageCount++;
      if (!hasMore) break;
    }
  }

  // 3. 补充授权范围内的独立用户（scopeUserIds 里的 open_id）
  for (const openId of scopeUserIds) {
    if (!allUsers.some(u => u.open_id === openId)) {
      try {
        const userResp = await fetch(`https://open.feishu.cn/open-apis/contact/v3/users/${openId}?user_id_type=open_id`, {
          headers: { Authorization: `Bearer ${token}` },
        }).then(r => r.json()) as any;
        if (userResp.code === 0 && userResp?.data?.user?.name) {
          allUsers.push({ name: userResp.data.user.name, open_id: openId });
        }
      } catch {}
    }
  }

  console.log(`[BatchSyncOpenIds] 通讯录拉取 ${allUsers.length} 人（${deptIds.length}个部门+${scopeUserIds.length}个独立用户）`);

  // 按姓名匹配并 upsert 到 interviewer_mappings
  const nameSet = new Set(names.filter(Boolean));
  const ts = now();
  let synced = 0;
  const notFound: string[] = [];
  const details: string[] = [];

  for (const name of nameSet) {
    const found = allUsers.find(u => u.name === name);
    if (found) {
      await env.DB.prepare(
        `INSERT INTO interviewer_mappings (id, name, open_id, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET open_id = excluded.open_id, updated_at = excluded.updated_at`
      ).bind(`im_${found.open_id}`, name, found.open_id, ts).run();
      synced++;
      details.push(`${name} → ${found.open_id}`);
    } else {
      notFound.push(name);
    }
  }
  return { synced, notFound, details };
}

/**
 * 批量同步面试官飞书 open_id（从飞书通讯录）
 * POST /api/settings/interviewers/batch-sync-from-feishu
 * 自动收集 recruitment_tasks 的面试官+责任人 + users 表未绑定飞书的用户，查通讯录写入 interviewer_mappings
 */
app.post('/api/settings/interviewers/batch-sync-from-feishu', authMiddleware, requireRole(['admin']), async (c) => {
  try {
    // 1. 从 recruitment_tasks 收集所有面试官姓名 + 责任人
    const tasks = await c.env.DB.prepare('SELECT interviewers, responsible_person FROM recruitment_tasks').all() as any;
    const names = new Set<string>();
    for (const t of (tasks.results || [])) {
      if (t.responsible_person) names.add(t.responsible_person);
      try {
        const ivs = typeof t.interviewers === 'string' ? JSON.parse(t.interviewers) : t.interviewers;
        if (Array.isArray(ivs)) for (const n of ivs) if (n) names.add(n);
      } catch {}
    }
    // 2. 也加上 users 表里未绑定飞书的用户
    const unbound = await c.env.DB.prepare(
      "SELECT full_name FROM users WHERE (feishu_open_id IS NULL OR feishu_open_id = '') AND full_name != ''"
    ).all() as any;
    for (const u of (unbound.results || [])) names.add(u.full_name);

    // 3. 从 interviews 表收集面试官（primary_interviewer / secondary_interviewer / interviewer）
    const ivRows = await c.env.DB.prepare(
      'SELECT DISTINCT interviewer, primary_interviewer, secondary_interviewer FROM interviews WHERE (interviewer IS NOT NULL AND interviewer != \'\') OR (primary_interviewer IS NOT NULL AND primary_interviewer != \'\') OR (secondary_interviewer IS NOT NULL AND secondary_interviewer != \'\')'
    ).all() as any;
    for (const row of (ivRows.results || [])) {
      // interviewer 可能是逗号分隔的多人名："张三, 李四"
      for (const field of [row.interviewer, row.primary_interviewer, row.secondary_interviewer]) {
        if (!field) continue;
        for (const n of String(field).split(/[,，、;；\s]+/)) {
          const t = n.trim();
          if (t) names.add(t);
        }
      }
    }

    // 4. 从 positions 表收集面试官（primary_interviewer / secondary_interviewer / responsible_person）
    const posRows = await c.env.DB.prepare(
      'SELECT DISTINCT primary_interviewer, secondary_interviewer, responsible_person FROM positions WHERE (primary_interviewer IS NOT NULL AND primary_interviewer != \'\') OR (secondary_interviewer IS NOT NULL AND secondary_interviewer != \'\') OR (responsible_person IS NOT NULL AND responsible_person != \'\')'
    ).all() as any;
    for (const row of (posRows.results || [])) {
      if (row.primary_interviewer?.trim()) names.add(row.primary_interviewer.trim());
      if (row.secondary_interviewer?.trim()) names.add(row.secondary_interviewer.trim());
      if (row.responsible_person?.trim()) names.add(row.responsible_person.trim());
    }

    if (names.size === 0) {
      return c.json({ ok: true, synced: 0, notFound: [], details: [], message: '没有需要同步的面试官（请先添加招聘任务或面试记录）' });
    }

    const result = await batchSyncFeishuOpenIds(c.env, Array.from(names));
    return c.json({ ok: true, ...result, total_names: names.size });
  } catch (e: any) {
    return c.json({ detail: '批量同步失败: ' + e.message }, 500);
  }
});

app.put('/api/settings/interviewers', authMiddleware, async (c) => {
  const body = await c.req.json();
  const items: Array<{ name: string; open_id: string }> = body.items || body || [];

  try {
    // 全量替换：先删后插
    await c.env.DB.prepare('DELETE FROM interviewer_mappings').run();
    for (const item of items) {
      if (item.name && item.open_id) {
        await c.env.DB.prepare(
          'INSERT INTO interviewer_mappings (id, name, open_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
        ).bind(uuid(), item.name, item.open_id, now(), now()).run();
      }
    }
    const rows = await c.env.DB.prepare('SELECT * FROM interviewer_mappings ORDER BY name').all();
    return c.json({ ok: true, count: rows.results?.length || 0, items: rows.results || [] });
  } catch (e: any) {
    return c.json({ detail: '保存失败: ' + e.message }, 500);
  }
});

// 通知全部面试官（发飞书卡片）
app.post('/api/settings/interviewers/notify-all', authMiddleware, async (c) => {
  try {
    const { title, content } = await c.req.json();
    const operatorName = c.get('user')?.full_name || '';
    const rows = await c.env.DB.prepare('SELECT * FROM interviewer_mappings ORDER BY name').all();
    if (!rows.results || rows.results.length === 0) {
      return c.json({ detail: '没有配置面试官映射' }, 400);
    }

    const token = await getFeishuToken(c.env);
    const card = {
      config: { wide_screen_mode: true },
      header: {
        title: { tag: 'plain_text', content: title || '📢 面试官通知' },
        template: 'blue',
      },
      elements: [
        { tag: 'markdown', content: content || '请及时查看系统安排。' },
        {
          tag: 'action',
          actions: [
            {
              tag: 'button',
              text: { tag: 'plain_text', content: '打开系统' },
              type: 'primary',
              multi_url: {
                url: 'https://ai-interview-88r.pages.dev',
                pc_url: 'https://ai-interview-88r.pages.dev',
                ios_url: '',
                android_url: '',
              },
            },
          ],
        },
        {
          tag: 'note',
          elements: [{ tag: 'plain_text', content: `由 ${operatorName || '系统'} 发送 | AI 智能面试系统` }]
        },
      ],
    };

    const results: string[] = [];
    for (const row of rows.results) {
      try {
        await sendFeishuMessageWithFallback(c.env, c.get('user')?.email, row.open_id, card);
        results.push(`${row.name}: ✅`);
      } catch (e: any) {
        results.push(`${row.name}: ❌ ${e.message}`);
      }
    }
    return c.json({ ok: true, total: results.length, details: results });
  } catch (e: any) {
    return c.json({ detail: '通知失败: ' + e.message }, 500);
  }
});

// ==================== Public Routes ====================

app.get('/api/positions/:id', async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM positions WHERE id = ?').bind(c.req.param('id')).first();
  if (!row) return c.json({ detail: 'Not found' }, 404);
  return c.json(transformRow(row));
});

// 简历审核详情：返回完整简历（含联系方式/解析数据），必须带 key 或 JWT，
// 否则与公开脱敏体系冲突（原本未鉴权即泄露全部 PII）。
app.get('/api/public/review/:resumeId', async (c) => {
  const apiKey = c.req.header('x-api-key') || '';
  const auth = c.req.header('Authorization') || '';
  const authMatch = auth.match(/^Bearer\s+(.+)$/i);
  let authed = false;
  if (apiKey && c.env.RESUME_UPLOAD_API_KEY && apiKey === c.env.RESUME_UPLOAD_API_KEY) {
    authed = true;
  } else if (authMatch) {
    const payload = await verifyJwt(c.env.SECRET_KEY, authMatch[1]);
    if (payload) {
      const user = await getUser(c.env.DB, payload.sub);
      if (user && user.is_active) authed = true;
    }
  }
  if (!authed) return c.json({ detail: 'Missing API key or token' }, 401);
  const row = await c.env.DB.prepare('SELECT * FROM resumes WHERE id = ?').bind(c.req.param('resumeId')).first();
  if (!row) return c.json({ detail: 'Not found' }, 404);
  return c.json(transformRow(row));
});

// 公开岗位详情（修复 2026-07-24）：
// 原 GET /api/positions/:id 虽未挂中间件，但因与带鉴权的 POST /api/positions/:id/ai-match 等
// 共享 :id 路由段，在 Hono v4 SmartRouter 下匿名访问被误拦截返回 401。
// 候选人公开职位详情页（Public/JobDetail）需匿名访问，故改用独立公开前缀 /api/public/positions/:id，
// 且仅返回对外招聘中的岗位（status IN ('open','published')，与系统内 open=招聘中 的口径一致），
// 避免泄露草稿(draft)/暂停(paused)/已关闭(closed)等非公开岗位。
const PUBLIC_POSITION_STATUSES = ['open', 'published', 'recruiting'];
app.get('/api/public/positions/:id', async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM positions WHERE id = ?').bind(c.req.param('id')).first() as any;
  if (!row || !PUBLIC_POSITION_STATUSES.includes(row.status)) return c.json({ detail: 'Not found' }, 404);
  return c.json(transformRow(row));
});

// 公开岗位进度（2026-08-13）：
// 与 /api/public/positions/:id 相同的公开口径：仅对 status IN ('open','published','recruiting') 的岗位开放，
// 返回岗位基本信息 + 招聘漏斗进度（简历数、AI 初筛、各轮面试、offer、入职）以及简历状态分布。
// 简历匹配口径与招聘看板一致：优先 position_id，兼容 mapped_position/position_applied 按岗位名匹配。
app.get('/api/public/positions/:id/progress', async (c) => {
  try {
    const position = await c.env.DB.prepare('SELECT * FROM positions WHERE id = ?').bind(c.req.param('id')).first() as any;
    if (!position || !PUBLIC_POSITION_STATUSES.includes(position.status)) {
      return c.json({ detail: 'Not found' }, 404);
    }
    const title = position.title || '';
    // 简历按岗位匹配须与前端 /api/resumes 的 position 过滤完全一致：
    // raw = mapped_position || position_applied（单一取值，mapped 优先），
    // raw === 标题 或经 position_mappings 解析后 === 标题。不做 position_id 直连。
    const positionMap = await buildPositionMapping(c.env.DB);
    const isPositionResume = (r: any) => {
      const raw = r.mapped_position || r.position_applied || '';
      return raw === title || resolveMappedPosition(positionMap, raw) === title;
    };
    const resumeRows = await c.env.DB.prepare(
      'SELECT status, parse_status, mapped_position, position_applied FROM resumes'
    ).all();
    const resumes = ((resumeRows.results || []) as any[]).filter(isPositionResume);
    const totalResumes = resumes.length;
    const aiScreened = resumes.filter((r: any) => r.parse_status === 'ai_screened').length;
    const statusBreakdown: Record<string, number> = {};
    for (const r of resumes) {
      const key = r.status || 'unknown';
      statusBreakdown[key] = (statusBreakdown[key] || 0) + 1;
    }

    const [iv1Sched, iv1Pass, iv2Pass, iv3Pass, offerCnt, hiredCnt] = await Promise.all([
      c.env.DB.prepare('SELECT COUNT(*) as cnt FROM interviews WHERE round = 1 AND position_id = ?').bind(position.id).first(),
      c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM interviews WHERE ${getBoardInterviewPassCondition(1)} AND position_id = ?`).bind(position.id).first(),
      c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM interviews WHERE ${getBoardInterviewPassCondition(2)} AND position_id = ?`).bind(position.id).first(),
      c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM interviews WHERE ${getBoardInterviewPassCondition(3)} AND position_id = ?`).bind(position.id).first(),
      c.env.DB.prepare("SELECT COUNT(*) as cnt FROM offers WHERE status NOT IN ('draft','cancelled') AND position_id = ?").bind(position.id).first(),
      c.env.DB.prepare("SELECT COUNT(*) as cnt FROM onboarding_records WHERE status = 'onboarded' AND position_id = ?").bind(position.id).first(),
    ]);
    const num = (r: any) => r?.cnt ?? 0;

    const base = transformRow(position);
    return c.json({
      position: {
        id: base.id,
        title: base.title,
        department: base.department,
        location: base.location,
        salary_range: base.salary_range,
        status: base.status,
        urgency: base.urgency,
        position_type: base.position_type,
        headcount: base.headcount,
        responsible_person: base.responsible_person,
        description: base.description,
        requirements: base.requirements,
      },
      progress: {
        total_resumes: totalResumes,
        ai_screened: aiScreened,
        first_interview: num(iv1Sched),
        first_pass: num(iv1Pass),
        second_pass: num(iv2Pass),
        third_pass: num(iv3Pass),
        offers: num(offerCnt),
        hired: num(hiredCnt),
        resume_status_breakdown: statusBreakdown,
      },
      updated_at: base.updated_at,
    });
  } catch (e: any) {
    return c.json({ detail: 'Internal error: ' + e.message }, 500);
  }
});

// 公开岗位简历列表（2026-08-13）：
// 按岗位查看候选人简历及进度，支持 limit/offset 分页与 status 筛选（"一部分简历"）。
// 出于隐私考虑，公开列表不返回联系方式与简历原文，仅返回进度相关字段。
app.get('/api/public/positions/:id/resumes', async (c) => {
  try {
    const position = await c.env.DB.prepare('SELECT * FROM positions WHERE id = ?').bind(c.req.param('id')).first() as any;
    if (!position || !PUBLIC_POSITION_STATUSES.includes(position.status)) {
      return c.json({ detail: 'Not found' }, 404);
    }
    const limitRaw = parseInt(c.req.query('limit') || '50', 10);
    const offsetRaw = parseInt(c.req.query('offset') || '0', 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;
    const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0;
    const statusFilter = c.req.query('status');
    const title = position.title || '';
    // 与 progress 接口一致：与前端 /api/resumes 的 position 过滤完全相同，保证数量一致
    const positionMap = await buildPositionMapping(c.env.DB);
    const rows = await c.env.DB.prepare(
      `SELECT id, candidate_name, mapped_position, position_applied, status, stage, match_score, screening_result, parse_status, created_at, updated_at
       FROM resumes`
    ).all();
    const isPositionResume = (r: any) => {
      const raw = r.mapped_position || r.position_applied || '';
      return raw === title || resolveMappedPosition(positionMap, raw) === title;
    };
    let matched = ((rows.results || []) as any[]).filter(isPositionResume);
    if (statusFilter) matched = matched.filter((r: any) => r.status === statusFilter);
    matched.sort((a: any, b: any) => {
      const cmp = (x: string, y: string) => (x < y ? 1 : x > y ? -1 : 0);
      const byCreated = cmp(a.created_at || '', b.created_at || '');
      if (byCreated !== 0) return byCreated;
      return cmp(a.updated_at || '', b.updated_at || '');
    });
    const items = matched.slice(offset, offset + limit).map((r: any) => ({
      id: r.id,
      candidate_name: r.candidate_name,
      position_applied: r.mapped_position || r.position_applied || '',
      status: r.status,
      stage: r.stage,
      match_score: r.match_score,
      screening_result: r.screening_result,
      parse_status: r.parse_status,
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));

    return c.json({
      position: { id: position.id, title: position.title, status: position.status },
      total: matched.length,
      limit,
      offset,
      items,
    });
  } catch (e: any) {
    return c.json({ detail: 'Internal error: ' + e.message }, 500);
  }
});

// 公开"按人查看简历"（2026-08-14）：
// 查某人的相关简历（该人是岗位负责人/面试官、岗位映射、招聘任务或面试记录里的面试官）。
// 分页/status 过滤与 /api/public/positions/:id/resumes 一致；出于隐私只返回进度字段。
app.get('/api/public/person/:name/resumes', async (c) => {
  try {
    const name = (c.req.param('name') || '').trim();
    if (!name) return c.json({ detail: 'Not found' }, 404);

    const limitRaw = parseInt(c.req.query('limit') || '50', 10);
    const offsetRaw = parseInt(c.req.query('offset') || '0', 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;
    const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0;
    const statusFilter = c.req.query('status');

    // 姓名容错（编辑距离 ≤ 1）：精确命中用原名；差一字的唯一候选自动采用；
    // 多个候选返回 candidates 供调用方选择（如 魏秋宁 → 魏秋柠）。
    const resolved = await resolveInterviewerName(c.env.DB, name);
    if (!resolved.matched && resolved.candidates.length > 0) {
      return c.json({ person: name, matched: null, candidates: resolved.candidates, total: 0, limit, offset, items: [] });
    }
    const effectiveName = resolved.matched || name;

    const filter = await buildPersonResumeFilter(c.env.DB, effectiveName);
    let where = filter.where;
    const params: any[] = [...filter.params];
    if (statusFilter) {
      where += ' AND status = ?';
      params.push(statusFilter);
    }
    const countRow = await c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM resumes WHERE ${where}`).bind(...params).first();
    const rows = await c.env.DB.prepare(
      `SELECT id, candidate_name, mapped_position, position_applied, status, stage, match_score, screening_result, parse_status, created_at, updated_at
       FROM resumes WHERE ${where} ORDER BY created_at DESC, updated_at DESC LIMIT ? OFFSET ?`
    ).bind(...params, limit, offset).all();

    const items = (rows.results || []).map((r: any) => ({
      id: r.id,
      candidate_name: r.candidate_name,
      position_applied: r.mapped_position || r.position_applied || '',
      status: r.status,
      stage: r.stage,
      match_score: r.match_score,
      screening_result: r.screening_result,
      parse_status: r.parse_status,
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));

    return c.json({
      person: effectiveName,
      ...(effectiveName !== name ? { matched_from: name } : {}),
      total: countRow?.cnt ?? 0,
      limit,
      offset,
      items,
    });
  } catch (e: any) {
    return c.json({ detail: 'Internal error: ' + e.message }, 500);
  }
});

// ---- 简历决策 token（无状态 HMAC，7 天有效期，绑定单个 resumeId）----

export async function createResumeDecisionToken(env: Env, resumeId: string): Promise<string> {
  const key = env.SECRET_KEY || 'resume-decision';
  const expiry = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
  const sig = await hmacSha256(key, `${resumeId}:${expiry}`);
  return `${expiry}.${b64urlBuf(sig)}`;
}

export async function verifyResumeDecisionToken(env: Env, resumeId: string, token: string): Promise<boolean> {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [expiryStr, sig] = parts;
  const expiry = parseInt(expiryStr, 10);
  if (!Number.isFinite(expiry) || expiry < Math.floor(Date.now() / 1000)) return false;
  const key = env.SECRET_KEY || 'resume-decision';
  const expectedSig = b64urlBuf(await hmacSha256(key, `${resumeId}:${expiryStr}`));
  // 常量时间比较，防止时序侧信道
  const a = new TextEncoder().encode(expectedSig);
  const b = new TextEncoder().encode(sig);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function escapeHtml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderResumeDecisionPage(opts: { resumeId: string; token: string; name: string; posName: string; status: string }): string {
  const statusLabel = opts.status === 'approved' ? '✅ 已入库' : opts.status === 'rejected' ? '❌ 已不入库' : `状态：${escapeHtml(opts.status)}`;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>简历处理</title>
<style>
  body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; background:#f5f6f7; margin:0; padding:24px; display:flex; justify-content:center; }
  .card { background:#fff; border-radius:12px; padding:32px; max-width:420px; width:100%; box-shadow:0 2px 12px rgba(0,0,0,.08); text-align:center; }
  h1 { font-size:20px; margin:0 0 8px; }
  .meta { color:#666; font-size:14px; margin-bottom:24px; line-height:1.6; }
  .badge { display:inline-block; padding:2px 10px; border-radius:10px; font-size:12px; background:#eef2ff; color:#4f46e5; margin-top:4px; }
  .buttons { display:flex; gap:12px; justify-content:center; }
  button { border:none; border-radius:8px; padding:12px 24px; font-size:15px; cursor:pointer; color:#fff; }
  .approve { background:#16a34a; }
  .reject { background:#dc2626; }
  .note { color:#999; font-size:12px; margin-top:20px; }
</style>
</head>
<body>
<div class="card">
  <h1>候选人：${escapeHtml(opts.name)}</h1>
  <div class="meta">岗位：${escapeHtml(opts.posName) || '未知'}<br><span class="badge">${statusLabel}</span></div>
  <form method="post" action="/api/public/resume/${escapeHtml(opts.resumeId)}/decision" class="buttons">
    <input type="hidden" name="token" value="${escapeHtml(opts.token)}">
    <input type="hidden" name="action" value="approve">
    <button type="submit" class="approve">✅ 入库</button>
  </form>
  <form method="post" action="/api/public/resume/${escapeHtml(opts.resumeId)}/decision" class="buttons" style="margin-top:12px">
    <input type="hidden" name="token" value="${escapeHtml(opts.token)}">
    <input type="hidden" name="action" value="reject">
    <button type="submit" class="reject">❌ 不入库</button>
  </form>
  <div class="note">链接 7 天内有效，每个候选人单独生成。</div>
</div>
</body>
</html>`;
}

function renderResumeDecisionResult(opts: { name: string; result: string }): string {
  const emoji = opts.result.startsWith('approved') ? '✅' : opts.result.startsWith('rejected') ? '❌' : 'ℹ️';
  const label = opts.result.startsWith('approved') ? '已入库' : opts.result.startsWith('rejected') ? '已不入库' : opts.result;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>处理完成</title>
<style>
  body { font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif; background:#f5f6f7; margin:0; padding:24px; display:flex; justify-content:center; }
  .card { background:#fff; border-radius:12px; padding:32px; max-width:420px; width:100%; box-shadow:0 2px 12px rgba(0,0,0,.08); text-align:center; }
  h1 { font-size:20px; }
  .emoji { font-size:48px; }
  .meta { color:#666; font-size:14px; margin:12px 0 24px; }
</style>
</head>
<body>
<div class="card">
  <div class="emoji">${emoji}</div>
  <h1>${escapeHtml(opts.name)}：${label}</h1>
  <div class="meta">你可以关闭此页面。</div>
</div>
</body>
</html>`;
}

// 简历决策页：GET 展示两个按钮（入库 / 不入库），POST 执行并把结果写回 D1
app.get('/api/public/resume/:id/decision', async (c) => {
  try {
    const resumeId = c.req.param('id');
    const token = c.req.query('t') || '';
    const valid = await verifyResumeDecisionToken(c.env, resumeId, token);
    if (!valid) return c.html('<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px;text-align:center"><h1>链接无效或已过期</h1><p>请让发送人重新生成链接。</p></body></html>', 403);
    const resume = await c.env.DB.prepare('SELECT id, candidate_name, mapped_position, position_applied, status FROM resumes WHERE id = ?').bind(resumeId).first() as any;
    if (!resume) return c.html('<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px;text-align:center"><h1>简历不存在</h1></body></html>', 404);
    const posName = resume.mapped_position || resume.position_applied || '';
    return c.html(renderResumeDecisionPage({
      resumeId,
      token,
      name: resume.candidate_name || '未知',
      posName,
      status: resume.status,
    }));
  } catch (e: any) {
    return c.html(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px;text-align:center"><h1>服务器错误</h1><p>${escapeHtml(e.message)}</p></body></html>`, 500);
  }
});

app.post('/api/public/resume/:id/decision', async (c) => {
  try {
    const resumeId = c.req.param('id');
    const form = await c.req.formData();
    const token = (form.get('token') as string) || '';
    const action = (form.get('action') as string) || '';
    const valid = await verifyResumeDecisionToken(c.env, resumeId, token);
    if (!valid) return c.html('<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px;text-align:center"><h1>链接无效或已过期</h1><p>请让发送人重新生成链接。</p></body></html>', 403);
    const resume = await c.env.DB.prepare('SELECT id, candidate_name FROM resumes WHERE id = ?').bind(resumeId).first() as any;
    if (!resume) return c.html('<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px;text-align:center"><h1>简历不存在</h1></body></html>', 404);
    const name = resume.candidate_name || '未知';

    if (action === 'approve') {
      const result = await approveBatch(c.env.DB, [resumeId], 'resume-decision-page');
      const done = result.approved.includes(resumeId) || result.skipped.some((s) => s.id === resumeId && s.reason === 'already_approved');
      return c.html(renderResumeDecisionResult({ name, result: done ? 'approved' : '处理失败' }));
    }
    if (action === 'reject') {
      const result = await rejectBatch(c.env.DB, [resumeId], 'resume-decision-page');
      const done = result.approved.includes(resumeId) || result.skipped.some((s) => s.id === resumeId && s.reason === 'already_rejected');
      return c.html(renderResumeDecisionResult({ name, result: done ? 'rejected' : '处理失败' }));
    }
    return c.html(renderResumeDecisionResult({ name, result: '无效操作' }), 400);
  } catch (e: any) {
    return c.html(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px;text-align:center"><h1>服务器错误</h1><p>${escapeHtml(e.message)}</p></body></html>`, 500);
  }
});

// 按人交付简历（2026-08-14）：
// 认证：x-api-key（RESUME_UPLOAD_API_KEY）或 Bearer JWT，防止任意人发消息/建文档。
// 两种形式都支持 入库/不入库：
//   form='table' → 飞书机器人新建多维表格（每行一个简历，末列"操作"为决策链接），
//                  授权给目标人查看，并发送表格链接卡片。
//   form='cards' → 给目标人逐张发候选人卡片，卡片带 入库/不入库 按钮（回调走 /api/feishu/card-action）。
app.post('/api/public/person/:name/export', async (c) => {
  // —— 认证（复用对外简历上传接口的鉴权）——
  let actor = 'external-api';
  const apiKey = c.req.header('x-api-key') || '';
  const auth = c.req.header('Authorization') || '';
  const authMatch = auth.match(/^Bearer\s+(.+)$/i);
  if (apiKey && c.env.RESUME_UPLOAD_API_KEY && apiKey === c.env.RESUME_UPLOAD_API_KEY) {
    // 有效 API Key
  } else if (authMatch) {
    const payload = await verifyJwt(c.env.SECRET_KEY, authMatch[1]);
    if (!payload) return c.json({ detail: 'Invalid token' }, 401);
    const user = await getUser(c.env.DB, payload.sub);
    if (!user || !user.is_active) return c.json({ detail: 'Not authorized' }, 401);
    actor = user.email;
  } else {
    return c.json({ detail: 'Missing API key or token' }, 401);
  }

  try {
    const name = (c.req.param('name') || '').trim();
    if (!name) return c.json({ detail: '需要指定人名' }, 400);

    const body: any = await c.req.json().catch(() => ({}));
    const form = body.form === 'cards' ? 'cards' : 'table';
    const limitRaw = parseInt(body.limit ?? '100', 10);
    const limit = Number.isFinite(limitRaw)
      ? Math.min(Math.max(limitRaw, 1), form === 'cards' ? 50 : 200)
      : (form === 'cards' ? 50 : 100);

    // 解析目标人 open_id（重名抛 AMBIGUOUS_INTERVIEWER_BINDING，未绑定返回空）
    let openId = '';
    try {
      openId = (await resolveExactInterviewerOpenId(c.env.DB, name)) || '';
    } catch (e: any) {
      if (e.code === 'AMBIGUOUS_INTERVIEWER_BINDING') {
        return c.json({ detail: e.message, hint: '请在面试官管理中清理重复映射后重试' }, 400);
      }
      return c.json({ detail: '解析面试官绑定失败: ' + (e.message || e) }, 500);
    }
    if (!openId) {
      return c.json({
        detail: `未找到 ${name} 的飞书绑定`,
        hint: '请先调用 POST /api/settings/interviewers/batch-sync-from-feishu 同步面试官后重试',
      }, 400);
    }

    const filter = await buildPersonResumeFilter(c.env.DB, name);
    const rows = await c.env.DB.prepare(
      `SELECT id, candidate_name, mapped_position, position_applied, status, stage, match_score
       FROM resumes WHERE ${filter.where} ORDER BY created_at DESC, updated_at DESC LIMIT ?`
    ).bind(...filter.params, limit).all();
    const resumes = (rows.results || []) as any[];
    if (resumes.length === 0) {
      return c.json({ ok: true, person: name, form, total: 0, delivered: 0, detail: '未找到相关简历' });
    }

    const origin = new URL(c.req.url).origin;
    const decisionUrl = (id: string, token: string) => `${origin}/api/public/resume/${id}/decision?t=${token}`;

    if (form === 'table') {
      // —— Form A：多维表格 ——
      const app = await createFeishuBitableApp(c.env, `${name}相关简历（${resumes.length}份）`);
      if (!app) return c.json({ detail: '创建多维表格失败，请检查飞书应用权限（bitable:app）' }, 502);
      const table = await createFeishuBitableTable(c.env, app.appToken, '简历列表');
      if (!table) return c.json({ detail: '创建多维表格数据表失败' }, 502);

      const records: Array<{ fields: any }> = [];
      for (const r of resumes) {
        const token = await createResumeDecisionToken(c.env, r.id);
        records.push({
          fields: {
            '候选人': r.candidate_name || '未知',
            '岗位': r.mapped_position || r.position_applied || '',
            '状态': RESUME_STATUS_LABELS[r.status] || r.status || '',
            '阶段': RESUME_STAGE_LABELS[r.stage] || r.stage || '',
            '匹配分': r.match_score ?? null,
            // Bitable URL 字段（type 15）值必须为对象 {link, text}，纯字符串会被拒绝
            '操作': { link: decisionUrl(r.id, token), text: '入库/不入库' },
          },
        });
      }
      const created = await batchCreateFeishuBitableRecords(c.env, app.appToken, table.tableId, records);
      const granted = await grantFeishuBitableViewer(c.env, app.appToken, openId);

      // 发送表格链接卡片
      const linkCard = {
        config: { wide_screen_mode: true },
        header: { title: { tag: 'plain_text', content: `📊 ${name}相关简历（${resumes.length}份）` }, template: 'blue' },
        elements: [
          {
            tag: 'div',
            text: {
              tag: 'lark_md',
              content: `已为你生成 ${resumes.length} 份相关简历的多维表格，共写入 ${created} 行。\n点击下方按钮打开表格，每行「操作」列可 入库 / 不入库。`,
            },
          },
          { tag: 'hr' },
          {
            tag: 'action',
            actions: [
              { tag: 'button', text: { tag: 'plain_text', content: '打开多维表格' }, type: 'primary', url: table.tableUrl },
            ],
          },
        ],
      };
      await sendFeishuMessageWithFallback(c.env, actor === 'external-api' ? undefined : actor, openId, linkCard);

      return c.json({
        ok: true, person: name, form: 'table', total: resumes.length, delivered: 1,
        table_url: table.tableUrl, created_records: created, granted,
      });
    }

    // —— Form B：逐张发卡片（上限 50）——
    const target = resumes.slice(0, 50);
    let sent = 0;
    const failedIds: string[] = [];
    for (const r of target) {
      try {
        await sendFeishuMessageWithFallback(c.env, actor === 'external-api' ? undefined : actor, openId, buildPersonResumeCard(r));
        sent += 1;
      } catch (e: any) {
        failedIds.push(r.id);
      }
    }
    return c.json({
      ok: true, person: name, form: 'cards', total: resumes.length, delivered: sent,
      failed: failedIds,
      detail: resumes.length > 50 ? `共 ${resumes.length} 份，本次发送前 50 份` : undefined,
    });
  } catch (e: any) {
    return c.json({ detail: 'Internal error: ' + e.message }, 500);
  }
});

// 学历等级（用于"本科以上"/"大专"等比较；从低到高）
const DEGREE_LEVELS = ['小学', '初中', '高中', '中专', '大专', '本科', '硕士', '博士'];

function educationLevel(edu: unknown): number {
  const e = String(edu ?? '').trim();
  if (!e) return -1;
  for (let i = DEGREE_LEVELS.length - 1; i >= 0; i--) {
    if (e.includes(DEGREE_LEVELS[i])) return i;
  }
  return -1;
}

// 返回学历过滤函数；未提供学历条件时返回 null
function buildEducationFilter(cond: any): ((edu: unknown) => boolean) | null {
  const min = cond.education_min != null && String(cond.education_min).trim() ? educationLevel(cond.education_min) : -1;
  const max = cond.education_max != null && String(cond.education_max).trim() ? educationLevel(cond.education_max) : -1;
  const exact = cond.education != null && String(cond.education).trim() ? educationLevel(cond.education) : -1;
  if (min < 0 && max < 0 && exact < 0) return null;
  return (edu: unknown) => {
    const lv = educationLevel(edu);
    if (lv < 0) return false;
    if (min >= 0 && lv < min) return false;
    if (max >= 0 && lv > max) return false;
    if (exact >= 0 && lv !== exact) return false;
    return true;
  };
}

// 返回年龄过滤函数；未提供年龄条件时返回 null
function buildAgeFilter(cond: any): ((age: number) => boolean) | null {
  const min = cond.age_min != null && !Number.isNaN(Number(cond.age_min)) ? Number(cond.age_min) : null;
  const max = cond.age_max != null && !Number.isNaN(Number(cond.age_max)) ? Number(cond.age_max) : null;
  if (min == null && max == null) return null;
  return (age: number) => {
    if (min != null && age < min) return false;
    if (max != null && age > max) return false;
    return true;
  };
}

// 条件批量入库/淘汰（2026-08-14）：
// 按条件（相关人/岗位/状态/AI 初筛结果/学历/年龄）在服务端过滤简历，批量入库(approve)或淘汰(reject)。
// 认证与 export 一致（x-api-key 或 Bearer JWT）。学历/年龄只在服务端匹配，不暴露到公开列表。
// 场景示例：
//   {"action":"approve","conditions":{"related_person":"黄维","education_min":"本科","screening_result":"通过"}}
//   {"action":"reject","conditions":{"education":"大专","age_max":30}}
app.post('/api/public/resumes/action', async (c) => {
  // —— 认证（复用 export 的鉴权）——
  let actor = 'external-api';
  const apiKey = c.req.header('x-api-key') || '';
  const auth = c.req.header('Authorization') || '';
  const authMatch = auth.match(/^Bearer\s+(.+)$/i);
  if (apiKey && c.env.RESUME_UPLOAD_API_KEY && apiKey === c.env.RESUME_UPLOAD_API_KEY) {
    // 有效 API Key
  } else if (authMatch) {
    const payload = await verifyJwt(c.env.SECRET_KEY, authMatch[1]);
    if (!payload) return c.json({ detail: 'Invalid token' }, 401);
    const user = await getUser(c.env.DB, payload.sub);
    if (!user || !user.is_active) return c.json({ detail: 'Not authorized' }, 401);
    actor = user.email;
  } else {
    return c.json({ detail: 'Missing API key or token' }, 401);
  }

  try {
    const body: any = await c.req.json().catch(() => ({}));
    const action = body.action === 'reject' ? 'reject' : 'approve';
    const cond: any = body.conditions && typeof body.conditions === 'object' ? body.conditions : {};

    if (Object.keys(cond).length === 0) {
      return c.json({ detail: '至少需要一个过滤条件' }, 400);
    }

    const clauses: string[] = [];
    const params: any[] = [];
    if (cond.related_person) {
      const filter = await buildPersonResumeFilter(c.env.DB, String(cond.related_person).trim());
      clauses.push(`(${filter.where})`);
      params.push(...filter.params);
    }
    if (cond.position_id) {
      clauses.push('position_id = ?');
      params.push(String(cond.position_id));
    }
    if (cond.status) {
      clauses.push('status = ?');
      params.push(String(cond.status));
    }
    if (cond.screening_result) {
      clauses.push('screening_result = ?');
      params.push(String(cond.screening_result));
    }
    const where = clauses.length ? clauses.join(' AND ') : '1';

    const limitRaw = parseInt(body.limit ?? '200', 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 200;

    const rows = await c.env.DB.prepare(
      `SELECT id, candidate_name, education, parsed_data FROM resumes WHERE ${where} ORDER BY created_at DESC, updated_at DESC LIMIT ?`
    ).bind(...params, limit).all();
    const candidates = (rows.results || []) as any[];

    // 学历/年龄 JS 过滤（学历/年龄不在公开列表暴露，仅在服务端匹配）
    const educationFilter = buildEducationFilter(cond);
    const ageFilter = buildAgeFilter(cond);
    const matched = candidates.filter((r: any) => {
      // 学历列可能为空，回退到 parsed_data.highest_degree（与简历列表口径一致）
      let edu = r.education;
      if (!edu) {
        try {
          const pd = JSON.parse(r.parsed_data || '{}');
          if (pd && typeof pd === 'object') edu = pd.highest_degree || '';
        } catch { /* parsed_data 非 JSON，视为无学历 */ }
      }
      if (educationFilter && !educationFilter(edu)) return false;
      if (ageFilter) {
        let age: number | null = null;
        try {
          const pd = JSON.parse(r.parsed_data || '{}');
          age = typeof pd.age === 'number' ? pd.age : (pd.age != null ? Number(pd.age) : null);
        } catch { /* parsed_data 非 JSON，视为无年龄 */ }
        if (age === null || Number.isNaN(age)) return false;
        if (!ageFilter(age)) return false;
      }
      return true;
    });

    const ids = matched.map((r: any) => String(r.id));
    if (ids.length === 0) {
      return c.json({ ok: true, action, matched: 0, affected: 0, skipped: 0, detail: '没有符合条件的结果' });
    }

    const result = action === 'reject'
      ? await rejectBatch(c.env.DB, ids, actor === 'external-api' ? 'public-batch-reject' : actor)
      : await approveBatch(c.env.DB, ids, actor === 'external-api' ? 'public-batch-approve' : actor);

    return c.json({
      ok: true,
      action,
      matched: ids.length,
      affected: result.approved.length,
      skipped: result.skipped.length,
      failed: result.failed.length,
      resume_ids: ids,
      detail: ids.length >= limit ? `命中数量可能超过单次上限 ${limit}，本次处理前 ${limit} 份` : undefined,
    });
  } catch (e: any) {
    return c.json({ detail: 'Internal error: ' + e.message }, 500);
  }
});

// ==================== Initialization ====================

app.post('/api/init/reset', authMiddleware, requireRole(['admin']), async (c) => {
  const transactionalTables = [
    'workflow_node_executions',
    'workflow_executions',
    'probation_records',
    'onboarding_records',
    'background_checks',
    'talent_pool',
    'interview_panels',
    'interviews',
    'department_reviews',
    'resumes',
  ];
  const results: Record<string, number> = {};
  for (const table of transactionalTables) {
    const r = await c.env.DB.prepare(`DELETE FROM ${table}`).run();
    results[table] = r.meta?.changes ?? 0;
  }
  return c.json({ success: true, deleted: results });
});

app.get('/api/init/status', authMiddleware, requireRole(['admin']), async (c) => {
  // 自动迁移：补列（CREATE IF NOT EXISTS 无法补列，用 try/catch 安全执行）
  const migrations = [
    "ALTER TABLE positions ADD COLUMN responsible_person TEXT DEFAULT ''",
    "ALTER TABLE positions ADD COLUMN personalized_requirements TEXT DEFAULT ''",
    "ALTER TABLE positions ADD COLUMN capability_dimensions TEXT DEFAULT '[]'",
    "ALTER TABLE users ADD COLUMN feishu_token TEXT DEFAULT ''",
    "ALTER TABLE users ADD COLUMN feishu_refresh_token TEXT DEFAULT ''",
    "ALTER TABLE users ADD COLUMN feishu_token_expires_at INTEGER DEFAULT 0",
    "ALTER TABLE users ADD COLUMN feishu_token_failed_at TEXT",
    "ALTER TABLE positions ADD COLUMN primary_interviewer TEXT DEFAULT ''",
    "ALTER TABLE positions ADD COLUMN secondary_interviewer TEXT DEFAULT ''",
    // 面试自动化灰度开关：岗位 AI 初筛通过后是否自动进入业务筛选/面试推进
    "ALTER TABLE positions ADD COLUMN auto_business_screening_enabled INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE interviews ADD COLUMN primary_interviewer TEXT DEFAULT ''",
    "ALTER TABLE interviews ADD COLUMN secondary_interviewer TEXT DEFAULT ''",
    // 开始面试流程 - 飞书会议日程 + 候选人邮件
    "ALTER TABLE interviews ADD COLUMN feishu_event_id TEXT DEFAULT ''",
    "ALTER TABLE interviews ADD COLUMN invite_token_hash TEXT DEFAULT ''",
    "ALTER TABLE interviews ADD COLUMN invite_expires_at TEXT",
    "ALTER TABLE interviews ADD COLUMN invite_email_sent_at TEXT",
    // v2.0 全需求重构 - 需求管理增强
    "ALTER TABLE job_requisitions ADD COLUMN city TEXT DEFAULT '[]'",
    "ALTER TABLE job_requisitions ADD COLUMN hard_requirements TEXT DEFAULT '[]'",
    "ALTER TABLE job_requisitions ADD COLUMN hr_interviewer TEXT DEFAULT ''",
    "ALTER TABLE job_requisitions ADD COLUMN biz_interviewer TEXT DEFAULT ''",
    "ALTER TABLE job_requisitions ADD COLUMN final_interviewer TEXT DEFAULT ''",
    "ALTER TABLE job_requisitions ADD COLUMN responsible_person TEXT DEFAULT ''",
    "ALTER TABLE job_requisitions ADD COLUMN capability_requirements TEXT DEFAULT ''",
    // v2.0 - 简历管理增强
    "ALTER TABLE resumes ADD COLUMN hard_requirement_result TEXT DEFAULT ''",
    "ALTER TABLE resumes ADD COLUMN capability_scores TEXT DEFAULT '{}'",
    "ALTER TABLE resumes ADD COLUMN three_layer_match TEXT DEFAULT '{}'",
    "ALTER TABLE resumes ADD COLUMN feishu_file_token TEXT DEFAULT ''",
    "ALTER TABLE resumes ADD COLUMN uploaded_at TEXT DEFAULT ''",
    ...RESUME_LIST_COMPATIBILITY_MIGRATIONS,
    "ALTER TABLE daily_reports ADD COLUMN total_offers INTEGER DEFAULT 0",
    "ALTER TABLE daily_reports ADD COLUMN candidate_details TEXT",
    // v2.0 - 入职管理增强
    "ALTER TABLE onboarding_records ADD COLUMN status_transitions TEXT DEFAULT '[]'",
    "ALTER TABLE onboarding_records ADD COLUMN probation_record_id TEXT DEFAULT ''",
  ];
  for (const sql of migrations) {
    try { await c.env.DB.prepare(sql).run(); } catch { /* column may already exist */ }
  }
  await ensureBusinessScreeningSchema(c.env.DB);

  // v2.0: create jd_versions table
  try {
    await c.env.DB.prepare(`CREATE TABLE IF NOT EXISTS jd_versions (
      id TEXT PRIMARY KEY,
      position_id TEXT NOT NULL,
      description TEXT NOT NULL,
      requirements TEXT,
      version_number INTEGER DEFAULT 1,
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`).run();
  } catch { /* table may already exist */ }

  const counts: Record<string, number> = {};
  const tables = ['positions', 'resumes', 'interviews', 'users', 'job_requisitions'];
  for (const table of tables) {
    const r = await c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM ${table}`).first();
    counts[table] = r?.cnt ?? 0;
  }
  return c.json(counts);
});

// ==================== Position Dedup (v2.0) ====================
app.post('/api/positions/dedup', authMiddleware, async (c) => {
  try {
    // 岗位默认负责人和一面/二面面试官是标准岗位的唯一配置源，去重不能清空。
    return c.json({ deduped: 0, message: '已保留岗位默认负责人和面试官，重复岗位记录由页面继续删除' });
  } catch (e: any) {
    return c.json({ detail: e.message }, 500);
  }
});

// ==================== JD Management (v2.0 新增模块) ====================
// GET /api/jd-management — 所有岗位的 JD 列表
app.get('/api/jd-management', authMiddleware, async (c) => {
  try {
    const results = await c.env.DB.prepare(
      'SELECT id, title, department, description, requirements, status, updated_at FROM positions ORDER BY updated_at DESC'
    ).all();
    return c.json((results.results || []).map(transformRow));
  } catch (e: any) {
    return c.json({ detail: e.message }, 500);
  }
});

// GET /api/jd-management/:id — 单个 JD + 版本历史
app.get('/api/jd-management/:id', authMiddleware, async (c) => {
  try {
    const pos = await c.env.DB.prepare(
      'SELECT id, title, department, description, requirements, status, updated_at FROM positions WHERE id = ?'
    ).bind(c.req.param('id')).first();
    if (!pos) return c.json({ detail: 'Not found' }, 404);
    const versions = await c.env.DB.prepare(
      'SELECT * FROM jd_versions WHERE position_id = ? ORDER BY version_number DESC'
    ).bind(c.req.param('id')).all();
    return c.json({
      ...transformRow(pos),
      versions: (versions.results || []).map(transformRow),
    });
  } catch (e: any) {
    return c.json({ detail: e.message }, 500);
  }
});

// PUT /api/jd-management/:id — 修改 JD（创建新版本）
app.put('/api/jd-management/:id', authMiddleware, async (c) => {
  try {
    const body = await c.req.json();
    const pos = await c.env.DB.prepare('SELECT id, description, requirements FROM positions WHERE id = ?')
      .bind(c.req.param('id')).first() as any;
    if (!pos) return c.json({ detail: 'Not found' }, 404);

    // 创建版本记录
    const verCount = await c.env.DB.prepare(
      'SELECT MAX(version_number) as max_ver FROM jd_versions WHERE position_id = ?'
    ).bind(c.req.param('id')).first() as any;
    const nextVer = (verCount?.max_ver || 0) + 1;

    await c.env.DB.prepare(
      'INSERT INTO jd_versions (id, position_id, description, requirements, version_number, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(uuid(), c.req.param('id'), pos.description, pos.requirements, nextVer, c.get('user')?.email || '', now()).run();

    // 更新岗位 JD
    await c.env.DB.prepare('UPDATE positions SET description = ?, requirements = ?, updated_at = ? WHERE id = ?')
      .bind(body.description || pos.description, body.requirements || pos.requirements, now(), c.req.param('id')).run();

    return c.json({ detail: 'JD 已更新', version: nextVer });
  } catch (e: any) {
    return c.json({ detail: e.message }, 500);
  }
});

// POST /api/jd-management/:id/evaluate — AI 评估 JD 质量
app.post('/api/jd-management/:id/evaluate', authMiddleware, async (c) => {
  try {
    const pos = await c.env.DB.prepare(
      'SELECT title, department, description, requirements FROM positions WHERE id = ?'
    ).bind(c.req.param('id')).first() as any;
    if (!pos) return c.json({ detail: 'Not found' }, 404);

    const prompt = await getAIPrompt(c.env, 'generate_jd', {
      system: '你是资深 HR 专家，请评估以下岗位 JD 的质量，从可读性、完整性、吸引力、与岗位匹配度四个维度打分（每项 1-10 分），并给出改进建议。返回 JSON 格式：{"readability":7,"completeness":6,"attractiveness":7,"match":8,"suggestions":"改进建议文本"}',
      user: ''
    });
    const systemPrompt = prompt.system;
    const userPrompt = `岗位：${pos.title}\n部门：${pos.department}\nJD：${pos.description}\n要求：${pos.requirements || ''}`;
    const result = await callAI(c.env, systemPrompt, userPrompt);
    return c.json(extractJSON(result));
  } catch (e: any) {
    return c.json({ detail: 'AI 评估失败: ' + e.message }, 500);
  }
});

// CRUD for position mappings
// ==================== 岗位映射：从飞书同步 ====================

/**
 * 从飞书招聘任务表同步责任人/面试官到 position_mappings 表
 * POST /api/position-mappings/sync-from-feishu
 */
app.post('/api/position-mappings/sync-from-feishu', authMiddleware, async (c) => {
  try {
    const tableId = getBitableTableId(c.env, 'requisition');
    const records = await bitableListRecords(c.env, tableId);
    const positionMappings = await buildPositionMapping(c.env.DB);
    const positionRows = await c.env.DB.prepare(
      'SELECT title, responsible_person FROM positions'
    ).all();
    const responsibleByTitle = new Map(
      (positionRows.results || []).map((row: any) => [row.title, row.responsible_person || '']),
    );

    // 岗位映射只维护「原始岗位名 → 标准岗位名」，不保存负责人和面试官配置。
    const aliases = new Map<string, string>();
    for (const rec of records) {
      const f = rec.fields || {};
      const rawTitle = getFirstValue(f['招聘岗位']) || '';
      if (!rawTitle) continue;
      aliases.set(rawTitle, resolveMappedPosition(positionMappings, rawTitle));
    }

    let created = 0;
    let updated = 0;
    for (const [title, mappedTitle] of aliases.entries()) {
      const responsiblePerson = responsibleByTitle.get(mappedTitle) || '';
      const existing = await c.env.DB.prepare(
        'SELECT id, raw_names FROM position_mappings WHERE raw_name = ? LIMIT 1'
      ).bind(title).first() as any;

      if (existing) {
        // 更新别名归属；不触碰 legacy 人员字段，避免映射表继续成为面试官来源。
        let newRawNames: string[] = [];
        try {
          newRawNames = JSON.parse(existing.raw_names || '[]');
        } catch {}
        if (!newRawNames.includes(title)) {
          newRawNames.push(title);
        }
        await c.env.DB.prepare(
          'UPDATE position_mappings SET mapped_name = ?, raw_names = ?, responsible_person = COALESCE(?, responsible_person), updated_at = ? WHERE id = ?'
        ).bind(
          mappedTitle,
          JSON.stringify(newRawNames),
          responsiblePerson || null,
          now(),
          existing.id
        ).run();
        updated++;
      } else {
        // 新建映射 — 同时设置 raw_name（BOSS岗位名称）
        const id = uuid();
        await c.env.DB.prepare(
          'INSERT INTO position_mappings (id, raw_name, mapped_name, raw_names, responsible_person, interviewers, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(
          id, title, mappedTitle,
          JSON.stringify([title]),
          responsiblePerson,
          '[]',
          now(), now()
        ).run();
        created++;
      }
    }

    return c.json({
      ok: true,
      message: `同步完成：新增 ${created} 条映射，更新 ${updated} 条`,
      created,
      updated,
    });
  } catch (e: any) {
    return c.json({ detail: '同步失败: ' + e.message }, 500);
  }
});

// 批量保存岗位映射（创建或更新）
app.post('/api/position-mappings/batch-save', authMiddleware, async (c) => {
  try {
    const body = await c.req.json();
    const { mapped_name, raw_names } = body;
    if (!mapped_name || !Array.isArray(raw_names) || raw_names.length === 0) {
      return c.json({ detail: '缺少必要字段: mapped_name 和 raw_names' }, 400);
    }
    let created = 0, updated = 0;
    for (const raw of raw_names) {
      if (!raw) continue;
      // 检查是否已存在同名 raw_name
      const existing = await c.env.DB.prepare(
        'SELECT id FROM position_mappings WHERE raw_name = ?'
      ).bind(raw).first();
      if (existing) {
        await c.env.DB.prepare(
          'UPDATE position_mappings SET mapped_name = ?, updated_at = ? WHERE raw_name = ?'
        ).bind(mapped_name, now(), raw).run();
        updated++;
      } else {
        await c.env.DB.prepare(
          'INSERT INTO position_mappings (id, raw_name, raw_names, mapped_name, responsible_person, interviewers, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(uuid(), raw, JSON.stringify(raw_names), mapped_name, '', '[]', now(), now()).run();
        created++;
      }
    }
    return c.json({ ok: true, created, updated, message: `已保存: 新增 ${created} 条, 更新 ${updated} 条` });
  } catch (e: any) {
    return c.json({ detail: '批量保存失败: ' + e.message }, 500);
  }
});

registerCrud('position-mappings', 'position_mappings', { raw_name: 'like', mapped_name: 'like' });

// CRUD for capability dimensions
registerCrud('capability-dimensions', 'capability_dimensions', { position_name: 'like' });

// 获取所有已有的能力维度名称列表（去重），供前端多选
app.get('/api/capability-dimension-names', authMiddleware, async (c) => {
  const db = c.env.DB;
  const rows = await db.prepare("SELECT dimensions_json FROM capability_dimensions").all();
  const names = new Set<string>();
  for (const row of rows.results || []) {
    let dims: any[] = [];
    try { dims = JSON.parse((row as any).dimensions_json || '[]'); } catch {}
    for (const d of dims) {
      if (d.name) names.add(d.name);
    }
  }
  return c.json(Array.from(names).sort());
});

// POST /api/capability-dimension-names — 快速添加维度名称到全局池
app.post('/api/capability-dimension-names', authMiddleware, async (c) => {
  try {
    const { name } = await c.req.json();
    if (!name || !name.trim()) return c.json({ detail: '名称不能为空' }, 400);
    const trimmedName = name.trim();
    // 检查是否已存在，避免重复
    const existing = await c.env.DB.prepare(
      "SELECT id FROM capability_dimensions WHERE position_name = ?"
    ).bind(trimmedName).first();
    if (!existing) {
      await c.env.DB.prepare(
        "INSERT INTO capability_dimensions (id, position_name, dimensions_json) VALUES (?, ?, ?)"
      ).bind(crypto.randomUUID(), trimmedName, JSON.stringify([{ name: trimmedName, definition: '', behavior: '' }])).run();
    }
    return c.json({ name: trimmedName, created: !existing });
  } catch (e: any) {
    return c.json({ detail: e.message }, 500);
  }
});
// DELETE /api/capability-dimension-names/:name — 从全局池中删除维度
app.delete('/api/capability-dimension-names/:name', authMiddleware, async (c) => {
  const name = decodeURIComponent(c.req.param('name'));
  await c.env.DB.prepare("DELETE FROM capability_dimensions WHERE position_name = ?").bind(name).run();
  return c.json({ deleted: true, name });
});

// CRUD for recruitment tasks
registerCrud('recruitment-tasks', 'recruitment_tasks', { status: 'eq', position_name: 'like' });

// ==================== 简历管理 v2.0 增强 ====================

// POST /api/resumes/:id/check-hard-requirements — 硬性要求检查
app.post('/api/resumes/:id/check-hard-requirements', authMiddleware, async (c) => {
  try {
    const resume = await c.env.DB.prepare('SELECT id, candidate_name, raw_text, position_id, position_applied, mapped_position, parsed_data FROM resumes WHERE id = ?')
      .bind(c.req.param('id')).first() as any;
    if (!resume) return c.json({ detail: 'Not found' }, 404);
    if (!resume.raw_text) return c.json({ detail: '简历无文本内容' }, 400);

    // 获取关联需求的硬性要求
    let hardReqs: any[] = [];
    const req = await c.env.DB.prepare(
      'SELECT hard_requirements FROM job_requisitions WHERE position_id = ? OR title = ? LIMIT 1'
    ).bind(resume.position_id || '', resume.position_applied || resume.mapped_position || '').first() as any;
    if (req?.hard_requirements) {
      try {
        const parsed = typeof req.hard_requirements === 'string' ? JSON.parse(req.hard_requirements) : req.hard_requirements;
        hardReqs = Array.isArray(parsed) ? parsed : [];
      } catch { hardReqs = []; }
    }

    let candidateFields: Record<string, any> = {};
    try { candidateFields = JSON.parse(resume.parsed_data || '{}'); } catch {}
    const parsed = evaluateHardRequirements(candidateFields, hardReqs);

    await c.env.DB.prepare('UPDATE resumes SET hard_requirement_result = ? WHERE id = ?')
      .bind(JSON.stringify(parsed), c.req.param('id')).run();
    return c.json(parsed);
  } catch (e: any) {
    return c.json({ detail: '硬性要求检查失败: ' + e.message }, 500);
  }
});

// POST /api/resumes/:id/score-capabilities — 能力维度 1-5 评分
app.post('/api/resumes/:id/score-capabilities', authMiddleware, async (c) => {
  try {
    const resume = await c.env.DB.prepare('SELECT id, candidate_name, raw_text, position_id FROM resumes WHERE id = ?')
      .bind(c.req.param('id')).first() as any;
    if (!resume || !resume.raw_text) return c.json({ detail: '简历无文本' }, 400);

    // 获取岗位能力维度
    const pos = await c.env.DB.prepare('SELECT capability_dimensions FROM positions WHERE id = ?')
      .bind(resume.position_id).first() as any;
    let dims: any[] = [];
    if (pos?.capability_dimensions) {
      try { dims = JSON.parse(pos.capability_dimensions); } catch {}
    }

    if (dims.length === 0) {
      return c.json({ detail: '岗位未配置能力维度' }, 400);
    }

    const dimNames = dims.map((d: any) => d.name || d.dimension_name).filter(Boolean);
    const systemPrompt = '你是 HR 评审专家。这个接口只生成能力证据，不作出初筛决策。对候选人逐项评分（0-5分，5分最高）。返回 JSON：{"scores":[{"dimension":"维度名","score":3,"reason":"评分理由"}]}。';
    const userPrompt = `能力维度：${dimNames.join('、')}\n简历：${resume.raw_text.slice(0, 3000)}`;
    const result = await callAI(c.env, systemPrompt, userPrompt);
    const parsed = extractJSON(result);

    const evidence = { ...parsed, screening_decision: null, decision_source: 'evidence_only' };
    await c.env.DB.prepare('UPDATE resumes SET capability_scores = ? WHERE id = ?')
      .bind(JSON.stringify(evidence), c.req.param('id')).run();
    return c.json(evidence);
  } catch (e: any) {
    return c.json({ detail: '评分失败: ' + e.message }, 500);
  }
});

// List screening queue with filters
app.get('/api/resume-screening', authMiddleware, async (c) => {
  const db = c.env.DB;
  const status = c.req.query('status') || '';
  const search = c.req.query('search') || '';
  let sql = 'SELECT * FROM resume_screening_queue';
  const conditions: string[] = [];
  const binds: any[] = [];
  if (status) { conditions.push('status = ?'); binds.push(status); }
  if (search) { conditions.push('(candidate_name LIKE ? OR position_applied LIKE ?)'); binds.push(`%${search}%`, `%${search}%`); }
  if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY created_at DESC';
  const result = await db.prepare(sql).bind(...binds).all();
  return c.json(result.results.map(transformRow));
});

// Get single screening record
app.get('/api/resume-screening/:id', authMiddleware, async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM resume_screening_queue WHERE id = ?').bind(c.req.param('id')).first();
  if (!row) return c.json({ detail: 'Not found' }, 404);
  return c.json(transformRow(row));
});

// Create screening record (from email scan or manual upload)
app.post('/api/resume-screening', authMiddleware, async (c) => {
  const body = await c.req.json();
  const id = body.id || uuid();
  const ts = now();
  await c.env.DB.prepare(
    `INSERT INTO resume_screening_queue (id, resume_id, candidate_name, position_applied, mapped_position, city, ai_analysis, ai_result, match_score, risk_points, match_reasons, interview_questions, strengths, age, gender, education, file_name, email_subject, status, batch_num, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    id, body.resume_id || null, body.candidate_name || '未知', body.position_applied || '',
    body.mapped_position || '', body.city || '', body.ai_analysis || '', body.ai_result || 'pending',
    body.match_score || 0, body.risk_points || '', body.match_reasons || '', body.interview_questions || '',
    body.strengths || '', body.age || '', body.gender || '', body.education || '',
    body.file_name || '', body.email_subject || '', body.status || 'pending', body.batch_num || 1,
    ts, ts
  ).run();
  const row = await c.env.DB.prepare('SELECT * FROM resume_screening_queue WHERE id = ?').bind(id).first();
  return c.json(transformRow(row));
});

// AI analyze a resume for screening (core 小七 analysis engine)
async function analyzeResumeScreeningRecord(env: Env, record: any) {
  let resumeText = '';
  if (record.resume_id) {
    const resume = await env.DB.prepare('SELECT raw_text, ocr_markdown FROM resumes WHERE id = ?').bind(record.resume_id).first() as any;
    resumeText = resume?.ocr_markdown || resume?.raw_text || '';
  }
  if (!resumeText) resumeText = record.ai_analysis || '无简历文本';

  let mappedPosition = record.mapped_position || '';
  if (!mappedPosition && record.position_applied) {
    const pmRow = await env.DB.prepare('SELECT mapped_name FROM position_mappings WHERE raw_name LIKE ? LIMIT 1')
      .bind(`%${record.position_applied.split('_')[0]}%`).first() as any;
    if (pmRow?.mapped_name) mappedPosition = pmRow.mapped_name;
  }
  if (!mappedPosition) mappedPosition = record.position_applied?.split('_')[0] || '未知岗位';

  const positionRequirements = await getPositionRequirements(env, mappedPosition);
  const configuredDimensions = positionRequirements?.capability_dimensions || [];
  const screeningRules = positionRequirements?.screeningRules
    || resolveScreeningRules(await getSystemScreeningRules(env.DB));
  const result = await callAI(
    env,
    `你是专业的简历初筛专家，只返回 JSON。${WEIGHTED_SCREENING_PROMPT}`,
    `岗位：${mappedPosition}\n岗位职责：${positionRequirements?.description || '-'}\n岗位要求：${positionRequirements?.requirements || '-'}\n能力维度：${JSON.stringify(configuredDimensions)}\n候选人：${record.candidate_name || '未知'}\n简历：${resumeText}\n${buildScreeningRulesPrompt(screeningRules)}\n请返回 {"summary":"摘要","strengths":[],"risks":[],"suggested_questions":[],"dimensions":[{"name":"七个指定维度之一","score":0,"reason":"中文依据"}]}。`,
    'deepseek-v4-flash',
  );
  const parsed = extractJSON(result);
  const evidence = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : { summary: String(parsed || '') };
  const persistence = buildScreeningQueuePersistence(evidence, configuredDimensions, screeningRules);
  await env.DB.prepare(`UPDATE resume_screening_queue SET
    ai_analysis=?, ai_result=?, screening_result=?, match_score=?, weighted_score=?, gate_results=?, screening_reason=?, mapped_position=?, updated_at=?
    WHERE id=?`)
    .bind(
      persistence.ai_analysis,
      persistence.ai_result,
      persistence.screening_result,
      persistence.match_score,
      persistence.weighted_score,
      persistence.gate_results,
      persistence.screening_reason,
      mappedPosition,
      now(),
      record.id,
    ).run();
  return persistence;
}

app.post('/api/resume-screening/:id/ai-analyze', authMiddleware, async (c) => {
  const id = c.req.param('id');
  const record = await c.env.DB.prepare('SELECT * FROM resume_screening_queue WHERE id = ?').bind(id).first() as any;
  if (!record) return c.json({ detail: 'Not found' }, 404);

  try {
    await analyzeResumeScreeningRecord(c.env, record);
  } catch (e: any) {
    return c.json({ detail: `AI分析失败: ${e.message}` }, 500);
  }

  const row = await c.env.DB.prepare('SELECT * FROM resume_screening_queue WHERE id = ?').bind(id).first();
  return c.json(transformRow(row));
});

// Approve a screening record (入库 -> creates talent_pool entry)
app.post('/api/resume-screening/:id/approve', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const record = await c.env.DB.prepare('SELECT * FROM resume_screening_queue WHERE id = ?').bind(id).first() as any;
  if (!record) return c.json({ detail: 'Not found' }, 404);
  if (record.status !== 'pending') return c.json({ detail: 'Already processed' }, 400);

  const tpId = uuid();
  const reviewedAt = now();
  const claimed = await claimScreeningQueueRecord(c.env.DB, id, reviewedAt);
  if (!claimed) return c.json({ detail: 'Already processed' }, 409);

  const talentPoolInsert = c.env.DB.prepare(
    `INSERT INTO talent_pool (id, resume_id, candidate_name, email, phone, current_title, skills, experience_years, education, expected_salary, source, tags, status, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    tpId, record.resume_id || null, record.candidate_name, '', '', record.position_applied || '',
    '[]', 0, record.education || '', '', '邮箱初筛',
    JSON.stringify(['AI初筛']), 'available',
    record.ai_analysis || '', now(), now()
  );
  try {
    await commitScreeningDecisionAtomically(c.env.DB, {
      queueId: id,
      resumeId: record.resume_id,
      decision: 'store',
      reviewedBy: user.id,
      timestamp: reviewedAt,
      additionalStatements: [talentPoolInsert],
    });
  } catch (error) {
    await releaseScreeningQueueClaim(c.env.DB, id, reviewedAt);
    throw error;
  }

  // 写入飞书多维表格 + 推群（异步）
  c.executionCtx.waitUntil((async () => {
    try {
      const token = await getFeishuToken(c.env);
      const appToken = c.env.FEISHU_BITABLE_APP_TOKEN || FEISHU_CONFIG.appToken;
      const talentTableId = c.env.FEISHU_TALENT_TABLE_ID || FEISHU_CONFIG.talentTableId;
      const posName = record.mapped_position || record.position_applied?.split('_')[0] || '未知岗位';

      // 写飞书人才库多维表格
      await createFeishuBitableRecord(token, appToken, talentTableId, {
        '姓名': record.candidate_name || '未知',
        '年龄': record.age || null,
        '性别': record.gender || null,
        '学历': record.education || null,
        '面试岗位': record.position_applied || null,
        '招聘岗位': posName,
        '城市': record.city || null,
        'AI简历评估': record.ai_analysis || '',
        'AI简历初筛结果': '已入库',
      });

      // 推送到招聘群
      const updated = await c.env.DB.prepare('SELECT * FROM resume_screening_queue WHERE id = ?').bind(id).first() as any;
      await pushCandidateToGroup(c.env, updated);

      // 提醒对应的面试官
      await notifyInterviewersForCandidate(c.env, updated, c.get('user'));
    } catch (e: any) {
      console.error(`入库后处理失败: ${e.message}`);
    }
  })());

  const row = await c.env.DB.prepare('SELECT * FROM resume_screening_queue WHERE id = ?').bind(id).first();
  return c.json({ ...transformRow(row), talent_pool_id: tpId });
});

// Reject a screening record (淘汰)
app.post('/api/resume-screening/:id/reject', authMiddleware, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const record = await c.env.DB.prepare('SELECT * FROM resume_screening_queue WHERE id = ?').bind(id).first() as any;
  if (!record) return c.json({ detail: 'Not found' }, 404);
  if (record.status !== 'pending') return c.json({ detail: 'Already processed' }, 400);

  const reviewedAt = now();
  const claimed = await claimScreeningQueueRecord(c.env.DB, id, reviewedAt);
  if (!claimed) return c.json({ detail: 'Already processed' }, 409);
  try {
    await commitScreeningDecisionAtomically(c.env.DB, {
      queueId: id,
      resumeId: record.resume_id,
      decision: 'discard',
      reviewedBy: user.id,
      timestamp: reviewedAt,
    });
  } catch (error) {
    await releaseScreeningQueueClaim(c.env.DB, id, reviewedAt);
    throw error;
  }

  const row = await c.env.DB.prepare('SELECT * FROM resume_screening_queue WHERE id = ?').bind(id).first();
  return c.json(transformRow(row));
});

// Batch AI analyze all pending records
app.post('/api/resume-screening/batch-analyze', authMiddleware, async (c) => {
  const result = await c.env.DB.prepare("SELECT id FROM resume_screening_queue WHERE status = 'pending' AND (ai_analysis IS NULL OR ai_analysis = '') ORDER BY created_at LIMIT 25").all();
  const ids = result.results.map((r: any) => r.id);
  let processed = 0;
  for (const rid of ids) {
    try {
      const rec = await c.env.DB.prepare('SELECT * FROM resume_screening_queue WHERE id = ?').bind(rid).first() as any;
      if (!rec) continue;
      await analyzeResumeScreeningRecord(c.env, rec);
      processed++;
    } catch (e) { /* skip on error */ }
  }
  return c.json({ processed, total: ids.length });
});

// Create screening record from resume (link existing resume to screening queue)
app.post('/api/resume-screening/from-resume/:resumeId', authMiddleware, async (c) => {
  const resumeId = c.req.param('resumeId');
  const resume = await c.env.DB.prepare('SELECT * FROM resumes WHERE id = ?').bind(resumeId).first() as any;
  if (!resume) return c.json({ detail: 'Resume not found' }, 404);

  const id = uuid();
  const ts = now();
  const positionApplied = resume.position_title || resume.target_position || '';
  // Map position
  let mappedPosition = '';
  if (positionApplied) {
    const pmRow = await c.env.DB.prepare('SELECT mapped_name FROM position_mappings WHERE ? LIKE "%" || raw_name || "%" LIMIT 1').bind(positionApplied).first() as any;
    if (pmRow?.mapped_name) mappedPosition = pmRow.mapped_name;
  }

  await c.env.DB.prepare(
    `INSERT INTO resume_screening_queue (id, resume_id, candidate_name, position_applied, mapped_position, age, gender, education, status, batch_num, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(id, resumeId, resume.candidate_name || '未知', positionApplied, mappedPosition, resume.age || '', resume.gender || '', resume.education || '', 'pending', 1, ts, ts).run();

  const row = await c.env.DB.prepare('SELECT * FROM resume_screening_queue WHERE id = ?').bind(id).first();
  return c.json(transformRow(row));
});

// ==================== Daily Reports ====================

app.get('/api/daily-reports', authMiddleware, async (c) => {
  const result = await c.env.DB.prepare('SELECT * FROM daily_reports ORDER BY created_at DESC LIMIT 100').all();
  return c.json(result.results.map(transformRow));
});

function dailyReportGenerationDependencies(env: Env): DailyReportGenerationDependencies {
  return {
    summarize: async (snapshot: DailyReportSnapshot) => {
      const prompt = await getAIPrompt(env, 'generate_daily_report', {
        system: '你是招聘数据分析专家。仅根据去标识化聚合数据输出100至150个中文字符，说明推进量最高负责人、最大堵点和一条次日行动。不要输出候选人信息。',
        user: '报告日期：{report_date}\n去标识化聚合快照：{stats_data}',
      });
      const aggregateOnlyInput = prompt.user
        .replace('{report_date}', snapshot.reportDate)
        .replace('{stats_data}', JSON.stringify(snapshot));
      return await callAI(env, prompt.system, aggregateOnlyInput);
    },
  };
}

app.post('/api/daily-reports/generate', authMiddleware, async (c) => {
  let body: any;
  try {
    body = await c.req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid JSON object');
  } catch {
    return c.json({ detail: '请求体必须是合法 JSON' }, 400);
  }
  try {
    const reportDate = body.report_date === undefined
      ? getShanghaiReportDate()
      : assertDailyReportDate(body.report_date);
    const report = await generateAndPersistDailyReport(
      c.env,
      reportDate,
      dailyReportGenerationDependencies(c.env),
    );
    return c.json(transformRow(report));
  } catch (e: any) {
    const status = /report_date must be/.test(e?.message || '') ? 400 : 500;
    return c.json({ detail: `生成日报失败: ${e?.message || '未知错误'}` }, status as 400 | 500);
  }
});

app.delete('/api/daily-reports/:id', authMiddleware, async (c) => {
  await c.env.DB.prepare('DELETE FROM daily_reports WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ detail: 'Report deleted' });
});

// 日报详情：按负责人分组返回候选人明细
app.get('/api/daily-reports/:id/details', authMiddleware, async (c) => {
  try {
    const id = c.req.param('id');
    const row = await c.env.DB.prepare('SELECT * FROM daily_reports WHERE id = ?').bind(id).first();
    if (!row) return c.json({ detail: '日报不存在' }, 404);
    const r: any = transformRow(row);
    
    // 如果有缓存的数据直接返回
    if (r.candidate_details) {
      try {
        const details = typeof r.candidate_details === 'string' ? JSON.parse(r.candidate_details) : r.candidate_details;
        return c.json(details);
      } catch {}
    }
    
    // 没有缓存则实时查询
    const reportDate = r.report_date || '';
    const detail = await queryDailyCandidatesByOwner(c.env.DB, reportDate, true);
    return c.json(detail);
  } catch (e: any) {
    return c.json({ detail: '获取日报详情失败: ' + e.message }, 500);
  }
});

// 发送日报到飞书
app.post('/api/daily-reports/:id/send', authMiddleware, async (c) => {
  let body: any;
  try {
    body = await c.req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid JSON object');
  } catch {
    return c.json({ detail: '请求体必须是合法 JSON' }, 400);
  }
  try {
    const { target_type, target_id } = body;
    if (!target_type || !target_id) {
      return c.json({ detail: '请指定发送目标' }, 400);
    }

    const row = await c.env.DB.prepare('SELECT * FROM daily_reports WHERE id = ?').bind(c.req.param('id')).first();
    if (!row) return c.json({ detail: '日报不存在' }, 404);

    if (target_type !== 'chat' && target_type !== 'user') {
      return c.json({ detail: '不支持的发送类型' }, 400);
    }
    await sendStoredDailyReport(
      row,
      { type: target_type, id: target_id },
      async (target, card) => {
        if (target.type === 'chat') {
          const token = await getFeishuToken(c.env);
          await sendFeishuMessageToChat(token, target.id, card);
          return;
        }
        await sendFeishuMessageWithFallback(c.env, c.get('user')?.email, target.id, card);
      },
    );

    return c.json({ ok: true, detail: '发送成功' });
  } catch (e: any) {
    return c.json({ detail: '发送失败: ' + e.message }, 500);
  }
});


// ==================== Feishu Sync ====================

/**
 * 从飞书多维表格同步需求管理数据
 * 表1(tblEiMBFXcvSspQd): 年度招聘需求 → job_requisitions
 * 
 * 字段映射（JSON数组顺序）:
 *   [0]序号 [1]招聘账号 [2]招聘理由 [3]说明 [4]三级部门 [5]招聘岗位
 *   [6]HR二面 [7]招聘JD [8]业务一面 [9]结束招聘 [10]开始招聘 [11]终面
 *   [12]紧急度 [13]城市等级 [14]岗位职责与任职要求 [15]岗位能力维度要求
 *   [16]是否在编制内 [17]二级部门 [18]责任人 [19]招聘进度
 *   [20]岗位能力提取 [21]招聘城市 [22]招聘人数 [23]招聘状态
 */

// ---- 面试官映射：DB 优先，兜底硬编码 ----
async function getInterviewerOpenIds(env: Env): Promise<Record<string, string>> {
  try {
    const rows = await env.DB.prepare('SELECT name, open_id FROM interviewer_mappings ORDER BY name').all();
    if (rows.results && rows.results.length > 0) {
      const map: Record<string, string> = {};
      for (const r of rows.results) {
        if (r.name && r.open_id) map[r.name] = r.open_id;
      }
      if (Object.keys(map).length > 0) return map;
    }
  } catch (e: any) {
    // 表可能还不存在，忽略
    console.warn(`[Interviewer] DB read failed, using hardcoded: ${e.message}`);
  }
  // 硬编码的 FEISHU_CONFIG 中的 open_id 属于多维表格应用，不能跨应用发消息
  // 只使用 interviewer_mappings 表和 users 表的数据
  return {} as Record<string, string>;
}

async function getInterviewerOpenId(env: Env, name: string): Promise<string> {
  // 1. 先从 interviewer_mappings 表查
  const map = await getInterviewerOpenIds(env);
  if (map[name]) {
    console.log('[getInterviewerOpenId] matched interviewer_mappings');
    return map[name];
  }

  // 2. 再从 users 表查（OAuth 绑定的 feishu_open_id，和 cli_aad2cb7fab385cb6 同应用）
  try {
    const userRow = await env.DB.prepare(
      "SELECT feishu_open_id FROM users WHERE full_name = ? AND feishu_open_id IS NOT NULL AND feishu_open_id != '' LIMIT 1"
    ).bind(name).first() as any;
    if (userRow?.feishu_open_id) {
      console.log('[getInterviewerOpenId] matched bound user');
      return userRow.feishu_open_id;
    }
  } catch (e: any) {
    console.warn(`[getInterviewerOpenId] users 表查询失败: ${e.message}`);
  }

  // 3. 兜底：对比 users 表里所有已经绑定飞书的用户姓名（支持模糊匹配）
  try {
    const boundUsers = await env.DB.prepare(
      "SELECT full_name, feishu_open_id FROM users WHERE feishu_open_id IS NOT NULL AND feishu_open_id != ''"
    ).all() as any;
    for (const u of (boundUsers.results || [])) {
      if (u.full_name && u.feishu_open_id && (u.full_name.includes(name) || name.includes(u.full_name))) {
        console.log('[getInterviewerOpenId] matched bound user by normalized name');
        return u.feishu_open_id;
      }
    }
  } catch {}

  // 4. ❌ 硬编码的 FEISHU_CONFIG 中的 open_id 属于多维表格应用，不能跨应用发消息
  //    直接返回空，让调用方知道面试官未绑定飞书
  console.warn('[getInterviewerOpenId] no bound interviewer found');
  return '';
}

/**
 * 用 refresh_token 刷新 user_access_token
 * 返回 { access_token, refresh_token, expires_at } 或 null（刷新失败）
 */
async function refreshUserAccessToken(env: Env, email: string): Promise<{ access_token: string; refresh_token: string; expires_at: number } | null> {
  const row = await env.DB.prepare(
    "SELECT feishu_refresh_token FROM users WHERE email = ? AND feishu_refresh_token IS NOT NULL AND feishu_refresh_token != ''"
  ).bind(email).first() as any;
  if (!row?.feishu_refresh_token) return null;

  const appId = env.FEISHU_APP_ID || FEISHU_CONFIG.appId;
  const appSecret = env.FEISHU_APP_SECRET;
  if (!appSecret) {
    console.error('[refreshUserAccessToken] FEISHU_APP_SECRET 未配置');
    return null;
  }
  const redirectUri = env.FEISHU_OAUTH_REDIRECT_URI || FEISHU_REDIRECT_URI;

  try {
    const resp = await fetch('https://open.feishu.cn/open-apis/authen/v2/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        client_id: appId,
        client_secret: appSecret,
        refresh_token: row.feishu_refresh_token,
        redirect_uri: redirectUri,
      }),
    });
    const data: any = await resp.json();
    const newAccessToken = data.access_token || data.data?.access_token || '';
    const newRefreshToken = data.refresh_token || data.data?.refresh_token || row.feishu_refresh_token;
    if (!newAccessToken) {
      console.error('[refreshUserAccessToken] refresh response did not contain an access token');
      await markUserTokenRefreshFailed(env.DB, email, now());
      return null;
    }
    const expiresIn = data.expires_in || data.data?.expires_in || 7200;
    const expiresAt = Date.now() + (expiresIn - 300) * 1000;
    await saveRefreshedUserToken(env.DB, {
      email,
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      expiresAt,
      updatedAt: now(),
    });
    console.log('[refreshUserAccessToken] refresh succeeded');
    return { access_token: newAccessToken, refresh_token: newRefreshToken, expires_at: expiresAt };
  } catch (e: any) {
    console.error(`[refreshUserAccessToken] 异常: ${e.message}`);
    return null;
  }
}

/**
 * 获取有效（未过期）的 user_access_token，过期则自动刷新
 * 返回 token 字符串或 null
 */
async function getValidUserAccessToken(env: Env, email: string): Promise<string | null> {
  const row = await env.DB.prepare(
    "SELECT feishu_token, feishu_token_expires_at, feishu_refresh_token FROM users WHERE email = ?"
  ).bind(email).first() as any;
  if (!row?.feishu_token) return null;

  // 未设置过期时间（老数据兼容：v2 之前的绑定只存了 feishu_token，expires_at/refresh_token 为空）
  // 不预判过期，直接返回 token，交给发送环节验证；若返回 99991677 再由调用方触发刷新
  if (!row.feishu_token_expires_at || row.feishu_token_expires_at <= 0) {
    return row.feishu_token;
  }

  // 未过期，直接用
  if (Date.now() < row.feishu_token_expires_at) {
    return row.feishu_token;
  }

  // 过期，尝试刷新
  console.log('[getValidUserAccessToken] token expired; attempting refresh');
  const refreshed = await refreshUserAccessToken(env, email);
  return refreshed?.access_token || null;
}

export async function getFeishuToken(env: Env): Promise<string> {
  // 先查 D1 缓存（飞书 token 有效期 2h，缓存 110min 留 10min buffer）
  try {
    const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind('feishu_token').first();
    if (row && row.value) {
      const cached = JSON.parse(row.value as string);
      if (cached.token && cached.expiry && Date.now() < cached.expiry) {
        return cached.token;
      }
    }
  } catch { /* 缓存查询失败，继续走正常获取流程 */ }

  const appId = env.FEISHU_APP_ID || FEISHU_CONFIG.appId;
  const appSecret = env.FEISHU_APP_SECRET;
  if (!appSecret) {
    throw new Error('FEISHU_APP_SECRET 未配置（wrangler pages secret put FEISHU_APP_SECRET）');
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  let resp: Response;
  try {
    resp = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      signal: controller.signal,
    });
  } catch (e: any) {
    if (e.name === 'AbortError') throw new Error('飞书 token 获取超时（10s）');
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }
  const data: any = await resp.json();
  if (!data.tenant_access_token) {
    throw new Error(`Feishu auth failed: ${JSON.stringify(data)}`);
  }

  // 写入 D1 缓存（110 分钟后过期）
  const expiry = Date.now() + 110 * 60 * 1000;
  try {
    await env.DB.prepare(
      'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?'
    ).bind('feishu_token', JSON.stringify({ token: data.tenant_access_token, expiry }), new Date().toISOString(), JSON.stringify({ token: data.tenant_access_token, expiry }), new Date().toISOString()).run();
  } catch { /* 缓存写入失败不影响主流程 */ }

  return data.tenant_access_token;
}

// 通过飞书 API 下载 Bitable 附件
async function downloadFeishuAttachment(env: Env, fileToken: string, feishuDownloadUrl?: string): Promise<Response | null> {
  try {
    const token = await getFeishuToken(env);

    // 方法0：如果有 tmp_url（预签名临时URL），直接尝试不鉴权下载
    if (feishuDownloadUrl && !feishuDownloadUrl.includes('box/stream/download/all')) {
      const tmpResp = await fetch(feishuDownloadUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        redirect: 'follow',
      });
      if (tmpResp.ok) {
        const ct = tmpResp.headers.get('Content-Type') || '';
        if (ct && !ct.includes('pdf') && !ct.includes('octet-stream') && !ct.includes('binary')) {
          console.error(`[FeishuAPI] 方法0返回非PDF内容: ${ct}，跳过`);
        } else {
          const headers = new Headers({
            'Content-Type': ct || 'application/pdf',
            'Content-Disposition': 'inline; filename="resume.pdf"',
            'Access-Control-Allow-Origin': getAllowedOrigin(c.req.header('origin')) || '',
            'Cache-Control': 'public, max-age=3600',
          });
          return new Response(tmpResp.body, { status: 200, headers });
        }
      }
    }

    // 方法1：用飞书 Open API 的 Drive 下载接口（POST），跟随重定向直接下载
    const postResp = await fetch(
      `https://open.feishu.cn/open-apis/drive/v1/medias/${fileToken}/download`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        redirect: 'follow',
      }
    );
    if (postResp.ok) {
      const ct = postResp.headers.get('Content-Type') || 'application/pdf';
      if (ct && !ct.includes('json')) {
        const headers = new Headers({
          'Content-Type': ct,
          'Content-Disposition': 'inline; filename="resume.pdf"',
          'Access-Control-Allow-Origin': getAllowedOrigin(c.req.header('origin')) || '',
          'Cache-Control': 'public, max-age=3600',
        });
        return new Response(postResp.body, { status: 200, headers });
      }
    }

    // 方法2：Open API GET 方式（同样加 Accept: application/json 防止重定向）
    const getResp = await fetch(
      `https://open.feishu.cn/open-apis/drive/v1/medias/${fileToken}/download`,
      {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        redirect: 'manual',
      }
    );
    const getBody = await getResp.text();
    try {
      const bodyJson = JSON.parse(getBody);
      if (bodyJson.code === 0 && bodyJson.data?.tmp_download_urls?.[0]?.tmp_download_url) {
        const tmpUrl = bodyJson.data.tmp_download_urls[0].tmp_download_url;
        const fileResp = await fetch(tmpUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          redirect: 'follow',
        });
        if (fileResp.ok) {
          const fct = fileResp.headers.get('Content-Type') || 'application/pdf';
          const headers = new Headers({
            'Content-Type': fct,
            'Content-Disposition': 'inline; filename="resume.pdf"',
            'Access-Control-Allow-Origin': getAllowedOrigin(c.req.header('origin')) || '',
            'Cache-Control': 'public, max-age=3600',
          });
          return new Response(fileResp.body, { status: 200, headers });
        }
      }
    } catch {}

    // 方法3：用 tenant_access_token 调飞书内部下载 URL
    if (feishuDownloadUrl) {
      const internalResp = await fetch(feishuDownloadUrl, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Referer': `https://ywwlaii6ga7.feishu.cn/`,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        redirect: 'follow',
      });
      if (internalResp.ok) {
        const ct = internalResp.headers.get('Content-Type') || '';
        if (ct && !ct.includes('pdf') && !ct.includes('octet-stream') && !ct.includes('binary')) {
          console.error(`[FeishuAPI] 方法3返回非PDF内容: ${ct}，跳过`);
        } else {
          const headers = new Headers({
            'Content-Type': ct || 'application/pdf',
            'Content-Disposition': 'inline; filename="resume.pdf"',
            'Access-Control-Allow-Origin': getAllowedOrigin(c.req.header('origin')) || '',
            'Cache-Control': 'public, max-age=3600',
          });
          return new Response(internalResp.body, { status: 200, headers });
        }
      }
      const errText = await internalResp.text().catch(() => '');
      console.error(`[FeishuAPI] internal download status=${internalResp.status} body=${errText.substring(0, 500)}`);

      // 方法3b：仅当 401 时，尝试带 extra 参数的完整 URL
      if (internalResp.status === 401 && feishuDownloadUrl.includes('/download/all/')) {
        // 有些飞书环境需要 extra 参数和 mount_node_token 才能通过 box API 鉴权
        const extraEncoded = encodeURIComponent(JSON.stringify({
          bitablePerm: { tableId: '', attachments: {} }
        }));
        const altUrl = feishuDownloadUrl.includes('?')
          ? feishuDownloadUrl + '&extra=' + extraEncoded
          : feishuDownloadUrl + '?extra=' + extraEncoded;
        const altResp = await fetch(altUrl, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Referer': 'https://ywwlaii6ga7.feishu.cn/',
          },
          redirect: 'follow',
        });
        if (altResp.ok) {
          const ct = altResp.headers.get('Content-Type') || '';
          // 只返回 PDF / 二进制内容，跳过 JSON / HTML
          if (ct && !ct.includes('pdf') && !ct.includes('octet-stream') && !ct.includes('binary')) {
            console.error(`[FeishuAPI] 方法3b返回非PDF内容: ${ct}，跳过`);
          } else {
            const headers = new Headers({
              'Content-Type': ct || 'application/pdf',
              'Content-Disposition': 'inline; filename="resume.pdf"',
              'Access-Control-Allow-Origin': getAllowedOrigin(c.req.header('origin')) || '',
              'Cache-Control': 'public, max-age=3600',
            });
            return new Response(altResp.body, { status: 200, headers });
          }
        }
      }
    }

    // 方法4：完整拷贝 Feishu 下载 URL 并代理（不带 Cookie，透传）
    if (feishuDownloadUrl) {
      const rawResp = await fetch(feishuDownloadUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/pdf,*/*',
        },
        redirect: 'follow',
      });
      if (rawResp.ok) {
        const ct = rawResp.headers.get('Content-Type') || '';
        // 只返回 PDF / 二进制内容，跳过 JSON / HTML
        if (ct && !ct.includes('pdf') && !ct.includes('octet-stream') && !ct.includes('binary')) {
          console.error(`[FeishuAPI] 方法4返回非PDF内容: ${ct}，跳过`);
        } else {
          const headers = new Headers({
            'Content-Type': ct || 'application/pdf',
            'Content-Disposition': 'inline; filename="resume.pdf"',
            'Access-Control-Allow-Origin': getAllowedOrigin(c.req.header('origin')) || '',
            'Cache-Control': 'public, max-age=3600',
          });
          return new Response(rawResp.body, { status: 200, headers });
        }
      }
    }

    console.error(`[FeishuAPI] all download methods failed for token=${fileToken}`);
    return null;
  } catch (e: any) {
    console.error(`[FeishuAPI] download attachment error: ${e.message}`);
    return null;
  }
}

async function getFieldMeta(env: Env, token: string, tableId: string): Promise<any[]> {
  try {
    const appToken = env.FEISHU_BITABLE_APP_TOKEN || FEISHU_CONFIG.appToken;
    const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/fields`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data: any = await resp.json();
    if (data.data && data.data.items) {
      return data.data.items;
    }
    // 如果获取 fields 失败（如权限不够），从记录中推断字段名
    console.warn(`getFieldMeta fallback: ${JSON.stringify(data)}`);
    const records = await getBitableRecords(env, token, tableId);
    if (records.length > 0) {
      return Object.keys(records[0].fields || {}).map(name => ({ field_name: name }));
    }
    return [];
  } catch (err) {
    console.warn(`getFieldMeta error: ${err}`);
    return [];
  }
}

async function getBitableRecords(env: Env, token: string, tableId: string): Promise<any[]> {
  const appToken = env.FEISHU_BITABLE_APP_TOKEN || FEISHU_CONFIG.appToken;
  const allRecords: any[] = [];
  let pageToken: string | null = null;

  do {
    let url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records?page_size=500`;
    if (pageToken) url += `&page_token=${pageToken}`;

    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data: any = await resp.json();
    if (!data.data) {
      throw new Error(`Failed to get records: ${JSON.stringify(data)}`);
    }
    allRecords.push(...(data.data.items || []));
    pageToken = data.data.page_token || null;
    if (!data.data.has_more) break;
  } while (pageToken);

  return allRecords;
}

// ==================== Feishu Card Helpers ====================

/** 构建审核卡片内容（含 ✅入库 / ❌淘汰 按钮） */
function buildScreeningCardContent(record: any, analysis: string, matchScore: number): any {
  const name = record.candidate_name || '未知';
  const posName = record.mapped_position || record.position_applied?.split('_')[0] || '未知岗位';
  const age = record.age || '未知';
  const gender = record.gender || '未知';
  const edu = record.education || '未知';
  const city = record.city || '未知';
  const displayAnalysis = (analysis || 'AI 分析进行中...').substring(0, 3500);

  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: `🤖 候选人 ${name}` },
      template: 'blue'
    },
    elements: [
      {
        tag: 'div',
        text: { tag: 'lark_md', content: `**以下为候选人的 ${posName} 岗位能力评估，AI 生成，仅供参考。**` }
      },
      { tag: 'hr' },
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: [
            `📌 **面试岗位：** ${record.position_applied || '未知'}`,
            `🏢 **招聘岗位：** ${posName}`,
            `👤 **年龄：** ${age} | **性别：** ${gender} | **学历：** ${edu} | **城市：** ${city}`,
            `⭐ **匹配分数：** ${matchScore}/5`
          ].join('\n')
        }
      },
      { tag: 'hr' },
      {
        tag: 'div',
        text: { tag: 'lark_md', content: displayAnalysis }
      },
      { tag: 'hr' },
      {
        tag: 'action',
        actions: [
          {
            tag: 'button',
            text: { tag: 'plain_text', content: '✅ 入库' },
            type: 'primary',
            value: { action: 'store', record_id: record.id, name: name }
          },
          {
            tag: 'button',
            text: { tag: 'plain_text', content: '❌ 淘汰' },
            type: 'danger',
            value: { action: 'discard', record_id: record.id, name: name }
          }
        ]
      }
    ]
  };
}

/** 已入库绿色卡片 */
function buildApprovedCardContent(name: string, posName: string): any {
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: `✅ 已入库: ${name} (${posName})` },
      template: 'green'
    },
    elements: [
      { tag: 'div', text: { tag: 'lark_md', content: `候选人 **${name}** 经过 AI 评估后已被 HR 确认入库。` } },
      { tag: 'hr' },
      { tag: 'note', elements: [{ tag: 'plain_text', content: '此候选人已进入人才库，面试官可查看详情安排面试。' }] }
    ]
  };
}

/** 已淘汰红色卡片 */
function buildRejectedCardContent(name: string, posName: string): any {
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: `❌ 已淘汰: ${name} (${posName})` },
      template: 'red'
    },
    elements: [
      { tag: 'div', text: { tag: 'lark_md', content: `候选人 **${name}** 经过 AI 评估后已被 HR 淘汰。` } },
      { tag: 'hr' },
      { tag: 'note', elements: [{ tag: 'plain_text', content: '此候选人不建议进入后续流程。' }] }
    ]
  };
}

/** 发送审核卡片给指定审核人，返回 message_id */
async function sendFeishuCard(env: Env, record: any, analysis: string, matchScore: number): Promise<string | null> {
  const openId = FEISHU_CONFIG.reviewerOpenId;
  if (!openId) return null;

  const token = await getFeishuToken(env);
  const cardContent = buildScreeningCardContent(record, analysis, matchScore);

  const resp = await fetch('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      receive_id: openId,
      msg_type: 'interactive',
      content: JSON.stringify(cardContent)
    })
  });
  const data: any = await resp.json();
  if (data.code !== 0) {
    console.error(`[FeishuCard] 发送失败: ${JSON.stringify(data)}`);
    return null;
  }
  return data.data?.message_id || null;
}

/** 更新审核卡片颜色 */
async function updateFeishuCard(env: Env, messageId: string, status: string, name: string): Promise<void> {
  const token = await getFeishuToken(env);
  const cardContent = status === 'approved'
    ? buildApprovedCardContent(name, '')
    : buildRejectedCardContent(name, '');

  const resp = await fetch(`https://open.feishu.cn/open-apis/im/v1/messages/${messageId}`, {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      msg_type: 'interactive',
      content: JSON.stringify(cardContent)
    })
  });
  const data: any = await resp.json();
  if (data.code !== 0) console.error(`[FeishuCard] 更新失败: ${JSON.stringify(data)}`);
}

/** 上传文件到飞书云盘 */
async function uploadToFeishuDrive(token: string, fileName: string, fileBytes: ArrayBuffer, parentNode: string): Promise<string | null> {
  try {
    const formData = new FormData();
    formData.append('file_name', fileName);
    formData.append('parent_type', 'explorer');
    formData.append('parent_node', parentNode);
    formData.append('size', String(fileBytes.byteLength));
    const blob = new Blob([fileBytes]);
    formData.append('file', blob, fileName);

    const resp = await fetch('https://open.feishu.cn/open-apis/drive/v1/files/upload_all', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData
    });
    const data: any = await resp.json();
    if (data.code !== 0) throw new Error(JSON.stringify(data));
    return data.data.file_token;
  } catch (e: any) {
    console.error(`[Drive] 上传失败: ${e.message}`);
    return null;
  }
}

/** 在飞书多维表格创建记录 */
async function createFeishuBitableRecord(token: string, appToken: string, tableId: string, fields: any): Promise<string | null> {
  try {
    const resp = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields })
    });
    const data: any = await resp.json();
    if (data.code !== 0) throw new Error(JSON.stringify(data));
    return data.data.record.record_id;
  } catch (e: any) {
    console.error(`[Bitable] 创建记录失败: ${e.message}`);
    return null;
  }
}

// ==================== 按人交付：飞书多维表格（Bitable）与候选人卡片 ====================

/** 创建多维表格应用，返回 { appToken, url } */
async function createFeishuBitableApp(env: Env, name: string): Promise<{ appToken: string; url: string } | null> {
  try {
    const token = await getFeishuToken(env);
    const resp = await fetch('https://open.feishu.cn/open-apis/bitable/v1/apps', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const data: any = await resp.json();
    if (data.code !== 0) throw new Error(JSON.stringify(data));
    const app = data.data?.app || data.data || {};
    const appToken = app.app_token || data.data?.app_token || '';
    if (!appToken) throw new Error(`No app_token in response: ${JSON.stringify(data)}`);
    return { appToken, url: app.url || `https://feishu.cn/base/${appToken}` };
  } catch (e: any) {
    console.error(`[Bitable] 创建应用失败: ${e.message}`);
    return null;
  }
}

/** 在应用中创建一张表（字段：姓名文本 / 岗位文本 / 状态文本 / 阶段文本 / 匹配分数字 / 操作 URL） */
async function createFeishuBitableTable(env: Env, appToken: string, name: string): Promise<{ tableId: string; tableUrl: string } | null> {
  try {
    const token = await getFeishuToken(env);
    const resp = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        table: {
          name,
          default_view_name: '视图',
          fields: [
            { field_name: '候选人', type: 1 },
            { field_name: '岗位', type: 1 },
            { field_name: '状态', type: 1 },
            { field_name: '阶段', type: 1 },
            { field_name: '匹配分', type: 2 },
            { field_name: '操作', type: 15 },
          ],
        },
      }),
    });
    const data: any = await resp.json();
    if (data.code !== 0) throw new Error(JSON.stringify(data));
    const tableId = data.data?.table_id || data.data?.table?.table_id || '';
    if (!tableId) throw new Error(`No table_id in response: ${JSON.stringify(data)}`);
    return { tableId, tableUrl: `https://feishu.cn/base/${appToken}?table=${tableId}` };
  } catch (e: any) {
    console.error(`[Bitable] 创建表失败: ${e.message}`);
    return null;
  }
}

/** 批量写入记录（每批 ≤500 条） */
async function batchCreateFeishuBitableRecords(env: Env, appToken: string, tableId: string, records: Array<{ fields: any }>): Promise<number> {
  const token = await getFeishuToken(env);
  let created = 0;
  for (let i = 0; i < records.length; i += 500) {
    const chunk = records.slice(i, i + 500);
    const resp = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/batch_create`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: chunk }),
    });
    const data: any = await resp.json();
    if (data.code !== 0) {
      console.error(`[Bitable] batch_create 失败: ${JSON.stringify(data)}`);
      throw new Error(JSON.stringify(data));
    }
    created += (data.data?.records || []).length;
  }
  return created;
}

/** 给 open_id 用户授予多维表格查看权限 */
async function grantFeishuBitableViewer(env: Env, appToken: string, openId: string): Promise<boolean> {
  try {
    const token = await getFeishuToken(env);
    const resp = await fetch(`https://open.feishu.cn/open-apis/drive/v1/permissions/${appToken}/members?type=bitable`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ member_type: 'openid', member_id: openId, perm: 'view' }),
    });
    const data: any = await resp.json();
    if (data.code !== 0) {
      // code 10203 = 已存在该成员权限，视为成功
      if (data.code !== 10203) {
        console.error(`[Bitable] 授权失败: ${JSON.stringify(data)}`);
        return false;
      }
    }
    return true;
  } catch (e: any) {
    console.error(`[Bitable] 授权异常: ${e.message}`);
    return false;
  }
}

const RESUME_STATUS_LABELS: Record<string, string> = {
  pending_screening: '待初筛', pending_review: '待评审', pending_dept_review: '待部门评审',
  pending_hr_decision: '待HR决策', pending_interview: '待面试', interview_passed: '面试通过',
  offered: '已发Offer', hired: '已入职', rejected: '已淘汰', approved: '已入库',
};
const RESUME_STAGE_LABELS: Record<string, string> = {
  new: '新简历', talent_pool: '人才库', screening: '初筛中', interview: '面试中',
  offered: 'Offer', hired: '已入职', rejected: '已淘汰',
};

/** 候选人相关简历卡片（带 入库/不入库 按钮） */
function buildPersonResumeCard(resume: any): any {
  const name = resume.candidate_name || '未知';
  const posName = resume.mapped_position || resume.position_applied || '未知岗位';
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: `候选人 ${name}` },
      template: 'indigo',
    },
    elements: [
      { tag: 'div', text: { tag: 'lark_md', content: `**岗位：** ${posName}` } },
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**状态：** ${RESUME_STATUS_LABELS[resume.status] || resume.status || '-'} ｜ **阶段：** ${RESUME_STAGE_LABELS[resume.stage] || resume.stage || '-'} ｜ **匹配分：** ${resume.match_score ?? '-'}`,
        },
      },
      { tag: 'hr' },
      {
        tag: 'action',
        actions: [
          {
            tag: 'button',
            text: { tag: 'plain_text', content: '✅ 入库' },
            type: 'primary',
            value: { action: 'store_resume', record_id: resume.id, name },
          },
          {
            tag: 'button',
            text: { tag: 'plain_text', content: '❌ 不入库' },
            type: 'danger',
            value: { action: 'discard_resume', record_id: resume.id, name },
          },
        ],
      },
    ],
  };
}

/** 推送候选人到招聘群 */
async function pushCandidateToGroup(env: Env, record: any): Promise<void> {
  const chatId = FEISHU_CONFIG.recruitmentGroupChatId;
  if (!chatId || !record) return;

  try {
    const token = await getFeishuToken(env);
    const posName = record.mapped_position || record.position_applied?.split('_')[0] || '未知岗位';
    const analysis = (record.ai_analysis || '').substring(0, 800);
    const posNameShort = posName.length > 20 ? posName.substring(0, 20) + '…' : posName;

    const cardContent = {
      config: { wide_screen_mode: true },
      header: {
        title: { tag: 'plain_text', content: `🆕 新候选人: ${record.candidate_name}` },
        template: 'indigo'
      },
      elements: [
        {
          tag: 'div',
          text: {
            tag: 'lark_md',
            content: `**姓名：** ${record.candidate_name}\n**岗位：** ${posName}\n**年龄：** ${record.age || '未知'} | **学历：** ${record.education || '未知'}\n**城市：** ${record.city || '未知'}\n**匹配度：** ${record.match_score || '-'}/5`
          }
        },
        { tag: 'hr' },
        {
          tag: 'div',
          text: { tag: 'lark_md', content: `**AI 评估摘要：**\n${analysis || '（无分析内容）'}` }
        },
        { tag: 'hr' },
        {
          tag: 'note',
          elements: [{ tag: 'plain_text', content: `系统自动推送 | ${new Date().toLocaleString('zh-CN')}` }]
        }
      ]
    };

    await sendFeishuMessageToChat(token, chatId, cardContent);
    console.log(`[GroupPush] ✅ 已推送候选人记录 ${record.id || ''} 到招聘群`);
  } catch (e: any) {
    console.error(`[GroupPush] 推送失败: ${e.message}`);
  }
}

// ==================== 卡片回调 Endpoint ====================

/**
 * 飞书卡片按钮回调 Webhook
 * POST /api/feishu/card-action
 * 配置：飞书开发者后台 → 应用 → 卡片 → 卡片回调配置
 */
app.post('/api/feishu/card-action', async (c) => {
  try {
    const body: any = await c.req.json();
    const action = body?.action;
    if (!action?.value) {
      return c.json({ code: 0, msg: 'success', data: { toast: { type: 'error', content: '无效数据' } } });
    }

    const v = action.value;
    const actionType = v.action; // 'store' | 'discard' | 'store_resume' | 'discard_resume'
    const recordId = v.record_id;
    const candidateName = v.name || '未知';
    if ((actionType !== 'store' && actionType !== 'discard' && actionType !== 'store_resume' && actionType !== 'discard_resume') || typeof recordId !== 'string' || !recordId) {
      return c.json({ code: 0, msg: 'success', data: { toast: { type: 'error', content: '无效操作' } } });
    }

    console.log(`[CardCallback] ${actionType} - record ${recordId}`);

    // 按人交付卡片的 入库/不入库：直接对 resumes 表操作，不走 resume_screening_queue
    if (actionType === 'store_resume' || actionType === 'discard_resume') {
      try {
        const result = actionType === 'store_resume'
          ? await approveBatch(c.env.DB, [recordId], 'feishu-person-card')
          : await rejectBatch(c.env.DB, [recordId], 'feishu-person-card');
        const done = result.approved.includes(recordId)
          || result.skipped.some((s) => s.id === recordId && (s.reason === 'already_approved' || s.reason === 'already_rejected'));
        if (!done) {
          return c.json({ code: 0, msg: 'success', data: { toast: { type: 'error', content: '处理失败' } } });
        }
        return c.json({
          code: 0, msg: 'success',
          data: { toast: { type: 'success', content: actionType === 'store_resume' ? `${candidateName} 已入库` : `${candidateName} 已不入库` } }
        });
      } catch (err: any) {
        console.error(`[CardCallback] 简历决策失败: ${err.message}`);
        return c.json({ code: 0, msg: 'success', data: { toast: { type: 'error', content: '服务器错误' } } });
      }
    }

    const record = await c.env.DB.prepare('SELECT * FROM resume_screening_queue WHERE id = ?').bind(recordId).first() as any;
    if (!record) {
      return c.json({ code: 0, msg: 'success', data: { toast: { type: 'error', content: '记录不存在' } } });
    }
    const claimToken = now();
    const claimed = await claimScreeningQueueRecord(c.env.DB, recordId, claimToken);
    if (!claimed) {
      return c.json({ code: 0, msg: 'success', data: { toast: { type: 'warning', content: '已处理过' } } });
    }

    const posName = record.mapped_position || record.position_applied?.split('_')[0] || '未知岗位';

    if (actionType === 'store') {
      // ✅ 入库
      c.executionCtx.waitUntil((async () => {
        try {
          await commitScreeningDecisionAtomically(c.env.DB, {
            queueId: recordId,
            resumeId: record.resume_id,
            decision: 'store',
            timestamp: claimToken,
          });
        } catch (e: any) {
          console.error(`[CardCallback] D1 入库决策失败: ${e.message}`);
          await releaseScreeningQueueClaim(c.env.DB, recordId, claimToken);
          return;
        }

        try {
          const token = await getFeishuToken(c.env);
          const appToken = c.env.FEISHU_BITABLE_APP_TOKEN || FEISHU_CONFIG.appToken;
          const talentTableId = c.env.FEISHU_TALENT_TABLE_ID || FEISHU_CONFIG.talentTableId;

          // 上传简历到 Drive（如果有 resume_id 且有文件路径）
          let fileToken: string | null = null;
          if (record.resume_id && FEISHU_CONFIG.driveFolderToken) {
            const resume = await c.env.DB.prepare('SELECT file_path, raw_text FROM resumes WHERE id = ?').bind(record.resume_id).first() as any;
            // 简单场景：仅记录 file info，实际上传需文件 URL
          }

          // 写飞书多维表格（人才库表）
          const bitableFields: any = {
            '姓名': record.candidate_name || '未知',
            '年龄': record.age || null,
            '性别': record.gender || null,
            '学历': record.education || null,
            '面试岗位': record.position_applied || null,
            '招聘岗位': posName,
            '城市': record.city || null,
            'AI简历评估': record.ai_analysis || '',
            'AI简历初筛结果': '已入库',
          };
          await createFeishuBitableRecord(token, appToken, talentTableId, bitableFields);

          // 更新卡片为绿色
          if (record.feishu_card_msg_id) {
            await updateFeishuCard(c.env, record.feishu_card_msg_id, 'approved', candidateName);
          }

          // 推送候选人到招聘群
          const updated = await c.env.DB.prepare('SELECT * FROM resume_screening_queue WHERE id = ?').bind(recordId).first() as any;
          await pushCandidateToGroup(c.env, updated);

          console.log(`[CardCallback] ✅ record ${recordId} 已入库`);
        } catch (e: any) {
          console.error(`[CardCallback] 入库决策已提交，外部同步失败: ${e.message}`);
        }
      })());

      return c.json({
        code: 0, msg: 'success',
        data: { toast: { type: 'success', content: `${candidateName} 正在入库...` } }
      });

    } else {
      // ❌ 淘汰
      c.executionCtx.waitUntil((async () => {
        try {
          await commitScreeningDecisionAtomically(c.env.DB, {
            queueId: recordId,
            resumeId: record.resume_id,
            decision: 'discard',
            timestamp: claimToken,
          });
        } catch (e: any) {
          console.error(`[CardCallback] D1 淘汰决策失败: ${e.message}`);
          await releaseScreeningQueueClaim(c.env.DB, recordId, claimToken);
          return;
        }

        try {
          if (record.feishu_card_msg_id) {
            await updateFeishuCard(c.env, record.feishu_card_msg_id, 'rejected', candidateName);
          }
        } catch (e: any) {
          console.error(`[CardCallback] 淘汰决策已提交，卡片同步失败: ${e.message}`);
        }
      })());

      return c.json({
        code: 0, msg: 'success',
        data: { toast: { type: 'success', content: `${candidateName} 已淘汰` } }
      });
    }
  } catch (err: any) {
    console.error(`[CardCallback] 错误: ${err.message}`);
    return c.json({ code: 0, msg: 'success', data: { toast: { type: 'error', content: '服务器错误' } } });
  }
});

// ==================== 事件回调 Endpoint ====================

/**
 * 飞书事件回调（URL 验证 + 群消息/菜单事件）
 * POST /api/feishu/event-callback
 */
app.post('/api/feishu/event-callback', async (c) => {
  try {
    const body: any = await c.req.json();
    if (body.type === 'url_verification') {
      return c.json({ challenge: body.challenge });
    }

    const header = body.header;
    const eventType = header?.event_type;
    const event = body.event || {};

    if (eventType === 'im.message.receive_v1') {
      const message = event.message || {};
      const sender = event.sender || {};
      const chatType = message.chat_type;
      const msgType = message.msg_type;
      const msgId = message.message_id;
      const chatId = message.chat_id;
      const textContent = message.content ? (() => {
        try { return JSON.parse(message.content); } catch { return { text: message.content }; }
      })() : {};

      const replyText = async (text: string) => {
        try {
          const token = await getFeishuToken(c.env);
          await fetch(`https://open.feishu.cn/open-apis/im/v1/messages/${msgId}/reply`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: JSON.stringify({ text }), msg_type: 'text' })
          });
        } catch {}
      };

      if (chatType === 'group' && msgType === 'text') {
        const msgText = textContent.text || '';

        // 解析群内面试评价: "评价张三 沟通4 专业3"
        const evalMatch = msgText.match(/评价(.+?)\s*(?:沟通|协调|专业|技术|管理|团队|表达|学习)(?:能力)?(\d+)/);
        if (evalMatch) {
          const name = evalMatch[1].trim();
          const score = parseInt(evalMatch[2]);
          await c.env.DB.prepare(
            `INSERT INTO department_reviews (id, candidate_name, reviewer_id, reviewer_name, score, comment, is_completed, created_at)
             VALUES (?,?,?,?,?,?,?,?)`
          ).bind(uuid(), name, sender.sender_id?.open_id || 'unknown', sender.sender_id?.open_id || 'unknown', score, msgText, 1, now()).run();
          await replyText(`✅ 已记录对 ${name} 的评价`);
        }

        // 统计指令
        if (msgText.includes('统计') || msgText.includes('进度')) {
          const total = await c.env.DB.prepare("SELECT COUNT(*) as c FROM talent_pool").first() as any;
          const pending = await c.env.DB.prepare("SELECT COUNT(*) as c FROM resume_screening_queue WHERE status='pending'").first() as any;
          const approved = await c.env.DB.prepare("SELECT COUNT(*) as c FROM resume_screening_queue WHERE status='approved'").first() as any;
          await replyText(
            `📊 招聘统计\n人才库: ${total?.c || 0} 人\n待审核: ${pending?.c || 0} 人\n今日入库: ${approved?.c || 0} 人`
          );
        }

        // 帮助
        if (msgText.includes('帮助') || msgText.includes('help') || msgText.includes('功能')) {
          await replyText(
            `🤖 招聘助手可用功能：\n` +
            `• 评价[姓名] [能力][分数] — 面试评价\n` +
            `• 统计/进度 — 查看招聘数据\n` +
            `• 帮助/help — 显示此帮助`
          );
        }
      } else if (chatType === 'p2p' && msgType === 'text') {
        const msgText = textContent.text || '';
        if (msgText.includes('统计') || msgText.includes('进度')) {
          const total = await c.env.DB.prepare("SELECT COUNT(*) as c FROM talent_pool").first() as any;
          const pending = await c.env.DB.prepare("SELECT COUNT(*) as c FROM resume_screening_queue WHERE status='pending'").first() as any;
          await replyText(`📊 招聘统计\n人才库: ${total?.c || 0} 人\n待审核: ${pending?.c || 0} 人`);
        } else {
          await replyText(`🤖 你好！我是招聘助手。\n在群中 @我 可进行面试评价或查看统计数据。`);
        }
      }
      return c.json({ code: 0, msg: 'success' });
    }

    if (eventType === 'im.menu.action') {
      const menuValue = event?.action?.value;
      const chatId = event?.chat_id;
      const openId = event?.operator?.operator_id?.open_id;
      console.log(`[Bot] 菜单点击: ${menuValue}`);

      // 回复菜单操作结果
      if (menuValue && chatId) {
        const reply = async (text: string) => {
          try {
            const token = await getFeishuToken(c.env);
            const cardContent = {
              config: { wide_screen_mode: true },
              header: { title: { tag: 'plain_text', content: '🤖 招聘助手' }, template: 'blue' },
              elements: [{ tag: 'div', text: { tag: 'lark_md', content: text } }]
            };
            await sendFeishuMessageToChat(token, chatId, cardContent);
          } catch {}
        };

        switch (menuValue) {
          case 'pending_list':
            const pending = await c.env.DB.prepare("SELECT candidate_name, position_applied FROM resume_screening_queue WHERE status='pending' LIMIT 10").all() as any;
            const names = (pending.results || []).map((r: any) => `• ${r.candidate_name} - ${r.position_applied || '未知'}`).join('\n') || '暂无';
            await reply(`📋 **待审核列表**\n${names}`);
            break;
          case 'stats_progress':
            const total = await c.env.DB.prepare("SELECT COUNT(*) as c FROM talent_pool").first() as any;
            const pend = await c.env.DB.prepare("SELECT COUNT(*) as c FROM resume_screening_queue WHERE status='pending'").first() as any;
            const appr = await c.env.DB.prepare("SELECT COUNT(*) as c FROM resume_screening_queue WHERE status='approved'").first() as any;
            await reply(`📊 **招聘进度**\n人才库: ${total?.c || 0} 人\n待审核: ${pend?.c || 0} 人\n已入库: ${appr?.c || 0} 人`);
            break;
          case 'help':
            await reply(`🤖 **招聘助手功能**\n• 评价[姓名] [能力][分数]\n• 统计查看数据\n• @我使用`);
            break;
          default:
            await reply(`收到指令: ${menuValue}`);
        }
      }
      return c.json({ code: 0, msg: 'success' });
    }

    return c.json({ code: 0, msg: 'success' });
  } catch {
    return c.json({ code: 0, msg: 'success' });
  }
});

// ==================== 操作日志查询 ====================

/**
 * 查询操作日志（核心链路埋点数据）
 * GET /api/operation-logs?action=&limit=
 */
app.get('/api/operation-logs', authMiddleware, requireRole(['admin']), async (c) => {
  try {
    const action = c.req.query('action') || '';
    const limit = Math.min(parseInt(c.req.query('limit') || '100', 10) || 100, 500);
    let stmt;
    if (action) {
      stmt = c.env.DB.prepare('SELECT * FROM operation_logs WHERE action = ? ORDER BY id DESC LIMIT ?').bind(action, limit);
    } else {
      stmt = c.env.DB.prepare('SELECT * FROM operation_logs ORDER BY id DESC LIMIT ?').bind(limit);
    }
    const rows = await stmt.all();
    return c.json(rows.results || []);
  } catch (e: any) {
    return c.json({ detail: e.message }, 500);
  }
});

// ==================== Cron 定时任务 Endpoints ====================

/**
 * Cron 路由鉴权中间件：校验 X-Cron-Secret header（外部定时服务需携带）
 * 密钥通过 wrangler pages secret put CRON_SECRET 配置
 */
app.use('/api/cron/*', async (c, next) => {
  const secret = (c.env as any).CRON_SECRET;
  if (!secret) {
    console.error('[cron-auth] CRON_SECRET 未配置，拒绝所有 cron 请求');
    return c.json({ detail: 'cron not configured' }, 503);
  }
  const provided = c.req.header('X-Cron-Secret') || '';
  if (provided !== secret) {
    console.warn('[cron-auth] cron 请求鉴权失败');
    return c.json({ detail: 'unauthorized' }, 401);
  }
  await next();
});

/**
 * 日报生成与推送
 * POST /api/cron/daily-report
 * （可由 wrangler cron 或外部定时服务触发）
 */
app.post('/api/cron/daily-report', async (c) => {
  try {
    const report = await runDailyReportPipeline(
      c.env,
      new Date(),
      c.env.FEISHU_RECRUITMENT_GROUP_CHAT_ID || '',
      dailyReportGenerationDependencies(c.env),
      async (target, card) => {
        const token = await getFeishuToken(c.env);
        await sendFeishuMessageToChat(token, target.id, card);
      },
    );

    return c.json({
      ok: true,
      data: {
        id: report.id,
        date: report.snapshot.reportDate,
        new: report.snapshot.totals.todayNew,
        approved: report.snapshot.totals.todayApproved,
        rejected: report.snapshot.totals.todayRejected,
        pending: report.snapshot.totals.pending,
        totalResumes: report.snapshot.totals.allTimeResumes,
      }
    });
  } catch (err: any) {
    if (err instanceof DailyReportTargetMissingError) {
      return c.json({ ok: false, detail: '未配置日报招聘群 FEISHU_RECRUITMENT_GROUP_CHAT_ID' }, 503);
    }
    if (err instanceof DailyReportDeliveryError) {
      return c.json({ ok: false, report_id: err.reportId, detail: `日报已生成但推送失败: ${err.message}` }, 502);
    }
    return c.json({ ok: false, detail: `生成日报失败: ${err.message}` }, 500);
  }
});

/**
 * 面试提醒
 * POST /api/cron/interview-reminder
 */
app.post('/api/cron/interview-reminder', async (c) => {
  try {
    const pending = await c.env.DB.prepare(
      "SELECT COUNT(*) as c FROM resumes WHERE screening_result = '通过' AND status = 'pending_screening'"
    ).first() as any;
    const count = pending?.c || 0;

    if (count > 0) {
      // 查询候选人明细
      const candidateRows = await c.env.DB.prepare(
        "SELECT r.id, r.candidate_name, r.mapped_position, r.position_applied, r.gender, r.education, r.birthday, r.ai_evaluation, r.parsed_data FROM resumes r WHERE r.screening_result = '通过' AND r.status = 'pending_screening' ORDER BY r.updated_at DESC LIMIT 20"
      ).all();
      const candidates = (candidateRows.results || []).map((r: any) => {
        let parsed: any = {}, evaluation: any = {};
        try { parsed = typeof r.parsed_data === 'string' ? JSON.parse(r.parsed_data) : (r.parsed_data || {}); } catch {}
        try { evaluation = typeof r.ai_evaluation === 'string' ? JSON.parse(r.ai_evaluation) : (r.ai_evaluation || {}); } catch {}
        let age: number | null = null;
        if (parsed.age) age = parseInt(parsed.age) || null;
        else if (r.birthday) { try { const b = new Date(r.birthday); age = Math.floor((Date.now() - b.getTime()) / (365.25 * 24 * 3600 * 1000)); } catch {} }
        return {
          name: r.candidate_name || '',
          education: parsed.highest_degree || r.education || '',
          age,
          gender: parsed.gender || r.gender || '',
          position: r.mapped_position || r.position_applied || '',
          city: parsed.city || '',
          ai_summary: evaluation.summary || '',
        };
      });
      const token = await getFeishuToken(c.env);
      const card = buildReminderCard(count, candidates);
      const chatId = FEISHU_CONFIG.recruitmentGroupChatId;
      if (chatId) {
        await sendFeishuMessageToChat(token, chatId, card);
        console.log(`[cron:interview-reminder] 已发群提醒，pending=${count}`);
      } else if (FEISHU_CONFIG.defaultHrOpenId) {
        await sendFeishuMessageToUser(token, FEISHU_CONFIG.defaultHrOpenId, card);
        console.log(`[cron:interview-reminder] 已发默认HR提醒，pending=${count}`);
      } else {
        console.log(`[cron:interview-reminder] pending=${count} 但无群和默认HR配置，跳过`);
      }
    } else {
      console.log('[cron:interview-reminder] 无待审核，跳过');
    }

    // 埋点：定时面试提醒
    await logOperation(c.env, {
      action: 'cron.interview_reminder',
      actor: 'cron',
      detail: JSON.stringify({ pending: count }),
    });

    return c.json({ ok: true, pending: count });
  } catch (err: any) {
    await logOperation(c.env, {
      action: 'cron.interview_reminder',
      actor: 'cron',
      status: 'failure',
      detail: err.message,
    });
    return c.json({ ok: false, detail: `发送提醒失败: ${err.message}` }, 500);
  }
});

/**
 * 飞书用户 token 批量刷新
 * POST /api/cron/refresh-feishu-tokens
 * 每 12 小时遍历已绑定飞书的用户，自动刷新 user_access_token，防止 refresh_token 过期
 */
app.post('/api/cron/refresh-feishu-tokens', async (c) => {
  try {
    const users = await c.env.DB.prepare(
      "SELECT email, feishu_refresh_token, feishu_token_expires_at FROM users WHERE feishu_refresh_token IS NOT NULL AND feishu_refresh_token != ''"
    ).all();
    let refreshed = 0, failed = 0, skipped = 0;

    for (const u of users.results || []) {
      const user = u as any;
      // 只在 token 剩余有效期 < 12 小时时刷新（避免频繁刷新）
      const expiresAt = user.feishu_token_expires_at || 0;
      if (expiresAt > 0 && Date.now() < expiresAt - 12 * 3600 * 1000) {
        skipped++;
        continue;
      }

      try {
        const result = await refreshUserAccessToken(c.env, user.email);
        if (result) refreshed++;
        else failed++;
      } catch {
        failed++;
      }
    }

    await logOperation(c.env, {
      action: 'cron.refresh_feishu_tokens',
      actor: 'cron',
      detail: JSON.stringify({ refreshed, failed, skipped, total: users.results?.length }),
    });

    return c.json({ ok: true, refreshed, failed, skipped, total: users.results?.length });
  } catch (err: any) {
    return c.json({ ok: false, detail: err.message }, 500);
  }
});

/**
 * 构建面试官通知卡片 — 提醒面试官审阅新候选人
 */
function buildInterviewerCard(name: string, position: string, city: string, analysis: string, operatorName?: string, interviewTime?: string): any {
  const summary = (analysis || '').substring(0, 500);
  let infoBlock = `**候选人：** ${name}\n**岗位：** ${position}\n**城市：** ${city || '未知'}`;
  if (interviewTime) {
    infoBlock += `\n**面试时间：** ${interviewTime}`;
  }
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: `🆕 新候选人待审阅: ${name}` },
      template: 'blue'
    },
    elements: [
      {
        tag: 'div',
        text: { tag: 'lark_md', content: infoBlock }
      },
      { tag: 'hr' },
      {
        tag: 'div',
        text: { tag: 'lark_md', content: summary || '（无 AI 分析内容）' }
      },
      { tag: 'hr' },
      {
        tag: 'note',
        elements: [{ tag: 'plain_text', content: `${operatorName || '系统'} 推荐 | AI 智能面试系统` }]
      }
    ]
  };
}

/** 发送消息到飞书群 */
// ==================== 飞书常用联系人 ====================

app.get('/api/feishu/contacts', authMiddleware, async (c) => {
  try {
    const token = await getFeishuToken(c.env);
    const result: any = { groups: [], users: [] };

    // 1. 拉取飞书群聊列表（最多 30 个）
    try {
      const chatsResp = await fetch('https://open.feishu.cn/open-apis/im/v1/chats?page_size=30', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const chatsData: any = await chatsResp.json();
      if (chatsData.code === 0 && chatsData.data?.items) {
        result.groups = chatsData.data.items.map((g: any) => ({
          id: g.chat_id,
          name: g.name || '(未命名群聊)',
          avatar: g.avatar || '',
        }));
      }
    } catch {}

    // 2. 从 users 表拉取配置了 feishu_open_id 的用户（面试官/HR）
    try {
      const users = await c.env.DB.prepare(
        "SELECT full_name, feishu_open_id, role FROM users WHERE feishu_open_id IS NOT NULL AND feishu_open_id != ''"
      ).all() as any;
      if (users.results) {
        result.users = users.results.map((u: any) => ({
          id: u.feishu_open_id,
          name: u.full_name,
          role: u.role,
        }));
      }
    } catch {}

    // 2.5 从 interviewer_mappings 表补全面试官（招聘任务表中的面试官，未登录过系统）
    try {
      const mappings = await c.env.DB.prepare(
        "SELECT name, open_id FROM interviewer_mappings WHERE open_id IS NOT NULL AND open_id != ''"
      ).all() as any;
      if (mappings.results) {
        for (const m of mappings.results) {
          if (!result.users.some((u: any) => u.id === m.open_id)) {
            result.users.push({ id: m.open_id, name: m.name, role: 'interviewer' });
          }
        }
      }
    } catch {}

    // 3. 加兜底 HR
    const hrId = FEISHU_CONFIG.defaultHrOpenId || '';
    if (hrId && !result.users.some((u: any) => u.id === hrId)) {
      result.users.push({ id: hrId, name: '默认HR', role: 'hr' });
    }

    return c.json({ ok: true, ...result });
  } catch (e: any) {
    return c.json({ ok: false, detail: e.message }, 500);
  }
});

async function sendFeishuMessageToChat(token: string, chatId: string, cardContent: any): Promise<any> {
  const resp = await fetch('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      receive_id: chatId,
      msg_type: 'interactive',
      content: JSON.stringify(cardContent)
    })
  });
  const data: any = await resp.json();
  if (data.code !== 0) throw new Error(`发送群消息失败: ${JSON.stringify(data)}`);
  return data.data;
}

/** 发送消息给指定用户（通过 open_id） */
export async function sendFeishuMessageToUser(token: string, openId: string, cardContent: any): Promise<any> {
  const resp = await fetch('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      receive_id: openId,
      msg_type: 'interactive',
      content: JSON.stringify(cardContent)
    })
  });
  const data: any = await resp.json();
  if (data.code !== 0) {
    const err = new Error(`发送用户消息失败: ${JSON.stringify(data)}`) as any;
    err.feishuCode = data.code;
    err.feishuMsg = data.msg;
    throw err;
  }
  return data.data;
}

/**
 * 三层 fallback 发送消息：
 * 1. 当前登录用户的 user_access_token（以用户身份发，自动刷新过期 token）
 * 2. DB 中任意已绑定飞书用户的 token（兜底用户身份）
 * 3. bot tenant_access_token（以应用身份发）
 */
async function sendFeishuMessageWithFallback(
  env: Env,
  userEmail: string | undefined,
  openId: string,
  cardContent: any
): Promise<{ usedUserToken: boolean; sender: string }> {
  // 第 1 层：当前用户 token（自动刷新）
  if (userEmail) {
    const userToken = await getValidUserAccessToken(env, userEmail);
    if (userToken) {
      try {
        await sendFeishuMessageToUser(userToken, openId, cardContent);
        console.log(`[sendFeishuMsg] 以用户 ${userEmail} 身份发送成功`);
        return { usedUserToken: true, sender: userEmail };
      } catch (e: any) {
        // 99991677 = token 过期，尝试刷新后重试；其他错误直接降级
        if (e.feishuCode === 99991677) {
          console.log(`[sendFeishuMsg] 用户token过期(99991677)，刷新后重试`);
          const refreshed = await refreshUserAccessToken(env, userEmail);
          if (refreshed) {
            try {
              await sendFeishuMessageToUser(refreshed.access_token, openId, cardContent);
              console.log(`[sendFeishuMsg] 刷新后以用户 ${userEmail} 身份发送成功`);
              return { usedUserToken: true, sender: userEmail };
            } catch (e2: any) {
              console.log(`[sendFeishuMsg] 刷新后仍失败(${e2.feishuCode || e2.message})，降级`);
            }
          }
        } else if (e.feishuCode === 230013) {
          console.warn(`[sendFeishuMsg] 用户token无权限(230013)，可能未授权 im:message.send_as_user，降级`);
        } else {
          console.log(`[sendFeishuMsg] 用户token失败(${e.feishuCode || e.message})，降级`);
        }
      }
    }
  }

  // 第 2 层：DB 中任意已绑定用户的 token（兜底用户身份）
  try {
    const anyUser = await env.DB.prepare(
      "SELECT email FROM users WHERE feishu_token IS NOT NULL AND feishu_token != '' AND email != ? LIMIT 1"
    ).bind(userEmail || '').first() as any;
    if (anyUser?.email) {
      const fallbackToken = await getValidUserAccessToken(env, anyUser.email);
      if (fallbackToken) {
        try {
          await sendFeishuMessageToUser(fallbackToken, openId, cardContent);
          console.log(`[sendFeishuMsg] 以兜底用户 ${anyUser.email} 身份发送成功`);
          return { usedUserToken: true, sender: anyUser.email };
        } catch (e: any) {
          console.log(`[sendFeishuMsg] 兜底用户token失败(${e.feishuCode || e.message})，降级bot`);
        }
      }
    }
  } catch {}

  // 第 3 层：bot token
  try {
    const botToken = await getFeishuToken(env);
    await sendFeishuMessageToUser(botToken, openId, cardContent);
    console.log(`[sendFeishuMsg] 以 bot 身份发送成功`);
    return { usedUserToken: false, sender: 'bot' };
  } catch (botErr: any) {
    console.error(`[sendFeishuMsg] bot 也发送失败: ${botErr.feishuCode || botErr.message}`);
    throw new Error(`所有发送方式均失败 (bot: ${botErr.message || '发送失败'})`);
  }
}

/** 通知候选人对应的面试官 */

/**
 * 获取简历原文（多维尝试）
 * 1. resume_markdown
 * 2. raw_text
 * 3. 从 resume_files 表取 PDF base64 → 用 AI 提取文本
 * 4. 兜底：仅返回基本信息汇总
 */
async function getResumeText(env: Env, candidateName: string): Promise<string> {
  try {
    const d1Row = await env.DB.prepare(
      'SELECT resume_markdown, raw_text, id FROM resumes WHERE candidate_name = ? LIMIT 1'
    ).bind(candidateName).first() as any;
    if (d1Row?.resume_markdown) return d1Row.resume_markdown;
    if (d1Row?.raw_text) return d1Row.raw_text;
    if (d1Row?.id) {
      const file = await getResumeFileBytes(env, d1Row.id);
      if (file.bytes) {
        const base64Content = bufToB64(file.bytes.buffer.slice(file.bytes.byteOffset, file.bytes.byteOffset + file.bytes.byteLength) as ArrayBuffer);
        try {
          const extraction = await callAI(env,
            'You are a PDF text extractor. Extract ALL readable text from this base64 PDF content. Return ONLY the extracted text, no explanations.',
            'Extract resume text from this base64 PDF (' + (file.fileName || 'resume.pdf') + '):\n\n' + base64Content);
          if (extraction && extraction.length > 50) {
            try {
              await env.DB.prepare('UPDATE resumes SET raw_text = ? WHERE id = ?')
                .bind(extraction, d1Row.id).run();
            } catch {}
            return extraction;
          }
        } catch {}
      }
    }
    try {
      const tableId = getBitableTableId(env, 'talent');
      const records = await bitableListRecords(env, tableId);
      const rec = records.find((r: any) => {
        const f = r.fields || {};
        return getFirstValue(f['姓名']) === candidateName;
      });
      if (rec) {
        const f = rec.fields || {};
        const parts: string[] = [];
        if (getFirstValue(f['姓名'])) parts.push('姓名: ' + getFirstValue(f['姓名']));
        if (getFirstValue(f['性别'])) parts.push('性别: ' + getFirstValue(f['性别']));
        if (f['年龄']) parts.push('年龄: ' + f['年龄']);
        if (getFirstValue(f['学历'])) parts.push('学历: ' + getFirstValue(f['学历']));
        if (getFirstValue(f['学校'])) parts.push('学校: ' + getFirstValue(f['学校']));
        if (getFirstValue(f['专业'])) parts.push('专业: ' + getFirstValue(f['专业']));
        if (getFirstValue(f['优势分析'])) parts.push('\n优势分析:\n' + getFirstValue(f['优势分析']));
        if (getFirstValue(f['风险点'])) parts.push('\n风险点:\n' + getFirstValue(f['风险点']));
        if (parts.length > 0) return parts.join('\n');
      }
    } catch {}
  } catch {}
  return candidateName + ' - 无法获取简历原文';
}

// ==================== 定时提醒卡片（cron 触发）====================

/** 构建定时批量提醒卡片，发给默认HR或招聘群 */
function buildReminderCard(pendingCount: number): any {
  const ts = new Date().toLocaleString('zh-CN');
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: `⏰ 面试提醒` },
      template: 'orange',
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `当前还有 **${pendingCount}** 位候选人待审核处理，请及时安排面试。`,
        },
      },
      { tag: 'note', elements: [{ tag: 'plain_text', content: `系统自动提醒 | ${ts}` }] },
    ],
  };
}

// ==================== 从飞书多维表格同步招聘任务 ====================

/**
 * 从飞书多维表格(招聘任务表 requisitionTableId)同步到 D1 recruitment_tasks 表
 * 提取字段：招聘岗位、招聘状态、招聘城市、责任人、业务一面、HR二面、终面
 * 面试官 = [业务一面, HR二面, 终面] 去重后的姓名数组
 * 注意：只提取姓名。open_id 不从飞书表取（那是多维表格应用的 open_id，不能跨应用发消息），
 *       改由 batchSyncFeishuOpenIds 通过通讯录API单独同步。
 */
async function syncRecruitmentTasksFromFeishu(env: Env): Promise<{ synced: number; details: string[] }> {
  const tableId = getBitableTableId(env, 'requisition');
  const records = await bitableListRecords(env, tableId);
  const ts = now();
  let synced = 0;
  const details: string[] = [];

  for (const rec of records) {
    const f = rec.fields || {};
    const positionName = getFirstValue(f['招聘岗位']) || '';
    if (!positionName) continue;

    const status = getFirstValue(f['招聘状态']) || '';
    const city = getFirstValue(f['招聘城市']) || '';
    const responsiblePerson = getUserName(f['责任人']) || '';

    // 收集面试官姓名（业务一面 + HR二面 + 终面）
    const ivNames: string[] = [];
    for (const field of ['业务一面', 'HR二面', '终面']) {
      const raw = f[field];
      const users = extractFeishuUsers(raw);
      if (users.length > 0) {
        for (const u of users) {
          if (u.name && !ivNames.includes(u.name)) ivNames.push(u.name);
        }
      } else {
        const n = getUserName(raw);
        if (n && !ivNames.includes(n)) ivNames.push(n);
      }
    }

    const id = `req_${rec.record_id}`;
    const interviewersJson = JSON.stringify(ivNames);

    await env.DB.prepare(
      `INSERT INTO recruitment_tasks (id, position_name, status, responsible_person, interviewers, city, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         position_name = excluded.position_name,
         status = excluded.status,
         responsible_person = excluded.responsible_person,
         interviewers = excluded.interviewers,
         city = excluded.city,
         updated_at = excluded.updated_at`
    ).bind(id, positionName, status, responsiblePerson, interviewersJson, city, ts).run();
    synced++;
    details.push(`${positionName} | 面试官: ${ivNames.join('、') || '无'} | 责任人: ${responsiblePerson || '无'} | ${city || '-'}`);
  }
  return { synced, details };
}

/**
 * 同步招聘任务（从飞书多维表格）
 * POST /api/recruitment-tasks/sync-from-feishu
 */
app.post('/api/recruitment-tasks/sync-from-feishu', authMiddleware, requireRole(['admin']), async (c) => {
  try {
    const result = await syncRecruitmentTasksFromFeishu(c.env);
    // 埋点：飞书招聘任务同步
    await logOperation(c.env, {
      action: 'feishu.sync',
      entityType: 'recruitment_task',
      actor: c.get('user')?.email,
      detail: JSON.stringify({ synced: result.synced }),
    });
    return c.json({ ok: true, synced: result.synced, details: result.details });
  } catch (e: any) {
    return c.json({ detail: '同步失败: ' + e.message }, 500);
  }
});

async function notifyInterviewersForCandidate(env: Env, record: any, currentUser?: any): Promise<void> {
  const operatorName = currentUser?.full_name;
  const posName = record.mapped_position || record.position_applied?.split('_')[0] || '未知岗位';
  try {
    // 查找匹配的招聘任务
    const tasks = await env.DB.prepare(
      "SELECT * FROM recruitment_tasks WHERE position_name LIKE ? LIMIT 5"
    ).bind(`%${posName}%`).all() as any;
    const taskList = (tasks.results || []);

    if (taskList.length === 0) {
      console.log(`[NotifyInterviewers] 未找到 ${posName} 的招聘任务，通知默认 HR`);
      // 兜底：通知默认 HR
      const defaultOpenId = FEISHU_CONFIG.defaultHrOpenId;
      if (defaultOpenId) {
        const cardContent = buildInterviewerCard(record.candidate_name, posName, record.city, record.ai_analysis, operatorName);
        await sendFeishuMessageWithFallback(env, currentUser?.email, defaultOpenId, cardContent);
        console.log(`[NotifyInterviewers] ✅ 已通知默认 HR (${defaultOpenId})`);
      }
      return;
    }

    // 收集需要通知的面试官
    const notifiedNames = new Set<string>();

    for (const task of taskList) {
      // 提取面试官列表
      let interviewers: string[] = [];
      try {
        if (typeof task.interviewers === 'string') {
          interviewers = JSON.parse(task.interviewers);
        } else if (Array.isArray(task.interviewers)) {
          interviewers = task.interviewers;
        }
      } catch {}

      // 加上责任人
      if (task.responsible_person && !interviewers.includes(task.responsible_person)) {
        interviewers.push(task.responsible_person);
      }

      for (const name of interviewers) {
        if (notifiedNames.has(name) || !name) continue;
        notifiedNames.add(name);

        // 🔑 只使用 DB 中 OAuth 绑定的 feishu_open_id（和 cli_aad2cb7fab385cb6 同应用）
        // 硬编码的 interviewerOpenIds 来自多维表格人员字段，属于不同应用，会导致 open_id cross app 错误
        let openId = '';
        try {
          const userRow = await env.DB.prepare(
            'SELECT feishu_open_id FROM users WHERE full_name = ? AND feishu_open_id IS NOT NULL AND feishu_open_id != \'\' LIMIT 1'
          ).bind(name).first() as any;
          if (userRow?.feishu_open_id) {
            openId = userRow.feishu_open_id;
            console.log(`[NotifyInterviewers] 使用 DB 中 ${name} 的 feishu_open_id`);
          }
        } catch {}

        if (!openId) {
          // 面试官未绑定飞书 → 跳过，不兜底硬编码（那些 open_id 是其他应用的）
          console.warn(`[NotifyInterviewers] ⚠ ${name} 未在系统中绑定飞书，跳过了飞书通知。请让该面试官在设置页面绑定飞书身份。`);
          continue;
        }

        // 三层 fallback 发送（当前用户token → DB任意用户token → bot）
        const cardContent = buildInterviewerCard(record.candidate_name, posName, record.city, record.ai_analysis, operatorName);
        await sendFeishuMessageWithFallback(env, currentUser?.email, openId, cardContent);
        console.log(`[NotifyInterviewers] ✅ 已通知面试官处理记录 ${record.id || ''}`);
      }
    }
  } catch (e: any) {
    console.error(`[NotifyInterviewers] 通知失败: ${e.message}`);
  }
}

// ==================== 通知面试官 Endpoint ====================

/**
 * 提醒面试官：查找招聘任务中的对应面试官并发送通知
 * POST /api/resume-screening/:id/notify-interviewers
 * 请求体可选：{ candidate_name, position_applied, mapped_position, city }
 *   - 如果传了这些字段，优先使用它们（从人才库/面试管理页调用的场景）
 *   - 否则从 resume_screening_queue 表按 ID 查找
 */
app.post('/api/resume-screening/:id/notify-interviewers', authMiddleware, async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const currentUser = c.get('user');

  // 优先用请求体传入的候选人信息（面试管理页数据来自人才库，不在 resume_screening_queue 表）
  let record: any;
  if (body.candidate_name) {
    record = {
      candidate_name: body.candidate_name,
      position_applied: body.position_applied || '',
      mapped_position: body.mapped_position || body.position_applied || '',
      city: body.city || '',
    };
  } else {
    // 从 resume_screening_queue 表查找（简历初筛页调用）
    record = await c.env.DB.prepare('SELECT * FROM resume_screening_queue WHERE id = ?').bind(id).first() as any;
  }

  if (!record) return c.json({ detail: '记录不存在' }, 404);

  try {
    await notifyInterviewersForCandidate(c.env, record, currentUser);
    return c.json({ ok: true, message: `已通知对应面试官: ${record.candidate_name}` });
  } catch (err: any) {
    return c.json({ detail: `通知失败: ${err.message}` }, 500);
  }
});

// ==================== 从飞书面试候选人表同步面试记录 ====================
app.post('/api/interviews/sync-from-feishu', authMiddleware, async (c) => {
  try {
    const tableId = getBitableTableId(c.env, 'interview');
    console.log('[SyncInterviews] 开始同步，tableId:', tableId);
    const records = await bitableListRecords(c.env, tableId);
    console.log('[SyncInterviews] 获取到记录数:', records?.length || 0);
    let created = 0, updated = 0;
    const now = new Date().toISOString();

    // Debug: 打印第一条记录的所有字段名
    if (records.length > 0) {
      const firstF = records[0].fields || {};
      console.log('[SyncInterview] 一面负责人原始值:', JSON.stringify(firstF['一面负责人']));
      console.log('[SyncInterview] 二面负责人原始值:', JSON.stringify(firstF['二面负责人']));
    }

    for (const r of records) {
      const f = r.fields || {};
      const candidateName = getFirstValue(f['姓名']) || '';
      if (!candidateName) continue;

      const feishuId = r.record_id;
      const primaryRaw = f['一面负责人'];
      const secondaryRaw = f['二面负责人'];
      // 飞书人员字段可能是 [{name, id}] 格式
      const extractName = (val: any): string => {
        if (!val) return '';
        if (typeof val === 'string') return val;
        if (Array.isArray(val)) return val.map((u: any) => u.name || '').filter(Boolean).join(', ');
        return '';
      };
      const primaryIv = extractName(primaryRaw);
      const secondaryIv = extractName(secondaryRaw);
      const interviewerStr = [primaryIv, secondaryIv].filter(Boolean).join(', ') || '待分配';
      const status = getFirstValue(f['业务复核结果']) || 'scheduled';

      const existing = await c.env.DB.prepare(
        'SELECT id, status FROM interviews WHERE feishu_record_id = ? LIMIT 1'
      ).bind(feishuId).first() as any;

      const resumeRow = await c.env.DB.prepare(
        'SELECT id FROM resumes WHERE candidate_name = ? LIMIT 1'
      ).bind(candidateName).first() as any;
      const resumeId = resumeRow?.id || '';

      if (existing) {
        // 只更新面试官信息，不覆盖本地管理的状态/评价/结果
        await c.env.DB.prepare(
          `UPDATE interviews SET interviewer = ?, primary_interviewer = ?, secondary_interviewer = ?,
           resume_id = COALESCE(NULLIF(?, ''), resume_id),
           updated_at = ? WHERE feishu_record_id = ?`
        ).bind(interviewerStr, primaryIv, secondaryIv, resumeId, now, feishuId).run();
        updated++;
      } else {
        const id = crypto.randomUUID();
        await c.env.DB.prepare(
          `INSERT INTO interviews (id, feishu_record_id, resume_id, interviewer, primary_interviewer,
           secondary_interviewer, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'scheduled', ?)`
        ).bind(id, feishuId, resumeId, interviewerStr, primaryIv, secondaryIv, now).run();
        created++;
      }
    }
    return c.json({ ok: true, created, updated, total: records.length });
  } catch (e: any) {
    console.error('[SyncInterviews] 同步失败:', e.message, e.stack);
    return c.json({ detail: '同步失败: ' + (e.message || '未知错误'), code: e.code || 500 }, 500);
  }
});

/**
 * 面试管理 - 提醒面试官
 * POST /api/interviews/:id/notify-interviewer
 * 候选人和面试数据只从 D1 权威记录读取；请求体仅可选择该记录已配置的面试官。
 * 请求体：{ interviewer_name? }
 */
app.post('/api/interviews/:id/notify-interviewer', authMiddleware, async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const currentUser = c.get('user') as { email?: string; full_name?: string };

  try {
    const source = await loadInterviewReminderSource(c.env.DB, id);
    if (!source) return c.json({ detail: '未找到该面试记录。' }, 404);

    const interviewerName = resolveReminderInterviewer(source.interview, body.interviewer_name);
    if (!interviewerName) {
      return c.json({
        detail: '面试记录未配置可用的面试官，请先更新面试安排。',
        need_bind: true,
      }, 400);
    }

    const openId = await resolveExactInterviewerOpenId(c.env.DB, interviewerName);
    if (!openId) {
      return c.json({
        detail: `无法通知「${interviewerName}」：未在面试官映射表或用户表中找到该面试官的飞书 open_id。请在系统设置 → 面试官管理中配置映射。`,
        need_bind: true,
      }, 400);
    }

    const userToken = currentUser?.email
      ? await getValidUserAccessToken(c.env, currentUser.email)
      : null;
    if (!userToken) {
      return c.json({
        detail: '请先在个人设置中授权当前账号的飞书身份。',
        need_feishu_auth: true,
      }, 400);
    }

    const resumeId = typeof source.resume?.id === 'string' ? source.resume.id : '';

    // 生成面试管理卡片链接（面试管理唯一链接，汇总候选人档案 + 各轮面试情况），失败不阻塞提醒主流程
    let cardLinkUrl: string | null = null;
    try {
      const cardLink = await createOrReuseInterviewCardLink(c.env.DB, {
        resumeId,
        candidateName: typeof source.interview?.candidate_name === 'string' ? source.interview.candidate_name : undefined,
        positionApplied: typeof source.interview?.position_applied === 'string'
          ? source.interview.position_applied
          : (typeof source.resume?.position_applied === 'string' ? source.resume.position_applied : undefined),
        createdBy: currentUser?.full_name || currentUser?.email || '',
      }, { now, uuid, hashPublicToken });
      cardLinkUrl = `https://ai-interview-88r.pages.dev${cardLink.url}`;
    } catch (cardError: any) {
      console.error(`[InterviewNotify] 面试卡片链接生成失败（不影响提醒）: ${cardError?.message || cardError}`);
    }

    // 只发链接：文本消息（候选人/岗位/面试时间 + 面试卡片链接），不发卡片、不附 PDF
    const view = buildInterviewReminderView(source);
    const lines = [
      `面试提醒：${view.name}`,
      `岗位：${view.position}`,
      `面试时间：${view.interviewTime}`,
    ];
    if (cardLinkUrl) lines.push(`面试卡片链接：${cardLinkUrl}`);
    await sendFeishuTextMessage(userToken, openId, lines.join('\n'));

    await logOperation(c.env, {
      action: 'interview.notify',
      entityType: 'interview',
      entityId: id,
      actor: currentUser?.email,
      detail: JSON.stringify({ sent_link: true, card_link: cardLinkUrl }),
    });

    if (source.interview.secondary_interviewer === interviewerName) {
      await c.env.DB.prepare("UPDATE interviews SET status2 = 'scheduled', updated_at = ? WHERE id = ?")
        .bind(now(), id).run();
    }

    return c.json({
      ok: true,
      card_sent: true,
      card_link: cardLinkUrl,
      sent_as: currentUser.email || '',
      warning: null,
    });
  } catch (err: any) {
    if (err?.code === 'AMBIGUOUS_RESUME') {
      return c.json({ detail: err.message, code: err.code }, 409);
    }
    if (err?.code === 'AMBIGUOUS_INTERVIEWER_BINDING') {
      return c.json({ detail: err.message, code: err.code, need_bind: true }, 409);
    }
    if (err?.code === 'FEISHU_AUTH_REQUIRED') {
      return c.json({
        detail: '当前账号的飞书授权已失效，请在个人设置中重新授权后重试。',
        code: err.code,
        need_feishu_auth: true,
        card_sent: Boolean(err.cardSent),
        file_sent: false,
      }, 400);
    }
    return c.json({ detail: `通知失败: ${err?.message || '未知错误'}` }, 500);
  }
});

// ==================== 飞书事件回调（仅用于 URL 验证）====================

// ==================== Root ====================

// Root path serves static index.html via ASSETS fallback
app.get('/api', (c) => c.json({ status: 'ok', service: 'ai-interview-api' }));

// ==================== 数据修复：从飞书同步负责人到岗位 ====================

/**
 * 从飞书招聘任务表同步 责任人 → positions 表
 * POST /api/auth/sync-responsible-persons
 */
app.post('/api/auth/sync-responsible-persons', authMiddleware, requireRole(['admin']), async (c) => {
  try {
    const tableId = getBitableTableId(c.env, 'requisition');
    const records = await bitableListRecords(c.env, tableId);
    const positionMappings = await buildPositionMapping(c.env.DB);

    // 按岗位名聚合责任人（取第一个有值的）
    const personMap: Record<string, string> = {};
    for (const rec of records) {
      const f = rec.fields || {};
      const title = resolveMappedPosition(positionMappings, getFirstValue(f['招聘岗位']) || '');
      if (!title) continue;
      const person = getUserName(f['责任人']) || '';
      if (person && !personMap[title]) {
        personMap[title] = person;
      }
    }

    // 更新 positions 表
    let updated = 0;
    for (const [title, person] of Object.entries(personMap)) {
      await c.env.DB.prepare('UPDATE positions SET responsible_person = ? WHERE title = ?')
        .bind(person, title).run();
      updated++;
    }

    return c.json({
      ok: true,
      positions_updated: updated,
      mappings_updated: 0,
      persons: Object.entries(personMap).map(([t, p]) => `${t} → ${p}`),
    });
  } catch (e: any) {
    return c.json({ detail: '同步失败: ' + e.message }, 500);
  }
});

/**
 * 修复 position_mappings 中 responsible_person 为 [object Object] 的问题
 * POST /api/auth/fix-responsible-persons
 */
app.post('/api/auth/fix-responsible-persons', authMiddleware, requireRole(['admin']), async (c) => {
  try {
    // 兼容旧页面：将映射表里的负责人字段修复为岗位管理的投影值，面试官字段不参与。
    const positions = await c.env.DB.prepare(
      'SELECT title, responsible_person FROM positions'
    ).all();
    const responsibleByTitle = new Map(
      (positions.results || []).map((row: any) => [row.title, row.responsible_person || '']),
    );
    const mappings = await c.env.DB.prepare(
      'SELECT id, mapped_name, responsible_person FROM position_mappings'
    ).all();
    let fixed = 0;
    for (const row of (mappings.results || []) as any[]) {
      const person = responsibleByTitle.get(row.mapped_name) || '';
      if (person && row.responsible_person !== person) {
        await c.env.DB.prepare('UPDATE position_mappings SET responsible_person = ? WHERE id = ?')
          .bind(person, row.id).run();
        fixed++;
      }
    }
    return c.json({ ok: true, fixed, persons: Array.from(responsibleByTitle.entries()).filter(([, person]) => person).map(([title, person]) => `${title} → ${person}`) });
  } catch (e: any) {
    return c.json({ detail: '修复失败: ' + e.message }, 500);
  }
});

// ==================== Static Asset Fallback (for Pages _worker.js mode) ====================


// ==================== 自动 AI 评估端点 ====================

app.post('/api/resumes/auto-evaluate', authMiddleware, async (c) => {
  try {
    const body = await c.req.json();
    const candidateName = body.candidate_name || '';
    const positionName = body.position || '';
    if (!candidateName) return c.json({ detail: '需要提供候选人姓名' }, 400);
    const resumeText = await getResumeText(c.env, candidateName);
    if (resumeText.length < 10) return c.json({ detail: '无法获取简历原文' }, 400);
    // 从 D1 获取岗位名（如果前端没传）
    let effectivePosition = positionName;
    if (!effectivePosition) {
      const row = await c.env.DB.prepare('SELECT position_applied, mapped_position FROM resumes WHERE candidate_name = ?').bind(candidateName).first() as any;
      effectivePosition = row?.position_applied || row?.mapped_position || '';
    }
    const positionReq = effectivePosition ? await getPositionRequirements(c.env, effectivePosition) : null;
    const evalResult = await callAIScreening(c.env, resumeText, positionReq);
    if (!evalResult) return c.json({ detail: 'AI评估失败' }, 500);
    // 写全字段
    const matchScore = evalResult.weighted_score ?? null;
    const screeningResult = evalResult.screening_result;
    const aiEvalObj = { summary: evalResult.summary || '', match_score: matchScore, weighted_score: evalResult.weighted_score, screening_result: screeningResult, screening_reason: evalResult.screening_reason, gate_results: evalResult.gate_results, configured_dimensions: evalResult.configured_dimensions || [], recommendation: evalResult.recommendation || '', dimensions: evalResult.dimensions || [], advantage: evalResult.advantage || '', risk: evalResult.risk || '', personalized_match_score: evalResult.personalized_match_score, personalized_met_items: evalResult.personalized_met_items, personalized_unmet_items: evalResult.personalized_unmet_items };
    const toArray = (v: any): string[] => { if (Array.isArray(v)) return v; if (typeof v === 'string' && v.trim()) return v.split(/\n|(?=\d+\.)/).map((s: string) => s.trim()).filter(Boolean); return []; };
    const aiReview = JSON.stringify({ summary: evalResult.summary || '', match_score: matchScore, weighted_score: evalResult.weighted_score, screening_result: screeningResult, screening_reason: evalResult.screening_reason, gate_results: evalResult.gate_results, recommendation: evalResult.recommendation || '', strengths: toArray(evalResult.advantage), risks: toArray(evalResult.risk), suggested_questions: toArray(evalResult.suggested_questions), dimensions: evalResult.dimensions || [] });
    await c.env.DB.prepare('UPDATE resumes SET ai_review=?, ai_evaluation=?, match_score=?, screening_result=?, hard_requirement_result=?, parse_status=?, updated_at=? WHERE candidate_name=?')
      .bind(aiReview, JSON.stringify(aiEvalObj), matchScore, screeningResult, JSON.stringify(evalResult.hard_requirement_result), 'ai_screened', new Date().toISOString(), candidateName).run();
    return c.json({ ok: true, candidate_name: candidateName, dimensions: evalResult.dimensions || [], match_score: matchScore, summary: evalResult.summary, screening_result: screeningResult });
  } catch (e: any) {
    return c.json({ detail: '自动评估失败: ' + e.message }, 500);
  }
});

app.post('/api/resumes/auto-evaluate-all', authMiddleware, async (c) => {
  // 兼容旧客户端：自动评估不再直接调用 AI，统一提交队列任务。
  const body = await c.req.json().catch(() => ({}));
  const owner = getOwnerName(c);
  const result = await startHistoricalResumeReprocess(c.env.DB, c.env.RESUME_PROCESSING_QUEUE, owner);
  return c.json({ ok: true, ...result, force: body?.force === true }, 202);

  /* Legacy synchronous implementation retained below for source compatibility only. */
  try {
    const user = c.get('user');
    const body = await c.req.json().catch(() => ({}));
    const force = body.force === true;
    // 纯 D1 驱动，不依赖飞书
    const rows = await c.env.DB.prepare('SELECT id, candidate_name, position_applied, mapped_position, raw_text, ai_review, ai_evaluation FROM resumes ORDER BY updated_at DESC').all();
    const records = rows.results || [];

    // 权限过滤：非 admin 只看自己负责的岗位
    let myPositions: string[] = [];
    if (user.role !== 'admin' && user.full_name) {
      const posRows = await c.env.DB.prepare(
        'SELECT DISTINCT title FROM positions WHERE (responsible_person = ? OR responsible_person LIKE ?)'
      ).bind(user.full_name, '%' + user.full_name + '%').all();
      for (const row of (posRows.results || [])) myPositions.push((row as any).title);
    }

    // 筛选需要评估的简历
    const toEvaluate: any[] = [];
    let skipped = 0;
    for (const rec of records) {
      const candidateName = rec.candidate_name || 'Unknown';
      const position = rec.position_applied || rec.mapped_position || '';
      // 权限过滤
      if (user.role !== 'admin' && user.full_name && myPositions.length > 0 && !myPositions.includes(position)) {
        skipped++;
        continue;
      }
      if (!force && rec.ai_evaluation && String(rec.ai_evaluation).trim().length > 10) {
        skipped++;
        continue;
      }
      toEvaluate.push({ candidateName, position });
    }

    // 异步单份评估函数（每完成一份立即写 D1，前端轮询可实时看到）
    const evaluateOne = async (candidateName: string, position: string) => {
      try {
        const resumeText = await getResumeText(c.env, candidateName);
        if (resumeText.length < 10) return { name: candidateName, status: 'skip', reason: '无简历文本' };
        // 限制文本长度 8000 字符，加速 AI 处理
        const limitedText = resumeText.substring(0, 8000);
        const positionReq = position ? await getPositionRequirements(c.env, position) : null;
        const evalResult = await callAIScreening(c.env, limitedText, positionReq);
        if (!evalResult) return { name: candidateName, status: 'fail', reason: 'AI返回空' };
        const matchScore = evalResult.weighted_score ?? null;
        const screeningResult = evalResult.screening_result;
        const aiEvalObj = { summary: evalResult.summary || '', match_score: matchScore, weighted_score: evalResult.weighted_score, screening_result: screeningResult, screening_reason: evalResult.screening_reason, gate_results: evalResult.gate_results, configured_dimensions: evalResult.configured_dimensions || [], recommendation: evalResult.recommendation || '', dimensions: evalResult.dimensions || [], advantage: evalResult.advantage || '', risk: evalResult.risk || '' };
        const toArray = (v: any): string[] => { if (Array.isArray(v)) return v; if (typeof v === 'string' && v.trim()) return v.split(/\n|(?=\d+\.)/).map((s: string) => s.trim()).filter(Boolean); return []; };
        const aiReview = JSON.stringify({ summary: evalResult.summary || '', match_score: matchScore, weighted_score: evalResult.weighted_score, screening_result: screeningResult, screening_reason: evalResult.screening_reason, gate_results: evalResult.gate_results, recommendation: evalResult.recommendation || '', strengths: toArray(evalResult.advantage), risks: toArray(evalResult.risk), suggested_questions: toArray(evalResult.suggested_questions), dimensions: evalResult.dimensions || [] });
        // 立即写 D1 — 前端轮询可以实时看到结果
        await c.env.DB.prepare('UPDATE resumes SET ai_review=?, ai_evaluation=?, match_score=?, screening_result=?, hard_requirement_result=?, parse_status=?, updated_at=? WHERE candidate_name=?')
          .bind(aiReview, JSON.stringify(aiEvalObj), matchScore, screeningResult, JSON.stringify(evalResult.hard_requirement_result), 'ai_screened', new Date().toISOString(), candidateName).run();
        return { name: candidateName, status: 'ok', score: matchScore };
      } catch (e: any) {
        return { name: candidateName, status: 'fail', reason: e.message?.substring(0, 100) };
      }
    };

    // 立即返回 + 后台执行（waitUntil 保证 Worker 响应返回后继续跑）
    // 并行 5 份（加速处理）
    const BATCH_SIZE = 5;
    const backgroundWork = async () => {
      console.log(`[AutoEval] 后台开始评估 ${toEvaluate.length} 份简历`);
      let evaluated = 0, failed = 0;
      for (let i = 0; i < toEvaluate.length; i += BATCH_SIZE) {
        const batch = toEvaluate.slice(i, i + BATCH_SIZE);
        const results = await Promise.all(batch.map(r => evaluateOne(r.candidateName, r.position)));
        for (const r of results) {
          if (r.status === 'ok') evaluated++;
          else failed++;
        }
      }
      console.log(`[AutoEval] 后台评估完成：成功 ${evaluated}，失败 ${failed}，跳过 ${skipped}`);
    };

    c.executionCtx.waitUntil(backgroundWork());

    // 立即返回，不等后台完成
    return c.json({
      ok: true,
      task_started: true,
      total: records.length,
      to_evaluate: toEvaluate.length,
      skipped,
      message: `后台开始评估 ${toEvaluate.length} 份简历，请刷新页面查看结果`
    });
  } catch (e: any) {
    return c.json({ detail: '批量自动评估失败: ' + e.message }, 500);
  }
});

// 批量 AI 评估（前端按钮直接调用，复用 auto-evaluate-all 逻辑）
app.post('/api/resumes/batch-ai-evaluate', authMiddleware, async (c) => {
  // 兼容旧客户端：批量 AI 评估统一委托到同一队列。
  const body = await c.req.json().catch(() => ({}));
  const ids = Array.isArray(body?.ids) ? body.ids.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0) : [];
  const owner = getOwnerName(c);
  if (ids.length === 0) {
    const result = await startHistoricalResumeReprocess(c.env.DB, c.env.RESUME_PROCESSING_QUEUE, owner);
    return c.json({ ok: true, ...result }, 202);
  }
  if (ids.length > 50) return c.json({ detail: '一次最多提交 50 份简历' }, 400);
  const ownerWhere = owner
    ? ` AND (position_id IN (SELECT id FROM positions WHERE responsible_person = ?) OR position_applied IN (SELECT raw_name FROM position_mappings WHERE responsible_person = ?) OR mapped_position IN (SELECT mapped_name FROM position_mappings WHERE responsible_person = ?))`
    : '';
  const ownerParams = owner ? [owner, owner, owner] : [];
  const placeholders = ids.length > 0 ? ids.map(() => '?').join(', ') : '';
  const sql = ids.length > 0 ? `SELECT id FROM resumes WHERE id IN (${placeholders})${ownerWhere}` : `SELECT id FROM resumes WHERE 1=1${ownerWhere}`;
  const rows = await c.env.DB.prepare(sql).bind(...(ids.length > 0 ? ids : []), ...ownerParams).all();
  const result = await enqueueResumeReprocessBatchForIds(c.env.DB, c.env.RESUME_PROCESSING_QUEUE, (rows.results || []).map((row: any) => row.id));
  return c.json({ ok: true, ...result }, 202);

  /* Legacy synchronous implementation retained below for source compatibility only. */
  try {
    // 纯 D1 驱动
    const rows = await c.env.DB.prepare("SELECT id, candidate_name, position_applied, mapped_position, raw_text, ai_review, ai_evaluation FROM resumes WHERE raw_text IS NOT NULL AND raw_text != '' AND (ai_review IS NULL OR ai_review = '') ORDER BY updated_at DESC LIMIT 50").all();
    const list = rows.results || [];
    let evaluated = 0, skipped = 0, failed = 0;
    const errors: string[] = [];
    for (const rec of list) {
      const candidateName = rec.candidate_name || 'Unknown';
      const position = rec.position_applied || rec.mapped_position || '';
      if (rec.ai_evaluation && String(rec.ai_evaluation).trim().length > 10) { skipped++; continue; }
      try {
        const resumeText = await getResumeText(c.env, candidateName);
        if (resumeText.length < 10) { skipped++; continue; }
        const positionReq = position ? await getPositionRequirements(c.env, position) : null;
        const evalResult = await callAIScreening(c.env, resumeText, positionReq);
        if (!evalResult) { failed++; continue; }
        const matchScore = evalResult.weighted_score ?? null;
        const screeningResult = evalResult.screening_result;
        const aiEvalObj = { summary: evalResult.summary || '', match_score: matchScore, weighted_score: evalResult.weighted_score, screening_result: screeningResult, screening_reason: evalResult.screening_reason, gate_results: evalResult.gate_results, configured_dimensions: evalResult.configured_dimensions || [], recommendation: evalResult.recommendation || '', dimensions: evalResult.dimensions || [], advantage: evalResult.advantage || '', risk: evalResult.risk || '' };
        const aiReview = JSON.stringify({ summary: evalResult.summary || '', match_score: matchScore, weighted_score: evalResult.weighted_score, screening_result: screeningResult, screening_reason: evalResult.screening_reason, gate_results: evalResult.gate_results, recommendation: evalResult.recommendation || '', strengths: (Array.isArray(evalResult.advantage) ? evalResult.advantage : (typeof evalResult.advantage === 'string' ? evalResult.advantage.split(/\n|(?=\d+\.)/).map((s: string) => s.trim()).filter(Boolean) : [])), risks: (Array.isArray(evalResult.risk) ? evalResult.risk : (typeof evalResult.risk === 'string' ? evalResult.risk.split(/\n|(?=\d+\.)/).map((s: string) => s.trim()).filter(Boolean) : [])), suggested_questions: (Array.isArray(evalResult.suggested_questions) ? evalResult.suggested_questions : (typeof evalResult.suggested_questions === 'string' ? evalResult.suggested_questions.split(/\n|(?=\d+\.)/).map((s: string) => s.trim()).filter(Boolean) : [])), dimensions: evalResult.dimensions || [] });
        await c.env.DB.prepare('UPDATE resumes SET ai_review=?, ai_evaluation=?, match_score=?, screening_result=?, hard_requirement_result=?, parse_status=?, updated_at=? WHERE candidate_name=?')
          .bind(aiReview, JSON.stringify(aiEvalObj), matchScore, screeningResult, JSON.stringify(evalResult.hard_requirement_result), 'ai_screened', now(), candidateName).run();
        evaluated++;
      } catch (e: any) { failed++; errors.push(candidateName + ': ' + e.message?.substring(0, 100)); }
    }
    return c.json({ ok: true, total: list.length, evaluated, skipped, failed, errors: errors.slice(0, 20) });
  } catch (e: any) { return c.json({ detail: '批量评估失败: ' + e.message }, 500); }
});


// 修复 position_mappings 中 responsible_person 字段（可能是对象而非字符串）
app.post('/api/position-mappings/fix-responsible', authMiddleware, requireRole(['admin']), async (c) => {
  try {
    const rows = await c.env.DB.prepare('SELECT id, mapped_name, responsible_person FROM position_mappings').all();
    let fixed = 0;
    for (const row of (rows.results || [])) {
      const r = row as any;
      let person = r.responsible_person;
      if (person && typeof person === 'object') {
        try {
          const parsed = typeof person === 'string' ? JSON.parse(person) : person;
          if (parsed.name) person = parsed.name;
          else if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].name) person = parsed[0].name;
          else person = String(parsed);
        } catch { person = String(person); }
        await c.env.DB.prepare('UPDATE position_mappings SET responsible_person = ? WHERE id = ?').bind(person, r.id).run();
        fixed++;
      }
    }
    return c.json({ ok: true, fixed });
  } catch (e: any) { return c.json({ detail: e.message }, 500); }
});

app.notFound((c) => {
  // API 路由返回 JSON
  if (c.req.path.startsWith('/api/')) {
    return c.json({ detail: 'Not found' }, 404);
  }
  // 非 API 路由 → 委托 ASSETS 处理（SPA 路由由 index.html 兜底）
  if (c.env.ASSETS) {
    return c.env.ASSETS.fetch(c.req.raw);
  }
  return c.text('Not found', 404);
});

// ==================== 修复：从AI评估文本中提取缺失的基本信息 ====================

app.post('/api/resumes/fix-missing-fields', authMiddleware, requireRole(['admin']), async (c) => {
  try {
    // 创建缓存表（用于存储从AI提取的额外字段）
    try { await c.env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS resume_extras (feishu_record_id TEXT PRIMARY KEY, major TEXT DEFAULT '', gender TEXT DEFAULT '', education TEXT DEFAULT '', age TEXT DEFAULT '', updated_at TEXT DEFAULT '')"
    ).run(); } catch {}

    // 从飞书获取全部简历
    const tableId = getBitableTableId(c.env, 'talent');
    const records = await bitableListRecords(c.env, tableId);
    let updated = 0, skipped = 0, failed = 0;
    const details: string[] = [];

    // 分批处理，每批只处理10个，避免Cloudflare子请求限制
    const BATCH_SIZE = 10;
    let processedInBatch = 0;
    for (let batchStart = 0; batchStart < records.length && processedInBatch < BATCH_SIZE; batchStart += 1) {
      const rec = records[batchStart];
      try {
        const f = rec.fields || {};
        const candidateName = getFirstValue(f['姓名']) || '';
        const recordId = rec.record_id;
        if (!candidateName || !recordId) { skipped++; continue; }

        // 跳过已在 resume_extras 中且有值（含"无"）的记录
        const existing = await c.env.DB.prepare('SELECT major FROM resume_extras WHERE feishu_record_id = ?').bind(recordId).first();
        if (existing && (existing as any).major) { skipped++; continue; }

        // 检查是否需要补充
        const existingMajor = getFirstValue(f['专业']) || '';
        const existingEdu = getFirstValue(f['学历']) || '';
        const existingGender = getFirstValue(f['性别']) || '';
        const existingAge = f['年龄'] || '';
        const existingEval = getFirstValue(f['AI简历评估']) || '';

        // 如果专业已在飞书有值则跳过
        if (existingMajor) { skipped++; continue; }

        // 用AI从评估文本中提取基本信息
        const evalText = String(existingEval || '');
        if (evalText.length < 50) { skipped++; details.push(`${candidateName}: 评估文本不足`); continue; }

        const parsePrompt = await getAIPrompt(c.env, 'parse_resume_pdf', {
          system: '从以下简历评估文本中提取基本信息，只返回JSON：{"major":"专业名称","gender":"男/女","education":"学历","age":年龄数字}。字段找不到就填"无"。',
          user: ''
        });
        const aiResult = await callAI(c.env,
          parsePrompt.system,
          '评估文本：\n' + evalText.substring(0, 5000));

        if (!aiResult) { skipped++; continue; }

        let parsed: any;
        const m = aiResult.match(/\{[\s\S]*\}/);
        if (m) try { parsed = JSON.parse(m[0]); } catch {}

        let major = parsed?.major && parsed.major !== '无' ? parsed.major : '';
        const gender = parsed?.gender && parsed.gender !== '无' ? parsed.gender : '';
        const education = parsed?.education && parsed.education !== '无' ? parsed.education : '';
        const age = parsed?.age ? String(parsed.age) : '';

        // 专业仍未找到 → 从PDF原文提取
        if (!major) {
          try {
            const resumeText = await getResumeText(c.env, candidateName);
            if (resumeText && resumeText.length > 100) {
              const pdfParsePrompt = await getAIPrompt(c.env, 'parse_resume_pdf', {
                system: '从以下简历原文中提取"专业"字段。只返回JSON：{"major":"专业名称"}。找不到就填"无"。',
                user: ''
              });
              const pdfExtract = await callAI(c.env,
                pdfParsePrompt.system,
                '简历原文：\n' + resumeText.substring(0, 4000));
              if (pdfExtract) {
                const pm = pdfExtract.match(/\{[\s\S]*\}/);
                if (pm) try { const pp = JSON.parse(pm[0]); if (pp.major && pp.major !== '无') major = pp.major; } catch {}
              }
            }
          } catch {}
        }

        // 还是没有 → 填"无"
        if (!major) major = '无';

        // 保存到缓存表
        await c.env.DB.prepare(
          "INSERT OR REPLACE INTO resume_extras (feishu_record_id, major, gender, education, age, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'))"
        ).bind(recordId, major, gender || existingGender, education || existingEdu, age || String(existingAge)).run();

        processedInBatch++;
        updated++;
        details.push(`${candidateName}: major=${major}`);
      } catch (e: any) {
        failed++;
        details.push(`${getFirstValue(rec.fields?.['姓名']) || '?'}: ${e.message.substring(0, 80)}`);
      }
    }  // end for batch

    return c.json({ ok: true, total: records.length, updated, skipped, failed, details });
  } catch (e: any) {
    return c.json({ detail: '处理失败: ' + e.message }, 500);
  }
});

// ========== PDF 缓存清理 ==========
// 清除超过指定天数的 resume_files 缓存（只删 PDF，不动其他数据）
app.delete('/api/resumes/cleanup-pdfs', authMiddleware, async (c) => {
  try {
    // v2.0: 不删除 resume_files 数据，仅清除 bitableCache 内存缓存
    const days = parseInt(c.req.query('days') || '30');
    let beforeSize = bitableCache.size;
    for (const [key, entry] of bitableCache) {
      if (entry.expiry < Date.now()) bitableCache.delete(key);
    }
    let afterSize = bitableCache.size;
    return c.json({ ok: true, cache_cleared: beforeSize - afterSize, remaining: afterSize, message: '仅清除了内存缓存。数据库数据永久保留，不删除。' });
  } catch (e: any) {
    return c.json({ detail: '清理失败: ' + e.message }, 500);
  }
});

// SPA fallback
// 简历存储架构 - 新路由注册（默认 Feature Flag 关闭）
createUploadRoutes(app);
createMaintenanceRoutes(app);

app.notFound(async (c) => {
  if (c.req.path.startsWith('/api/')) return c.json({ detail: 'Not found' }, 404);
  if (c.env.ASSETS) return c.env.ASSETS.fetch(c.req.raw);
  return c.text('Not found', 404);
});

// Worker Cron 触发器：每天北京时间 9:00（UTC 1:00）
// 1. 清除内存缓存  2. 检查待审核候选人，>0 则发飞书提醒

// 数据库迁移端点：添加 file_sha256 列（幂等，列已存在时忽略）
app.post('/api/admin/migrate/file-sha256', async (c) => {
  try {
    await c.env.DB.prepare('ALTER TABLE resumes ADD COLUMN file_sha256 TEXT;').run();
    return c.json({ ok: true, message: 'file_sha256 列已添加' });
  } catch (e: any) {
    // 列已存在时 D1 会抛错，忽略
    if (e.message?.includes('duplicate column') || e.message?.includes('already exists')) {
      return c.json({ ok: true, message: 'file_sha256 列已存在' });
    }
    return c.json({ ok: false, error: e.message }, 500);
  }
});


// ==================== 管理端点：简历邮箱回填 ====================
// 从简历文本提取邮箱回填 resumes.email（parsed_data.email 优先，其次原文正则提取）。
// 鉴权：JWT admin 或长期 API Key（x-api-key）。幂等，可重复执行。支持 ?limit=（默认 1000，上限 5000）。
const RESUME_EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

function extractResumeEmail(row: any): string {
  try {
    const parsed = typeof row.parsed_data === 'string' ? JSON.parse(row.parsed_data) : row.parsed_data;
    if (parsed && typeof parsed.email === 'string') {
      const m = parsed.email.trim().match(RESUME_EMAIL_RE);
      if (m) return m[0];
    }
  } catch { /* 解析失败走原文提取 */ }
  const textSource = [row.resume_markdown, row.raw_text, row.ocr_markdown].filter((v) => v).join('\n');
  const m = textSource.match(RESUME_EMAIL_RE);
  return m ? m[0] : '';
}

app.post('/api/admin/backfill-resume-emails', businessScreeningAuthMiddleware, async (c) => {
  try {
    const rawLimit = Number(c.req.query('limit') || 1000);
    const limit = Math.max(1, Math.min(Number.isFinite(rawLimit) ? rawLimit : 1000, 5000));
    const idRows = await c.env.DB.prepare(
      "SELECT id FROM resumes WHERE email IS NULL OR email = '' LIMIT ?",
    ).bind(limit).all();
    const ids = (idRows.results || []).map((r: any) => String(r.id));
    if (ids.length === 0) return c.json({ ok: true, candidates: 0, updated: 0, missing: 0 });

    let updated = 0;
    let missing = 0;
    const nowIso = now();
    for (let i = 0; i < ids.length; i += 90) {
      const chunk = ids.slice(i, i + 90);
      const placeholders = chunk.map(() => '?').join(',');
      const rows = await c.env.DB.prepare(
        `SELECT id, raw_text, resume_markdown, ocr_markdown, parsed_data FROM resumes WHERE id IN (${placeholders})`,
      ).bind(...chunk).all();
      for (const row of (rows.results || []) as any[]) {
        const email = extractResumeEmail(row);
        if (email) {
          await c.env.DB.prepare('UPDATE resumes SET email = ?, updated_at = ? WHERE id = ?')
            .bind(email, nowIso, String(row.id)).run();
          updated += 1;
        } else {
          missing += 1;
        }
      }
    }
    await logOperation(c.env, {
      action: 'admin.backfill_resume_emails',
      actor: (c.get('user') as any)?.email || 'api-key',
      detail: JSON.stringify({ candidates: ids.length, updated, missing }),
    });
    return c.json({ ok: true, candidates: ids.length, updated, missing });
  } catch (e: any) {
    return c.json({ ok: false, detail: `回填失败: ${e?.message || e}` }, 500);
  }
});


// ==================== 管理端点：AI 提取简历邮箱 ====================
// 调用系统 LLM（callAI，走系统设置多槽位配置，失败自动降级）从简历文本提取邮箱回填 resumes.email。
// 只处理 email 为空且 email_ai_checked_at 为空的简历；LLM 确认无邮箱也写入检查标记，避免反复调用浪费额度。
// 幂等可重跑，支持 ?limit=（每批条数，默认 8，上限 20），内部并发 3。
async function aiExtractEmailFromText(env: Env, row: any): Promise<string> {
  try {
    const parsed = typeof row.parsed_data === 'string' ? JSON.parse(row.parsed_data) : row.parsed_data;
    if (parsed && typeof parsed.email === 'string') {
      const m = parsed.email.trim().match(RESUME_EMAIL_RE);
      if (m) return m[0];
    }
  } catch { /* 继续走 LLM */ }
  const text = [row.resume_markdown, row.raw_text, row.ocr_markdown].filter((v) => v).join('\n');
  if (!text.trim()) return '';
  const snippet = text.slice(0, 6000);
  try {
    const out = await callAI(
      env,
      '你是一个简历解析助手。只输出一个 JSON 对象：{"email": "邮箱地址"}。若文本中不存在邮箱，email 必须是空字符串。不要输出任何其他内容、不要用 markdown 代码块包裹。',
      `请从以下简历文本中提取邮箱地址（如不存在返回空字符串）：\n\n${snippet}`,
    );
    const block = out.match(/\{[\s\S]*?\}/);
    if (block) {
      const json = JSON.parse(block[0]);
      if (json && typeof json.email === 'string') {
        const email = json.email.trim();
        if (email && RESUME_EMAIL_RE.test(email)) return email;
      }
    }
  } catch { /* LLM 失败回退正则 */ }
  const fallback = text.match(RESUME_EMAIL_RE);
  return fallback ? fallback[0] : '';
}

app.post('/api/admin/ai-extract-emails', businessScreeningAuthMiddleware, async (c) => {
  try {
    const rawLimit = Number(c.req.query('limit') || 8);
    const limit = Math.max(1, Math.min(Number.isFinite(rawLimit) ? rawLimit : 8, 20));
    const rows = await c.env.DB.prepare(
      `SELECT id, raw_text, resume_markdown, ocr_markdown, parsed_data FROM resumes
       WHERE (email IS NULL OR email = '') AND (email_ai_checked_at IS NULL OR email_ai_checked_at = '')
       LIMIT ?`,
    ).bind(limit).all();
    const items = (rows.results || []) as any[];
    if (items.length === 0) return c.json({ ok: true, candidates: 0, extracted: 0, none: 0, failed: 0, results: [] });

    const nowIso = now();
    let extracted = 0;
    let none = 0;
    let failed = 0;
    const results: any[] = [];
    const queue = [...items];
    const runWorker = async () => {
      while (queue.length > 0) {
        const row = queue.shift();
        if (!row) return;
        try {
          const email = await aiExtractEmailFromText(c.env, row);
          if (email) {
            await c.env.DB.prepare('UPDATE resumes SET email = ?, email_ai_checked_at = ?, updated_at = ? WHERE id = ?')
              .bind(email, nowIso, nowIso, String(row.id)).run();
            extracted += 1;
            results.push({ id: row.id, email });
          } else {
            await c.env.DB.prepare('UPDATE resumes SET email_ai_checked_at = ?, updated_at = ? WHERE id = ?')
              .bind(nowIso, nowIso, String(row.id)).run();
            none += 1;
            results.push({ id: row.id, email: null });
          }
        } catch (e: any) {
          failed += 1;
          results.push({ id: row.id, email: null, error: String(e?.message || e).slice(0, 120) });
        }
      }
    };
    await Promise.all([runWorker(), runWorker(), runWorker()]);

    await logOperation(c.env, {
      action: 'admin.ai_extract_emails',
      actor: (c.get('user') as any)?.email || 'api-key',
      detail: JSON.stringify({ candidates: items.length, extracted, none, failed }),
    });
    return c.json({ ok: true, candidates: items.length, extracted, none, failed, results });
  } catch (e: any) {
    return c.json({ ok: false, detail: `AI 提取失败: ${e?.message || e}` }, 500);
  }
});


// ==================== 管理端点：重新提取工作经历 ====================
// 用系统 LLM（callAI，走系统设置多槽位配置，失败自动降级）从简历文本重新提取完整工作经历
// （尽可能参考原文保留职责与成果细节，仅单段超过 300 字才压缩概括），回填 parsed_data.work_experience 与 work_experience 列。
// 用于修复历史简历工作经历被省略（只提取到公司名）或压缩过短的问题。鉴权：JWT admin 或长期 API Key（x-api-key）。
// 幂等可重复执行。请求体三种模式：
//   ① { resume_id: string } 单份；
//   ② { resume_ids: string[] } 指定批量（单次最多 50 份）；
//   ③ { all: true, limit?: number, exclude_ids?: string[] } 全量模式：处理有简历文本、且 id 不在 exclude_ids 中的简历
//      （默认 limit=60，上限 200），返回 processed_ids 供下一批 exclude_ids 续跑。
const WORK_EXPERIENCE_EXTRACT_SYSTEM_PROMPT = '你是专业的简历工作经历提取助手，只返回 JSON 对象，不要输出其他任何内容，不要用 markdown 代码块包裹。';
const WORK_EXPERIENCE_EXTRACT_USER_PROMPT = `从以下简历文本中提取所有工作经历，严格只返回 JSON 对象：
{"work_experience": [{"company": "公司名称", "title": "职位", "duration": "起止时间", "description": "职责与成果描述", "achievements": "主要成果"}]}

要求：
1. 覆盖简历中出现的每一段工作经历，不得遗漏任何公司或时间段；
2. description 必须尽可能参考原文完整保留职责与成果细节（含项目成果、数据指标），禁止只写公司名；
3. 仅当单段 description 的原文内容超过 300 字时，才用 AI 压缩概括，压缩后仍须保留关键职责与成果；
4. 找不到的字段填空字符串；简历中没有工作经历时返回 {"work_experience": []}；
5. 只输出 JSON 对象。

简历文本：
{resume_text}`;

async function reparseOneWorkExperience(db: D1Database, id: string, env: Env): Promise<Record<string, unknown>> {
  try {
    const row: any = await db.prepare(
      'SELECT id, parsed_data, resume_markdown, raw_text, ocr_markdown FROM resumes WHERE id = ?',
    ).bind(id).first();
    if (!row) return { id, error: 'resume not found' };
    const text = [row.resume_markdown, row.raw_text, row.ocr_markdown]
      .filter((v: unknown) => v && String(v).trim())
      .join('\n').trim();
    if (!text) return { id, error: 'no resume text' };
    const snippet = text.slice(0, 60000);
    // JSON 解析失败时重试一次（偶发 LLM 输出格式问题）
    let json: any = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const response = await callAI(
        env,
        WORK_EXPERIENCE_EXTRACT_SYSTEM_PROMPT,
        WORK_EXPERIENCE_EXTRACT_USER_PROMPT.replace('{resume_text}', snippet),
        undefined,
        { structured: true, temperature: 0, maxTokens: 8192 },
      );
      json = extractJSON(response);
      if (json && typeof json === 'object') break;
    }
    if (!json || typeof json !== 'object') return { id, error: 'AI response not JSON' };
    const workExperience = Array.isArray(json.work_experience) ? json.work_experience : [];
    let existing: Record<string, unknown> = {};
    try { existing = typeof row.parsed_data === 'string' ? JSON.parse(row.parsed_data) : (row.parsed_data || {}); } catch {}
    const merged = { ...existing, work_experience: workExperience };
    await db.prepare('UPDATE resumes SET parsed_data = ?, work_experience = ?, updated_at = ? WHERE id = ?')
      .bind(JSON.stringify(merged), JSON.stringify(workExperience), new Date().toISOString(), id).run();
    return {
      id,
      work_experience_count: workExperience.length,
      companies: workExperience.map((w: any) => String(w?.company || '').trim()).filter(Boolean),
      companies_with_description: workExperience.filter((w: any) => w?.description && String(w.description).trim()).length,
    };
  } catch (e: any) {
    return { id, error: String(e?.message || e).slice(0, 200) };
  }
}

app.post('/api/admin/reparse-work-experience', businessScreeningAuthMiddleware, async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const actor = (c.get('user') as any)?.email || 'api-key';

    if (body && body.all === true) {
      const rawLimit = Number(body.limit || 60);
      const limit = Math.max(1, Math.min(Number.isFinite(rawLimit) ? rawLimit : 60, 200));
      const excludeIds = new Set(Array.isArray(body.exclude_ids)
        ? body.exclude_ids.map((v: unknown) => String(v).trim()).filter(Boolean).slice(0, 5000)
        : []);
      // 一次取全部有文本的 id，JS 侧过滤 exclude 再切 limit（避免 D1 NOT IN 超过 100 绑定变量上限）
      const rows = await c.env.DB.prepare(
        `SELECT id FROM resumes WHERE ((resume_markdown IS NOT NULL AND resume_markdown != '')
           OR (raw_text IS NOT NULL AND raw_text != '') OR (ocr_markdown IS NOT NULL AND ocr_markdown != ''))`,
      ).all();
      const ids = (rows.results || [])
        .map((r: any) => String(r.id))
        .filter((id: string) => !excludeIds.has(id))
        .slice(0, limit);
      if (ids.length === 0) return c.json({ ok: true, processed: 0, remaining: 0, processed_ids: [], results: [] });

      const results: any[] = [];
      const queue = [...ids];
      const runWorker = async () => {
        while (queue.length > 0) {
          const id = queue.shift();
          if (!id) return;
          results.push(await reparseOneWorkExperience(c.env.DB, id, c.env));
        }
      };
      await Promise.all([runWorker(), runWorker(), runWorker(), runWorker()]);

      await logOperation(c.env, {
        action: 'admin.reparse_work_experience.all',
        actor,
        detail: JSON.stringify({ batch: ids.length, failed: results.filter((r) => r.error).length }),
      });
      const processedIds = results.filter((r) => !r.error).map((r) => r.id);
      return c.json({ ok: true, processed: processedIds.length, failed: results.length - processedIds.length, processed_ids: processedIds, results });
    }

    const ids = Array.isArray(body?.resume_ids) && body.resume_ids.length > 0
      ? body.resume_ids.map((v: unknown) => String(v)).slice(0, 50)
      : (body?.resume_id ? [String(body.resume_id)] : []);
    if (ids.length === 0) return c.json({ detail: 'resume_id 或 resume_ids 或 all 必填' }, 400);

    const results: any[] = [];
    for (const id of ids) {
      results.push(await reparseOneWorkExperience(c.env.DB, id, c.env));
    }
    await logOperation(c.env, {
      action: 'admin.reparse_work_experience',
      actor,
      detail: JSON.stringify({ ids, results }),
    });
    return c.json({ ok: true, results });
  } catch (e: any) {
    return c.json({ ok: false, detail: `重新提取工作经历失败: ${e?.message || e}` }, 500);
  }
});

// ==================== 管理端点：面试自动化环境诊断 ====================
// 返回生产环境面试自动化相关 env 状态（flag/queue/日历），用于排查「安排了面试但未启动排期」。
app.post('/api/admin/automation-env', businessScreeningAuthMiddleware, async (c) => {
  return c.json({
    enabled_raw: String(c.env.INTERVIEW_AUTOMATION_ENABLED ?? ''),
    enabled: String(c.env.INTERVIEW_AUTOMATION_ENABLED ?? '').toLowerCase() === 'true',
    has_queue: !!c.env.INTERVIEW_AUTOMATION_QUEUE,
    calendar_id: String(c.env.FEISHU_RECRUITMENT_CALENDAR_ID || ''),
  });
});

// ==================== 管理端点：简历重置为待安排面试 ====================
// 把简历恢复到「已入库待安排面试」初始阶段：status=approved（已入库，前端「安排面试」按钮可点）、stage=talent_pool，
// 业务筛选状态重置为 not_ready、hr_disposition=pending、清空批次关联，
// 并从所有业务筛选批次移除该简历的条目、删除关联面试记录（AI 初筛结果 screening_result 保持不变）。
// ids 内部按 90 分批执行（D1 单语句绑定参数上限 100）。
// 全部重置：不传 ids（或 reset_all=true）时，重置所有已入库候选人（status='approved'）+ 所有有关联面试记录的简历，
// 并删除无简历关联的手动创建面试记录。
// 鉴权：JWT admin 或长期 API Key（x-api-key）。
app.post('/api/admin/reset-resumes-pending-interview', businessScreeningAuthMiddleware, async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const db = c.env.DB as D1Database;
    const nowIso = now();
    let removedItems = 0;
    let deletedInterviews = 0;
    const resetAll = body?.reset_all === true || body?.reset_all === 'true';

    let resetIds: string[] = Array.isArray(body?.ids)
      ? body.ids.map((s: unknown) => String(s).trim()).filter(Boolean)
      : [];
    if (resetAll || resetIds.length === 0) {
      // 全部重置：所有已入库候选人 + 有关联面试记录（按 resume_id 或候选人姓名匹配）的简历
      const rows = await db.prepare(
        `SELECT DISTINCT r.id FROM resumes r
           WHERE r.status = 'approved'
              OR EXISTS (SELECT 1 FROM interviews i WHERE i.resume_id = r.id OR i.candidate_name = r.candidate_name)`,
      ).all();
      resetIds = [...new Set((rows.results || []).map((r: any) => String(r.id)).filter(Boolean))];
      // 无简历关联的手动创建面试记录一并删除（面试管理页回到初始状态）
      const orphanDel = await db.prepare(
        `DELETE FROM interviews WHERE resume_id IS NULL OR resume_id = ''`,
      ).run();
      deletedInterviews += orphanDel.meta?.changes ?? 0;
    }
    if (resetIds.length === 0) {
      return c.json({ ok: true, reset: 0, removed_items: 0, deleted_interviews: deletedInterviews, all: resetAll || true });
    }

    const chunks: string[][] = [];
    for (let i = 0; i < resetIds.length; i += 90) chunks.push(resetIds.slice(i, i + 90));

    for (const ids of chunks) {
      const placeholders = ids.map(() => '?').join(',');

      // 从所有业务筛选批次移除该简历条目（含已决策记录）
      const del = await db.prepare(
        `DELETE FROM resume_push_batch_items WHERE resume_id IN (${placeholders})`,
      ).bind(...ids).run();
      removedItems += del.meta?.changes ?? 0;

      // 重置为已入库待安排面试初始阶段（approved 使面试管理「安排面试」按钮可用）
      await db.prepare(
        `UPDATE resumes
            SET status = 'approved',
                stage = 'talent_pool',
                business_screening_status = 'not_ready',
                hr_disposition = 'pending',
                business_screening_batch_id = NULL,
                business_screening_dispatch_group_id = NULL,
                business_screened_at = NULL,
                business_screened_by = '',
                updated_at = ?
          WHERE id IN (${placeholders})`,
      ).bind(nowIso, ...ids).run();

      // 删除关联面试记录（按 resume_id 与候选人姓名匹配），面试管理页回到「待安排面试」初始状态
      const nameRows = await db.prepare(
        `SELECT candidate_name FROM resumes WHERE id IN (${placeholders}) AND candidate_name IS NOT NULL AND candidate_name != ''`,
      ).bind(...ids).all();
      const names = [...new Set((nameRows.results || []).map((r: any) => String(r.candidate_name)))];
      const delIv = await db.prepare(
        `DELETE FROM interviews WHERE resume_id IN (${placeholders})`,
      ).bind(...ids).run();
      deletedInterviews += delIv.meta?.changes ?? 0;
      if (names.length > 0) {
        for (let j = 0; j < names.length; j += 90) {
          const nameChunk = names.slice(j, j + 90);
          const namePh = nameChunk.map(() => '?').join(',');
          const delIvName = await db.prepare(
            `DELETE FROM interviews WHERE candidate_name IN (${namePh})`,
          ).bind(...nameChunk).run();
          deletedInterviews += delIvName.meta?.changes ?? 0;
        }
      }
    }

    await logOperation(c.env, {
      action: 'admin.reset_resumes_pending_interview',
      actor: (c.get('user') as any)?.email || 'api-key',
      detail: JSON.stringify({ all: resetAll || true, reset: resetIds.length, removed_items: removedItems, deleted_interviews: deletedInterviews }),
    });
    return c.json({ ok: true, reset: resetIds.length, removed_items: removedItems, deleted_interviews: deletedInterviews, all: true });
  } catch (e: any) {
    return c.json({ ok: false, detail: `重置失败: ${e?.message || e}` }, 500);
  }
});


/**
 * 解析「YYYY-MM-DD HH:mm」（北京时间，interview_time 存储口径）→ 毫秒时间戳。
 * 解析失败返回 null。
 */
function parseBeijingInterviewTime(value: string): number | null {
  const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return null;
  const ts = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+08:00`);
  return Number.isNaN(ts) ? null : ts;
}

/**
 * 面试前 30 分钟提醒（cron 每 5 分钟调用）：
 * 面试开始时间在 [now+25min, now+35min]、状态 scheduled、未发过提醒的面试，
 * 给主面试官发面试提醒（卡片 + 简历 PDF + 面试卡片链接）。
 * 无论发送结果如何都标记 interview_reminder_sent_at，避免每 5 分钟重复尝试同一场。
 */
async function runUpcomingInterviewReminders(env: Env, db: D1Database): Promise<{ reminded: number; handled: number }> {
  const nowMs = Date.now();
  const rows = (await db.prepare(
    "SELECT id, interview_time FROM interviews WHERE status = 'scheduled' AND interview_reminder_sent_at IS NULL AND interview_time IS NOT NULL AND interview_time != ''",
  ).all()).results || [];

  let reminded = 0;
  let handled = 0;
  const markedAt = new Date(nowMs).toISOString();
  for (const row of rows) {
    const startTs = parseBeijingInterviewTime(String(row.interview_time || ''));
    if (!startTs) continue;
    const aheadMs = startTs - nowMs;
    if (aheadMs < 25 * 60_000 || aheadMs > 35 * 60_000) continue;
    handled += 1;
    try {
      const result = await sendInterviewerInterviewReminder(env, db, {
        interviewId: String(row.id),
        userToken: await getFeishuToken(env),
        operatorName: '系统',
      }, { now, uuid, hashPublicToken, getResumeFileBytes, getBotToken: getFeishuToken });
      if (result.ok) {
        reminded += 1;
        console.log(`[cron:interview-upcoming] 已提醒 ${row.id} -> ${result.interviewerName} link=${result.cardLinkUrl || '-'}`);
      } else {
        console.warn(`[cron:interview-upcoming] 提醒未发送 ${row.id}: ${result.reason || '未知原因'}`);
      }
    } catch (e: any) {
      console.error(`[cron:interview-upcoming] 提醒异常 ${row.id}: ${e?.message || e}`);
    }
    await db.prepare('UPDATE interviews SET interview_reminder_sent_at = ?, updated_at = ? WHERE id = ?')
      .bind(markedAt, markedAt, row.id).run().catch(() => {});
  }
  return { reminded, handled };
}

// 线上保存面试官 open_id（来自飞书通讯录全量接口；batch-sync 部门接口覆盖不到的用这个补）
// body: { items: [{ name, open_id }] } —— upsert 到 interviewer_mappings
app.post('/api/admin/set-interviewer-openids', businessScreeningAuthMiddleware, async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const items = Array.isArray(body?.items) ? body.items : [];
    const db = c.env.DB as D1Database;
    const ts = now();
    let saved = 0;
    const skipped: string[] = [];
    for (const it of items) {
      const name = String(it?.name || '').trim();
      const openId = String(it?.open_id || '').trim();
      if (!name || !openId || !/^ou_/.test(openId)) { skipped.push(name || '(空)'); continue; }
      await db.prepare(
        `INSERT INTO interviewer_mappings (id, name, open_id, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET open_id = excluded.open_id, updated_at = excluded.updated_at`,
      ).bind(`im_${openId}`, name, openId, ts).run();
      saved += 1;
    }
    await logOperation(c.env, {
      action: 'admin.set_interviewer_openids',
      actor: (c.get('user') as any)?.email || 'api-key',
      detail: JSON.stringify({ items: items.length, saved, skipped }),
    });
    return c.json({ ok: true, total: items.length, saved, skipped });
  } catch (e: any) {
    return c.json({ ok: false, detail: `保存失败: ${e?.message || e}` }, 500);
  }
});

export default {
  fetch: app.fetch,
  async scheduled(event: any, env: any, ctx: any) {
    // Reclaim consumer slots held by interrupted AI requests before other
    // scheduled work. The recovery is idempotent and only touches old jobs.
    ctx.waitUntil((async () => {
      try {
        const result = await recoverStaleResumeProcessingJobs(env.DB);
        if (result.recovered > 0) {
          console.warn(`[cron:resume-processing] recovered_stale_jobs=${result.recovered}`);
        }
      } catch (error) {
        console.error('[cron:resume-processing] stale job recovery failed', error);
      }
    })());

    if (event.cron === '55 15 * * *') {
      ctx.waitUntil((async () => {
        const at = new Date(event.scheduledTime);
        try { await createDashboardV3Snapshot(env.DB, toShanghaiSnapshotDate(at), await loadLiveDashboardV3(env.DB, env, null), 'cron', at.toISOString()); }
        catch (error) { if (!(error instanceof Error && error.message === 'snapshot already exists')) throw error; }
      })());
      return;
    }

    if (event.cron === '0 10 * * *') {
      ctx.waitUntil((async () => {
        try {
          const report = await runDailyReportPipeline(
            env,
            new Date(event.scheduledTime),
            env.FEISHU_RECRUITMENT_GROUP_CHAT_ID || '',
            dailyReportGenerationDependencies(env),
            async (target, card) => {
              const token = await getFeishuToken(env);
              await sendFeishuMessageToChat(token, target.id, card);
            },
          );
          console.log(`[cron:daily-report] sent report_id=${report.id} report_date=${report.snapshot.reportDate}`);
        } catch (error) {
          if (error instanceof DailyReportTargetMissingError) {
            console.warn('[cron:daily-report] FEISHU_RECRUITMENT_GROUP_CHAT_ID 未配置，跳过且不生成日报');
            return;
          }
          if (error instanceof DailyReportDeliveryError) {
            console.error(`[cron:daily-report] delivery failed report_id=${error.reportId}: ${error.message}`);
          }
          throw error;
        }
      })());
      return;
    }

    if (event.cron === '*/5 * * * *') {
      ctx.waitUntil((async () => {
        try {
          const result = await runUpcomingInterviewReminders(env, env.DB);
          if (result.handled > 0) console.log(`[cron:interview-upcoming] handled=${result.handled} reminded=${result.reminded}`);
        } catch (error) {
          console.error('[cron:interview-upcoming] failed', error);
        }
      })());
      return;
    }

    if (event.cron !== '0 1 * * *') {
      console.warn(`[cron] 未识别的 cron 表达式，跳过: ${event.cron}`);
      return;
    }

    // 1. 清除内存 bitableCache（原有逻辑）
    let beforeSize = bitableCache.size;
    for (const [key, entry] of bitableCache) {
      if (entry.expiry < Date.now()) bitableCache.delete(key);
    }
    console.log(`[cron:cleanup-cache] cleared ${beforeSize - bitableCache.size} stale cache entries.`);

    // 2. 面试定时提醒：查 resume_screening_queue 待审核数，>0 发提醒
    try {
      const pending = await env.DB.prepare(
        "SELECT COUNT(*) as c FROM resume_screening_queue WHERE status = 'pending'"
      ).first() as any;
      const count = pending?.c || 0;
      if (count > 0) {
        const token = await getFeishuToken(env);
        const card = buildReminderCard(count);
        const chatId = FEISHU_CONFIG.recruitmentGroupChatId;
        if (chatId) {
          await sendFeishuMessageToChat(token, chatId, card);
          console.log(`[cron:interview-reminder] 已发群提醒，pending=${count}`);
        } else if (FEISHU_CONFIG.defaultHrOpenId) {
          await sendFeishuMessageToUser(token, FEISHU_CONFIG.defaultHrOpenId, card);
          console.log(`[cron:interview-reminder] 已发默认HR提醒，pending=${count}`);
        } else {
          console.log(`[cron:interview-reminder] pending=${count} 但无群和默认HR配置，跳过`);
        }
      } else {
        console.log('[cron:interview-reminder] 无待审核，跳过');
      }
    } catch (e: any) {
      console.error(`[cron:interview-reminder] 失败: ${e.message}`);
    }
  },
};
