/**
 * 空闲会议室查询（供「安排面试」弹窗自动填充面试地点）。
 *
 * - 会议室列表：GET /open-apis/vc/v1/rooms。注意：**必须传 room_level_id（城市/楼栋层级 ID）**
 *   才能看到对应层级的会议室；不带参数时接口只返回默认可见范围（实测只返回少量会议室，
 *   真实会议室如「亚洲馆-迪拜（长沙西湖D1二楼）」必须按城市层级查询）。
 *   流程：先拉顶级 room_levels（=城市列表），再对每个城市调 rooms?room_level_id=城市ID，
 *   返回该城市下全部会议室（跨楼层）。
 * - 会议室忙闲：GET /open-apis/meeting_room/freebusy/batch_get（room_ids 复数，权限 calendar:room:readonly）
 * - 前端展示：会议室名 +（所属城市），如「亚洲馆-迪拜（长沙）」。
 *   旧逻辑的 C5/D1 楼栋优先标签保留兼容（命中时 building=C5/D1，用于旧会议室的展示）。
 */

export interface MeetingRoomInfo {
  room_id: string;
  name: string;
  path: string;
  description: string;
  capacity: number | null;
  /** 命中的优先楼栋（C5 / D1），未命中为空字符串（旧会议室兼容） */
  building?: string;
  /** 会议室所属城市/楼栋显示名（如「长沙」）；无法解析时为空 */
  level_name?: string;
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
  /** 默认 D5 关键词，可注入覆盖（保留兼容，未使用） */
  d5Pattern?: RegExp;
  maxRooms?: number;
}

interface RoomLevelItem {
  room_level_id: string;
  name: string;
  parent_id: string;
}

async function feishuGet(
  url: string,
  token: string,
  fetchImpl: typeof fetch,
): Promise<any> {
  const resp = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
  const data: any = await resp.json();
  if (!data || data.code !== 0) {
    throw new Error(`会议室 API 失败(${data?.code || resp.status} ${data?.msg || ''})`.trim());
  }
  return data;
}

/**
 * 拉取顶级会议室层级（= 城市列表）。
 * 飞书 room_levels 接口仅返回顶级层级（分页），子层级无法单独查询。
 */
export async function listCityLevels(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RoomLevelItem[]> {
  const levels: RoomLevelItem[] = [];
  let pageToken = '';
  let page = 0;
  do {
    page += 1;
    const url = `${FEISHU_BASE}/vc/v1/room_levels?page_size=100${pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ''}`;
    const data = await feishuGet(url, token, fetchImpl);
    const items = Array.isArray(data.data?.items) ? data.data.items : [];
    for (const it of items) {
      levels.push({
        room_level_id: String(it.room_level_id || ''),
        name: String(it.name || '').trim(),
        parent_id: String(it.parent_id || ''),
      });
    }
    pageToken = data.data?.page_token || '';
    if (items.length === 0 && pageToken) break;
  } while (pageToken && page < 10);
  return levels;
}

/**
 * 拉取会议室列表：先取顶级层级（城市），再按城市逐一查询 rooms?room_level_id=城市ID，
 * 覆盖该城市下全部会议室（跨楼层）。城市过多时截断（防 subrequest 超限）。
 */
export async function listMeetingRooms(
  token: string,
  deps: MeetingRoomsDeps = {},
): Promise<MeetingRoomInfo[]> {
  const fetchImpl = deps.fetchImpl || fetch;
  const maxRooms = deps.maxRooms || 500;
  const rooms: MeetingRoomInfo[] = [];
  const levels = await listCityLevels(token, fetchImpl);
  const cityMap = new Map(levels.map((l) => [l.room_level_id, l.name]));
  // 城市过多时最多遍历 30 个（防 Cloudflare subrequest 超限）
  const cityLevels = levels.slice(0, 30);

  for (const city of cityLevels) {
    if (rooms.length >= maxRooms) break;
    let pageToken = '';
    let page = 0;
    do {
      page += 1;
      const url = `${FEISHU_BASE}/vc/v1/rooms?page_size=100&room_level_id=${encodeURIComponent(city.room_level_id)}${pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ''}`;
      let data: any;
      try {
        data = await feishuGet(url, token, fetchImpl);
      } catch (e: any) {
        // 单个城市失败不阻塞其他城市
        console.warn(`[meeting-rooms] 城市「${city.name}」会议室拉取失败: ${e?.message || e}`);
        break;
      }
      const pageRooms = Array.isArray(data.data?.rooms) ? data.data.rooms : (Array.isArray(data.data?.items) ? data.data.items : []);
      for (const r of pageRooms) {
        rooms.push({
          room_id: String(r.room_id || ''),
          name: String(r.name || ''),
          // path 是楼栋层级 ID 数组（omb_xxx），对人不可读，仅保留用于 C5/D1 匹配
          path: Array.isArray(r.path) ? r.path.map(String).join('/') : String(r.path || ''),
          description: String(r.description || ''),
          capacity: r.capacity ?? null,
          // 所属城市名：从 path 第一段（城市 ID）反查
          level_name: Array.isArray(r.path) && r.path.length > 0 ? (cityMap.get(String(r.path[0])) || city.name) : city.name,
        });
      }
      pageToken = data.data?.page_token || '';
      if (pageRooms.length === 0 && pageToken) break;
    } while (pageToken && page < 5 && rooms.length < maxRooms);
  }
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

/** 查空闲会议室：按城市全量拉取 → C5/D1 优先（无匹配回退全部）→ 忙闲过滤（最多取 40 个查忙闲） */
export async function findAvailableMeetingRooms(
  input: FindAvailableRoomsInput,
  deps: MeetingRoomsDeps = {},
): Promise<FindAvailableRoomsResult> {
  const allRooms = await listMeetingRooms(input.token, deps);
  const priorityRooms = pickPriorityRooms(allRooms);
  const candidates = (priorityRooms.length ? priorityRooms : allRooms).slice(0, 40);
  const busyMap = await queryRoomAvailability(input.token, candidates.map((r) => r.room_id), input.startTs, input.endTs, deps);
  return {
    has_d5: priorityRooms.length > 0,
    rooms: filterFreeRooms(candidates, busyMap).map((r) => ({ ...r, building: buildingOf(r) })),
  };
}
