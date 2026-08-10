import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getLayoutMode } from './responsive';

describe('getLayoutMode', () => {
  it.each([
    [1920, 'desktop'],
    [1200, 'desktop'],
    [1199, 'compact'],
    [768, 'compact'],
    [767, 'mobile'],
    [480, 'mobile'],
    [479, 'narrow'],
    [390, 'narrow'],
  ] as const)('maps %dpx to %s', (width, expected) => {
    expect(getLayoutMode(width)).toBe(expected);
  });
});

describe('application shell responsive contract', () => {
  it('uses the shared layout mode and exposes a mobile navigation drawer', () => {
    const source = readFileSync(resolve(__dirname, 'index.tsx'), 'utf8');

    expect(source).toContain("from './responsive'");
    expect(source).toContain('getLayoutMode(viewportWidth)');
    expect(source).toContain('<Drawer');
    expect(source).toContain('mobileMenuOpen');
    expect(source).toContain('className="app-shell"');
  });
});
