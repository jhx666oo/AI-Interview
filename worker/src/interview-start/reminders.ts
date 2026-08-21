/**
 * 面试官面试提醒（「开始面试」流程 + 面试前 30 分钟 cron 共用）：
 * 1. 生成/复用该候选人的面试卡片固定链接（一个简历一个链接）
 * 2. 给主面试官发飞书卡片消息：候选人 / 岗位 / 面试时间 + 正文提示语 + 会议按钮 + 面试卡片按钮
 *    （面试管理统一用卡片链接——看简历、填评价、改时间都在链接内；不发 PDF）
 * 卡片标题/落款/正文提示语走系统设置「消息模板」（可在线编辑）。
 */

import {
  loadInterviewReminderSource,
  resolveExactInterviewerOpenId,
  resolveReminderInterviewer,
} from '../feishu-notifications/reminder-source';
import { buildInterviewReminderView } from '../feishu-notifications/interview-reminder';
import { createOrReuseInterviewCardLink } from '../interview-card/routes';
import { loadTemplates, renderTemplate } from '../templates/config';

export interface InterviewReminderDeps {
  now: () => string;
  uuid: () => string;
  hashPublicToken: (token: string) => Promise<string>;
  getBotToken: (env: any) => Promise<string>;
  /** 前端域名（卡片链接前缀），默认 https://ai-interview-88r.pages.dev */
  frontendBase?: string;
}

export interface SendInterviewReminderInput {
  /** 面试 id */
  interviewId: string;
  /** 发送身份 token：user_access_token（交互场景）或 bot token（cron） */
  userToken: string;
  /** 操作人（交互场景为当前用户，cron 为 system） */
  operatorName?: string;
  /** 指定面试官姓名（默认主面试官） */
  interviewerName?: string;
  /** 视频会议入会链接（线上面试） */
  meetingLink?: string | null;
  /** 面试形式文案（线上面试/线下面试） */
  interviewTypeLabel?: string | null;
}

export interface SendInterviewReminderResult {
  ok: boolean;
  interviewerName: string | null;
  cardLinkUrl: string | null;
  reason?: string;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** 发送飞书文本消息（收件人为 open_id，通用） */
export async function sendFeishuTextMessage(token: string, openId: string, content: string): Promise<void> {
  const resp = await fetch('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      receive_id: openId,
      msg_type: 'text',
      content: JSON.stringify({ text: content }),
    }),
  });
  const data: any = await resp.json().catch(() => null);
  if (!data || data.code !== 0) {
    throw new Error(`发送飞书消息失败: ${data ? `${data.code} ${data.msg || ''}` : `HTTP ${resp.status}`}`);
  }
}

/** 发送飞书卡片消息（收件人为 open_id） */
export async function sendFeishuCardMessage(token: string, openId: string, card: Record<string, unknown>): Promise<void> {
  const resp = await fetch('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      receive_id: openId,
      msg_type: 'interactive',
      content: JSON.stringify(card),
    }),
  });
  const data: any = await resp.json().catch(() => null);
  if (!data || data.code !== 0) {
    throw new Error(`发送飞书卡片失败: ${data ? `${data.code} ${data.msg || ''}` : `HTTP ${resp.status}`}`);
  }
}

export interface InterviewerReminderCardInput {
  candidateName: string;
  position: string;
  interviewTime: string;
  /** 正文提示语（interviewer_reminder 模板渲染结果，可空） */
  bodyText?: string;
  /** 视频会议入会链接（线上面试） */
  meetingLink?: string | null;
  /** 面试形式文案（线上面试/线下面试） */
  interviewTypeLabel?: string | null;
  /** 线下面试地点 */
  location?: string | null;
  /** 面试卡片固定链接（候选人档案/评价） */
  cardLinkUrl?: string | null;
  /** 卡片落款（card_footer 模板渲染结果，可空） */
  footer?: string;
}

