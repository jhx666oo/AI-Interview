import { describe, expect, it } from 'vitest';
import {
  filterDimensionScoresToConfigured,
  mergeConfiguredDimensionScores,
  missingDimensionNames,
  normalizeDimensionScores,
} from '../src/resume-processing/dimension-scores';

describe('dimension score helpers', () => {
  it('identifies configured dimensions absent from an empty AI result', () => {
    expect(missingDimensionNames(['运营', '沟通'], { dimensions: [] })).toEqual(['运营', '沟通']);
  });

  it('normalizes the supplemental scores response for card rendering', () => {
    expect(normalizeDimensionScores({ scores: [{ dimension: '运营', score: 3, reason: '有相关经验' }] }))
      .toEqual([{ name: '运营', score: 3, reason: '有相关经验' }]);
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
});
