import type { SearchDocument, SearchDocumentGenerator } from './types';

export class ResumeSearchDocumentGenerator implements SearchDocumentGenerator {
  async generate(resumeId: string, ctx: { db: D1Database }): Promise<SearchDocument | null> {
    const row = await ctx.db.prepare(`
      SELECT
        r.id, r.candidate_name, r.position_id, r.highest_degree, r.school,
        r.major, r.years_of_experience, r.gender, r.age, r.skills,
        r.ai_score, r.status, r.desired_position, r.expected_salary,
        r.work_experience_summary, r.certifications,
        p.name as position_name, p.department
      FROM resumes r
      LEFT JOIN positions p ON r.position_id = p.id
      WHERE r.id = ?
    `).bind(resumeId).first<any>();

    if (!row) return null;

    const parts: string[] = [];

    // 候选人基本信息
    parts.push(`# 候选人: ${row.candidate_name ?? '未知'}`);
    if (row.position_name) parts.push(`应聘岗位: ${row.position_name}`);
    if (row.department) parts.push(`部门: ${row.department}`);

    // 教育背景
    const edu = [row.highest_degree, row.school, row.major].filter(Boolean).join(' | ');
    if (edu) parts.push(`教育背景: ${edu}`);

    // 经验与技能
    if (row.years_of_experience != null) parts.push(`工作经验: ${row.years_of_experience}年`);
    if (row.skills) {
      const skillList = typeof row.skills === 'string'
        ? row.skills
        : Array.isArray(row.skills) ? row.skills.join(', ') : '';
      if (skillList) parts.push(`技能: ${skillList}`);
    }
    if (row.certifications) parts.push(`证书: ${row.certifications}`);
    if (row.work_experience_summary) parts.push(`工作经历: ${row.work_experience_summary}`);

    // 岗位匹配
    if (row.desired_position) parts.push(`期望职位: ${row.desired_position}`);
    if (row.expected_salary) parts.push(`期望薪资: ${row.expected_salary}`);

    // AI 评分
    if (row.ai_score != null) parts.push(`AI 匹配评分: ${row.ai_score}`);

    // 状态
    parts.push(`状态: ${row.status ?? '未知'}`);

    // PII 过滤：不包含电话、邮箱、地址等
    const markdown = parts.join('\n\n');

    return {
      resumeId: row.id,
      version: 1,
      markdown,
      generatedAt: new Date().toISOString(),
    };
  }
}
