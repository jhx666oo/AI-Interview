import { describe, expect, it } from 'vitest';
import {
  getActiveGateDimensions,
  getWeightedDimensions,
  resolveEffectiveScreeningDimensions,
} from '../src/resume-processing/screening-dimensions';

describe('screening dimension protocol', () => {
  it('keeps a configured four-dimension position exactly as configured', () => {
    const result = resolveEffectiveScreeningDimensions([
      { name: '加分项', weight: 10 },
      { name: '关键词匹配', weight: null },
      { name: '核心职责', weight: 45 },
      { name: '任职要求', weight: 45 },
    ]);

    expect(result.map(item => item.name)).toEqual(['加分项', '关键词匹配', '核心职责', '任职要求']);
    expect(getActiveGateDimensions(result).map(item => item.name)).toEqual(['关键词匹配']);
    expect(getWeightedDimensions(result).map(item => item.name)).toEqual(['加分项', '核心职责', '任职要求']);
  });

  it.each([3, 5, 6, 8])('supports any configured dimension count: %s', (count) => {
    const configured = Array.from({ length: count }, (_, index) => ({ name: `维度${index + 1}`, weight: 1 }));
    expect(resolveEffectiveScreeningDimensions(configured)).toHaveLength(count);
  });

  it('uses the legacy seven dimensions only when configuration is empty', () => {
    const result = resolveEffectiveScreeningDimensions([]);
    expect(result).toHaveLength(7);
    expect(result.map(item => item.name)).toEqual([
      '核心画像', '核心职责', '任职要求', '企业背景', '加分项', '关键词匹配', '避坑雷区',
    ]);
  });

  it('trims and deduplicates configured dimensions by first occurrence', () => {
    const result = resolveEffectiveScreeningDimensions([
      { name: ' 核心职责 ', weight: 20 },
      { name: '核心职责', weight: 40 },
      { name: '  ', weight: 10 },
    ]);

    expect(result).toEqual([
      { name: '核心职责', description: '', weight: 20, isGate: false },
    ]);
  });

  it('does not activate an unconfigured gate', () => {
    const result = resolveEffectiveScreeningDimensions([
      { name: '任职要求', weight: 100 },
    ]);

    expect(getActiveGateDimensions(result)).toEqual([]);
  });
});
