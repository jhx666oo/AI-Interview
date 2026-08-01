type Score = { name: string; score: number; reason: string };

export function normalizeDimensionScores(value: unknown): Score[] {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const items = Array.isArray(value) ? value : Array.isArray(source.dimensions) ? source.dimensions : Array.isArray(source.scores) ? source.scores : [];
  return items.map((item: any) => {
    const name = String(item?.name || item?.dimension || '').trim();
    const score = Number(item?.score);
    return name && Number.isFinite(score) ? { name, score: Math.max(0, Math.min(5, score)), reason: String(item?.reason || '') } : null;
  }).filter((item): item is Score => item !== null);
}

export function missingDimensionNames(configuredNames: string[], evaluation: unknown): string[] {
  const scored = new Set(normalizeDimensionScores(evaluation).map(item => item.name));
  return configuredNames.filter(name => !scored.has(name));
}
