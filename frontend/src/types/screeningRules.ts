export type ScreeningRules = {
  keyword_match_min_score: number;
  red_flag_min_score: number;
  weighted_score_min: number;
};

export const DEFAULT_SCREENING_RULES: ScreeningRules = {
  keyword_match_min_score: 2,
  red_flag_min_score: 5,
  weighted_score_min: 3.5,
};

function parseObject(input: unknown): Record<string, unknown> | null {
  let value = input;
  if (typeof value === 'string') {
    if (!value.trim()) return null;
    try { value = JSON.parse(value); } catch { return null; }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseThreshold(value: unknown, key: keyof ScreeningRules): number | null {
  const parsed = typeof value === 'string' ? Number(value.trim()) : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 5) return null;
  if (key !== 'weighted_score_min' && !Number.isInteger(parsed)) return null;
  if (key === 'weighted_score_min' && !Number.isInteger(parsed * 10)) return null;
  return parsed;
}

export function parseScreeningRules(input: unknown): ScreeningRules | null {
  const object = parseObject(input);
  if (!object) return null;
  const keys: Array<keyof ScreeningRules> = [
    'keyword_match_min_score',
    'red_flag_min_score',
    'weighted_score_min',
  ];
  const result = {} as ScreeningRules;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(object, key)) return null;
    const value = parseThreshold(object[key], key);
    if (value === null) return null;
    result[key] = value;
  }
  return result;
}

export function normalizeScreeningRules(input: unknown): ScreeningRules {
  return parseScreeningRules(input) || { ...DEFAULT_SCREENING_RULES };
}

export function serializeScreeningRules(input: unknown): string {
  const parsed = parseScreeningRules(input);
  return parsed ? JSON.stringify(parsed) : '';
}
