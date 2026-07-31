export type ShareExpiryOption = '1d' | '7d' | '30d' | 'permanent';

export interface DashboardShareLink {
  id: string;
  token_hash: string;
  scope_type: 'all' | 'divisions';
  scope_ids: string;
  expires_at: string | null;
  revoked_at: string | null;
  created_by: string;
  created_at: string;
}

export interface ShareLinkActivity {
  expires_at: string | null;
  revoked_at: string | null;
}

export interface PublicBoardRow {
  division?: unknown;
  department?: unknown;
  hrbp?: unknown;
  position?: unknown;
  urgency?: unknown;
  headcount?: unknown;
  total_resumes?: unknown;
  first_interview?: unknown;
  first_interview_passed?: unknown;
  second_interview_passed?: unknown;
  third_interview_passed?: unknown;
  pass_rate?: unknown;
  offer_count?: unknown;
  onboarded_count?: unknown;
  remark?: unknown;
  status?: unknown;
}
