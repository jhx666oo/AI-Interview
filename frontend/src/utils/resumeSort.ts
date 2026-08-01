type ResumeTimestamp = {
  created_at?: unknown;
  create_time?: unknown;
  updated_at?: unknown;
  _raw_fields?: Record<string, unknown>;
};

function toTimestamp(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return 0;
}

/** New uploads are ordered by their D1 creation time, with legacy Feishu dates as fallback. */
export function sortResumesNewestFirst<T extends ResumeTimestamp>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const timestamp = (row: T) => toTimestamp(
      row.created_at
      ?? row.create_time
      ?? row._raw_fields?.['创建时间-测试']
      ?? row._raw_fields?.['创建时间']
      ?? row.updated_at,
    );
    return timestamp(b) - timestamp(a);
  });
}
