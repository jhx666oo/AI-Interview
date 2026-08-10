import { describe, expect, it } from 'vitest';
import { buildInterviewReminderCard, buildInterviewReminderView } from '../src/feishu-notifications/interview-reminder';

describe('interview reminders', () => {
  it('normalizes all seven fields from authoritative resume data', () => {
    const view = buildInterviewReminderView({
      interview: { candidate_name: '候选人', position_applied: '旧岗位', interview_time: '2026-08-11T02:00:00.000Z' },
      resume: {
        candidate_name: '张三', mapped_position: '社区运营', gender: '', education: '', birthday: '1996-08-11',
        parsed_data: JSON.stringify({ highest_degree: '本科', gender: '女', city: '北京' }),
        ai_evaluation: JSON.stringify({ summary: '匹配岗位', risk_points: ['稳定性待核实'], interview_questions: ['请说明离职原因'] }),
      },
    }, new Date('2026-08-10T00:00:00.000Z'));

    expect(view).toMatchObject({ name: '张三', education: '本科', age: 29, gender: '女', position: '社区运营', city: '北京' });
    expect(view.aiAdvice).toContain('稳定性待核实');
  });

  it('renders attachment availability and never exposes raw JSON', () => {
    const card = buildInterviewReminderCard({
      name: '张三', education: '本科', age: 29, gender: '女', position: '社区运营',
      interviewTime: '2026-08-11 10:00', city: '北京', aiAdvice: '建议核实稳定性',
    }, { operatorName: '金皓翔', attachmentAvailable: true });
    const serialized = JSON.stringify(card);
    expect(serialized).toContain('简历 PDF 将在下一条消息发送');
    expect(serialized).toContain('学历');
    expect(serialized).not.toContain('risk_points');
  });

  it('keeps timezone-less D1 interview time as Shanghai local time', () => {
    const view = buildInterviewReminderView({
      interview: { interview_time: '2026-08-11 10:15:30' },
    });

    expect(view.interviewTime).toBe('2026-08-11 10:15');
  });

  it('converts explicit UTC interview timestamps to Shanghai time', () => {
    const view = buildInterviewReminderView({
      interview: { interview_time: '2026-08-11T02:15:00.000Z' },
    });

    expect(view.interviewTime).toBe('2026-08-11 10:15');
  });

  it('shows an empty value for invalid interview times', () => {
    const view = buildInterviewReminderView({
      interview: { interview_time: 'not-a-date' },
    });

    expect(view.interviewTime).toBe('未填写');
  });

  it('combines current AI risk and question fields from object input', () => {
    const view = buildInterviewReminderView({
      resume: {
        ai_evaluation: {
          summary: '整体匹配',
          risks: '稳定性需核实',
          risk_points: ['薪资预期待确认'],
          suggested_questions: ['请说明职业规划'],
          interview_questions: '请说明离职原因',
        },
      },
    });

    expect(view.aiAdvice).toContain('稳定性需核实');
    expect(view.aiAdvice).toContain('薪资预期待确认');
    expect(view.aiAdvice).toContain('请说明职业规划');
    expect(view.aiAdvice).toContain('请说明离职原因');
  });

  it('normalizes string and array AI fields from JSON input within the advice limit', () => {
    const view = buildInterviewReminderView({
      resume: {
        ai_evaluation: JSON.stringify({
          risk: ['风险一', '风险二'],
          suggested_questions: '请描述一次冲突处理',
          interview_questions: ['请介绍过往项目'],
          risk_points: '补充风险',
        }),
      },
    });

    expect(view.aiAdvice).toContain('风险一');
    expect(view.aiAdvice).toContain('补充风险');
    expect(view.aiAdvice).toContain('请描述一次冲突处理');
    expect(view.aiAdvice).toContain('请介绍过往项目');
    expect(view.aiAdvice.length).toBeLessThanOrEqual(500);
  });
});
