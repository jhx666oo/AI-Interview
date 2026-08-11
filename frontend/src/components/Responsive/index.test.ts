import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  PageHeader,
  ResponsiveCardList,
  ResponsiveDataView,
  ResponsiveModal,
  ResponsiveToolbar,
  TableViewport,
  getResponsiveMode,
} from './index';

describe('responsive layout primitives', () => {
  it('exports the responsive layout primitives and data view', () => {
    expect(PageHeader).toBeTypeOf('function');
    expect(ResponsiveToolbar).toBeTypeOf('function');
    expect(TableViewport).toBeTypeOf('function');
    expect(ResponsiveModal).toBeTypeOf('function');
    expect(ResponsiveCardList).toBeTypeOf('function');
    expect(ResponsiveDataView).toBeTypeOf('function');
    expect(getResponsiveMode(1180)).toBe('full');
  });

  it('limits the Ant Design modal element to the viewport width', () => {
    const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');

    expect(css).toMatch(
      /\.responsive-modal\s*\{\s*max-width:\s*calc\(100vw\s*-\s*32px\);/,
    );
  });
});
