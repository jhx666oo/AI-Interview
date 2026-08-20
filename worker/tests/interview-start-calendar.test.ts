import { describe, expect, it } from 'vitest';
import { createInterviewCalendarEvent, findFirstFreeInterviewSlot, buildBeijingInterviewWindows } from '../src/interview-start/feishu-calendar';

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

describe('buildBeijingInterviewWindows', () => {
  // 2026-08-20 为星期四；北京时间 = UTC+8
  const B = (h: number, m = 0) => Math.floor(Date.UTC(2026, 7, 20, h - 8, m) / 1000);

  it('上午 10:00 → 剩余上午 + 下午两个窗口', () => {
    const windows = buildBeijingInterviewWindows(B(10, 0));
    expect(windows).toHaveLength(2);
    expect(windows[0].start).toBe(B(10, 0));   // 从当前时刻起
    expect(windows[0].end).toBe(B(11, 30));    // 上午截止 11:30
    expect(windows[1].start).toBe(B(13, 30));  // 下午 13:30 起
    expect(windows[1].end).toBe(B(18, 30));    // 18:30 结束
  });

  it('午休 12:00 → 只剩下午窗口', () => {
    const windows = buildBeijingInterviewWindows(B(12, 0));
    expect(windows).toHaveLength(1);
    expect(windows[0].start).toBe(B(13, 30));
    expect(windows[0].end).toBe(B(18, 30));
  });

  it('下班后 19:00 → 无窗口', () => {
    expect(buildBeijingInterviewWindows(B(19, 0))).toHaveLength(0);
  });

  it('早上 9:00（上班前）→ 上午从 9:30 起', () => {
    const windows = buildBeijingInterviewWindows(B(9, 0));
    expect(windows[0].start).toBe(B(9, 30));
  });
});

describe('findFirstFreeInterviewSlot', () => {
  const B = (h: number, m = 0) => Math.floor(Date.UTC(2026, 7, 20, h - 8, m) / 1000);
  const TOKEN = 'tenant-token-freebusy';

  function busyFetch(busyItems: Array<{ s: number; e: number }>) {
    return (async (url: any, init: any = {}) => {
      expect(String(url)).toContain('/calendar/v4/freebusy/list');
      expect(init.method).toBe('POST');
      const body = JSON.parse(init.body);
      expect(body.user_ids).toEqual(['ou_interviewer']);
      const items = busyItems.map((b) => ({
        start: { timestamp: String(b.s), timezone: 'Asia/Shanghai' },
        end: { timestamp: String(b.e), timezone: 'Asia/Shanghai' },
      }));
      return new Response(JSON.stringify({ code: 0, msg: 'success', data: { freebusy_list: [{ user_id: 'ou_interviewer', busy_items: items }] } }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;
  }

  it('上午 10:00 开始，全天无忙碌 → 10:00 即可面试', async () => {
    const slot = await findFirstFreeInterviewSlot({ token: TOKEN, openId: 'ou_interviewer', fromTs: B(10, 0), durationMinutes: 60 }, { fetchImpl: busyFetch([]) });
    expect(slot).toBe(B(10, 0));
  });

  it('上午 10:00-11:00 忙碌 → 上午剩余不足 1 小时，顺延到下午 13:30', async () => {
    const slot = await findFirstFreeInterviewSlot({ token: TOKEN, openId: 'ou_interviewer', fromTs: B(10, 0), durationMinutes: 60 }, {
      fetchImpl: busyFetch([{ s: B(10, 0), e: B(11, 0) }]),
    });
    expect(slot).toBe(B(13, 30));
  });

  it('下午 14:00-16:30 忙碌 → 第一个空档在 16:30', async () => {
    const slot = await findFirstFreeInterviewSlot({ token: TOKEN, openId: 'ou_interviewer', fromTs: B(13, 30), durationMinutes: 60 }, {
      fetchImpl: busyFetch([{ s: B(14, 0), e: B(16, 30) }]),
    });
    expect(slot).toBe(B(16, 30));
  });

  it('全天（9:30-18:30）忙碌 → 找不到返回 null', async () => {
    const slot = await findFirstFreeInterviewSlot({ token: TOKEN, openId: 'ou_interviewer', fromTs: B(9, 30), durationMinutes: 60 }, {
      fetchImpl: busyFetch([{ s: B(9, 0), e: B(19, 0) }]),
    });
    expect(slot).toBeNull();
  });

  it('freebusy 接口报错 → 返回 null（调用方回退原定时间）', async () => {
    const failFetch = (async () => new Response(JSON.stringify({ code: 99991662, msg: 'permission denied' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })) as unknown as typeof fetch;
    const slot = await findFirstFreeInterviewSlot({ token: TOKEN, openId: 'ou_interviewer', fromTs: B(10, 0), durationMinutes: 60 }, { fetchImpl: failFetch });
    expect(slot).toBeNull();
  });
});
