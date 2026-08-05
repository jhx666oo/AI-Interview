import { formatWeightedScore, normalizeResumeEvaluation } from './resumeEvaluation';

function objectFrom(value: unknown): Record<string, any> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, any>;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function buildResumeExportRows(resumes: any[]): Array<Record<string, unknown>> {
  return resumes.map((resume) => {
    const parsed = objectFrom(resume.parsed_data);
    const evaluation = normalizeResumeEvaluation(resume);
    const screeningResult = resume.screening_result === '通过'
      ? '通过'
      : resume.screening_result ? '不通过' : '待初筛';
    let hrResult = '0';
    if (resume.hr_review === '通过') hrResult = '通过';
    else if (resume.hr_review === '未通过' || resume.status === 'rejected') hrResult = '不通过';
    return {
      '姓名': parsed.name || resume.candidate_name || '',
      '性别': parsed.gender || '',
      '年龄': parsed.age ?? '',
      '学历': parsed.highest_degree || '',
      '学校': parsed.school || '',
      '专业': parsed.major || '',
      '工作年限': parsed.years_of_experience ?? '',
      '最近公司': parsed.recent_company || '',
      '当前职位': parsed.current_position || '',
      '电话': parsed.phone || resume.contact || '',
      '邮箱': parsed.email || resume.email || '',
      '技能': Array.isArray(parsed.skills) ? parsed.skills.join('、') : (parsed.skills || ''),
      '证书/资质': Array.isArray(parsed.certifications) ? parsed.certifications.join('、') : (parsed.certifications || ''),
      '自我评价': parsed.self_evaluation || '',
      '教育经历': Array.isArray(parsed.education) ? parsed.education.map((item: any) => `${item.school || ''} ${item.degree || ''} ${item.major || ''}`).join('；') : '',
      '工作经验': Array.isArray(parsed.work_experience) ? parsed.work_experience.map((item: any) => `${item.company || ''} ${item.position || ''}`).join('；') : '',
      'AI 分析结果': screeningResult,
      'AI 加权分': formatWeightedScore(evaluation.overallScore),
      'AI 初筛原因': resume.screening_reason || evaluation.screeningReason || '',
      'HR 复合结果': hrResult,
    };
  });
}
