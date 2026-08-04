import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('production resume list configuration', () => {
  it('does not redeclare the Pages-managed lightweight list variable', () => {
    const config = readFileSync(resolve(process.cwd(), '../frontend/wrangler.toml'), 'utf8');
    expect(config).not.toMatch(/^\s*RESUME_SQL_LIST\s*=/m);
  });
});
