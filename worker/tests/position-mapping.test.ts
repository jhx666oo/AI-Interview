import { describe, expect, it } from 'vitest';
import { buildPositionMappingFromRows, resolveMappedPosition } from '../src/position-mapping';
import { buildPositionDefaultsIndex, resolvePositionDefaults } from '../src/interviewer-assignment';

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

  it('resolves a historical raw position to the single standard position assignment', () => {
    const index = buildPositionDefaultsIndex(
      [{
        id: 'position-1',
        title: '软件产品经理（智能硬件方向）',
        primary_interviewer: '杜雁玲',
        secondary_interviewer: '何雨菱',
      }],
      [{
        raw_name: 'IoT产品经理（双休｜入职五险一金）',
        raw_names: '["IoT产品经理（双休｜入职五险一金）","IoT产品经理"]',
        mapped_name: '软件产品经理（智能硬件方向）',
      }],
    );

    expect(resolvePositionDefaults(index, {
      position_id: 'IoT产品经理（双休｜入职五险一金）',
      position_applied: '',
    })).toEqual({
      id: 'position-1',
      title: '软件产品经理（智能硬件方向）',
      primary_interviewer: '杜雁玲',
      secondary_interviewer: '何雨菱',
    });
  });
});
