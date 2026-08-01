import { getDimensionScoreTotal, normalizeResumeEvaluation } from './resumeEvaluation';

export type DemographicFilter = {
  minAge: number | null;
  maxAge: number | null;
  genders: string[];
};

function parseAge(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const match = String(value).match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  const age = Number(match[0]);
  return Number.isFinite(age) ? age : null;
}

function normalizeGender(value: unknown): string {
  return value === '男' || value === '女' ? value : '未识别';
}

/** Client-side list filtering only; it never changes a resume's status or AI data. */
export function filterResumesByDemographics<T extends { age?: unknown; gender?: unknown }>(
  rows: T[],
  filter: DemographicFilter,
): T[] {
  const hasAgeRange = filter.minAge !== null || filter.maxAge !== null;
  return rows.filter((row) => {
    if (hasAgeRange) {
      const age = parseAge(row.age);
      if (age === null) return false;
      if (filter.minAge !== null && age < filter.minAge) return false;
      if (filter.maxAge !== null && age > filter.maxAge) return false;
    }
    return filter.genders.length === 0 || filter.genders.includes(normalizeGender(row.gender));
  });
}

/** Filters against the same cumulative dimension score shown on resume cards. */
export function filterResumesByMinimumDimensionScore<T extends { ai_evaluation?: unknown; ai_review?: unknown }>(
  rows: T[],
  minimumScore: number | null,
): T[] {
  if (minimumScore === null) return rows;
  return rows.filter((row) => {
    const dimensions = normalizeResumeEvaluation(row).dimensions;
    return dimensions.length > 0 && getDimensionScoreTotal(dimensions).total >= minimumScore;
  });
}
