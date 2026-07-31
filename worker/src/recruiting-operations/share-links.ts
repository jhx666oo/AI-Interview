import type { PublicBoardRow, ShareExpiryOption, ShareLinkActivity } from './types';

const PUBLIC_BOARD_FIELDS = [
  'division',
  'department',
  'hrbp',
  'position',
  'urgency',
  'headcount',
  'total_resumes',
  'first_interview',
  'first_interview_passed',
  'second_interview_passed',
  'third_interview_passed',
  'pass_rate',
  'offer_count',
  'onboarded_count',
  'remark',
  'status',
] as const satisfies ReadonlyArray<keyof PublicBoardRow>;

const EXPIRY_DAYS: Record<Exclude<ShareExpiryOption, 'permanent'>, number> = {
  '1d': 1,
  '7d': 7,
  '30d': 30,
};

export async function hashShareToken(token: string): Promise<string> {
  const encoded = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function isShareLinkActive(link: ShareLinkActivity, now = new Date()): boolean {
  if (link.revoked_at) return false;
  return !link.expires_at || new Date(link.expires_at).getTime() > now.getTime();
}

export function createShareExpiry(option: ShareExpiryOption, now = new Date()): Date | null {
  if (option === 'permanent') return null;
  const expiry = new Date(now);
  expiry.setUTCDate(expiry.getUTCDate() + EXPIRY_DAYS[option]);
  return expiry;
}

export function toPublicBoardRow(row: Record<string, unknown>): PublicBoardRow {
  return Object.fromEntries(
    PUBLIC_BOARD_FIELDS
      .filter((field) => field in row)
      .map((field) => [field, row[field]]),
  ) as PublicBoardRow;
}
