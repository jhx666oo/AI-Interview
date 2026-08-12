import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');

describe('non-optimized resume list business-screening contract', () => {
  it('selects business-screening state fields from D1 and reads the dedicated filter query', () => {
    expect(source).toContain('hr_disposition');
    expect(source).toContain('business_screening_status');
    expect(source).toContain("c.req.query('business_screening_status')");
  });
});
