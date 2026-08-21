/**
 * 空闲会议室查询（供「安排面试」弹窗自动填充面试地点）。
 *
 * - 会议室列表：GET /open-apis/vc/v1/rooms（name/path 定位楼栋，权限 vc:room:readonly）
 * - 会议室忙闲：GET /open-apis/meeting_room/freebusy/batch_get（room_ids 复数，权限 calendar:room:readonly）
 * - 优先楼栋：C5 栋、D1 栋（按 name/path/description 含 "C5"/"D1" 筛选），无匹配时回退全部会议室
 */

export interface MeetingRoomInfo {
  room_id: string;
  name: string;
  path: string;
  description: string;
  capacity: number | null;
  /** 命中的优先楼栋（C5 / D1），未命中为空字符串 */
  building?: string;
}

const FEISHU_BASE = 'https://open.feishu.cn/open-apis';
/** 优先推荐楼栋：按出现顺序匹配（C5 优先于 D1），名称/路径/描述任一命中即算 */
const PRIORITY_BUILDINGS: Array<{ key: string; re: RegExp }> = [
  { key: 'C5', re: /C5/i },
  { key: 'D1', re: /D1/i },
];

/** 筛选优先楼栋（C5/D1）会议室（纯函数） */
export function pickPriorityRooms(rooms: MeetingRoomInfo[]): MeetingRoomInfo[] {
  return rooms.filter((r) => PRIORITY_BUILDINGS.some((p) => p.re.test(`${r.name} ${r.path} ${r.description}`)));
}

/** 返回会议室命中的优先楼栋标识（'C5' | 'D1' | ''） */
export function buildingOf(room: MeetingRoomInfo): string {
  for (const p of PRIORITY_BUILDINGS) {
    if (p.re.test(`${room.name} ${room.path} ${room.description}`)) return p.key;
  }
  return '';
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

/** 拉取全部会议室（分页，上限 maxRooms；防御空页/游标异常导致的死循环） */
export async function listMeetingRooms(
  token: string,
  deps: MeetingRoomsDeps = {},
): Promise<MeetingRoomInfo[]> {
  const fetchImpl = deps.fetchImpl || fetch;
  const maxRooms = deps.maxRooms || 500;
  const rooms: MeetingRoomInfo[] = [];
  let pageToken = '';
  let page = 0;
  do {
    page += 1;
    const url = `${FEISHU_BASE}/vc/v1/rooms?page_size=100${pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ''}`;
    const resp = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
    const data: any = await resp.json();
    if (!data || data.code !== 0) {
      throw new Error(`会议室列表获取失败: ${data?.code || resp.status} ${data?.msg || ''}`.trim());
    }
    // 兼容 rooms / items 两种响应字段
    const pageRooms = Array.isArray(data.data?.rooms) ? data.data.rooms : (Array.isArray(data.data?.items) ? data.data.items : []);
    for (const r of pageRooms || []) {
      rooms.push({
        room_id: String(r.room_id || ''),
        name: String(r.name || ''),
        // path 在飞书接口中是楼栋层级 ID 数组（如 omb_xxx），对人不可读，仅保留首段兜底
        path: Array.isArray(r.path) ? r.path.map(String).join('/') : String(r.path || ''),
        description: String(r.description || ''),
        capacity: r.capacity ?? null,
      });
    }
    pageToken = data.data?.page_token || '';
    // 空页 + 游标仍在推进 → 数据异常，立即终止避免无限请求（subrequest 上限 50）
    if (pageRooms.length === 0 && pageToken) break;
  } while (pageToken && rooms.length < maxRooms && page < 20);
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

/** 查空闲会议室：C5/D1 优先（无匹配回退全部），忙闲过滤（最多取 20 个查忙闲），返回带楼栋标签 */
export async function findAvailableMeetingRooms(
  input: FindAvailableRoomsInput,
  deps: MeetingRoomsDeps = {},
): Promise<FindAvailableRoomsResult> {
  const allRooms = await listMeetingRooms(input.token, deps);
  const priorityRooms = pickPriorityRooms(allRooms);
  const candidates = (priorityRooms.length ? priorityRooms : allRooms).slice(0, 20);
  const busyMap = await queryRoomAvailability(input.token, candidates.map((r) => r.room_id), input.startTs, input.endTs, deps);
  return {
    has_d5: priorityRooms.length > 0,
    rooms: filterFreeRooms(candidates, busyMap).map((r) => ({ ...r, building: buildingOf(r) })),
  };
}
