import { describe, expect, it } from 'vitest';
import { getDimensionScoreTotal, normalizeResumeEvaluation } from '../../frontend/src/utils/resumeEvaluation';

describe('normalizeResumeEvaluation', () => {
  it('preserves modern dimension arrays for card rendering', () => {
    expect(normalizeResumeEvaluation({
      ai_evaluation: { dimensions: [{ name: '沟通', score: 4, reason: '表达清晰' }] },
    }).dimensions).toEqual([{ name: '沟通', score: 4, reason: '表达清晰' }]);
  });

  it('normalizes legacy object scores to the five-point display scale', () => {
    expect(normalizeResumeEvaluation({
      ai_evaluation: { dimensions: { '业务能力': 90, '协作能力': { score: 3, reason: '需要复核' } } },
    }).dimensions).toEqual([
      { name: '业务能力', score: 4.5, reason: '' },
      { name: '协作能力', score: 3, reason: '需要复核' },
    ]);
  });

  it('falls back to ai_review when ai_evaluation has no usable dimensions', () => {
    expect(normalizeResumeEvaluation({
      ai_evaluation: { summary: '只有摘要' },
      ai_review: { dimensions: { '岗位匹配': 80 }, match_score: 80 },
    })).toMatchObject({
      dimensions: [{ name: '岗位匹配', score: 4, reason: '' }],
      overallScore: 80,
    });
  });

  it('recovers dimension scores from legacy AI evaluation text', () => {
    expect(normalizeResumeEvaluation({
      ai_evaluation: '能力维度匹配：\n  - **沟通能力：4/5分。依据：表达清晰**',
    }).dimensions).toEqual([{ name: '沟通能力', score: 4, reason: '表达清晰' }]);
  });

  it('calculates the total score and five-point maximum for card display', () => {
    expect(getDimensionScoreTotal([
      { name: '沟通能力', score: 4, reason: '' },
      { name: '业务能力', score: 3.5, reason: '' },
      { name: '协作能力', score: 5, reason: '' },
      { name: '服务意识', score: 2.5, reason: '' },
    ])).toEqual({ total: 15, maximum: 20 });
  });
});
