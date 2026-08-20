/**
 * 飞书日历日程创建（供「开始面试」流程使用）。
 *
 * 使用应用身份（tenant_access_token）在应用主日历（calendar_id = primary）上创建日程，
 * 通过 vchat.vc_type = 'vc' 让飞书自动生成原生视频会议，日程读回 vchat.meeting_url 作为入会链接。
 * 可选添加面试官为日程参与人（需应用开启机器人能力，失败不阻塞主流程）。
 *
 * 参考文档：
 * - 创建日程：POST /calendar/v4/calendars/:calendar_id/events（scope: calendar:calendar 或 calendar:calendar.event:create）
 * - 添加日程参与人：POST /calendar/v4/calendars/:calendar_id/events/:event_id/attendees
 */

export interface FeishuCalendarEnv {
  DB: D1Database;
  FEISHU_APP_ID?: string;
  FEISHU_APP_SECRET?: string;
}

export interface InterviewCalendarEventInput {
  summary: string;
  description: string;
  /** 开始时间（秒级时间戳） */
  startTimestamp: number;
  /** 结束时间（秒级时间戳） */
  endTimestamp: number;
  timezone?: string;
  /** 日程参与人 open_id 列表（可选，添加失败仅记录告警） */
  attendeeOpenIds?: string[];
}

export interface InterviewCalendarEventResult {
  eventId: string;
  meetingUrl: string | null;
  attendeeErrors: string[];
}

export interface FeishuCalendarDeps {
  fetchImpl?: typeof fetch;
  /** 获取 tenant_access_token（可注入，默认走本地实现：D1 缓存 + 飞书 auth 接口） */
  getTenantToken?: (env: FeishuCalendarEnv, fallbackAppId?: string) => Promise<string>;
  timeoutMs?: number;
}

const FEISHU_BASE = 'https://open.feishu.cn/open-apis';
const DEFAULT_TIMEOUT_MS = 15_000;

