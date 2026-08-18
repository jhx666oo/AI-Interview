import { describe, expect, it, vi } from 'vitest';
import {
  buildDashboardFeishuSources,
  listDashboardBitableRecords,
} from '../src/recruiting-operations/dashboard-feishu-user-source';

describe('dedicated dashboard Feishu user source', () => {
  it('keeps the legacy source when only unrelated Feishu variables are present', () => {
    expect(buildDashboardFeishuSources({
      FEISHU_APP_ID: 'legacy-app-id',
    } as any)).toBeNull();
  });

  it('maps the two dashboard tables without changing existing Feishu config', () => {
    const sources = buildDashboardFeishuSources({
      FEISHU_DASHBOARD_ZHIPEI_APP_TOKEN: 'QivHbbd6JaAV0fs0LDqcZEc3n4g',
      FEISHU_DASHBOARD_ZHIPEI_TABLE_ID: 'tbl0yOiT0XarJwf9',
      FEISHU_DASHBOARD_ZHIPEI_VIEW_ID: 'vew2ViJain',
      // wiki 链接中的 Xanc... 是 wiki node token，实际 Bitable app_token
      // 由 node-get 解析为 Z0X...。
      FEISHU_DASHBOARD_YANGLAO_APP_TOKEN: 'Z0X7bzVHoaE4essOK1tc7Xcencb',
      FEISHU_DASHBOARD_YANGLAO_TABLE_ID: 'tbl4UKBczcKlKgtk',
      FEISHU_DASHBOARD_YANGLAO_VIEW_ID: 'vew33IcH5s',
    });

    expect(sources).toEqual([
      {
        key: 'zhipei',
        appToken: 'QivHbbd6JaAV0fs0LDqcZEc3n4g',
        tableId: 'tbl0yOiT0XarJwf9',
        viewId: 'vew2ViJain',
      },
      {
        key: 'yanglao',
        appToken: 'Z0X7bzVHoaE4essOK1tc7Xcencb',
        tableId: 'tbl4UKBczcKlKgtk',
        viewId: 'vew33IcH5s',
      },
    ]);
  });

  it('reads all pages with the authorized user token and selected view', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        data: {
          items: [{ record_id: 'rec-1', fields: { 岗位名称: '岗位一' } }],
          page_token: 'next-page',
          has_more: true,
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        data: {
          items: [{ record_id: 'rec-2', fields: { 岗位名称: '岗位二' } }],
          has_more: false,
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const records = await listDashboardBitableRecords(
      'user-access-token',
      { appToken: 'base-token', tableId: 'table-id', viewId: 'view-id' },
      fetchMock,
    );

    expect(records).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toContain('view_id=view-id');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      headers: { Authorization: 'Bearer user-access-token' },
    });
    expect(fetchMock.mock.calls[1][0]).toContain('page_token=next-page');
  });

  it('raises a safe error when Feishu rejects the user token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 91403,
      msg: 'Forbidden',
    }), { status: 403, headers: { 'content-type': 'application/json' } }));

    await expect(listDashboardBitableRecords(
      'user-access-token',
      { appToken: 'base-token', tableId: 'table-id' },
      fetchMock,
    )).rejects.toThrow('Feishu dashboard table read failed (91403)');
  });
});
