import { DEFAULT_SCREENING_RULES, buildScreeningRulesPrompt, type ScreeningRuleValues } from './screening-rules';
import {
  getActiveGateDimensions,
  getWeightedDimensions,
  LEGACY_SCREENING_DIMENSION_NAMES,
  resolveEffectiveScreeningDimensions,
  type ScreeningDimensionDefinition,
} from './screening-dimensions';

export { buildScreeningRulesPrompt } from './screening-rules';
export { LEGACY_SCREENING_DIMENSION_NAMES } from './screening-dimensions';

export const WEIGHTED_SCREENING_DIMENSION_NAMES = LEGACY_SCREENING_DIMENSION_NAMES;
export const KEYWORD_MATCH_MIN_SCORE = DEFAULT_SCREENING_RULES.keyword_match_min_score;
export const RED_FLAG_MIN_SCORE = DEFAULT_SCREENING_RULES.red_flag_min_score;

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

function normalizedDimensions(
  evaluation: { dimensions?: unknown } | null | undefined,
  requiredNames: readonly string[],
) {
  const dimensions = Array.isArray(evaluation?.dimensions) ? evaluation.dimensions : [];
  const byName = new Map<string, WeightedScreeningDimension>();
  for (const dimension of dimensions) {
    const item = dimension as WeightedScreeningDimension;
    const name = String(item?.name || '').trim();
    if (name && !byName.has(name)) byName.set(name, item);
  }

  return requiredNames.map((name) => {
    const source = byName.get(name);
    return {
      name,
      score: normalizeScore(source?.score),
      reason: typeof source?.reason === 'string' ? source.reason : '',
    };
  });
}

function hasSameDimensionSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every(name => rightSet.has(name));
}

/** Applies only the gates and weighted dimensions configured for this position. */
export function evaluateWeightedScreening(
  evaluation: { dimensions?: unknown; match_score?: unknown } | null | undefined,
  configuredDimensions: readonly ConfiguredDimension[] | null | undefined,
  rules: ScreeningRuleValues = DEFAULT_SCREENING_RULES,
) {
  const effectiveDimensions = resolveEffectiveScreeningDimensions(configuredDimensions);
  const requiredNames = effectiveDimensions.map(item => item.name);
  const dimensions = normalizedDimensions(evaluation, requiredNames);
  const scores = new Map(dimensions.map((dimension) => [dimension.name, dimension.score]));
  const gate_results: Record<string, { score: number; passed: boolean }> = {};
  for (const gate of getActiveGateDimensions(effectiveDimensions)) {
    const score = scores.get(gate.name) || 0;
    const isKeywordGate = gate.name === '关键词匹配';
    const minimum = isKeywordGate ? rules.keyword_match_min_score : rules.red_flag_min_score;
    const key = isKeywordGate ? 'keyword_match' : 'red_flag';
    gate_results[key] = { score, passed: score >= minimum };
    if (score < minimum) {
      return {
        dimensions,
        weighted_score: null,
        screening_result: '不通过' as const,
        screening_reason: `${gate.name}未达 ${minimum} 分`,
        gate_results,
      };
    }
  }

  const weightedDimensions = getWeightedDimensions(effectiveDimensions);
  if (weightedDimensions.length === 0) {
    return {
      dimensions,
      weighted_score: null,
      screening_result: '不通过' as const,
      screening_reason: '岗位未配置可加权的普通能力维度',
      gate_results,
    };
  }

  const isLegacy = hasSameDimensionSet(requiredNames, WEIGHTED_SCREENING_DIMENSION_NAMES);
  const legacyWeightByName = new Map(
    resolveEffectiveScreeningDimensions([]).map(item => [item.name, Number(item.weight) || 0]),
  );
  const positiveWeightDimensions = weightedDimensions.filter(item => Number(item.weight) > 0);
  const useConfiguredWeights = positiveWeightDimensions.length > 0;
  const useLegacyWeights = isLegacy && !useConfiguredWeights;
  const totalWeight = useConfiguredWeights
    ? positiveWeightDimensions.reduce((sum, item) => sum + Number(item.weight), 0)
    : useLegacyWeights
      ? weightedDimensions.reduce((sum, item) => sum + (legacyWeightByName.get(item.name) || 0), 0)
      : weightedDimensions.length;
  const weighted_score = Math.round(
    weightedDimensions.reduce((sum, item) => {
      const weight = useConfiguredWeights
        ? Math.max(0, Number(item.weight) || 0)
        : useLegacyWeights
          ? legacyWeightByName.get(item.name) || 0
          : 1;
      return sum + (scores.get(item.name) || 0) * weight;
    }, 0) / totalWeight * 10,
  ) / 10;
  const weightedLabel = isLegacy ? '五项能力加权分' : '岗位普通维度加权分';

  return {
    dimensions,
    weighted_score,
    screening_result: weighted_score >= rules.weighted_score_min ? '通过' as const : '不通过' as const,
    screening_reason: weighted_score >= rules.weighted_score_min
      ? `${weightedLabel}达到 ${rules.weighted_score_min} 分`
      : `${weightedLabel}未达 ${rules.weighted_score_min} 分`,
    gate_results,
  };
}

