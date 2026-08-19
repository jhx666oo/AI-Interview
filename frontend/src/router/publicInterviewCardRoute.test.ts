import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8');

describe('public interview card route registration', () => {
  it('registers an anonymous interview card page outside the auth shell', () => {
    expect(source).toContain("const InterviewCard = lazy(() => import('../pages/Public/InterviewCard'))");
    expect(source).toContain("path: '/interview-card/:token'");
  });
});
