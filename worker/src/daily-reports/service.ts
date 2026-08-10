import {
  buildDailyReportFallbackSummary,
  buildDailyReportFeishuCard,
  buildDailyReportSnapshot,
  DAILY_REPORT_OWNERS,
  type DailyReportFeishuCard,
  type DailyOwnerMetrics,
  type DailyReportDataset,
  type DailyReportSnapshot,
} from './report';

type StoredDailyReportRecord = Record<string, unknown>;

export type DailyReportDeliveryTarget = Readonly<{ type: 'chat' | 'user'; id: string }>;

export interface PersistedDailyReport extends StoredDailyReportRecord {
  readonly id: string;
  readonly report_date: string;
  readonly ai_summary: string;
  readonly stats: string;
  readonly candidate_details: string;
  readonly snapshot: DailyReportSnapshot;
}

export interface DailyReportGenerationDependencies {
  readonly id?: () => string;
  readonly generatedAt?: () => string;
  readonly loadDataset?: (db: Pick<D1Database, 'prepare'>, reportDate: string) => Promise<DailyReportDataset>;
  readonly loadCandidateDetails: (reportDate: string) => Promise<unknown>;
  readonly summarize: (snapshot: DailyReportSnapshot) => Promise<string>;
}

export type DailyReportDeliver = (
  target: DailyReportDeliveryTarget,
  card: DailyReportFeishuCard,
) => Promise<void>;

export const DAILY_REPORT_QUERY_LIMITS = Object.freeze({
  positions: 1_000,
  positionMappings: 2_000,
  resumes: 5_000,
  interviews: 2_000,
  offers: 2_000,
  onboardingRecords: 2_000,
});

const PENDING_RESUME_STATUSES = [
  'pending',
  'pending_screening',
  'pending_review',
  'pending_dept_review',
  'pending_hr_decision',
];

function exactReportDate(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= monthDays[month - 1] ? value : null;
}

export function assertDailyReportDate(value: unknown): string {
  if (typeof value !== 'string' || !exactReportDate(value)) {
    throw new Error('report_date must be a valid YYYY-MM-DD calendar date');
  }
  return value;
}

export function getShanghaiReportDate(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function reportDateBounds(reportDate: string): {
  utcStart: string;
  utcEnd: string;
  localStart: string;
  localEnd: string;
} {
  const date = assertDailyReportDate(reportDate);
  const utcStartMs = Date.parse(`${date}T00:00:00.000+08:00`);
  const utcEndMs = utcStartMs + 86_400_000;
  const nextDate = getShanghaiReportDate(new Date(utcEndMs));
  return {
    utcStart: new Date(utcStartMs).toISOString(),
    utcEnd: new Date(utcEndMs).toISOString(),
    localStart: `${date} 00:00:00`,
    localEnd: `${nextDate} 00:00:00`,
  };
}

function isMissingSchemaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /no such (?:table|column)|has no column named/i.test(message);
}

async function boundedAll<T>(
  db: Pick<D1Database, 'prepare'>,
  datasetName: keyof typeof DAILY_REPORT_QUERY_LIMITS,
  sql: string,
  values: readonly unknown[] = [],
): Promise<T[]> {
  const limit = DAILY_REPORT_QUERY_LIMITS[datasetName];
  const result = await db.prepare(`${sql}\nLIMIT ${limit + 1}`).bind(...values).all<T>();
  const rows = result.results ?? [];
  if (rows.length > limit) {
    throw new Error(`daily report ${datasetName} dataset exceeds hard limit ${limit}`);
  }
  return rows;
}

async function loadPositionMappings(db: Pick<D1Database, 'prepare'>): Promise<DailyReportDataset['positionMappings']> {
  try {
    return await boundedAll(db, 'positionMappings', `
      SELECT mapped_name, raw_name, raw_names, responsible_person
      FROM position_mappings
      ORDER BY mapped_name, raw_name
    `);
  } catch (error) {
    if (!isMissingSchemaError(error)) throw error;
    return await boundedAll(db, 'positionMappings', `
      SELECT mapped_name, raw_name, NULL AS raw_names, responsible_person
      FROM position_mappings
      ORDER BY mapped_name, raw_name
    `);
  }
}

