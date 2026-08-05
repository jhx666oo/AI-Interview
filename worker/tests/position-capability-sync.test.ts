import { describe, expect, it } from 'vitest';
import {
  buildCapabilityDimensionsFullText,
  normalizeCapabilityDimensionsForStorage,
} from '../src/position-capability-sync';

describe('position capability dimension storage', () => {
  it('preserves inline descriptions when normalizing dimensions', () => {
    expect(normalizeCapabilityDimensionsForStorage('[{"name":"客户洞察","description":"能从数据提炼需求"}]'))
      .toEqual([{ name: '客户洞察', description: '能从数据提炼需求' }]);
  });

  it('builds readable full text from either description format', () => {
    expect(buildCapabilityDimensionsFullText([
      { name: '客户洞察', description: '能从数据提炼需求' },
      { name: '沟通协作', definition: '跨团队推动共识', behavior: '主动同步风险' },
    ])).toBe(
      '1. - 客户洞察\n- 简要定义：能从数据提炼需求\n2. - 沟通协作\n- 简要定义：跨团队推动共识\n- 典型行为表现：主动同步风险',
    );
  });
});
