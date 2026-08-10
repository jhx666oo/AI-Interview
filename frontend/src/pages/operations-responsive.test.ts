import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readPage = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), 'utf8');

describe('operations pages responsive layout', () => {
  it('wraps talent pool filters on narrow screens', () => {
    expect(readPage('./TalentPool/List.tsx')).toContain('actions={<Space wrap>');
  });

  it.each([
    ['./Interviews/List.tsx', [600]],
    ['./Probation/List.tsx', [520, 700]],
    ['./Positions/List.tsx', [640, 800]],
  ])('uses ResponsiveModal for reviewed fixed-width dialogs in %s', (page, widths) => {
    const source = readPage(page);

    for (const width of widths) {
      expect(source).toContain(`width={${width}}`);
      expect(source).toMatch(
        new RegExp(`<ResponsiveModal[\\s\\S]*?width=\\{${width}\\}`),
      );
    }
  });

  it('uses responsive onboarding form columns', () => {
    const source = readPage('./Onboarding/List.tsx');

    expect(source).not.toMatch(/<Col span=\{(?:6|8)\}>/);
    expect(source).toContain('<Col xs={24} sm={12} md={8}>');
  });

  it('uses responsive probation form columns', () => {
    const source = readPage('./Probation/List.tsx');

    expect(source).not.toContain('<Col span={12}>');
    expect(source).toContain('<Col xs={24} sm={12} md={8}>');
  });

  it('stacks reused interview question fields on extra-small screens', () => {
    const source = readPage('./Interviews/Score.tsx');

    expect(source).toContain('<Col xs={24} sm={12}>');
  });

  it('keeps the result page header outside the PDF export card', () => {
    const source = readPage('./Interviews/Result.tsx');
    const pageHeader = source.lastIndexOf('<PageHeader title="面试结果" />');
    const exportCard = source.lastIndexOf('<Card id="interview-result-content">');

    expect(pageHeader).toBeGreaterThan(-1);
    expect(exportCard).toBeGreaterThan(pageHeader);
    expect(source.slice(pageHeader, exportCard)).not.toContain('id="interview-result-content"');
  });
});
