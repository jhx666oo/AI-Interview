import { describe, expect, it } from 'vitest';
import {
  createShareExpiry,
  hashShareToken,
  isShareLinkActive,
  toPublicBoardRow,
} from '../src/recruiting-operations/share-links';

describe('dashboard share links', () => {
  const now = new Date('2026-07-31T00:00:00.000Z');

  it('accepts a live link and rejects expired or revoked links', () => {
    expect(isShareLinkActive({ expires_at: '2026-08-01T00:00:00.000Z', revoked_at: null }, now)).toBe(true);
    expect(isShareLinkActive({ expires_at: '2026-07-30T00:00:00.000Z', revoked_at: null }, now)).toBe(false);
    expect(isShareLinkActive({ expires_at: null, revoked_at: now.toISOString() }, now)).toBe(false);
  });

  it('creates the requested share expiry', () => {
    expect(createShareExpiry('1d', now)?.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(createShareExpiry('7d', now)?.toISOString()).toBe('2026-08-07T00:00:00.000Z');
    expect(createShareExpiry('30d', now)?.toISOString()).toBe('2026-08-30T00:00:00.000Z');
    expect(createShareExpiry('permanent', now)).toBeNull();
  });

  it('hashes a token before it can be persisted', async () => {
    expect(await hashShareToken('test-token')).toBe('4c5dc9b7708905f77f5e5d16316b5dfb425e68cb326dcd55a860e90a7707031e');
  });

  it('removes candidate fields from a public board row', () => {
    const row = toPublicBoardRow({
      position: '运营',
      total_resumes: 10,
      candidate_name: 'X',
      email: 'candidate@example.com',
      contact: '13800000000',
      raw_text: 'private resume text',
      ai_evaluation: { hidden: true },
    });

    expect(row).toEqual({ position: '运营', total_resumes: 10 });
    expect(row).not.toHaveProperty('candidate_name');
  });
});
