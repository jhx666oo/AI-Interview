import type { DashboardDataMode } from './share-links';

export interface RecruitingBoardPositionRow {
  position_id: string;
  division: string;
  hrbp: string;
  position: string;
  priority: 'P0' | 'P1' | 'P2';
  headcount: number;
  total_resumes: number;
  ai_screened: number;
  first_interview: number;
  first_pass: number;
  second_pass: number;
  third_pass: number;
  offers: number;
  hired: number;
  notes: string;
  status: string;
  unmatched?: boolean;
}

export interface Metric {
  value: number | null;
  available: boolean;
}

export interface BoardTotals {
  active_positions: number;
  total_headcount: number;
  total_resumes: number;
  ai_screened: number;
  first_interview: number;
  first_pass: number;
  second_pass: number;
  third_pass: number;
  offers: number;
  hired: number;
  interview_pass_rate: number | null;
}

export interface DivisionBoard extends BoardTotals {
  division: string;
  hrbps: string[];
  positions: RecruitingBoardPositionRow[];
}

export interface HrbpBoard extends BoardTotals {
  hrbp: string;
  divisions: string[];
  positions: RecruitingBoardPositionRow[];
  p0_positions: number;
  average_hiring_days: null;
}

export interface RecruitingBoard {
  version: 'v2';
  data_mode: DashboardDataMode;
  snapshot_date: string | null;
  updated_at: string;
  kpis: Record<string, Metric>;
  funnel: { stages: FunnelStage[] };
  insights: { summary: string; bottlenecks: string[]; recommendations: string[] };
  divisions: DivisionBoard[];
  hrbps: HrbpBoard[];
  totals: BoardTotals;
}

export interface FunnelStage {
  key: 'resumes' | 'ai_screened' | 'first_interview' | 'first_pass' | 'second_pass' | 'third_pass' | 'offers' | 'hired';
  label: string;
  count: number;
}

export type RecruitingBoardDivisionRow = Omit<RecruitingBoardPositionRow, 'position' | 'position_id' | 'notes' | 'unmatched'> & {
  positions: Array<Partial<RecruitingBoardPositionRow>>;
  pass_rate: number | null;
};

type LegacyBoardRow = Pick<RecruitingBoardPositionRow,
  'division' | 'position' | 'total_resumes' | 'first_interview' | 'first_pass' | 'second_pass' | 'third_pass' | 'offers' | 'hired'
> & Partial<RecruitingBoardPositionRow>;

const boardMetricKeys = [
  'total_resumes', 'ai_screened', 'first_interview', 'first_pass', 'second_pass', 'third_pass', 'offers', 'hired',
] as const;

const funnelStages: Array<Pick<FunnelStage, 'key' | 'label'>> = [
  { key: 'resumes', label: '已入库简历' },
  { key: 'ai_screened', label: 'AI 初筛完成' },
  { key: 'first_interview', label: '安排面试' },
  { key: 'first_pass', label: '一面通过' },
  { key: 'second_pass', label: '二面通过' },
  { key: 'third_pass', label: '三面通过' },
  { key: 'offers', label: 'Offer' },
  { key: 'hired', label: '入职' },
];

const emptyTotals = (): Omit<BoardTotals, 'interview_pass_rate'> => ({
  active_positions: 0,
  total_headcount: 0,
  total_resumes: 0,
  ai_screened: 0,
  first_interview: 0,
  first_pass: 0,
  second_pass: 0,
  third_pass: 0,
  offers: 0,
  hired: 0,
});

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function interviewPassRate(totals: Pick<BoardTotals, 'first_interview' | 'third_pass'>): number | null {
  if (totals.first_interview <= 0 || totals.third_pass <= 0) return null;
  return Math.round(totals.third_pass / totals.first_interview * 1000) / 10;
}

function sumRows(rows: Array<Partial<RecruitingBoardPositionRow>>): Omit<BoardTotals, 'interview_pass_rate'> {
  return rows.reduce((totals, row) => {
    totals.active_positions += row.status === '招聘中' ? 1 : 0;
    totals.total_headcount += numberOrZero(row.headcount);
    for (const key of boardMetricKeys) totals[key] += numberOrZero(row[key]);
    return totals;
  }, emptyTotals());
}

function withPassRate(totals: Omit<BoardTotals, 'interview_pass_rate'>): BoardTotals {
  return { ...totals, interview_pass_rate: interviewPassRate(totals) };
}

function sortedPositions(rows: RecruitingBoardPositionRow[]): RecruitingBoardPositionRow[] {
  return [...rows].sort((left, right) =>
    left.position.localeCompare(right.position, 'zh-Hans-CN') || left.position_id.localeCompare(right.position_id),
  );
}

function groupDivisionCards(rows: RecruitingBoardPositionRow[]): DivisionBoard[] {
  const groups = new Map<string, RecruitingBoardPositionRow[]>();
  for (const row of rows) {
    const division = row.division || '未分配事业部';
    groups.set(division, [...(groups.get(division) || []), { ...row, division }]);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right, 'zh-Hans-CN'))
    .map(([division, positions]) => {
      const totals = withPassRate(sumRows(positions));
      return {
        division,
        hrbps: [...new Set(positions.map((position) => position.hrbp).filter(Boolean))]
          .sort((left, right) => left.localeCompare(right, 'zh-Hans-CN')),
        positions: sortedPositions(positions),
        ...totals,
      };
    });
}

