export const DAILY_REPORT_OWNERS = ['何雨菱', '杜雁玲', '魏秋柠'] as const;

export type DailyReportOwner = typeof DAILY_REPORT_OWNERS[number];

export interface DailyReportPositionRecord {
  id: string;
  title?: string | null;
  status?: string | null;
  responsible_person?: string | null;
}

export interface DailyReportPositionMappingRecord {
  mapped_name?: string | null;
  raw_name?: string | null;
  raw_names?: string | readonly string[] | null;
  responsible_person?: string | null;
}

interface DailyReportPositionReference {
  position_id?: string | null;
  mapped_position?: string | null;
  position_applied?: string | null;
  position_title?: string | null;
}

export interface DailyReportResumeRecord extends DailyReportPositionReference {
  id: string;
  created_at?: string | null;
  updated_at?: string | null;
  screened_at?: string | null;
  reviewed_at?: string | null;
  status?: string | null;
  screening_result?: string | null;
}

export interface DailyReportInterviewRecord extends DailyReportPositionReference {
  id: string;
  resume_id?: string | null;
  interview_time?: string | null;
}

export interface DailyReportOfferRecord extends DailyReportPositionReference {
  id: string;
  resume_id?: string | null;
  sent_at?: string | null;
}

export interface DailyReportOnboardingRecord extends DailyReportPositionReference {
  id: string;
  resume_id?: string | null;
  onboard_date?: string | null;
}

export interface DailyReportDataset {
  positions: DailyReportPositionRecord[];
  positionMappings: DailyReportPositionMappingRecord[];
  resumes: DailyReportResumeRecord[];
  interviews: DailyReportInterviewRecord[];
  offers: DailyReportOfferRecord[];
  onboardingRecords: DailyReportOnboardingRecord[];
  allTimeResumes: number;
}

export interface DailyOwnerMetrics {
  readonly owner: DailyReportOwner;
  readonly openPositions: number;
  readonly todayNew: number;
  readonly pending: number;
  readonly todayApproved: number;
  readonly todayRejected: number;
  readonly todayInterviews: number;
  readonly todayOffers: number;
  readonly todayOnboarding: number;
}

export type DailyReportTotals = Readonly<Omit<DailyOwnerMetrics, 'owner'> & { allTimeResumes: number }>;

export interface DailyReportSnapshot {
  readonly version: 'v2';
  readonly reportDate: string;
  readonly generatedAt: string;
  readonly rows: readonly DailyOwnerMetrics[];
  readonly totals: DailyReportTotals;
  readonly unassigned: number;
}

export interface DailyReportFeishuCard {
  readonly config: Readonly<Record<string, unknown>>;
  readonly header: Readonly<Record<string, unknown>>;
  readonly elements: readonly Readonly<Record<string, unknown>>[];
}

type MetricName = Exclude<keyof DailyOwnerMetrics, 'owner'>;
type MutableMetrics = { owner: DailyReportOwner } & Record<MetricName, number>;

const METRIC_NAMES: readonly MetricName[] = [
  'openPositions',
  'todayNew',
  'pending',
  'todayApproved',
  'todayRejected',
  'todayInterviews',
  'todayOffers',
  'todayOnboarding',
];

const OPEN_POSITION_STATUSES = new Set(['open', 'published']);
const PENDING_STATUSES = new Set([
  'pending',
  'pending_screening',
  'pending_review',
  'pending_dept_review',
  'pending_hr_decision',
  '待初筛',
  '待筛选',
]);
const APPROVED_RESULTS = new Set(['approved', 'accept', 'accepted', 'pass', 'passed', '通过']);
const REJECTED_RESULTS = new Set(['rejected', 'reject', 'failed', 'fail', '淘汰', '拒绝', '不通过']);

