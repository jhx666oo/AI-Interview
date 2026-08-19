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
