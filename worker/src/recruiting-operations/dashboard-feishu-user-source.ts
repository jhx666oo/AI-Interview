export type DashboardSourceKey = 'zhipei' | 'yanglao';

export interface DashboardFeishuSource {
  key: DashboardSourceKey;
  appToken: string;
  tableId: string;
  viewId?: string;
}

export interface DashboardFeishuSourceEnv {
  FEISHU_DASHBOARD_ZHIPEI_APP_TOKEN?: string;
  FEISHU_DASHBOARD_ZHIPEI_TABLE_ID?: string;
  FEISHU_DASHBOARD_ZHIPEI_VIEW_ID?: string;
  FEISHU_DASHBOARD_YANGLAO_APP_TOKEN?: string;
  FEISHU_DASHBOARD_YANGLAO_TABLE_ID?: string;
  FEISHU_DASHBOARD_YANGLAO_VIEW_ID?: string;
}

const DASHBOARD_SOURCE_ENV_KEYS: readonly (keyof DashboardFeishuSourceEnv)[] = [
  'FEISHU_DASHBOARD_ZHIPEI_APP_TOKEN',
  'FEISHU_DASHBOARD_ZHIPEI_TABLE_ID',
  'FEISHU_DASHBOARD_ZHIPEI_VIEW_ID',
  'FEISHU_DASHBOARD_YANGLAO_APP_TOKEN',
  'FEISHU_DASHBOARD_YANGLAO_TABLE_ID',
  'FEISHU_DASHBOARD_YANGLAO_VIEW_ID',
];

/**
 * Returns the separately configured dashboard tables, or null when the
 * dashboard should continue using the legacy bot-backed source.
 */
export function buildDashboardFeishuSources(env: DashboardFeishuSourceEnv): DashboardFeishuSource[] | null {
  const configured = DASHBOARD_SOURCE_ENV_KEYS.some((key) => Boolean(env[key]?.trim()));
  if (!configured) return null;

  const sources: DashboardFeishuSource[] = [
    {
      key: 'zhipei',
      appToken: env.FEISHU_DASHBOARD_ZHIPEI_APP_TOKEN?.trim() || '',
      tableId: env.FEISHU_DASHBOARD_ZHIPEI_TABLE_ID?.trim() || '',
      viewId: env.FEISHU_DASHBOARD_ZHIPEI_VIEW_ID?.trim() || undefined,
    },
    {
      key: 'yanglao',
      appToken: env.FEISHU_DASHBOARD_YANGLAO_APP_TOKEN?.trim() || '',
      tableId: env.FEISHU_DASHBOARD_YANGLAO_TABLE_ID?.trim() || '',
      viewId: env.FEISHU_DASHBOARD_YANGLAO_VIEW_ID?.trim() || undefined,
    },
  ];

  const incomplete = sources.find((source) => !source.appToken || !source.tableId);
  if (incomplete) {
    throw new Error(`Dashboard Feishu source ${incomplete.key} is incomplete; app token and table ID are required`);
  }
  return sources;
}

export function buildDashboardRecordsUrl(source: DashboardFeishuSource, pageToken?: string): string {
  const params = new URLSearchParams({ page_size: '500' });
  if (source.viewId) params.set('view_id', source.viewId);
  if (pageToken) params.set('page_token', pageToken);
  return `https://open.feishu.cn/open-apis/bitable/v1/apps/${encodeURIComponent(source.appToken)}/tables/${encodeURIComponent(source.tableId)}/records?${params.toString()}`;
}

interface FeishuRecordsResponse {
  code?: number;
  msg?: string;
  data?: {
    items?: Array<{ record_id?: string; fields?: Record<string, unknown> }>;
    page_token?: string;
    has_more?: boolean;
  };
}

type DashboardFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function listDashboardBitableRecords(
  accessToken: string,
  source: DashboardFeishuSource,
  fetchImpl: DashboardFetch = fetch,
): Promise<Array<{ record_id?: string; fields?: Record<string, unknown> }>> {
  const records: Array<{ record_id?: string; fields?: Record<string, unknown> }> = [];
  let pageToken: string | undefined;

  for (;;) {
    const response = await fetchImpl(buildDashboardRecordsUrl(source, pageToken), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    let body: FeishuRecordsResponse;
    try {
      body = await response.json() as FeishuRecordsResponse;
    } catch {
      throw new Error(`Feishu dashboard table read failed (${response.status})`);
    }

    if (!response.ok || (body.code !== undefined && body.code !== 0)) {
      const code = body.code ?? response.status;
      throw new Error(`Feishu dashboard table read failed (${code})`);
    }

    const data = body.data || {};
    records.push(...(data.items || []));
    if (!data.has_more) return records;
    if (!data.page_token) throw new Error('Feishu dashboard table read failed (missing page token)');
    pageToken = data.page_token;
  }
}