function normalizeExact(value: string | null | undefined): string {
  return (value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('zh-CN');
}

function normalizeStatus(value: string | null | undefined): string {
  return normalizeExact(value).replace(/[ -]+/g, '_');
}

function ownerName(value: string | null | undefined): string {
  return (value ?? '').normalize('NFKC').trim();
}

function isDailyReportOwner(value: string): value is DailyReportOwner {
  return (DAILY_REPORT_OWNERS as readonly string[]).includes(value);
}

function addCandidate(map: Map<string, Set<string>>, key: string | null | undefined, owner: string | null | undefined): void {
  const normalizedKey = normalizeExact(key);
  const normalizedOwner = ownerName(owner);
  if (!normalizedKey || !normalizedOwner) return;
  const owners = map.get(normalizedKey) ?? new Set<string>();
  owners.add(normalizedOwner);
  map.set(normalizedKey, owners);
}

function mappingAliases(mapping: DailyReportPositionMappingRecord): readonly string[] {
  const aliases: string[] = [];
  if (mapping.raw_name) aliases.push(mapping.raw_name);
  if (Array.isArray(mapping.raw_names)) {
    aliases.push(...mapping.raw_names.filter((value): value is string => typeof value === 'string'));
  } else if (typeof mapping.raw_names === 'string' && mapping.raw_names.trim()) {
    try {
      const parsed: unknown = JSON.parse(mapping.raw_names);
      if (Array.isArray(parsed)) {
        aliases.push(...parsed.filter((value): value is string => typeof value === 'string'));
      } else {
        aliases.push(mapping.raw_names);
      }
    } catch {
      aliases.push(...mapping.raw_names.split(/[,，;；]/));
    }
  }
  return aliases;
}

interface OwnerIndexes {
  readonly byPositionId: ReadonlyMap<string, ReadonlySet<string>>;
  readonly byMappedTitle: ReadonlyMap<string, ReadonlySet<string>>;
  readonly byAlias: ReadonlyMap<string, ReadonlySet<string>>;
}

function buildOwnerIndexes(dataset: DailyReportDataset): OwnerIndexes {
  const byPositionId = new Map<string, Set<string>>();
  const byMappedTitle = new Map<string, Set<string>>();
  const byAlias = new Map<string, Set<string>>();

  for (const position of dataset.positions) {
    addCandidate(byPositionId, position.id, position.responsible_person);
    addCandidate(byMappedTitle, position.title, position.responsible_person);
  }
  for (const mapping of dataset.positionMappings) {
    addCandidate(byMappedTitle, mapping.mapped_name, mapping.responsible_person);
    for (const alias of mappingAliases(mapping)) {
      addCandidate(byAlias, alias, mapping.responsible_person);
    }
  }

  return { byPositionId, byMappedTitle, byAlias };
}

function candidatesFor(keys: readonly (string | null | undefined)[], index: ReadonlyMap<string, ReadonlySet<string>>): Set<string> {
  const candidates = new Set<string>();
  for (const key of keys) {
    const owners = index.get(normalizeExact(key));
    if (!owners) continue;
    for (const owner of owners) candidates.add(owner);
  }
  return candidates;
}

function resolveCandidateSet(candidates: ReadonlySet<string>): DailyReportOwner | null | undefined {
  if (candidates.size === 0) return undefined;
  if (candidates.size !== 1) return null;
  const [candidate] = candidates;
  return isDailyReportOwner(candidate) ? candidate : null;
}

function resolveOwner(
  indexes: OwnerIndexes,
  record: DailyReportPositionReference,
  linkedResume?: DailyReportResumeRecord,
): DailyReportOwner | null {
  const positionOwner = resolveCandidateSet(candidatesFor(
    [record.position_id, linkedResume?.position_id],
    indexes.byPositionId,
  ));
  if (positionOwner !== undefined) return positionOwner;

  const mappedOwner = resolveCandidateSet(candidatesFor(
    [record.mapped_position, record.position_title, linkedResume?.mapped_position],
    indexes.byMappedTitle,
  ));
  if (mappedOwner !== undefined) return mappedOwner;

  return resolveCandidateSet(candidatesFor(
    [record.position_applied, linkedResume?.position_applied],
    indexes.byAlias,
  )) ?? null;
}

function shanghaiDate(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const hasTimeZone = /(?:z|[+-]\d{2}:?\d{2})$/i.test(raw);
  const normalized = hasTimeZone ? raw : `${raw.replace(' ', 'T')}Z`;
  const instant = new Date(normalized);
  if (Number.isNaN(instant.getTime())) return null;

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function requireReportDate(reportDate: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate) || shanghaiDate(`${reportDate}T00:00:00+08:00`) !== reportDate) {
    throw new TypeError('reportDate must be an exact YYYY-MM-DD calendar date');
  }
}

function isOnReportDate(value: string | null | undefined, reportDate: string): boolean {
  return shanghaiDate(value) === reportDate;
}

function isApproved(resume: DailyReportResumeRecord): boolean {
  const result = normalizeStatus(resume.screening_result || resume.status);
  return APPROVED_RESULTS.has(result);
}