// 全局初筛提示词只描述通用协议，岗位维度由每次请求动态附加。
// 岗位专属规则不能写进这里，否则系统设置中的一份全局 prompt 会影响所有岗位。
export const SCREENING_PROMPT_VERSION = '[简历初筛规则版本：position-aware-v4]';
export const LEGACY_POSITION_AWARE_PROMPT_VERSION = '[简历初筛规则版本：position-aware-v3]';
export const LEGACY_SCREENING_PROMPT_VERSION = '[简历初筛规则版本：keyword-gate-v2]';
export const LEGACY_KEYWORD_GATE_TEXT = '其中「关键词匹配」与「避坑雷区」是硬门槛，只有各自为 5 分才通过；其余五项用于计算加权分。';

export const WEIGHTED_SCREENING_PROMPT = `${SCREENING_PROMPT_VERSION}
初筛必须且只能返回本次请求附带的当前岗位能力维度，每项 score 为 0-5 整数并提供中文事实依据，不得追加当前岗位未配置的旧维度。
「关键词匹配」必须依据当前岗位上下文（岗位职责、岗位要求、个性化需求和能力维度）评估，不得把其他岗位的专属关键词套用到当前岗位。
如果当前岗位提供岗位专属初筛规则，优先遵循该规则；没有专属规则时，应从当前岗位要求中提取最相关的证据进行判断。
当前岗位已配置的门槛和普通维度加权分的具体通过阈值由本次请求附带的“本次 AI 初筛通过条件”决定；未配置的门槛不启用，最终是否通过由服务端计算；match_score 和 recommendation 仅作非权威参考。`;

export function buildPositionDimensionContract(
  dimensions: readonly ScreeningDimensionDefinition[],
): string {
  const lines = dimensions.map((dimension, index) => {
    const description = dimension.description ? `：${dimension.description}` : '';
    return `${index + 1}. ${dimension.name}${description}`;
  });
  return `本次岗位能力维度协议（只适用于当前岗位）：
本次岗位共 ${dimensions.length} 个能力维度，AI 必须且只能评估以下维度：
${lines.join('\n')}
不得返回其他岗位或系统默认维度。服务端将按以上维度顺序校验、保存和计算。`;
}

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
三个证据点中完整命中至少一个，关键词匹配可评 2 分；命中两个可评 3 分；三项均命中时可评 4-5 分。最终门槛以本次请求附带的“本次 AI 初筛通过条件”为准。`;
}

export function normalizeScreeningPrompt(
  key: string,
  prompt: { system: string; user: string },
) {
  if (key !== 'resume_screening' && key !== 'resume_screening_supplement') return prompt;
  const hasCurrentRule = prompt.system.includes(SCREENING_PROMPT_VERSION);
  const hasLegacyRule = prompt.system.includes(LEGACY_SCREENING_PROMPT_VERSION)
    || prompt.system.includes(LEGACY_POSITION_AWARE_PROMPT_VERSION)
    || prompt.system.includes(LEGACY_KEYWORD_GATE_TEXT);
  if (hasCurrentRule && !hasLegacyRule) return prompt;

  // The old v2 block was appended to the end of the global system prompt.
  // Remove that managed suffix before adding the position-neutral v3 block.
  const withoutLegacyRule = prompt.system
    .replace(/(?:\[简历初筛规则版本：keyword-gate-v2\]|\[简历初筛规则版本：position-aware-v3\])[^]*$/, '')
    .replace(LEGACY_KEYWORD_GATE_TEXT, '')
    .trim();
  return {
    ...prompt,
    system: `${withoutLegacyRule}\n\n${WEIGHTED_SCREENING_PROMPT}`,
  };
}
