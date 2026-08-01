import { describe, expect, it } from 'vitest';
import { normalizeResumeFields } from '../src/resume-processing/fields';

describe('normalizeResumeFields', () => {
  it('converts legacy Chinese AI field keys into the canonical resume schema', () => {
    expect(normalizeResumeFields({
      姓名: '马悦萱',
      电话: '18258419437',
      学历: '研究生（25届）',
      学校: '浙江传媒学院',
      专业: '媒介经营管理（研究生）',
      工作年限: '2年内',
      性别: '女',
      出生年月: '2002-05',
      技能: ['数据分析'],
    })).toMatchObject({
      name: '马悦萱',
      phone: '18258419437',
      highest_degree: '研究生（25届）',
      school: '浙江传媒学院',
      major: '媒介经营管理（研究生）',
      years_of_experience: '2年内',
      gender: '女',
      birthday: '2002-05',
      skills: ['数据分析'],
    });
  });

  it('preserves canonical fields and does not replace a known value with an empty alias', () => {
    expect(normalizeResumeFields({
      school: 'A大学',
      学校: '',
      skills: ['沟通'],
      技能: [],
    })).toMatchObject({ school: 'A大学', skills: ['沟通'] });
  });
});