function isRejected(resume: DailyReportResumeRecord): boolean {
  const result = normalizeStatus(resume.screening_result || resume.status);
  return REJECTED_RESULTS.has(result);
}

function isPending(resume: DailyReportResumeRecord): boolean {
  if (isApproved(resume) || isRejected(resume)) return false;
  return PENDING_STATUSES.has(normalizeStatus(resume.status))
    || PENDING_STATUSES.has(normalizeStatus(resume.screening_result));
}

function finalScreeningTime(resume: DailyReportResumeRecord): string | null | undefined {
  return resume.screened_at || resume.reviewed_at || resume.updated_at;
}

function emptyMetrics(owner: DailyReportOwner): MutableMetrics {
  return {
    owner,
    openPositions: 0,
    todayNew: 0,
    pending: 0,
    todayApproved: 0,
    todayRejected: 0,
    todayInterviews: 0,
    todayOffers: 0,
    todayOnboarding: 0,
  };
}

function safeCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function buildDailyReportSnapshot(
  dataset: DailyReportDataset,
  reportDate: string,
  generatedAt: string,
): DailyReportSnapshot {
  requireReportDate(reportDate);
  const indexes = buildOwnerIndexes(dataset);
  const metrics = new Map<DailyReportOwner, MutableMetrics>(
    DAILY_REPORT_OWNERS.map((owner) => [owner, emptyMetrics(owner)]),
  );
  const resumesById = new Map(dataset.resumes.map((resume) => [resume.id, resume]));
  const unassignedRecords = new Set<string>();

  const count = (
    recordKey: string,
    owner: DailyReportOwner | null,
    metricNames: readonly MetricName[],
  ): void => {
    if (metricNames.length === 0) return;
    if (!owner) {
      unassignedRecords.add(recordKey);
      return;
    }
    const row = metrics.get(owner);
    if (!row) return;
    for (const metricName of metricNames) row[metricName] += 1;
  };

  dataset.positions.forEach((position, index) => {
    if (!OPEN_POSITION_STATUSES.has(normalizeStatus(position.status))) return;
    count(`position:${position.id || index}`, resolveOwner(indexes, {
      position_id: position.id,
      mapped_position: position.title,
    }), ['openPositions']);
  });

  dataset.resumes.forEach((resume, index) => {
    const applicableMetrics: MetricName[] = [];
    if (isOnReportDate(resume.created_at, reportDate)) applicableMetrics.push('todayNew');
    if (isPending(resume)) applicableMetrics.push('pending');
    if (isApproved(resume) && isOnReportDate(finalScreeningTime(resume), reportDate)) {
      applicableMetrics.push('todayApproved');
    }
    if (isRejected(resume) && isOnReportDate(finalScreeningTime(resume), reportDate)) {
      applicableMetrics.push('todayRejected');
    }
    count(`resume:${resume.id || index}`, resolveOwner(indexes, resume), applicableMetrics);
  });

  dataset.interviews.forEach((interview, index) => {
    if (!isOnReportDate(interview.interview_time, reportDate)) return;
    count(
      `interview:${interview.id || index}`,
      resolveOwner(indexes, interview, interview.resume_id ? resumesById.get(interview.resume_id) : undefined),
      ['todayInterviews'],
    );
  });

  dataset.offers.forEach((offer, index) => {
    if (!isOnReportDate(offer.sent_at, reportDate)) return;
    count(
      `offer:${offer.id || index}`,
      resolveOwner(indexes, offer, offer.resume_id ? resumesById.get(offer.resume_id) : undefined),
      ['todayOffers'],
    );
  });

  dataset.onboardingRecords.forEach((onboarding, index) => {
    if (!isOnReportDate(onboarding.onboard_date, reportDate)) return;
    count(
      `onboarding:${onboarding.id || index}`,
      resolveOwner(indexes, onboarding, onboarding.resume_id ? resumesById.get(onboarding.resume_id) : undefined),
      ['todayOnboarding'],
    );
  });

  const rows = Object.freeze(DAILY_REPORT_OWNERS.map((owner) => Object.freeze({ ...metrics.get(owner)! })));
  const totalsValues = Object.fromEntries(
    METRIC_NAMES.map((metricName) => [
      metricName,
      rows.reduce((sum, row) => sum + row[metricName], 0),
    ]),
  ) as Omit<DailyReportTotals, 'allTimeResumes'>;
  const totals: DailyReportTotals = Object.freeze({
    ...totalsValues,
    allTimeResumes: safeCount(dataset.allTimeResumes),
  });

  return Object.freeze({
    version: 'v2' as const,
    reportDate,
    generatedAt,
    rows,
    totals,
    unassigned: unassignedRecords.size,
  });
}

