import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('production resume list configuration', () => {
  it('enables the lightweight SQL resume list on Pages', () => {
    const config = readFileSync(resolve(process.cwd(), '../frontend/wrangler.toml'), 'utf8');
    expect(config).toMatch(/RESUME_SQL_LIST\s*=\s*"true"/);
  });
});
