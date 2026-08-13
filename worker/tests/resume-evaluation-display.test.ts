import { describe, expect, it } from 'vitest';
import { asDisplayTextList, getDimensionScoreTotal, normalizeResumeEvaluation } from '../../frontend/src/utils/resumeEvaluation';

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
      overallScore: 4,
    });
  });

  it('uses the real nested evaluation instead of displaying the outer zero scores and JSON summary', () => {
    const nested = {
      match_score: 58,
      summary: '候选人具备端云 AI 产品经验，但岗位核心经验不足。',
      dimensions: [
        { name: '核心画像', score: 3, reason: '有相关经历' },
        { name: '关键词匹配', score: 2, reason: '缺少关键字' },
      ],
    };
    const result = normalizeResumeEvaluation({
      ai_evaluation: {
        summary: JSON.stringify(nested),
        dimensions: [
          { name: '核心画像', score: 0, reason: '' },
          { name: '关键词匹配', score: 0, reason: '' },
        ],
      },
    });

    expect(result.summary).toBe(nested.summary);
    expect(result.dimensions).toEqual([
      { name: '核心画像', score: 3, reason: '有相关经历' },
      { name: '关键词匹配', score: 2, reason: '缺少关键字' },
    ]);
  });

  it('hides an unparseable prompt-like summary instead of showing fake zero scores', () => {
    const result = normalizeResumeEvaluation({
      ai_evaluation: {
        summary: '# 人才能力评估AI打分提示词\n```json\n{ invalid output',
        dimensions: [
          { name: '核心画像', score: 0, reason: '' },
          { name: '关键词匹配', score: 0, reason: '' },
        ],
      },
    });

    expect(result.summary).toBe('评估结果格式异常，请重新评估');
    expect(result.dimensions).toEqual([]);
  });

  it('prefers a more complete nested score set over partially parsed outer scores', () => {
    const nested = {
      summary: '完整内层评价',
      dimensions: [
        { name: '核心画像', score: 3 },
        { name: '核心职责', score: 3 },
        { name: '任职要求', score: 4 },
      ],
    };
    const result = normalizeResumeEvaluation({
      ai_evaluation: {
        summary: JSON.stringify(nested),
        dimensions: [{ name: '核心画像', score: 1 }],
      },
    });

    expect(result.summary).toBe('完整内层评价');
    expect(result.dimensions).toHaveLength(3);
    expect(result.dimensions[0].score).toBe(3);
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

  it('turns legacy AI string lists into safe display arrays', () => {
    expect(asDisplayTextList('优势一\n优势二')).toEqual(['优势一', '优势二']);
    expect(asDisplayTextList(['优势一'])).toEqual(['优势一']);
    expect(asDisplayTextList(null)).toEqual([]);
  });
});
