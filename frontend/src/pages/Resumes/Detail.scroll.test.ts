import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('resume detail AI analysis scrolling', () => {
  it('limits vertical scrolling to the outer analysis panel', () => {
    const source = readFileSync(new URL('./Detail.tsx', import.meta.url), 'utf8');

    expect(source).toContain('const aiContentStyle: React.CSSProperties = {');
    expect(source).toContain('const aiAnalysisPanelStyle: React.CSSProperties = {');
    const contentStyle = source.match(/const aiContentStyle: React\.CSSProperties = \{([\s\S]*?)\n  \};/);
    const panelStyle = source.match(/const aiAnalysisPanelStyle: React\.CSSProperties = \{([\s\S]*?)\n  \};/);

    expect(contentStyle?.[1]).toContain("maxWidth: '100%'");
    expect(contentStyle?.[1]).toContain("overflowWrap: 'anywhere'");
    expect(contentStyle?.[1]).not.toContain('maxHeight');
    expect(contentStyle?.[1]).not.toContain('overflowY');
    expect(panelStyle?.[1]).toContain("maxHeight: '60vh'");
    expect(panelStyle?.[1]).toContain("overflowY: 'auto'");
    expect(source.match(/\.\.\.aiAnalysisPanelStyle/g)).toHaveLength(2);
    expect(source.match(/\.\.\.aiContentStyle/g)).toHaveLength(4);
  });
});
