import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8');

describe('public business screening route registration', () => {
  it('registers an anonymous business screening page outside the auth shell', () => {
    expect(source).toContain("const BusinessScreening = lazy(() => import('../pages/Public/BusinessScreening'))");
    expect(source).toContain("path: '/business-screening/:token'");
  });
});
