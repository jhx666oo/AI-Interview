export type BusinessScreeningStatus = 'not_ready' | 'pending' | 'passed' | 'rejected';

type ResumeBusinessScreeningRecord = {
  status?: string | null;
  hr_disposition?: string | null;
  business_screening_status?: string | null;
};

const VALID_STATUSES = new Set<BusinessScreeningStatus>(['not_ready', 'pending', 'passed', 'rejected']);

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function isBusinessScreeningStatusFilter(value: unknown): value is BusinessScreeningStatus {
  return typeof value === 'string' && VALID_STATUSES.has(value as BusinessScreeningStatus);
}

export function inferBusinessScreeningStatus(record: ResumeBusinessScreeningRecord): BusinessScreeningStatus {
  const explicit = clean(record.business_screening_status);
  if (VALID_STATUSES.has(explicit as BusinessScreeningStatus)) {
    return explicit as BusinessScreeningStatus;
  }

  if (clean(record.hr_disposition) === 'pushed') {
    if (record.status === 'approved') return 'passed';
    if (record.status === 'rejected') return 'rejected';
    return 'pending';
  }

  return 'not_ready';
}

export function exposeBusinessScreeningState<T extends ResumeBusinessScreeningRecord>(item: T): T & {
  hr_disposition: string;
  business_screening_status: BusinessScreeningStatus;
} {
  return {
    ...item,
    hr_disposition: clean(item.hr_disposition) || 'pending',
    business_screening_status: inferBusinessScreeningStatus(item),
  };
}

export function matchesBusinessScreeningStatusFilter(
  record: ResumeBusinessScreeningRecord,
  filter: BusinessScreeningStatus,
): boolean {
  return inferBusinessScreeningStatus(record) === filter;
}

export function buildBusinessScreeningStatusSqlClause(
  filter: BusinessScreeningStatus,
): { clause: string; params: string[] } {
  const blank = "(r.business_screening_status IS NULL OR r.business_screening_status = '')";
  if (filter === 'pending') {
    return {
      clause: `((r.business_screening_status = ?) OR (${blank} AND r.hr_disposition = 'pushed' AND COALESCE(r.status, '') NOT IN ('approved', 'rejected')))`,
      params: [filter],
    };
  }
  if (filter === 'passed') {
    return {
      clause: `((r.business_screening_status = ?) OR (${blank} AND r.hr_disposition = 'pushed' AND r.status = 'approved'))`,
      params: [filter],
    };
  }
  if (filter === 'rejected') {
    return {
      clause: `((r.business_screening_status = ?) OR (${blank} AND r.hr_disposition = 'pushed' AND r.status = 'rejected'))`,
      params: [filter],
    };
  }
  return {
    clause: `((r.business_screening_status = ?) OR (${blank} AND COALESCE(r.hr_disposition, 'pending') != 'pushed'))`,
    params: [filter],
  };
}
