import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');

describe('responsive data view styles', () => {
  it('keeps the responsive view constrained within its application content', () => {
    expect(css).toMatch(/\.responsive-data-view\s*\{[\s\S]*?min-width:\s*0[\s\S]*?max-width:\s*100%/);
    expect(css).toMatch(/\.app-shell__content\s*\{[\s\S]*?overflow-x:\s*hidden/);
  });

  it('renders compact cards in two columns and narrow cards in one column', () => {
    expect(css).toMatch(/\[data-responsive-mode=['"]compact['"]\]\s+\.responsive-data-card\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(260px,\s*0\.8fr\)/);
    expect(css).toMatch(/\[data-responsive-mode=['"]narrow['"]\]\s+\.responsive-data-card\s*\{[\s\S]*?display:\s*block/);
  });

  it('makes card details readable in two columns and one narrow column', () => {
    expect(css).toMatch(/\.responsive-data-card-fields\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
    expect(css).toMatch(/\[data-responsive-mode=['"]narrow['"]\]\s+\.responsive-data-card-fields\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  });

  it('keeps controls keyboard-visible and avoids hidden actions', () => {
    expect(css).toMatch(/\.responsive-data-card-actions\s*\{[\s\S]*?flex-wrap:\s*wrap/);
    expect(css).toMatch(/\.responsive-data-card-actions\s+\.ant-space\s*\{[\s\S]*?flex-wrap:\s*wrap/);
    expect(css).toMatch(/\.responsive-data-card\s*\{[\s\S]*?overflow:\s*visible/);
    expect(css).toContain('.responsive-data-card-details-toggle:focus-visible');
    expect(css).toMatch(/\.responsive-data-card-details-toggle:focus-visible,[\s\S]*?\{[\s\S]*?outline:/);
    expect(css).toMatch(/\.responsive-data-card-actions\s+\.ant-btn[\s\S]*?min-height:\s*32px/);
  });

  it('keeps desktop table scrolling local and discoverable', () => {
    expect(css).toMatch(/\.table-viewport\s*\{[\s\S]*?overflow-x:\s*auto/);
    expect(css).toMatch(/\.table-viewport--scroll-hint::after\s*\{[\s\S]*?content:/);
    expect(css).not.toMatch(/\.table-viewport::after\s*\{/);
  });
});
