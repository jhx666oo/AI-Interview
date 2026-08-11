import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PageHeader, ResponsiveModal, ResponsiveToolbar, TableViewport } from './index';

describe('responsive layout primitives', () => {
  it('exports all four components', () => {
    expect(PageHeader).toBeTypeOf('function');
    expect(ResponsiveToolbar).toBeTypeOf('function');
    expect(TableViewport).toBeTypeOf('function');
    expect(ResponsiveModal).toBeTypeOf('function');
  });

  it('limits the Ant Design modal element to the viewport width', () => {
    const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');

    expect(css).toMatch(
      /\.responsive-modal\s*\{\s*max-width:\s*calc\(100vw\s*-\s*32px\);/,
    );
  });
});
