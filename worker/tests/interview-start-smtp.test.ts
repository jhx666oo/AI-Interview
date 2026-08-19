import { describe, expect, it } from 'vitest';
import { isSmtpConfigured, loadSmtpConfig, mimeEncodeWord, sendSmtpMail, type SmtpConfig, type SmtpTransport } from '../src/interview-start/smtp';

/**
 * SMTP 客户端测试：注入 FakeTransport 脚本化服务端应答，
 * 覆盖：465 SSL 全流程命令序列、587 STARTTLS 升级、认证失败报错、
 * 日期与主题/发件人名的中文编码、loadSmtpConfig / isSmtpConfigured。
 */

function b64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** 脚本化 SMTP 传输：replies 为依次返回的应答块（多行块用 \n 分隔） */
class FakeTransport implements SmtpTransport {
  sent: string[] = [];
  tlsUpgraded = false;
  closed = false;
  private blocks: string[];

  constructor(replies: string[]) {
    this.blocks = [...replies];
  }

  async writeLine(line: string): Promise<void> {
    this.sent.push(line);
  }

  async readLine(): Promise<string | null> {
    for (;;) {
      if (this.blocks.length === 0) return null;
      const block = this.blocks[0];
      if (block === '') {
        this.blocks.shift();
        continue;
      }
      const lines = block.split('\n');
      const line = lines[0];
      const rest = lines.slice(1).join('\n');
      if (rest === '') this.blocks.shift();
      else this.blocks[0] = rest;
      return line;
    }
  }

