import { describe, expect, it } from 'vitest';
import {
  filterDimensionScoresToConfigured,
  mergeConfiguredDimensionScores,
  missingDimensionNames,
  normalizeScreeningEvaluation,
  requireCompleteScreeningEvaluation,
  hasAllDimensionScores,
  normalizeDimensionScores,
} from '../src/resume-processing/dimension-scores';
import { WEIGHTED_SCREENING_DIMENSION_NAMES } from '../src/resume-processing/weighted-screening';

describe('dimension score helpers', () => {
  it('identifies configured dimensions absent from an empty AI result', () => {
    expect(missingDimensionNames(['运营', '沟通'], { dimensions: [] })).toEqual(['运营', '沟通']);
  });

  it('normalizes the supplemental scores response for card rendering', () => {
    expect(normalizeDimensionScores({ scores: [{ dimension: '运营', score: 3, reason: '有相关经验' }] }))
      .toEqual([{ name: '运营', score: 3, reason: '有相关经验' }]);
  });

  it('keeps a supplemental response returned as a bare JSON array', () => {
    expect(normalizeDimensionScores([
      { name: '运营', score: 3, reason: '有相关经验' },
    ])).toEqual([{ name: '运营', score: 3, reason: '有相关经验' }]);
  });

  it('filters extra AI dimensions and preserves configured order', () => {
    expect(filterDimensionScoresToConfigured([
      { name: '额外维度', score: 5, reason: '模型自行扩展' },
      { name: '沟通能力', score: 4, reason: '有跨部门经验' },
      { name: '沟通能力', score: 2, reason: '重复结果' },
      { name: '业务理解', score: 3, reason: '有相关项目' },
    ], ['业务理解', '沟通能力'])).toEqual([
      { name: '业务理解', score: 3, reason: '有相关项目' },
      { name: '沟通能力', score: 4, reason: '有跨部门经验' },
    ]);
  });

  it('supplements only missing configured dimensions', () => {
    expect(mergeConfiguredDimensionScores(
      [{ name: '沟通能力', score: 4, reason: '已有' }],
      [{ name: '业务理解', score: 3, reason: '补充' }, { name: '额外', score: 5, reason: '丢弃' }],
      ['沟通能力', '业务理解'],
    )).toEqual([
      { name: '沟通能力', score: 4, reason: '已有' },
      { name: '业务理解', score: 3, reason: '补充' },
    ]);
  });

  it('unwraps a complete evaluation accidentally nested inside summary', () => {
    const nested = {
      match_score: 58,
      recommendation: 'not_recommend',
      summary: '真实的候选人综合评价',
      dimensions: WEIGHTED_SCREENING_DIMENSION_NAMES.map((name, index) => ({
        name,
        score: index === 0 ? 3 : 5,
        reason: '来自简历原文',
      })),
    };
    const malformed = {
      summary: JSON.stringify(nested),
      dimensions: WEIGHTED_SCREENING_DIMENSION_NAMES.map((name) => ({ name, score: 0, reason: '' })),
    };

    const normalized = normalizeScreeningEvaluation(malformed);

    expect(normalized.summary).toBe('真实的候选人综合评价');
    expect(normalized.match_score).toBe(58);
    expect(normalizeDimensionScores(normalized)[0]).toMatchObject({ name: '核心画像', score: 3 });
  });

  it('rejects evaluation results that do not contain every weighted dimension', () => {
    expect(hasAllDimensionScores({ dimensions: [{ name: '核心画像', score: 3 }] }, WEIGHTED_SCREENING_DIMENSION_NAMES)).toBe(false);
    expect(hasAllDimensionScores({
      dimensions: WEIGHTED_SCREENING_DIMENSION_NAMES.map((name) => ({ name, score: 0 })),
    }, WEIGHTED_SCREENING_DIMENSION_NAMES)).toBe(true);
  });

  it('throws instead of allowing incomplete AI output to be persisted', () => {
    expect(() => requireCompleteScreeningEvaluation({
      summary: '只有摘要，没有能力评分',
      dimensions: [],
    })).toThrow('AI_SCREENING_INVALID_DIMENSIONS');
  });

  it('throws when the summary is still a prompt or code-like payload', () => {
    expect(() => requireCompleteScreeningEvaluation({
      summary: '# 人才能力评估AI打分提示词\n```json\n{ "dimensions": [] }',
      dimensions: WEIGHTED_SCREENING_DIMENSION_NAMES.map((name) => ({ name, score: 0 })),
    })).toThrow('AI_SCREENING_INVALID_SUMMARY');
  });
});
