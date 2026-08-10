import { describe, expect, it } from 'vitest';
import { filterD1Requisitions, parseD1RequisitionRow } from '../src/index';

describe('D1 primary requisitions', () => {
  it('maps JSON fields from a D1 row into the requisition API shape', () => {
    const item = parseD1RequisitionRow({
      id: 'req-1',
      feishu_record_id: 'rec-1',
      title: '社区运营专员',
      department: '雏渐肥事业部',
      city: '["长沙", "北京"]',
      hard_requirements: '[{"field":"age","operator":"lte","value":35}]',
      personalized_requirements: '{"items":["有社群运营经验"]}',
      status: 'open',
      created_at: '2026-08-10T09:00:00Z',
    });

    expect(item).toMatchObject({
      id: 'req-1',
      feishu_record_id: 'rec-1',
      title: '社区运营专员',
      city: ['长沙', '北京'],
      hard_requirements: [{ field: 'age', operator: 'lte', value: 35 }],
      personalized_requirements: { items: ['有社群运营经验'] },
    });
  });

  it('applies status, department, and owner filters to D1 rows', () => {
    const rows = [
      { id: 'req-1', title: '岗位一', department: '事业部A', responsible_person: '甲', status: 'open' },
      { id: 'req-2', title: '岗位二', department: '事业部B', responsible_person: '乙', status: 'draft' },
    ];

    expect(filterD1Requisitions(rows, { status: 'open', department: '事业部A', responsible_person: '甲' })).toHaveLength(1);
    expect(filterD1Requisitions(rows, { status: 'open', department: '事业部B' })).toHaveLength(0);
  });

  it('uses safe defaults for malformed JSON fields', () => {
    const item = parseD1RequisitionRow({
      id: 'req-1',
      title: '岗位',
      city: 'not-json',
      hard_requirements: '{bad',
      personalized_requirements: '',
    });

    expect(item.city).toEqual(['not-json']);
    expect(item.hard_requirements).toEqual([]);
    expect(item.personalized_requirements).toEqual({});
  });
});
