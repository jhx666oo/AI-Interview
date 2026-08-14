import { evaluateWeightedScreening, type ConfiguredDimension } from './weighted-screening';
import { DEFAULT_SCREENING_RULES, type ScreeningRuleValues } from './screening-rules';

/** Converts model evidence into the only persistence contract accepted by screening-queue routes. */
export function buildScreeningQueuePersistence(
  evaluation: Record<string, unknown>,
  configuredDimensions: readonly ConfiguredDimension[] | null | undefined,
  screeningRules: ScreeningRuleValues = DEFAULT_SCREENING_RULES,
) {
  const canonical = evaluateWeightedScreening(evaluation, configuredDimensions, screeningRules);
  const structured = {
    ...evaluation,
    ...canonical,
    match_score: canonical.weighted_score,
  };
  return {
    ai_analysis: JSON.stringify(structured),
    ai_result: canonical.screening_result,
    screening_result: canonical.screening_result,
    match_score: canonical.weighted_score,
    weighted_score: canonical.weighted_score,
    gate_results: JSON.stringify(canonical.gate_results),
    screening_reason: canonical.screening_reason,
    evaluation: structured,
  };
}
