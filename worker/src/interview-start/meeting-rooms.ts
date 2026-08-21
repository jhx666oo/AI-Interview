/**
 * 空闲会议室查询（供「安排面试」弹窗自动填充面试地点）。
 *
 * - 会议室列表：GET /open-apis/vc/v1/rooms（name/path 定位楼栋，权限 vc:room:readonly）
 * - 会议室忙闲：GET /open-apis/meeting_room/freebusy/batch_get（room_ids 复数，权限 calendar:room:readonly）
 * - 公司所在楼栋：优先 D5（按 name/path/description 含 "D5" 筛选），无 D5 时回退全部会议室
 */

export interface MeetingRoomInfo {
  room_id: string;
  name: string;
  path: string;
  description: string;
  capacity: number | null;
}

const FEISHU_BASE = 'https://open.feishu.cn/open-apis';
const D5_PATTERN = /D5/i;

/** 筛选 D5 栋会议室（纯函数） */
export function pickD5Rooms(rooms: MeetingRoomInfo[]): MeetingRoomInfo[] {
  return rooms.filter((r) => D5_PATTERN.test(`${r.name} ${r.path} ${r.description}`));
}

/** 过滤空闲会议室：busyMap[room_id] 为空数组/不存在即空闲（纯函数） */
export function filterFreeRooms(rooms: MeetingRoomInfo[], busyMap: Record<string, any[]>): MeetingRoomInfo[] {
  return rooms.filter((r) => !busyMap[r.room_id] || (busyMap[r.room_id] || []).length === 0);
}

export interface MeetingRoomsDeps {
  fetchImpl?: typeof fetch;
  /** 默认 D5 关键词，可注入覆盖 */
  d5Pattern?: RegExp;
  maxRooms?: number;
}

/** 拉取全部会议室（分页，上限 maxRooms） */
export async function listMeetingRooms(
  token: string,
  deps: MeetingRoomsDeps = {},
): Promise<MeetingRoomInfo[]> {
  const fetchImpl = deps.fetchImpl || fetch;
  const maxRooms = deps.maxRooms || 500;
  const rooms: MeetingRoomInfo[] = [];
  let pageToken = '';
  do {
    const url = `${FEISHU_BASE}/vc/v1/rooms?page_size=100${pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ''}`;
    const resp = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
    const data: any = await resp.json();
    if (!data || data.code !== 0) {
      throw new Error(`会议室列表获取失败: ${data?.code || resp.status} ${data?.msg || ''}`.trim());
    }
    for (const r of data.data?.rooms || []) {
      rooms.push({
        room_id: String(r.room_id || ''),
        name: String(r.name || ''),
        path: String(r.path || ''),
        description: String(r.description || ''),
        capacity: r.capacity ?? null,
      });
    }
    pageToken = data.data?.page_token || '';
  } while (pageToken && rooms.length < maxRooms);
  return rooms;
}

/** 查询会议室忙闲：返回 room_id → 忙碌日程数组 */
export async function queryRoomAvailability(
  token: string,
  roomIds: string[],
  startTs: number,
  endTs: number,
  deps: MeetingRoomsDeps = {},
  rfc3339: (tsMs: number) => string = defaultRfc3339,
): Promise<Record<string, any[]>> {
  if (roomIds.length === 0) return {};
  const fetchImpl = deps.fetchImpl || fetch;
  const qs = roomIds.map((id) => `room_ids=${encodeURIComponent(id)}`).join('&');
  const min = rfc3339(startTs);
  const max = rfc3339(endTs);
  const resp = await fetchImpl(
    `${FEISHU_BASE}/meeting_room/freebusy/batch_get?${qs}&time_min=${encodeURIComponent(min)}&time_max=${encodeURIComponent(max)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const data: any = await resp.json();
  if (!data || data.code !== 0) {
    throw new Error(`会议室忙闲查询失败: ${data?.code || resp.status} ${data?.msg || ''}`.trim());
  }
  return data.data?.free_busy || {};
}

function defaultRfc3339(tsMs: number): string {
  const d = new Date(tsMs + 8 * 3600_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00+08:00`;
}

export interface FindAvailableRoomsInput {
  token: string;
  startTs: number;
  endTs: number;
}

export interface FindAvailableRoomsResult {
  has_d5: boolean;
  rooms: MeetingRoomInfo[];
}

/** 查空闲会议室：D5 栋优先，忙闲过滤（最多取 20 个查忙闲） */
export async function findAvailableMeetingRooms(
  input: FindAvailableRoomsInput,
  deps: MeetingRoomsDeps = {},
): Promise<FindAvailableRoomsResult> {
  const allRooms = await listMeetingRooms(input.token, deps);
  const d5Rooms = (deps.d5Pattern ? allRooms.filter((r) => (deps.d5Pattern as RegExp).test(`${r.name} ${r.path} ${r.description}`)) : pickD5Rooms(allRooms));
  const candidates = (d5Rooms.length ? d5Rooms : allRooms).slice(0, 20);
  const busyMap = await queryRoomAvailability(input.token, candidates.map((r) => r.room_id), input.startTs, input.endTs, deps);
  return {
    has_d5: d5Rooms.length > 0,
    rooms: filterFreeRooms(candidates, busyMap),
  };
}
