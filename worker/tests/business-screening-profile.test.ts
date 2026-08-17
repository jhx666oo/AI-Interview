import { describe, expect, it } from 'vitest';
import { buildPublicProfile } from '../src/business-screening/routes';

describe('buildPublicProfile', () => {
  it('maps parsed_data into the public structured profile', () => {
    const profile = buildPublicProfile(JSON.stringify({
      highest_degree: '本科',
      school: '北京邮电大学',
      major: '软件工程',
      years_of_experience: 5,
      recent_company: '某科技公司',
      current_position: '高级产品经理',
      gender: '男',
      birthday: '1995-06',
      skills: ['产品规划', 'AI Agent'],
      certifications: ['PMP'],
      self_evaluation: '逻辑清晰，善于跨部门协同。',
      work_experience: [
        { company: '甲公司', title: '产品经理', start: '2020', end: '2024', description: '负责智能硬件产品线' },
      ],
      education: [
        { school: '北京邮电大学', degree: '本科', major: '软件工程', start: '2013', end: '2017' },
      ],
      phone: '13800000000',
      email: 'candidate@example.com',
    }));

    expect(profile).toEqual({
      highestDegree: '本科',
      school: '北京邮电大学',
      major: '软件工程',
      yearsOfExperience: '5',
      recentCompany: '某科技公司',
      currentTitle: '高级产品经理',
      gender: '男',
      birthday: '1995-06',
      skills: ['产品规划', 'AI Agent'],
      certifications: ['PMP'],
      selfEvaluation: '逻辑清晰，善于跨部门协同。',
      workExperience: [
        { company: '甲公司', title: '产品经理', duration: undefined, start: '2020', end: '2024', description: '负责智能硬件产品线' },
      ],
      educationHistory: [
        { school: '北京邮电大学', degree: '本科', major: '软件工程', start: '2013', end: '2017' },
      ],
    });
  });

  it('never exposes contact fields or resume raw text in the profile', () => {
    const profile = buildPublicProfile(JSON.stringify({
      highest_degree: '本科',
      phone: '13800000000',
      email: 'candidate@example.com',
      contact: '13800000000',
      raw_text: '这是一段简历原文，不应出现在公开档案里',
      work_experience: [],
    }));

    expect(profile).not.toHaveProperty('phone');
    expect(profile).not.toHaveProperty('email');
    expect(profile).not.toHaveProperty('contact');
    expect(profile).not.toHaveProperty('raw_text');
    expect(JSON.stringify(profile)).not.toContain('13800000000');
    expect(JSON.stringify(profile)).not.toContain('candidate@example.com');
    expect(JSON.stringify(profile)).not.toContain('简历原文');
  });

  it('returns undefined for missing or malformed parsed_data', () => {
    expect(buildPublicProfile(undefined)).toBeUndefined();
    expect(buildPublicProfile(null)).toBeUndefined();
    expect(buildPublicProfile('not-json')).toBeUndefined();
    expect(buildPublicProfile('{}')).toBeUndefined();
    expect(buildPublicProfile(JSON.stringify({ unknown_field: 'x' }))).toBeUndefined();
  });

  it('accepts an already-parsed object and tolerates partial history entries', () => {
    const profile = buildPublicProfile({
      highest_degree: '硕士',
      work_experience: [
        { company: '乙公司' },
        'not-an-object',
        null,
      ],
      education: [],
    });

    expect(profile?.highestDegree).toBe('硕士');
    expect(profile?.workExperience).toEqual([{ company: '乙公司' }]);
    expect(profile?.educationHistory).toBeUndefined();
  });

  it('handles skills stored as a plain string', () => {
    const profile = buildPublicProfile(JSON.stringify({
      highest_degree: '本科',
      skills: 'React, TypeScript',
    }));

    expect(profile?.skills).toEqual(['React, TypeScript']);
  });
});
