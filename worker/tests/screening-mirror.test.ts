import { describe, expect, it } from 'vitest';
import { buildFeishuScreeningMirror } from '../src/resume-processing/screening-mirror';

describe('Feishu weighted screening mirror', () => {
  it('uses the backend weighted score, binary result, and reason', () => {
    const mirror = buildFeishuScreeningMirror({
      summary: '岗位匹配度良好',
      weighted_score: 4.2,
      screening_result: '通过',
      screening_reason: '五项能力加权分达到 4 分',
      recommendation: 'strongly_not_recommend',
      match_score: 99,
    });

    expect(mirror['AI简历评估']).toContain('加权分数: 4.2/5');
    expect(mirror['AI简历评估']).toContain('初筛结果: 通过');
    expect(mirror['AI简历评估']).toContain('初筛原因: 五项能力加权分达到 4 分');
    expect(mirror['AI简历评估']).not.toContain('/100');
    expect(mirror['AI简历初筛结果']).toBe('通过');
  });
});
