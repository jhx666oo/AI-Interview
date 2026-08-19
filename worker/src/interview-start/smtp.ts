/**
 * SMTP 发信（供「开始面试」候选人邮件使用）。
 *
 * Cloudflare Worker 无法直连传统 SMTP，这里基于 TCP Sockets API
 * （cloudflare:sockets）实现一个最小 SMTP 客户端：
 * - 465 端口：直接 SMTPS（secureTransport: 'on'）
 * - 587/其他端口：STARTTLS 升级
 * - AUTH LOGIN + UTF-8 Base64 邮件体（multipart/alternative）
 *
 * 传输层通过 deps.openTransport 注入以便本地单测（vitest 跑在 node 上，
 * 不引 cloudflare:sockets；生产运行时才动态 import）。
 *
 * SMTP 配置来自 system_configs（邮件设置页可在线编辑），mail_enabled 未开启或配置不完整时返回 null。
 */

export interface SmtpConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  fromAddress: string;
  fromName: string;
}

export interface SmtpMailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

/** 行式传输接口：读一行应答 / 写一行命令 / TLS 升级 */
export interface SmtpTransport {
  writeLine(line: string): Promise<void>;
  /** 读取一行（不含 CRLF）；流结束返回 null */
  readLine(): Promise<string | null>;
  upgradeTls(): Promise<void>;
  close(): Promise<void>;
}

export interface SmtpDeps {
  openTransport?: (config: SmtpConfig) => Promise<SmtpTransport>;
}

/** 从 system_configs 读取 SMTP 配置；未启用或关键字段缺失返回 null */
export async function loadSmtpConfig(db: D1Database): Promise<SmtpConfig | null> {
  const row: any = await db.prepare(
    'SELECT smtp_host, smtp_port, smtp_username, smtp_password, mail_from, mail_from_name, mail_enabled FROM system_configs ORDER BY updated_at DESC LIMIT 1',
  ).first();
  if (!row) return null;
  if (!Number(row.mail_enabled)) return null;
  const host = String(row.smtp_host || '').trim();
  const port = Number(row.smtp_port) || 465;
  const username = String(row.smtp_username || '').trim();
  const password = String(row.smtp_password || '');
  const fromAddress = String(row.mail_from || '').trim();
  const fromName = String(row.mail_from_name || '').trim() || '招聘系统';
  if (!host || !username || !password || !fromAddress) return null;
  return { host, port, username, password, fromAddress, fromName };
}

export function isSmtpConfigured(row: any): boolean {
  if (!row) return false;
  if (!Number(row.mail_enabled)) return false;
  return Boolean(
    String(row.smtp_host || '').trim() &&
    String(row.smtp_username || '').trim() &&
    String(row.smtp_password || '') &&
    String(row.mail_from || '').trim(),
  );
}

// ==================== 协议层 ====================

interface SmtpReply {
  code: number;
  text: string;
}

/** 读取一个完整 SMTP 应答（聚合多行，直到 `NNN ` 结尾行） */
async function readReply(transport: SmtpTransport): Promise<SmtpReply> {
  const lines: string[] = [];
  let code = 0;
  for (;;) {
    const line = await transport.readLine();
    if (line === null) throw new Error('SMTP 连接在等待应答时被关闭');
    lines.push(line);
    const match = line.match(/^(\d{3})([ -])?/);
    if (match) {
      code = Number(match[1]);
      if (match[2] !== '-') break; // `NNN ` 或行尾 → 应答结束
    }
  }
  return { code, text: lines.join('\n') };
}

async function expectReply(transport: SmtpTransport, expected: number[], command: string): Promise<SmtpReply> {
  const reply = await readReply(transport);
  if (!expected.includes(reply.code)) {
    throw new Error(`SMTP ${command} 失败：${reply.text}`);
  }
  return reply;
}

function b64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** 邮件正文 Base64 编码并按 76 列折行（RFC 2045） */
function b64Wrap(value: string): string {
  const encoded = b64(value);
  return (encoded.match(/.{1,76}/g) || [encoded]).join('\r\n');
}

function dotStuff(body: string): string {
  return body.split('\r\n').map((line) => (line.startsWith('.') ? '.' + line : line)).join('\r\n');
}

