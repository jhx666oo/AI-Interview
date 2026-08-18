import { describe, expect, it } from 'vitest';
import { FIELD_GLOSSARY, FIELD_GLOSSARY_CATEGORIES, filterFieldGlossary } from './fieldGlossary';

describe('dashboard field glossary', () => {
  it('contains the complete Miaoda glossary categories and key definitions', () => {
    expect(FIELD_GLOSSARY_CATEGORIES).toEqual(['全部', '核心指标', '基础字段', '数据范围', '状态分类', '效能指标']);
    expect(FIELD_GLOSSARY.length).toBeGreaterThanOrEqual(30);
    expect(FIELD_GLOSSARY.find((item) => item.name === '招聘漏斗口径')?.definition).toContain('7 级指标');
    expect(FIELD_GLOSSARY.find((item) => item.name === '终面通过')?.definition).toContain('3面通过有值取3面');
  });

  it('filters by Miaoda categories while retaining all items for 全部', () => {
    const core = filterFieldGlossary('核心指标');
    expect(core.length).toBeGreaterThan(10);
    expect(core.every((item) => item.category === '核心指标')).toBe(true);
    expect(filterFieldGlossary('全部')).toHaveLength(FIELD_GLOSSARY.length);
  });
});
