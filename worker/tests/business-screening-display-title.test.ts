import { describe, expect, it } from 'vitest';
import {
  normalizeBusinessScreeningTitle,
  DEFAULT_BUSINESS_SCREENING_TITLE,
} from '../src/business-screening/display-title';

describe('normalizeBusinessScreeningTitle', () => {
  it('trims whitespace and removes wrapping quotes', () => {
    expect(normalizeBusinessScreeningTitle('  “AI 初筛通过表”  ')).toBe('AI 初筛通过表');
  });

  it('removes control characters and limits length', () => {
    const result = normalizeBusinessScreeningTitle(`AI\n初筛${'x'.repeat(100)}`);
    expect(result).toHaveLength(60);
    expect(result).not.toContain('\n');
  });

  it('rejects empty or action-only text', () => {
    expect(normalizeBusinessScreeningTitle('')).toBeNull();
    expect(normalizeBusinessScreeningTitle('给我链接')).toBeNull();
    expect(DEFAULT_BUSINESS_SCREENING_TITLE).toBe('业务筛选');
  });
});
