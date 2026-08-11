// @vitest-environment jsdom
import { useState, type Key } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResponsiveCardList } from './responsiveCardList';
import type { ResponsiveCardConfig } from './responsiveTypes';

interface Row {
  id: string;
  name: string;
  department: string;
  city: string;
  budget: string;
  note: string;
}

const row: Row = {
  id: 'row-1',
  name: '招商主管',
  department: '业务部',
  city: '杭州',
  budget: '8k-10k',
  note: '',
};

const disabledRow: Row = {
  ...row,
  id: 'row-2',
  name: '禁用岗位',
};

const config: ResponsiveCardConfig<Row> = {
  getKey: (record) => record.id,
  title: (record) => record.name,
  subtitle: (record) => record.department,
  status: (record) => <span>{record.city}</span>,
  fields: [
    { key: 'city', label: '城市', level: 'secondary', render: (record) => record.city },
    { key: 'budget', label: '预算', level: 'detail', render: (record) => record.budget },
    { key: 'note', label: '备注', level: 'detail', hideWhenEmpty: true, render: (record) => record.note },
  ],
};

describe('ResponsiveCardList', () => {
  afterEach(() => cleanup());

  it('shows secondary fields and expands the card detail panel on demand', async () => {
    const user = userEvent.setup();
    render(<ResponsiveCardList data={[row]} card={config} />);

    expect(screen.getByText('招商主管')).toBeDefined();
    expect(screen.getByText('城市')).toBeDefined();
    expect(screen.queryByText('预算')).toBeNull();

    const detailsButton = screen.getByRole('button', { name: '展开招商主管详情' });
    expect(detailsButton.getAttribute('aria-expanded')).toBe('false');

    await user.click(detailsButton);

    expect(screen.getByText('预算')).toBeDefined();
    expect(screen.getByRole('button', { name: '收起招商主管详情' }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.queryByText('备注')).toBeNull();
  });

  it('updates selected card state and emits the selected record payload', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    function SelectionHarness() {
      const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([]);

      return (
        <ResponsiveCardList
          data={[row]}
          card={config}
          rowSelection={{
            selectedRowKeys,
            onChange: (keys, rows, info) => {
              setSelectedRowKeys(keys);
              onChange(keys, rows, info);
            },
          }}
        />
      );
    }

    render(<SelectionHarness />);
    const checkbox = screen.getByRole('checkbox', { name: '选择招商主管' });
    expect(checkbox.getAttribute('aria-checked')).toBe('false');

    await user.click(checkbox);

    expect(checkbox.getAttribute('aria-checked')).toBe('true');
    expect(onChange).toHaveBeenLastCalledWith(['row-1'], [row], { type: 'multiple' });
  });

  it('selects all enabled cards while keeping disabled cards unselectable', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    function SelectionHarness() {
      const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([]);

      return (
        <ResponsiveCardList
          data={[row, disabledRow]}
          card={config}
          rowSelection={{
            selectedRowKeys,
            getCheckboxProps: (candidate) => ({ disabled: candidate.id === disabledRow.id }),
            onChange: (keys, rows, info) => {
              setSelectedRowKeys(keys);
              onChange(keys, rows, info);
            },
          }}
        />
      );
    }

    render(<SelectionHarness />);
    const selectAll = screen.getByRole('checkbox', { name: '全选当前页' });
    const disabledCheckbox = screen.getByRole('checkbox', { name: '选择禁用岗位' });
    expect(disabledCheckbox).toHaveProperty('disabled', true);

    await user.click(selectAll);

    expect(selectAll.getAttribute('aria-checked')).toBe('true');
    expect(disabledCheckbox.getAttribute('aria-checked')).toBe('false');
    expect(onChange).toHaveBeenLastCalledWith(['row-1'], [row], { type: 'multiple' });
  });
});
