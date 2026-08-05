import { describe, expect, it } from 'vitest';
import {
  formatWeightedScore,
  getScreeningGateRows,
  normalizeResumeEvaluation,
} from './resumeEvaluation';

describe('weighted screening display', () => {
  it('uses weighted_score before legacy match_score and formats it on a five-point scale', () => {
    const evaluation = normalizeResumeEvaluation({
      match_score: 84,
      weighted_score: 4.2,
      ai_evaluation: {
        match_score: 84,
        gate_results: {
          keyword_match: { score: 5, passed: true },
          red_flag: { score: 5, passed: true },
        },
      },
    });

    expect(evaluation.overallScore).toBe(4.2);
    expect(formatWeightedScore(evaluation.overallScore)).toBe('4.2/5');
  });

  it('shows each failed hard gate with its user-facing failure reason', () => {
    const evaluation = normalizeResumeEvaluation({
      weighted_score: null,
      gate_results: {
        keyword_match: { score: 4, passed: false },
        red_flag: { score: 3, passed: false },
      },
      screening_reason: '关键词匹配未达 5 分；命中避坑雷区',
      ai_evaluation: {
        weighted_score: null,
        gate_results: {
          keyword_match: { score: 4, passed: false },
          red_flag: { score: 3, passed: false },
        },
        screening_reason: '关键词匹配未达 5 分；命中避坑雷区',
      },
    });

    expect(formatWeightedScore(evaluation.overallScore)).toBe('—');
    expect(getScreeningGateRows(evaluation)).toEqual([
      { key: 'keyword_match', label: '关键词匹配', passed: false, reason: '关键词匹配未达 5 分' },
      { key: 'red_flag', label: '避坑雷区', passed: false, reason: '命中避坑雷区' },
    ]);
  });

  it('shows only gates reported by the API instead of treating an absent gate as failed', () => {
    const evaluation = normalizeResumeEvaluation({
      weighted_score: 4.2,
      gate_results: {
        keyword_match: { score: 5, passed: true },
      },
    });

    expect(getScreeningGateRows(evaluation)).toEqual([
      { key: 'keyword_match', label: '关键词匹配', passed: true, reason: '已通过' },
    ]);
  });

  it('suppresses a weighted score whenever a reported gate fails', () => {
    const evaluation = normalizeResumeEvaluation({
      weighted_score: 4.2,
      gate_results: {
        keyword_match: { score: 5, passed: true },
        red_flag: { score: 4, passed: false },
      },
    });

    expect(evaluation.overallScore).toBeNull();
    expect(formatWeightedScore(evaluation.overallScore)).toBe('—');
  });
});