function buildMessage(config: SmtpConfig, mail: SmtpMailInput): string {
  const from = `"${mimeEncodeWord(config.fromName)}" <${config.fromAddress}>`;
  const headers = [
    `From: ${from}`,
    `To: <${mail.to}>`,
    `Subject: ${mimeEncodeWord(mail.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
  ];
  let body: string;
  if (mail.text) {
    headers.push('Content-Type: multipart/alternative; boundary="----=_AI_INTERVIEW_MAIL"');
    body = [
      '------=_AI_INTERVIEW_MAIL',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      b64Wrap(mail.text),
      '------=_AI_INTERVIEW_MAIL',
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      b64Wrap(mail.html),
      '------=_AI_INTERVIEW_MAIL--',
    ].join('\r\n');
  } else {
    headers.push('Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64');
    body = b64Wrap(mail.html);
  }
  return headers.join('\r\n') + '\r\n\r\n' + body;
}

/** RFC 2047 编码头字段（中文主题/发件人名） */
export function mimeEncodeWord(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${b64(value)}?=`;
}

/** 发送一封邮件。抛错表示失败（含 SMTP 错误应答原文）。 */
export async function sendSmtpMail(config: SmtpConfig, mail: SmtpMailInput, deps: SmtpDeps = {}): Promise<void> {
  const transport = deps.openTransport
    ? await deps.openTransport(config)
    : await openCloudflareTransport(config);
  try {
    await expectReply(transport, [220], '连接');

    await transport.writeLine(`EHLO ai-interview-worker`);
    await expectReply(transport, [250], 'EHLO');

    // 非 465 端口：STARTTLS 升级后再 EHLO
    if (config.port !== 465) {
      await transport.writeLine('STARTTLS');
      await expectReply(transport, [220], 'STARTTLS');
      await transport.upgradeTls();
      await transport.writeLine('EHLO ai-interview-worker');
      await expectReply(transport, [250], 'EHLO(TLS)');
    }

    await transport.writeLine('AUTH LOGIN');
    await expectReply(transport, [334], 'AUTH LOGIN');
    await transport.writeLine(b64(config.username));
    await expectReply(transport, [334], 'AUTH USERNAME');
    await transport.writeLine(b64(config.password));
    await expectReply(transport, [235], 'AUTH PASSWORD');

    await transport.writeLine(`MAIL FROM:<${config.fromAddress}>`);
    await expectReply(transport, [250], 'MAIL FROM');
    await transport.writeLine(`RCPT TO:<${mail.to}>`);
    await expectReply(transport, [250, 251], 'RCPT TO');

    await transport.writeLine('DATA');
    await expectReply(transport, [354], 'DATA');
    const message = buildMessage(config, mail);
    await transport.writeLine(dotStuff(message));
    await transport.writeLine('.');
    await expectReply(transport, [250], 'DATA 结束');

    await transport.writeLine('QUIT').catch(() => {});
  } finally {
    await transport.close().catch(() => {});
  }
}

// ==================== Cloudflare Sockets 传输层 ====================

async function openCloudflareTransport(config: SmtpConfig): Promise<SmtpTransport> {
  // 间接说明符：避免 esbuild（本地语法检查）与 vitest（node 环境）静态解析 cloudflare:sockets，
  // 该模块仅在 Cloudflare Workers 运行时真正加载；单测通过 deps.openTransport 注入替身。
  const specifier = 'cloudflare:sockets';
  const sockets: any = await import(/* @vite-ignore */ specifier);
  const connect = sockets.connect as (address: { hostname: string; port: number; secureTransport: 'on' | 'starttls' }) => any;
  const secureTransport = config.port === 465 ? 'on' : 'starttls';
  let socket = connect({ hostname: config.host, port: config.port, secureTransport });

  const makeIo = (sock: any) => {
    const writer = sock.writable.getWriter();
    const reader = sock.readable.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let buffer = '';
    return {
      writeLine: async (line: string) => {
        await writer.write(encoder.encode(line + '\r\n'));
      },
      readLine: async (): Promise<string | null> => {
        for (;;) {
          const idx = buffer.indexOf('\n');
          if (idx >= 0) {
            const line = buffer.slice(0, idx).replace(/\r$/, '');
            buffer = buffer.slice(idx + 1);
            return line;
          }
          const { done, value } = await reader.read();
          if (done) {
            if (buffer) { const rest = buffer; buffer = ''; return rest; }
            return null;
          }
          buffer += decoder.decode(value, { stream: true });
        }
      },
      close: async () => {
        try { await reader.cancel(); } catch { /* ignore */ }
        try { await writer.close(); } catch { /* ignore */ }
        try { sock.close(); } catch { /* ignore */ }
      },
      rawSocket: sock,
    };
  };

  let io = makeIo(socket);
  return {
    writeLine: (line) => io.writeLine(line),
    readLine: () => io.readLine(),
    upgradeTls: async () => {
      socket = (socket as any).startTls();
      io = makeIo(socket);
    },
    close: () => io.close(),
  };
}
