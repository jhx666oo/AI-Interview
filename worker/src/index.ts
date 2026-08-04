import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createOrGetActiveJob } from './resume-processing/job-repository';
import { normalizeResumeFields } from './resume-processing/fields';
import { ensureResumeListSchema, RESUME_LIST_COMPATIBILITY_MIGRATIONS } from './resume-schema';
import { assertShareDataMode, createShareExpiry, hashShareToken, isShareLinkActive, toPublicBoardRow, toShanghaiSnapshotDate } from './recruiting-operations/share-links';
import { createUploadRoutes } from './resume-uploads/routes';
import { createMaintenanceRoutes } from './resume-maintenance/routes';
import { handleR2Upload } from './resume-uploads/refactored-upload';
import { handleOptimizedResumeList } from './resume-list/optimized-handler';


import type { ShareExpiryOption } from './recruiting-operations/types';
import {
  buildRecruitingBoard,
  getBoardFirstInterviewCount,
  getBoardInterviewPassCondition,
  groupBoardRows,
  toPublicRecruitingBoard as toPublicRecruitingBoardV2,
} from './recruiting-operations/dashboard';
import type { RecruitingBoard, RecruitingBoardPositionRow } from './recruiting-operations/dashboard';

export {
  getBoardFirstInterviewCount,
  getBoardInterviewPassCondition,
  groupBoardRows,
} from './recruiting-operations/dashboard';
export type { RecruitingBoard, RecruitingBoardDivisionRow, RecruitingBoardPositionRow } from './recruiting-operations/dashboard';

