import type { DashboardPriority } from './dashboard-v3-types';

export interface FeishuBoardSourceRecord {
  record_id: string;
  fields: Record<string, unknown>;
  table: 'zhipei' | 'yanglao';
}

export interface FeishuPositionMetric {
  feishu_record_id: string;
  department: string;
  position_name: string;
  position_type?: string;
  display_name: string;
  city: string;
  hrbps: string[];
  priority: DashboardPriority;
  status: string;
  headcount: number;
  resume_push: number;
  first_scheduled: number;
  first_pass: number;
  second_pass: number;
  third_pass: number | null;
  offers: number;
  hired: number;
  elapsed_days: number;
  weekly_target: number;
  notes: string;
}

const FIELD_NAMES = {
  position_name: ['岗位名称'],
  position_type: ['岗位类型', '职位类型', '岗位类别'],
  city: ['城市'],
  department: ['所属部门', '所属事业部', '事业部'],
  hrbps: ['负责HRBP', '负责 HRBP', 'HRBP', '负责'],
  priority: ['优先级', '优先'],
  status: ['招聘状态', '状态'],
  headcount: ['在招人数', '招聘人数'],
  resume_push: ['简历推送'],
  first_scheduled: ['安排1面', '安排 1 面', '1面人数', '1 面人数'],
  first_pass: ['1面通过', '1 面通过'],
  second_pass: ['2面通过', '2 面通过'],
  third_pass: ['3面通过', '3 面通过', '终面通过'],
  offers: ['发放Offer数', '发放 Offer数', '发放Offer', 'Offer'],
  hired: ['入职数', '入职'],
  elapsed_days: ['已耗时天数', '耗时', '天数'],
  weekly_target: ['本周需完结数', '本周需完结'],
  notes: ['备注'],
} as const;

function normalized(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, '').trim();
}

function rawField(record: Record<string, unknown>, candidates: readonly string[]): unknown {
  const keys = Object.keys(record);
  for (const candidate of candidates) {
    const normalizedCandidate = normalized(candidate);
    const exact = keys.find((key) => normalized(key) === normalizedCandidate);
    if (exact) return record[exact];
  }
  for (const candidate of candidates) {
    const normalizedCandidate = normalized(candidate);
    const partial = keys.find((key) => normalized(key).includes(normalizedCandidate));
    if (partial) return record[partial];
  }
  return undefined;
}

function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(', ');
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    if ('text' in object) return text(object.text);
    if ('value' in object) return text(object.value);
    if ('name' in object) return text(object.name);
  }
  return String(value ?? '').trim();
}

function number(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    if ('value' in object) return number(object.value);
    if ('text' in object) return number(object.text);
  }
  const parsed = Number.parseFloat(text(value).replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return null;
  return number(value);
}

function normalizeDepartment(value: string): string {
  if (value.includes('养老')) return '养老及商业事业部';
  if (value.includes('AI创新') || value.includes('AI 创新')) return 'AI创新事业部';
  if (value.includes('雏渐肥')) return '雏渐肥事业部';
  if (value.includes('职培')) return '职培事业部';
  return value || '未分配事业部';
}

function names(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (item && typeof item === 'object') {
        const object = item as Record<string, unknown>;
        return text(object.name ?? object.text ?? object.id);
      }
      return text(item);
    }).filter(Boolean);
  }
  return text(value).split(/[,，、/]+/).map((item) => item.trim()).filter(Boolean);
}

function inferPriority(value: unknown, notes: string, status: string): DashboardPriority {
  const raw = text(value).toUpperCase();
  if (raw.includes('P2')) return 'P2';
  if (raw.includes('P0') || raw.includes('紧急')) return 'P0';
  if (raw.includes('P1') || raw.includes('正常')) return 'P1';
  if (notes.toUpperCase().includes('P2') || notes.includes('储备') || status.includes('储备')) return 'P2';
  return 'P1';
}

export function normalizeFeishuPositionRecord(record: FeishuBoardSourceRecord): FeishuPositionMetric | null {
  const fields = record.fields || {};
  const positionName = text(rawField(fields, FIELD_NAMES.position_name));
  if (!positionName) return null;

  const city = text(rawField(fields, FIELD_NAMES.city));
  const status = text(rawField(fields, FIELD_NAMES.status));
  const notes = text(rawField(fields, FIELD_NAMES.notes));
  const department = normalizeDepartment(text(rawField(fields, FIELD_NAMES.department)));
  const positionType = text(rawField(fields, FIELD_NAMES.position_type)) || positionName;
  const thirdPass = nullableNumber(rawField(fields, FIELD_NAMES.third_pass));

  return {
    feishu_record_id: record.record_id,
    department,
    position_name: positionName,
    position_type: positionType,
    display_name: city ? `${positionName}-${city}` : positionName,
    city,
    hrbps: names(rawField(fields, FIELD_NAMES.hrbps)).length > 0 ? names(rawField(fields, FIELD_NAMES.hrbps)) : ['未分配'],
    priority: inferPriority(rawField(fields, FIELD_NAMES.priority), notes, status),
    status,
    headcount: number(rawField(fields, FIELD_NAMES.headcount)),
    resume_push: number(rawField(fields, FIELD_NAMES.resume_push)),
    first_scheduled: number(rawField(fields, FIELD_NAMES.first_scheduled)),
    first_pass: number(rawField(fields, FIELD_NAMES.first_pass)),
    second_pass: number(rawField(fields, FIELD_NAMES.second_pass)),
    third_pass: thirdPass,
    offers: number(rawField(fields, FIELD_NAMES.offers)),
    hired: number(rawField(fields, FIELD_NAMES.hired)),
    elapsed_days: number(rawField(fields, FIELD_NAMES.elapsed_days)),
    weekly_target: number(rawField(fields, FIELD_NAMES.weekly_target)),
    notes,
  };
}

export function isP2Position(position: Pick<FeishuPositionMetric, 'priority'>): boolean {
  return position.priority === 'P2';
}

export function isStatisticalPosition(position: Pick<FeishuPositionMetric, 'headcount' | 'status' | 'priority'>): boolean {
  return position.headcount > 0 && position.status !== '已取消' && !isP2Position(position);
}

export function isCycleEligiblePosition(position: Pick<FeishuPositionMetric, 'headcount' | 'status' | 'priority' | 'elapsed_days'>): boolean {
  return position.headcount > 0
    && !isP2Position(position)
    && /(完成|取消)/.test(position.status)
    && position.elapsed_days > 0;
}

export function finalPass(position: Pick<FeishuPositionMetric, 'third_pass' | 'second_pass'>): number {
  return position.third_pass === null ? position.second_pass : position.third_pass;
}
