const SCORING_DIMENSIONS = ['核心画像', '核心职责', '任职要求', '企业背景', '加分项'] as const;
const GATE_DIMENSIONS = ['关键词匹配', '避坑雷区'] as const;
export const WEIGHTED_SCREENING_DIMENSION_NAMES = [...SCORING_DIMENSIONS, ...GATE_DIMENSIONS] as const;

const DEFAULT_WEIGHTS: Record<(typeof SCORING_DIMENSIONS)[number], number> = {
  核心画像: 25,
  核心职责: 22,
  任职要求: 22,
  企业背景: 13,
  加分项: 10,
};

type DimensionName = (typeof SCORING_DIMENSIONS)[number] | (typeof GATE_DIMENSIONS)[number];

export type WeightedScreeningDimension = {
  name: string;
  score?: unknown;
  reason?: unknown;
};

export type ConfiguredDimension = {
  name?: unknown;
  weight?: unknown;
};

function normalizeScore(value: unknown): number {
  const score = Number(value);
  return Number.isFinite(score) ? Math.max(0, Math.min(5, score)) : 0;
}

function normalizedDimensions(evaluation: { dimensions?: unknown } | null | undefined) {
  const dimensions = Array.isArray(evaluation?.dimensions) ? evaluation.dimensions : [];
  const byName = new Map<string, WeightedScreeningDimension>();
  for (const dimension of dimensions) {
    const item = dimension as WeightedScreeningDimension;
    const name = String(item?.name || '').trim();
    if (name && !byName.has(name)) byName.set(name, item);
  }

  return WEIGHTED_SCREENING_DIMENSION_NAMES.map((name) => {
    const source = byName.get(name);
    return {
      name,
      score: normalizeScore(source?.score),
      reason: typeof source?.reason === 'string' ? source.reason : '',
    };
  });
}

function scoringWeights(configuredDimensions: readonly ConfiguredDimension[] | null | undefined) {
  const configuredByName = new Map<string, number>();
  for (const dimension of configuredDimensions || []) {
    const name = String(dimension?.name || '').trim();
    const weight = Number(dimension?.weight);
    if (name && Number.isFinite(weight) && weight >= 0 && !configuredByName.has(name)) {
      configuredByName.set(name, weight);
    }
  }

  const hasPositiveConfiguredWeight = SCORING_DIMENSIONS.some((name) => (configuredByName.get(name) ?? 0) > 0);
  return SCORING_DIMENSIONS.map((name) => hasPositiveConfiguredWeight
    ? configuredByName.get(name) ?? 0
    : DEFAULT_WEIGHTS[name]);
}

/** Applies the seven-dimension screening gates and five-dimension weighted score. */
export function evaluateWeightedScreening(
  evaluation: { dimensions?: unknown; match_score?: unknown } | null | undefined,
  configuredDimensions: readonly ConfiguredDimension[] | null | undefined,
) {
  const dimensions = normalizedDimensions(evaluation);
  const scores = new Map(dimensions.map((dimension) => [dimension.name, dimension.score]));
  const keywordScore = scores.get('关键词匹配') || 0;
  const redFlagScore = scores.get('避坑雷区') || 0;
  const gate_results = {
    keyword_match: { score: keywordScore, passed: keywordScore >= 5 },
    red_flag: { score: redFlagScore, passed: redFlagScore >= 5 },
  };

  if (!gate_results.keyword_match.passed) {
    return {
      dimensions,
      weighted_score: null,
      screening_result: '不通过' as const,
      screening_reason: '关键词匹配未达 5 分',
      gate_results,
    };
  }

  if (!gate_results.red_flag.passed) {
    return {
      dimensions,
      weighted_score: null,
      screening_result: '不通过' as const,
      screening_reason: '避坑雷区未达 5 分',
      gate_results,
    };
  }

  const weights = scoringWeights(configuredDimensions);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const weighted_score = Math.round(
    SCORING_DIMENSIONS.reduce((sum, name, index) => sum + (scores.get(name) || 0) * weights[index], 0) / totalWeight * 10,
  ) / 10;

  return {
    dimensions,
    weighted_score,
    screening_result: weighted_score >= 4 ? '通过' as const : '不通过' as const,
    screening_reason: weighted_score >= 4 ? '五项能力加权分达到 4 分' : '五项能力加权分未达 4 分',
    gate_results,
  };
}
