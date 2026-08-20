import { normalizeResumeFields } from '../resume-processing/fields';
import { normalizeDimensionScores, normalizeScreeningEvaluation } from '../resume-processing/dimension-scores';

type Row = Record<string, any>;

export type InterviewCardLinkStatus = 'linked' | 'missing' | 'ambiguous';

const STATUS_LABELS: Record<string, string> = {
  pending_screening: '待初筛',
  pending_review: '待评审',
  pending_dept_review: '待部门评审',
  pending_hr_decision: '待 HR 决策',
  pending_business_screening: '待业务筛选',
  pending_interview: '待面试',
  interview_scheduled: '待面试',
  interview_passed: '面试通过',
  interview_failed: '面试未通过',
  offer_pending: 'Offer 待确认',
  offer_accepted: '已接受 Offer',
  offer_rejected: '已拒绝 Offer',
  onboarding: '入职中',
  completed: '已完成',
  rejected: '已淘汰',
  hired: '已入职',
  waitlist: '备选',
  approved: '已入库',
};

function parseJson(value: unknown): any {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  try { return JSON.parse(value); } catch { return null; }
}

function asList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item ?? '').trim()).filter(Boolean);
  if (typeof value === 'string' && value.trim()) return value.split(/\r?\n|[,，、]/).map((item) => item.trim()).filter(Boolean);
  return [];
}

function text(value: unknown, fallback = ''): string {
  if (value === null || value === undefined) return fallback;
  const result = String(value).trim();
  return result || fallback;
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const result = text(value);
    if (result) return result;
  }
  return '';
}

function maskContact(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  if (/^\d{11}$/.test(raw)) return `${raw.slice(0, 3)}****${raw.slice(-4)}`;
  if (raw.includes('@')) {
    const [name, domain] = raw.split('@');
    return `${name.slice(0, 1)}***@${domain}`;
  }
  return raw.length > 4 ? `${raw.slice(0, 2)}***${raw.slice(-2)}` : raw;
}

function buildProfile(resume: Row | null): Record<string, any> | null {
  if (!resume) return null;
  const parsed = normalizeResumeFields(parseJson(resume.parsed_data));
  const educationHistory = parseJson(parsed.education) || parseJson(resume.education);
  const workExperience = parseJson(parsed.work_experience) || parseJson(resume.work_experience);
  const skills = asList(parsed.skills || resume.skills);
  const certifications = asList(parsed.certifications || resume.certifications);
  return {
    highest_degree: firstText(parsed.highest_degree, resume.education),
    school: firstText(parsed.school, resume.school),
    major: firstText(parsed.major, resume.major),
    years_of_experience: firstText(parsed.years_of_experience, resume.work_experience_years),
    recent_company: firstText(parsed.recent_company, resume.recent_company),
    gender: firstText(parsed.gender, resume.gender),
    birthday: firstText(parsed.birthday, resume.birthday),
    age: parsed.age ?? resume.age ?? null,
    current_title: firstText(parsed.current_position, resume.current_title),
    skills,
    certifications,
    self_evaluation: firstText(parsed.self_evaluation, resume.self_evaluation),
    work_experience: Array.isArray(workExperience) ? workExperience : [],
    education_history: Array.isArray(educationHistory) ? educationHistory : [],
  };
}

function buildAiEvaluation(resume: Row | null): Record<string, any> | null {
  if (!resume) return null;
  const raw = normalizeScreeningEvaluation(resume.ai_evaluation);
  const capability = parseJson(resume.capability_scores);
  const source = raw && Object.keys(raw).length > 0 ? raw : capability;
  const dimensions = normalizeDimensionScores(source);
  const listFrom = (...values: unknown[]) => values.flatMap(asList);
  const available = Boolean(
    resume.ai_evaluation || resume.ai_review || resume.match_score !== null && resume.match_score !== undefined
      || dimensions.length || resume.screening_result,
  );
  if (!available) return null;
  const overallScore = Number.isFinite(Number(resume.match_score)) ? Number(resume.match_score) : null;
  return {
    overall_score: overallScore,
    overall_score_max: overallScore !== null && overallScore <= 5 ? 5 : 100,
    screening_result: text(resume.screening_result, 'pending'),
    screening_reason: firstText(source?.screening_reason, source?.conclusion, source?.summary, resume.ai_review),
    summary: firstText(source?.summary, resume.ai_review),
    dimensions,
    strengths: listFrom(source?.strengths, source?.advantages, source?.highlights),
    risks: listFrom(source?.risks, source?.risk_points, source?.risk),
    suggested_questions: listFrom(source?.suggested_questions, source?.interview_questions, source?.questions),
    hard_requirement_result: parseJson(resume.hard_requirement_result) || resume.hard_requirement_result || null,
  };
}