async function loadResumes(
  db: Pick<D1Database, 'prepare'>,
  utcStart: string,
  utcEnd: string,
): Promise<DailyReportDataset['resumes']> {
  const pendingPlaceholders = PENDING_RESUME_STATUSES.map((status) => `'${status}'`).join(', ');
  const preferredSql = `
    SELECT id, position_id, mapped_position, position_applied, created_at,
           approved_at, rejected_at, status, screening_result
    FROM resumes
    WHERE status IN (${pendingPlaceholders})
       OR (datetime(created_at) >= datetime(?) AND datetime(created_at) < datetime(?))
       OR (datetime(approved_at) >= datetime(?) AND datetime(approved_at) < datetime(?))
       OR (datetime(rejected_at) >= datetime(?) AND datetime(rejected_at) < datetime(?))
    ORDER BY id
  `;
  const values = [utcStart, utcEnd, utcStart, utcEnd, utcStart, utcEnd];
  try {
    return await boundedAll(db, 'resumes', preferredSql, values);
  } catch (error) {
    if (!isMissingSchemaError(error)) throw error;
  }

  // A pre-0026 database cannot provide truthful approval-day events. Keep the
  // operation available, but never substitute updated_at as an approval time.
  try {
    return await boundedAll(db, 'resumes', `
      SELECT id, position_id, mapped_position, position_applied, created_at,
             NULL AS approved_at, rejected_at, status, screening_result
      FROM resumes
      WHERE status IN (${pendingPlaceholders})
         OR (datetime(created_at) >= datetime(?) AND datetime(created_at) < datetime(?))
         OR (datetime(rejected_at) >= datetime(?) AND datetime(rejected_at) < datetime(?))
      ORDER BY id
    `, [utcStart, utcEnd, utcStart, utcEnd]);
  } catch (error) {
    if (!isMissingSchemaError(error)) throw error;
    return await boundedAll(db, 'resumes', `
      SELECT id, position_id, mapped_position, position_applied, created_at,
             NULL AS approved_at, NULL AS rejected_at, status, screening_result
      FROM resumes
      WHERE status IN (${pendingPlaceholders})
         OR (datetime(created_at) >= datetime(?) AND datetime(created_at) < datetime(?))
      ORDER BY id
    `, [utcStart, utcEnd]);
  }
}

async function loadOptionalDataset<T>(loader: () => Promise<T[]>): Promise<T[]> {
  try {
    return await loader();
  } catch (error) {
    if (isMissingSchemaError(error)) return [];
    throw error;
  }
}

