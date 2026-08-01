export type ResumeDimensionScore = {
  name: string;
  score: number;
  reason: string;
};

export type NormalizedResumeEvaluation = {
  dimensions: ResumeDimensionScore[];
  overallScore: number | null;
  summary: string;
  source: Record<string, any> | null;
};

/** Returns card-ready scores on the same five-point scale as each dimension. */
export function getDimensionScoreTotal(dimensions: ResumeDimensionScore[]): { total: number; maximum: number } {
  const total = Math.round(dimensions.reduce((sum, dimension) => sum + dimension.score, 0) * 10) / 10;
  return { total, maximum: dimensions.length * 5 };
}

/** Handles both current array values and legacy AI responses that stored list content as text. */
export function asDisplayTextList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean);
  if (typeof value !== 'string') return [];
  return value.split(/\r?\n/).map(item => item.trim()).filter(Boolean);
}

function asObject(value: unknown): Record<string, any> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, any>;
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function toDisplayScore(value: unknown): number | null {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return null;
  const score = raw > 5 ? raw / 20 : raw;
  return Math.round(Math.max(0, Math.min(5, score)) * 10) / 10;
}

function dimensionsFrom(value: Record<string, any> | null): ResumeDimensionScore[] {
  if (!value) return [];
  const rawDimensions = value.dimensions;
  if (Array.isArray(rawDimensions)) {
    return rawDimensions
      .map((item: any) => {
        const name = String(item?.name || item?.label || item?.dimension || item?.key || '').trim();
        const score = toDisplayScore(item?.score ?? item?.value);
        return name && score !== null ? { name, score, reason: String(item?.reason || item?.evidence || item?.comment || '') } : null;
      })
      .filter((item): item is ResumeDimensionScore => item !== null);
  }
  if (rawDimensions && typeof rawDimensions === 'object') {
    return Object.entries(rawDimensions)
      .map(([name, item]: [string, any]) => {
        const score = toDisplayScore(typeof item === 'object' ? item?.score ?? item?.value : item);
        return score !== null ? { name, score, reason: String(typeof item === 'object' ? item?.reason || item?.evidence || '' : '') } : null;
      })
      .filter((item): item is ResumeDimensionScore => item !== null);
  }
  // 兼容旧版把 JSON 放进 summary 字符串的写法。
  if (typeof value.summary === 'string') {
    const embedded = asObject(value.summary);
    if (embedded) return dimensionsFrom(embedded);
  }
  return [];
}

function dimensionsFromLegacyText(value: unknown): ResumeDimensionScore[] {
  if (typeof value !== 'string' || !value.includes('能力维度匹配')) return [];
  const results: ResumeDimensionScore[] = [];
  const matcher = /\*\*(.+?)[：:]\s*(\d+(?:\.\d+)?)\/5分\*{0,2}[。.]*\s*依据\*{0,2}[：:](.*?)(?:\*\*|$)/g;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(value)) !== null) {
    const score = toDisplayScore(match[2]);
    if (score !== null) results.push({ name: match[1].trim(), score, reason: match[3].trim() });
  }
  return results;
}

/**
 * Normalizes all persisted AI evaluation variants for presentation only.
 * New D1 data uses ai_evaluation; ai_review is an intentionally compatible fallback.
 */
export function normalizeResumeEvaluation(resume: { ai_evaluation?: unknown; ai_review?: unknown } | null | undefined): NormalizedResumeEvaluation {
  const evaluation = asObject(resume?.ai_evaluation);
  const review = asObject(resume?.ai_review);
  const evaluationDimensions = dimensionsFrom(evaluation).concat(dimensionsFromLegacyText(resume?.ai_evaluation));
  const reviewDimensions = dimensionsFrom(review).concat(dimensionsFromLegacyText(resume?.ai_review));
  const source = evaluationDimensions.length > 0 ? evaluation : reviewDimensions.length > 0 ? review : evaluation || review;
  const dimensions = evaluationDimensions.length > 0 ? evaluationDimensions : reviewDimensions;
  const overallRaw = source?.weighted_score ?? source?.match_score ?? evaluation?.match_score ?? review?.match_score;
  const overallScore = Number.isFinite(Number(overallRaw)) ? Number(overallRaw) : null;
  return {
    dimensions,
    overallScore,
    summary: String(source?.summary || source?.ai_review || ''),
    source,
  };
}
