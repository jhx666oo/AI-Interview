export type PositionMappingRow = {
  raw_name?: unknown;
  raw_names?: unknown;
  mapped_name?: unknown;
};

export function normalizePositionKey(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().toLocaleLowerCase('zh-CN').replace(/[\s\u3000]+/g, '')
    : '';
}

function parseAliases(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item) => typeof item === 'string') as string[];
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item) => typeof item === 'string') as string[]
      : [];
  } catch {
    return [];
  }
}

function addAlias(map: Map<string, string>, alias: unknown, mappedName: string): void {
  const key = normalizePositionKey(alias);
  if (!key || map.has(key)) return;
  map.set(key, mappedName);
}

function addHistoricalShortAliases(map: Map<string, string>, alias: unknown, mappedName: string): void {
  const key = normalizePositionKey(alias);
  if (!key) return;
  // 历史导入数据曾把「IoT产品经理」简写成「iot」，保留这个兼容别名。
  const withoutQualifier = key.replace(/[（(].*$/, '');
  const withoutTitle = withoutQualifier.replace(/产品经理|产品|经理/g, '');
  if (withoutTitle === 'iot') addAlias(map, 'iot', mappedName);
}

export function buildPositionMappingFromRows(rows: PositionMappingRow[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows || []) {
    const mappedName = typeof row.mapped_name === 'string' ? row.mapped_name.trim() : '';
    if (!mappedName) continue;
    const aliases = [row.raw_name, ...parseAliases(row.raw_names), mappedName];
    for (const alias of aliases) {
      addAlias(map, alias, mappedName);
      addHistoricalShortAliases(map, alias, mappedName);
    }
  }
  return map;
}

export function resolveMappedPosition(
  mapping: Map<string, string>,
  rawPosition: unknown,
  fallback = '',
): string {
  const raw = typeof rawPosition === 'string' ? rawPosition.trim() : '';
  return (raw && mapping.get(normalizePositionKey(raw))) || raw || fallback;
}

export function positionNamesMatch(left: unknown, right: unknown): boolean {
  const leftKey = normalizePositionKey(left);
  const rightKey = normalizePositionKey(right);
  if (!leftKey || !rightKey) return false;
  if (leftKey === rightKey) return true;
  const legacyIot = (value: string) => value === 'iot' || value.startsWith('iot产品经理');
  return (legacyIot(leftKey) && rightKey.includes('软件产品经理'))
    || (legacyIot(rightKey) && leftKey.includes('软件产品经理'));
}
