import type { DashboardPriority, DashboardV3Position } from './dashboard-v3-types';
import { isP2Position, type FeishuPositionMetric } from './feishu-board-source';

export interface D1ResumeOverlayRow {
  id: string;
  position_id?: string | null;
  position_applied?: string | null;
  mapped_position?: string | null;
  city?: string | null;
  resume_source?: string | null;
  resume_source_record_id?: string | null;
  resume_ingest_key?: string | null;
}

export interface D1PositionOverlayRow {
  id: string;
  title: string;
  location?: string | null;
  department?: string | null;
  urgency?: string | null;
  status?: string | null;
  headcount?: number | null;
  responsible_person?: string | null;
}

export interface D1PositionCountRow {
  position_id: string;
  count: number;
}

export interface D1OverlayInput {
  resumes: D1ResumeOverlayRow[];
  positions: D1PositionOverlayRow[];
  scheduled: D1PositionCountRow[];
  first_pass: D1PositionCountRow[];
  second_pass: D1PositionCountRow[];
  third_pass: D1PositionCountRow[];
  offers: D1PositionCountRow[];
  hired: D1PositionCountRow[];
}

export interface D1DashboardOverlay {
  byPosition: Record<string, {
    resume_push_increment: number;
    first_scheduled_increment: number;
    first_pass_increment: number;
    second_pass_increment: number;
    third_pass_increment: number;
    offers_increment: number;
    hired_increment: number;
    source_resume_ids: string[];
  }>;
  d1OnlyPositions: DashboardV3Position[];
  unmatchedResumeCount: number;
}

type OverlayCounts = D1DashboardOverlay['byPosition'][string];

function emptyCounts(): OverlayCounts {
  return {
    resume_push_increment: 0,
    first_scheduled_increment: 0,
    first_pass_increment: 0,
    second_pass_increment: 0,
    third_pass_increment: 0,
    offers_increment: 0,
    hired_increment: 0,
    source_resume_ids: [],
  };
}

function key(name: unknown, city: unknown): string {
  return `${String(name || '').trim().toLocaleLowerCase('zh-CN')}::${String(city || '').trim().toLocaleLowerCase('zh-CN')}`;
}

function priority(value: unknown): DashboardPriority {
  const raw = String(value || '').toLowerCase();
  if (raw.includes('high') || raw.includes('p0') || raw.includes('紧急')) return 'P0';
  if (raw.includes('low') || raw.includes('p2') || raw.includes('储备')) return 'P2';
  return 'P1';
}

function status(value: unknown): string {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'open' || raw === 'published') return '招聘中';
  if (raw === 'closed' || raw === 'completed') return '已完成';
  if (raw === 'cancelled') return '已取消';
  return String(value || '').trim() || '招聘中';
}

function addCount(target: OverlayCounts, field: keyof Omit<OverlayCounts, 'source_resume_ids'>, value: number): void {
  target[field] += Number.isFinite(value) ? value : 0;
}

function countMap(rows: D1PositionCountRow[]): Map<string, number> {
  return new Map(rows.map((row) => [row.position_id, Number(row.count) || 0]));
}

function isFeishuRecord(row: D1ResumeOverlayRow, feishuIds: Set<string>): boolean {
  return row.resume_source === 'feishu'
    || feishuIds.has(String(row.resume_source_record_id || ''))
    || feishuIds.has(row.id);
}

function createD1Position(
  position: D1PositionOverlayRow,
  counts: OverlayCounts,
  input: D1OverlayInput,
): DashboardV3Position {
  const city = String(position.location || '').trim();
  const positionKey = position.id;
  const scheduled = countMap(input.scheduled).get(positionKey) || 0;
  const firstPass = countMap(input.first_pass).get(positionKey) || 0;
  const secondPass = countMap(input.second_pass).get(positionKey) || 0;
  const thirdPass = countMap(input.third_pass).get(positionKey) || 0;
  const offers = countMap(input.offers).get(positionKey) || 0;
  const hired = countMap(input.hired).get(positionKey) || 0;
  return {
    position_id: `d1:${position.id}`,
    department: String(position.department || '未分配事业部'),
    position_name: position.title,
    display_name: city ? `${position.title}-${city}` : position.title,
    city,
    hrbps: position.responsible_person ? [position.responsible_person] : ['未分配'],
    priority: priority(position.urgency),
    status: status(position.status),
    headcount: Number(position.headcount) || 0,
    resume_push: counts.resume_push_increment,
    first_scheduled: scheduled,
    first_pass: firstPass,
    second_pass: secondPass,
    third_pass: thirdPass,
    final_pass: thirdPass || secondPass,
    offers,
    hired,
    elapsed_days: 0,
    weekly_target: 0,
    notes: 'D1 独有岗位',
    data_sources: ['d1'],
    unmatched: true,
  };
}

