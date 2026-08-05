import { describe, expect, it } from 'vitest';
import { aiScreeningResultFromScore, normalizeAiScreeningResult } from '../src/ai-screening-result';

describe('AI screening result', () => {
  it('uses only pass or fail at the existing 75-point threshold', () => {
    expect(aiScreeningResultFromScore(75)).toBe('通过');
    expect(aiScreeningResultFromScore(74)).toBe('不通过');
    expect(aiScreeningResultFromScore(60)).toBe('不通过');
    expect(aiScreeningResultFromScore(null)).toBe('不通过');
  });

  it('normalizes legacy uncertain and eliminated labels to fail', () => {
    expect(normalizeAiScreeningResult('存疑')).toBe('不通过');
    expect(normalizeAiScreeningResult('淘汰')).toBe('不通过');
    expect(normalizeAiScreeningResult('通过')).toBe('通过');
    expect(normalizeAiScreeningResult('推荐')).toBe('通过');
    expect(normalizeAiScreeningResult('')).toBe('');
  });
});
