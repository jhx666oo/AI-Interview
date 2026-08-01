type ResumeFields = Record<string, unknown>;

function hasValue(value: unknown): boolean {
  return Array.isArray(value) ? value.length > 0 : value !== null && value !== undefined && String(value).trim() !== '';
}

function firstValue(fields: ResumeFields, ...keys: string[]): unknown {
  return keys.map((key) => fields[key]).find(hasValue);
}

/**
 * Keeps the persisted resume schema stable even when an AI response uses Chinese labels.
 * Chinese aliases remain in the object for traceability, while consumers use canonical keys.
 */
export function normalizeResumeFields(value: unknown): ResumeFields {
  const fields = value && typeof value === 'object' && !Array.isArray(value) ? value as ResumeFields : {};
  const normalized: ResumeFields = { ...fields };
  const aliases: Record<string, string[]> = {
    name: ['name', '姓名'],
    phone: ['phone', '电话', '手机号', '手机号码'],
    email: ['email', '邮箱'],
    gender: ['gender', '性别'],
    birthday: ['birthday', '出生年月', '出生日期'],
    age: ['age', '年龄'],
    highest_degree: ['highest_degree', '学历', '最高学历'],
    school: ['school', '学校', '毕业院校'],
    major: ['major', '专业'],
    years_of_experience: ['years_of_experience', 'work_years', '工作年限', '工作经验'],
    recent_company: ['recent_company', '最近公司', '最近工作单位'],
    current_position: ['current_position', '当前职位', '目前职位'],
    skills: ['skills', '技能'],
    certifications: ['certifications', '证书', '证书/资质', '资质'],
    self_evaluation: ['self_evaluation', '自我评价'],
    work_experience: ['work_experience', '工作经历'],
    education: ['education', '教育经历'],
  };
  for (const [canonical, keys] of Object.entries(aliases)) {
    const field = firstValue(fields, ...keys);
    if (hasValue(field)) normalized[canonical] = field;
  }
  return normalized;
}
