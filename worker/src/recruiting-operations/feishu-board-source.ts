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
  /** Extra fields exposed by the Miaoda dashboard source. */
  position_code?: string;
  publish_name?: string;
  job_description?: string;
  resume_grade_standard?: string;
  first_interviewers?: string[];
  final_interviewers?: string[];
  expected_delivery_date?: string;
  remaining_headcount?: number;
  interview_pass_rate?: number | null;
  start_date?: string;
  end_date?: string;
  period_start?: string;
  period_end?: string;
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
  position_code: ['岗位编号'],
  publish_name: ['发布名称'],
  job_description: ['岗位JD', '岗位 JD'],
  resume_grade_standard: ['简历分级标准'],
  first_interviewers: ['一面官', '第一面官'],
  final_interviewers: ['终面官'],
  expected_delivery_date: ['期望交付日'],
  remaining_headcount: ['待招人数'],
  interview_pass_rate: ['面试通过率'],
  start_date: ['开始周期'],
  end_date: ['结束周期'],
  period_start: ['统计周期-开始', '统计周期开始'],
  period_end: ['统计周期-截止', '统计周期截止'],
} as const;

/**
 * The two Feishu tables look similar, but their canonical field names are
 * different. Keep the source-specific names first so a partial match cannot
 * accidentally select a similarly named column from a different schema.
 */
const SOURCE_FIELD_NAMES: Record<FeishuBoardSourceRecord['table'], Partial<Record<keyof typeof FIELD_NAMES, readonly string[]>>> = {
  zhipei: {
    department: ['所属部门'],
    hrbps: ['负责HRBP'],
    first_scheduled: ['安排1面'],
    first_pass: ['1面通过'],
    second_pass: ['2面通过'],
    third_pass: ['3面通过'],
    offers: ['发放Offer数'],
    weekly_target: ['本周需完结数'],
  },
  yanglao: {
    department: ['所属事业部'],
    hrbps: ['负责HRBP'],
    first_scheduled: ['安排 1 面', '1面人数'],
    first_pass: ['1 面通过'],
    second_pass: ['2 面通过'],
    third_pass: ['3 面通过'],
    offers: ['发放 Offer数'],
    // The pension table has no weekly-target field.
    weekly_target: [],
  },
};