/** 获取 tenant_access_token（带 D1 缓存），逻辑与 feishu-link.ts 保持一致 */
export async function getTenantAccessToken(
  env: FeishuCalendarEnv,
  fallbackAppId?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  try {
    const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind('feishu_token').first();
    if (row && row.value) {
      const cached = JSON.parse(row.value as string);
      if (cached.token && cached.expiry && Date.now() < cached.expiry) return cached.token;
    }
  } catch { /* 缓存读取失败则重新获取 */ }

  const appId = env.FEISHU_APP_ID || fallbackAppId || '';
  const appSecret = env.FEISHU_APP_SECRET || '';
  if (!appId || !appSecret) {
    throw new Error('飞书凭证未配置（缺少 FEISHU_APP_ID / FEISHU_APP_SECRET）');
  }
  const resp = await fetchImpl(`${FEISHU_BASE}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const data: any = await resp.json();
  if (!data.tenant_access_token) {
    throw new Error(`获取飞书应用 token 失败: ${data.code || ''} ${data.msg || JSON.stringify(data)}`);
  }
  const expiry = Date.now() + 110 * 60 * 1000;
  try {
    const nowIso = new Date().toISOString();
    await env.DB.prepare(
      'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?',
    ).bind('feishu_token', JSON.stringify({ token: data.tenant_access_token, expiry }), nowIso, JSON.stringify({ token: data.tenant_access_token, expiry }), nowIso).run();
  } catch { /* 缓存写入失败不影响主流程 */ }
  return data.tenant_access_token;
}

async function feishuRequest(
  url: string,
  init: RequestInit,
  token: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let resp: Response;
  try {
    resp = await fetchImpl(url, {
      ...init,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init.headers || {}) },
    });
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error('请求飞书 API 超时');
    throw e;
  } finally {
    clearTimeout(timer);
  }
  const data: any = await resp.json().catch(() => null);
  if (!data || data.code !== 0) {
    const detail = data ? `${data.code} ${data.msg || ''}` : `HTTP ${resp.status}`;
    throw new Error(`飞书 API 调用失败（${url.replace(FEISHU_BASE, '')}）：${detail}`.trim());
  }
  return data;
}

function eventMeetingUrl(event: any): string | null {
  const url = event?.vchat?.meeting_url;
  return typeof url === 'string' && url.trim() ? url.trim() : null;
}

/**
 * 生成未来 N 个工作日的可面试工作窗口（北京时间）：
 * 从 fromTs 的次日开始，跳过周六/周日，先跳过 skipWorkdays 个工作日（默认 2，
 * 即从未来第 3 个工作日开始），再取之后 workdays 个工作日（默认 3）。
 * 每天两个窗口：上午 09:30-11:30、下午 13:30-18:30（午休 11:30-13:30 不算面试时间）。
 * 单位：秒级时间戳。
 */
export function buildFutureInterviewWindows(fromTs: number, skipWorkdays = 2, workdays = 3): Array<{ start: number; end: number }> {
  const windows: Array<{ start: number; end: number }> = [];
  const daySec = 86_400;
  // 从 fromTs 所在天的次日 00:00（北京时间）起逐日检查
  let dayStart = Math.floor(fromTs / daySec) * daySec - 8 * 3600 + daySec; // 次日 00:00 北京时间
  let skipped = 0;
  let found = 0;
  let guard = 0;
  while (found < workdays && guard < 60) {
    guard += 1;
    // dayStart 为北京时间 00:00 的绝对秒，星期几需按北京时间判断（+8h 后取 UTC 星期）
    const dow = new Date((dayStart + 8 * 3600) * 1000).getUTCDay(); // 0=周日 6=周六
    if (dow === 0 || dow === 6) {
      dayStart += daySec;
      continue;
    }
    if (skipped < skipWorkdays) {
      skipped += 1;
      dayStart += daySec;
      continue;
    }
    windows.push({ start: dayStart + 9.5 * 3600, end: dayStart + 11.5 * 3600 });
    windows.push({ start: dayStart + 13.5 * 3600, end: dayStart + 18.5 * 3600 });
    found += 1;
    dayStart += daySec;
  }
  return windows;
}

export interface FreeSlotSearchInput {
  /** tenant_access_token */
  token: string;
  /** 面试官 open_id */
  openId: string;
  /** 从该时刻起找（秒级时间戳），默认从次日开始 */
  fromTs: number;
  /** 面试时长（分钟），默认 60 */
  durationMinutes?: number;
  /** 先跳过的工作日数量（默认 2，即从未来第 3 个工作日开始） */
  skipWorkdays?: number;
  /** 之后覆盖的工作日数量（跳过周末），默认 3 */
  workdays?: number;
}

export interface FreeSlotSearchDeps {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** 拉取 openId 在 windows 覆盖范围内的忙碌区间并合并重叠，失败返回 null */
async function fetchMergedBusy(
  token: string,
  openId: string,
  windows: Array<{ start: number; end: number }>,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<Array<{ start: number; end: number }> | null> {
  let busy: Array<{ start: number; end: number }> = [];
  try {
    const resp = await feishuRequest(
      `${FEISHU_BASE}/calendar/v4/freebusy/list`,
      {
        method: 'POST',
        body: JSON.stringify({
          time_min: new Date(windows[0].start).toISOString(),
          time_max: new Date(windows[windows.length - 1].end).toISOString(),
          user_ids: [openId],
        }),
      },
      token,
      fetchImpl,
      timeoutMs,
    );
    for (const item of (resp?.data?.freebusy_list || []) as any[]) {
      for (const b of (item?.busy_items || []) as any[]) {
        const s = Number(b?.start?.timestamp);
        const e = Number(b?.end?.timestamp);
        if (Number.isFinite(s) && Number.isFinite(e)) busy.push({ start: s * 1000, end: e * 1000 });
      }
    }
  } catch {
    return null;
  }
  busy.sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const b of busy) {
    const last = merged[merged.length - 1];
    if (last && b.start <= last.end) last.end = Math.max(last.end, b.end);
    else merged.push({ ...b });
  }
  return merged;
}

function isFreeRange(start: number, end: number, mergedBusy: Array<{ start: number; end: number }>): boolean {
  return !mergedBusy.some((b) => b.start < end && b.end > start);
}

/**
 * 在主面试官未来 N 个工作日的空闲时段中找第一个 ≥ 面试时长的空闲开始时刻（秒级时间戳）。
 * 找不到 / freebusy 拉取失败 → 返回 null（调用方回退原定时间并告警）。
 */
export async function findFirstFreeInterviewSlot(
  input: FreeSlotSearchInput,
  deps: FreeSlotSearchDeps = {},
): Promise<number | null> {
  const fetchImpl = deps.fetchImpl || fetch;
  const timeoutMs = deps.timeoutMs || DEFAULT_TIMEOUT_MS;
  const durationMs = (input.durationMinutes || 60) * 60_000;
  const skipWorkdays = input.skipWorkdays !== undefined && input.skipWorkdays >= 0 ? input.skipWorkdays : 2;
  const workdays = input.workdays && input.workdays > 0 ? input.workdays : 3;
  const windows = buildFutureInterviewWindows(input.fromTs, skipWorkdays, workdays).map((w) => ({ start: w.start * 1000, end: w.end * 1000 }));
  if (windows.length === 0) return null;

  const merged = await fetchMergedBusy(input.token, input.openId, windows, fetchImpl, timeoutMs);
  if (!merged) return null;

  // 在每个工作窗口内找第一个足够长的空闲段
  for (const win of windows) {
    let cursor = win.start;
    for (const b of merged) {
      if (b.end <= cursor) continue;
      if (b.start >= win.end) break;
      const busyStart = Math.max(b.start, win.start);
      if (busyStart - cursor >= durationMs) return Math.floor(cursor / 1000);
      cursor = Math.max(cursor, b.end);
    }
    if (win.end - cursor >= durationMs) return Math.floor(cursor / 1000);
  }
  return null;
}

/**
 * 列出主面试官未来 N 个工作日所有 ≥ 面试时长（默认 1 小时）的空闲时段
 * （30 分钟粒度，落在 09:30-11:30 / 13:30-18:30 工作窗口内）。
 * 供「候选人详情链接」页面试官点选改时间；freebusy 失败返回空数组。
 */
export async function listFreeInterviewSlots(
  input: FreeSlotSearchInput,
  deps: FreeSlotSearchDeps = {},
): Promise<Array<{ startTs: number; endTs: number }>> {
  const fetchImpl = deps.fetchImpl || fetch;
  const timeoutMs = deps.timeoutMs || DEFAULT_TIMEOUT_MS;
  const durationMs = (input.durationMinutes || 60) * 60_000;
  const skipWorkdays = input.skipWorkdays !== undefined && input.skipWorkdays >= 0 ? input.skipWorkdays : 2;
  const workdays = input.workdays && input.workdays > 0 ? input.workdays : 3;
  const windows = buildFutureInterviewWindows(input.fromTs, skipWorkdays, workdays).map((w) => ({ start: w.start * 1000, end: w.end * 1000 }));
  if (windows.length === 0) return [];

  const merged = await fetchMergedBusy(input.token, input.openId, windows, fetchImpl, timeoutMs);
  if (!merged) return [];

  const slots: Array<{ startTs: number; endTs: number }> = [];
  for (const win of windows) {
    for (let t = win.start; t + durationMs <= win.end; t += 30 * 60_000) {
      if (isFreeRange(t, t + durationMs, merged)) {
        slots.push({ startTs: Math.floor(t / 1000), endTs: Math.floor((t + durationMs) / 1000) });
      }
    }
  }
  return slots;
}

/**
 * 创建带视频会议的面试日程。
 * 返回日程 ID 与入会链接；meetingUrl 可能为 null（飞书未同步出会议链接时），
 * 调用方应把它作为告警处理而不是失败。
 */
export async function createInterviewCalendarEvent(
  env: FeishuCalendarEnv,
  input: InterviewCalendarEventInput,
  deps: FeishuCalendarDeps = {},
  fallbackAppId?: string,
): Promise<InterviewCalendarEventResult> {
  const fetchImpl = deps.fetchImpl || fetch;
  const timeoutMs = deps.timeoutMs || DEFAULT_TIMEOUT_MS;
  const token = deps.getTenantToken
    ? await deps.getTenantToken(env, fallbackAppId)
    : await getTenantAccessToken(env, fallbackAppId, fetchImpl);

  const timezone = input.timezone || 'Asia/Shanghai';
  const body = {
    summary: input.summary,
    description: input.description,
    start_time: { timestamp: String(Math.floor(input.startTimestamp)), timezone },
    end_time: { timestamp: String(Math.floor(input.endTimestamp)), timezone },
    vchat: { vc_type: 'vc' },
    reminders: [{ minutes: 15 }],
  };

  const created = await feishuRequest(
    `${FEISHU_BASE}/calendar/v4/calendars/primary/events?user_id_type=open_id`,
    { method: 'POST', body: JSON.stringify(body) },
    token,
    fetchImpl,
    timeoutMs,
  );

  const event = created?.data?.event || {};
  const eventId = String(event.event_id || '');
  if (!eventId) throw new Error('飞书日程创建成功但未返回 event_id');

  let meetingUrl = eventMeetingUrl(event);
  if (!meetingUrl) {
    // 创建响应未带会议链接 → 读一次日程详情（视频会议链接由飞书异步生成，读取兜底）
    try {
      const detail = await feishuRequest(
        `${FEISHU_BASE}/calendar/v4/calendars/primary/events/${encodeURIComponent(eventId)}?user_id_type=open_id`,
        { method: 'GET' },
        token,
        fetchImpl,
        timeoutMs,
      );
      meetingUrl = eventMeetingUrl(detail?.data?.event);
    } catch { /* 读取失败保持 meetingUrl=null，由调用方告警 */ }
  }

  // 添加面试官为日程参与人（失败仅记录，不阻塞）
  const attendeeErrors: string[] = [];
  const openIds = [...new Set((input.attendeeOpenIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (openIds.length > 0) {
    try {
      await feishuRequest(
        `${FEISHU_BASE}/calendar/v4/calendars/primary/events/${encodeURIComponent(eventId)}/attendees?user_id_type=open_id`,
        {
          method: 'POST',
          body: JSON.stringify({ attendees: openIds.map((openId) => ({ type: 'user', user_id: openId })), need_notification: true }),
        },
        token,
        fetchImpl,
        timeoutMs,
      );
    } catch (e: any) {
      attendeeErrors.push(`日程参与人添加失败: ${e?.message || e}`);
    }
  }

  return { eventId, meetingUrl, attendeeErrors };
}

/**
 * 更新已创建飞书日程的开始/结束时间（面试官在链接内改时间后同步）。
 * 失败不抛异常，返回 { ok: false, error } 由调用方提示。
 */
export async function updateInterviewCalendarEventTime(
  env: FeishuCalendarEnv,
  eventId: string,
  input: { startTimestamp: number; endTimestamp: number; timezone?: string },
  deps: FeishuCalendarDeps = {},
  fallbackAppId?: string,
): Promise<{ ok: boolean; error?: string }> {
  const fetchImpl = deps.fetchImpl || fetch;
  const timeoutMs = deps.timeoutMs || DEFAULT_TIMEOUT_MS;
  let token: string;
  try {
    token = deps.getTenantToken
      ? await deps.getTenantToken(env, fallbackAppId)
      : await getTenantAccessToken(env, fallbackAppId, fetchImpl);
  } catch (e: any) {
    return { ok: false, error: e?.message || '获取飞书凭证失败' };
  }
  const timezone = input.timezone || 'Asia/Shanghai';
  try {
    await feishuRequest(
      `${FEISHU_BASE}/calendar/v4/calendars/primary/events/${encodeURIComponent(eventId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          start_time: { timestamp: String(Math.floor(input.startTimestamp)), timezone },
          end_time: { timestamp: String(Math.floor(input.endTimestamp)), timezone },
        }),
      },
      token,
      fetchImpl,
      timeoutMs,
    );
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || '更新飞书日程失败' };
  }
}
