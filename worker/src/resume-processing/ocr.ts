type ResumeForOcr = {
  id: string;
  raw_text: string | null;
  ocr_markdown: string | null;
  ocr_task_id: string | null;
};

type OcrDeps = {
  getFile(resumeId: string): Promise<{ content: string } | null>;
  startOcr(fileBase64: string, resumeId: string): Promise<{ taskId: string }>;
  getOcrStatus(taskId: string): Promise<{ state: 'processing' | 'done' | 'failed'; markdown?: string; error?: string }>;
  update(resumeId: string, update: Record<string, unknown>): Promise<void>;
};

export type ResolvedResumeText =
  | { state: 'ready'; text: string; source: 'raw_text' | 'ocr_markdown' }
  | { state: 'pending' }
  | { state: 'failed'; error: string };

export async function resolveResumeText(resume: ResumeForOcr, deps: OcrDeps): Promise<ResolvedResumeText> {
  if (resume.ocr_markdown && resume.ocr_markdown.length >= 20) {
    return { state: 'ready', text: resume.ocr_markdown, source: 'ocr_markdown' };
  }
  if (resume.raw_text && resume.raw_text.length >= 20) {
    return { state: 'ready', text: resume.raw_text, source: 'raw_text' };
  }

  if (!resume.ocr_task_id) {
    const file = await deps.getFile(resume.id);
    if (!file?.content) return { state: 'failed', error: 'RESUME_FILE_NOT_FOUND' };
    const task = await deps.startOcr(file.content, resume.id);
    await deps.update(resume.id, { ocr_task_id: task.taskId, ocr_status: 'ocr_processing' });
    return { state: 'pending' };
  }

  const status = await deps.getOcrStatus(resume.ocr_task_id);
  if (status.state === 'processing') return { state: 'pending' };
  if (status.state === 'failed') return { state: 'failed', error: status.error || 'OCR_FAILED' };
  if (!status.markdown || status.markdown.length < 20) return { state: 'failed', error: 'OCR_EMPTY_RESULT' };

  await deps.update(resume.id, { ocr_markdown: status.markdown, ocr_status: 'ocr_done' });
  return { state: 'ready', text: status.markdown, source: 'ocr_markdown' };
}
