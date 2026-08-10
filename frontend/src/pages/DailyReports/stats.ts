export interface DailyReportStats {
  report_date?: string;
  open_requisitions: number | null;
  total_resumes: number | null;
  today_new: number | null;
  pending_screening: number | null;
  approved_candidates: number | null;
  rejected_candidates: number | null;
  active_interviews: number | null;
  offers_count: number | null;
  onboarding_count: number | null;
  rows?: DailyReportStatsRow[];
  unassigned?: number | null;
}

export interface DailyReportStatsRow {
  owner: string;
  open_requisitions: number | null;
  today_new: number | null;
  pending_screening: number | null;
  approved_candidates: number | null;
  rejected_candidates: number | null;
  active_interviews: number | null;
  offers_count: number | null;
  onboarding_count: number | null;
}

function parseObject(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function metric(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeRow(value: unknown): DailyReportStatsRow | null {
  const source = parseObject(value);
  if (!source || typeof source.owner !== 'string' || !source.owner.trim()) return null;
  return {
    owner: source.owner.trim(),
    open_requisitions: metric(source.openPositions ?? source.open_requisitions),
    today_new: metric(source.todayNew ?? source.today_new),
    pending_screening: metric(source.pending ?? source.pending_screening),
    approved_candidates: metric(source.todayApproved ?? source.approved_candidates),
    rejected_candidates: metric(source.todayRejected ?? source.rejected_candidates),
    active_interviews: metric(source.todayInterviews ?? source.active_interviews),
    offers_count: metric(source.todayOffers ?? source.offers_count),
    onboarding_count: metric(source.todayOnboarding ?? source.onboarding_count),
  };
}

export function normalizeDailyReportStats(value: unknown): DailyReportStats | null {
  const record = parseObject(value);
  if (!record) return null;

  const totals = parseObject(record.totals);
  const source = record.version === 'v2' && totals ? totals : record;
  const stats: DailyReportStats = {
    report_date: typeof record.report_date === 'string'
      ? record.report_date
      : typeof record.reportDate === 'string' ? record.reportDate : undefined,
    open_requisitions: metric(source.openPositions ?? source.open_requisitions),
    total_resumes: metric(source.allTimeResumes ?? source.total_resumes),
    today_new: metric(source.todayNew ?? source.today_new),
    pending_screening: metric(source.pending ?? source.pending_screening),
    approved_candidates: metric(source.todayApproved ?? source.approved_candidates),
    rejected_candidates: metric(source.todayRejected ?? source.rejected_candidates),
    active_interviews: metric(source.todayInterviews ?? source.active_interviews),
    offers_count: metric(source.todayOffers ?? source.offers_count ?? source.total_offers),
    onboarding_count: metric(source.todayOnboarding ?? source.onboarding_count),
    rows: Array.isArray(record.rows)
      ? record.rows.map(normalizeRow).filter((row): row is DailyReportStatsRow => row !== null)
      : undefined,
    unassigned: metric(record.unassigned),
  };

  const values = Object.values(stats).filter((entry) => typeof entry === 'number' || entry === null);
  return values.some((entry) => entry !== null) ? stats : null;
}
