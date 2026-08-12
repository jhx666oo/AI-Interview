import { describe, expect, it } from 'vitest';
import { buildInterviewerOptions } from './interviewerOptions';

describe('buildInterviewerOptions', () => {
  it('keeps existing and default interviewer values alongside directory options', () => {
    const options = buildInterviewerOptions(
      [
        { id: '1', full_name: '张三', email: 'zhang@example.com' },
        { id: '2', full_name: '李四', email: 'li@example.com' },
      ],
      ['历史面试官'],
      '杜雁玲',
    );

    expect(options.map((option) => option.value)).toEqual([
      '杜雁玲',
      '历史面试官',
      '张三',
      '李四',
    ]);
    expect(options[0]).toMatchObject({ value: '杜雁玲', historical: true });
    expect(options[1]).toMatchObject({ value: '历史面试官', historical: true });
    expect(options[2]).toMatchObject({ value: '张三', label: '张三 (zhang@example.com)' });
    expect(options[3]).toMatchObject({ value: '李四', label: '李四 (li@example.com)' });
  });

  it('deduplicates repeated names and ignores blank values', () => {
    const options = buildInterviewerOptions(
      [
        { id: '1', full_name: '张三', email: 'zhang@example.com' },
        { id: '2', full_name: '张三', email: 'duplicate@example.com' },
        { id: '3', full_name: '', email: 'blank@example.com' },
      ],
      ['张三', ' '],
      '张三',
    );

    expect(options).toEqual([
      { value: '张三', label: '张三 (zhang@example.com)', historical: false },
    ]);
  });
});
