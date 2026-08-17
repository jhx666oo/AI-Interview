import { describe, expect, it } from 'vitest';
import {
  filterDimensionScoresToConfigured,
  requireCompleteScreeningEvaluation,
} from '../src/resume-processing/dimension-scores';
import { buildScreeningRepairPrompt, parseStructuredOutput } from '../src/resume-processing/structured-output';
import { evaluateWeightedScreening } from '../src/resume-processing/weighted-screening';
import { enrichScreeningEvaluation } from '../src/index';

const NURSE_DIMENSIONS = ['加分项', '关键词匹配', '核心职责', '任职要求'];
const FOUR_SCORES = NURSE_DIMENSIONS.map(name => ({ name, score: 4, reason: '简历有明确依据' }));

describe('dynamic screening evaluation contract', () => {
  it('accepts a complete custom four-dimension screening result', async () => {
    const result = await parseStructuredOutput(
      JSON.stringify({ summary: '护士岗位匹配良好', dimensions: FOUR_SCORES }),
      'screening',
      JSON.parse,
      async () => { throw new Error('repair should not run'); },
      NURSE_DIMENSIONS,
    );

    expect(result.value).toMatchObject({ summary: '护士岗位匹配良好' });
    expect(result.diagnostics.dimensionNames).toEqual(NURSE_DIMENSIONS);
  });

  it('repairs a custom result using only the configured dimensions', async () => {
    const repairPrompt = buildScreeningRepairPrompt(
      'screening',
      '{"summary":"不完整"}',
      'AI_SCREENING_INVALID_DIMENSIONS',
      NURSE_DIMENSIONS,
    );

    expect(repairPrompt.user).toContain(NURSE_DIMENSIONS.join('、'));
    expect(repairPrompt.user).not.toContain('核心画像');
    expect(repairPrompt.user).not.toContain('完整的七项');
  });

  it('validates completeness against custom names instead of the legacy seven', () => {
    expect(() => requireCompleteScreeningEvaluation({
      summary: '护士岗位评估',
      dimensions: FOUR_SCORES,
    }, NURSE_DIMENSIONS)).not.toThrow();
  });

  it('filters model-added dimensions before persistence', () => {
    const persisted = filterDimensionScoresToConfigured([
      ...FOUR_SCORES,
      { name: '核心画像', score: 5, reason: '模型额外输出' },
    ], NURSE_DIMENSIONS);

    expect(persisted.map(item => item.name)).toEqual(NURSE_DIMENSIONS);
  });

  it('allows a supplemental response to contain only the dimensions it was asked to fill', async () => {
    const result = await parseStructuredOutput(
      JSON.stringify({ dimensions: [{ name: '核心职责', score: 3, reason: '信息有限' }] }),
      'dimensions',
      JSON.parse,
      async () => { throw new Error('repair should not run'); },
      ['核心职责'],
    );

    expect(result.value).toEqual([{ name: '核心职责', score: 3, reason: '信息有限' }]);
  });

  it('does not require an unconfigured red-flag gate', () => {
    const result = evaluateWeightedScreening({ dimensions: FOUR_SCORES }, [
      { name: '加分项', weight: 10 },
      { name: '关键词匹配', weight: null },
      { name: '核心职责', weight: 45 },
      { name: '任职要求', weight: 45 },
    ], { keyword_match_min_score: 2, red_flag_min_score: 5, weighted_score_min: 3.5 });

    expect(result.screening_result).toBe('通过');
    expect(result.gate_results).toEqual({
      keyword_match: { score: 4, passed: true },
    });
    expect(result.dimensions).toHaveLength(4);
  });

  it('uses equal weighting when custom ordinary dimensions have no positive weights', () => {
    const result = evaluateWeightedScreening({
      dimensions: [
        { name: '能力A', score: 5 },
        { name: '能力B', score: 3 },
      ],
    }, [{ name: '能力A', weight: 0 }, { name: '能力B', weight: 0 }]);

    expect(result.weighted_score).toBe(4);
  });

  it('rejects a position that has no ordinary dimensions to score', () => {
    const result = evaluateWeightedScreening({
      dimensions: [{ name: '关键词匹配', score: 5 }],
    }, [{ name: '关键词匹配', weight: null }]);

    expect(result.weighted_score).toBeNull();
    expect(result.screening_result).toBe('不通过');
    expect(result.screening_reason).toContain('普通能力维度');
  });

  it('persists only the current position dimensions and does not restore legacy dimensions', () => {
    const result = enrichScreeningEvaluation({
      match_score: 99,
      summary: '护士岗位评估',
      dimensions: FOUR_SCORES,
    }, NURSE_DIMENSIONS.map((name) => ({ name, weight: name === '关键词匹配' ? null : 25 })), [], {});

    expect(result.dimensions.map((item: { name: string }) => item.name)).toEqual(NURSE_DIMENSIONS);
    expect(result.configured_dimensions.map((item: { name: string }) => item.name)).toEqual(NURSE_DIMENSIONS);
    expect(result.gate_results).toEqual({ keyword_match: { score: 4, passed: true } });
    expect(result.screening_result).toBe('通过');
  });
});
