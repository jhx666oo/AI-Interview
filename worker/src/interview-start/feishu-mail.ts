/**
 * 飞书邮件 API 发信（供「开始面试」候选人邮件使用，替代 SMTP）。
 *
 * 飞书邮件 API 的写操作（创建草稿/发送草稿）仅支持用户身份（user_access_token），
 * 发件人必须是已绑定飞书、且应用开通 mail:user_mailbox.message:send 权限的飞书邮箱。
 *
 * 流程两步（与飞书开放平台一致）：
 * 1. POST /open-apis/mail/v1/user_mailboxes/{user_mailbox_id}/drafts
 *    body: { raw: <base64url-EML> }  —— EML 复用 smtp.ts 的 buildMessage 构造
 * 2. POST /open-apis/mail/v1/user_mailboxes/{user_mailbox_id}/drafts/{draft_id}/send
 *
 * token 通过 deps.getValidToken 注入（生产为 getValidUserAccessToken，便于单测注入替身）。
 */

import { buildMessage } from './smtp';

export interface FeishuMailInput {
  /** 发件人飞书邮箱（user_mailbox_id），必须是对应已绑定飞书用户的邮箱 */
  fromEmail: string;
  fromName?: string;
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface FeishuMailDeps {
  /** 按发件人邮箱取有效 user_access_token；缺省直接返回 null（未绑定飞书） */
  getValidToken?: (email: string) => Promise<string | null>;
}

export interface FeishuMailResult {
  ok: boolean;
  reason?: string;
}

function toBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 飞书 OpenAPI 响应：code=0 成功，否则带 code/msg */
function isFeishuOk(data: any): boolean {
  return Boolean(data && (data.code === 0 || data.code === undefined && data.ok !== false));
}

/** 发送一封邮件（飞书邮件 API）。抛错表示请求级失败；返回 ok=false 表示飞书拒绝并附原因。 */
export async function sendFeishuMail(
  input: FeishuMailInput,
  deps: FeishuMailDeps = {},
): Promise<FeishuMailResult> {
  const token = deps.getValidToken ? await deps.getValidToken(input.fromEmail) : null;
  if (!token) {
    return { ok: false, reason: '发件人邮箱未绑定飞书（系统设置 → 个人资料 → 绑定飞书）或授权已过期' };
  }
  if (!input.to) return { ok: false, reason: '收件人邮箱为空' };

  const eml = buildMessage(
    {
      host: 'smtp.feishu.cn',
      port: 465,
      username: input.fromEmail,
      password: '',
      fromAddress: input.fromEmail,
      fromName: input.fromName || '招聘系统',
    },
    { to: input.to, subject: input.subject, html: input.html, text: input.text },
  );
  const raw = toBase64Url(eml);
  const mailboxPath = encodeURIComponent(input.fromEmail);
  const baseUrl = 'https://open.feishu.cn/open-apis/mail/v1/user_mailboxes';

  // 1) 创建草稿
  let draftResp: Response;
  try {
    draftResp = await fetch(`${baseUrl}/${mailboxPath}/drafts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
    });
  } catch (e: any) {
    return { ok: false, reason: `创建草稿请求失败：${e?.message || e}` };
  }
  const draftData: any = await draftResp.json().catch(() => ({}));
  if (!isFeishuOk(draftData)) {
    return { ok: false, reason: `创建草稿失败：${draftData?.code ?? draftResp.status} ${draftData?.msg || draftData?.message || ''}`.trim() };
  }
  const draftId = draftData.data?.draft?.id || draftData.data?.id || '';
  if (!draftId) return { ok: false, reason: '创建草稿未返回 draft_id' };

  // 2) 发送草稿
  let sendResp: Response;
  try {
    sendResp = await fetch(`${baseUrl}/${mailboxPath}/drafts/${encodeURIComponent(draftId)}/send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
  } catch (e: any) {
    return { ok: false, reason: `发送草稿请求失败：${e?.message || e}` };
  }
  const sendData: any = await sendResp.json().catch(() => ({}));
  if (!isFeishuOk(sendData)) {
    return { ok: false, reason: `发送草稿失败：${sendData?.code ?? sendResp.status} ${sendData?.msg || sendData?.message || ''}`.trim() };
  }
  return { ok: true };
}
