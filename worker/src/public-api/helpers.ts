import type { Context } from 'hono';

// ==================== 两档鉴权：公开脱敏 / x-api-key 完整 ====================

export type PublicMode = 'public' | 'full';

export function publicModeFromRequest(c: Context<any>): PublicMode {
  const apiKey = c.req.header('x-api-key') || '';
  if (apiKey && c.env.RESUME_UPLOAD_API_KEY && apiKey === c.env.RESUME_UPLOAD_API_KEY) return 'full';
  return 'public';
}

export async function setPublicMode(c: Context<any>, next: any) {
  c.set('publicMode', publicModeFromRequest(c));
  await next();
}

// ==================== 分页 ====================

export function pagination(c: Context<any>, max = 200) {
  const limitRaw = parseInt(c.req.query('limit') || '50', 10);
  const offsetRaw = parseInt(c.req.query('offset') || '0', 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), max) : 50;
  const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0;
  return { limit, offset };
}

// ==================== 学历 / 年龄过滤（与批量 action 口径一致） ====================

export const DEGREE_LEVELS = ['小学', '初中', '高中', '中专', '大专', '本科', '硕士', '博士'];

export function educationLevel(edu: unknown): number {
  const e = String(edu ?? '').trim();
  if (!e) return -1;
  for (let i = DEGREE_LEVELS.length - 1; i >= 0; i--) {
    if (e.includes(DEGREE_LEVELS[i])) return i;
  }
  return -1;
}

export function buildEducationFilter(cond: any): ((edu: unknown) => boolean) | null {
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

export function buildAgeFilter(cond: any): ((age: number) => boolean) | null {
  const min = cond.age_min != null && !Number.isNaN(Number(cond.age_min)) ? Number(cond.age_min) : null;
  const max = cond.age_max != null && !Number.isNaN(Number(cond.age_max)) ? Number(cond.age_max) : null;
  if (min == null && max == null) return null;
  return (age: number) => {
    if (min != null && age < min) return false;
    if (max != null && age > max) return false;
    return true;
  };
}

/** 从学历列或 parsed_data.highest_degree 取学历（与简历列表/批量 action 口径一致） */
export function resumeEducation(row: any): string {
  let edu = row.education;
  if (!edu) {
    try {
      const pd = typeof row.parsed_data === 'string' ? JSON.parse(row.parsed_data) : (row.parsed_data || {});
      if (pd && typeof pd === 'object') edu = pd.highest_degree || '';
    } catch { /* 非 JSON，视为无学历 */ }
  }
  return String(edu || '').trim();
}

/** 从 parsed_data.birthday 等取年龄；无则 null */
export function resumeAge(row: any): number | null {
  try {
    const pd = typeof row.parsed_data === 'string' ? JSON.parse(row.parsed_data) : (row.parsed_data || {});
    if (typeof pd.age === 'number' && !Number.isNaN(pd.age)) return pd.age;
    if (pd.age != null) {
      const n = Number(pd.age);
      if (!Number.isNaN(n)) return n;
    }
    if (pd.birthday) {
      const b = new Date(pd.birthday);
      if (!Number.isNaN(b.getTime())) return Math.floor((Date.now() - b.getTime()) / (365.25 * 24 * 3600 * 1000));
    }
  } catch { /* ignore */ }
  return null;
}

// ==================== 姓名容错（编辑距离 ≤ 1） ====================

export function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[] = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[n];
}

/** 解析面试官姓名：兼容 JSON 数组 / 数组 / 逗号分隔（同 index.ts extractPersonNames） */
function splitNames(value: any): string[] {
  if (value == null || value === '') return [];
  const arr = Array.isArray(value) ? value : safeJsonParse(value);
  if (Array.isArray(arr)) {
    return arr.map(String).map((s) => s.trim()).filter((s) => s.length > 0);
  }
  return String(value).split(/[,，;；]/).map((s) => s.trim()).filter((s) => s.length > 0);
}

function safeJsonParse(value: any): any {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}

