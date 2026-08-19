import { describe, expect, it } from 'vitest';
import {
  normalizeBusinessScreeningTitle,
  DEFAULT_BUSINESS_SCREENING_TITLE,
} from '../src/business-screening/display-title';

describe('normalizeBusinessScreeningTitle', () => {
  it('trims whitespace and removes wrapping quotes', () => {
    expect(normalizeBusinessScreeningTitle('  “AI 初筛通过表”  ')).toBe('AI 初筛通过表');
  });

  it('removes wrapping quotes exposed after delivery suffix cleanup', () => {
    expect(normalizeBusinessScreeningTitle('“AI 初筛通过表” 给我链接')).toBe('AI 初筛通过表');
  });

  it('removes control characters and limits length', () => {
    const result = normalizeBusinessScreeningTitle(`AI\n初筛${'x'.repeat(100)}`);
    expect(result).toHaveLength(60);
    expect(result).not.toContain('\n');
  });

  it('rejects empty, action-only, and polite action-only text', () => {
    expect(normalizeBusinessScreeningTitle('')).toBeNull();
    expect(normalizeBusinessScreeningTitle('给我链接')).toBeNull();
    expect(normalizeBusinessScreeningTitle('请给我链接')).toBeNull();
    expect(normalizeBusinessScreeningTitle('麻烦发链接')).toBeNull();
    for (const action of ['查询', '查看', '获取', '给我', '看', '拿到', '发我']) {
      expect(normalizeBusinessScreeningTitle(action)).toBeNull();
      expect(normalizeBusinessScreeningTitle(`请${action}`)).toBeNull();
      expect(normalizeBusinessScreeningTitle(`麻烦${action}`)).toBeNull();
    }
    expect(normalizeBusinessScreeningTitle('查询 AI 初筛通过表')).toBe('查询 AI 初筛通过表');
    expect(DEFAULT_BUSINESS_SCREENING_TITLE).toBe('业务筛选');
  });

  it('does not use a resume count as the public page title', () => {
    expect(normalizeBusinessScreeningTitle('100份')).toBeNull();
    expect(normalizeBusinessScreeningTitle('100份简历')).toBeNull();
    expect(normalizeBusinessScreeningTitle('AI 初筛通过表')).toBe('AI 初筛通过表');
  });
});