  async upgradeTls(): Promise<void> {
    this.tlsUpgraded = true;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

const CONFIG: SmtpConfig = {
  host: 'smtp.example.com',
  port: 465,
  username: 'hr@example.com',
  password: 'auth-code',
  fromAddress: 'hr@example.com',
  fromName: '招聘系统',
};

function okReplies(): string[] {
  return [
    '220 smtp ready',
    '250-smtp.example.com\n250 AUTH LOGIN',
    '334 VXNlcm5hbWU6',
    '334 UGFzc3dvcmQ6',
    '235 auth ok',
    '250 ok',
    '250 ok',
    '354 go ahead',
    '250 queued',
    '221 bye',
  ];
}

describe('sendSmtpMail', () => {
  it('465 SSL：完整命令序列与消息体', async () => {
    const transport = new FakeTransport(okReplies());
    await sendSmtpMail(CONFIG, { to: 'candidate@qq.com', subject: '【面试邀请】张三', html: '<p>hello</p>', text: 'hello' }, {
      openTransport: async () => transport,
    });

    expect(transport.tlsUpgraded).toBe(false);
    expect(transport.sent[0]).toBe('EHLO ai-interview-worker');
    expect(transport.sent[1]).toBe('AUTH LOGIN');
    expect(transport.sent[2]).toBe(b64('hr@example.com'));
    expect(transport.sent[3]).toBe(b64('auth-code'));
    expect(transport.sent[4]).toBe('MAIL FROM:<hr@example.com>');
    expect(transport.sent[5]).toBe('RCPT TO:<candidate@qq.com>');
    expect(transport.sent[6]).toBe('DATA');
    // DATA 后整块写入的报文（头 + 正文在同一行，CRLF 分隔）
    const dataIdx = transport.sent.indexOf('DATA');
    const message = transport.sent[dataIdx + 1];
    expect(message.startsWith('From:')).toBe(true);
    expect(message).toContain(`=?UTF-8?B?${b64('招聘系统')}?=`);
    expect(message).toContain(`Subject: =?UTF-8?B?${b64('【面试邀请】张三')}?=`);
    expect(message).toContain('To: <candidate@qq.com>');
    expect(message).toContain('multipart/alternative');
    expect(message).toContain('Content-Transfer-Encoding: base64');
    expect(transport.sent[transport.sent.length - 2]).toBe('.');
    expect(transport.sent[transport.sent.length - 1]).toBe('QUIT');
    // DATA 结束符 '.' 是独立一行（不被点填充转义影响）
    expect(transport.sent.filter((line) => line === '.').length).toBe(1);
  });

  it('587：STARTTLS 升级后重新 EHLO', async () => {
    const transport = new FakeTransport([
      '220 ready',
      '250-smtp\n250 STARTTLS',
      '220 go',
      '250-smtp\n250 AUTH LOGIN',
      '334 VXNlcm5hbWU6',
      '334 UGFzc3dvcmQ6',
      '235 ok',
      '250 ok',
      '250 ok',
      '354 go',
      '250 ok',
      '221 bye',
    ]);
    await sendSmtpMail({ ...CONFIG, port: 587 }, { to: 'a@b.com', subject: 's', html: '<p>x</p>' }, {
      openTransport: async () => transport,
    });

    expect(transport.tlsUpgraded).toBe(true);
    const starttlsIdx = transport.sent.indexOf('STARTTLS');
    const ehlos = transport.sent.filter((line) => line.startsWith('EHLO'));
    expect(starttlsIdx).toBeGreaterThan(-1);
    expect(ehlos.length).toBe(2);
    // STARTTLS 之后的 AUTH 必须在 TLS 升级之后
    expect(transport.sent.indexOf('AUTH LOGIN')).toBeGreaterThan(starttlsIdx);
  });

  it('认证失败：抛出含服务端应答的异常并关闭连接', async () => {
    const transport = new FakeTransport([
      '220 ready', '250 ok', '334 VXNlcm5hbWU6', '334 UGFzc3dvcmQ6', '535 auth failed',
    ]);
    await expect(sendSmtpMail(CONFIG, { to: 'a@b.com', subject: 's', html: 'x' }, {
      openTransport: async () => transport,
    })).rejects.toThrow(/535 auth failed/);
    expect(transport.closed).toBe(true);
  });

  it('点填充：Base64 正文不含裸点行首，DATA 结束符唯一', async () => {
    const transport = new FakeTransport(okReplies());
    await sendSmtpMail(CONFIG, { to: 'a@b.com', subject: 's', html: '.start with dot' }, {
      openTransport: async () => transport,
    });
    const dataIdx = transport.sent.indexOf('DATA');
    const message = transport.sent[dataIdx + 1];
    // 正文整体 Base64 编码，任何 CRLF 行都不会以裸点开头
    expect(message.split('\r\n').every((line: string) => !line.startsWith('.') || line === '.')).toBe(true);
    // 结束符 '.' 独立成行且仅出现一次
    expect(transport.sent.filter((line) => line === '.').length).toBe(1);
  });
});

describe('mimeEncodeWord', () => {
  it('ASCII 原样返回，中文按 RFC 2047 编码', () => {
    expect(mimeEncodeWord('Recruiting')).toBe('Recruiting');
    expect(mimeEncodeWord('招聘系统')).toBe(`=?UTF-8?B?${b64('招聘系统')}?=`);
  });
});

describe('loadSmtpConfig / isSmtpConfigured', () => {
  function fakeD1(row: any) {
    return {
      prepare(sql: string) {
        const stmt = {
          bind: () => stmt,
          first: async () => (sql.includes('FROM system_configs') ? row : null),
          all: async () => ({ results: [] }),
          run: async () => ({ meta: {} }),
        };
        return stmt;
      },
    } as unknown as D1Database;
  }

  it('启用且配置齐全 → 返回配置', async () => {
    const config = await loadSmtpConfig(fakeD1({
      smtp_host: 'smtp.qq.com', smtp_port: 465, smtp_username: 'hr@qq.com',
      smtp_password: 'code', mail_from: 'hr@qq.com', mail_from_name: '', mail_enabled: 1,
    }));
    expect(config).not.toBeNull();
    expect(config!.host).toBe('smtp.qq.com');
    expect(config!.fromName).toBe('招聘系统');
  });

  it('未启用 / 缺密码 / 无配置 → null', async () => {
    expect(await loadSmtpConfig(fakeD1({ smtp_host: 'a', smtp_username: 'b', smtp_password: 'c', mail_from: 'd', mail_enabled: 0 }))).toBeNull();
    expect(await loadSmtpConfig(fakeD1({ smtp_host: 'a', smtp_username: 'b', smtp_password: '', mail_from: 'd', mail_enabled: 1 }))).toBeNull();
    expect(await loadSmtpConfig(fakeD1(null))).toBeNull();
  });

  it('isSmtpConfigured 与 loadSmtpConfig 口径一致', async () => {
    const row = { smtp_host: 'a', smtp_username: 'b', smtp_password: 'c', mail_from: 'd', mail_enabled: 1 };
    expect(isSmtpConfigured(row)).toBe(true);
    expect(isSmtpConfigured({ ...row, mail_enabled: 0 })).toBe(false);
    expect(isSmtpConfigured(null)).toBe(false);
    expect(isSmtpConfigured({ ...row, smtp_password: '' })).toBe(false);
    expect((await loadSmtpConfig(fakeD1(row))) !== null).toBe(isSmtpConfigured(row));
  });
});
