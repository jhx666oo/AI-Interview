import { describe, expect, it } from 'vitest';
import { missingDimensionNames, normalizeDimensionScores } from '../src/resume-processing/dimension-scores';

describe('dimension score helpers', () => {
  it('identifies configured dimensions absent from an empty AI result', () => {
    expect(missingDimensionNames(['运营', '沟通'], { dimensions: [] })).toEqual(['运营', '沟通']);
  });

  it('normalizes the supplemental scores response for card rendering', () => {
    expect(normalizeDimensionScores({ scores: [{ dimension: '运营', score: 3, reason: '有相关经验' }] }))
      .toEqual([{ name: '运营', score: 3, reason: '有相关经验' }]);
  });
});
