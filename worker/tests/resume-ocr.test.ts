import { describe, expect, it, vi } from 'vitest';
import { resolveResumeText } from '../src/resume-processing/ocr';

describe('queue OCR text resolution', () => {
  it('starts OCR once and returns pending while MinerU works', async () => {
    const update = vi.fn();
    const result = await resolveResumeText({ id: 'resume-1', raw_text: null, ocr_markdown: null, ocr_task_id: null }, {
      getFile: async () => ({ content: 'cGRm' }),
      startOcr: async () => ({ taskId: 'task-1' }),
      getOcrStatus: async () => ({ state: 'processing' }),
      update,
    });
    expect(result).toEqual({ state: 'pending' });
    expect(update).toHaveBeenCalledWith('resume-1', { ocr_task_id: 'task-1', ocr_status: 'ocr_processing' });
  });

  it('returns persisted OCR markdown without starting a new task', async () => {
    const startOcr = vi.fn();
    const result = await resolveResumeText({ id: 'resume-1', raw_text: null, ocr_markdown: '已经解析好的简历文本，包含足够内容用于 AI 初筛。', ocr_task_id: null }, {
      getFile: async () => null,
      startOcr,
      getOcrStatus: async () => ({ state: 'processing' }),
      update: async () => undefined,
    });
    expect(result).toMatchObject({ state: 'ready' });
    expect(startOcr).not.toHaveBeenCalled();
  });
});
