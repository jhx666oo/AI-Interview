// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TableViewport } from './TableViewport';

describe('TableViewport', () => {
  it('does not opt ordinary table viewports into a scroll hint', () => {
    const { container } = render(<TableViewport>普通表格</TableViewport>);

    expect(container.firstElementChild?.className).toBe('table-viewport');
  });

  it('keeps the scroll hint opt-in class separate from ordinary table viewports', () => {
    const { container } = render(<TableViewport showScrollHint>宽表格</TableViewport>);

    expect(container.firstElementChild?.className).toContain('table-viewport--scroll-hint');
  });
});