export async function loadDailyReportDataset(
  db: Pick<D1Database, 'prepare'>,
  reportDate: string,
): Promise<DailyReportDataset> {
  const date = assertDailyReportDate(reportDate);
  const { utcStart, utcEnd, localStart, localEnd } = reportDateBounds(date);
  const eventValues = [utcStart, utcEnd, localStart, localEnd] as const;

  const [positions, positionMappings, resumes, interviews, offers, onboardingRecords, allTimeRow] = await Promise.all([
    boundedAll<DailyReportDataset['positions'][number]>(db, 'positions', `
      SELECT id, title, status, responsible_person
      FROM positions
      ORDER BY id
    `),
    loadPositionMappings(db),
    loadResumes(db, utcStart, utcEnd),
    boundedAll<DailyReportDataset['interviews'][number]>(db, 'interviews', `
      SELECT id, resume_id, position_id, position_title, interview_time
      FROM interviews
      WHERE (datetime(interview_time) >= datetime(?) AND datetime(interview_time) < datetime(?))
         OR (datetime(interview_time) >= datetime(?) AND datetime(interview_time) < datetime(?))
      ORDER BY id
    `, eventValues),
    loadOptionalDataset(() => boundedAll<DailyReportDataset['offers'][number]>(db, 'offers', `
      SELECT id, resume_id, position_id, position_title, sent_at
      FROM offers
      WHERE (datetime(sent_at) >= datetime(?) AND datetime(sent_at) < datetime(?))
         OR (datetime(sent_at) >= datetime(?) AND datetime(sent_at) < datetime(?))
      ORDER BY id
    `, eventValues)),
    loadOptionalDataset(() => boundedAll<DailyReportDataset['onboardingRecords'][number]>(db, 'onboardingRecords', `
      SELECT id, resume_id, position_id, onboard_date
      FROM onboarding_records
      WHERE onboard_date = ?
         OR (datetime(onboard_date) >= datetime(?) AND datetime(onboard_date) < datetime(?))
      ORDER BY id
    `, [date, localStart, localEnd])),
    db.prepare('SELECT COUNT(*) AS cnt FROM resumes').bind().first<{ cnt: number }>(),
  ]);

  return {
    positions,
    positionMappings,
    resumes,
    interviews,
    offers,
    onboardingRecords,
    allTimeResumes: finiteNonNegativeInteger(allTimeRow?.cnt),
  };
}

function finiteNonNegativeInteger(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : 0;
}

function legacyOwnerRow(owner: typeof DAILY_REPORT_OWNERS[number]): DailyOwnerMetrics {
  return Object.freeze({
    owner,
    openPositions: 0,
    todayNew: 0,
    pending: 0,
    todayApproved: 0,
    todayRejected: 0,
    todayInterviews: 0,
    todayOffers: 0,
    todayOnboarding: 0,
  });
}

function parseStoredJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeV2Snapshot(value: unknown): DailyReportSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 'v2' || typeof candidate.reportDate !== 'string' || !exactReportDate(candidate.reportDate)) {
    return null;
  }
  if (typeof candidate.generatedAt !== 'string' || !Array.isArray(candidate.rows) || candidate.rows.length !== DAILY_REPORT_OWNERS.length) {
    return null;
  }
  const rows = candidate.rows.map((row, index) => {
    if (!row || typeof row !== 'object') return null;
    const source = row as Record<string, unknown>;
    const owner = DAILY_REPORT_OWNERS[index];
    if (source.owner !== owner) return null;
    return Object.freeze({
      owner,
      openPositions: finiteNonNegativeInteger(source.openPositions),
      todayNew: finiteNonNegativeInteger(source.todayNew),
      pending: finiteNonNegativeInteger(source.pending),
      todayApproved: finiteNonNegativeInteger(source.todayApproved),
      todayRejected: finiteNonNegativeInteger(source.todayRejected),
      todayInterviews: finiteNonNegativeInteger(source.todayInterviews),
      todayOffers: finiteNonNegativeInteger(source.todayOffers),
      todayOnboarding: finiteNonNegativeInteger(source.todayOnboarding),
    });
  });
  if (rows.some((row) => row === null)) return null;
  if (!candidate.totals || typeof candidate.totals !== 'object') return null;
  const totalsSource = candidate.totals as Record<string, unknown>;
  const totals = Object.freeze({
    openPositions: finiteNonNegativeInteger(totalsSource.openPositions),
    todayNew: finiteNonNegativeInteger(totalsSource.todayNew),
    pending: finiteNonNegativeInteger(totalsSource.pending),
    todayApproved: finiteNonNegativeInteger(totalsSource.todayApproved),
    todayRejected: finiteNonNegativeInteger(totalsSource.todayRejected),
    todayInterviews: finiteNonNegativeInteger(totalsSource.todayInterviews),
    todayOffers: finiteNonNegativeInteger(totalsSource.todayOffers),
    todayOnboarding: finiteNonNegativeInteger(totalsSource.todayOnboarding),
    allTimeResumes: finiteNonNegativeInteger(totalsSource.allTimeResumes),
  });
  return Object.freeze({
    version: 'v2',
    reportDate: candidate.reportDate,
    generatedAt: candidate.generatedAt,
    rows: Object.freeze(rows as DailyOwnerMetrics[]),
    totals,
    unassigned: finiteNonNegativeInteger(candidate.unassigned),
  });
}

