import { describe, expect, it } from 'vitest';
import { mergeTalentPoolItems } from '../src/index';

describe('talent pool projection', () => {
  it('includes an approved D1-only resume when Feishu has no matching record', () => {
    const items = mergeTalentPoolItems([], [{
      id: 'resume-d1-only',
      candidate_name: 'D1 候选人',
      position_applied: '产品经理',
      mapped_position: '产品经理',
      status: 'approved',
      stage: 'talent_pool',
      created_at: '2026-08-04T10:00:00Z',
      parsed_data: JSON.stringify({ city: '上海', highest_degree: '本科' }),
    }]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: 'resume-d1-only',
      feishu_record_id: '',
      candidate_name: 'D1 候选人',
      position_applied: '产品经理',
      status: 'approved',
      city: '上海',
      education: '本科',
    });
  });

  it('uses D1 approval as the source of truth for a matching Feishu record', () => {
    const items = mergeTalentPoolItems([
      {
        id: 'rec-1',
        feishu_record_id: 'rec-1',
        candidate_name: '候选人',
        status: 'pending_screening',
        hr_review: '',
      },
    ], [{
      id: 'rec-1',
      candidate_name: '候选人',
      status: 'approved',
      stage: 'talent_pool',
      hr_review: '通过',
    }]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: 'rec-1',
      status: 'approved',
      hr_review: '通过',
    });
  });
});
