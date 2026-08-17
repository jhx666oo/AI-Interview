import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../dashboard.module.css', import.meta.url), 'utf8');

describe('MiaodaDashboardView funnel styles', () => {
  it('keeps funnel stages compact instead of adding oversized vertical gaps', () => {
    expect(css).toMatch(/\.miaodaFunnelRow\s*\{[\s\S]*?min-height:\s*52px/);
    expect(css).toMatch(/@media \(max-width: 860px\)[\s\S]*?\.miaodaFunnelRow\s*\{[\s\S]*?min-height:\s*44px/);
    expect(css).toMatch(/@media \(max-width: 520px\)[\s\S]*?\.miaodaFunnelRow\s*\{[\s\S]*?min-height:\s*38px/);
  });
});
