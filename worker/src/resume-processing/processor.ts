import type { ResumeJobStep, ResumeQueueMessage } from './types';

type ResumeRow = {
  id: string;
  raw_text: string | null;
  parsed_data: string | null;
  ai_evaluation: string | null;
  [key: string]: unknown;
};

export type ResumeProcessorDeps = {
  getResume(resumeId: string): Promise<ResumeRow | null>;
  getText(resume: ResumeRow): Promise<string>;
  extractFields(text: string, resume: ResumeRow): Promise<Record<string, unknown>>;
  screen(text: string, fields: Record<string, unknown>, resume: ResumeRow): Promise<Record<string, unknown>>;
  updateResume(resumeId: string, update: Record<string, unknown>): Promise<void>;
  setJobStep(jobId: string, step: ResumeJobStep): Promise<void>;
  assertJobRunning(jobId: string): Promise<void>;
};

function jsonObject(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function hasExtractedFields(fields: Record<string, unknown> | null): fields is Record<string, unknown> {
  return fields?._fields_extracted === true;
}

const LEGACY_FIELD_KEYS = [
  'phone', 'email', 'gender', 'birthday', 'age',
  'highest_degree', 'school', 'major', 'years_of_experience',
  'recent_company', 'current_position', 'skills', 'certifications',
  'self_evaluation', 'work_experience', 'education',
];

function hasAnyLegacyField(fields: Record<string, unknown> | null): boolean {
  if (!fields) return false;
  return LEGACY_FIELD_KEYS.some((key) => {
    const value = fields[key];
    return Array.isArray(value)
      ? value.length > 0
      : value !== null && value !== undefined && String(value).trim() !== '';
  });
}

export async function processResume(
  message: ResumeQueueMessage,
  deps: ResumeProcessorDeps,
): Promise<void> {
  const resume = await deps.getResume(message.resumeId);
  if (!resume) throw new Error('RESUME_NOT_FOUND');

  await deps.setJobStep(message.jobId, 'extracting_text');
  const text = await deps.getText(resume);
  if (text.trim().length < 20) throw new Error('RESUME_TEXT_UNAVAILABLE');
  await deps.assertJobRunning(message.jobId);
  await deps.updateResume(message.resumeId, message.reprocess
    ? { parse_status: 'extracting_fields' }
    : { raw_text: text, parse_status: 'extracting_fields' });

  let fields = jsonObject(resume.parsed_data);
  // 新上传记录只有姓名/岗位元数据，不能把它们当作字段提取完成。
  // 已有 AI 结果的历史记录保持兼容，只有显式 reprocess 才强制重提字段。
  const shouldExtractFields = Boolean(message.reprocess)
    || (!hasExtractedFields(fields)
      && (!jsonObject(resume.ai_evaluation) || !hasAnyLegacyField(fields)));
  if (shouldExtractFields) {
    await deps.setJobStep(message.jobId, 'extracting_fields');
    const extractedFields = await deps.extractFields(text, resume);
    // 保留原有元数据（source、position_applied、standard_position 等），仅覆盖真实字段，避免来源信息丢失
    const mergedFields = {
      ...(jsonObject(resume.parsed_data) || {}),
      ...extractedFields,
      _fields_extracted: true,
    };
    await deps.assertJobRunning(message.jobId);
    fields = mergedFields;
    await deps.updateResume(message.resumeId, { parsed_data: JSON.stringify(mergedFields), parse_status: 'screening' });
  }

  if (message.reprocess || !jsonObject(resume.ai_evaluation)) {
    await deps.setJobStep(message.jobId, 'screening');
    const result = await deps.screen(text, fields, resume);
    await deps.assertJobRunning(message.jobId);
    await deps.updateResume(message.resumeId, {
      ai_review: JSON.stringify(result),
      ai_evaluation: JSON.stringify(result),
      match_score: result.weighted_score ?? null,
      screening_result: result.screening_result ?? '不通过',
      hard_requirement_result: JSON.stringify(result.hard_requirement_result || {
        passed: true,
        unmet_items: [],
        unknown_items: [],
        message: '无硬性要求配置',
      }),
      parse_status: 'ai_screened',
    });
  } else {
    // 补字段任务不应把已有评估的简历永久留在 screening 状态。
    await deps.assertJobRunning(message.jobId);
    await deps.updateResume(message.resumeId, { parse_status: 'ai_screened' });
  }
}
