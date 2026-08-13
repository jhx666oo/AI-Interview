import { WEIGHTED_SCREENING_DIMENSION_NAMES } from './weighted-screening';

export type DimensionScore = { name: string; score: number; reason: string };

type ScreeningEvaluation = Record<string, any>;

function asObject(value: unknown): ScreeningEvaluation | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as ScreeningEvaluation;
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function isPromptLikeSummary(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const summary = value.trim();
  return summary.startsWith('# 人才能力评估AI打分提示词')
    || summary.startsWith('```')
    || summary.startsWith('{')
    || summary.startsWith('[')
    || (summary.length > 1000 && summary.includes('dimensions'));
}

export function normalizeDimensionScores(value: unknown): DimensionScore[] {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const items = Array.isArray(value) ? value : Array.isArray(source.dimensions) ? source.dimensions : Array.isArray(source.scores) ? source.scores : [];
  return items.map((item: any) => {
    const name = String(item?.name || item?.dimension || '').trim();
    const score = Number(item?.score);
    return name && Number.isFinite(score) ? { name, score: Math.max(0, Math.min(5, score)), reason: String(item?.reason || '') } : null;
  }).filter((item): item is DimensionScore => item !== null);
}

/** Returns true only when every server-side weighted-screening dimension is present. */
export function hasAllDimensionScores(
  value: unknown,
  requiredNames: readonly string[] = WEIGHTED_SCREENING_DIMENSION_NAMES,
): boolean {
  const scoredNames = new Set(normalizeDimensionScores(value).map((item) => item.name));
  return requiredNames.every((name) => scoredNames.has(name));
}

/**
 * Models occasionally put the complete evaluation JSON inside summary. Prefer that
 * payload when the outer payload is incomplete or only contains placeholder zeros.
 */
export function normalizeScreeningEvaluation(value: unknown): ScreeningEvaluation {
  const outer = asObject(value);
  if (!outer) return { summary: typeof value === 'string' ? value.trim() : '' };

  const nested = asObject(outer.summary);
  if (!nested) return outer;

  const outerScores = normalizeDimensionScores(outer);
  const nestedScores = normalizeDimensionScores(nested);
  if (nestedScores.length === 0) return outer;

  const outerIsPlaceholder = outerScores.length === 0
    || outerScores.every((item) => item.score === 0);
  const nestedIsComplete = hasAllDimensionScores(nested);
  if (!outerIsPlaceholder && hasAllDimensionScores(outer)) return outer;
  if (outerIsPlaceholder || nestedIsComplete) {
    return { ...outer, ...nested };
  }
  return outer;
}

/** Prevents a malformed AI response from being persisted as a successful screening. */
export function requireCompleteScreeningEvaluation(value: unknown): ScreeningEvaluation {
  const normalized = normalizeScreeningEvaluation(value);
  if (!hasAllDimensionScores(normalized)) {
    const error = new Error('AI_SCREENING_INVALID_DIMENSIONS: AI 未返回完整的七项能力维度评分');
    (error as Error & { code?: string }).code = 'AI_SCREENING_INVALID_DIMENSIONS';
    throw error;
  }
  if (isPromptLikeSummary(normalized.summary)) {
    const error = new Error('AI_SCREENING_INVALID_SUMMARY: AI 返回了提示词或代码内容');
    (error as Error & { code?: string }).code = 'AI_SCREENING_INVALID_SUMMARY';
    throw error;
  }
  return normalized;
}

/** Keep only configured dimensions, deduplicated and ordered by the job configuration. */
export function filterDimensionScoresToConfigured(
  scores: DimensionScore[],
  configuredNames: string[],
): DimensionScore[] {
  const configured = configuredNames.map((name) => String(name || '').trim()).filter(Boolean);
  const configuredSet = new Set(configured);
  const firstByName = new Map<string, DimensionScore>();
  for (const score of scores) {
    const name = String(score?.name || '').trim();
    if (!name || !configuredSet.has(name) || firstByName.has(name)) continue;
    firstByName.set(name, { ...score, name });
  }
  return configured.map((name) => firstByName.get(name)).filter((score): score is DimensionScore => Boolean(score));
}

/** Merge the primary and supplemental model results without allowing extra dimensions. */
export function mergeConfiguredDimensionScores(
  existing: DimensionScore[],
  supplemental: DimensionScore[],
  configuredNames: string[],
): DimensionScore[] {
  return filterDimensionScoresToConfigured([...existing, ...supplemental], configuredNames);
}

export function missingDimensionNames(configuredNames: string[], evaluation: unknown): string[] {
  const scored = new Set(normalizeDimensionScores(evaluation).map(item => item.name));
  return configuredNames.filter(name => !scored.has(name));
}
