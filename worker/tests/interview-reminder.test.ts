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
});