/** 从 5 个来源收集去重面试官/负责人姓名 */
export async function collectInterviewerNames(db: any): Promise<string[]> {
  const set = new Set<string>();
  const add = (v: any) => {
    for (const n of splitNames(v)) {
      if (n.length > 0 && n.length <= 20) set.add(n);
    }
  };
  try {
    const rows = await db.prepare('SELECT name FROM interviewer_mappings').all();
    for (const r of (rows.results || []) as any[]) add(r.name);
  } catch { /* 表缺失忽略 */ }
  try {
    const rows = await db.prepare('SELECT responsible_person, primary_interviewer, secondary_interviewer FROM positions').all();
    for (const r of (rows.results || []) as any[]) { add(r.responsible_person); add(r.primary_interviewer); add(r.secondary_interviewer); }
  } catch { /* 表缺失忽略 */ }
  try {
    const rows = await db.prepare('SELECT responsible_person, interviewers FROM position_mappings').all();
    for (const r of (rows.results || []) as any[]) { add(r.responsible_person); add(r.interviewers); }
  } catch { /* 表缺失忽略 */ }
  try {
    const rows = await db.prepare('SELECT responsible_person, interviewers FROM recruitment_tasks').all();
    for (const r of (rows.results || []) as any[]) { add(r.responsible_person); add(r.interviewers); }
  } catch { /* 表缺失忽略 */ }
  try {
    const rows = await db.prepare('SELECT interviewer, primary_interviewer, secondary_interviewer FROM interviews').all();
    for (const r of (rows.results || []) as any[]) { add(r.interviewer); add(r.primary_interviewer); add(r.secondary_interviewer); }
  } catch { /* 表缺失忽略 */ }
  return [...set];
}

export interface NameResolveResult {
  matched: string | null;
  candidates: string[];
}

/**
 * 姓名容错解析：精确命中返回原样；否则编辑距离 ≤ 1 的唯一候选自动采用；
 * 多个候选时 matched=null 并返回 candidates 供调用方选择。
 */
export async function resolveInterviewerName(db: any, query: string): Promise<NameResolveResult> {
  const q = String(query || '').trim();
  if (!q) return { matched: null, candidates: [] };
  const names = await collectInterviewerNames(db);
  if (names.includes(q)) return { matched: q, candidates: [] };
  const near = names.filter((n) => editDistance(q, n) <= 1);
  if (near.length === 1) return { matched: near[0], candidates: near };
  return { matched: null, candidates: near };
}

// ==================== 字段裁剪（public 脱敏 / full 完整） ====================

/** 列表/详情通用：按 mode 挑字段；full 不返回超大原文（raw_text/parsed_data），避免响应过大 */
export function pickFields(row: any, mode: PublicMode, publicKeys: string[], fullKeys?: string[]): Record<string, unknown> {
  const keys = mode === 'full' && fullKeys ? fullKeys : publicKeys;
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (row && Object.prototype.hasOwnProperty.call(row, k) && row[k] !== undefined) out[k] = row[k];
  }
  return out;
}

export const RESUME_LIST_PUBLIC_KEYS = [
  'id', 'candidate_name', 'mapped_position', 'position_applied', 'status', 'stage',
  'match_score', 'screening_result', 'parse_status', 'created_at', 'updated_at',
];

export const RESUME_LIST_FULL_KEYS = [
  ...RESUME_LIST_PUBLIC_KEYS,
  'gender', 'education', 'birthday', 'city', 'work_experience', 'skill_keywords',
  'age', 'highest_degree', 'contact', 'email', 'remark',
];

export function resumeView(row: any, mode: PublicMode): Record<string, unknown> {
  const view = pickFields(row, mode, RESUME_LIST_PUBLIC_KEYS, RESUME_LIST_FULL_KEYS);
  if (mode === 'full') {
    // 从 parsed_data 补充派生字段（列表不直接返回解析原文）
    const pd = row?.parsed_data ? safeJsonParse(row.parsed_data) : null;
    if (pd && typeof pd === 'object') {
      if (view.age === undefined && typeof pd.age === 'number') view.age = pd.age;
      if (view.highest_degree === undefined && pd.highest_degree) view.highest_degree = pd.highest_degree;
      if (view.city === undefined && pd.city) view.city = pd.city;
      if (view.gender === undefined && pd.gender) view.gender = pd.gender;
    }
  }
  return view;
}

export function interviewView(row: any, mode: PublicMode): Record<string, unknown> {
  const publicKeys = [
    'id', 'resume_id', 'candidate_name', 'position_id', 'position_applied', 'round',
    'interviewer', 'primary_interviewer', 'secondary_interviewer', 'interview_time',
    'started_at', 'status', 'result', 'result2', 'status2', 'interview_type',
    'interview_category', 'total_score', 'created_at',
  ];
  const fullKeys = [...publicKeys, 'comments', 'evaluation', 'evaluation2', 'panel_members', 'scores', 'interview_location'];
  return pickFields(row, mode, publicKeys, fullKeys);
}

export function positionView(row: any, mode: PublicMode): Record<string, unknown> {
  const publicKeys = [
    'id', 'title', 'department', 'location', 'salary_range', 'status', 'urgency',
    'headcount', 'responsible_person', 'primary_interviewer', 'secondary_interviewer',
    'created_at', 'updated_at',
  ];
  const fullKeys = [...publicKeys, 'description', 'requirements', 'job_category', 'employment_type'];
  return pickFields(row, mode, publicKeys, fullKeys);
}

export function publicError(c: Context<any>, e: any, prefix = '查询失败') {
  return c.json({ detail: `${prefix}: ${e?.message || e}` }, 500);
}
