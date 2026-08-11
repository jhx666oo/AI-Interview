import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const layout = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');

describe('application shell responsive contracts', () => {
  it('keeps desktop shell sizing in flex flow and uses a sticky sidebar', () => {
    expect(layout).toContain('className="app-shell__sider"');
    expect(layout).not.toContain('marginLeft: isMobile ? 0 : (isCompact || collapsed ? 80 : 200)');
    expect(css).toMatch(/\.app-shell__sider[\s\S]*?position:\s*sticky/);
    expect(css).toMatch(/\.app-shell__sider[\s\S]*?height:\s*100vh/);
  });

  it('keeps the sidebar in the shell flex flow with its own scrolling menu', () => {
    const siderStart = layout.indexOf('<Sider');
    const siderEnd = layout.indexOf('</Sider>', siderStart);
    expect(layout.slice(siderStart, siderEnd)).not.toContain('style={{');
    expect(css).toMatch(/\.app-shell\s*\{[\s\S]*?display:\s*flex/);
    expect(css).toMatch(/\.app-shell__sider[\s\S]*?align-self:\s*flex-start/);
    expect(css).toMatch(/\.app-shell__menu[\s\S]*?overflow-y:\s*auto/);
  });
});
