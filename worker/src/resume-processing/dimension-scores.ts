export type DimensionScore = { name: string; score: number; reason: string };

export function normalizeDimensionScores(value: unknown): DimensionScore[] {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const items = Array.isArray(value) ? value : Array.isArray(source.dimensions) ? source.dimensions : Array.isArray(source.scores) ? source.scores : [];
  return items.map((item: any) => {
    const name = String(item?.name || item?.dimension || '').trim();
    const score = Number(item?.score);
    return name && Number.isFinite(score) ? { name, score: Math.max(0, Math.min(5, score)), reason: String(item?.reason || '') } : null;
  }).filter((item): item is DimensionScore => item !== null);
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
