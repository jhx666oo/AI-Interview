import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MIAODA_MAIL_SYNC_BASE_URL,
  getMiaodaMailSyncConfig,
} from '../src/mail-sync/config';

describe('妙搭邮件同步配置', () => {
  it('默认使用最新妙搭邮件同步项目地址', () => {
    expect(getMiaodaMailSyncConfig({ MIAODA_API_KEY: 'runtime-key' })).toEqual({
      baseUrl: DEFAULT_MIAODA_MAIL_SYNC_BASE_URL,
      apiKey: 'runtime-key',
    });
  });

  it('允许通过运行环境覆盖地址并清理尾部斜杠', () => {
    expect(getMiaodaMailSyncConfig({
      MIAODA_MAIL_SYNC_BASE_URL: 'https://miaoda.example/openapi/mail-sync/',
      MIAODA_API_KEY: '  runtime-key  ',
    })).toEqual({
      baseUrl: 'https://miaoda.example/openapi/mail-sync',
      apiKey: 'runtime-key',
    });
  });

  it('未配置密钥时给出明确错误', () => {
    expect(() => getMiaodaMailSyncConfig({})).toThrow('MIAODA_API_KEY 未配置');
  });
});
