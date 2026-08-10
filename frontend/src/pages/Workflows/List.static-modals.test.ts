import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./List.tsx', import.meta.url), 'utf8');

describe('workflow static modals', () => {
  it('caps execution and batch-action modal widths to the narrow viewport', () => {
    expect(source).toContain(
      "const staticModalWidth = 'min(600px, calc(100vw - 32px))';",
    );
    expect(source).toMatch(/Modal\.info\([\s\S]*?width: staticModalWidth/);
    expect(source).toMatch(/handleBatchDelete[\s\S]*?Modal\.confirm\([\s\S]*?width: staticModalWidth/);
    expect(source).toMatch(/handleBatchPublish[\s\S]*?Modal\.confirm\([\s\S]*?width: staticModalWidth/);
  });
});
