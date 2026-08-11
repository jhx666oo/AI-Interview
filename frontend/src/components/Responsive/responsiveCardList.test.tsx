import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
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

  it('defines accessible details, selection controls, and empty-field filtering', () => {
    const source = readFileSync(new URL('./responsiveCardList.tsx', import.meta.url), 'utf8');

    expect(source).toContain('role="list"');
    expect(source).toContain('aria-expanded');
    expect(source).toContain('全选当前页');
    expect(source).toContain('rowSelection?.onChange');
    expect(source).toContain('getCheckboxProps');
    expect(source).toContain('hideWhenEmpty');
  });
});
