/**
 * 优化后的简历列表查询
 * 使用 SQL 分页过滤，不 select 长文本列
 * 通过 RESUME_SQL_LIST=true 开启
 */

import { normalizeAiScreeningResult } from '../ai-screening-result';
import { exposeStructuredEvaluation } from '../resume-schema';

const LIST_COLUMNS = `
  r.id, r.candidate_name, r.position_applied, r.mapped_position,
  r.status, r.stage, r.match_score, r.screening_result,
  r.gender, r.birthday, r.education, r.work_experience,
  r.ai_review, r.ai_evaluation,
  r.parsed_data, r.capability_scores, r.hard_requirement_result,
  r.parse_status, r.ocr_status,
  r.email, r.contact,
  r.certifications, r.self_evaluation,
  r.created_at, r.updated_at
`;

export async function handleOptimizedResumeList(c: any): Promise<Response> {
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(c.req.query('page_size') || '20', 10) || 20));
  const nameFilter = c.req.query('candidate_name');
  const statusFilter = c.req.query('status');

  let whereClause = 'WHERE 1=1';
  const params: any[] = [];

  if (nameFilter) {
    whereClause += ' AND r.candidate_name LIKE ?';
    params.push(`%${nameFilter}%`);
  }
  if (statusFilter) {
    whereClause += ' AND r.status = ?';
    params.push(statusFilter);
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
  const dataSql = `SELECT ${LIST_COLUMNS} FROM resumes r ${whereClause} ORDER BY r.updated_at DESC LIMIT ? OFFSET ?`;
  const dataResult = await c.env.DB.prepare(dataSql).bind(...params, pageSize, offset).all();

  const items = (dataResult.results || []).map((r: any) => {
    const item: any = { ...r };
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
    return item;
  });

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
