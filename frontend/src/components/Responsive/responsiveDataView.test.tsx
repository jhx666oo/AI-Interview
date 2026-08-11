// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ResponsiveDataView } from './responsiveDataView';
import type { ResponsiveCardConfig } from './responsiveTypes';

interface Row {
  id: string;
  name: string;
  department: string;
}

const data: Row[] = [{ id: 'position-1', name: '招商主管', department: '业务部' }];

const card: ResponsiveCardConfig<Row> = {
  getKey: (record) => record.id,
  title: (record) => record.name,
  subtitle: (record) => record.department,
  fields: [],
};

const props = {
  dataSource: data,
  columns: [{ title: '岗位名称', dataIndex: 'name', key: 'name' }],
  rowKey: 'id' as const,
  card,
};

describe('ResponsiveDataView', () => {
  beforeAll(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: () => ({
        matches: false,
        media: '',
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }),
    });
  });

  afterEach(() => cleanup());

  it('renders Ant Table in full mode', () => {
    render(<ResponsiveDataView {...props} testWidth={1280} />);

    expect(screen.getByRole('table')).not.toBeNull();
    expect(screen.getByTestId('responsive-data-view').getAttribute('data-responsive-mode')).toBe('full');
  });

  it('renders cards in compact mode', () => {
    render(<ResponsiveDataView {...props} testWidth={1024} />);

    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByRole('list')).not.toBeNull();
    expect(screen.getByTestId('responsive-data-view').getAttribute('data-responsive-mode')).toBe('compact');
  });

  it('updates mode when the container is resized', () => {
    const { rerender } = render(<ResponsiveDataView {...props} testWidth={1280} />);
    expect(screen.getByRole('table')).not.toBeNull();

    rerender(<ResponsiveDataView {...props} testWidth={700} />);

    expect(screen.getByRole('list')).not.toBeNull();
    expect(screen.getByTestId('responsive-data-view').getAttribute('data-responsive-mode')).toBe('narrow');
  });
});
