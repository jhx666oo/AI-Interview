import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  ResponsiveCardList,
  createCardSelectionChange,
  getCardFieldGroups,
  getResponsiveCardRecords,
  isCardRecordSelectable,
  toggleAllCardSelection,
  toggleExpandedCardKey,
  toggleRecordSelection,
} from './responsiveCardList';
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
  it('exports a reusable list component for responsive data cards', () => {
    expect(ResponsiveCardList).toBeTypeOf('function');
  });

  it('shows primary fields while keeping detail fields collapsed initially', () => {
    const html = renderToStaticMarkup(<ResponsiveCardList data={[row]} card={config} />);

    expect(html).toContain('招商主管');
    expect(html).toContain('城市');
    expect(html).not.toContain('预算');
  });

  it('makes detail fields available only after the card is expanded and omits empty hidden fields', () => {
    const collapsed = getCardFieldGroups(config, row, 0, false);
    const expanded = getCardFieldGroups(config, row, 0, true);

    expect(collapsed.secondary.map((field) => field.key)).toEqual(['city']);
    expect(collapsed.detail).toEqual([]);
    expect(expanded.detail.map((field) => field.key)).toEqual(['budget']);
    expect(toggleExpandedCardKey(new Set(), row.id)).toEqual(new Set([row.id]));
    expect(toggleExpandedCardKey(new Set([row.id]), row.id)).toEqual(new Set());
  });

  it('emits row selection payloads for an enabled single card without mutating records', () => {
    const records = getResponsiveCardRecords([row, disabledRow], config);
    const nextKeys = toggleRecordSelection([], row.id, true);
    const payload = createCardSelectionChange(records, nextKeys);

    expect(payload.selectedRowKeys).toEqual([row.id]);
    expect(payload.selectedRows).toEqual([row]);
    expect(records.map((entry) => entry.record)).toEqual([row, disabledRow]);
  });

  it('selects only enabled cards when selecting the current page', () => {
    const records = getResponsiveCardRecords([row, disabledRow], config);
    const nextKeys = toggleAllCardSelection(
      [],
      records,
      (record) => isCardRecordSelectable(record, {
        getCheckboxProps: (candidate) => ({ disabled: candidate.id === disabledRow.id }),
      }),
      true,
    );
    const payload = createCardSelectionChange(records, nextKeys);

    expect(payload.selectedRowKeys).toEqual([row.id]);
    expect(payload.selectedRows).toEqual([row]);
  });
});
