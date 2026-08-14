import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCREENING_RULES,
  normalizeScreeningRules,
  parseScreeningRules,
  serializeScreeningRules,
} from './screeningRules';

describe('screening rules frontend helpers', () => {
  it('parses complete valid rules', () => {
    expect(parseScreeningRules({ keyword_match_min_score: 2, red_flag_min_score: 5, weighted_score_min: 3.5 }))
      .toEqual({ keyword_match_min_score: 2, red_flag_min_score: 5, weighted_score_min: 3.5 });
  });

  it('falls back to defaults for invalid or partial rules', () => {
    expect(normalizeScreeningRules('{"weighted_score_min": 3.5}')).toEqual(DEFAULT_SCREENING_RULES);
    expect(parseScreeningRules({ keyword_match_min_score: 2.5, red_flag_min_score: 5, weighted_score_min: 3.5 })).toBeNull();
  });

  it('serializes an enabled override and clears invalid values', () => {
    expect(serializeScreeningRules(DEFAULT_SCREENING_RULES)).toBe(JSON.stringify(DEFAULT_SCREENING_RULES));
    expect(serializeScreeningRules(null)).toBe('');
  });
});
