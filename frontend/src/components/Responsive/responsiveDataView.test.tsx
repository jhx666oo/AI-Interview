// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
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
    expect(document.querySelector('tr[data-row-key="position-1"]')).not.toBeNull();
    expect(screen.getByTestId('responsive-data-view').getAttribute('data-responsive-mode')).toBe('full');
  });

  it('renders cards in compact mode', () => {
    render(<ResponsiveDataView {...props} testWidth={1024} />);

    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByRole('list', { name: '数据卡片' })).not.toBeNull();
    expect(screen.getByTestId('responsive-data-view').getAttribute('data-responsive-mode')).toBe('compact');
  });

  it('updates mode when the container is resized', () => {
    const { rerender } = render(<ResponsiveDataView {...props} testWidth={1280} />);
    expect(screen.getByRole('table')).not.toBeNull();

    rerender(<ResponsiveDataView {...props} testWidth={700} />);

    expect(screen.getByRole('list', { name: '数据卡片' })).not.toBeNull();
    expect(screen.getByTestId('responsive-data-view').getAttribute('data-responsive-mode')).toBe('narrow');
  });

  it('uses a function rowKey for card selection when the card does not provide a key', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const cardWithoutKey: ResponsiveCardConfig<Row> = {
      title: (record) => record.name,
      subtitle: (record) => record.department,
      fields: [],
    };

    render(
      <ResponsiveDataView
        {...props}
        card={cardWithoutKey}
        rowKey={(record) => `candidate:${record.id}`}
        rowSelection={{ selectedRowKeys: [], onChange }}
        testWidth={1024}
      />,
    );

    await user.click(screen.getByRole('checkbox', { name: '选择招商主管' }));

    expect(onChange).toHaveBeenCalledWith(
      ['candidate:position-1'],
      [data[0]],
      expect.objectContaining({ type: 'multiple' }),
    );
  });

  it('keeps compact cards on the configured page and forwards pagination changes', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const pagedData: Row[] = [
      ...data,
      { id: 'position-2', name: '产品经理', department: '产品部' },
    ];

    render(
      <ResponsiveDataView
        {...props}
        dataSource={pagedData}
        pagination={{ current: 1, pageSize: 1, total: 2, showSizeChanger: true, onChange }}
        testWidth={1024}
      />,
    );

    expect(screen.getByText('招商主管')).not.toBeNull();
    expect(screen.queryByText('产品经理')).toBeNull();
    expect(screen.getByRole('list', { name: '数据卡片' })).not.toBeNull();
    expect(screen.getByRole('combobox')).not.toBeNull();

    await user.click(screen.getByTitle('2'));

    expect(onChange).toHaveBeenCalledWith(2, 1);
  });

  it('updates compact cards after changing an uncontrolled pagination page', async () => {
    const user = userEvent.setup();
    const pagedData: Row[] = [
      ...data,
      { id: 'position-2', name: '产品经理', department: '产品部' },
    ];

    render(
      <ResponsiveDataView
        {...props}
        dataSource={pagedData}
        pagination={{ defaultCurrent: 1, defaultPageSize: 1, total: 2 }}
        testWidth={1024}
      />,
    );

    expect(screen.getByText('招商主管')).not.toBeNull();
    expect(screen.queryByText('产品经理')).toBeNull();

    await user.click(screen.getByTitle('2'));

    expect(screen.queryByText('招商主管')).toBeNull();
    expect(screen.getByText('产品经理')).not.toBeNull();
  });
});
