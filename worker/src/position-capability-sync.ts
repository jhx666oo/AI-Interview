export type StoredCapabilityDimension = {
  name: string;
  description?: string;
  definition?: string;
  behavior?: string;
  weight?: number;
};

/** Normalize all historical capability dimension formats to JSON-safe objects. */
export function normalizeCapabilityDimensionsForStorage(value: unknown): StoredCapabilityDimension[] {
  let source: unknown = value;
  if (typeof source === 'string') {
    try {
      source = JSON.parse(source);
    } catch {
      source = source.split(/[、,，\n]/).map((item) => item.trim()).filter(Boolean);
    }
  }
  if (!Array.isArray(source)) return [];

  return source.map((item): StoredCapabilityDimension | null => {
    if (typeof item === 'string') {
      const name = item.trim();
      return name ? { name } : null;
    }
    if (!item || typeof item !== 'object') return null;
    const raw = item as Record<string, unknown>;
    const name = String(raw.name || raw.title || '').trim();
    if (!name) return null;
    const result: StoredCapabilityDimension = { name };
    for (const key of ['description', 'definition', 'behavior'] as const) {
      const text = String(raw[key] || '').trim();
      if (text) result[key] = text;
    }
    const weight = Number(raw.weight);
    if (Number.isFinite(weight) && weight >= 0 && raw.weight !== null && raw.weight !== undefined && raw.weight !== '') result.weight = weight;
    return result;
  }).filter((item): item is StoredCapabilityDimension => Boolean(item));
}

export function buildCapabilityDimensionsFullText(dimensions: StoredCapabilityDimension[]): string {
  return dimensions.map((dimension, index) => {
    const definition = dimension.description || dimension.definition || '';
    const lines = [`${index + 1}. - ${dimension.name}`];
    if (definition) lines.push(`- 简要定义：${definition}`);
    if (dimension.behavior) lines.push(`- 典型行为表现：${dimension.behavior}`);
    return lines.join('\n');
  }).join('\n');
}
