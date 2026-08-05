import { describe, expect, it } from 'vitest';
import {
  buildR2ExtractionPrompt,
  buildR2OcrSignRequest,
  buildR2OcrStatusUrl,
  buildR2ScreeningPrompt,
  buildR2SupplementalPrompt,
} from '../src/resume-consumer';

describe('R2 resume consumer inputs', () => {
  it('interpolates the actual MinerU base URL, resume id, and task id', () => {
    expect(buildR2OcrSignRequest('https://ocr.example.test/', 'resume-42')).toEqual({
      url: 'https://ocr.example.test/api/v1/agent/parse/file',
      fileName: 'resume-42.pdf',
    });
    expect(buildR2OcrStatusUrl('https://ocr.example.test/', 'task-99'))
      .toBe('https://ocr.example.test/api/v1/agent/parse/task-99');
  });

  it('puts real resume text, position, fields, and missing names into AI prompts', () => {
    const text = '候选人张三在家政服务行业有5年经验';
    const fields = { school: '复旦大学', years_of_experience: 5 };
    expect(buildR2ExtractionPrompt(text)).toContain(text);
    const screening = buildR2ScreeningPrompt({
      position: '高级产品经理',
      capabilityDimensions: '核心画像、任职要求',
      fields,
      text,
    });
    expect(screening).toContain('高级产品经理');
    expect(screening).toContain('复旦大学');
    expect(screening).toContain(text);
    expect(screening).not.toContain('${');
    const supplemental = buildR2SupplementalPrompt(text, ['关键词匹配', '避坑雷区']);
    expect(supplemental).toContain(text);
    expect(supplemental).toContain('关键词匹配、避坑雷区');
    expect(supplemental).not.toContain('${');
  });
});
