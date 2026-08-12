import { describe, expect, it } from 'vitest';
import { createPublicToken, hashPublicToken } from '../src/business-screening/token';

describe('business screening token helpers', () => {
  it('creates a random opaque token and stores only its SHA-256 hash', async () => {
    const first = await createPublicToken();
    const second = await createPublicToken();

    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(await hashPublicToken(first.token)).toBe(first.tokenHash);
    expect(second.token).not.toBe(first.token);
    expect(second.tokenHash).not.toBe(first.tokenHash);
  });

  it('hashes the same token deterministically', async () => {
    expect(await hashPublicToken('screening-token')).toBe('a44bc5c1d7196a1124146bb367d053233967e2fcc8f6f35d49d5a73d37cee6e6');
  });

  it('does not treat a raw token as its stored hash', async () => {
    const rawToken = 'screening-token';
    expect(await hashPublicToken(rawToken)).not.toBe(rawToken);
  });
});
