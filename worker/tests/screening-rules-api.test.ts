import { describe, expect, it } from 'vitest';
import { getPositionContext } from '../src/index';

function makeDb(systemRules: unknown, positionRules: unknown) {
  return {
    prepare(sql: string) {
      return {
        bind: (..._values: unknown[]) => ({
          first: async () => {
            if (sql.includes('FROM system_configs')) return { screening_rules: systemRules };
            if (sql.includes('FROM position_mappings')) return null;
            if (sql.includes('SELECT title FROM positions')) return { title: '产品经理' };
            if (sql.includes('FROM positions WHERE title')) {
              return {
                description: '负责产品规划',
                requirements: '具备产品经验',
                personalized_requirements: '',
                capability_dimensions: '[]',
                salary_range: '',
                screening_rules: positionRules,
              };
            }
            if (sql.includes('FROM capability_dimensions')) return null;
            if (sql.includes('FROM job_requisitions')) return null;
            return null;
          },
        }),
      };
    },
  };
}

describe('screening rules position context', () => {
  it('uses builtin defaults when no system setting exists', async () => {
    const context = await getPositionContext(makeDb(null, null), '产品经理');
    expect(context.screeningRules).toEqual({
      keyword_match_min_score: 2,
      red_flag_min_score: 5,
      weighted_score_min: 3.5,
      source: 'builtin',
    });
  });

  it('uses a complete position override over the system setting', async () => {
    const context = await getPositionContext(
      makeDb(
        { keyword_match_min_score: 2, red_flag_min_score: 5, weighted_score_min: 4 },
        { keyword_match_min_score: 3, red_flag_min_score: 4, weighted_score_min: 3.5 },
      ),
      '产品经理',
    );
    expect(context.screeningRules).toEqual({
      keyword_match_min_score: 3,
      red_flag_min_score: 4,
      weighted_score_min: 3.5,
      source: 'position',
    });
  });
});
