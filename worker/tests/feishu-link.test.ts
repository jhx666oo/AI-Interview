import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { parseFeishuLink, fetchFeishuLinkContent } from '../src/feishu-link';

describe('parseFeishuLink', () => {
  it('parses docx links', () => {
    expect(parseFeishuLink('https://xxx.feishu.cn/docx/AbCd1234')).toEqual({ type: 'docx', token: 'AbCd1234' });
  });

  it('parses bitable links with table param', () => {
    expect(parseFeishuLink('https://xxx.feishu.cn/base/AppToken123?table=tblXyz&view=vew1'))
      .toEqual({ type: 'base', appToken: 'AppToken123', tableId: 'tblXyz' });
  });

  it('parses bitable links without table param', () => {
    expect(parseFeishuLink('https://xxx.feishu.cn/base/AppToken123'))
      .toEqual({ type: 'base', appToken: 'AppToken123', tableId: null });
  });

  it('parses wiki links', () => {
    expect(parseFeishuLink('https://xxx.feishu.cn/wiki/WikiTok999')).toEqual({ type: 'wiki', token: 'WikiTok999' });
  });

  it('parses sheets links', () => {
    expect(parseFeishuLink('https://xxx.feishu.cn/sheets/SheetTok777')).toEqual({ type: 'sheet', token: 'SheetTok777' });
  });

  it('returns unknown for non-feishu urls', () => {
    expect(parseFeishuLink('https://example.com/jobs/1')).toEqual({ type: 'unknown', url: 'https://example.com/jobs/1' });
    expect(parseFeishuLink('')).toEqual({ type: 'unknown', url: '' });
  });
});

describe('fetchFeishuLinkContent', () => {
  // 带真实缓存行为的 DB mock：first 读取缓存，run 写入缓存
  const makeDb = () => {
    const store = new Map<string, string>();
    return {
      prepare: (sql: string) => ({
        bind: (...args: any[]) => ({
          first: async () => {
            if (sql.includes('SELECT value FROM settings')) {
              const v = store.get('feishu_token');
              return v ? { value: v } : null;
            }
            return null;
          },
          run: async () => {
            if (sql.includes('INSERT INTO settings')) {
              store.set(String(args[0]), String(args[1]));
            }
            return undefined;
          },
        }),
      }),
    };
  };

  const env: any = {
    DB: makeDb(),
    FEISHU_APP_ID: 'cli_app_id',
    FEISHU_APP_SECRET: 'secret',
  };

  const mockFetch = vi.fn();
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    env.DB = makeDb(); // 每个测试独立缓存
    globalThis.fetch = mockFetch as any;
    mockFetch.mockReset();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('fetches docx raw content', async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ tenant_access_token: 't-abc' }),
    }).mockResolvedValueOnce({
      json: async () => ({ code: 0, data: { content: '岗位要求：5 年嵌入式开发经验\n熟悉 C/C++' } }),
    });

    const text = await fetchFeishuLinkContent(env, 'https://xxx.feishu.cn/docx/DocTok1');
    expect(text).toContain('嵌入式开发');
    // 验证请求路径与鉴权头
    const [, init] = mockFetch.mock.calls[1];
    expect(String(init.headers.Authorization)).toBe('Bearer t-abc');
  });

  it('fetches bitable records and flattens fields', async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ tenant_access_token: 't-abc' }),
    }).mockResolvedValueOnce({
      json: async () => ({ code: 0, data: { items: [{ table_id: 'tblMain' }] } }),
    }).mockResolvedValueOnce({
      json: async () => ({
        code: 0,
        data: {
          items: [
            { fields: { 岗位: '硬件工程师', 要求: '熟悉 STM32', 城市: ['上海'] } },
            { fields: { 岗位: '嵌入式', 经验: '3年' } },
          ],
        },
      }),
    });

    const text = await fetchFeishuLinkContent(env, 'https://xxx.feishu.cn/base/AppTok2');
    expect(text).toContain('硬件工程师');
    expect(text).toContain('STM32');
    expect(text).toContain('记录2');
  });

  it('resolves wiki node to docx then reads content', async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ tenant_access_token: 't-abc' }),
    }).mockResolvedValueOnce({
      json: async () => ({ code: 0, data: { node: { obj_token: 'DocObj1', obj_type: 'docx' } } }),
    }).mockResolvedValueOnce({
      json: async () => ({ code: 0, data: { content: '知识库里的岗位说明' } }),
    });

    const text = await fetchFeishuLinkContent(env, 'https://xxx.feishu.cn/wiki/WikiTok3');
    expect(text).toBe('知识库里的岗位说明');
  });

  it('throws a friendly error when feishu api returns non-zero code', async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ tenant_access_token: 't-abc' }),
    }).mockResolvedValueOnce({
      json: async () => ({ code: 99991663, msg: 'no permission' }),
    });

    await expect(fetchFeishuLinkContent(env, 'https://xxx.feishu.cn/docx/DocTok1'))
      .rejects.toThrow(/no permission/);
  });

  it('throws when url is not a supported feishu link', async () => {
    await expect(fetchFeishuLinkContent(env, 'https://example.com/jobs/1'))
      .rejects.toThrow(/无法识别/);
  });
});