export function buildD1DashboardOverlay(input: D1OverlayInput, feishuPositions: FeishuPositionMetric[]): D1DashboardOverlay {
  const feishuByKey = new Map(feishuPositions.map((position) => [key(position.position_name, position.city), position]));
  const feishuIds = new Set(feishuPositions.map((position) => position.feishu_record_id));
  const d1PositionById = new Map(input.positions.map((position) => [position.id, position]));
  const d1KeyById = new Map(input.positions.map((position) => [position.id, key(position.title, position.location)]));
  const byPosition: D1DashboardOverlay['byPosition'] = {};
  const seenIngestKeys = new Set<string>();
  let unmatchedResumeCount = 0;

  const resolveTarget = (row: D1ResumeOverlayRow): string | null => {
    const direct = row.position_id ? d1KeyById.get(row.position_id) : null;
    if (direct && feishuByKey.has(direct)) return feishuByKey.get(direct)!.feishu_record_id;
    // Older production D1 schemas do not have resumes.city. When the resume
    // is linked to a local position, use that position's location so the
    // D1 overlay can still match the Feishu/static position by name + city.
    const resumeCity = row.city || (row.position_id ? d1PositionById.get(row.position_id)?.location : null);
    const candidate = key(row.mapped_position || row.position_applied, resumeCity);
    if (feishuByKey.has(candidate)) return feishuByKey.get(candidate)!.feishu_record_id;
    if (row.position_id && d1PositionById.has(row.position_id)) return `d1:${row.position_id}`;
    return null;
  };

  for (const resume of input.resumes) {
    const target = resolveTarget(resume);
    if (!target) {
      unmatchedResumeCount++;
      continue;
    }
    const counts = byPosition[target] || (byPosition[target] = emptyCounts());
    const ingestKey = String(resume.resume_ingest_key || resume.id || '');
    if (seenIngestKeys.has(ingestKey)) continue;
    seenIngestKeys.add(ingestKey);
    if (!isFeishuRecord(resume, feishuIds)) {
      counts.resume_push_increment++;
      counts.source_resume_ids.push(resume.id);
    }
  }

  const eventFields: Array<[keyof D1OverlayInput, keyof Omit<OverlayCounts, 'source_resume_ids'>]> = [
    ['scheduled', 'first_scheduled_increment'],
    ['first_pass', 'first_pass_increment'],
    ['second_pass', 'second_pass_increment'],
    ['third_pass', 'third_pass_increment'],
    ['offers', 'offers_increment'],
    ['hired', 'hired_increment'],
  ];
  for (const [inputField, outputField] of eventFields) {
    const rows = input[inputField] as D1PositionCountRow[];
    for (const row of rows) {
      const position = d1PositionById.get(row.position_id);
      const target = position ? (feishuByKey.get(key(position.title, position.location))?.feishu_record_id || `d1:${row.position_id}`) : null;
      if (!target) continue;
      const counts = byPosition[target] || (byPosition[target] = emptyCounts());
      addCount(counts, outputField, Number(row.count) || 0);
    }
  }

  const d1OnlyPositions = input.positions
    .filter((position) => !feishuByKey.has(key(position.title, position.location)))
    .map((position) => createD1Position(position, byPosition[`d1:${position.id}`] || emptyCounts(), input))
    .filter((position) => !isP2Position(position));

  return { byPosition, d1OnlyPositions, unmatchedResumeCount };
}

export async function loadD1DashboardOverlay(
  db: D1Database,
  feishuPositions: FeishuPositionMetric[],
  _at: Date = new Date(),
): Promise<D1DashboardOverlay> {
  const loadResumeRows = async () => {
    try {
      return await db.prepare('SELECT id, position_id, position_applied, mapped_position, city, resume_source, resume_source_record_id, resume_ingest_key FROM resumes').all();
    } catch (error) {
      // Production databases created before the dashboard overlay migration
      // may not have resumes.city. Keep the dashboard available and derive
      // the city from positions.location when position_id is present.
      if (!/no such column:\s*city/i.test(String((error as any)?.message || error))) throw error;
      console.warn('[DashboardV3] resumes.city is unavailable; using position location fallback');
      return db.prepare('SELECT id, position_id, position_applied, mapped_position, resume_source, resume_source_record_id, resume_ingest_key FROM resumes').all();
    }
  };
  const [resumes, positions, scheduled, firstPass, secondPass, thirdPass, offers, hired] = await Promise.all([
    loadResumeRows(),
    db.prepare('SELECT id, title, location, department, urgency, status, headcount, responsible_person FROM positions').all(),
    db.prepare('SELECT position_id, COUNT(*) AS count FROM interviews WHERE round = 1 GROUP BY position_id').all(),
    db.prepare("SELECT position_id, COUNT(*) AS count FROM interviews WHERE (round = 1 AND (result IN ('pass', 'passed') OR status2 = 'passed')) GROUP BY position_id").all(),
    db.prepare("SELECT position_id, COUNT(*) AS count FROM interviews WHERE ((round = 1 AND (result2 IN ('pass', 'passed') OR status2 = 'passed')) OR (round = 2 AND result IN ('pass', 'passed'))) GROUP BY position_id").all(),
    db.prepare("SELECT position_id, COUNT(*) AS count FROM interviews WHERE round = 3 AND result IN ('pass', 'passed') GROUP BY position_id").all(),
    db.prepare("SELECT position_id, COUNT(*) AS count FROM offers WHERE status NOT IN ('draft', 'cancelled') GROUP BY position_id").all(),
    db.prepare("SELECT position_id, COUNT(*) AS count FROM onboarding_records WHERE status = 'onboarded' GROUP BY position_id").all(),
  ]);
  return buildD1DashboardOverlay({
    resumes: (resumes.results || []) as unknown as D1ResumeOverlayRow[],
    positions: (positions.results || []) as unknown as D1PositionOverlayRow[],
    scheduled: (scheduled.results || []) as unknown as D1PositionCountRow[],
    first_pass: (firstPass.results || []) as unknown as D1PositionCountRow[],
    second_pass: (secondPass.results || []) as unknown as D1PositionCountRow[],
    third_pass: (thirdPass.results || []) as unknown as D1PositionCountRow[],
    offers: (offers.results || []) as unknown as D1PositionCountRow[],
    hired: (hired.results || []) as unknown as D1PositionCountRow[],
  }, feishuPositions);
}
