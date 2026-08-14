import { describe, expect, it } from 'vitest';
import {
  buildScreeningRulesPrompt,
  resolveScreeningRules,
} from '../src/resume-processing/screening-rules';

describe('screening rule resolution', () => {
  it('uses 2, 5, and 3.5 as the builtin defaults', () => {
    expect(resolveScreeningRules(null)).toMatchObject({
      keyword_match_min_score: 2,
      red_flag_min_score: 5,
      weighted_score_min: 3.5,
      source: 'builtin',
    });
  });

  it('uses a complete valid position override before the system value', () => {
    expect(resolveScreeningRules(
      { keyword_match_min_score: 2, red_flag_min_score: 5, weighted_score_min: 4 },
      { keyword_match_min_score: 3, red_flag_min_score: 4, weighted_score_min: 3.5 },
    )).toMatchObject({
      keyword_match_min_score: 3,
      red_flag_min_score: 4,
      weighted_score_min: 3.5,
      source: 'position',
    });
  });

  it('falls back when a system or position object is partial, non-numeric, or out of range', () => {
    expect(resolveScreeningRules({ keyword_match_min_score: 9 })).toMatchObject({ source: 'builtin' });
    expect(resolveScreeningRules(
      { keyword_match_min_score: 2, red_flag_min_score: 5, weighted_score_min: 4 },
      { keyword_match_min_score: 3 },
    )).toMatchObject({ weighted_score_min: 4, source: 'system' });
  });

  it('renders all three thresholds and the AND condition for the AI prompt', () => {
    const text = buildScreeningRulesPrompt({
      keyword_match_min_score: 2,
      red_flag_min_score: 5,
      weighted_score_min: 3.5,
    });
    expect(text).toContain('关键词匹配 >= 2 分');
    expect(text).toContain('避坑雷区 >= 5 分');
    expect(text).toContain('五项能力加权分 >= 3.5 分');
    expect(text).toContain('三项必须同时满足');
  });
});
