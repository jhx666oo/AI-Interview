const SCORING_DIMENSIONS = ['核心画像', '核心职责', '任职要求', '企业背景', '加分项'] as const;
const GATE_DIMENSIONS = ['关键词匹配', '避坑雷区'] as const;
export const WEIGHTED_SCREENING_DIMENSION_NAMES = [...SCORING_DIMENSIONS, ...GATE_DIMENSIONS] as const;
export const KEYWORD_MATCH_MIN_SCORE = 2;
export const RED_FLAG_MIN_SCORE = 5;

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

/** Applies the keyword/red-flag gates and five-dimension weighted score. */
export function evaluateWeightedScreening(
  evaluation: { dimensions?: unknown; match_score?: unknown } | null | undefined,
  configuredDimensions: readonly ConfiguredDimension[] | null | undefined,
) {
  const dimensions = normalizedDimensions(evaluation);
  const scores = new Map(dimensions.map((dimension) => [dimension.name, dimension.score]));
  const keywordScore = scores.get('关键词匹配') || 0;
  const redFlagScore = scores.get('避坑雷区') || 0;
  const gate_results = {
    keyword_match: { score: keywordScore, passed: keywordScore >= KEYWORD_MATCH_MIN_SCORE },
    red_flag: { score: redFlagScore, passed: redFlagScore >= RED_FLAG_MIN_SCORE },
  };

  if (!gate_results.keyword_match.passed) {
    return {
      dimensions,
      weighted_score: null,
      screening_result: '不通过' as const,
      screening_reason: `关键词匹配未达 ${KEYWORD_MATCH_MIN_SCORE} 分`,
      gate_results,
    };
  }

  if (!gate_results.red_flag.passed) {
    return {
      dimensions,
      weighted_score: null,
      screening_result: '不通过' as const,
      screening_reason: `避坑雷区未达 ${RED_FLAG_MIN_SCORE} 分`,
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

// 初筛提示词模板，基于七个能力维度构建。
// 岗位专属规则不能写进这里，否则系统设置中的一份全局 prompt 会影响所有岗位。
export const SCREENING_PROMPT_VERSION = '[简历初筛规则版本：position-aware-v3]';
export const LEGACY_SCREENING_PROMPT_VERSION = '[简历初筛规则版本：keyword-gate-v2]';
export const LEGACY_KEYWORD_GATE_TEXT = '其中「关键词匹配」与「避坑雷区」是硬门槛，只有各自为 5 分才通过；其余五项用于计算加权分。';

export const WEIGHTED_SCREENING_PROMPT = `${SCREENING_PROMPT_VERSION}
初筛必须且只能返回以下七个能力维度，每项 score 为 0-5 整数并提供中文事实依据：${WEIGHTED_SCREENING_DIMENSION_NAMES.join('、')}。
「关键词匹配」必须依据当前岗位上下文（岗位职责、岗位要求、个性化需求和能力维度）评估，不得把其他岗位的专属关键词套用到当前岗位。
如果当前岗位提供岗位专属初筛规则，优先遵循该规则；没有专属规则时，应从当前岗位要求中提取最相关的证据进行判断。
关键词匹配 2 分或以上通过该门槛，0-1 分不通过；避坑雷区仍需 5 分。其余五项用于计算加权分，最终是否通过由服务端计算；match_score 和 recommendation 仅作非权威参考。`;

export type PositionScreeningContext = {
  standardPosition?: unknown;
  description?: unknown;
  requirements?: unknown;
  personalizedRequirements?: unknown;
  capabilityDimensions?: unknown;
};

/** Builds the position context that accompanies every screening request. */
export function buildPositionScreeningContextText(context: PositionScreeningContext): string {
  const sections = [
    ['当前岗位', context.standardPosition],
    ['岗位职责', context.description],
    ['岗位要求', context.requirements],
    ['个性化要求', context.personalizedRequirements],
    ['能力维度', context.capabilityDimensions],
  ].filter(([, value]) => String(value || '').trim());

  if (sections.length === 0) return '';
  return `当前岗位评估上下文（只适用于当前岗位，不得套用其他岗位的专属规则）：\n${sections.map(([label, value]) => `${label}：\n${String(value).trim()}`).join('\n\n')}`;
}

const SMART_HARDWARE_CONTEXT_PATTERN = /智能硬件|物联网|嵌入式|IoT|MQTT|OTA|固件|设备端|软硬件联调/i;

/**
 * Returns a position-specific rule only when the position itself is clearly
 * related to smart hardware, IoT, or embedded products. This rule intentionally
 * lives in the user prompt, not the global system prompt.
 */
export function buildPositionSpecificScreeningRule(context: PositionScreeningContext): string {
  const contextText = [
    context.standardPosition,
    context.description,
    context.requirements,
    context.personalizedRequirements,
    context.capabilityDimensions,
  ].map((value) => String(value || '')).join('\n');

  if (!SMART_HARDWARE_CONTEXT_PATTERN.test(contextText)) return '';

  return `岗位专属初筛规则（仅适用于当前智能硬件/IoT/嵌入式岗位）：
「关键词匹配」按以下三个证据点评估：
1. 相关经验：必须同时具备 5 年及以上智能硬件、IoT 或嵌入式相关产品经验，并命中“嵌入式固件、IoT 云平台、MQTT 协议、设备端需求、OTA 升级、软硬件联调”中的任一关键词或等价表述；
2. 外部开发协同：明确描述 ODM、外包或外部研发团队对接，以及需求拆解、进度/质量管理、验收或交付等需求管控职责；
3. 知名企业相关经历：在京东、小米、海尔等同类知名企业工作，且该段经历实际涉及智能硬件、IoT 或嵌入式产品。知名企业名称本身不能单独算命中。
三个证据点中完整命中至少一个，关键词匹配可评 2 分；命中两个可评 3 分；三项均命中时可评 4-5 分。关键词匹配 2 分或以上通过该岗位门槛。`;
}

export function normalizeScreeningPrompt(
  key: string,
  prompt: { system: string; user: string },
) {
  if (key !== 'resume_screening' && key !== 'resume_screening_supplement') return prompt;
  const hasCurrentRule = prompt.system.includes(SCREENING_PROMPT_VERSION);
  const hasLegacyRule = prompt.system.includes(LEGACY_SCREENING_PROMPT_VERSION)
    || prompt.system.includes(LEGACY_KEYWORD_GATE_TEXT);
  if (hasCurrentRule && !hasLegacyRule) return prompt;

  // The old v2 block was appended to the end of the global system prompt.
  // Remove that managed suffix before adding the position-neutral v3 block.
  const withoutLegacyRule = prompt.system
    .replace(new RegExp(`${LEGACY_SCREENING_PROMPT_VERSION}[\\s\\S]*$`), '')
    .replace(LEGACY_KEYWORD_GATE_TEXT, '')
    .trim();
  return {
    ...prompt,
    system: `${withoutLegacyRule}\n\n${WEIGHTED_SCREENING_PROMPT}`,
  };
}
