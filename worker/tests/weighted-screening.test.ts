import { describe, expect, it } from 'vitest';
import { evaluateWeightedScreening } from '../src/resume-processing/weighted-screening';
import { enrichScreeningEvaluation } from '../src/index';

const config = [
  { name: '核心画像', weight: 25 }, { name: '核心职责', weight: 22 },
  { name: '任职要求', weight: 22 }, { name: '企业背景', weight: 13 },
  { name: '关键词匹配', weight: 8 }, { name: '加分项', weight: 10 },
  { name: '避坑雷区', weight: 8 },
];

describe('evaluateWeightedScreening', () => {
  it('rejects when keyword gate is below five without calculating a score', () => {
    const result = evaluateWeightedScreening({ dimensions: config.map(d => ({ name: d.name, score: d.name === '关键词匹配' ? 4 : 5 })) }, config);
    expect(result.screening_result).toBe('不通过');
    expect(result.weighted_score).toBeNull();
    expect(result.screening_reason).toContain('关键词');
  });

  it('rejects when the red-flag gate is below five', () => {
    const result = evaluateWeightedScreening({ dimensions: config.map(d => ({ name: d.name, score: d.name === '避坑雷区' ? 3 : 5 })) }, config);
    expect(result.screening_result).toBe('不通过');
    expect(result.weighted_score).toBeNull();
    expect(result.screening_reason).toContain('避坑');
  });

  it('calculates only the five scoring dimensions after both gates pass', () => {
    const result = evaluateWeightedScreening({ dimensions: config.map(d => ({ name: d.name, score: 5 })) }, config);
    expect(result.weighted_score).toBe(5);
    expect(result.screening_result).toBe('通过');
  });

  it('normalizes only a partially configured positive scoring vector', () => {
    const result = evaluateWeightedScreening({
      dimensions: [
        { name: '核心画像', score: 1 }, { name: '核心职责', score: 5 },
        { name: '任职要求', score: 5 }, { name: '企业背景', score: 5 },
        { name: '加分项', score: 5 }, { name: '关键词匹配', score: 5 },
        { name: '避坑雷区', score: 5 },
      ],
    }, [{ name: '核心画像', weight: 100 }]);

    expect(result.weighted_score).toBe(1);
    expect(result.screening_result).toBe('不通过');
  });

  it('preserves explicit zero weights when other scoring weights are positive', () => {
    const result = evaluateWeightedScreening({
      dimensions: config.map(({ name }) => ({ name, score: name === '核心画像' ? 5 : name === '核心职责' ? 1 : 5 })),
    }, [
      { name: '核心画像', weight: 0 },
      { name: '核心职责', weight: 100 },
      { name: '任职要求', weight: 0 },
      { name: '企业背景', weight: 0 },
      { name: '加分项', weight: 0 },
    ]);

    expect(result.weighted_score).toBe(1);
  });

  it('uses the complete canonical default vector only when no scoring weight is positive', () => {
    const scores = config.map(({ name }) => ({ name, score: name === '核心画像' ? 1 : 5 }));
    const withoutConfig = evaluateWeightedScreening({ dimensions: scores }, []);
    const allZero = evaluateWeightedScreening({ dimensions: scores }, config.map(({ name }) => ({ name, weight: 0 })));

    expect(withoutConfig.weighted_score).toBe(3.9);
    expect(allZero.weighted_score).toBe(3.9);
  });

  it('keeps the canonical fallback through compatibility normalization for an all-zero stored config', () => {
    const result = enrichScreeningEvaluation({
      dimensions: config.map(({ name }) => ({ name, score: name === '核心画像' ? 1 : 5 })),
    }, config.map(({ name }) => ({ name, weight: 0 })));

    expect(result.weighted_score).toBe(3.9);
  });

  it('uses four as the pass boundary and treats missing gate dimensions as zero', () => {
    const scores = { '核心画像': 4, '核心职责': 4, '任职要求': 4, '企业背景': 4, '加分项': 4, '关键词匹配': 5, '避坑雷区': 5 };
    const result = evaluateWeightedScreening({ dimensions: Object.entries(scores).map(([name, score]) => ({ name, score })) }, config);
    expect(result.weighted_score).toBe(4);
    expect(result.screening_result).toBe('通过');
    expect(evaluateWeightedScreening({ dimensions: [] }, config).screening_reason).toContain('关键词');
  });

  it('makes the compatibility evaluator persist the five-point weighted result instead of AI match_score', () => {
    const result = enrichScreeningEvaluation({
      match_score: 62,
      dimensions: config.map(({ name }) => ({ name, score: 5, reason: '满足要求' })),
    }, config);

    expect(result.dimensions).toHaveLength(7);
    expect(result.weighted_score).toBe(5);
    expect(result.match_score).toBe(5);
    expect(result.screening_result).toBe('通过');
    expect(result.screening_reason).toBe('五项能力加权分达到 4 分');
    expect(result.gate_results).toEqual({
      keyword_match: { score: 5, passed: true },
      red_flag: { score: 5, passed: true },
    });
  });
});