export function deriveCurrentStatus(resume: Row | null, interviews: Row[]): { code: string; label: string; source: string; updated_at: string | null } {
  if (!resume) {
    const interviewFailed = interviews.some((row) => row.result === 'failed' || row.result2 === 'failed' || row.status === 'failed');
    if (interviewFailed) return { code: 'interview_failed', label: '面试未通过', source: 'interview', updated_at: interviews[0]?.updated_at || null };
    if (interviews.some((row) => row.status === 'scheduled' || row.status === 'in_progress')) {
      return { code: 'pending_interview', label: '待面试', source: 'interview', updated_at: interviews[0]?.updated_at || null };
    }
    if (interviews.some((row) => row.result === 'passed' || row.result2 === 'passed')) {
      return { code: 'interview_passed', label: '面试通过', source: 'interview', updated_at: interviews[0]?.updated_at || null };
    }
    return { code: 'unknown', label: '待定', source: 'interview', updated_at: null };
  }
  const hrDisposition = text(resume.hr_disposition).toLowerCase();
  const businessStatus = text(resume.business_screening_status).toLowerCase();
  const interviewFailed = interviews.some((row) => row.result === 'failed' || row.result2 === 'failed' || row.status === 'failed');
  if (hrDisposition === 'rejected' || text(resume.status) === 'rejected' || text(resume.screening_result) === '不通过') {
    return { code: 'rejected', label: '已淘汰', source: 'hr', updated_at: resume.rejected_at || resume.updated_at || null };
  }
  if (businessStatus === 'rejected' || businessStatus === 'not_passed') {
    return { code: 'business_rejected', label: '业务不通过', source: 'business_screening', updated_at: resume.business_screened_at || resume.updated_at || null };
  }
  if (interviewFailed) {
    return { code: 'interview_failed', label: '面试未通过', source: 'interview', updated_at: resume.updated_at || null };
  }
  if (text(resume.status) === 'hired' || text(resume.stage) === 'hired') return { code: 'hired', label: '已入职', source: 'resume', updated_at: resume.updated_at || null };
  if (text(resume.status) === 'onboarding') return { code: 'onboarding', label: '入职中', source: 'resume', updated_at: resume.updated_at || null };
  if (interviews.some((row) => row.status === 'scheduled' || row.status === 'in_progress')) {
    return { code: 'pending_interview', label: '待面试', source: 'interview', updated_at: resume.updated_at || null };
  }
  if (businessStatus === 'pending' || businessStatus === 'ready') {
    return { code: 'pending_business_screening', label: '待业务筛选', source: 'business_screening', updated_at: resume.updated_at || null };
  }
  const code = text(resume.status, 'pending_screening');
  return { code, label: STATUS_LABELS[code] || '待定', source: 'resume', updated_at: resume.updated_at || null };
}

export function buildInterviewCardView(input: {
  card: Row;
  interview: Row | null;
  resume: Row | null;
  resumeLinkStatus: InterviewCardLinkStatus;
  interviews: Row[];
  timeline: Row[];
  fileAvailable: boolean;
  publicBaseUrl?: string;
}): Record<string, any> {
  const { card, interview, resume, resumeLinkStatus, interviews, timeline, fileAvailable } = input;
  const profile = buildProfile(resume);
  const currentInterview = interview || interviews[0] || null;
  const currentStatus = deriveCurrentStatus(resume, interviews);
  const resumeId = resume?.id || null;
  const candidateName = firstText(resume?.candidate_name, currentInterview?.candidate_name) || '未知候选人';
  const position = firstText(resume?.mapped_position, resume?.position_applied, currentInterview?.position_applied) || '未指定岗位';
  const ai = buildAiEvaluation(resume);
  const candidate = {
    resume_id: resumeId,
    resume_link_status: resumeLinkStatus,
    candidate_name: candidateName,
    position_applied: position,
    mapped_position: text(resume?.mapped_position),
    contact: maskContact(resume?.contact),
    profile,
    status: text(resume?.status),
    stage: text(resume?.stage),
    parse_status: text(resume?.parse_status),
    current_status: currentStatus,
    ai,
    hr: resume ? {
      decision: text(resume.hr_disposition, 'pending'),
      note: text(resume.hr_review) || null,
      updated_at: resume.updated_at || null,
    } : null,
    business_screening: resume ? {
      status: text(resume.business_screening_status, 'not_ready'),
      remark: text(resume.business_screening_remark) || null,
      screened_by: text(resume.business_screened_by) || null,
      screened_at: resume.business_screened_at || null,
    } : null,
    ocr_markdown: text(resume?.ocr_markdown, text(resume?.raw_text, text(resume?.resume_markdown))) || null,
    resume_file: {
      available: fileAvailable,
      preview_url: fileAvailable ? `/api/public/interview-card/${card.public_token || ''}/file?preview=1` : null,
      download_url: fileAvailable ? `/api/public/interview-card/${card.public_token || ''}/file` : null,
    },
  };
  return {
    card: {
      id: card.id,
      expires_at: card.expires_at,
      created_at: card.created_at,
      status: card.status,
    },
    candidate,
    interviews: interviews.map((row) => ({
      ...row,
      comments: parseJson(row.comments) || row.comments || null,
      scores: parseJson(row.scores) || row.scores || null,
    })),
    timeline: [...timeline].sort((a, b) => String(a.occurred_at || '').localeCompare(String(b.occurred_at || ''))),
  };
}
