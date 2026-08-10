import { describe, expect, it } from 'vitest';
import { PageHeader, ResponsiveModal, ResponsiveToolbar, TableViewport } from './index';

describe('responsive layout primitives', () => {
  it('exports all four components', () => {
    expect(PageHeader).toBeTypeOf('function');
    expect(ResponsiveToolbar).toBeTypeOf('function');
    expect(TableViewport).toBeTypeOf('function');
    expect(ResponsiveModal).toBeTypeOf('function');
  });
});
