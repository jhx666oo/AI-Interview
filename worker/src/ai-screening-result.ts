export type AiScreeningResult = '通过' | '不通过';

export const AI_PASS_SCORE = 75;

export function aiScreeningResultFromScore(score: unknown): AiScreeningResult {
  const numericScore = Number(score);
  return Number.isFinite(numericScore) && numericScore >= AI_PASS_SCORE ? '通过' : '不通过';
}

/** Normalize legacy labels without exposing a third AI outcome to clients. */
export function normalizeAiScreeningResult(value: unknown): AiScreeningResult | '' {
  const label = String(value ?? '').trim();
  if (!label) return '';
  if (['通过', 'passed', 'approved', '强烈推荐', '推荐'].includes(label)) return '通过';
  return '不通过';
}
