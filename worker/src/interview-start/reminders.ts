/**
 * 面试官面试提醒（「开始面试」流程 + 面试前 30 分钟 cron 共用）：
 * 1. 生成/复用该候选人的面试卡片固定链接（一个简历一个链接）
 * 2. 给主面试官发飞书文本消息：候选人 / 岗位 / 面试时间 + 面试卡片链接
 *    （面试管理统一用卡片链接——看简历、填评价、改时间都在链接内；不发卡片、不附 PDF）
 */

import {
  loadInterviewReminderSource,
  resolveExactInterviewerOpenId,
  resolveReminderInterviewer,
} from '../feishu-notifications/reminder-source';
import { buildInterviewReminderView } from '../feishu-notifications/interview-reminder';
import { createOrReuseInterviewCardLink } from '../interview-card/routes';

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

/** 发送飞书文本消息（收件人为 open_id） */
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

/**
 * 给面试官发送面试提醒（文本消息 + 面试卡片链接）。
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
      // 链接生成失败仅影响链接行，不影响文字提醒
    }

    const view = buildInterviewReminderView(source);
    const lines = [
      `面试提醒：${view.name}`,
      `岗位：${view.position}`,
      `面试时间：${view.interviewTime}`,
    ];
    // 线上面试：附会议链接；线下面试：附地点提示，不带链接
    if (text(input.meetingLink)) {
      lines.push(`会议链接（${input.interviewTypeLabel || '线上面试'}）：${text(input.meetingLink)}`);
    } else if (text(view.interviewLocation)) {
      lines.push(`面试地点（${input.interviewTypeLabel || '线下面试'}）：${text(view.interviewLocation)}`);
    } else if (input.interviewTypeLabel === '线下面试') {
      lines.push(`面试形式：线下面试`);
    }
    if (cardLinkUrl) lines.push(`面试卡片链接：${cardLinkUrl}`);
    await sendFeishuTextMessage(token, openId, lines.join('\n'));

    return { ok: true, interviewerName, cardLinkUrl };
  } catch (e: any) {
    return { ...empty, reason: e?.message || String(e) };
  }
}
