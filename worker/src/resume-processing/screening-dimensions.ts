export type ScreeningDimensionDefinition = {
  name: string;
  description: string;
  weight: number | null;
  isGate: boolean;
};

export const LEGACY_SCREENING_DIMENSION_NAMES = [
  '核心画像',
  '核心职责',
  '任职要求',
  '企业背景',
  '加分项',
  '关键词匹配',
  '避坑雷区',
] as const;

const LEGACY_WEIGHTS: Record<string, number> = {
  核心画像: 25,
  核心职责: 22,
  任职要求: 22,
  企业背景: 13,
  加分项: 10,
};

export function isScreeningGateDimension(name: string): boolean {
  return name === '关键词匹配' || name === '避坑雷区';
}

function parseSource(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value.split(/[、,，\n]/).map(item => item.trim()).filter(Boolean);
  }
}

function normalizeWeight(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const weight = Number(value);
  return Number.isFinite(weight) && weight >= 0 ? weight : null;
}

export function normalizeScreeningDimensions(value: unknown): ScreeningDimensionDefinition[] {
  const source = parseSource(value);
  if (!Array.isArray(source)) return [];

  const seen = new Set<string>();
  const result: ScreeningDimensionDefinition[] = [];
  for (const item of source) {
    const raw = typeof item === 'string' ? { name: item } : (item as Record<string, unknown> | null);
    const name = String(raw?.name || raw?.title || '').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    result.push({
      name,
      description: String(raw?.description || raw?.definition || '').trim(),
      weight: normalizeWeight(raw?.weight),
      isGate: isScreeningGateDimension(name),
    });
  }
  return result;
}

function legacyDimensions(): ScreeningDimensionDefinition[] {
  return LEGACY_SCREENING_DIMENSION_NAMES.map(name => ({
    name,
    description: '',
    weight: LEGACY_WEIGHTS[name] ?? null,
    isGate: isScreeningGateDimension(name),
  }));
}

export function resolveEffectiveScreeningDimensions(
  configured: unknown,
): ScreeningDimensionDefinition[] {
  const normalized = normalizeScreeningDimensions(configured);
  return normalized.length > 0 ? normalized : legacyDimensions();
}

export function requiredDimensionNames(
  configured: unknown,
): string[] {
  return resolveEffectiveScreeningDimensions(configured).map(item => item.name);
}

export function getActiveGateDimensions(
  dimensions: readonly ScreeningDimensionDefinition[],
): ScreeningDimensionDefinition[] {
  return dimensions.filter(item => item.isGate);
}

export function getWeightedDimensions(
  dimensions: readonly ScreeningDimensionDefinition[],
): ScreeningDimensionDefinition[] {
  return dimensions.filter(item => !item.isGate);
}
