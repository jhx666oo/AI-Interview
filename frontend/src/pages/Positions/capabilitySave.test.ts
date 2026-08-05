import { describe, expect, it } from 'vitest';
import { buildPositionCapabilitySave } from './capabilitySave';

describe('buildPositionCapabilitySave', () => {
  it('keeps same-named capability descriptions scoped to the edited position', () => {
    const result = buildPositionCapabilitySave({
      title: '软件产品经理（智能硬件方向）',
      capability_dimensions: [{ name: '任职要求', description: '产品经理描述' }],
    });

    expect(result.payload.capability_dimensions).toBe(
      JSON.stringify([{ name: '任职要求', description: '产品经理描述' }]),
    );
    expect(result.crossPositionUpdates).toEqual([]);
  });

  it('preserves scoring weights and non-scoring gates in the position payload', () => {
    const result = buildPositionCapabilitySave({
      title: '产品经理',
      capability_dimensions: [
        { name: '核心画像', description: '目标候选人画像', weight: 25 },
        { name: '关键词匹配', description: '必须命中关键词', weight: null },
        { name: '避坑雷区', description: '不得命中风险项', weight: null },
      ],
    });

    expect(result.payload.capability_dimensions).toBe(JSON.stringify([
      { name: '核心画像', description: '目标候选人画像', weight: 25 },
      { name: '关键词匹配', description: '必须命中关键词', weight: null },
      { name: '避坑雷区', description: '不得命中风险项', weight: null },
    ]));
  });
});
