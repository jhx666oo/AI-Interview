import { describe, expect, it } from 'vitest';
import {
  buildingOf,
  filterFreeRooms,
  findAvailableMeetingRooms,
  listMeetingRooms,
  pickPriorityRooms,
  queryRoomAvailability,
  type MeetingRoomInfo,
} from '../src/interview-start/meeting-rooms';

/**
 * 空闲会议室查询测试：
 * C5/D1 优先筛选、忙闲过滤、会议室列表分页、忙闲 API 调用、无优先楼栋时回退全部。
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

describe('pickPriorityRooms / buildingOf / filterFreeRooms', () => {
  it('按名称/path/description 筛选 C5、D1 栋会议室', () => {
    const rooms = [
      makeRoom('r1', 'C5栋·3F·会议室A', 'C5栋/3F'),
      makeRoom('r2', 'D1栋·2F·会议室B', 'D1栋/2F'),
      makeRoom('r3', '会议室C', 'C5栋/4F'),
      makeRoom('r4', '会议室D', 'D3栋/4F'),
    ];
    const priority = pickPriorityRooms(rooms);
    expect(priority.map((r) => r.room_id)).toEqual(['r1', 'r2', 'r3']);
  });

  it('buildingOf 返回命中的优先楼栋标识', () => {
    expect(buildingOf(makeRoom('r1', 'C5栋·3F·会议室A'))).toBe('C5');
    expect(buildingOf(makeRoom('r2', 'D1栋·2F·会议室B'))).toBe('D1');
    expect(buildingOf(makeRoom('r3', 'D3栋·4F·会议室C'))).toBe('');
  });

  it('busy 为空/不存在即空闲，有忙碌日程则排除', () => {
    const rooms = [makeRoom('r1', 'A'), makeRoom('r2', 'B'), makeRoom('r3', 'C')];
    const busyMap: Record<string, any[]> = { r2: [{ start_time: 'x', end_time: 'y' }] };
    expect(filterFreeRooms(rooms, busyMap).map((r) => r.room_id)).toEqual(['r1', 'r3']);
    expect(filterFreeRooms(rooms, {}).map((r) => r.room_id)).toEqual(['r1', 'r2', 'r3']);
  });
});

describe('listMeetingRooms', () => {
  const cityLevel = (id = 'city1', name = '长沙') => ({ room_level_id: id, name, parent_id: 'root' });

  it('按城市层级分页拉取全部会议室', async () => {
    const { fetchImpl, calls } = makeFetch({
      '/vc/v1/room_levels': () => feishuOk({ items: [cityLevel()], page_token: '' }),
      '/vc/v1/rooms': (call: any) => {
        if (call.url.includes('page_token=next')) {
          return feishuOk({ rooms: [makeRoom('r3', 'Room3')], page_token: '' });
        }
        return feishuOk({ rooms: [makeRoom('r1', 'Room1'), makeRoom('r2', 'Room2')], page_token: 'next' });
      },
    });
    const rooms = await listMeetingRooms(TOKEN, { fetchImpl });
    expect(rooms.map((r) => r.room_id)).toEqual(['r1', 'r2', 'r3']);
    expect(calls.length).toBe(3); // 1 次 room_levels + 2 次 rooms 分页
    expect(calls[0].url).toContain('/vc/v1/room_levels');
    expect(calls[1].url).toContain('/vc/v1/rooms');
    expect(calls[1].url).toContain('room_level_id=city1');
    expect(calls[2].url).toContain('page_token=next');
  });

  it('空页但游标仍推进时立即终止（防死循环打到 subrequest 上限）', async () => {
    const { fetchImpl, calls } = makeFetch({
      '/vc/v1/room_levels': () => feishuOk({ items: [cityLevel()], page_token: '' }),
      '/vc/v1/rooms': () => feishuOk({ rooms: [], page_token: 'still-more' }),
    });
    const rooms = await listMeetingRooms(TOKEN, { fetchImpl });
    expect(rooms.length).toBe(0);
    // room_levels + 第一页 rooms 就发现空页 + 非空游标 → 只发 2 次请求就终止
    expect(calls.length).toBe(2);
  });

  it('兼容 items 字段的响应', async () => {
    const { fetchImpl } = makeFetch({
      '/vc/v1/room_levels': () => feishuOk({ items: [cityLevel()], page_token: '' }),
      '/vc/v1/rooms': () => feishuOk({ items: [makeRoom('i1', 'Room1')], page_token: '' }),
    });
    const rooms = await listMeetingRooms(TOKEN, { fetchImpl });
    expect(rooms.map((r) => r.room_id)).toEqual(['i1']);
  });

  it('path 为 ID 数组时转字符串存储并解析城市名', async () => {
    const { fetchImpl } = makeFetch({
      '/vc/v1/room_levels': () => feishuOk({ items: [cityLevel('omb_city', '长沙市')], page_token: '' }),
      '/vc/v1/rooms': () => feishuOk({ rooms: [{ room_id: 'r1', name: 'A', path: ['omb_city', 'omb_y'] }], page_token: '' }),
    });
    const rooms = await listMeetingRooms(TOKEN, { fetchImpl });
    expect(rooms[0].path).toBe('omb_city/omb_y');
    expect(rooms[0].level_name).toBe('长沙市');
  });

  it('多个城市逐城市拉取，单城市失败不阻塞其他城市', async () => {
    const { fetchImpl, calls } = makeFetch({
      '/vc/v1/room_levels': () => feishuOk({ items: [cityLevel('c1', '长沙'), cityLevel('c2', '深圳')], page_token: '' }),
      '/vc/v1/rooms': (call: any) => {
        if (call.url.includes('room_level_id=c1')) {
          return feishuOk({ rooms: [makeRoom('r1', '长沙房')], page_token: '' });
        }
        // c2（深圳）接口失败 → 跳过
        return { code: 99991672, msg: 'no permission' };
      },
    });
    const rooms = await listMeetingRooms(TOKEN, { fetchImpl });
    expect(rooms.map((r) => r.room_id)).toEqual(['r1']);
    expect(rooms[0].level_name).toBe('长沙');
    expect(calls.filter((c) => c.url.includes('/vc/v1/rooms')).length).toBe(2);
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
  const cityLevel = (id = 'city1', name = '长沙') => ({ room_level_id: id, name, parent_id: 'root' });

  it('C5/D1 优先且只返回空闲会议室（带楼栋标签）', async () => {
    const { fetchImpl } = makeFetch({
      '/vc/v1/room_levels': () => feishuOk({ items: [cityLevel()], page_token: '' }),
      '/vc/v1/rooms': () => feishuOk({
        rooms: [
          makeRoom('c5-1', 'C5栋·3F·会议室A', 'C5栋/3F'),
          makeRoom('d1-1', 'D1栋·4F·会议室B', 'D1栋/4F'),
          makeRoom('d3-1', 'D3栋·2F·会议室C', 'D3栋/2F'),
        ],
        page_token: '',
      }),
      '/meeting_room/freebusy/batch_get': () => feishuOk({ free_busy: { 'c5-1': [{ start_time: 'x', end_time: 'y' }] } }),
    });
    const result = await findAvailableMeetingRooms({
      token: TOKEN,
      startTs: Date.parse('2026-08-25T01:30:00Z'),
      endTs: Date.parse('2026-08-25T02:30:00Z'),
    }, { fetchImpl });
    expect(result.has_d5).toBe(true);
    // c5-1 忙被排除，d1-1 空闲；非优先楼栋的 d3-1 不参与（有优先楼栋时）
    expect(result.rooms.map((r) => r.room_id)).toEqual(['d1-1']);
    expect(result.rooms[0].building).toBe('D1');
  });

  it('无 C5/D1 会议室时回退全部会议室', async () => {
    const { fetchImpl } = makeFetch({
      '/vc/v1/room_levels': () => feishuOk({ items: [cityLevel()], page_token: '' }),
      '/vc/v1/rooms': () => feishuOk({ rooms: [makeRoom('a1', '会议室A', 'D3栋'), makeRoom('a2', '会议室B', 'D3栋')], page_token: '' }),
      '/meeting_room/freebusy/batch_get': () => feishuOk({ free_busy: {} }),
    });
    const result = await findAvailableMeetingRooms({
      token: TOKEN, startTs: 1, endTs: 2,
    }, { fetchImpl });
    expect(result.has_d5).toBe(false);
    expect(result.rooms.map((r) => r.room_id)).toEqual(['a1', 'a2']);
    expect(result.rooms.every((r) => r.building === '')).toBe(true);
  });

  it('城市层级接口报错时抛错（由端点降级为 reason）', async () => {
    const { fetchImpl } = makeFetch({
      '/vc/v1/room_levels': () => ({ code: 99991672, msg: 'no permission' }),
    });
    await expect(findAvailableMeetingRooms({ token: TOKEN, startTs: 1, endTs: 2 }, { fetchImpl })).rejects.toThrow(/99991672/);
  });
});
