import { describe, expect, it } from 'vitest';
import { buildResumeExportRows } from './resumeExport';

describe('resume Excel export', () => {
  it('uses screening_result and weighted_score on the five-point scale', () => {
    const [row] = buildResumeExportRows([{
      candidate_name: '张三',
      match_score: 3,
      weighted_score: 4.2,
      screening_result: '通过',
      screening_reason: '五项能力加权分达到 4 分',
      parsed_data: '{"name":"张三"}',
    }]);

    expect(row['AI 分析结果']).toBe('通过');
    expect(row['AI 加权分']).toBe('4.2/5');
    expect(row['AI 初筛原因']).toBe('五项能力加权分达到 4 分');
  });

  it('does not infer a decision from the legacy score', () => {
    const [row] = buildResumeExportRows([{ candidate_name: '李四', match_score: 99 }]);
    expect(row['AI 分析结果']).toBe('待初筛');
  });
});
