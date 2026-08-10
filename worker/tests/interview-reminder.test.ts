import { describe, expect, it } from 'vitest';
import {
  buildInterviewReminderCard,
  buildInterviewReminderView,
  deliverInterviewReminder,
} from '../src/feishu-notifications/interview-reminder';

const completeView = {
  name: '张三', education: '本科', age: 29, gender: '女', position: '社区运营',
  interviewTime: '2026-08-11 10:00', city: '北京', aiAdvice: '建议核实稳定性',
};

const deliveryInput = {
  userToken: 'user-token', resourceToken: 'tenant-token', receiverOpenId: 'ou_receiver',
  view: completeView, operatorName: '金皓翔',
  file: { bytes: new Uint8Array([1, 2, 3]), fileName: '张三.pdf' },
};

describe('interview reminders', () => {
  it('uploads PDF before sending the card and file from the current user', async () => {
    const calls: string[] = [];
    const authorizations: Array<string | null> = [];
    const contentTypes: Array<string | null> = [];

    const result = await deliverInterviewReminder(deliveryInput, {
      fetch: async (url, init) => {
        const isUpload = String(url).includes('/files');
        calls.push(isUpload ? 'upload' : JSON.parse(String(init?.body)).msg_type);
        authorizations.push(new Headers(init?.headers).get('Authorization'));
        contentTypes.push(new Headers(init?.headers).get('Content-Type'));
        return Response.json(isUpload
          ? { code: 0, data: { file_key: 'file-key' } }
          : { code: 0, data: { message_id: 'message-id' } });
      },
    });

    expect(calls).toEqual(['upload', 'interactive', 'file']);
    expect(authorizations).toEqual(['Bearer tenant-token', 'Bearer user-token', 'Bearer user-token']);
    expect(contentTypes).toEqual([null, 'application/json; charset=utf-8', 'application/json; charset=utf-8']);
    expect(result).toMatchObject({ cardSent: true, fileSent: true, warning: null });
  });

  it('rejects delivery without a current-user token', async () => {
    await expect(deliverInterviewReminder({ ...deliveryInput, userToken: '' }, {
      fetch: async () => Response.json({ code: 0 }),
    })).rejects.toMatchObject({ code: 'FEISHU_AUTH_REQUIRED' });
  });

  it('still sends a card when PDF upload fails', async () => {
    const messageTypes: string[] = [];
    const result = await deliverInterviewReminder(deliveryInput, {
      fetch: async (url, init) => {
        if (String(url).includes('/files')) return Response.json({ code: 999, msg: 'upload failed' });
        messageTypes.push(JSON.parse(String(init?.body)).msg_type);
        return Response.json({ code: 0, data: { message_id: 'message-id' } });
      },
    });

    expect(messageTypes).toEqual(['interactive']);
    expect(result).toMatchObject({ cardSent: true, fileSent: false });
    expect(result.warning).toContain('PDF');
  });

  it('rejects an over-limit streaming Feishu response before consuming its full body', async () => {
    let pulls = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls === 1) controller.enqueue(new Uint8Array(512 * 1024));
        else if (pulls === 2) controller.enqueue(new Uint8Array(600 * 1024));
        else controller.close();
      },
      cancel() {
        cancelled = true;
      },
    }, { highWaterMark: 0 });

    const result = await deliverInterviewReminder(deliveryInput, {
      fetch: async (url) => String(url).includes('/files')
        ? new Response(stream, { headers: { 'content-type': 'application/json' } })
        : Response.json({ code: 0, data: { message_id: 'message-id' } }),
    });

    expect(result).toMatchObject({ cardSent: true, fileSent: false });
    expect(pulls).toBe(2);
    expect(cancelled).toBe(true);
  });

  it.each([
    ['empty', new Uint8Array()],
    ['oversized', new Uint8Array(30 * 1024 * 1024 + 1)],
  ])('rejects a %s PDF before any network I/O', async (_label, bytes) => {
    let fetchCalls = 0;

    await expect(deliverInterviewReminder({
      ...deliveryInput,
      file: { bytes, fileName: 'resume.pdf' },
    }, {
      fetch: async () => {
        fetchCalls += 1;
        return Response.json({ code: 0 });
      },
    })).rejects.toMatchObject({ code: 'FEISHU_INVALID_PDF' });

    expect(fetchCalls).toBe(0);
  });

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
