import { describe, expect, it } from 'vitest';
import {
  filterFreeRooms,
  findAvailableMeetingRooms,
  listMeetingRooms,
  pickD5Rooms,
  queryRoomAvailability,
  type MeetingRoomInfo,
} from '../src/interview-start/meeting-rooms';

/**
 * 空闲会议室查询测试：
 * D5 栋筛选优先、忙闲过滤、会议室列表分页、忙闲 API 调用、无 D5 时回退全部。
 */

const TOKEN = 'tenant-token';

function makeRoom(room_id: string, name: string, path = '', capacity: number | null = 10): MeetingRoomInfo {
  return { room_id, name, path, description: '', capacity };
}

function makeFetch(routes: Record<string, (call: any) => any>) {
  const calls: any[] = [];
  const fetchImpl = (async (url: any, init: any = {}) => {
    const u = String(url);
    calls.push({ url: u, init });
    for (const [key, handler] of Object.entries(routes)) {
      if (u.includes(key)) {
        return new Response(JSON.stringify(handler(calls[calls.length - 1])), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
    }
    throw new Error('unexpected url: ' + u);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const feishuOk = (data: any) => ({ code: 0, msg: 'success', data });

describe('pickD5Rooms / filterFreeRooms', () => {
  it('按名称/path/description 筛选 D5 栋', () => {
    const rooms = [
      makeRoom('r1', 'D5栋·3F·会议室A', 'D5栋/3F'),
      makeRoom('r2', 'D3栋·2F·会议室B', 'D3栋/2F'),
      makeRoom('r3', '会议室C', 'D5栋/4F'),
    ];
    const d5 = pickD5Rooms(rooms);
    expect(d5.map((r) => r.room_id)).toEqual(['r1', 'r3']);
  });

  it('busy 为空/不存在即空闲，有忙碌日程则排除', () => {
    const rooms = [makeRoom('r1', 'A'), makeRoom('r2', 'B'), makeRoom('r3', 'C')];
    const busyMap: Record<string, any[]> = { r2: [{ start_time: 'x', end_time: 'y' }] };
    expect(filterFreeRooms(rooms, busyMap).map((r) => r.room_id)).toEqual(['r1', 'r3']);
    expect(filterFreeRooms(rooms, {}).map((r) => r.room_id)).toEqual(['r1', 'r2', 'r3']);
  });
});

describe('listMeetingRooms', () => {
  it('分页拉取全部会议室', async () => {
    const { fetchImpl, calls } = makeFetch({
      '/vc/v1/rooms': (call: any) => {
        if (call.url.includes('page_token=next')) {
          return feishuOk({ rooms: [makeRoom('r3', 'Room3')], page_token: '' });
        }
        return feishuOk({ rooms: [makeRoom('r1', 'Room1'), makeRoom('r2', 'Room2')], page_token: 'next' });
      },
    });
    const rooms = await listMeetingRooms(TOKEN, { fetchImpl });
    expect(rooms.map((r) => r.room_id)).toEqual(['r1', 'r2', 'r3']);
    expect(calls.length).toBe(2);
    expect(calls[1].url).toContain('page_token=next');
  });
});

describe('queryRoomAvailability', () => {
  it('room_ids 复数参数与 RFC3339 时间', async () => {
    const { fetchImpl, calls } = makeFetch({
      '/meeting_room/freebusy/batch_get': () => feishuOk({ free_busy: { r1: [{ start_time: 'x' }] } }),
    });
    const busy = await queryRoomAvailability(TOKEN, ['r1', 'r2'], Date.parse('2026-08-25T01:30:00Z'), Date.parse('2026-08-25T02:30:00Z'), { fetchImpl });
    expect(busy.r1.length).toBe(1);
    const url = calls[0].url;
    expect(url).toContain('room_ids=r1');
    expect(url).toContain('room_ids=r2');
    expect(url).toContain('time_min=2026-08-25T09%3A30%3A00%2B08%3A00'); // 北京 09:30
    expect(url).toContain('time_max=2026-08-25T10%3A30%3A00%2B08%3A00');
  });
});

describe('findAvailableMeetingRooms', () => {
  it('D5 栋优先且只返回空闲会议室', async () => {
    const { fetchImpl } = makeFetch({
      '/vc/v1/rooms': () => feishuOk({
        rooms: [
          makeRoom('d5-1', 'D5栋·3F·会议室A', 'D5栋/3F'),
          makeRoom('d5-2', 'D5栋·4F·会议室B', 'D5栋/4F'),
          makeRoom('d3-1', 'D3栋·2F·会议室C', 'D3栋/2F'),
        ],
        page_token: '',
      }),
      '/meeting_room/freebusy/batch_get': () => feishuOk({ free_busy: { 'd5-1': [{ start_time: 'x', end_time: 'y' }] } }),
    });
    const result = await findAvailableMeetingRooms({
      token: TOKEN,
      startTs: Date.parse('2026-08-25T01:30:00Z'),
      endTs: Date.parse('2026-08-25T02:30:00Z'),
    }, { fetchImpl });
    expect(result.has_d5).toBe(true);
    // d5-1 忙被排除，d5-2 空闲；非 D5 的 d3-1 不参与（有 D5 时）
    expect(result.rooms.map((r) => r.room_id)).toEqual(['d5-2']);
  });

  it('无 D5 会议室时回退全部会议室', async () => {
    const { fetchImpl } = makeFetch({
      '/vc/v1/rooms': () => feishuOk({ rooms: [makeRoom('a1', '会议室A', 'D3栋'), makeRoom('a2', '会议室B', 'D3栋')], page_token: '' }),
      '/meeting_room/freebusy/batch_get': () => feishuOk({ free_busy: {} }),
    });
    const result = await findAvailableMeetingRooms({
      token: TOKEN, startTs: 1, endTs: 2,
    }, { fetchImpl });
    expect(result.has_d5).toBe(false);
    expect(result.rooms.map((r) => r.room_id)).toEqual(['a1', 'a2']);
  });

  it('飞书报错时抛错（由端点降级为 reason）', async () => {
    const { fetchImpl } = makeFetch({
      '/vc/v1/rooms': () => ({ code: 99991672, msg: 'no permission' }),
    });
    await expect(findAvailableMeetingRooms({ token: TOKEN, startTs: 1, endTs: 2 }, { fetchImpl })).rejects.toThrow(/99991672/);
  });
});
