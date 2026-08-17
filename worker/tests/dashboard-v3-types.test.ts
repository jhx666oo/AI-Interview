import { describe, expect, it } from 'vitest';
import {
  DASHBOARD_V3_FUNNEL_STAGES,
  finalPassCount,
  isStatisticalPriority,
  rateOrNull,
} from '../src/recruiting-operations/dashboard-v3-types';

describe('dashboard v3 metric rules', () => {
  it('keeps the seven global funnel stages in the agreed order', () => {
    expect(DASHBOARD_V3_FUNNEL_STAGES.map((stage) => stage.key)).toEqual([
      'resume_push',
      'first_scheduled',
      'first_pass',
      'second_pass',
      'final_pass',
      'offers',
      'hired',
    ]);
  });

  it('uses third-round pass when it is explicitly zero', () => {
    expect(finalPassCount({ third_pass: 0, second_pass: 4 })).toBe(0);
    expect(finalPassCount({ third_pass: null, second_pass: 4 })).toBe(4);
    expect(finalPassCount({ third_pass: undefined, second_pass: 4 })).toBe(4);
  });

  it('excludes only P2 from statistical aggregates', () => {
    expect(isStatisticalPriority('P0')).toBe(true);
    expect(isStatisticalPriority('P1')).toBe(true);
    expect(isStatisticalPriority('P2')).toBe(false);
  });

  it('returns null instead of Infinity for zero-denominator rates', () => {
    expect(rateOrNull(5, 0)).toBeNull();
    expect(rateOrNull(2, 4)).toBe(50);
  });
});
