/**
 * 面试官面试提醒（「开始面试」流程 + 面试前 30 分钟 cron 共用）：
 * 1. 生成/复用该候选人的面试卡片固定链接（一个简历一个链接）
 * 2. 给主面试官发飞书卡片（候选人/岗位/面试时间/AI 建议 + 卡片链接按钮）
 * 3. 附加候选人简历 PDF（有则发，失败不阻塞）
 *
 * 发送身份：交互场景传当前登录用户的 user_access_token，cron 场景传 bot token。
 */

import {
  loadInterviewReminderSource,
  resolveExactInterviewerOpenId,
  resolveReminderInterviewer,
} from '../feishu-notifications/reminder-source';
import {
  buildInterviewReminderView,
  deliverInterviewReminder,
} from '../feishu-notifications/interview-reminder';
import { createOrReuseInterviewCardLink } from '../interview-card/routes';

export interface InterviewReminderDeps {
  now: () => string;
  uuid: () => string;
  hashPublicToken: (token: string) => Promise<string>;
  getResumeFileBytes: (env: any, resumeId: string) => Promise<{ bytes: Uint8Array | null; fileName: string }>;
  getBotToken: (env: any) => Promise<string>;
  /** 前端域名（卡片链接前缀），默认 https://ai-interview-88r.pages.dev */
  frontendBase?: string;
  refreshUserToken?: (email: string) => Promise<string | null>;
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
  /** 当前登录用户邮箱（用于 user token 过期刷新，可选） */
  userEmail?: string;
}

export interface SendInterviewReminderResult {
  ok: boolean;
  interviewerName: string | null;
  cardLinkUrl: string | null;
  cardSent: boolean;
  fileSent: boolean;
  reason?: string;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * 给面试官发送面试提醒（卡片 + 简历 PDF + 卡片链接）。
 * 任何一步失败都不抛异常，返回结构化结果供调用方记录。
 */
export async function sendInterviewerInterviewReminder(
  env: any,
  db: D1Database,
  input: SendInterviewReminderInput,
  deps: InterviewReminderDeps,
): Promise<SendInterviewReminderResult> {
  const empty: Omit<SendInterviewReminderResult, 'reason'> = {
    ok: false, interviewerName: null, cardLinkUrl: null, cardSent: false, fileSent: false,
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

    // 1) 面试卡片固定链接（一个简历一个链接；生成失败不阻塞提醒主流程）
    const resumeId = typeof source.resume?.id === 'string' ? text(source.resume.id) : '';
    let cardLinkUrl: string | null = null;
    try {
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
      // 卡片链接生成失败仅影响按钮，不影响卡片/PDF 发送
    }

    // 2) 简历 PDF（有则附带，失败不阻塞）
    const resumeFile = resumeId
      ? await deps.getResumeFileBytes(env, resumeId)
      : { bytes: null, fileName: 'resume.pdf' };

    // 3) 发送（卡片 + PDF）
    const delivery = await deliverInterviewReminder({
      userToken: token,
      resourceToken: await deps.getBotToken(env),
      receiverOpenId: openId,
      view: buildInterviewReminderView(source),
      operatorName: input.operatorName || '系统',
      file: resumeFile.bytes ? { bytes: resumeFile.bytes, fileName: resumeFile.fileName } : undefined,
      cardLink: cardLinkUrl,
    }, {
      fetch,
      refreshUserToken: input.userEmail && deps.refreshUserToken
        ? () => deps.refreshUserToken!(input.userEmail!)
        : undefined,
    });

    return {
      ok: delivery.cardSent,
      interviewerName,
      cardLinkUrl,
      cardSent: delivery.cardSent,
      fileSent: delivery.fileSent,
      reason: delivery.warning || undefined,
    };
  } catch (e: any) {
    return { ...empty, reason: e?.message || String(e) };
  }
}
