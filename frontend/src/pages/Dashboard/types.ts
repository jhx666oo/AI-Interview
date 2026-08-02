export type DashboardDataMode = 'live' | 'snapshot';

export interface DashboardSnapshotMeta {
  id: string;
  snapshot_date: string;
  generated_at: string;
}

export interface DashboardShareLink {
  id: string;
  scope_type: 'all' | 'divisions';
  scope_ids: string[];
  expires_at: string | null;
  revoked_at: string | null;
  data_mode: DashboardDataMode;
  snapshot_id: string | null;
  created_by: string;
  created_at: string;
}

export interface DashboardMetric {
  value: number | null;
  available: boolean;
}

export interface BoardPosition {
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
  positions: BoardPosition[];
  [key: string]: unknown;
}

export interface HrbpBoard extends BoardTotals {
  hrbp: string;
  divisions: string[];
  positions: BoardPosition[];
  p0_positions: number;
  average_hiring_days: number | null;
  [key: string]: unknown;
}

export interface FunnelStage {
  key: string;
  label: string;
  count: number;
}

export interface RecruitingBoard {
  version: 'v2';
  data_mode: DashboardDataMode;
  snapshot_date: string | null;
  updated_at: string;
  kpis: Record<string, DashboardMetric>;
  funnel: { stages: FunnelStage[] };
  insights: {
    summary: string;
    bottlenecks: string[];
    recommendations: string[];
  };
  divisions: DivisionBoard[];
  hrbps: HrbpBoard[];
  totals: BoardTotals;
}
