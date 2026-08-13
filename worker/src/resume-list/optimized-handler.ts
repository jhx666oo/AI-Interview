/**
 * 优化后的简历列表查询
 * 使用 SQL 分页过滤，不 select 长文本列
 * 通过 RESUME_SQL_LIST=true 开启
 */

import { normalizeAiScreeningResult } from '../ai-screening-result';
import { ensureResumeListSchema, exposeStructuredEvaluation } from '../resume-schema';
import { appendEvaluationJobProjection } from '../resume-processing/batch-repository';
import {
  buildBusinessScreeningStatusSqlClause,
  exposeBusinessScreeningState,
  isBusinessScreeningStatusFilter,
} from './business-screening-status';

const LIST_COLUMNS = `
  r.id, r.candidate_name, r.position_applied, r.mapped_position,
  r.status, r.stage, r.match_score, r.screening_result,
  r.hr_disposition, r.business_screening_status,
  r.gender, r.birthday, r.education, r.work_experience,
  r.ai_review, r.ai_evaluation,
  r.parsed_data, r.capability_scores, r.hard_requirement_result,
  r.parse_status, r.ocr_status,
  r.email, r.contact,
  r.certifications, r.self_evaluation,
  r.created_at, r.updated_at
`;

export async function handleOptimizedResumeList(c: any): Promise<Response> {
  // Ensure additive resume columns exist (idempotent) before any SELECT references them.
  await ensureResumeListSchema(c.env.DB);

  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(c.req.query('page_size') || '20', 10) || 20));
  const nameFilter = c.req.query('candidate_name');
  const statusFilter = c.req.query('status');
  const screeningResultFilter = c.req.query('screening_result');
  const businessScreeningStatusFilterRaw = c.req.query('business_screening_status');
  const businessScreeningStatusFilter = isBusinessScreeningStatusFilter(businessScreeningStatusFilterRaw)
    ? businessScreeningStatusFilterRaw
    : null;
  const positionFilter = c.req.query('position');
  const majorFilter = c.req.query('major');
  const educationFilter = c.req.query('education');
  const minAgeRaw = parseInt(c.req.query('min_age') || '', 10);
  const maxAgeRaw = parseInt(c.req.query('max_age') || '', 10);
  const minAge = Number.isFinite(minAgeRaw) ? minAgeRaw : null;
  const maxAge = Number.isFinite(maxAgeRaw) ? maxAgeRaw : null;
  const genders = (c.req.query('genders') || '')
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean);

  let whereClause = 'WHERE 1=1';
  const params: any[] = [];

  if (nameFilter) {
    whereClause += ' AND r.candidate_name LIKE ?';
    params.push(`%${nameFilter}%`);
  }
  if (statusFilter) {
    if (statusFilter === 'pending_screening') {
      // 待初筛：新上传记录的默认 screening_result 是 pending，历史数据可能为空。
      whereClause += " AND r.status = 'pending_screening' AND (r.screening_result IS NULL OR r.screening_result = '' OR r.screening_result = 'pending')";
    } else {
      whereClause += ' AND r.status = ?';
      params.push(statusFilter);
    }
  }
  if (screeningResultFilter) {
    whereClause += ' AND r.screening_result = ?';
    params.push(screeningResultFilter);
  }
  if (businessScreeningStatusFilter) {
    const businessFilter = buildBusinessScreeningStatusSqlClause(businessScreeningStatusFilter);
    whereClause += ` AND ${businessFilter.clause}`;
    params.push(...businessFilter.params);
  }
  if (positionFilter) {
    // position 参数为标准岗位名（mapped_name）：匹配映射表里对应的所有原始岗位名，
    // 同时也匹配已直接存储标准岗位名的简历。
    whereClause += ` AND (r.mapped_position IN (SELECT raw_name FROM position_mappings WHERE mapped_name = ?) OR r.mapped_position = ?)`;
    params.push(positionFilter, positionFilter);
  }
  if (majorFilter) {
    whereClause += " AND json_extract(r.parsed_data, '$.major') LIKE ?";
    params.push(`%${majorFilter}%`);
  }
  if (educationFilter) {
    whereClause += " AND json_extract(r.parsed_data, '$.highest_degree') LIKE ?";
    params.push(`%${educationFilter}%`);
  }
  // 年龄优先取 parsed_data.age（与前端展示一致），缺失时按生日推算。
  // 生日字段格式多样（1998-12 / 2004.7 / 1996.05.20 / 2004-07-15），
  // SQLite 的 julianday 无法解析这些格式，故统一转成 YYYYMM 整数再比较。
  const ageExpr = `CASE
    WHEN json_valid(r.parsed_data)
      AND json_extract(r.parsed_data, '$.age') IS NOT NULL
      AND CAST(json_extract(r.parsed_data, '$.age') AS INTEGER) > 0
      THEN CAST(json_extract(r.parsed_data, '$.age') AS INTEGER)
    WHEN json_valid(r.parsed_data)
      AND json_extract(r.parsed_data, '$.birthday') IS NOT NULL
      AND (json_extract(r.parsed_data, '$.birthday') LIKE '%岁%'
        OR json_extract(r.parsed_data, '$.birthday') LIKE '%年龄%')
      THEN CAST(REPLACE(REPLACE(REPLACE(json_extract(r.parsed_data, '$.birthday'), '岁', ''), '年龄', ''), '：', '') AS INTEGER)
    WHEN json_valid(r.parsed_data)
      AND json_extract(r.parsed_data, '$.birthday') IS NOT NULL
      AND json_extract(r.parsed_data, '$.birthday') != ''
      THEN CAST((CAST(strftime('%Y%m', 'now') AS INTEGER)
        - CAST(substr(REPLACE(REPLACE(json_extract(r.parsed_data, '$.birthday'), '.', '-'), '/', '-'), 1, 4) AS INTEGER) * 100
        - CAST(substr(REPLACE(REPLACE(json_extract(r.parsed_data, '$.birthday'), '.', '-'), '/', '-'), 6, 2) AS INTEGER)) / 100.0 AS INTEGER)
    WHEN r.birthday IS NOT NULL AND (r.birthday LIKE '%岁%' OR r.birthday LIKE '%年龄%')
      THEN CAST(REPLACE(REPLACE(REPLACE(r.birthday, '岁', ''), '年龄', ''), '：', '') AS INTEGER)
    WHEN r.birthday IS NOT NULL AND r.birthday != ''
      THEN CAST((CAST(strftime('%Y%m', 'now') AS INTEGER)
        - CAST(substr(REPLACE(REPLACE(r.birthday, '.', '-'), '/', '-'), 1, 4) AS INTEGER) * 100
        - CAST(substr(REPLACE(REPLACE(r.birthday, '.', '-'), '/', '-'), 6, 2) AS INTEGER)) / 100.0 AS INTEGER)
  END`;
  if (minAge !== null) {
    whereClause += ` AND ${ageExpr} >= ?`;
    params.push(minAge);
  }
  if (maxAge !== null) {
    whereClause += ` AND ${ageExpr} <= ?`;
    params.push(maxAge);
  }
  if (genders.length > 0) {
    // 与前端展示一致：性别取 gender 列，缺失时回退 parsed_data.gender，均非男/女视为「未识别」
    const genderExpr = `COALESCE(NULLIF(r.gender, ''), json_extract(r.parsed_data, '$.gender'), '')`;
    const parts: string[] = [];
    for (const g of genders) {
      if (g === '未识别') {
        parts.push(`${genderExpr} NOT IN ('男', '女')`);
      } else {
        parts.push(`${genderExpr} = ?`);
        params.push(g);
      }
    }
    whereClause += ` AND (${parts.join(' OR ')})`;
  }

  const ownerFilter = c.req.query('responsible_person') || getOwnerName(c);
  if (ownerFilter) {
    const mappings = await c.env.DB.prepare(
      "SELECT raw_name, mapped_name FROM position_mappings WHERE responsible_person = ?"
    ).bind(ownerFilter).all();

    const ownerPositions = new Set<string>();
    for (const m of (mappings.results || [])) {
      if ((m as any).raw_name) ownerPositions.add((m as any).raw_name);
      if ((m as any).mapped_name) ownerPositions.add((m as any).mapped_name);
    }

    if (ownerPositions.size > 0) {
      const placeholders = Array.from(ownerPositions).map(() => '?').join(',');
      whereClause += ` AND (r.mapped_position IN (${placeholders}) OR r.position_applied IN (${placeholders}))`;
      params.push(...Array.from(ownerPositions), ...Array.from(ownerPositions));
    }
  }

  // 加载岗位映射（raw_name → mapped_name），用于返回标准岗位名
  const positionMap = new Map<string, string>();
  try {
    const pmRes = await c.env.DB.prepare('SELECT raw_name, mapped_name FROM position_mappings').all();
    for (const m of (pmRes.results || [])) {
      if ((m as any).raw_name && (m as any).mapped_name) positionMap.set((m as any).raw_name, (m as any).mapped_name);
    }
  } catch {}

  const countSql = `SELECT
    COUNT(*) as total,
    SUM(CASE WHEN r.status = 'pending_screening' THEN 1 ELSE 0 END) as pending_screening,
    SUM(CASE WHEN r.status = 'approved' THEN 1 ELSE 0 END) as approved,
    SUM(CASE WHEN r.status = 'rejected' THEN 1 ELSE 0 END) as rejected,
    SUM(CASE WHEN r.status = 'offer_pending' THEN 1 ELSE 0 END) as offer_pending,
    SUM(CASE WHEN r.status = 'offer_accepted' THEN 1 ELSE 0 END) as offer_accepted,
    SUM(CASE WHEN r.status = 'offer_rejected' THEN 1 ELSE 0 END) as offer_rejected,
    SUM(CASE WHEN r.status = 'onboarding' THEN 1 ELSE 0 END) as onboarding,
    SUM(CASE WHEN r.status = 'completed' THEN 1 ELSE 0 END) as completed
    FROM resumes r ${whereClause}`;
  const countResult = await c.env.DB.prepare(countSql).bind(...params).first<{ total: number }>();
  const total = countResult?.total ?? 0;
  const stats = {
    total: Number(countResult?.total || 0),
    pending_screening: Number((countResult as any)?.pending_screening || 0),
    approved: Number((countResult as any)?.approved || 0),
    rejected: Number((countResult as any)?.rejected || 0),
    offer_pending: Number((countResult as any)?.offer_pending || 0),
    offer_accepted: Number((countResult as any)?.offer_accepted || 0),
    offer_rejected: Number((countResult as any)?.offer_rejected || 0),
    onboarding: Number((countResult as any)?.onboarding || 0),
    completed: Number((countResult as any)?.completed || 0),
  };

  const offset = (page - 1) * pageSize;
  const dataSql = `SELECT ${LIST_COLUMNS} FROM resumes r ${whereClause} ORDER BY r.created_at DESC, r.updated_at DESC LIMIT ? OFFSET ?`;
  const dataResult = await c.env.DB.prepare(dataSql).bind(...params, pageSize, offset).all();

  const items = (dataResult.results || []).map((r: any) => {
    const item: any = exposeBusinessScreeningState({ ...r });
    if (r.contact) item.phone = r.contact;
    if (r.birthday) {
      try { const b = new Date(r.birthday); const diff = Date.now() - b.getTime(); item.age = Math.floor(diff / (365.25 * 24 * 3600 * 1000)); } catch {}
    }
    if (r.parsed_data) { try { item.parsed_data = JSON.parse(r.parsed_data); } catch {} }
    if (r.capability_scores) { try { item.capability_scores = JSON.parse(r.capability_scores); } catch {} }
    if (r.hard_requirement_result) { try { item.hard_requirement_result = JSON.parse(r.hard_requirement_result); } catch {} }
    exposeStructuredEvaluation(item);
    if (r.ai_review) { try { item.ai_review = JSON.parse(r.ai_review); } catch {} }
    if (item.screening_result || r.screening_result) {
      const sr = item.screening_result || r.screening_result;
      item.screening_result = normalizeAiScreeningResult(sr);
      item.screening_label = item.screening_result;
    }
    applyParsedResumeFields(item);
    // 岗位显示用标准岗位名（岗位映射 raw_name → mapped_name），未映射时保留原岗位名
    const rawPosition = item.mapped_position || item.position_applied || '';
    item.standard_position = rawPosition ? (positionMap.get(rawPosition) || rawPosition) : '';
    return item;
  });

  await appendEvaluationJobProjection(c.env.DB, items);

  return c.json({ items, total, stats, page, page_size: pageSize });
}

function getOwnerName(c: any): string | null {
  try {
    const user = c.get('user');
    if (!user) return null;
    const role = user.role?.value ?? user.role;
    if (role === 'admin') return null;
    return user.name || user.email?.split('@')[0] || null;
  } catch { return null; }
}

function applyParsedResumeFields(item: any): void {
  if (!item.parsed_data || typeof item.parsed_data !== 'object') return;
  const fields = item.parsed_data;
  if (fields.name && !item.candidate_name) item.candidate_name = fields.name;
  if (fields.age) item.age = fields.age;
  else if (!item.age && fields.birthday) {
    try { const b = new Date(fields.birthday); const diff = Date.now() - b.getTime(); item.age = Math.floor(diff / (365.25 * 24 * 3600 * 1000)); } catch {}
  }
  if (fields.gender && !item.gender) item.gender = fields.gender;
  if (fields.highest_degree && !item.education) item.education = fields.highest_degree;
  if (fields.school) item.school = fields.school;
  if (fields.major) item.major = fields.major;
  if (fields.phone && !item.phone) item.phone = fields.phone;
  if (fields.skills) item.skills = fields.skills;
  if (fields.years_of_experience) item.work_years = fields.years_of_experience;
}