/**
 * Converts pre-v2 rows for display without attributing historical aggregate
 * counts to an owner. Known report-wide values remain available in totals.
 */
export function normalizeStoredDailyReportSnapshot(record: StoredDailyReportRecord): DailyReportSnapshot {
  const storedStats = parseStoredJson(record.stats);
  const v2 = normalizeV2Snapshot(storedStats) ?? normalizeV2Snapshot(record.snapshot) ?? normalizeV2Snapshot(record);
  if (v2) return v2;

  const legacyStats = storedStats && typeof storedStats === 'object'
    ? storedStats as Record<string, unknown>
    : {};
  const legacy = { ...legacyStats, ...record };
  const rows = Object.freeze(DAILY_REPORT_OWNERS.map(legacyOwnerRow));
  const reportDate = typeof legacy.report_date === 'string' ? legacy.report_date : '';
  const generatedAt = typeof legacy.created_at === 'string' ? legacy.created_at : `${reportDate}T00:00:00.000+08:00`;
  const totals = Object.freeze({
    openPositions: finiteNonNegativeInteger(legacy.open_requisitions),
    todayNew: 0,
    pending: finiteNonNegativeInteger(legacy.pending_screening),
    todayApproved: finiteNonNegativeInteger(legacy.approved ?? legacy.approved_candidates),
    todayRejected: finiteNonNegativeInteger(legacy.rejected ?? legacy.rejected_candidates),
    todayInterviews: finiteNonNegativeInteger(legacy.total_interviews ?? legacy.active_interviews),
    todayOffers: finiteNonNegativeInteger(legacy.total_offers),
    todayOnboarding: finiteNonNegativeInteger(legacy.total_onboarding ?? legacy.onboarding_count),
    allTimeResumes: finiteNonNegativeInteger(legacy.total_resumes),
  });

  return Object.freeze({ version: 'v2', reportDate, generatedAt, rows, totals, unassigned: 0 });
}

function usableSummary(value: unknown, snapshot: DailyReportSnapshot): string {
  if (typeof value !== 'string') return buildDailyReportFallbackSummary(snapshot);
  const summary = value.trim().replace(/\s+/g, ' ');
  return summary && summary.length <= 150 ? summary : buildDailyReportFallbackSummary(snapshot);
}

export function buildStoredDailyReportCard(record: StoredDailyReportRecord): DailyReportFeishuCard {
  const snapshot = normalizeStoredDailyReportSnapshot(record);
  return buildDailyReportFeishuCard(snapshot, usableSummary(record.ai_summary, snapshot));
}

export async function sendStoredDailyReport(
  record: StoredDailyReportRecord,
  target: DailyReportDeliveryTarget,
  deliver: DailyReportDeliver,
): Promise<void> {
  if (!target.id || (target.type !== 'chat' && target.type !== 'user')) {
    throw new Error('daily report delivery target is invalid');
  }
  const card = buildStoredDailyReportCard(record);
  await deliver(target, card);
}