function fieldCandidates(table: FeishuBoardSourceRecord['table'], key: keyof typeof FIELD_NAMES): readonly string[] {
  const sourceNames = SOURCE_FIELD_NAMES[table][key] ?? [];
  const genericNames = FIELD_NAMES[key] ?? [];
  const seen = new Set<string>();
  return [...sourceNames, ...genericNames].filter((candidate) => {
    const key = normalized(candidate);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

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
    if ('id' in object) return text(object.id);
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
  if (Array.isArray(value)) return value.length === 0 ? null : nullableNumber(value[0]);
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    if ('value' in object) return nullableNumber(object.value);
    if ('text' in object) return nullableNumber(object.text);
    // An empty/unknown formula object is Feishu's null representation.
    return null;
  }
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

const HRBP_ID_NAME_MAP: Record<string, string> = {
  '1803521547169955': '魏秋柠',
  '1803521547170963': '杜雁玲',
  '1803521547163891': '何雨菱',
};

// Same position-city fallback used by the Miaoda dashboard when Feishu's
// user selector only returns an ID (or is empty for historical rows).
const HRBP_FALLBACK_MAP: Record<string, string> = {
  '护士@衡阳': '何雨菱',
  '护理部主任@衡阳': '何雨菱',
  '护理部主任@长沙': '何雨菱',
  '综合事务岗@衡阳': '何雨菱',
  '护士@岳阳': '杜雁玲',
  '护理部主任@岳阳': '杜雁玲',
  '站长@岳阳': '杜雁玲',
  '项目管理-AI硬件@北京': '杜雁玲',
  '商家运营专员@杭州': '杜雁玲',
  '站长@衡阳': '魏秋柠',
  '综合事务岗@岳阳': '魏秋柠',
  'IoT产品经理-AI硬件@北京': '魏秋柠',
  '储备招生主管@宁波': '于媛',
  '城市校长@上海': '于媛',
  '就业主管@郑州': '于媛',
  '招生主管@长沙': '于媛',
  '招生销售@合肥': '于媛',
  '招生销售@成都': '于媛',
  '招生销售@武汉': '于媛',
  '招生销售@苏州': '于媛',
  '招生销售@郑州': '于媛',
  '招生销售@长沙': '于媛',
  '销售实习生@成都': '于媛',
  '储备招生主管@广州': '徐蓉',
  '城市校长@深圳': '徐蓉',
  '就业主管@南京': '徐蓉',
  '招生主管@杭州': '徐蓉',
  '储备招生主管@深圳': '徐蓉',
  '招生销售@南宁': '徐蓉',
  '招生销售@厦门': '徐蓉',
  '招生销售@广州': '徐蓉',
  '招生销售@昆明': '徐蓉',
  '招生销售@杭州': '徐蓉',
  '招生销售@福州': '徐蓉',
  '招生销售@重庆': '徐蓉',
  '加盟商运营@沈阳': '王凯月',
  '城市校长@北京': '王凯月',
  '招生主管@北京': '王凯月',
  '招生主管@天津': '王凯月',
  '招生销售@北京': '王凯月',
  '招生销售@哈尔滨': '王凯月',
  '招生销售@天津': '王凯月',
  '招生销售@济南': '王凯月',
  '招生销售@西安': '王凯月',
};

function resolveHrbps(value: unknown, positionName: string, city: string): string[] {
  const rawNames = names(value);
  const resolved = rawNames
    .map((name) => HRBP_ID_NAME_MAP[name] ?? name)
    .filter(Boolean);
  const fallback = HRBP_FALLBACK_MAP[`${positionName}@${city}`];
  const unresolved = resolved.length === 0 || resolved.every((name) => /^(?:ou[_-]|user[_-]|\d{8,})/i.test(name) || name === '未分配');
  if (fallback && unresolved) return [fallback];
  return resolved.length > 0 ? resolved : ['未分配'];
}

function dateText(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  if (Array.isArray(value)) return value.length > 0 ? dateText(value[0]) : '';
  if (typeof value === 'number' && Number.isFinite(value)) {
    const millis = value > 10_000_000_000 ? value : value * 1000;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? String(value) : date.toISOString().slice(0, 10);
  }
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    if ('value' in object) return dateText(object.value);
    if ('text' in object) return dateText(object.text);
    if ('start' in object) return dateText(object.start);
  }
  const raw = text(value);
  const match = raw.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  return match ? `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}` : raw;
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
  const field = (key: keyof typeof FIELD_NAMES) => rawField(fields, fieldCandidates(record.table, key));
  const positionName = text(field('position_name'));
  if (!positionName) return null;

  const city = text(field('city'));
  const status = text(field('status'));
  const notes = text(field('notes'));
  const department = normalizeDepartment(text(field('department')));
  const positionType = text(field('position_type')) || positionName;
  const thirdPass = nullableNumber(field('third_pass'));
  const resumePush = number(field('resume_push'));
  const arrangedFirst = number(field('first_scheduled'));
  const firstScheduled = record.table === 'yanglao' && arrangedFirst === 0 && resumePush > 0
    ? resumePush
    : arrangedFirst;
  const firstInterviewers = names(field('first_interviewers'));
  const finalInterviewers = names(field('final_interviewers'));
  const optionalNames = (value: string[]) => value.length > 0 ? value : undefined;
  const optionalText = (value: unknown) => {
    const result = text(value);
    return result || undefined;
  };

  return {
    feishu_record_id: record.record_id,
    department,
    position_name: positionName,
    position_type: positionType,
    display_name: city ? `${positionName}-${city}` : positionName,
    city,
    hrbps: resolveHrbps(field('hrbps'), positionName, city),
    priority: inferPriority(field('priority'), notes, status),
    status,
    headcount: number(field('headcount')),
    resume_push: resumePush,
    first_scheduled: firstScheduled,
    first_pass: number(field('first_pass')),
    second_pass: number(field('second_pass')),
    third_pass: thirdPass,
    offers: number(field('offers')),
    hired: number(field('hired')),
    elapsed_days: number(field('elapsed_days')),
    weekly_target: number(field('weekly_target')),
    notes,
    position_code: optionalText(field('position_code')),
    publish_name: optionalText(field('publish_name')),
    job_description: optionalText(field('job_description')),
    resume_grade_standard: optionalText(field('resume_grade_standard')),
    first_interviewers: optionalNames(firstInterviewers),
    final_interviewers: optionalNames(finalInterviewers),
    expected_delivery_date: optionalText(dateText(field('expected_delivery_date'))),
    remaining_headcount: field('remaining_headcount') === undefined ? undefined : number(field('remaining_headcount')),
    interview_pass_rate: field('interview_pass_rate') === undefined ? undefined : nullableNumber(field('interview_pass_rate')),
    start_date: optionalText(dateText(field('start_date'))),
    end_date: optionalText(dateText(field('end_date'))),
    period_start: optionalText(dateText(field('period_start'))),
    period_end: optionalText(dateText(field('period_end'))),
  };
}

export function isP2Position(position: Pick<FeishuPositionMetric, 'priority'>): boolean {
  return position.priority === 'P2';
}

export function isStatisticalPosition(position: Pick<FeishuPositionMetric, 'headcount' | 'status' | 'priority'>): boolean {
  return position.headcount > 0 && !/(取消)/.test(position.status) && !isP2Position(position);
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
