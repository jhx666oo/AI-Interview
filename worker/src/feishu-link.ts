/**
 * 飞书链接解析与内容抓取（供「一键生成评分维度」等功能使用）。
 *
 * 支持链接类型：
 * - 文档:   https://xxx.feishu.cn/docx/{token}
 * - 多维表格: https://xxx.feishu.cn/base/{appToken}?table={tableId}
 * - 知识库: https://xxx.feishu.cn/wiki/{wikiToken}（自动解析节点后按类型读取）
 * - 电子表格: https://xxx.feishu.cn/sheets/{spreadsheetToken}
 *
 * 抓取统一使用应用身份（tenant_access_token），文档/表格需对该应用可见；
 * 无权限或格式不支持时抛错，由调用方回退为「粘贴文本」方式。
 */

export type FeishuLinkType = 'docx' | 'base' | 'wiki' | 'sheet';

export type FeishuLinkInfo =
  | { type: 'docx'; token: string }
  | { type: 'base'; appToken: string; tableId: string | null }
  | { type: 'wiki'; token: string }
  | { type: 'sheet'; token: string }
  | { type: 'unknown'; url: string };

/** 最小 Env 接口：与 index.ts 的 Env 结构兼容（结构化类型） */
export interface FeishuLinkEnv {
  DB: D1Database;
  FEISHU_APP_ID?: string;
  FEISHU_APP_SECRET?: string;
}

