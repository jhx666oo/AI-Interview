import { describe, expect, it } from 'vitest';
import { buildPositionMappingFromRows, resolveMappedPosition } from '../src/position-mapping';

describe('position mapping projection', () => {
  it('resolves raw aliases and historical lowercase iot to the standard title', () => {
    const mapping = buildPositionMappingFromRows([{
      raw_name: '智能硬件产品经理',
      raw_names: '["智能硬件产品经理","软件产品经理（硬件方向）","IoT产品经理","IoT产品经理（双休｜入职五险一金）"]',
      mapped_name: '软件产品经理（智能硬件方向）',
    }]);

    expect(resolveMappedPosition(mapping, 'IoT产品经理（双休｜入职五险一金）'))
      .toBe('软件产品经理（智能硬件方向）');
    expect(resolveMappedPosition(mapping, 'iot')).toBe('软件产品经理（智能硬件方向）');
    expect(resolveMappedPosition(mapping, '软件产品经理（智能硬件方向）'))
      .toBe('软件产品经理（智能硬件方向）');
  });

  it('keeps an unmapped position unchanged', () => {
    const mapping = buildPositionMappingFromRows([]);
    expect(resolveMappedPosition(mapping, '前端工程师')).toBe('前端工程师');
    expect(resolveMappedPosition(mapping, '')).toBe('');
  });
});
