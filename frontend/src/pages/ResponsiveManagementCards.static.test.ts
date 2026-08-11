import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pages = [
  'Requisitions/List.tsx',
  'Positions/List.tsx',
  'Settings/PositionMappings.tsx',
  'Settings/InterviewerMappings.tsx',
  'Settings/Users.tsx',
];

const readPage = (relativePath: string) =>
  readFileSync(new URL(`./${relativePath}`, import.meta.url), 'utf8');

describe('high-frequency management pages use responsive data cards', () => {
  it.each(pages)('%s declares a ResponsiveDataView card configuration', (page) => {
    const source = readPage(page);

    expect(source).toContain('ResponsiveDataView');
    expect(source).toContain('card=');
  });

  it('keeps existing high-frequency mutation handlers connected to the pages', () => {
    expect(readPage('Requisitions/List.tsx')).toContain('handleBatchDelete');
    expect(readPage('Positions/List.tsx')).toContain('handlePublish');
    expect(readPage('Settings/PositionMappings.tsx')).toContain('handleSync');
    expect(readPage('Settings/InterviewerMappings.tsx')).toContain('handleSave');
    expect(readPage('Settings/Users.tsx')).toContain('handleDelete');
  });
});
