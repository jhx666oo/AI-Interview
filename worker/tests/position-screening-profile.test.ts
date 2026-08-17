import { describe, expect, it } from 'vitest';
import { getPositionContext } from '../src/index';

function makeDb(positionDimensions: unknown, independentDimensions: unknown) {
  return {
    prepare(sql: string) {
      return {
        bind: (..._values: unknown[]) => ({
          first: async () => {
            if (sql.includes('FROM system_configs')) return null;
            if (sql.includes('FROM position_mappings')) return null;
            if (sql.includes('SELECT title FROM positions')) return { title: '护士' };
            if (sql.includes('FROM positions WHERE title')) {
              return {
                description: '负责护理工作',
                requirements: '具备护理经验',
                personalized_requirements: '',
                capability_dimensions: JSON.stringify(positionDimensions),
                salary_range: '',
                screening_rules: null,
              };
            }
            if (sql.includes('FROM capability_dimensions')) {
              return independentDimensions ? { dimensions_json: JSON.stringify(independentDimensions), personalized_requirements: '' } : null;
            }
            if (sql.includes('FROM job_requisitions')) return null;
            return null;
          },
        }),
      };
    },
  };
}

describe('position screening profile', () => {
  it('prefers a non-empty independent dimension configuration', async () => {
    const context = await getPositionContext(
      makeDb([{ name: '岗位表维度' }], [{ name: '加分项', weight: 10 }, { name: '任职要求', weight: 90 }]),
      '护士',
    );

    expect(context.capabilityDimensionItems.map(item => item.name)).toEqual(['加分项', '任职要求']);
    expect(context.capabilityDimensions).toContain('加分项');
    expect(context.usesLegacyDimensions).toBe(false);
  });

  it('falls back to the position JSON when the independent configuration is empty', async () => {
    const context = await getPositionContext(
      makeDb([{ name: '核心职责', weight: 100 }], []),
      '护士',
    );

    expect(context.capabilityDimensionItems.map(item => item.name)).toEqual(['核心职责']);
    expect(context.usesLegacyDimensions).toBe(false);
  });

  it('marks an empty position configuration as legacy seven dimensions', async () => {
    const context = await getPositionContext(makeDb([], []), '护士');

    expect(context.capabilityDimensionItems).toHaveLength(7);
    expect(context.usesLegacyDimensions).toBe(true);
  });
});