const TABLE_COLUMNS = Object.freeze([
  { name: 'owner', display_name: '负责人', data_type: 'text', width: 'auto' },
  { name: 'open_positions', display_name: '开放岗位', data_type: 'text', width: 'auto' },
  { name: 'today_new', display_name: '今日新增', data_type: 'text', width: 'auto' },
  { name: 'pending', display_name: '待初筛', data_type: 'text', width: 'auto' },
  { name: 'today_approved', display_name: '今日通过', data_type: 'text', width: 'auto' },
  { name: 'today_rejected', display_name: '今日淘汰', data_type: 'text', width: 'auto' },
  { name: 'today_interviews', display_name: '今日面试', data_type: 'text', width: 'auto' },
  { name: 'today_offers', display_name: 'Offer', data_type: 'text', width: 'auto' },
  { name: 'today_onboarding', display_name: '入职', data_type: 'text', width: 'auto' },
]);

function tableRow(owner: string, metrics: Omit<DailyOwnerMetrics, 'owner'>): Readonly<Record<string, string>> {
  return Object.freeze({
    owner,
    open_positions: String(metrics.openPositions),
    today_new: String(metrics.todayNew),
    pending: String(metrics.pending),
    today_approved: String(metrics.todayApproved),
    today_rejected: String(metrics.todayRejected),
    today_interviews: String(metrics.todayInterviews),
    today_offers: String(metrics.todayOffers),
    today_onboarding: String(metrics.todayOnboarding),
  });
}

export function buildDailyReportFeishuCard(
  snapshot: DailyReportSnapshot,
  summary: string,
): DailyReportFeishuCard {
  const rows = [
    ...snapshot.rows.map((row) => tableRow(row.owner, row)),
    tableRow('合计', snapshot.totals),
  ];
  const elements: Readonly<Record<string, unknown>>[] = [
    Object.freeze({
      tag: 'table',
      page_size: 4,
      row_height: 'low',
      freeze_first_column: true,
      header_style: Object.freeze({ bold: true, background_style: 'grey', lines: 1 }),
      columns: TABLE_COLUMNS,
      rows: Object.freeze(rows),
    }),
    Object.freeze({
      tag: 'div',
      text: Object.freeze({ tag: 'lark_md', content: `**日报摘要**\n${summary}` }),
    }),
  ];
  if (snapshot.unassigned > 0) {
    elements.push(Object.freeze({
      tag: 'note',
      elements: Object.freeze([
        Object.freeze({ tag: 'plain_text', content: `⚠️ 未唯一归属记录 ${snapshot.unassigned} 条，未计入负责人表格。` }),
      ]),
    }));
  }

  return Object.freeze({
    config: Object.freeze({ wide_screen_mode: true }),
    header: Object.freeze({
      template: 'blue',
      title: Object.freeze({ tag: 'plain_text', content: `📊 招聘日报 · ${snapshot.reportDate}` }),
    }),
    elements: Object.freeze(elements),
  });
}

function activity(row: DailyOwnerMetrics): number {
  return row.todayNew + row.todayApproved + row.todayInterviews;
}

export function buildDailyReportFallbackSummary(snapshot: DailyReportSnapshot): string {
  const mostActive = snapshot.rows.reduce((best, row) => activity(row) > activity(best) ? row : best);
  const largestPending = snapshot.rows.reduce((best, row) => row.pending > best.pending ? row : best);
  const totalActivity = snapshot.rows.reduce((sum, row) => sum + activity(row), 0);

  if (totalActivity === 0) {
    const queue = largestPending.pending > 0
      ? `当前待初筛最多为${largestPending.owner}${largestPending.pending}份`
      : '当前无待初筛积压';
    return `当日无新增推进，三位负责人当日新增、通过和面试均为0；${queue}。明日建议优先核对开放岗位与候选人来源，再按待初筛队列逐项推进。`;
  }

  const nextAction = largestPending.pending > 0
    ? `明日建议优先清理${largestPending.owner}的待初筛队列，并于收工前复盘处理结果。`
    : '明日建议围绕开放岗位补充候选人，并于收工前复盘当日转化。';
  return `当日推进量最高为${mostActive.owner}，新增、通过与面试合计${activity(mostActive)}项；待初筛队列最大为${largestPending.owner}${largestPending.pending}份。${nextAction}`;
}
