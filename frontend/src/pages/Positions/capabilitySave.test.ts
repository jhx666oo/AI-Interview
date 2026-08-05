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
});