export async function generateAndPersistDailyReport(
  env: { DB: Pick<D1Database, 'prepare'> },
  reportDate: string,
  dependencies: DailyReportGenerationDependencies,
): Promise<PersistedDailyReport> {
  const date = assertDailyReportDate(reportDate);
  const generatedAt = dependencies.generatedAt?.() ?? new Date().toISOString();
  const id = dependencies.id?.() ?? crypto.randomUUID();
  const dataset = await (dependencies.loadDataset ?? loadDailyReportDataset)(env.DB, date);
  const snapshot = buildDailyReportSnapshot(dataset, date, generatedAt);

  let aiSummary: string;
  try {
    aiSummary = usableSummary(await dependencies.summarize(snapshot), snapshot);
  } catch {
    aiSummary = buildDailyReportFallbackSummary(snapshot);
  }
  const candidateDetails = await dependencies.loadCandidateDetails(date);
  const stats = JSON.stringify(snapshot);
  const candidateDetailsJson = JSON.stringify(candidateDetails);

  await env.DB.prepare(`
    INSERT INTO daily_reports (
      id, report_date, total_resumes, pending_screening, approved, rejected,
      total_interviews, total_offers, total_onboarding, ai_summary, stats,
      candidate_details, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    date,
    snapshot.totals.allTimeResumes,
    snapshot.totals.pending,
    snapshot.totals.todayApproved,
    snapshot.totals.todayRejected,
    snapshot.totals.todayInterviews,
    snapshot.totals.todayOffers,
    snapshot.totals.todayOnboarding,
    aiSummary,
    stats,
    candidateDetailsJson,
    generatedAt,
  ).run();

  return Object.freeze({
    id,
    report_date: date,
    total_resumes: snapshot.totals.allTimeResumes,
    pending_screening: snapshot.totals.pending,
    approved: snapshot.totals.todayApproved,
    rejected: snapshot.totals.todayRejected,
    total_interviews: snapshot.totals.todayInterviews,
    total_offers: snapshot.totals.todayOffers,
    total_onboarding: snapshot.totals.todayOnboarding,
    ai_summary: aiSummary,
    stats,
    candidate_details: candidateDetailsJson,
    created_at: generatedAt,
    snapshot,
  });
}

export async function generatePersistAndDeliverDailyReport(
  env: { DB: Pick<D1Database, 'prepare'> },
  reportDate: string,
  target: DailyReportDeliveryTarget,
  dependencies: DailyReportGenerationDependencies,
  deliver: DailyReportDeliver,
): Promise<PersistedDailyReport> {
  const report = await generateAndPersistDailyReport(env, reportDate, dependencies);
  await sendStoredDailyReport(report, target, deliver);
  return report;
}

/**
 * Records explicit human/system decisions without changing business status.
 * Pre-0026 databases remain operable; approval events are deliberately not
 * fabricated from updated_at when the approved_at column is unavailable.
 */
export async function recordResumeDecisionTimestamp(
  db: Pick<D1Database, 'prepare'>,
  resumeId: string | null | undefined,
  decision: 'approved' | 'rejected' | 'reset',
  timestamp = new Date().toISOString(),
): Promise<boolean> {
  if (!resumeId) return false;

  const preferred = decision === 'approved'
    ? { sql: 'UPDATE resumes SET approved_at = ?, rejected_at = NULL WHERE id = ?', values: [timestamp, resumeId] }
    : decision === 'rejected'
      ? { sql: 'UPDATE resumes SET rejected_at = ?, approved_at = NULL WHERE id = ?', values: [timestamp, resumeId] }
      : { sql: 'UPDATE resumes SET approved_at = NULL, rejected_at = NULL WHERE id = ?', values: [resumeId] };

  try {
    await db.prepare(preferred.sql).bind(...preferred.values).run();
    return true;
  } catch (error) {
    if (!isMissingSchemaError(error)) throw error;
  }

  if (decision === 'approved') return false;
  const legacy = decision === 'rejected'
    ? { sql: 'UPDATE resumes SET rejected_at = ? WHERE id = ?', values: [timestamp, resumeId] }
    : { sql: 'UPDATE resumes SET rejected_at = NULL WHERE id = ?', values: [resumeId] };
  try {
    await db.prepare(legacy.sql).bind(...legacy.values).run();
    return true;
  } catch (error) {
    if (isMissingSchemaError(error)) return false;
    throw error;
  }
}