function groupHrbpCards(rows: RecruitingBoardPositionRow[]): HrbpBoard[] {
  const groups = new Map<string, RecruitingBoardPositionRow[]>();
  for (const row of rows) {
    const hrbp = row.hrbp || '未分配HRBP';
    groups.set(hrbp, [...(groups.get(hrbp) || []), { ...row, hrbp }]);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right, 'zh-Hans-CN'))
    .map(([hrbp, positions]) => ({
      hrbp,
      divisions: [...new Set(positions.map((position) => position.division || '未分配事业部'))]
        .sort((left, right) => left.localeCompare(right, 'zh-Hans-CN')),
      positions: sortedPositions(positions),
      p0_positions: positions.filter((position) => position.priority === 'P0').length,
      average_hiring_days: null,
      ...withPassRate(sumRows(positions)),
    }));
}

function makeKpis(totals: BoardTotals): Record<string, Metric> {
  return {
    active_positions: { value: totals.active_positions, available: true },
    total_headcount: { value: totals.total_headcount, available: true },
    total_resumes: { value: totals.total_resumes, available: true },
    first_interview: { value: totals.first_interview, available: true },
    interview_pass_rate: { value: totals.interview_pass_rate, available: totals.interview_pass_rate !== null },
    offers: { value: totals.offers, available: true },
    hired: { value: totals.hired, available: true },
    weekly_requirement_completion: { value: null, available: false },
  };
}

function makeFunnel(totals: BoardTotals): FunnelStage[] {
  return funnelStages.map((stage) => ({
    ...stage,
    count: totals[stage.key === 'resumes' ? 'total_resumes' : stage.key],
  }));
}

export function buildDeterministicInsights(totals: BoardTotals): RecruitingBoard['insights'] {
  const stages = makeFunnel(totals);
  const conversions = stages.slice(0, -1)
    .map((stage, index) => ({
      from: stage,
      to: stages[index + 1],
      rate: stage.count > 0 ? Math.round(stages[index + 1].count / stage.count * 1000) / 10 : null,
    }))
    .filter((conversion): conversion is { from: FunnelStage; to: FunnelStage; rate: number } => conversion.rate !== null);

  if (conversions.length === 0) {
    return {
      summary: '暂无足够漏斗数据，暂不生成招聘诊断。',
      bottlenecks: ['暂无足够漏斗数据'],
      recommendations: ['暂无足够漏斗数据'],
    };
  }

  const bottleneck = conversions.reduce((lowest, current) => current.rate < lowest.rate ? current : lowest);
  const transition = `${bottleneck.from.label}至${bottleneck.to.label}`;
  return {
    summary: `当前有 ${totals.active_positions} 个在招岗位，累计 ${totals.total_resumes} 份简历。`,
    bottlenecks: [`${transition}转化率最低，为 ${bottleneck.rate}%。`],
    recommendations: [`建议优先复盘${transition}环节并补充有效候选人来源。`],
  };
}

/** A division summary is derived only from its position rows. */
export function groupBoardRows(rows: LegacyBoardRow[]): RecruitingBoardDivisionRow[] {
  const groups = new Map<string, RecruitingBoardDivisionRow>();
  for (const row of rows) {
    const division = row.division || '未分配事业部';
    let group = groups.get(division);
    if (!group) {
      group = {
        division,
        hrbp: row.hrbp || '',
        priority: row.priority || 'P2',
        headcount: 0,
        total_resumes: 0,
        ai_screened: 0,
        first_interview: 0,
        first_pass: 0,
        second_pass: 0,
        third_pass: 0,
        offers: 0,
        hired: 0,
        status: row.status || '招聘中',
        positions: [],
        pass_rate: null,
      };
      groups.set(division, group);
    }
    group.positions.push(row);
    group.headcount += numberOrZero(row.headcount);
    for (const key of boardMetricKeys) group[key] = numberOrZero(group[key]) + numberOrZero(row[key]);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    pass_rate: group.first_interview > 0 ? Math.round(group.first_pass / group.first_interview * 100) : null,
  }));
}

/** The live model stores round two on result2/status2 of the first interview row. */
export function getBoardInterviewPassCondition(round: 1 | 2 | 3): string {
  const passed = "IN ('pass', 'passed')";
  if (round === 1) return `(round = 1 AND (result ${passed} OR status2 = 'passed'))`;
  if (round === 2) return `((round = 1 AND (result2 ${passed} OR status2 = 'passed')) OR (round = 2 AND result ${passed}))`;
  return `(round = 3 AND result ${passed})`;
}

/** A passed first interview is already represented by its scheduled interview row. */
export function getBoardFirstInterviewCount(scheduled: number, _passed: number): number {
  return scheduled;
}

export function buildRecruitingBoard(
  rows: RecruitingBoardPositionRow[],
  input: { dataMode: DashboardDataMode; updatedAt: string; snapshotDate?: string | null },
): RecruitingBoard {
  const totals = withPassRate(sumRows(rows));
  return {
    version: 'v2',
    data_mode: input.dataMode,
    snapshot_date: input.snapshotDate || null,
    updated_at: input.updatedAt,
    kpis: makeKpis(totals),
    funnel: { stages: makeFunnel(totals) },
    insights: buildDeterministicInsights(totals),
    divisions: groupDivisionCards(rows),
    hrbps: groupHrbpCards(rows),
    totals,
  };
}

export function toPublicRecruitingBoard(
  board: RecruitingBoard,
  scope: { divisions: string[] },
): RecruitingBoard {
  const positions = board.divisions.flatMap((division) => division.positions)
    .filter((position) => scope.divisions.length === 0 || scope.divisions.includes(position.division));
  return buildRecruitingBoard(positions, {
    dataMode: board.data_mode,
    updatedAt: board.updated_at,
    snapshotDate: board.snapshot_date,
  });
}
