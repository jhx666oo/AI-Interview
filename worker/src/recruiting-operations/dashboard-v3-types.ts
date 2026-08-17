import type { DashboardDataMode } from './share-links';

export type DashboardPriority = 'P0' | 'P1' | 'P2';
export type DashboardDataSource = 'static_excel' | 'feishu' | 'merged';

export type DashboardFunnelMetric =
  | 'resume_push'
  | 'first_scheduled'
  | 'first_pass'
  | 'second_pass'
  | 'final_pass'
  | 'offers'
  | 'hired';

export interface DashboardFunnelStage {
  key: DashboardFunnelMetric;
  label: string;
  count: number;
  conversion_rate: number | null;
}

export const DASHBOARD_V3_FUNNEL_STAGES: ReadonlyArray<Pick<DashboardFunnelStage, 'key' | 'label'>> = [
  { key: 'resume_push', label: '简历推送' },
  { key: 'first_scheduled', label: '安排1面' },
  { key: 'first_pass', label: '1面通过' },
  { key: 'second_pass', label: '2面通过' },
  { key: 'final_pass', label: '终面通过' },
  { key: 'offers', label: '发放Offer' },
  { key: 'hired', label: '已入职' },
];

export const DASHBOARD_DIVISION_FUNNEL_STAGES: ReadonlyArray<Pick<DashboardFunnelStage, 'key' | 'label'>> = [
  { key: 'resume_push', label: '简历推送' },
  { key: 'first_scheduled', label: '安排1面' },
  { key: 'first_pass', label: '1面通过' },
  { key: 'second_pass', label: '2面通过' },
  { key: 'offers', label: '发放Offer' },
  { key: 'hired', label: '已入职' },
];

export interface DashboardV3Position {
  position_id: string;
  department: string;
  position_name: string;
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
  third_pass: number;
  final_pass: number;
  offers: number;
  hired: number;
  elapsed_days: number;
  weekly_target: number;
  notes: string;
  data_sources: Array<'feishu' | 'd1' | 'merged'>;
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

export interface DashboardV3Division {
  department: string;
  hrbps: string[];
  totals: DashboardV3Totals;
  positions: DashboardV3Position[];
  funnel: DashboardFunnelStage[];
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
  data_mode: DashboardDataMode;
  snapshot_date: string | null;
  updated_at: string;
  data_source?: DashboardDataSource;
  kpis: Record<string, { value: number | null; available: boolean; caption?: string }>;
  funnel: DashboardFunnelStage[];
  divisions: DashboardV3Division[];
  hrbps: DashboardV3Hrbp[];
  p2_positions: DashboardV3Position[];
  positions: DashboardV3Position[];
  totals: DashboardV3Totals;
  insights: { summary: string; bottlenecks: string[]; recommendations: string[] };
  weekly_dynamic: {
    resume_push: number;
    first_scheduled: number;
    offers: number;
    hired: number;
    baseline_date: string | null;
  };
}

export function isStatisticalPriority(priority: DashboardPriority): boolean {
  return priority === 'P0' || priority === 'P1';
}

export function finalPassCount(input: { third_pass: number | null | undefined; second_pass: number }): number {
  return input.third_pass === null || input.third_pass === undefined ? input.second_pass : input.third_pass;
}

export function rateOrNull(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

export function buildFunnelStages(
  totals: Pick<DashboardV3Totals, DashboardFunnelMetric>,
  definitions: ReadonlyArray<Pick<DashboardFunnelStage, 'key' | 'label'>> = DASHBOARD_V3_FUNNEL_STAGES,
): DashboardFunnelStage[] {
  return definitions.map((definition, index) => ({
    ...definition,
    count: totals[definition.key],
    conversion_rate: index === 0 ? null : rateOrNull(totals[definition.key], totals[definitions[index - 1].key]),
  }));
}
