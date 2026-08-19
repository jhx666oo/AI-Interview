import { describe, expect, it } from 'vitest';
import { createInterviewCalendarEvent } from '../src/interview-start/feishu-calendar';

/**
 * 飞书日历日程创建测试：
 * 用注入的 fetch 模拟飞书 API，覆盖：创建日程（vchat vc / 时间戳）、
 * 创建响应缺会议链接时读详情兜底、参与人添加失败不阻塞、API 报错。
 */

interface FetchCall {
  url: string;
  method: string;
  body: any;
}

function makeFeishuFetch(handler: (call: FetchCall) => any) {
  const calls: FetchCall[] = [];
  const fetchImpl = (async (url: any, init: any = {}) => {
    const call: FetchCall = { url: String(url), method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null };
    calls.push(call);
    const payload = handler(call);
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const TOKEN = 'tenant-token-x';
const getTenantToken = async () => TOKEN;

function feishuOk(data: any) {
  return { code: 0, msg: 'success', data };
}

describe('createInterviewCalendarEvent', () => {
  it('创建带视频会议的日程并返回会议链接', async () => {
    const { fetchImpl, calls } = makeFeishuFetch((call) => {
      if (call.url.includes('/attendees')) return feishuOk({ attendee_ids: ['ou_a'] });
      return feishuOk({ event: { event_id: 'evt-1', vchat: { vc_type: 'vc', meeting_url: 'https://vc.feishu.cn/j/abc123' } } });
    });

    const result = await createInterviewCalendarEvent({} as any, {
      summary: '面试 - 张三 - 前端工程师',
      description: '测试描述',
      startTimestamp: 1771605600,
      endTimestamp: 1771609200,
      attendeeOpenIds: ['ou_a', 'ou_a', ''],
    }, { fetchImpl, getTenantToken });

    expect(result.eventId).toBe('evt-1');
    expect(result.meetingUrl).toBe('https://vc.feishu.cn/j/abc123');
    expect(result.attendeeErrors).toEqual([]);

    const create = calls[0];
    expect(create.url).toContain('/calendar/v4/calendars/primary/events');
    expect(create.method).toBe('POST');
    expect(create.body.vchat).toEqual({ vc_type: 'vc' });
    expect(create.body.start_time).toEqual({ timestamp: '1771605600', timezone: 'Asia/Shanghai' });
    expect(create.body.end_time.timestamp).toBe('1771609200');
    expect(create.body.summary).toBe('面试 - 张三 - 前端工程师');
    expect((create.body as any).Authorization).toBeUndefined();

    // 参与人：去重去空后仅 ou_a，一次调用
    const attendeeCall = calls.find((c) => c.url.includes('/attendees'));
    expect(attendeeCall).toBeTruthy();
    expect(attendeeCall!.body.attendees).toEqual([{ type: 'user', user_id: 'ou_a' }]);
    expect(attendeeCall!.body.need_notification).toBe(true);
  });

  it('创建响应缺会议链接时读取日程详情兜底', async () => {
    const { fetchImpl, calls } = makeFeishuFetch((call) => {
      if (call.url.includes('/events/evt-2') && call.method === 'GET') {
        return feishuOk({ event: { event_id: 'evt-2', vchat: { vc_type: 'vc', meeting_url: 'https://vc.feishu.cn/j/late' } } });
      }
      if (call.url.includes('/attendees')) return feishuOk({});
      return feishuOk({ event: { event_id: 'evt-2' } });
    });

    const result = await createInterviewCalendarEvent({} as any, {
      summary: '面试', description: '', startTimestamp: 1, endTimestamp: 2,
    }, { fetchImpl, getTenantToken });

    expect(result.meetingUrl).toBe('https://vc.feishu.cn/j/late');
    expect(calls.some((c) => c.method === 'GET' && c.url.includes('/events/evt-2'))).toBe(true);
  });

  it('参与人添加失败仅记录告警不阻塞', async () => {
    const { fetchImpl } = makeFeishuFetch((call) => {
      if (call.url.includes('/attendees')) return { code: 190007, msg: 'bot ability disabled' };
      return feishuOk({ event: { event_id: 'evt-3', vchat: { meeting_url: 'https://vc.feishu.cn/j/x' } } });
    });

    const result = await createInterviewCalendarEvent({} as any, {
      summary: '面试', description: '', startTimestamp: 1, endTimestamp: 2, attendeeOpenIds: ['ou_b'],
    }, { fetchImpl, getTenantToken });

    expect(result.meetingUrl).toBe('https://vc.feishu.cn/j/x');
    expect(result.attendeeErrors.length).toBe(1);
    expect(result.attendeeErrors[0]).toContain('190007');
  });

  it('飞书 API 报错时抛出含错误码的异常', async () => {
    const { fetchImpl } = makeFeishuFetch(() => ({ code: 20004, msg: 'no permission' }));
    await expect(createInterviewCalendarEvent({} as any, {
      summary: '面试', description: '', startTimestamp: 1, endTimestamp: 2,
    }, { fetchImpl, getTenantToken })).rejects.toThrow(/20004/);
  });

  it('创建成功但无 event_id 时报错', async () => {
    const { fetchImpl } = makeFeishuFetch(() => feishuOk({ event: {} }));
    await expect(createInterviewCalendarEvent({} as any, {
      summary: '面试', description: '', startTimestamp: 1, endTimestamp: 2,
    }, { fetchImpl, getTenantToken })).rejects.toThrow(/event_id/);
  });
});