export function parseFeishuLink(rawUrl: string): FeishuLinkInfo {
  const url = String(rawUrl || '').trim();
  if (!url) return { type: 'unknown', url };

  const docxMatch = url.match(/\/docx\/([A-Za-z0-9]+)/);
  if (docxMatch) return { type: 'docx', token: docxMatch[1] };

  const baseMatch = url.match(/\/base\/([A-Za-z0-9]+)/);
  if (baseMatch) {
    const query = (url.split('?')[1] || '');
    const tableId = new URLSearchParams(query).get('table');
    return { type: 'base', appToken: baseMatch[1], tableId };
  }

  const wikiMatch = url.match(/\/wiki\/([A-Za-z0-9]+)/);
  if (wikiMatch) return { type: 'wiki', token: wikiMatch[1] };

  const sheetMatch = url.match(/\/sheets\/([A-Za-z0-9]+)/);
  if (sheetMatch) return { type: 'sheet', token: sheetMatch[1] };

  return { type: 'unknown', url };
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 10_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error('请求飞书 API 超时');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** 获取 tenant_access_token（带 D1 缓存），逻辑与 index.ts getFeishuToken 保持一致 */
async function getTenantAccessToken(env: FeishuLinkEnv): Promise<string> {
  try {
    const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind('feishu_token').first();
    if (row && row.value) {
      const cached = JSON.parse(row.value as string);
      if (cached.token && cached.expiry && Date.now() < cached.expiry) return cached.token;
    }
  } catch { /* 缓存读取失败则重新获取 */ }

  const appId = env.FEISHU_APP_ID || '';
  const appSecret = env.FEISHU_APP_SECRET || '';
  if (!appId || !appSecret) {
    throw new Error('未配置 FEISHU_APP_ID / FEISHU_APP_SECRET');
  }
  const resp = await fetchWithTimeout('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
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
    await env.DB.prepare(
      'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?'
    ).bind('feishu_token', JSON.stringify({ token: data.tenant_access_token, expiry }), new Date().toISOString(), JSON.stringify({ token: data.tenant_access_token, expiry }), new Date().toISOString()).run();
  } catch { /* 缓存写入失败不影响主流程 */ }
  return data.tenant_access_token;
}

async function feishuGet(env: FeishuLinkEnv, url: string): Promise<any> {
  const token = await getTenantAccessToken(env);
  const resp = await fetchWithTimeout(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data: any = await resp.json();
  if (data.code !== 0) {
    throw new Error(`飞书 API ${data.code || resp.status}: ${data.msg || ''}`);
  }
  return data;
}

/** 读取飞书文档纯文本（docx raw_content） */
async function fetchDocxContent(env: FeishuLinkEnv, token: string): Promise<string> {
  const data = await feishuGet(env, `https://open.feishu.cn/open-apis/docx/v1/documents/${token}/raw_content`);
  const content: string = data?.data?.content || '';
  if (!content.trim()) throw new Error('文档内容为空');
  return content.trim();
}

/** 读取多维表格前 20 条记录，拼接为「字段名: 值」文本 */
async function fetchBitableContent(env: FeishuLinkEnv, appToken: string, tableId: string | null): Promise<string> {
  let targetTableId = tableId;
  if (!targetTableId) {
    const tablesData = await feishuGet(env, `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables?page_size=100`);
    const tables = tablesData?.data?.items || [];
    if (!tables.length) throw new Error('多维表格中无数据表');
    targetTableId = tables[0].table_id;
  }
  const recordsData = await feishuGet(env, `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${targetTableId}/records?page_size=20`);
  const records = recordsData?.data?.items || [];
  if (!records.length) throw new Error('多维表格中无记录');
  const lines: string[] = [];
  records.forEach((rec: any, idx: number) => {
    const fields = rec.fields || {};
    const entries = Object.entries(fields)
      .filter(([, v]) => v !== null && v !== undefined && String(v) !== '')
      .map(([k, v]) => {
        const val = Array.isArray(v)
          ? v.map((item: any) => (typeof item === 'object' ? (item.text ?? item.name ?? '') : item)).filter(Boolean).join('、')
          : String(v);
        return `${k}: ${val}`;
      });
    if (entries.length) {
      lines.push(`记录${idx + 1}: ${entries.join('；')}`);
    }
  });
  const text = lines.join('\n');
  if (!text.trim()) throw new Error('多维表格记录内容为空');
  return text.trim();
}

/** 读取电子表格（第一个工作表，最多 10 行 x 8 列） */
async function fetchSheetContent(env: FeishuLinkEnv, spreadsheetToken: string): Promise<string> {
  const sheetsData = await feishuGet(env, `https://open.feishu.cn/open-apis/sheets/v3/spreadsheets/${spreadsheetToken}/sheets/query`);
  const sheets = sheetsData?.data?.sheets || [];
  if (!sheets.length) throw new Error('电子表格中无工作表');
  const sheetId = sheets[0].sheet_id;
  const valuesData = await feishuGet(env, `https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/${spreadsheetToken}/values/${sheetId}!A1:H10`);
  const rows: unknown[][] = valuesData?.data?.valueRange?.values || [];
  if (!rows.length) throw new Error('电子表格内容为空');
  const lines = rows
    .map((row) => row.map((cell) => String(cell ?? '')).join('\t'))
    .filter((line) => line.trim());
  return lines.join('\n');
}

/** 根据飞书链接抓取可读文本内容 */
export async function fetchFeishuLinkContent(env: FeishuLinkEnv, rawUrl: string): Promise<string> {
  const info = parseFeishuLink(rawUrl);
  switch (info.type) {
    case 'docx':
      return fetchDocxContent(env, info.token);
    case 'base':
      return fetchBitableContent(env, info.appToken, info.tableId);
    case 'wiki': {
      const nodeData = await feishuGet(env, `https://open.feishu.cn/open-apis/wiki/v2/spaces/get_node?token=${info.token}`);
      const node = nodeData?.data?.node;
      if (!node?.obj_token) throw new Error('知识库节点解析失败');
      if (node.obj_type === 'docx') return fetchDocxContent(env, node.obj_token);
      if (node.obj_type === 'bitable') return fetchBitableContent(env, node.obj_token, null);
      throw new Error(`暂不支持的知识库节点类型: ${node.obj_type}`);
    }
    case 'sheet':
      return fetchSheetContent(env, info.token);
    default:
      throw new Error('无法识别的飞书链接，请粘贴飞书文档/多维表格/知识库/电子表格链接');
  }
}