/** 构建面试官提醒飞书卡片：结构化数据行 + 正文提示语 + 会议/档案按钮 + 落款 */
export function buildInterviewerReminderCard(input: InterviewerReminderCardInput): Record<string, unknown> {
  const isOffline = input.interviewTypeLabel === '线下面试';
  const rows = `**候选人：** ${input.candidateName || '-'}\n**岗位：** ${input.position || '-'}\n**面试时间：** ${input.interviewTime || '-'}`;
  const elements: any[] = [
    { tag: 'div', text: { tag: 'lark_md', content: rows } },
    { tag: 'hr' },
  ];
  if (text(input.bodyText)) {
    elements.push({ tag: 'div', text: { tag: 'lark_md', content: input.bodyText } });
  }
  if (!isOffline && text(input.meetingLink)) {
    elements.push({ tag: 'div', text: { tag: 'lark_md', content: `**会议链接：** ${input.meetingLink}` } });
  } else if (text(input.location)) {
    elements.push({ tag: 'div', text: { tag: 'lark_md', content: `**面试地点：** ${input.location}` } });
  }
  const actions: any[] = [];
  if (!isOffline && text(input.meetingLink)) {
    actions.push({
      tag: 'button', type: 'primary',
      text: { tag: 'plain_text', content: '进入视频会议' },
      url: text(input.meetingLink),
    });
  }
  if (text(input.cardLinkUrl)) {
    actions.push({
      tag: 'button', type: 'default',
      text: { tag: 'plain_text', content: '查看候选人档案' },
      url: text(input.cardLinkUrl),
    });
  }
  if (actions.length > 0) {
    elements.push({ tag: 'action', actions });
  }
  const noteLines: string[] = [];
  if (text(input.cardLinkUrl)) noteLines.push(`面试卡片链接：${text(input.cardLinkUrl)}`);
  if (text(input.footer)) noteLines.push(text(input.footer));
  if (noteLines.length > 0) {
    elements.push({ tag: 'note', elements: noteLines.map((l) => ({ tag: 'plain_text', content: l })) });
  }
  return {
    config: { wide_screen_mode: true },
    header: { title: { tag: 'plain_text', content: '🔔 面试提醒' }, template: 'blue' },
    elements,
  };
}

/**
 * 给面试官发送面试提醒（飞书卡片 + 会议按钮 + 面试卡片链接）。
 * 任何一步失败都不抛异常，返回结构化结果供调用方记录。
 */
export async function sendInterviewerInterviewReminder(
  env: any,
  db: D1Database,
  input: SendInterviewReminderInput,
  deps: InterviewReminderDeps,
): Promise<SendInterviewReminderResult> {
  const empty: Omit<SendInterviewReminderResult, 'reason'> = {
    ok: false, interviewerName: null, cardLinkUrl: null,
  };
  try {
    const source = await loadInterviewReminderSource(db, input.interviewId);
    if (!source) return { ...empty, reason: '面试记录不存在' };

    const interviewerName = resolveReminderInterviewer(source.interview, input.interviewerName);
    if (!interviewerName) return { ...empty, reason: '面试记录未配置可用面试官' };

    const openId = await resolveExactInterviewerOpenId(db, interviewerName);
    if (!openId) {
      return { ...empty, interviewerName, reason: `面试官「${interviewerName}」未绑定飞书 open_id，跳过提醒` };
    }

    const token = text(input.userToken);
    if (!token) return { ...empty, interviewerName, reason: '缺少发送凭据' };

    // 面试卡片固定链接（一个简历一个链接；生成失败不阻塞提醒，此时只发文字）
    let cardLinkUrl: string | null = null;
    try {
      const resumeId = typeof source.resume?.id === 'string' ? text(source.resume.id) : '';
      const card = await createOrReuseInterviewCardLink(db, {
        resumeId,
        candidateName: typeof source.interview?.candidate_name === 'string'
          ? text(source.interview.candidate_name)
          : (typeof source.resume?.candidate_name === 'string' ? text(source.resume.candidate_name) : undefined),
        positionApplied: typeof source.interview?.position_applied === 'string'
          ? text(source.interview.position_applied)
          : (typeof source.resume?.position_applied === 'string' ? text(source.resume.position_applied) : undefined),
        createdBy: input.operatorName || 'system',
      }, { now: deps.now, uuid: deps.uuid, hashPublicToken: deps.hashPublicToken });
      const base = text(deps.frontendBase) || 'https://ai-interview-88r.pages.dev';
      cardLinkUrl = `${base.replace(/\/+$/, '')}${card.url}`;
    } catch {
      // 链接生成失败仅影响按钮/链接行，不影响提醒
    }

    const view = buildInterviewReminderView(source);
    // 正文提示语走系统设置「消息模板」的 interviewer_reminder（可在线编辑），缺省回退内置模板
    const templates = await loadTemplates(db);
    const vars = {
      candidateName: view.name,
      position: view.position,
      interviewTime: view.interviewTime,
    };
    const bodyText = renderTemplate(templates.interviewer_reminder, vars).trim();
    const footer = renderTemplate(templates.card_footer, vars).trim();

    const card = buildInterviewerReminderCard({
      candidateName: view.name,
      position: view.position,
      interviewTime: view.interviewTime,
      bodyText,
      meetingLink: text(input.meetingLink) || null,
      interviewTypeLabel: input.interviewTypeLabel,
      location: view.interviewLocation,
      cardLinkUrl,
      footer,
    });
    await sendFeishuCardMessage(token, openId, card);

    return { ok: true, interviewerName, cardLinkUrl };
  } catch (e: any) {
    return { ...empty, reason: e?.message || String(e) };
  }
}
