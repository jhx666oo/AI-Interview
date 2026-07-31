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

export async function processResume(
  message: ResumeQueueMessage,
  deps: ResumeProcessorDeps,
): Promise<void> {
  const resume = await deps.getResume(message.resumeId);
  if (!resume) throw new Error('RESUME_NOT_FOUND');

  await deps.setJobStep(message.jobId, 'extracting_text');
  const text = await deps.getText(resume);
  if (text.trim().length < 20) throw new Error('RESUME_TEXT_UNAVAILABLE');
  await deps.updateResume(message.resumeId, { raw_text: text, parse_status: 'extracting_fields' });

  let fields = jsonObject(resume.parsed_data);
  if (!fields) {
    await deps.setJobStep(message.jobId, 'extracting_fields');
    fields = await deps.extractFields(text, resume);
    await deps.updateResume(message.resumeId, { parsed_data: JSON.stringify(fields), parse_status: 'screening' });
  }

  if (!jsonObject(resume.ai_evaluation)) {
    await deps.setJobStep(message.jobId, 'screening');
    const result = await deps.screen(text, fields, resume);
    await deps.updateResume(message.resumeId, {
      ai_evaluation: JSON.stringify(result),
      parse_status: 'ai_screened',
    });
  }
}
