import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8');

describe('public interview invite route registration', () => {
  it('registers an anonymous candidate interview invite page outside the auth shell', () => {
    expect(source).toContain("const InterviewInvite = lazy(() => import('../pages/Public/InterviewInvite'))");
    expect(source).toContain("path: '/interview-invite/:token'");
  });
});
