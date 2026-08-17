export type DashboardV3Priority = 'P0' | 'P1' | 'P2';
export type DashboardV3DataSource = 'static_excel' | 'feishu' | 'merged';

export interface DashboardV3Position {
  position_id: string;
  department: string;
  position_name: string;
  display_name: string;
  city: string;
  hrbps: string[];
  priority: DashboardV3Priority;
  status: string;
  headcount: number;
  resume_push: number;
  first_scheduled: number;
  first_pass: number;
  second_pass: number;
  final_pass: number;
  offers: number;
  hired: number;
  elapsed_days: number;
  weekly_target: number;
  notes: string;
  data_sources: string[];
  unmatched?: boolean;
}

export interface DashboardV3Totals {
  active_positions: number;
  headcount: number;
  resume_push: number;
  first_scheduled: number;
  first_pass: number;
  second_pass: number;
  final_pass: number;
  offers: number;
  hired: number;
  interview_pass_rate: number | null;
  offer_conversion_rate: number | null;
  hire_conversion_rate: number | null;
  average_completed_cycle_days: number | null;
  in_progress_position_count: number;
  in_progress_average_elapsed_days: number | null;
}

export interface DashboardV3FunnelStage {
  key: string;
  label: string;
  count: number;
  conversion_rate: number | null;
}

export interface DashboardV3Division {
  department: string;
  hrbps: string[];
  totals: DashboardV3Totals;
  positions: DashboardV3Position[];
  funnel: DashboardV3FunnelStage[];
  p0_position_count: number;
  p1_position_count: number;
  completed_position_count: number;
  in_progress_position_count: number;
  in_progress_average_elapsed_days: number | null;
}

export interface DashboardV3Hrbp {
  name: string;
  department: string;
  position_count: number;
  headcount: number;
  p0_position_count: number;
  p0_headcount: number;
  average_completed_cycle_days: number | null;
  in_progress_position_count: number;
  in_progress_average_elapsed_days: number | null;
  resume_push: number;
  first_scheduled: number;
  first_pass: number;
  second_pass: number;
  final_pass: number;
  offers: number;
  hired: number;
  conversion_rates: {
    first_over_resume: number | null;
    final_over_first: number | null;
    offer_over_final: number | null;
    hired_over_offer: number | null;
  };
}

export interface DashboardV3Board {
  schema_version: 'dashboard-v3';
  data_mode: 'live' | 'snapshot';
  snapshot_date: string | null;
  updated_at: string;
  data_source?: DashboardV3DataSource;
  kpis: Record<string, { value: number | null; available: boolean; caption?: string }>;
  funnel: DashboardV3FunnelStage[];
  divisions: DashboardV3Division[];
  hrbps: DashboardV3Hrbp[];
  p2_positions: DashboardV3Position[];
  positions: DashboardV3Position[];
  totals: DashboardV3Totals;
  insights: { summary: string; bottlenecks: string[]; recommendations: string[] };
  weekly_dynamic: {
    resume_push: number;
    first_scheduled: number;
    first_pass?: number;
    second_pass?: number;
    final_pass?: number;
    offers: number;
    hired: number;
    baseline_date: string | null;
  };
}

export function isDashboardV3Board(value: unknown): value is DashboardV3Board {
  return Boolean(value && typeof value === 'object' && (value as { schema_version?: string }).schema_version === 'dashboard-v3');
}

export function filterDashboardV3Board(board: DashboardV3Board, predicate: (position: DashboardV3Position) => boolean): DashboardV3Board {
  const positions = board.positions.filter(predicate);
  const p2Positions = board.p2_positions.filter(predicate);
  const totals = positions.reduce((result, position) => {
    result.active_positions += 1; result.headcount += position.headcount; result.resume_push += position.resume_push;
    result.first_scheduled += position.first_scheduled; result.first_pass += position.first_pass; result.second_pass += position.second_pass;
    result.final_pass += position.final_pass; result.offers += position.offers; result.hired += position.hired;
    result.in_progress_position_count += /(完成|取消)/.test(position.status) ? 0 : 1;
    return result;
  }, { ...board.totals, active_positions: 0, headcount: 0, resume_push: 0, first_scheduled: 0, first_pass: 0, second_pass: 0, final_pass: 0, offers: 0, hired: 0, in_progress_position_count: 0 });
  totals.interview_pass_rate = totals.first_scheduled > 0 ? Math.round(totals.final_pass / totals.first_scheduled * 1000) / 10 : null;
  totals.offer_conversion_rate = totals.final_pass > 0 ? Math.round(totals.offers / totals.final_pass * 1000) / 10 : null;
  totals.hire_conversion_rate = totals.offers > 0 ? Math.round(totals.hired / totals.offers * 1000) / 10 : null;
  const funnelKeys = board.funnel.map((stage) => stage.key);
  const funnel = board.funnel.map((stage, index) => {
    const count = Number(totals[stage.key as keyof DashboardV3Totals]) || 0;
    const previous = index > 0 ? Number(totals[funnelKeys[index - 1] as keyof DashboardV3Totals]) || 0 : 0;
    return { ...stage, count, conversion_rate: index === 0 || previous === 0 ? null : Math.round(count / previous * 1000) / 10 };
  });
  return {
    ...board,
    positions,
    p2_positions: p2Positions,
    totals,
    funnel,
    divisions: board.divisions.map((division) => ({ ...division, positions: division.positions.filter(predicate) })).filter((division) => division.positions.length > 0),
    hrbps: board.hrbps.filter((hrbp) => positions.some((position) => position.hrbps.includes(hrbp.name))),
  };
}
