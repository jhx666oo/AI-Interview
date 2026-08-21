/**
 * 候选人面试邀请邮件模板（「开始面试」流程发送）。
 * 内容包含：面试时间 / 岗位 / 形式 / 地点 / 面试官、视频会议链接。
 * 中文、简单内联样式，兼容主流邮箱客户端。
 * 注意：邮件只含会议链接，不附带候选人免登录详情链接（该链接是面试官协作/评价用的）。
 */

export interface InterviewInvitationEmailInput {
  candidateName: string;
  positionName: string;
  /** 面试时间展示文案，如「2026-08-20 14:00 ~ 15:00」 */
  timeLabel: string;
  /** 形式：onsite 现场 / video 线上 */
  interviewTypeLabel?: string;
  location?: string | null;
  interviewerName?: string | null;
  /** 视频会议入会链接 */
  meetingUrl?: string | null;
  /** 是否线下面试（true 时不发会议链接，提示按地点到场） */
  offline?: boolean;
  /** 发件方名称（如公司名/招聘系统名） */
  fromName: string;
}

export interface BuiltEmail {
  subject: string;
  html: string;
  text: string;
}

const CELL_STYLE = 'padding:10px 12px;border-bottom:1px solid #EEF2F7;font-size:14px;color:#334155;';
const LABEL_STYLE = `${CELL_STYLE}width:92px;color:#64748B;white-space:nowrap;`;

function infoRow(label: string, value: string): string {
  return `<tr><td style="${LABEL_STYLE}">${label}</td><td style="${CELL_STYLE}">${value || '—'}</td></tr>`;
}

function linkButton(url: string, text: string): string {
  return `<a href="${url}" style="display:inline-block;margin:6px 0;padding:10px 22px;background:#2563EB;color:#FFFFFF;text-decoration:none;border-radius:8px;font-size:14px;">${text}</a><div style="font-size:12px;color:#94A3B8;word-break:break-all;">${url}</div>`;
}

export function buildInterviewInvitationEmail(input: InterviewInvitationEmailInput): BuiltEmail {
  const name = input.candidateName || '候选人';
  const position = input.positionName || '应聘岗位';
  const timeLabel = input.timeLabel || '待定（请与 HR 确认）';
  const typeLabel = input.interviewTypeLabel || '线上面试';
  const isOffline = input.offline === true || typeLabel === '线下面试';
  // 线上面试：附会议链接；线下面试：提示按地点到场，不发链接（offline 优先）
  let meetingLine: string;
  if (!isOffline && input.meetingUrl) {
    meetingLine = `<p style="margin:4px 0 0;">${linkButton(input.meetingUrl, '进入视频会议')}</p>`;
  } else if (isOffline) {
    meetingLine = '<p style="margin:4px 0 0;color:#94A3B8;font-size:13px;">本次为线下面试，请按上方面试地点按时到场。</p>';
  } else {
    meetingLine = '<p style="margin:4px 0 0;color:#94A3B8;font-size:13px;">会议链接将另行提供，请保持电话畅通。</p>';
  }
  const meetingSectionTitle = isOffline ? '面试安排' : '视频会议';

  const subject = `【面试邀请】${name} - ${position} ${input.timeLabel ? `（${input.timeLabel}）` : ''}`;

  const html = `<div style="font-family:'PingFang SC','Microsoft YaHei',Arial,sans-serif;max-width:640px;margin:0 auto;background:#FFFFFF;">
  <div style="background:linear-gradient(135deg,#2563EB,#1D4ED8);padding:24px 28px;border-radius:12px 12px 0 0;">
    <div style="color:#FFFFFF;font-size:20px;font-weight:600;">面试邀请</div>
    <div style="color:#BFDBFE;font-size:13px;margin-top:6px;">${input.fromName}</div>
  </div>
  <div style="padding:24px 28px;border:1px solid #E2E8F0;border-top:none;border-radius:0 0 12px 12px;">
    <p style="margin:0 0 16px;font-size:15px;color:#0F172A;">${name} 您好，感谢您应聘「${position}」。您的面试安排如下，请准时参加：</p>
    <table style="width:100%;border-collapse:collapse;background:#F8FAFC;border-radius:8px;overflow:hidden;">
      ${infoRow('面试岗位', position)}
      ${infoRow('面试时间', timeLabel)}
      ${infoRow('面试形式', typeLabel)}
      ${infoRow('面试地点', input.location || (input.meetingUrl ? '线上（见下方会议链接）' : (isOffline ? '请与 HR 确认' : '—')))}
      ${input.interviewerName ? infoRow('面试官', input.interviewerName) : ''}
    </table>
    <div style="margin-top:18px;">
      <div style="font-size:14px;font-weight:600;color:#0F172A;">${meetingSectionTitle}</div>
      ${meetingLine}
    </div>
    <div style="margin-top:20px;padding:12px 14px;background:#FFFBEB;border-radius:8px;font-size:13px;color:#92400E;line-height:1.7;">
      温馨提示：<br/>
      1. 请提前 10 分钟进入会议/到达面试地点，并准备好简历与相关材料；<br/>
      2. 如需调整时间，请直接回复本邮件或联系 HR；<br/>
      3. 本邮件由系统自动发送，请勿直接回复。
    </div>
  </div>
</div>`;

  const text = [
    `${name} 您好，感谢您应聘「${position}」。您的面试安排如下：`,
    '',
    `面试岗位：${position}`,
    `面试时间：${timeLabel}`,
    `面试形式：${typeLabel}`,
    `面试地点：${input.location || (input.meetingUrl ? '线上（见会议链接）' : (isOffline ? '请与 HR 确认' : '—'))}`,
    input.interviewerName ? `面试官：${input.interviewerName}` : '',
    '',
    input.meetingUrl ? `视频会议：${input.meetingUrl}` : (isOffline ? '本次为线下面试，请按面试地点按时到场。' : '会议链接将另行提供，请保持电话畅通。'),
    '',
    '温馨提示：请提前 10 分钟入场，如需调整时间请回复本邮件或联系 HR。',
  ].filter((line) => line !== '').join('\n');

  return { subject, html, text };
}
