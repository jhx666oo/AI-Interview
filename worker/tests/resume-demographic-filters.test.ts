import { describe, expect, it } from 'vitest';
import { filterResumesByDemographics, filterResumesByMinimumDimensionScore } from '../../frontend/src/utils/resumeFilters';

const resumes = [
  { id: 'a', age: '24岁', gender: '女' },
  { id: 'b', age: 35, gender: '男' },
  { id: 'c', age: null, gender: null },
];

describe('filterResumesByDemographics', () => {
  it('filters a manual inclusive age range and excludes unknown ages', () => {
    expect(filterResumesByDemographics(resumes, { minAge: 25, maxAge: 35, genders: [] }).map(row => row.id))
      .toEqual(['b']);
  });

  it('supports either age bound independently', () => {
    expect(filterResumesByDemographics(resumes, { minAge: null, maxAge: 24, genders: [] }).map(row => row.id))
      .toEqual(['a']);
  });

  it('filters selected genders and treats missing gender as 未识别', () => {
    expect(filterResumesByDemographics(resumes, { minAge: null, maxAge: null, genders: ['女', '未识别'] }).map(row => row.id))
      .toEqual(['a', 'c']);
  });

  it('filters AI scores by the displayed total dimension score', () => {
    const scoredResumes = [
      { id: 'a', ai_evaluation: { dimensions: [{ name: '沟通', score: 4 }, { name: '业务', score: 3 }] } },
      { id: 'b', ai_evaluation: { dimensions: [{ name: '沟通', score: 5 }, { name: '业务', score: 5 }] } },
      { id: 'c', ai_evaluation: null },
    ];

    expect(filterResumesByMinimumDimensionScore(scoredResumes, 8).map(row => row.id)).toEqual(['b']);
  });
});
