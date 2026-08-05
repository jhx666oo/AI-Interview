import { evaluateWeightedScreening, type ConfiguredDimension } from './weighted-screening';

/** Converts model evidence into the only persistence contract accepted by screening-queue routes. */
export function buildScreeningQueuePersistence(
  evaluation: Record<string, unknown>,
  configuredDimensions: readonly ConfiguredDimension[] | null | undefined,
) {
  const canonical = evaluateWeightedScreening(evaluation, configuredDimensions);
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
