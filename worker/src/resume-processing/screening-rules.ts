import { getActiveGateDimensions, LEGACY_SCREENING_DIMENSION_NAMES, type ScreeningDimensionDefinition } from './screening-dimensions';

export type ScreeningRuleValues = {
  keyword_match_min_score: number;
  red_flag_min_score: number;
  weighted_score_min: number;
};

export type ResolvedScreeningRules = ScreeningRuleValues & {
  source: 'builtin' | 'system' | 'position';
};

export const DEFAULT_SCREENING_RULES: ScreeningRuleValues = {
  keyword_match_min_score: 2,
  red_flag_min_score: 5,
  weighted_score_min: 3.5,
};

const SCREENING_RULE_KEYS = [
  'keyword_match_min_score',
  'red_flag_min_score',
  'weighted_score_min',
] as const;

function parseObject(input: unknown): Record<string, unknown> | null {
  if (typeof input === 'string') {
    if (!input.trim()) return null;
    try {
      input = JSON.parse(input);
    } catch {
      return null;
    }
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  return input as Record<string, unknown>;
}

function parseThreshold(value: unknown, key: (typeof SCREENING_RULE_KEYS)[number]): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'string' ? Number(value.trim()) : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 5) return null;
  if (key !== 'weighted_score_min' && !Number.isInteger(parsed)) return null;
  if (key === 'weighted_score_min' && !Number.isInteger(parsed * 10)) return null;
  return parsed;
}

/** Returns a complete, validated rule object or null for any invalid object. */
export function normalizeScreeningRuleValues(input: unknown): ScreeningRuleValues | null {
  const object = parseObject(input);
  if (!object) return null;

  const values = {} as ScreeningRuleValues;
  for (const key of SCREENING_RULE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(object, key)) return null;
    const value = parseThreshold(object[key], key);
    if (value === null) return null;
    values[key] = value;
  }
  return values;
}

/** Resolves position override > system setting > builtin default. */
export function resolveScreeningRules(systemInput: unknown, positionInput?: unknown): ResolvedScreeningRules {
  const position = normalizeScreeningRuleValues(positionInput);
  if (position) return { ...position, source: 'position' };

  const system = normalizeScreeningRuleValues(systemInput);
  if (system) return { ...system, source: 'system' };

  return { ...DEFAULT_SCREENING_RULES, source: 'builtin' };
}

export function buildScreeningRulesPrompt(
  rules: ScreeningRuleValues,
  dimensions?: readonly ScreeningDimensionDefinition[],
): string {
  if (!dimensions) {
    return `本次 AI 初筛通过条件（服务端最终判定）：
1. 关键词匹配 >= ${rules.keyword_match_min_score} 分；
2. 避坑雷区 >= ${rules.red_flag_min_score} 分；
3. 五项能力加权分 >= ${rules.weighted_score_min} 分；
以上三项必须同时满足，才判定为“通过”，否则为“不通过”。`;
  }

  const names = dimensions.map(item => item.name);
  const isLegacy = names.length === LEGACY_SCREENING_DIMENSION_NAMES.length
    && LEGACY_SCREENING_DIMENSION_NAMES.every(name => names.includes(name));
  const gateLines = getActiveGateDimensions(dimensions).map(gate => gate.name === '关键词匹配'
    ? `关键词匹配 >= ${rules.keyword_match_min_score} 分`
    : `避坑雷区 >= ${rules.red_flag_min_score} 分`);
  const weightedLabel = isLegacy ? '五项能力加权分' : '岗位普通维度加权分';
  const conditions = [...gateLines, `${weightedLabel} >= ${rules.weighted_score_min} 分`];
  return `本次 AI 初筛通过条件（服务端最终判定）：
${conditions.map((condition, index) => `${index + 1}. ${condition}；`).join('\n')}
以上 ${conditions.length} 项必须同时满足，才判定为“通过”，否则为“不通过”。`;
}