interface Env {
  DB: D1Database;
  SECRET_KEY: string;
  AI_API_KEY: string;
  AI_BASE_URL: string;
  AI_MODEL?: string;
  AI_DAILY_TOKEN_LIMIT?: string;
  AI: Ai;
  FEISHU_APP_ID?: string;
  FEISHU_APP_SECRET?: string;
  FEISHU_BITABLE_APP_TOKEN?: string;
  FEISHU_REQUISITION_TABLE_ID?: string;
  FEISHU_POSITION_TABLE_ID?: string;
  FEISHU_TALENT_TABLE_ID?: string;
  FEISHU_OAUTH_REDIRECT_URI?: string;
  RESUMES_KV?: KVNamespace;
  CRON_SECRET?: string;
  RESUME_UPLOAD_API_KEY?: string; // 对外简历上传接口的 API Key（x-api-key header）
  RESUME_PROCESSING_QUEUE: Queue<{ jobId: string; resumeId: string }>;
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

async function getResumeFileBytes(
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
async function getCustomPrompt(env: Env, key: string): Promise<{ system: string; user: string } | null> {
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
async function getAIPrompt(env: Env, key: string, defaultPrompt: { system: string; user: string }): Promise<{ system: string; user: string }> {
  const custom = await getCustomPrompt(env, key);
  if (custom?.system && custom?.user) return { system: custom.system, user: custom.user };
  return defaultPrompt;
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

// 获取 LLM 配置：优先读取 system_configs 表（网站「AI 模型配置」页所存），fallback 到 Worker 环境变量
// 返回 { apiKey, baseUrl, model }，三项都尽量从系统配置取，缺失项才回退 env
async function getLLMConfig(env: Env): Promise<{ apiKey: string; baseUrl: string; model: string }> {
  let cfg: any = {};
  try {
    const row = await env.DB.prepare('SELECT llm_api_key, llm_base_url, llm_model FROM system_configs ORDER BY updated_at DESC LIMIT 1').first() as any;
    if (row) cfg = row;
  } catch (e) {
    console.error('[AI] getLLMConfig read failed:', e);
  }
  // 优先用户前端配置，其次环境变量（本地 dev），不配则走 Workers AI
  const apiKey = (cfg.llm_api_key && String(cfg.llm_api_key).trim()) || (env.AI_API_KEY && String(env.AI_API_KEY).trim()) || '';
  const baseUrl = normalizeBaseUrl(cfg.llm_base_url) || env.AI_BASE_URL || 'https://api.deepseek.com';
  const model = (cfg.llm_model && String(cfg.llm_model).trim()) || env.AI_MODEL || 'deepseek-v4-flash';
  return { apiKey, baseUrl, model };
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

export async function callAI(env: Env, systemPrompt: string, userPrompt: string, model?: string): Promise<string> {
  // 优先读取网站「AI 模型配置」页存的 system_configs，fallback 到 Worker 环境变量
  const llm = await getLLMConfig(env);
  if (llm.apiKey) {
    // —— 每日 token 限额检查（防止调试耗光额度）——
    await ensureAiUsageTable(env);
    const limit = getDailyTokenLimit(env);
    const usedToday = await getTodayTokenUsage(env);
    if (limit !== null && usedToday >= limit) {
      throw new Error(`AI 已达每日 token 限额（上限 ${limit}，今日已用 ${usedToday}）。为防止额度被耗光已暂停调用，请明日再试，或调高 AI_DAILY_TOKEN_LIMIT。`);
    }

    const baseUrl = llm.baseUrl.replace(/\/+$/, '');
    // 模型映射：deepseek-v4-flash 是内部别名，仅 DeepSeek 官方 API 需要映射为 deepseek-chat；
    // 其他网关（如公司代理 sublink.daojia-inc.com）按配置模型名原样使用
    let aiModel = llm.model || model || 'deepseek-chat';
    if (aiModel === 'deepseek-v4-flash' && baseUrl.includes('api.deepseek.com')) aiModel = 'deepseek-chat';
    // 503 自动重试（DeepSeek 繁忙时自动恢复，最多重试 3 次）
    const MAX_RETRIES = 3;
    const RETRY_DELAYS = [5_000, 15_000, 30_000];
    let lastError: Error | null = null;
    let resp: Response;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const delay = RETRY_DELAYS[attempt - 1];
        console.log(`[AI] 503 重试 ${attempt}/${MAX_RETRIES}，等待 ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
      }
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 90000);
      try {
        const url = baseUrl.endsWith('/v1') ? `${baseUrl}/chat/completions` : `${baseUrl}/v1/chat/completions`;
        resp = await fetch(url, {
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
            max_tokens: 4096,
          }),
          signal: controller.signal,
        });
      } catch (e: any) {
        clearTimeout(timeoutId);
        if (e.name === 'AbortError') throw new Error('AI API 调用超时（90s），请稍后重试');
        throw e;
      }
      clearTimeout(timeoutId);
      if (!resp.ok) {
        const errText = await resp.text();
        if (resp.status === 503 && attempt < MAX_RETRIES) {
          console.warn(`[AI] DeepSeek 503 繁忙，${MAX_RETRIES - attempt} 次重试机会: ${errText.slice(0, 100)}`);
          lastError = new Error(`DeepSeek API error ${resp.status}: ${errText}`);
          continue;
        }
        throw new Error(`DeepSeek API error ${resp.status}: ${errText}`);
      }
      break;  // 成功则跳出重试循环
    }
    if (lastError && !resp?.ok) {
      throw lastError;
    }
    const data: any = await resp.json();
    // —— 记录本次 token 用量 ——
    const totalTokens = data?.usage?.total_tokens || 0;
    if (totalTokens > 0) await addTokenUsage(env, totalTokens);
    if (data?.choices?.[0]?.message?.content) {
      return data.choices[0].message.content;
    }
    // deepseek-v4-flash 推理模型可能返回空 content，用 reasoning_content
    if (data?.choices?.[0]?.message?.reasoning_content) {
      return data.choices[0].message.reasoning_content;
    }
    throw new Error(`DeepSeek API response format unexpected: ${JSON.stringify(data)}`);
  }

  // 降级：Cloudflare Workers AI
  if (!env.AI) throw new Error('AI 未配置：请在系统设置中填写 API Key，或在 wrangler.toml 中启用 [ai] 绑定以使用 Cloudflare Workers AI（免费）');
  const aiModel = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
  async function runModel(name: string): Promise<string> {
    const result: any = await env.AI!.run(name, {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 4096,
    });
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
      'SELECT title, description, requirements, personalized_requirements, capability_dimensions FROM positions WHERE title = ? LIMIT 1'
    ).bind(mappedName).first() as any;
    if (!posRow) return null;
    let dimensions: any[] = [];
    try {
      const rawDims = typeof posRow.capability_dimensions === 'string'
        ? JSON.parse(posRow.capability_dimensions)
        : (posRow.capability_dimensions || []);
      dimensions = normalizeCapabilityDimensions(rawDims);
    } catch {}
    let hardRequirements: any[] = [];
    try {
      const requisition = await env.DB.prepare(
        'SELECT hard_requirements FROM job_requisitions WHERE title = ? LIMIT 1'
      ).bind(posRow.title).first() as any;
      if (requisition?.hard_requirements) {
        const parsed = typeof requisition.hard_requirements === 'string'
          ? JSON.parse(requisition.hard_requirements)
          : requisition.hard_requirements;
        hardRequirements = Array.isArray(parsed) ? parsed : [];
      }
    } catch {}
    return {
      positionTitle: posRow.title,
      description: posRow.description || '',
      requirements: posRow.requirements || '',
      personalized_requirements: posRow.personalized_requirements || '',
      capability_dimensions: dimensions,
      hard_requirements: hardRequirements,
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
      weight: Number(item?.weight) || 0,
      description: String(item?.description || item?.definition || '').trim(),
    };
  }).filter((item: CapabilityDimension) => item.name);
  if (!dimensions.length) return [];
  const configuredTotal = dimensions.reduce((sum, item) => sum + Math.max(0, item.weight), 0);
  if (configuredTotal <= 0) {
    const evenWeight = 100 / dimensions.length;
    return dimensions.map(item => ({ ...item, weight: evenWeight }));
  }
  return dimensions.map(item => ({ ...item, weight: Math.max(0, item.weight) / configuredTotal * 100 }));
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
) {
  const configured_dimensions = normalizeCapabilityDimensions(configuredDimensionInput);
  const configuredByName = new Map(configured_dimensions.map(item => [item.name, item]));
  const dimensions = Array.isArray(evaluation.dimensions) ? evaluation.dimensions.map((item: any) => ({
    ...item,
    weight: configuredByName.get(String(item?.name || ''))?.weight,
  })) : [];
  return {
    ...evaluation,
    dimensions,
    configured_dimensions,
    weighted_score: weightedScore(dimensions),
    hard_requirement_result: evaluateHardRequirements({ ...candidateFields, ...evaluation }, hardRequirements),
  };
}

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
- match_score: 人岗匹配度（0-100的整数）
- recommendation: 推荐建议（"strongly_recommend"/"recommend"/"neutral"/"not_recommend"/"strongly_not_recommend"）
- summary: 综合分析摘要（中文，2-3句话）
- suggested_questions: 建议面试问题（中文，3-5个）
- dimensions: 能力维度评分数组，每个包含 { name, score(0-5), reason }

第三部分 - 个性化需求匹配（如果岗位有个性化需求）：
- personalized_match_score: 个性化需求匹配度（0-100的整数）
- personalized_met_items: 已满足的个性化需求列表（数组）
- personalized_unmet_items: 未满足的个性化需求列表（数组）`;

  const userPrompt = [
    `简历文本（请提取完整信息）：\n${resumeText}`,
    positionSections,
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
  try { parsed = extractJSON(result); } catch { return { raw_response: result, match_score: 50, dimensions: [] }; }
  // Flatten nested structure
  const flattened: any = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      Object.assign(flattened, v);
    } else {
      flattened[k] = v;
    }
  }
  return enrichScreeningEvaluation(
    { ...parsed, ...flattened },
    positionReq?.capability_dimensions || [],
    positionReq?.hard_requirements || [],
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

function prepareValue(v: any): any {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}

function validCol(name: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
}

function uuid(): string {
  return crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
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
  skipped: Array<{ id: string; reason: 'not_found' | 'already_approved' }>;
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

      const update = await db.prepare("UPDATE resumes SET status = 'approved', stage = 'talent_pool', updated_at = ? WHERE id = ?")
        .bind(now(), id)
        .run();
      if (!update.meta.changes) {
        result.skipped.push({ id, reason: 'not_found' });
        continue;
      }

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
  const scope = 'im:message im:message.send_as_user contact:user.base:readonly offline_access';
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
  const scope = 'im:message im:message.send_as_user contact:user.base:readonly offline_access';
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
  const result = await c.env.DB.prepare("SELECT * FROM users WHERE lower(role) = 'interviewer' AND is_active = 1").all();
  return c.json(result.results.map(serializeUser));
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

app.get('/api/dashboard/snapshots', authMiddleware, async (c) => {
  const result = await c.env.DB.prepare(
    'SELECT id, snapshot_date, generated_at FROM dashboard_snapshots ORDER BY snapshot_date DESC',
  ).all();
  return c.json({ snapshots: result.results || [] });
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
type PublicShareScope = { owner: string | null; divisions: string[] };

function toPublicRecruitingBoard(board: Record<string, any>, scope: PublicShareScope): Record<string, unknown> {
  if (board.version === 'v2') return toPublicRecruitingBoardV2(board as RecruitingBoard, scope) as unknown as Record<string, unknown>;
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
  return {
    owner: ownerValue ? ownerValue.slice(HR_OWNER_SCOPE_PREFIX.length) || null : null,
    divisions: link.scope_type === 'divisions' ? values.filter((value) => !value.startsWith(HR_OWNER_SCOPE_PREFIX)) : [],
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
  const scopeIds = isAdmin
    ? (Array.isArray(body.scope_ids) ? body.scope_ids.filter((value: unknown): value is string => typeof value === 'string' && value.trim().length > 0) : [])
    : (user.full_name ? [`${HR_OWNER_SCOPE_PREFIX}${user.full_name}`] : []);
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
    async (scope) => loadLiveRecruitingBoard(c.env.DB, scope.owner),
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
    { key: 'skill_match', label: '技能匹配度', weight: 30 },
    { key: 'experience', label: '项目经验', weight: 25 },
    { key: 'education', label: '教育背景', weight: 10 },
    { key: 'communication', label: '沟通表达', weight: 15 },
    { key: 'stability', label: '职业稳定性', weight: 10 },
    { key: 'potential', label: '发展潜力', weight: 10 },
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
    const result = await callAI(c.env, systemPrompt, userPrompt, 'deepseek-v4-flash');
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
    screening_result: getFirstValue(f['AI简历初筛结果']) || '',
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
  const createdAt = row?.created_at ? Date.parse(String(row.created_at)) : NaN;
  const item: Record<string, any> = {
    id: row?.id || '',
    candidate_name: first(row?.candidate_name, parsed.name, parsed.candidate_name),
    position_applied: first(row?.position_applied, parsed.position_applied),
    mapped_position: first(row?.mapped_position, parsed.mapped_position, parsed.standard_position),
    gender: first(row?.gender, parsed.gender),
    city: first(row?.city, parsed.city),
    age: first(row?.age, parsed.age),
    education: first(row?.education, parsed.highest_degree, parsed.education),
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
export async function getPositionContext(db: any, positionName: string): Promise<{
  standardPosition: string;
  capabilityDimensions: string;
  personalizedRequirements: string;
  salaryRange: string;
}> {
  const result = { standardPosition: positionName, capabilityDimensions: '', personalizedRequirements: '', salaryRange: '' };
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
      'SELECT capability_dimensions, salary_range FROM positions WHERE title = ? LIMIT 1'
    ).bind(lookupName).first();
    if (pos) {
      if (pos.capability_dimensions) {
        let dims = pos.capability_dimensions;
        try { dims = JSON.parse(dims); if (Array.isArray(dims)) dims = dims.map((d: any) => typeof d === 'object' ? (d.name || d.title || '') : String(d)).join('、'); } catch {}
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
      try { dims = JSON.parse(dims); if (Array.isArray(dims)) dims = dims.map((d: any) => typeof d === 'object' ? (d.name || d.title || '') : String(d)).join('、'); } catch {}
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
  if (r.includes('通过')) return 85;
  if (r.includes('淘汰')) return 30;
  if (r.includes('存疑')) return 67;
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
  const map = new Map<string, string>();
  const mappings = await db.prepare('SELECT raw_name, mapped_name FROM position_mappings').all();
  (mappings.results || []).forEach((r: any) => {
    if (r.raw_name && r.mapped_name) map.set(r.raw_name, r.mapped_name);
  });
  return map;
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
    secondary_interviewer: getUserName(f['HR二面']) || '何雨菱',
    start_date: f['开始招聘'] || null,
    end_date: f['结束招聘'] || null,
    employment_type: 'full_time',
    salary_range: getFirstValue(f['薪资范围']) || getFirstValue(f['薪酬']) || getFirstValue(f['薪资']) || getFirstValue(f['薪资预算']) || getFirstValue(f['薪酬范围']) || '',
    budget: f['预算'] || f['招聘预算'] || f['人力预算'] || f['HC预算'] || null,
    expected_date: f['期望到岗'] || f['到岗日期'] || f['期望到岗日期'] || f['期望入职日期'] || f['到岗时间'] || f['开始招聘'] || null,
    feishu_record_id: record.record_id,
  };
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
      items: results.map((row: any) => ({
        ...transformRow(row),
        resume: { candidate_name: row._candidate_name || row.interviewer || '未知' },
        position: { title: row._position_title || row.position_id || '未知岗位' }
      })),
      total, page, pageSize,
    });
  }

  const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
  // 把 _candidate_name 和 _position_title 嵌入到嵌套对象，保持前端现有列定义兼容
  return c.json(results.map((row: any) => ({
    ...transformRow(row),
    resume: { candidate_name: row._candidate_name || row.interviewer || '未知' },
    position: { title: row._position_title || row.position_id || '未知岗位' }
  })));
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
    
    // 解析飞书数据，按招聘岗位去重
    const synced = new Set<string>();
    let created = 0;
    let updated = 0;
    let skipped = 0;
    
    for (const rec of records) {
      const parsed = parseRequisitionRecord(rec);
      const title = parsed.title;
      if (!title || title === '(未命名岗位)' || synced.has(title)) {
        skipped++;
        continue;
      }
      synced.add(title);
      
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

// ==================== 飞书多维表格 CRUD（替代 D1 CRUD） ====================

// ---- 需求管理：直读飞书招聘任务表 ----
app.get('/api/requisitions', authMiddleware, async (c) => {
  try {
    const tableId = getBitableTableId(c.env, 'requisition');
    const records = await bitableListRecords(c.env, tableId);
    const items = records.map(parseRequisitionRecord);

    // v2.0: 从 D1 增强数据（多城市、硬性要求、个性化需求）
    try {
      const d1Reqs = await c.env.DB.prepare(
        'SELECT id, feishu_record_id, city, hard_requirements, personalized_requirements, hr_interviewer, biz_interviewer, final_interviewer, responsible_person, created_at, description, requirements, salary_range, budget, expected_date FROM job_requisitions'
      ).all();
      const d1Map = new Map();
      for (const row of (d1Reqs.results || [])) {
        d1Map.set(row.feishu_record_id || row.id, row);
      }
      for (const item of items) {
        const d1 = d1Map.get(item.id) || d1Map.get(item.feishu_record_id);
        if (d1) {
          try { item.city = JSON.parse(d1.city || '[]'); } catch { item.city = item.city ? [item.city] : []; }
          try { item.hard_requirements = JSON.parse(d1.hard_requirements || '[]'); } catch { item.hard_requirements = []; }
          try { item.personalized_requirements = JSON.parse(d1.personalized_requirements || '{}'); } catch { item.personalized_requirements = {}; }
          if (!item.responsible_person && d1.responsible_person) item.responsible_person = d1.responsible_person;
          if (!item.hr_interviewer && d1.hr_interviewer) item.hr_interviewer = d1.hr_interviewer;
          if (!item.biz_interviewer && d1.biz_interviewer) item.biz_interviewer = d1.biz_interviewer;
          if (!item.final_interviewer && d1.final_interviewer) item.final_interviewer = d1.final_interviewer;
          item.created_at = d1.created_at || item.created_at || '';
          if (d1.description) item.description = d1.description;
          if (d1.requirements) item.requirements = d1.requirements;
          if (d1.salary_range && !item.salary_range) item.salary_range = d1.salary_range;
          if (d1.budget != null && !item.budget) item.budget = d1.budget;
          if (d1.expected_date && !item.expected_date) item.expected_date = d1.expected_date;
        } else {
          item.city = item.city ? [item.city] : [];
          item.hard_requirements = [];
          item.personalized_requirements = {};
        }
      }
    } catch {
      // D1 增强失败不影响主流程
      for (const item of items) {
        item.city = item.city ? [item.city] : [];
        item.hard_requirements = [];
        item.personalized_requirements = {};
      }
    }

    // 支持 status / department 筛选
    const statusFilter = c.req.query('status');
    const deptFilter = c.req.query('department');
    let filtered = items;
    if (statusFilter) filtered = filtered.filter(i => i.status === statusFilter);
    if (deptFilter) filtered = filtered.filter(i => i.department?.includes(deptFilter));

    // 支持按负责人筛选（全局筛选器，admin 也可用）
    const ownerFilter = c.req.query('responsible_person');
    if (ownerFilter) filtered = filtered.filter(i => i.responsible_person === ownerFilter);

    // 非管理员：只显示自己是责任人的需求
    const currentUser = c.get('user');
    if (currentUser?.role !== 'admin' && currentUser?.full_name) {
      filtered = filtered.filter(i => i.responsible_person === currentUser.full_name);
    }

    return c.json(filtered);
  } catch (e: any) {
    console.error(`[Bitable] 需求列表失败: ${e.message}`);
    return c.json({ detail: '读取飞书数据失败: ' + e.message }, 500);
  }
});

app.get('/api/requisitions/:id', authMiddleware, async (c) => {
  try {
    const tableId = getBitableTableId(c.env, 'requisition');
    const record = await bitableGetRecord(c.env, tableId, c.req.param('id'));
    if (!record) return c.json({ detail: 'Not found' }, 404);
    const item = parseRequisitionRecord(record);

    // v2.0: D1 增强
    try {
      const d1 = await c.env.DB.prepare(
        'SELECT city, hard_requirements, personalized_requirements, hr_interviewer, biz_interviewer, final_interviewer, responsible_person, description, requirements FROM job_requisitions WHERE id = ? OR feishu_record_id = ?'
      ).bind(c.req.param('id'), c.req.param('id')).first() as any;
      if (d1) {
        try { item.city = JSON.parse(d1.city || '[]'); } catch { item.city = item.city ? [item.city] : []; }
        try { item.hard_requirements = JSON.parse(d1.hard_requirements || '[]'); } catch { item.hard_requirements = []; }
        try { item.personalized_requirements = JSON.parse(d1.personalized_requirements || '{}'); } catch { item.personalized_requirements = {}; }
        if (!item.responsible_person && d1.responsible_person) item.responsible_person = d1.responsible_person;
        if (!item.hr_interviewer && d1.hr_interviewer) item.hr_interviewer = d1.hr_interviewer;
        if (!item.biz_interviewer && d1.biz_interviewer) item.biz_interviewer = d1.biz_interviewer;
        if (!item.final_interviewer && d1.final_interviewer) item.final_interviewer = d1.final_interviewer;
        if (d1.description) item.description = d1.description;
        if (d1.requirements) item.requirements = d1.requirements;
      } else {
        item.city = item.city ? [item.city] : [];
        item.hard_requirements = [];
        item.personalized_requirements = {};
      }
    } catch {
      item.city = item.city ? [item.city] : [];
      item.hard_requirements = [];
      item.personalized_requirements = {};
    }

    return c.json(item);
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
    const tableId = getBitableTableId(c.env, 'requisition');
    // 标准化：city 数组转字符串；urgency 若格式不对则跳过（Bitable 可能为数字字段）
    const normalized = { ...body };
    if (Array.isArray(normalized.city)) normalized.city = normalized.city.join(', ');
    // 只保留 Bitable 可接受的字段
    const fields: Record<string, any> = {};
    for (const [engKey, cnKey] of Object.entries(FEISHU_REQUISITION_FIELDS)) {
      const v = normalized[engKey];
      if (v === undefined || v === null) continue;
      if (engKey === 'urgency' && typeof v === 'string' && isNaN(Number(v))) continue; // 非数字跳过
      fields[cnKey] = v;
    }

    // v2.1: D1 优先落库，飞书同步失败不阻断主流程
    const d1Id = uuid();
    let feishuRecordId = '';
    let feishuSynced = false;
    try {
      feishuRecordId = await bitableCreateRecord(c.env, tableId, fields);
      feishuSynced = !!feishuRecordId;
      if (!feishuRecordId) console.warn(`[Requisition] 飞书创建记录失败，但 D1 将保存`);
    } catch (fe: any) {
      console.warn(`[Requisition] 飞书创建记录异常: ${fe.message}`);
    }

    await c.env.DB.prepare(
      `INSERT INTO job_requisitions (id, title, department, status, description, requirements, city, hard_requirements, personalized_requirements, hr_interviewer, biz_interviewer, final_interviewer, responsible_person, feishu_record_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      d1Id, body.title || '', body.department || '', 'draft',
      body.description || '', body.requirements || '',
      JSON.stringify(body.city || []), JSON.stringify(body.hard_requirements || []), JSON.stringify(body.personalized_requirements || {}),
      body.hr_interviewer || '', body.biz_interviewer || '', body.final_interviewer || '',
      body.responsible_person || '', feishuRecordId || '', now()
    ).run();

    // 返回以 D1 数据为准
    const row = await c.env.DB.prepare(
      'SELECT * FROM job_requisitions WHERE id = ?'
    ).bind(d1Id).first() as any;
    const item = transformRow(row) as any;
    if (body.city !== undefined) item.city = body.city;
    if (body.hard_requirements !== undefined) item.hard_requirements = body.hard_requirements;
    if (body.personalized_requirements !== undefined) item.personalized_requirements = body.personalized_requirements;
    if (body.description !== undefined) item.description = body.description;
    if (body.requirements !== undefined) item.requirements = body.requirements;
    item.feishu_synced = feishuSynced;
    return c.json(item);
  } catch (e: any) {
    return c.json({ detail: '创建需求失败: ' + e.message }, 500);
  }
});

app.put('/api/requisitions/:id', authMiddleware, async (c) => {
  try {
    const body = await c.req.json();
    const id = c.req.param('id');
    const tableId = getBitableTableId(c.env, 'requisition');
    // 标准化：同 POST 逻辑
    if (Array.isArray(body.city)) body.city = body.city.join(', ');
    const fields: Record<string, any> = {};
    for (const [engKey, cnKey] of Object.entries(FEISHU_REQUISITION_FIELDS)) {
      const v = body[engKey];
      if (v === undefined || v === null) continue;
      if (engKey === 'urgency' && typeof v === 'string' && isNaN(Number(v))) continue;
      if (engKey === 'requirements') continue; // Bitable不支持此字段，只存D1
      fields[cnKey] = v;
    }

    // v2.0: D1 本地存储优先 —— 保证即使飞书同步失败，数据也不丢失
    const sets: string[] = [];
    const vals: any[] = [];
    if (body.city !== undefined) { sets.push('city = ?'); vals.push(JSON.stringify(body.city)); }
    if (body.hard_requirements !== undefined) { sets.push('hard_requirements = ?'); vals.push(JSON.stringify(body.hard_requirements)); }
    if (body.personalized_requirements !== undefined) { sets.push('personalized_requirements = ?'); vals.push(JSON.stringify(body.personalized_requirements)); }
    if (body.hr_interviewer !== undefined) { sets.push('hr_interviewer = ?'); vals.push(body.hr_interviewer); }
    if (body.biz_interviewer !== undefined) { sets.push('biz_interviewer = ?'); vals.push(body.biz_interviewer); }
    if (body.final_interviewer !== undefined) { sets.push('final_interviewer = ?'); vals.push(body.final_interviewer); }
    if (body.responsible_person !== undefined) { sets.push('responsible_person = ?'); vals.push(body.responsible_person); }
    if (body.title !== undefined) { sets.push('title = ?'); vals.push(body.title); }
    if (body.department !== undefined) { sets.push('department = ?'); vals.push(body.department); }
    if (body.status !== undefined) { sets.push('status = ?'); vals.push(body.status); }
    if (body.description !== undefined) { sets.push('description = ?'); vals.push(body.description); }
    if (body.requirements !== undefined) { sets.push('requirements = ?'); vals.push(body.requirements); }

    if (sets.length > 0) {
      await c.env.DB.prepare(
        `UPDATE job_requisitions SET ${sets.join(', ')}, updated_at = ? WHERE id = ? OR feishu_record_id = ?`
      ).bind(...vals, now(), id, id).run();
    }

    // 飞书多维表格同步 —— 失败仅告警，不阻断主流程（D1 已落库）
    let feishuSynced = false;
    try {
      if (Object.keys(fields).length > 0) {
        const ok = await bitableUpdateRecord(c.env, tableId, id, fields);
        feishuSynced = !!ok;
        if (!ok) console.warn(`[Requisition] 飞书同步失败 id=${id}，但 D1 已保存`);
      } else {
        feishuSynced = true;
      }
    } catch (fe: any) {
      console.warn(`[Requisition] 飞书同步异常 id=${id}: ${fe.message}`);
    }

    // 返回以 D1 数据为准
    const row = await c.env.DB.prepare(
      'SELECT * FROM job_requisitions WHERE id = ? OR feishu_record_id = ?'
    ).bind(id, id).first() as any;
    const item = transformRow(row) as any;
    if (body.city !== undefined) item.city = body.city;
    if (body.hard_requirements !== undefined) item.hard_requirements = body.hard_requirements;
    if (body.personalized_requirements !== undefined) item.personalized_requirements = body.personalized_requirements;
    if (body.description !== undefined) item.description = body.description;
    if (body.requirements !== undefined) item.requirements = body.requirements;
    item.feishu_synced = feishuSynced;
    return c.json(item);
  } catch (e: any) {
    return c.json({ detail: '更新失败: ' + e.message }, 500);
  }
});

app.delete('/api/requisitions/:id', authMiddleware, async (c) => {
  try {
    const tableId = getBitableTableId(c.env, 'requisition');
    await bitableDeleteRecord(c.env, tableId, c.req.param('id'));
    return c.json({ detail: 'Deleted' });
  } catch (e: any) {
    return c.json({ detail: '删除失败: ' + e.message }, 500);
  }
});

// ---- 人才库：直读飞书人才库表 ----
app.get('/api/talent-pool', authMiddleware, async (c) => {
  try {
    const tableId = getBitableTableId(c.env, 'talent');
    const records = await bitableListRecords(c.env, tableId);
    const feishuItems = records.map(parseTalentRecord);
    let d1Rows: any[] = [];
    try {
      // Only approved D1 resumes belong in the talent-pool projection. This
      // preserves the legacy endpoint's behavior of hiding pending uploads.
      const result = await c.env.DB.prepare("SELECT * FROM resumes WHERE status = 'approved'").all();
      d1Rows = result.results || [];
    } catch (error: any) {
      // Keep the legacy Feishu-only view available if an older D1 schema is
      // temporarily unavailable during rollout.
      console.error(`[TalentPool] D1 projection unavailable: ${error?.message || error}`);
    }
    let items = mergeTalentPoolItems(feishuItems, d1Rows);

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

export function resolveInterviewAssignments(body: any, position: any): {
  interviewer: string;
  primaryInterviewer: string;
  secondaryInterviewer: string;
} {
  const clean = (value: any) => value === undefined || value === null ? '' : String(value).trim();
  const primaryInterviewer = clean(body?.interviewer_name || body?.primary_interviewer || position?.primary_interviewer);
  const secondaryInterviewer = clean(body?.secondary_interviewer || position?.secondary_interviewer);
  return {
    interviewer: primaryInterviewer || '待分配',
    primaryInterviewer,
    secondaryInterviewer,
  };
}

// 从人才库创建面试（人才库"面试"按钮调用）
app.post('/api/interviews/create-from-talent', authMiddleware, async (c) => {
  try {
    const body = await c.req.json();
    const { candidate_name, position_applied, city, feishu_record_id, interviewer_name, secondary_interviewer } = body;
    const currentUser = c.get('user');

    if (!candidate_name) {
      return c.json({ detail: '缺少候选人信息' }, 400);
    }

    // 如果前端传了面试官名字，优先使用
    let interviewerOpenIds: string[] = [];
    let interviewerNames: string[] = [];
    let matchedReqRecordId: string | null = null;
    let matchedReqTitle: string = '';

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
      // 业务一面是用户类型字段，尝试提取 open_id 和 name
      const rawBiz = mf['业务一面'];
      const bizUsers = extractFeishuUsers(rawBiz);
      for (const u of bizUsers) {
        if (u.open_id && !interviewerOpenIds.includes(u.open_id)) {
          interviewerOpenIds.push(u.open_id);
          interviewerNames.push(u.name || '面试官');
        }
      }
      // 如果 extractFeishuUsers 没提取到（可能是纯文本格式），用 getUserName 兜底
      if (bizUsers.length === 0) {
        const bizName = getUserName(rawBiz);
        if (bizName) interviewerNames.push(bizName);
        const openId = await getInterviewerOpenId(c.env, bizName);
        if (openId && !interviewerOpenIds.includes(openId)) {
          interviewerOpenIds.push(openId);
        }
      }
    }

    // 查找该任务下"业务复核=通过 + 一面建议为空"的候选人
    let pendingCandidates: string[] = [];
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

    // 从 positions 表同步面试官信息（一面/二面）
    // 只在用户没有手动指定面试官时补充
    let positionInterviewers: any = null;
    if (!interviewer_name && position_applied) {
      try {
        positionInterviewers = await c.env.DB.prepare(
          "SELECT primary_interviewer, secondary_interviewer FROM positions WHERE title = ? LIMIT 1"
        ).bind(position_applied).first() as any;
      } catch {}
    }
    const assignment = resolveInterviewAssignments({ interviewer_name, secondary_interviewer }, positionInterviewers);
    const interviewerStr = interviewerNames.length > 0 ? interviewerNames.join(', ') : assignment.interviewer;

    await c.env.DB.prepare(
      `INSERT INTO interviews (id, resume_id, interviewer, position_id, status, created_at, comments, primary_interviewer, secondary_interviewer)
       VALUES (?, ?, ?, ?, 'scheduled', datetime('now'), ?, ?, ?)`
    ).bind(interviewId, feishu_record_id || '', candidate_name, position_applied || '', interviewerStr, assignment.primaryInterviewer, assignment.secondaryInterviewer).run();

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
            { tag: 'div', text: { tag: 'lark_md', content: `${operatorName} 为你安排了面试，请及时查看候选人简历，面试结束后在系统内填写评价。` } },
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
      position: { title: position_applied || '未知岗位' },
      interviewer_list: interviewerNames,
      _notification: notificationResults,
    });
  } catch (e: any) {
    return c.json({ detail: '创建面试失败: ' + e.message }, 500);
  }
});

// ---- 简历上传：上传 PDF → D1 存储 → 存 Bitable ----
app.post('/api/resumes', authMiddleware, async (c) => {
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

    // 2. 保存 PDF：优先 KV（大文件），D1 只留元数据
    try {
      await storeResumeFile(c.env, recordId, file.name, fileSize, fileBuffer);
    } catch (e: any) {
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
          'INSERT INTO resumes (id, candidate_name, position_applied, mapped_position, parsed_data, raw_text, parse_status, ocr_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(
          recordId,
          displayName,
          parsedPositionName || '',
          parsedPositionName || '',
          JSON.stringify({ name: displayName }),
          '',
          'ocr_processing',
          'ocr_processing',
          now()
        ).run();
      } catch (dbErr: any) {
        console.error('[Upload] OCR pending D1 写入失败:', dbErr.message);
      }
      const job = await createOrGetActiveJob(c.env.DB, recordId);
      await c.env.RESUME_PROCESSING_QUEUE.send({ jobId: job.id, resumeId: recordId });
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
          'UPDATE resumes SET candidate_name=?, position_applied=?, mapped_position=?, raw_text=?, parse_status=?, updated_at=? WHERE id=?'
        ).bind(displayName, mappedPos, mappedPos, extractedText?.substring(0, 200000) || '', 'pending_screening', now(), recordId).run();
      } else {
        await c.env.DB.prepare(
          'INSERT INTO resumes (id, candidate_name, position_applied, mapped_position, parsed_data, raw_text, parse_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(recordId, displayName, mappedPos, mappedPos, JSON.stringify({ name: displayName }), extractedText?.substring(0, 200000) || '', 'pending_screening', now()).run();
      }
    } catch (dbErr: any) {
      console.error('[Upload] D1 写入失败:', dbErr.message);
    }

    // 后台队列是 AI/OCR 的唯一执行入口。前端关闭、刷新或网络波动都不会中断。
    const job = await createOrGetActiveJob(c.env.DB, recordId);
    await c.env.RESUME_PROCESSING_QUEUE.send({ jobId: job.id, resumeId: recordId });
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
          const prompt = await getAIPrompt(c.env, 'analyze_resume', {
            system: '你是一位资深的 HR 招聘评估 AI。请按岗位能力维度逐条 0-5 打分，用中文返回 JSON：{match_score:0-100,recommendation,summary,strengths:[],risks:[],suggested_questions:[],dimensions:[{name,score,reason}]}。',
            user: '【岗位】' + (posCtx.standardPosition || posName) + '\n' + (posCtx.capabilityDimensions ? '【能力维度】' + posCtx.capabilityDimensions + '\n' : '') + '\n【简历全文】\n' + resumeText,
          });
          const aiResp = await callAI(c.env, prompt.system, prompt.user, 'deepseek-v4-flash');
          if (aiResp) {
            let parsed: any;
            try { parsed = extractJSON(aiResp); } catch { parsed = { summary: aiResp }; }
            const matchScore = parsed.match_score ?? 50;
            const screeningResult = matchScore >= 75 ? '通过' : matchScore >= 60 ? '存疑' : '淘汰';
            const aiEvalObj: any = { summary: parsed.summary || '', match_score: matchScore, recommendation: parsed.recommendation || '' };
            if (Array.isArray(parsed.dimensions)) {
              aiEvalObj.dimensions = parsed.dimensions.map((d: any) => ({ name: d.name || '', score: d.score ?? 0, reason: d.reason || '' }));
            }
            const aiReview = JSON.stringify({ summary: parsed.summary || '', match_score: matchScore, recommendation: parsed.recommendation || '', strengths: parsed.strengths || [], risks: parsed.risks || [], suggested_questions: parsed.suggested_questions || [], dimensions: aiEvalObj.dimensions || [] });
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

    if (!file || !file.name) {
      return c.json({ detail: '请上传简历文件（file 字段）' }, 400);
    }
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      return c.json({ detail: '仅支持 PDF 格式' }, 400);
    }

    const fileBuffer = await file.arrayBuffer();
    const recordId = crypto.randomUUID();

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
        'INSERT INTO resumes (id, candidate_name, position_applied, mapped_position, parsed_data, raw_text, ocr_markdown, parse_status, ocr_status, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
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
    const aiResp = await callAI(c.env, systemPrompt, userPrompt, 'deepseek-v4-flash');
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

app.get('/api/resumes', authMiddleware, async (c) => {
  try {
    // Feature Flag: 开启 SQL 分页查询时走优化路径，不 select 长文本列
    const sqlListEnabled = (c.env.RESUME_SQL_LIST || '').toLowerCase() === 'true';
    if (sqlListEnabled) {
      return await handleOptimizedResumeList(c);
    }
    await ensureResumeListSchema(c.env.DB);
    // 纯 D1 驱动：直接从 resumes 表读取，不依赖飞书
    const d1Rows = await c.env.DB.prepare(
      'SELECT id, candidate_name, email, contact, position_applied, mapped_position, status, stage, match_score, ai_review, ai_evaluation, screening_result, parsed_data, parse_status, raw_text, resume_markdown, ocr_markdown, ocr_status, hr_review, gender, birthday, education, work_experience, certifications, self_evaluation, hard_requirement_result, capability_scores, three_layer_match, feishu_file_token, mineru_task_id, mineru_status, datetime(created_at) as created_at, datetime(updated_at) as updated_at FROM resumes ORDER BY updated_at DESC'
    ).all();
    let items = (d1Rows.results || []).map((r: any) => {
      const item: any = { ...r };
      // 字段别名映射（前端期望的字段名）
      if (r.contact) item.phone = r.contact; // contact → phone
      if (r.birthday) { // birthday → age
        try { const b = new Date(r.birthday); const diff = Date.now() - b.getTime(); item.age = Math.floor(diff / (365.25 * 24 * 3600 * 1000)); } catch {}
      }
      if (r.ai_review) { try { item.ai_review = JSON.parse(r.ai_review); } catch { item.ai_review = r.ai_review; } }
      if (r.ai_evaluation) { try { item.ai_evaluation = JSON.parse(r.ai_evaluation); } catch {} }
      if (r.parsed_data) { try { item.parsed_data = JSON.parse(r.parsed_data); } catch {} }
      if (r.capability_scores) { try { item.capability_scores = JSON.parse(r.capability_scores); } catch {} }
      if (r.hard_requirement_result) { try { item.hard_requirement_result = JSON.parse(r.hard_requirement_result); } catch {} }
      if (r.screening_result) {
        const sr = r.screening_result;
        item.screening_label = sr.includes('通过') ? '通过' : sr.includes('淘汰') ? '淘汰' : sr.includes('存疑') ? '存疑' : sr;
      }
      // 从 parsed_data 提取前端需要的字段
      applyParsedResumeFields(item);
      return item;
    });

    const nameFilter = c.req.query('candidate_name');
    const statusFilter = c.req.query('status');
    let filtered = items;
    if (nameFilter) filtered = filtered.filter(i => i.candidate_name?.includes(nameFilter));
    if (statusFilter) filtered = filtered.filter(i => i.status === statusFilter);

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
    const posMap = new Map<string, string>();
    try {
      const mps = await c.env.DB.prepare('SELECT raw_name, raw_names, mapped_name FROM position_mappings').all();
      for (const r of (mps.results || []) as any[]) {
        if (r.raw_name && r.mapped_name) posMap.set(r.raw_name, r.mapped_name);
        if (r.raw_names) {
          try {
            for (const rn of JSON.parse(r.raw_names)) posMap.set(rn, r.mapped_name);
          } catch {}
        }
      }
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

      const positionName = posMap.get(item.position_applied) || item.mapped_position || item.position_applied || '';
      const mappedPos = item.mapped_position || item.position_applied || '';
      const id = item.id; // = 飞书 record_id，保证幂等
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
          `UPDATE resumes SET candidate_name=?, email=?, position_applied=?, mapped_position=?, match_score=?, screening_result=?, ai_review=?, hr_review=?, status=?, stage=?, parsed_data=?, parse_status=? WHERE id=?`
        ).bind(
          item.candidate_name || '', item.email || '', item.position_applied || '', mappedPos,
          item.match_score ?? null,
          screening, item.ai_evaluation || '', hr, status, stage,
          JSON.stringify(mergedParsedData),
          parseStatus,
          id
        ).run();
        updated++;
      } else {
        await c.env.DB.prepare(
          `INSERT INTO resumes (id, candidate_name, email, position_applied, mapped_position, match_score, screening_result, ai_review, hr_review, status, stage, parsed_data, parse_status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?, ?, ?)`
        ).bind(
          id, item.candidate_name || '', item.email || '', item.position_applied || '', mappedPos, item.match_score ?? null,
          screening, item.ai_evaluation || '', hr, status, stage,
          JSON.stringify(mergedParsedData),
          parseStatus,
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
          const aiResp = await callAI(c.env, systemPrompt, userPrompt, 'deepseek-v4-flash');
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
          parseResp = await callAI(c.env, parseSysPrompt, resumeText, 'deepseek-chat');
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
        const prompt = await getAIPrompt(c.env, 'analyze_resume', {
          system: `你是一位资深的 HR 招聘评估 AI。请基于「候选人结构化信息 + 简历全文 + 岗位要求 + 能力维度 + 个性化要求」进行综合评估，用中文返回 JSON 对象：

- match_score: 人岗匹配度整数 0-100
- recommendation: 推荐建议，取值 "strongly_recommend" / "recommend" / "neutral" / "not_recommend" / "strongly_not_recommend"
- summary: 候选人综合摘要（中文，2-3 句）
- strengths: 3-5 个核心优势（中文数组）
- risks: 2-4 个潜在风险（中文数组）
- suggested_questions: 3-5 个建议面试问题（中文数组）
- dimensions: 能力维度评分明细数组，必须依据岗位给出的「能力维度」逐条打分。每个元素格式：
  { "name": "维度名称（与岗位能力维度保持一致）", "score": 0-5 的整数, "reason": "打分依据（中文，1-2 句）" }
  若岗位未提供能力维度，则基于岗位通用要求自行归纳 3-5 个关键维度打分。`,
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

        const result = await callAI(c.env, prompt.system, userPrompt, 'deepseek-v4-flash');
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

        const matchScore = enrichedEvaluation.match_score ?? 50;
        const screeningResult = matchScore >= 75 ? '通过' : matchScore >= 60 ? '存疑' : '淘汰';

        // ai_evaluation 与 ai-screen 路由格式一致
        const aiEvalObj: any = { summary: enrichedEvaluation.summary || '', match_score: matchScore, weighted_score: enrichedEvaluation.weighted_score, configured_dimensions: enrichedEvaluation.configured_dimensions, recommendation: enrichedEvaluation.recommendation || '', dimensions: enrichedEvaluation.dimensions || [] };
        const aiReviewText = JSON.stringify({
          summary: enrichedEvaluation.summary || '', match_score: matchScore, recommendation: enrichedEvaluation.recommendation || '',
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
            'AI简历评估': JSON.stringify({ summary: parsed.summary || '', match_score: matchScore, recommendation: parsed.recommendation || '', dimensions: aiEvalObj.dimensions || [] }),
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
      applyParsedResumeFields(item);
      try {
        const map = await buildPositionMapping(c.env.DB);
        item.standard_position = map.get(item.position_applied) || item.position_applied || item.mapped_position || '';
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
      if (item.position_applied && map.has(item.position_applied)) {
        item.standard_position = map.get(item.position_applied);
      } else {
        item.standard_position = item.position_applied || '';
      }
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
    return c.json(item);
  } catch (e: any) {
    return c.json({ detail: e.message }, 500);
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

    // v2.0: 30天预览限制
    const isDownload = c.req.query('download') === 'true';
    if (!isDownload) {
      try {
      const resumeInfo = await c.env.DB.prepare('SELECT uploaded_at, feishu_file_token FROM resumes WHERE id = ?').bind(c.req.param('id')).first() as any;
      if (resumeInfo?.uploaded_at) {
        const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
        if (new Date(resumeInfo.uploaded_at).getTime() < thirtyDaysAgo) {
          return c.json({ detail: '简历文件预览已过期（超出30天）。请联系管理员通过飞书云盘查看原始文件。', expired: true }, 410);
        }
      }
      } catch { /* uploaded_at 列可能不存在 */ }
    }

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

    // 2. 飞书 Bitable 获取附件（仅当本地缓存未命中时）
    const tableId = getBitableTableId(c.env, 'talent');
    const record = await bitableGetRecord(c.env, tableId, c.req.param('id'));
    if (!record) return c.json({ detail: 'Not found' }, 404);
    const f = record.fields || {};
    
    // 提取候选人姓名和文件名
    let candidateName = f['姓名'] || 'resume';
    let attachmentFileName = candidateName + '.pdf';

    // 从 record.fields 中找附件数据
    let fileToken = '', feishuDownloadUrl = '';
    for (const [, fieldValue] of Object.entries(f)) {
      if (Array.isArray(fieldValue) && fieldValue.length > 0) {
        const item = fieldValue[0];
        if (item && typeof item === 'object') {
          if (item.url || item.download_url || item.tmp_url) {
            feishuDownloadUrl = item.url || item.download_url || item.tmp_url;
            if (item.name) attachmentFileName = item.name;
            if (item.file_token) fileToken = item.file_token;
            break;
          }
          if (item.file_token) { fileToken = item.file_token; if (item.name) attachmentFileName = item.name; }
        }
      }
    }
    if (!feishuDownloadUrl && fileToken) {
      const parsed = parseTalentRecord(record);
      if (parsed.resume_file?.download_url) feishuDownloadUrl = parsed.resume_file.download_url;
    }

    // 3. 用 feishuDownloadUrl 直接下载（带 bitablePerm 的 Drive URL，无需额外权限）
    if (feishuDownloadUrl) {
      try {
        const feishuToken = await getFeishuToken(c.env);
        const dlResp = await fetch(feishuDownloadUrl, {
          headers: { Authorization: `Bearer ${feishuToken}` },
          redirect: 'follow',
        });
        if (dlResp.ok) {
          const ct = dlResp.headers.get('Content-Type') || 'application/pdf';
          try {
            const arrBuf = await dlResp.clone().arrayBuffer();
            await c.env.DB.prepare('CREATE TABLE IF NOT EXISTS resume_files (id TEXT PRIMARY KEY, content TEXT, file_name TEXT, created_at TEXT)').run();
            await storeResumeFile(c.env, recordId, attachmentFileName, arrBuf.byteLength, arrBuf);
          } catch {}
          const disposition = isDownload ? 'attachment' : 'inline';
          return new Response(dlResp.body, { status: 200, headers: {
            'Content-Type': ct,
            'Content-Disposition': `${disposition}; filename="${attachmentFileName}"`,
            'Access-Control-Allow-Origin': getAllowedOrigin(c.req.header('origin')) || '',
          }});
        }
      } catch (e) { console.log(`[ResumeFile] 下载失败: ${e}`); }
    }

    // 最终兜底：返回引导页面（含飞书链接让用户手动打开）
    const fallbackLink = feishuDownloadUrl || (fileToken ? `https://ywwlaii6ga7.feishu.cn/space/api/box/stream/download/all/${fileToken}?mount_point=bitable` : '#');
    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
  .card{background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.08);padding:48px 40px;text-align:center;max-width:400px}
  .icon{font-size:48px;margin-bottom:16px}
  h2{font-size:18px;color:#0f172a;margin-bottom:8px}
  p{font-size:14px;color:#64748b;margin-bottom:24px;line-height:1.6}
  a{display:inline-block;padding:10px 28px;background:#6366f1;color:#fff;border-radius:8px;text-decoration:none;font-size:14px;font-weight:500;transition:background .2s}
  a:hover{background:#4f46e5}
</style></head>
<body>
<div class="card">
  <div class="icon">📄</div>
  <h2>无法在线预览 [V2]</h2>
  <p>该简历文件托管在飞书平台，需要登录飞书账号后才能查看。</p>
  <a href="${fallbackLink}" target="_blank">在飞书中打开</a>
</div>
</body></html>`;
    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Access-Control-Allow-Origin': getAllowedOrigin(c.req.header('origin')) || '',
      },
    });
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
  const resume = await c.env.DB.prepare('SELECT id FROM resumes WHERE id=?').bind(resumeId).first();
  if (!resume) return c.json({ detail: 'Resume not found' }, 404);

  const timestamp = new Date().toISOString();
  let job = await c.env.DB.prepare(
    "SELECT * FROM resume_processing_jobs WHERE resume_id=? AND status='failed' ORDER BY updated_at DESC LIMIT 1"
  ).bind(resumeId).first() as any;

  if (job) {
    await c.env.DB.prepare(
      "UPDATE resume_processing_jobs SET status='queued', error_code=NULL, error_message=NULL, updated_at=? WHERE id=? AND status='failed'"
    ).bind(timestamp, job.id).run();
  } else {
    job = await createOrGetActiveJob(c.env.DB, resumeId);
    if (job.status !== 'queued') return c.json({ job_id: job.id, parse_status: 'queued', detail: '任务已在处理中' });
  }

  await c.env.DB.prepare("UPDATE resumes SET parse_status='queued', parse_error=NULL, updated_at=? WHERE id=?")
    .bind(timestamp, resumeId).run();
  await c.env.RESUME_PROCESSING_QUEUE.send({ jobId: job.id, resumeId });
  return c.json({ job_id: job.id, parse_status: 'queued', detail: '已重新入队' }, 202);
});

// 批量清除已淘汰（HR复核结果='未通过'）
app.post('/api/resumes/clear-rejected', authMiddleware, async (c) => {
  try {
    const tableId = getBitableTableId(c.env, 'talent');
    const records = await bitableListRecords(c.env, tableId);
    const rejected = records.filter((r: any) => {
      const hrResult = r.fields?.['HR复核结果'];
      return hrResult === '未通过';
    });
    let deleted = 0;
    for (const r of rejected) {
      await bitableDeleteRecord(c.env, tableId, r.record_id);
      deleted++;
    }
    return c.json({ deleted });
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

  // 优先读取数据库中的自定义 prompt，key 为 analyze_resume
  const customPrompt = await getCustomPrompt(c.env, 'analyze_resume');
  let systemPrompt: string, userPrompt: string;
  // reparse 输入文本：优先 raw_text，其次 parsed_data（飞书同步简历）
  const reparseInputText = rawText || parsedDataText;
  if (customPrompt) {
    let sp = customPrompt.system;
    let up = customPrompt.user;
    if (sp.includes('{candidate_name}')) sp = sp.replace(/\{candidate_name\}/g, candidateName);
    if (up.includes('{candidate_name}')) up = up.replace(/\{candidate_name\}/g, candidateName);
    if (up.includes('{resume_text}')) up = up.replace(/\{resume_text\}/g, reparseInputText);
    if (sp.includes('{resume_text}')) sp = sp.replace(/\{resume_text\}/g, reparseInputText);
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
- match_score: 人岗匹配度（0-100的整数）
- recommendation: 推荐建议（"strongly_recommend"/"recommend"/"neutral"/"not_recommend"/"strongly_not_recommend"）
- summary: 综合分析摘要（中文，2-3句话）
- suggested_questions: 建议面试问题（中文，3-5个）`;
    const inputHint = reparseSource === 'parsed' ? '已解析的结构化字段（来自飞书同步）：' : '简历文本（请提取完整信息）：';
    userPrompt = inputHint + appendContext + '\n\n' + reparseInputText;
  }
  // 既无原文也无结构化字段：无法 reparse
  if (reparseSource === 'none') {
    return c.json({ detail: '该简历既无原始文本也无已解析字段，无法重新解析。请重新上传 PDF 或手动编辑', need_manual: true }, 400);
  }
  try {
    const result = await callAI(c.env, systemPrompt, userPrompt, 'deepseek-v4-flash');
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
    // Build ai_review markdown from screening data
    const advantage = merged.advantage || merged.advantages || '';
    const risk = merged.risk || merged.risks || '';
    const pos = merged.position || '';
    const matchScore = typeof merged.match_score === 'number' ? merged.match_score : null;
    const recommendation = merged.recommendation || '';
    const recLabel: Record<string, string> = {
      'strongly_recommend': '强烈推荐', 'recommend': '推荐',
      'neutral': '待定', 'not_recommend': '不推荐', 'strongly_not_recommend': '强烈不推荐'
    };
    const aiReview = [
      `📌 面试岗位：${pos}`,
      ``,
      `初筛结果: ${recLabel[recommendation] || recommendation}`,
      matchScore !== null ? `匹配分数: ${matchScore}/100` : '',
      ``,
      advantage ? `优势分析:\n${advantage}` : '',
      risk ? `\n风险点:\n${risk}` : '',
      merged.summary ? `\n综合评估:\n${merged.summary}` : '',
    ].filter(Boolean).join('\n');

    await c.env.DB.prepare(
      'UPDATE resumes SET parsed_data = ?, ai_review = ?, match_score = ?, screening_result = ?, parse_status = ? WHERE id = ?'
    ).bind(
      JSON.stringify(normalized),
      aiReview || JSON.stringify(normalized),
      matchScore,
      merged.recommendation || JSON.stringify(merged),
      'reparsed',
      id
    ).run();

    // 同步写回飞书多维表格（人才库表）
    try {
      const talentTableId = getBitableTableId(c.env, 'talent');
      const advantageStr = advantage;
      const riskStr = risk;
      const recLabelForEval: Record<string, string> = {
        'strongly_recommend': '强烈推荐', 'recommend': '推荐',
        'neutral': '待定', 'not_recommend': '不推荐', 'strongly_not_recommend': '强烈不推荐'
      };
      const evalSummary = [
        merged.summary || '',
        '',
        `匹配分数: ${matchScore !== null ? matchScore + '/100' : '-'}`,
        `推荐意见: ${recLabelForEval[recommendation] || recommendation || '-'}`,
        '',
        advantageStr ? `优势:\n${advantageStr}` : '',
        riskStr ? `\n风险:\n${riskStr}` : '',
      ].filter(Boolean).join('\n');
      await bitableUpdateRecord(c.env, talentTableId, id, {
        'AI简历评估': evalSummary,
        '优势分析': advantageStr,
        '风险点': riskStr,
        'AI简历初筛结果': recommendation || '',
      });
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
  const prompt = await getAIPrompt(c.env, 'analyze_resume', {
    system: `你是一位资深的 HR 招聘评估 AI。请基于「候选人结构化信息 + 简历全文 + 岗位要求 + 能力维度 + 个性化要求」进行综合评估，用中文返回 JSON 对象：

- match_score: 人岗匹配度整数 0-100
- recommendation: 推荐建议，取值 "strongly_recommend" / "recommend" / "neutral" / "not_recommend" / "strongly_not_recommend"
- summary: 候选人综合摘要（中文，2-3 句）
- strengths: 3-5 个核心优势（中文数组）
- risks: 2-4 个潜在风险（中文数组）
- suggested_questions: 3-5 个建议面试问题（中文数组）
- dimensions: 能力维度评分明细数组，必须依据岗位给出的「能力维度」逐条打分。每个元素格式：
  { "name": "维度名称（与岗位能力维度保持一致）", "score": 0-5 的整数, "reason": "打分依据（中文，1-2 句）" }
  若岗位未提供能力维度，则基于岗位通用要求自行归纳 3-5 个关键维度打分。`,
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
    const result = await callAI(c.env, systemPrompt, userPrompt, 'deepseek-v4-flash');
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
    const aiEvalObj: any = { summary: enrichedEvaluation.summary || '', match_score: enrichedEvaluation.match_score ?? null, weighted_score: enrichedEvaluation.weighted_score, configured_dimensions: enrichedEvaluation.configured_dimensions, recommendation: enrichedEvaluation.recommendation || '', dimensions: enrichedEvaluation.dimensions || [] };
    const aiEvalText = JSON.stringify(aiEvalObj);
    // ai_review：完整评估 JSON（供详情页展示）
    const aiReviewText = JSON.stringify({
      summary: enrichedEvaluation.summary || '',
      match_score: enrichedEvaluation.match_score ?? null,
      recommendation: enrichedEvaluation.recommendation || '',
      strengths: enrichedEvaluation.strengths || [],
      risks: enrichedEvaluation.risks || [],
      suggested_questions: enrichedEvaluation.suggested_questions || [],
      dimensions: aiEvalObj.dimensions || [],
    });
    await c.env.DB.prepare(
      'UPDATE resumes SET ai_review = ?, ai_evaluation = ?, match_score = ?, screening_result = ?, hard_requirement_result = ?, parse_status = ?, updated_at = ? WHERE id = ?'
    ).bind(aiReviewText, aiEvalText, enrichedEvaluation.match_score || null, JSON.stringify(parsed), JSON.stringify(enrichedEvaluation.hard_requirement_result), 'ai_screened', now(), id).run();

    // 同步写回飞书多维表格（人才库表）
    try {
      const talentTableId = getBitableTableId(c.env, 'talent');
      const strengths = Array.isArray(parsed.strengths) ? parsed.strengths.join('\n') : (parsed.strengths || '');
      const risks = Array.isArray(parsed.risks) ? parsed.risks.join('\n') : (parsed.risks || '');
      const aiEval = [
        parsed.summary || '',
        '',
        `匹配分数: ${parsed.match_score ?? '-'}/100`,
        `推荐意见: ${parsed.recommendation || '-'}`,
        '',
        strengths ? `优势:\n${strengths}` : '',
        risks ? `\n风险:\n${risks}` : '',
      ].filter(Boolean).join('\n');
      await bitableUpdateRecord(c.env, talentTableId, id, {
        'AI简历评估': aiEval,
        '优势分析': strengths,
        '风险点': risks,
        'AI简历初筛结果': parsed.recommendation || '',
      });
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
  await c.env.DB.prepare("UPDATE resumes SET status = 'rejected', stage = 'rejected', rejected_at = ? WHERE id = ?").bind(now(), id).run();
  const row = await c.env.DB.prepare('SELECT * FROM resumes WHERE id = ?').bind(id).first();
  return c.json(transformRow(row));
});

app.post('/api/resumes/:id/override-rejection', authMiddleware, async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare("UPDATE resumes SET status = 'pending_review', stage = 'screening', rejected_at = NULL WHERE id = ?").bind(id).run();
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
  const talentTableId = getBitableTableId(c.env, 'talent');
  let record = await bitableGetRecord(c.env, talentTableId, id);
  if (!record) return c.json({ detail: 'Candidate not found in Bitable' }, 404);

  await bitableUpdateRecord(c.env, talentTableId, id, { 'HR复核结果': '未通过' });
  record = await bitableGetRecord(c.env, talentTableId, id);
  return c.json(parseTalentRecord(record));
});

// 重置简历到待初筛状态（清除 HR复核结果）
app.post('/api/resumes/:id/reset-to-pending', authMiddleware, async (c) => {
  const id = c.req.param('id');
  const talentTableId = getBitableTableId(c.env, 'talent');
  let record = await bitableGetRecord(c.env, talentTableId, id);
  if (!record) return c.json({ detail: 'Candidate not found in Bitable' }, 404);

  await bitableUpdateRecord(c.env, talentTableId, id, { 'HR复核结果': '' });
  record = await bitableGetRecord(c.env, talentTableId, id);
  return c.json(parseTalentRecord(record));
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
  const decision = body.decision || 'approve';
  let status = 'pending_interview', stage = 'interview';
  if (decision === 'reject') { status = 'rejected'; stage = 'rejected'; }
  await c.env.DB.prepare('UPDATE resumes SET status = ?, stage = ?, hr_review = ? WHERE id = ?').bind(status, stage, body.comment || '', id).run();
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

app.get('/api/interviews/:id/questions', authMiddleware, async (c) => {
  const row = await c.env.DB.prepare('SELECT questions FROM interviews WHERE id = ?').bind(c.req.param('id')).first();
  if (!row) return c.json({ detail: 'Not found' }, 404);
  let qs = [];
  if (row.questions) { try { qs = JSON.parse(row.questions); } catch { qs = []; } }
  return c.json(qs);
});

app.post('/api/interviews/:id/start', authMiddleware, async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare("UPDATE interviews SET status = 'in_progress', started_at = ? WHERE id = ?").bind(now(), id).run();
  const row = await c.env.DB.prepare('SELECT * FROM interviews WHERE id = ?').bind(id).first() as any;

  // 异步通知面试官
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
            const pd = safeJson(resume.parsed_data);
            positionName = pd?.target_position || resume.mapped_position || resume.position_applied || '未知岗位';
          }
        }
        const fakeRecord = { candidate_name: candidateName, mapped_position: positionName, position_applied: positionName };
        await notifyInterviewersForCandidate(c.env, fakeRecord, c.get('user'));
      } catch (e: any) {
        console.error(`开始面试通知失败: ${e.message}`);
      }
    })());
  }

  return c.json(transformRow(row));
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

  await c.env.DB.prepare("UPDATE interviews SET status = 'cancelled' WHERE id = ?").bind(id).run();
  // ... (rest of cancel logic)

  await c.env.DB.prepare("UPDATE interviews SET status = 'cancelled' WHERE id = ?").bind(id).run();

  // 若面试关联了人才库记录 → 删除人才库记录并同步飞书
  const resumeId = interview.resume_id;
  if (resumeId) {
    const talent = await c.env.DB.prepare('SELECT * FROM talent_pool WHERE resume_id = ?').bind(resumeId).first() as any;
    if (talent) {
      const feishuRecordId = talent.feishu_record_id;
      await c.env.DB.prepare('DELETE FROM talent_pool WHERE id = ?').bind(talent.id).run();

      // 异步删除飞书多维表格记录
      if (feishuRecordId) {
        c.executionCtx.waitUntil((async () => {
          try {
            const token = await getFeishuToken(c.env);
            await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${FEISHU_CONFIG.appToken}/tables/${FEISHU_CONFIG.talentTableId}/records/${feishuRecordId}`, {
              method: 'DELETE',
              headers: { 'Authorization': `Bearer ${token}` },
            });
            console.log(`[Cancel] 已同步删除飞书人才库记录: ${feishuRecordId}`);
          } catch (e: any) {
            console.error(`[Cancel] 同步删除飞书记录失败: ${e.message}`);
          }
        })());
      }
    }
  }

  return c.json({ detail: 'Interview cancelled, talent pool record removed' });
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

// 手动新建面试
app.post('/api/interviews', authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const id = crypto.randomUUID();
  const time = body.interview_time || '';
  await c.env.DB.prepare(
    `INSERT INTO interviews (id, candidate_name, position_applied, interviewer, primary_interviewer, secondary_interviewer, interview_time, interview_location, status, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).bind(id, body.candidate_name || '', body.position_applied || '',
    body.interviewer || body.primary_interviewer || '', body.primary_interviewer || '',
    body.secondary_interviewer || '',
    time, body.interview_location || '', 'scheduled', now()).run();
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
  const prompt = await getAIPrompt(c.env, 'analyze_resume', {
    system: `You are an expert HR matching AI. Given a job position and a list of candidates, rank them by suitability. Respond in Chinese. Return a JSON array of objects with:
- resume_id: the candidate id
- candidate_name: the candidate name
- match_score: integer 0-100
- ranking_reason: brief reason for the ranking in Chinese`,
    user: ''
  });
  const systemPrompt = prompt.system;
  const candidateList = resumes.results.map((r: any) => ({ id: r.id, name: r.candidate_name, resume: (r.resume_markdown || r.raw_text || '').substring(0, 500) }));
  const userPrompt = `Position: ${JSON.stringify(posInfo)}\n\nCandidates:\n${JSON.stringify(candidateList, null, 2)}\n\nRank these candidates by suitability for the position. Return a JSON array.`;
  try {
    const result = await callAI(c.env, systemPrompt, userPrompt, 'deepseek-v4-flash');
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
    const result = await callAI(c.env, systemPrompt, userPrompt, 'deepseek-v4-flash');
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
    const result = await callAI(c.env, systemPrompt, userPrompt, 'deepseek-v4-flash');
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
    const evaluation = await callAI(c.env, systemPrompt, userPrompt, 'deepseek-v4-flash');
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
  const prompt = await getAIPrompt(c.env, 'analyze_resume', {
    system: `你是一名资深猎头 AI。根据候选人背景和现有在招岗位,推荐最合适的岗位并说明理由。只用中文回答。返回 JSON 数组,每项含 {"position_id": "岗位ID", "position_title": "岗位名称", "match_score": 0-100整数, "reason": "推荐理由"}。不要包含 markdown 代码块标记或额外说明。`,
    user: ''
  });
  const systemPrompt = prompt.system;
  const candidateInfo = { name: talent.candidate_name, current_title: talent.current_title, skills: talent.skills, experience_years: talent.experience_years, education: talent.education, expected_salary: talent.expected_salary, tags: talent.tags };
  const userPrompt = `候选人信息:\n${JSON.stringify(candidateInfo, null, 2)}\n\n在招岗位列表:\n${JSON.stringify(positions.results.map((p: any) => ({ id: p.id, title: p.title, department: p.department, requirements: p.requirements, salary_range: p.salary_range })), null, 2)}\n\n请推荐最匹配的岗位(最多5个),按匹配度从高到低排序。`;
  try {
    const result = await callAI(c.env, systemPrompt, userPrompt, 'deepseek-v4-flash');
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
    const assessment = await callAI(c.env, systemPrompt, userPrompt, 'deepseek-v4-flash');
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
    const result = await callAI(c.env, systemPrompt, userPrompt, 'deepseek-v4-flash');
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
  return c.json(transformRow(row));
});

app.put('/api/settings/system', authMiddleware, requireRole(['admin']), async (c) => {
  const body = await c.req.json();
  const existing = await c.env.DB.prepare('SELECT id FROM system_configs ORDER BY updated_at DESC LIMIT 1').first();
  if (existing) {
    const cols: string[] = [];
    const vals: any[] = [];
    for (const [k, v] of Object.entries(body)) {
      if (validCol(k) && !['id', 'updated_at'].includes(k)) {
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
    for (const [k, v] of Object.entries(body)) {
      if (validCol(k) && !['id', 'updated_at'].includes(k)) {
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

app.get('/api/settings/mail', authMiddleware, async (c) => {
  const row = await c.env.DB.prepare('SELECT smtp_host, smtp_port, smtp_username, mail_from, mail_from_name, mail_enabled, frontend_url FROM system_configs ORDER BY updated_at DESC LIMIT 1').first();
  return c.json(transformRow(row) || {});
});

app.put('/api/settings/mail', authMiddleware, async (c) => {
  return c.json({ detail: 'Mail settings updated' });
});

app.get('/api/settings/prompts', authMiddleware, async (c) => {
  const row = await c.env.DB.prepare('SELECT prompt_configs FROM system_configs ORDER BY updated_at DESC LIMIT 1').first();
  if (!row?.prompt_configs) return c.json({ prompts: {} });
  try {
    const configs = JSON.parse(row.prompt_configs);
    // 确保返回的结构始终包含 prompts 字段
    return c.json(typeof configs.prompts === 'object' ? configs : { prompts: configs });
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
    analyze_resume: [
      { name: 'candidate_name', description: '候选人姓名' },
      { name: 'position', description: '应聘岗位' },
      { name: 'jd_text', description: '岗位描述' },
      { name: 'resume_text', description: '简历文本' },
    ],
    generate_resume_markdown: [
      { name: 'candidate_name', description: '候选人姓名' },
      { name: 'resume_text', description: '简历原始文本' },
      { name: 'position', description: '应聘岗位' },
    ],
    generate_interview_questions: [
      { name: 'candidate_name', description: '候选人姓名' },
      { name: 'position', description: '应聘岗位' },
      { name: 'jd_text', description: '岗位描述' },
      { name: 'resume_text', description: '简历文本' },
      { name: 'dimensions', description: '评估维度' },
    ],
    generate_interview_evaluation: [
      { name: 'candidate_name', description: '候选人姓名' },
      { name: 'position', description: '应聘岗位' },
      { name: 'questions', description: '面试题目' },
      { name: 'answers', description: '候选人回答' },
      { name: 'dimensions', description: '评估维度' },
    ],
    generate_interview_evaluation_from_transcript: [
      { name: 'candidate_name', description: '候选人姓名' },
      { name: 'position', description: '应聘岗位' },
      { name: 'transcript', description: '面试转写文本' },
      { name: 'dimensions', description: '评估维度' },
    ],
    generate_coding_test_evaluation: [
      { name: 'candidate_name', description: '候选人姓名' },
      { name: 'position', description: '应聘岗位' },
      { name: 'test_description', description: '笔试题目描述' },
      { name: 'code', description: '候选人提交的代码' },
    ],
    parse_resume_pdf: [
      { name: 'candidate_name', description: '候选人姓名（从文件名提取）' },
      { name: 'resume_text', description: '简历PDF的base64文本内容' },
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
    return c.json(configs[c.req.param('key')] || { detail: 'Not found' }, 404);
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

    const row = await c.env.DB.prepare('SELECT id, prompt_configs FROM system_configs ORDER BY updated_at DESC LIMIT 1').first();
    let configs: any = {};
    if (row?.prompt_configs) {
      try { configs = JSON.parse(row.prompt_configs); } catch { configs = {}; }
    }
    if (!configs.prompts) configs.prompts = {};
    configs.prompts[key] = { system, user };

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
    analyze_resume: {
      system: '你是一位专业的简历分析师和HR专家。请仔细分析候选人简历，提取关键信息并进行专业评估。',
      user: '请分析以下简历，提取候选人的关键信息：\n\n{resume_text}\n\n请输出姓名、性别、年龄、学历、城市、手机、邮箱、技能列表、工作年限、优势分析、风险点、综合评估。'
    },
    parse_resume_pdf: {
      system: '你是一个PDF简历文本提取助手。请将PDF base64数据转换为结构化Markdown文本，保留所有可读信息。',
      user: '以下是一份PDF简历的base64编码数据，请提取其中所有可读文本并转为Markdown格式（保留所有信息）：\n\n{resume_text}'
    },
    generate_resume_markdown: {
      system: '你是一位专业的简历格式化专家。请将简历信息整理为清晰美观的Markdown格式。',
      user: '请将以下候选人信息整理为Markdown格式的简历：\n\n姓名：{candidate_name}\n{resume_text}'
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
  };

  try {
    const row = await c.env.DB.prepare('SELECT id, prompt_configs FROM system_configs ORDER BY updated_at DESC LIMIT 1').first() as any;
    let configs: any = {};
    if (row?.prompt_configs) {
      try { configs = JSON.parse(row.prompt_configs); } catch { configs = {}; }
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

app.post('/api/settings/mail/test', authMiddleware, async (c) => {
  return c.json({ detail: 'Mail sending not available in serverless mode' });
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

app.get('/api/public/review/:resumeId', async (c) => {
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
    "ALTER TABLE positions ADD COLUMN primary_interviewer TEXT DEFAULT ''",
    "ALTER TABLE positions ADD COLUMN secondary_interviewer TEXT DEFAULT ''",
    "ALTER TABLE interviews ADD COLUMN primary_interviewer TEXT DEFAULT ''",
    "ALTER TABLE interviews ADD COLUMN secondary_interviewer TEXT DEFAULT ''",
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
    // v2.0 - 入职管理增强
    "ALTER TABLE onboarding_records ADD COLUMN status_transitions TEXT DEFAULT '[]'",
    "ALTER TABLE onboarding_records ADD COLUMN probation_record_id TEXT DEFAULT ''",
  ];
  for (const sql of migrations) {
    try { await c.env.DB.prepare(sql).run(); } catch { /* column may already exist */ }
  }

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
    // 按 title + department 分组，清除重复字段
    const cleared = await c.env.DB.prepare(`
      UPDATE positions SET
        salary_range = '', location = '',
        primary_interviewer = '', secondary_interviewer = '',
        responsible_person = '', personalized_requirements = '',
        updated_at = ?
      WHERE 1=1
    `).bind(now()).run();
    return c.json({ deduped: cleared.meta?.changes ?? 0, message: '已清除岗位中的重复字段（保留 title/JD/department/capability_dimensions）' });
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
    const result = await callAI(c.env, systemPrompt, userPrompt, 'deepseek-v4-flash');
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

    // 按招聘岗位聚合：责任人 + 面试官
    const agg: Record<string, { responsible_person: string; interviewers: { name: string; role: string }[] }> = {};
    for (const rec of records) {
      const f = rec.fields || {};
      const title = getFirstValue(f['招聘岗位']) || '';
      if (!title) continue;
      if (!agg[title]) {
        agg[title] = { responsible_person: '', interviewers: [] };
      }
      const person = getUserName(f['责任人']) || '';
      if (person && !agg[title].responsible_person) {
        agg[title].responsible_person = person;
      }
      // 收集面试官（飞书字段可能是单人或多人的数组）
      for (const key of ['业务一面', 'HR二面', '终面']) {
        const raw = f[key];
        if (!raw) continue;
        const names: string[] = [];
        if (Array.isArray(raw)) {
          for (const item of raw) {
            const n = getUserName(item);
            if (n) names.push(n);
          }
        } else {
          const n = getUserName(raw);
          if (n) names.push(n);
        }
        for (const name of names) {
          if (name && !agg[title].interviewers.some(i => i.name === name)) {
            agg[title].interviewers.push({ name, role: key });
          }
        }
      }
    }

    let created = 0;
    let updated = 0;
    for (const [title, info] of Object.entries(agg)) {
      const existing = await c.env.DB.prepare(
        'SELECT id, raw_names FROM position_mappings WHERE mapped_name = ? LIMIT 1'
      ).bind(title).first() as any;

      if (existing) {
        // 更新 — 同时补全 raw_name（如果为空则以 mapped_name 填充）
        let newRawNames: string[] = [];
        try {
          newRawNames = JSON.parse(existing.raw_names || '[]');
        } catch {}
        if (!newRawNames.includes(title)) {
          newRawNames.push(title);
        }
        await c.env.DB.prepare(
          'UPDATE position_mappings SET responsible_person = ?, raw_names = ?, interviewers = ?, raw_name = COALESCE(raw_name, ?), updated_at = ? WHERE id = ?'
        ).bind(
          info.responsible_person,
          JSON.stringify(newRawNames),
          JSON.stringify(info.interviewers),
          title,
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
          id, title, title,
          JSON.stringify([title]),
          info.responsible_person,
          JSON.stringify(info.interviewers),
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
    const { mapped_name, raw_names, responsible_person, responsible_person_open_id, interviewers } = body;
    if (!mapped_name || !Array.isArray(raw_names) || raw_names.length === 0) {
      return c.json({ detail: '缺少必要字段: mapped_name 和 raw_names' }, 400);
    }
    const interviewerJson = JSON.stringify(interviewers || []);
    let created = 0, updated = 0;
    for (const raw of raw_names) {
      if (!raw) continue;
      // 检查是否已存在同名 raw_name
      const existing = await c.env.DB.prepare(
        'SELECT id FROM position_mappings WHERE raw_name = ?'
      ).bind(raw).first();
      if (existing) {
        await c.env.DB.prepare(
          'UPDATE position_mappings SET mapped_name = ?, responsible_person = ?, interviewers = ?, updated_at = ? WHERE raw_name = ?'
        ).bind(mapped_name, responsible_person || '', interviewerJson, now(), raw).run();
        updated++;
      } else {
        await c.env.DB.prepare(
          'INSERT INTO position_mappings (id, raw_name, raw_names, mapped_name, responsible_person, interviewers, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(uuid(), raw, JSON.stringify(raw_names), mapped_name, responsible_person || '', interviewerJson, now(), now()).run();
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
    const prompt = await getAIPrompt(c.env, 'analyze_resume', {
      system: `你是 HR 评审专家。对候选人逐项评分（1-5分，5分最高）。返回 JSON：{"scores":[{"dimension":"维度名","score":3,"reason":"评分理由"}]}。`,
      user: ''
    });
    const systemPrompt = prompt.system;
    const userPrompt = `能力维度：${dimNames.join('、')}\n简历：${resume.raw_text.slice(0, 3000)}`;
    const result = await callAI(c.env, systemPrompt, userPrompt, 'deepseek-v4-flash');
    const parsed = extractJSON(result);

    await c.env.DB.prepare('UPDATE resumes SET capability_scores = ? WHERE id = ?')
      .bind(JSON.stringify(parsed), c.req.param('id')).run();
    return c.json(parsed);
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
app.post('/api/resume-screening/:id/ai-analyze', authMiddleware, async (c) => {
  const id = c.req.param('id');
  const record = await c.env.DB.prepare('SELECT * FROM resume_screening_queue WHERE id = ?').bind(id).first() as any;
  if (!record) return c.json({ detail: 'Not found' }, 404);

  // Get resume text
  let resumeText = '';
  if (record.resume_id) {
    const resume = await c.env.DB.prepare('SELECT raw_text FROM resumes WHERE id = ?').bind(record.resume_id).first() as any;
    if (resume?.raw_text) resumeText = resume.raw_text;
  }
  if (!resumeText) resumeText = record.ai_analysis || '无简历文本';

  // Map position
  let mappedPosition = record.mapped_position || '';
  if (!mappedPosition && record.position_applied) {
    const pmRow = await c.env.DB.prepare('SELECT mapped_name FROM position_mappings WHERE raw_name LIKE ? LIMIT 1').bind(`%${record.position_applied.split('_')[0]}%`).first() as any;
    if (pmRow?.mapped_name) mappedPosition = pmRow.mapped_name;
  }
  if (!mappedPosition) mappedPosition = record.position_applied?.split('_')[0] || '未知岗位';

  // Get capability dimensions for this position
  const dimsResult = await c.env.DB.prepare('SELECT full_text FROM capability_dimensions WHERE position_name = ? LIMIT 3').bind(mappedPosition).all();
  let dimensionsText = '';
  if (dimsResult.results && dimsResult.results.length > 0) {
    dimensionsText = dimsResult.results.map((r: any) => r.full_text || '').filter(Boolean).join('\n');
  }

  // Get JD from job_requisitions if available
  const reqRow = await c.env.DB.prepare('SELECT requirements FROM job_requisitions WHERE title LIKE ? LIMIT 1').bind(`%${mappedPosition}%`).first() as any;
  const jdText = reqRow?.requirements || '(无JD)';

  const systemPrompt = `你是一个专业的人力资源简历初筛专家（AI简历分析引擎）。你的任务是分析候选人简历，评估其与目标岗位的匹配度。

分析要求：
1. 初筛结果：通过/不通过/待定
2. 优势分析：候选人的核心优势（2-3条）
3. 风险点：潜在风险或不足（1-2条）
4. 能力维度匹配：按岗位能力维度逐项评分（0-5分），并给出匹配依据
5. 建议追问的面试问题（3-5个）
6. 互动引导语：给面试官的一段简短引导

请用以下格式输出（中文）：

初筛结果：[通过/不通过/待定]
匹配分数：[0-5的数字]

优势分析：
• ...
• ...

风险点：
• ...

能力维度匹配：
能力：[维度名] [X]/5分。依据：...
能力：[维度名] [X]/5分。依据：...

建议追问的面试问题：
1. ...
2. ...
3. ...

互动引导语：
[一段简短的话]`;

  const userPrompt = `岗位名称：${mappedPosition}
岗位JD：
${jdText}

岗位能力维度要求：
${dimensionsText || '(无具体维度要求，请根据岗位常识评估)'}

候选人信息：
姓名：${record.candidate_name}
年龄：${record.age || '未知'}
性别：${record.gender || '未知'}
学历：${record.education || '未知'}
申请岗位：${record.position_applied || '未知'}

简历内容：
${resumeText}`;

  let aiAnalysis = '';
  try {
    aiAnalysis = await callAI(c.env, systemPrompt, userPrompt, 'deepseek-v4-flash');
  } catch (e: any) {
    return c.json({ detail: `AI分析失败: ${e.message}` }, 500);
  }

  // Parse match score from AI response
  const scoreMatch = aiAnalysis.match(/匹配分数[：:]\s*(\d+(\.\d+)?)/);
  const matchScore = scoreMatch ? parseFloat(scoreMatch[1]) : 0;
  const resultMatch = aiAnalysis.match(/初筛结果[：:]\s*(通过|不通过|待定)/);
  const aiResult = resultMatch ? resultMatch[1] : 'pending';

  // Update the screening record
  await c.env.DB.prepare(
    'UPDATE resume_screening_queue SET ai_analysis = ?, ai_result = ?, match_score = ?, mapped_position = ?, updated_at = ? WHERE id = ?'
  ).bind(aiAnalysis, aiResult, matchScore, mappedPosition, now(), id).run();

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

  // Create talent_pool entry
  const tpId = uuid();
  await c.env.DB.prepare(
    `INSERT INTO talent_pool (id, resume_id, candidate_name, email, phone, current_title, skills, experience_years, education, expected_salary, source, tags, status, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    tpId, record.resume_id || null, record.candidate_name, '', '', record.position_applied || '',
    '[]', 0, record.education || '', '', '邮箱初筛',
    JSON.stringify(['AI初筛']), 'available',
    record.ai_analysis || '', now(), now()
  ).run();

  // Update screening record
  await c.env.DB.prepare(
    'UPDATE resume_screening_queue SET status = ?, ai_result = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE id = ?'
  ).bind('approved', 'shortlisted', user.id, now(), now(), id).run();

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

  await c.env.DB.prepare(
    'UPDATE resume_screening_queue SET status = ?, ai_result = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE id = ?'
  ).bind('rejected', 'rejected', user.id, now(), now(), id).run();

  const row = await c.env.DB.prepare('SELECT * FROM resume_screening_queue WHERE id = ?').bind(id).first();
  return c.json(transformRow(row));
});

// Batch AI analyze all pending records
app.post('/api/resume-screening/batch-analyze', authMiddleware, async (c) => {
  const result = await c.env.DB.prepare("SELECT id FROM resume_screening_queue WHERE status = 'pending' AND (ai_analysis IS NULL OR ai_analysis = '')").all();
  const ids = result.results.map((r: any) => r.id);
  let processed = 0;
  for (const rid of ids) {
    try {
      const rec = await c.env.DB.prepare('SELECT * FROM resume_screening_queue WHERE id = ?').bind(rid).first() as any;
      if (!rec) continue;
      let resumeText = '';
      if (rec.resume_id) {
        const resume = await c.env.DB.prepare('SELECT raw_text FROM resumes WHERE id = ?').bind(rec.resume_id).first() as any;
        if (resume?.raw_text) resumeText = resume.raw_text;
      }
      if (!resumeText) continue;
      let mappedPosition = rec.mapped_position || rec.position_applied?.split('_')[0] || '未知岗位';
      const dimsResult = await c.env.DB.prepare('SELECT full_text FROM capability_dimensions WHERE position_name = ? LIMIT 3').bind(mappedPosition).all();
      const dimensionsText = dimsResult.results?.map((r: any) => r.full_text || '').filter(Boolean).join('\n') || '';
      const systemPrompt = `你是简历初筛专家。分析简历并输出：初筛结果（通过/不通过/待定）、匹配分数（0-5）、优势分析、风险点、能力维度匹配（每项0-5分）、面试问题建议（3个）、互动引导语。用中文输出。`;
      const userPrompt = `岗位：${mappedPosition}\n能力维度要求：${dimensionsText || '(无)'}\n候选人：${rec.candidate_name} ${rec.age || ''}岁 ${rec.gender || ''} ${rec.education || ''}\n简历：${resumeText}`;
      const aiAnalysis = await callAI(c.env, systemPrompt, userPrompt, 'deepseek-v4-flash');
      const scoreMatch = aiAnalysis.match(/匹配分数[：:]\s*(\d+(\.\d+)?)/);
      const matchScore = scoreMatch ? parseFloat(scoreMatch[1]) : 0;
      const resultMatch = aiAnalysis.match(/初筛结果[：:]\s*(通过|不通过|待定)/);
      const aiResult = resultMatch ? resultMatch[1] : 'pending';
      await c.env.DB.prepare('UPDATE resume_screening_queue SET ai_analysis = ?, ai_result = ?, match_score = ?, mapped_position = ?, updated_at = ? WHERE id = ?').bind(aiAnalysis, aiResult, matchScore, mappedPosition, now(), rid).run();
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

app.post('/api/daily-reports/generate', authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => ({})) || {};
  const reportType = body.report_type || 'progress';
  const reportDate = body.report_date || new Date().toISOString().split('T')[0];

  // Gather stats
  const totalResumes = await c.env.DB.prepare('SELECT COUNT(*) as cnt FROM resumes').first();
  const totalScreening = await c.env.DB.prepare("SELECT COUNT(*) as cnt FROM resume_screening_queue WHERE status = 'pending'").first();
  const totalApproved = await c.env.DB.prepare("SELECT COUNT(*) as cnt FROM resume_screening_queue WHERE status = 'approved'").first();
  const totalRejected = await c.env.DB.prepare("SELECT COUNT(*) as cnt FROM resume_screening_queue WHERE status = 'rejected'").first();
  const totalInterviews = await c.env.DB.prepare("SELECT COUNT(*) as cnt FROM interviews WHERE status IN ('scheduled','completed')").first();
  const totalOnboarding = await c.env.DB.prepare("SELECT COUNT(*) as cnt FROM onboarding_records WHERE status = 'in_progress'").first();
  const openRequisitions = await c.env.DB.prepare("SELECT COUNT(*) as cnt FROM job_requisitions WHERE status = 'open'").first();

  const stats = {
    report_date: reportDate,
    open_requisitions: openRequisitions?.cnt || 0,
    total_resumes: totalResumes?.cnt || 0,
    pending_screening: totalScreening?.cnt || 0,
    approved_candidates: totalApproved?.cnt || 0,
    rejected_candidates: totalRejected?.cnt || 0,
    active_interviews: totalInterviews?.cnt || 0,
    onboarding_count: totalOnboarding?.cnt || 0,
  };

  // Generate AI summary
  let aiSummary = '';
  try {
    aiSummary = await callAI(c.env,
      '你是招聘数据分析专家。根据招聘统计数据生成一份简洁的日报摘要（中文），包含：整体进展概述、关键指标分析、风险提示、明日建议。控制在300字以内。',
      `日期：${reportDate}\n统计数据：${JSON.stringify(stats, null, 2)}`
    );
  } catch (e: any) {
    console.error('[daily-report] AI summary failed:', e?.message);
    aiSummary = '(AI摘要生成失败)';
  }

  const content = JSON.stringify(stats);
  const id = uuid();

  await c.env.DB.prepare(
    `INSERT INTO daily_reports (id, report_date, total_resumes, pending_screening, approved, rejected, total_interviews, total_onboarding, ai_summary, stats, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(id, reportDate,
    (stats as any).total_resumes || 0,
    (stats as any).pending_screening || 0,
    (stats as any).approved_candidates || 0,
    (stats as any).rejected_candidates || 0,
    (stats as any).active_interviews || 0,
    (stats as any).onboarding_count || 0,
    aiSummary, content, now()
  ).run();

  const row = await c.env.DB.prepare('SELECT * FROM daily_reports WHERE id = ?').bind(id).first();
  return c.json(transformRow(row));
});

app.delete('/api/daily-reports/:id', authMiddleware, async (c) => {
  await c.env.DB.prepare('DELETE FROM daily_reports WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ detail: 'Report deleted' });
});

// 发送日报到飞书
app.post('/api/daily-reports/:id/send', authMiddleware, async (c) => {
  try {
    const body = await c.req.json();
    const { target_type, target_id } = body;
    if (!target_type || !target_id) {
      return c.json({ detail: '请指定发送目标' }, 400);
    }

    const row = await c.env.DB.prepare('SELECT * FROM daily_reports WHERE id = ?').bind(c.req.param('id')).first();
    if (!row) return c.json({ detail: '日报不存在' }, 404);

    const r: any = transformRow(row);
    // stats 列存 JSON 数据，ai_summary 列存 AI 摘要
    let statsData: any = {};
    try { if (r.stats) statsData = typeof r.stats === 'string' ? JSON.parse(r.stats) : r.stats; } catch {}
    const aiSummary = r.ai_summary || '(无AI摘要)';

    const cardContent = {
      config: { wide_screen_mode: true },
      header: {
        title: { tag: 'plain_text', content: `📊 招聘日报 · ${r.report_date || '-'}` },
        template: 'blue',
      },
      elements: [
        {
          tag: 'div',
          text: {
            tag: 'lark_md',
            content: [
              `**报告日期**：${r.report_date || '-'}`,
              `**简历总数**：${r.total_resumes ?? '-'}`,
              `**待筛选**：${r.pending_screening ?? '-'}`,
              `**已通过**：${r.approved ?? '-'}`,
              `**已拒绝**：${r.rejected ?? '-'}`,
              `**面试中**：${r.total_interviews ?? '-'}`,
              `**入职中**：${r.total_onboarding ?? '-'}`,
              '',
              `**📝 AI 摘要**`,
              aiSummary.length > 500 ? aiSummary.slice(0, 500) + '...' : aiSummary,
            ].join('\n'),
          },
        },
        {
          tag: 'hr',
        },
        {
          tag: 'note',
          elements: [
            { tag: 'plain_text', content: `AI 智能招聘系统 · ${new Date().toLocaleString('zh-CN')}` },
          ],
        },
      ],
    };

    const token = await getFeishuToken(c.env);

    if (target_type === 'chat') {
      await sendFeishuMessageToChat(token, target_id, cardContent);
    } else if (target_type === 'user') {
      await sendFeishuMessageWithFallback(c.env, c.get('user')?.email, target_id, cardContent);
    } else {
      return c.json({ detail: '不支持的发送类型' }, 400);
    }

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
    console.log(`[getInterviewerOpenId] 从 interviewer_mappings 找到 ${name}`);
    return map[name];
  }

  // 2. 再从 users 表查（OAuth 绑定的 feishu_open_id，和 cli_aad2cb7fab385cb6 同应用）
  try {
    const userRow = await env.DB.prepare(
      "SELECT feishu_open_id FROM users WHERE full_name = ? AND feishu_open_id IS NOT NULL AND feishu_open_id != '' LIMIT 1"
    ).bind(name).first() as any;
    if (userRow?.feishu_open_id) {
      console.log(`[getInterviewerOpenId] 从 users 表找到 ${name} 的 feishu_open_id`);
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
        console.log(`[getInterviewerOpenId] 模糊匹配: ${name} → ${u.full_name}`);
        return u.feishu_open_id;
      }
    }
  } catch {}

  // 4. ❌ 硬编码的 FEISHU_CONFIG 中的 open_id 属于多维表格应用，不能跨应用发消息
  //    直接返回空，让调用方知道面试官未绑定飞书
  console.warn(`[getInterviewerOpenId] ⚠ "${name}" 未找到任何绑定，返回空字符串`);
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
      console.error(`[refreshUserAccessToken] 刷新失败: ${JSON.stringify(data)}`);
      await env.DB.prepare(
        "UPDATE users SET feishu_token_failed_at = ? WHERE email = ?"
      ).bind(now(), email).run();
      return null;
    }
    const expiresIn = data.expires_in || data.data?.expires_in || 7200;
    const expiresAt = Date.now() + (expiresIn - 300) * 1000;
    await env.DB.prepare(
      'UPDATE users SET feishu_token = ?, feishu_refresh_token = ?, feishu_token_expires_at = ?, feishu_token_failed_at = NULL, updated_at = ? WHERE email = ?'
    ).bind(newAccessToken, newRefreshToken, expiresAt, now(), email).run();
    console.log(`[refreshUserAccessToken] 刷新成功: ${email}`);
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
  console.log(`[getValidUserAccessToken] token 已过期，尝试刷新: ${email}`);
  const refreshed = await refreshUserAccessToken(env, email);
  return refreshed?.access_token || null;
}

async function getFeishuToken(env: Env): Promise<string> {
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
    console.log(`[GroupPush] ✅ 已推送 ${record.candidate_name} 到招聘群`);
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
    const actionType = v.action; // 'store' | 'discard'
    const recordId = v.record_id;
    const candidateName = v.name || '未知';

    console.log(`[CardCallback] ${actionType} - ${candidateName} (${recordId})`);

    const record = await c.env.DB.prepare('SELECT * FROM resume_screening_queue WHERE id = ?').bind(recordId).first() as any;
    if (!record) {
      return c.json({ code: 0, msg: 'success', data: { toast: { type: 'error', content: '记录不存在' } } });
    }
    if (record.status !== 'pending') {
      return c.json({ code: 0, msg: 'success', data: { toast: { type: 'warning', content: '已处理过' } } });
    }

    await c.env.DB.prepare(
      "UPDATE resume_screening_queue SET status = 'processing', feishu_processed_at = ? WHERE id = ?"
    ).bind(now(), recordId).run();

    const posName = record.mapped_position || record.position_applied?.split('_')[0] || '未知岗位';

    if (actionType === 'store') {
      // ✅ 入库
      c.executionCtx.waitUntil((async () => {
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

          // 更新 D1 状态
          await c.env.DB.prepare(
            "UPDATE resume_screening_queue SET status = 'approved', ai_result = 'shortlisted', updated_at = ? WHERE id = ?"
          ).bind(now(), recordId).run();

          // 更新卡片为绿色
          if (record.feishu_card_msg_id) {
            await updateFeishuCard(c.env, record.feishu_card_msg_id, 'approved', candidateName);
          }

          // 推送候选人到招聘群
          const updated = await c.env.DB.prepare('SELECT * FROM resume_screening_queue WHERE id = ?').bind(recordId).first() as any;
          await pushCandidateToGroup(c.env, updated);

          console.log(`[CardCallback] ✅ ${candidateName} 已入库`);
        } catch (e: any) {
          console.error(`[CardCallback] 入库异常: ${e.message}`);
          await c.env.DB.prepare("UPDATE resume_screening_queue SET status = 'pending' WHERE id = ?").bind(recordId).run();
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
          const token = await getFeishuToken(c.env);
          await c.env.DB.prepare(
            "UPDATE resume_screening_queue SET status = 'rejected', ai_result = 'rejected', updated_at = ? WHERE id = ?"
          ).bind(now(), recordId).run();

          if (record.feishu_card_msg_id) {
            await updateFeishuCard(c.env, record.feishu_card_msg_id, 'rejected', candidateName);
          }
        } catch (e: any) {
          console.error(`[CardCallback] 淘汰异常: ${e.message}`);
          await c.env.DB.prepare("UPDATE resume_screening_queue SET status = 'pending' WHERE id = ?").bind(recordId).run();
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
    const today = new Date();
    const dateStr = today.toISOString().split('T')[0];

    // 统计今日数据
    const todayStart = `${dateStr} 00:00:00`;
    const todayEnd = `${dateStr} 23:59:59`;

    const newCount = await c.env.DB.prepare(
      "SELECT COUNT(*) as c FROM resume_screening_queue WHERE created_at >= ? AND created_at <= ?"
    ).bind(todayStart, todayEnd).first() as any;

    const approvedCount = await c.env.DB.prepare(
      "SELECT COUNT(*) as c FROM resume_screening_queue WHERE status = 'approved' AND updated_at >= ? AND updated_at <= ?"
    ).bind(todayStart, todayEnd).first() as any;

    const rejectedCount = await c.env.DB.prepare(
      "SELECT COUNT(*) as c FROM resume_screening_queue WHERE status = 'rejected' AND updated_at >= ? AND updated_at <= ?"
    ).bind(todayStart, todayEnd).first() as any;

    const pendingCount = await c.env.DB.prepare(
      "SELECT COUNT(*) as c FROM resume_screening_queue WHERE status = 'pending'"
    ).first() as any;

    const talentCount = await c.env.DB.prepare(
      "SELECT COUNT(*) as c FROM talent_pool"
    ).first() as any;

    // 推送到招聘群
    const chatId = FEISHU_CONFIG.recruitmentGroupChatId;
    if (chatId) {
      const token = await getFeishuToken(c.env);
      const cardContent = {
        config: { wide_screen_mode: true },
        header: {
          title: { tag: 'plain_text', content: `📊 招聘日报 ${dateStr}` },
          template: 'blue'
        },
        elements: [
          {
            tag: 'div',
            text: {
              tag: 'lark_md',
              content: [
                `📅 **日期：** ${dateStr}`,
                '',
                `**📋 今日数据**`,
                `新进初筛：**${newCount?.c || 0}** 人`,
                `已入库：**${approvedCount?.c || 0}** 人`,
                `已淘汰：**${rejectedCount?.c || 0}** 人`,
                '',
                `**📦 累计数据**`,
                `待审核：**${pendingCount?.c || 0}** 人`,
                `人才库总数：**${talentCount?.c || 0}** 人`,
              ].join('\n')
            }
          },
          { tag: 'hr' },
          {
            tag: 'note',
            elements: [{ tag: 'plain_text', content: `系统自动生成 | ${today.toLocaleString('zh-CN')}` }]
          }
        ]
      };
      await sendFeishuMessageToChat(token, chatId, cardContent);
    }

    return c.json({
      ok: true,
      data: {
        date: dateStr,
        new: newCount?.c || 0,
        approved: approvedCount?.c || 0,
        rejected: rejectedCount?.c || 0,
        pending: pendingCount?.c || 0,
        talentPool: talentCount?.c || 0,
      }
    });
  } catch (err: any) {
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
      "SELECT COUNT(*) as c FROM resume_screening_queue WHERE status = 'pending'"
    ).first() as any;
    const count = pending?.c || 0;

    if (count > 0) {
      const token = await getFeishuToken(c.env);
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
async function sendFeishuMessageToUser(token: string, openId: string, cardContent: any): Promise<any> {
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
            'Extract resume text from this base64 PDF (' + (file.fileName || 'resume.pdf') + '):\n\n' + base64Content,
            'deepseek-v4-flash'
          );
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
        console.log(`[NotifyInterviewers] ✅ 已通知 ${name} (${openId}) - ${record.candidate_name}`);
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
 * 直接给面试记录中指定的面试官发送飞书提醒
 * 请求体：{ candidate_name, interviewer_name }
 */
app.post('/api/interviews/:id/notify-interviewer', authMiddleware, async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const currentUser = c.get('user');

  // 从面试记录读取面试官信息
  let interviewerName = body.interviewer_name || '';
  let candidateName = body.candidate_name || '';
  if (!interviewerName || !candidateName) {
    const interview = await c.env.DB.prepare(
      'SELECT interviewer, candidate_name, interview_time FROM interviews WHERE id = ?'
    ).bind(id).first() as any;
    if (interview) {
      if (!interviewerName) interviewerName = interview.interviewer || '';
      if (!candidateName) candidateName = interview.candidate_name || '';
    }
  }
  interviewerName = interviewerName || '面试官';
  candidateName = candidateName || '该候选人';

  try {
    // 1. 从面试官映射表或 users 表获取 open_id
    const openId = await getInterviewerOpenId(c.env, interviewerName);
    if (!openId) {
      return c.json({
        detail: `无法通知「${interviewerName}」：未在面试官映射表或用户表中找到该面试官的飞书 open_id。请在系统设置 → 面试官管理中配置映射。`,
        need_bind: true,
      }, 400);
    }

    // 2. 构建卡片消息
    const interviewTime = body.interview_time || '';
    const cardContent = buildInterviewerCard(
      candidateName,
      body.position_applied || '',
      body.city || '',
      '',
      currentUser?.full_name,
      interviewTime
    );

    // 3. 三层 fallback 发送（当前用户token → DB任意用户token → bot）
    await sendFeishuMessageWithFallback(c.env, currentUser?.email, openId, cardContent);

    console.log(`[NotifyInterviewer] ✅ 通知面试官: ${interviewerName} (open_id: ${openId})`);

    // 埋点：面试官通知
    await logOperation(c.env, {
      action: 'interview.notify',
      entityType: 'interview',
      entityId: id,
      actor: currentUser?.email,
      detail: JSON.stringify({ interviewer: interviewerName, candidate: candidateName }),
    });

    // 如果是提醒二面面试官，标记 status2 = 'scheduled'
    const ivRow = await c.env.DB.prepare('SELECT secondary_interviewer FROM interviews WHERE id = ?').bind(id).first() as any;
    if (ivRow?.secondary_interviewer && interviewerName === ivRow.secondary_interviewer) {
      await c.env.DB.prepare("UPDATE interviews SET status2 = 'scheduled', updated_at = ? WHERE id = ?")
        .bind(now(), id).run();
    }

    return c.json({ ok: true, message: `已通知面试官 ${interviewerName}: ${candidateName}` });
  } catch (err: any) {
    return c.json({ detail: `通知失败: ${err.message}` }, 500);
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

    // 按岗位名聚合责任人（取第一个有值的）
    const personMap: Record<string, string> = {};
    for (const rec of records) {
      const f = rec.fields || {};
      const title = getFirstValue(f['招聘岗位']) || '';
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

    // 同时更新 position_mappings 表
    let mapUpdated = 0;
    for (const [mappedName, person] of Object.entries(personMap)) {
      const result = await c.env.DB.prepare(
        'UPDATE position_mappings SET responsible_person = ? WHERE mapped_name = ? AND (responsible_person IS NULL OR responsible_person = ? OR responsible_person = ?)'
      ).bind(person, mappedName, '', '[object Object]').run();
      if (result.meta?.changes > 0) mapUpdated += result.meta.changes;
    }

    return c.json({
      ok: true,
      positions_updated: updated,
      mappings_updated: mapUpdated,
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
    // 直接从飞书拿数据修复
    const tableId = getBitableTableId(c.env, 'requisition');
    const records = await bitableListRecords(c.env, tableId);
    const personMap: Record<string, string> = {};
    for (const rec of records) {
      const f = rec.fields || {};
      const title = getFirstValue(f['招聘岗位']) || '';
      if (!title) continue;
      const person = getUserName(f['责任人']) || '';
      if (person && !personMap[title]) personMap[title] = person;
    }

    // 每个岗位名只取一条 position_mappings 记录
    let fixed = 0;
    for (const [mappedName, person] of Object.entries(personMap)) {
      const rows = await c.env.DB.prepare(
        'SELECT id FROM position_mappings WHERE mapped_name = ? LIMIT 1'
      ).bind(mappedName).all();
      for (const row of (rows.results || [])) {
        await c.env.DB.prepare('UPDATE position_mappings SET responsible_person = ? WHERE id = ?')
          .bind(person, (row as any).id).run();
        fixed++;
      }
    }
    return c.json({ ok: true, fixed, persons: Object.entries(personMap).map(([t, p]) => `${t} → ${p}`) });
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
    const matchScore = evalResult.match_score ?? evalResult.overall_score ?? 50;
    const screeningResult = matchScore >= 75 ? '通过' : matchScore >= 60 ? '存疑' : '淘汰';
    const aiEvalObj = { summary: evalResult.summary || '', match_score: matchScore, weighted_score: evalResult.weighted_score, configured_dimensions: evalResult.configured_dimensions || [], recommendation: evalResult.recommendation || '', dimensions: evalResult.dimensions || [], advantage: evalResult.advantage || '', risk: evalResult.risk || '', personalized_match_score: evalResult.personalized_match_score, personalized_met_items: evalResult.personalized_met_items, personalized_unmet_items: evalResult.personalized_unmet_items };
    const toArray = (v: any): string[] => { if (Array.isArray(v)) return v; if (typeof v === 'string' && v.trim()) return v.split(/\n|(?=\d+\.)/).map((s: string) => s.trim()).filter(Boolean); return []; };
    const aiReview = JSON.stringify({ summary: evalResult.summary || '', match_score: matchScore, recommendation: evalResult.recommendation || '', strengths: toArray(evalResult.advantage), risks: toArray(evalResult.risk), suggested_questions: toArray(evalResult.suggested_questions), dimensions: evalResult.dimensions || [] });
    await c.env.DB.prepare('UPDATE resumes SET ai_review=?, ai_evaluation=?, match_score=?, screening_result=?, hard_requirement_result=?, parse_status=?, updated_at=? WHERE candidate_name=?')
      .bind(aiReview, JSON.stringify(aiEvalObj), matchScore, screeningResult, JSON.stringify(evalResult.hard_requirement_result), 'ai_screened', new Date().toISOString(), candidateName).run();
    return c.json({ ok: true, candidate_name: candidateName, dimensions: evalResult.dimensions || [], match_score: matchScore, summary: evalResult.summary, screening_result: screeningResult });
  } catch (e: any) {
    return c.json({ detail: '自动评估失败: ' + e.message }, 500);
  }
});

app.post('/api/resumes/auto-evaluate-all', authMiddleware, async (c) => {
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
        const matchScore = evalResult.match_score ?? evalResult.overall_score ?? 50;
        const screeningResult = matchScore >= 75 ? '通过' : matchScore >= 60 ? '存疑' : '淘汰';
        const aiEvalObj = { summary: evalResult.summary || '', match_score: matchScore, weighted_score: evalResult.weighted_score, configured_dimensions: evalResult.configured_dimensions || [], recommendation: evalResult.recommendation || '', dimensions: evalResult.dimensions || [], advantage: evalResult.advantage || '', risk: evalResult.risk || '' };
        const toArray = (v: any): string[] => { if (Array.isArray(v)) return v; if (typeof v === 'string' && v.trim()) return v.split(/\n|(?=\d+\.)/).map((s: string) => s.trim()).filter(Boolean); return []; };
        const aiReview = JSON.stringify({ summary: evalResult.summary || '', match_score: matchScore, recommendation: evalResult.recommendation || '', strengths: toArray(evalResult.advantage), risks: toArray(evalResult.risk), suggested_questions: toArray(evalResult.suggested_questions), dimensions: evalResult.dimensions || [] });
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
        const matchScore = evalResult.match_score ?? evalResult.overall_score ?? 50;
        const screeningResult = matchScore >= 75 ? '通过' : matchScore >= 60 ? '存疑' : '淘汰';
        const aiEvalObj = { summary: evalResult.summary || '', match_score: matchScore, weighted_score: evalResult.weighted_score, configured_dimensions: evalResult.configured_dimensions || [], recommendation: evalResult.recommendation || '', dimensions: evalResult.dimensions || [], advantage: evalResult.advantage || '', risk: evalResult.risk || '' };
        const aiReview = JSON.stringify({ summary: evalResult.summary || '', match_score: matchScore, recommendation: evalResult.recommendation || '', strengths: (Array.isArray(evalResult.advantage) ? evalResult.advantage : (typeof evalResult.advantage === 'string' ? evalResult.advantage.split(/\n|(?=\d+\.)/).map((s: string) => s.trim()).filter(Boolean) : [])), risks: (Array.isArray(evalResult.risk) ? evalResult.risk : (typeof evalResult.risk === 'string' ? evalResult.risk.split(/\n|(?=\d+\.)/).map((s: string) => s.trim()).filter(Boolean) : [])), suggested_questions: (Array.isArray(evalResult.suggested_questions) ? evalResult.suggested_questions : (typeof evalResult.suggested_questions === 'string' ? evalResult.suggested_questions.split(/\n|(?=\d+\.)/).map((s: string) => s.trim()).filter(Boolean) : [])), dimensions: evalResult.dimensions || [] });
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
          '评估文本：\n' + evalText.substring(0, 5000),
          'deepseek-v4-flash'
        );

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
                '简历原文：\n' + resumeText.substring(0, 4000),
                'deepseek-v4-flash'
              );
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
export default {
  fetch: app.fetch,
  async scheduled(event: any, env: any, ctx: any) {
    if (event.cron === '55 15 * * *') {
      ctx.waitUntil((async () => {
        const at = new Date(event.scheduledTime);
        const board = await loadLiveRecruitingBoard(env.DB, null);
        try { await createDashboardSnapshot(env.DB, toShanghaiSnapshotDate(at), board, 'cron', at.toISOString()); }
        catch (error) { if (!(error instanceof Error && error.message === 'snapshot already exists')) throw error; }
      })());
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
