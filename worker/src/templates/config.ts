/**
 * 对外消息模板配置（系统设置 → 消息模板 可在线编辑）。
 *
 * 覆盖所有发送给外部/他人的内容：候选人面试邀请邮件、面试官提醒文本等。
 * 存储于 system_configs.template_configs（JSON 字符串），未配置时回退到 DEFAULT_TEMPLATES。
 * 模板内支持 {{占位符}} 插值，具体可用占位符见各模板下方注释。
 */

export type TemplateVars = Record<string, string>;

/** 渲染模板：{{key}} 替换为 vars[key]，未知占位符替换为空串 */
export function renderTemplate(template: string | null | undefined, vars: TemplateVars = {}): string {
  if (!template) return '';
  return template.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_, key: string) => {
    const value = vars[key];
    return value === undefined || value === null ? '' : value;
  });
}

export interface DefaultTemplates {
  /** 候选人面试邀请邮件 —— 主题 */
  candidate_email_subject: string;
  /** 候选人面试邀请邮件 —— HTML 正文（{{meetingSection}} 由系统生成：线上=会议按钮 / 线下=地点提示） */
  candidate_email_html: string;
  /** 候选人面试邀请邮件 —— 纯文本正文 */
  candidate_email_text: string;
  /** 面试官面试提醒（飞书文本消息）—— 会议链接/地点/卡片链接行由系统自动追加 */
  interviewer_reminder: string;
  /** 业务筛选推送卡片 —— 标题（发给业务负责人，{{position}} 岗位名） */
  business_card_title: string;
  /** 业务筛选推送卡片 —— 正文（{{count}} 简历份数，{{position}} 岗位名） */
  business_card_body: string;
  /** 业务筛选推送卡片 —— 按钮文案 */
  business_card_button: string;
  /** 面试安排通知卡片（发给面试官）—— 标题 */
  interview_notice_title: string;
  /** 面试安排通知卡片 —— 正文（{{operatorName}} 操作人，{{candidateName}} 候选人，{{position}} 岗位） */
  interview_notice_body: string;
  /** 面试安排通知卡片 —— 查看候选人按钮文案 */
  interview_notice_button: string;
  /** 面试安排提醒群卡片 —— 标题（{{candidateName}} 候选人，{{position}} 岗位） */
  interview_group_notice_title: string;
  /** 面试安排提醒群卡片 —— 引导语（发给招聘群） */
  interview_group_notice_body: string;
  /** 新候选人推送卡片 —— 标题（发给招聘群，{{candidateName}} 候选人） */
  new_candidate_card_title: string;
  /** 飞书卡片统一落款（note 行） */
  card_footer: string;
  [key: string]: string;
}

export const DEFAULT_TEMPLATES: DefaultTemplates = {
  candidate_email_subject: '【面试邀请】{{candidateName}} - {{position}}（{{timeLabel}}）',

  candidate_email_html: `<div style="font-family:'PingFang SC','Microsoft YaHei',Arial,sans-serif;max-width:640px;margin:0 auto;background:#FFFFFF;">
  <div style="background:linear-gradient(135deg,#2563EB,#1D4ED8);padding:24px 28px;border-radius:12px 12px 0 0;">
    <div style="color:#FFFFFF;font-size:20px;font-weight:600;">面试邀请</div>
    <div style="color:#BFDBFE;font-size:13px;margin-top:6px;">{{fromName}}</div>
  </div>
  <div style="padding:24px 28px;border:1px solid #E2E8F0;border-top:none;border-radius:0 0 12px 12px;">
    <p style="margin:0 0 16px;font-size:15px;color:#0F172A;">{{candidateName}} 您好，感谢您应聘「{{position}}」。您的面试安排如下，请准时参加：</p>
    <table style="width:100%;border-collapse:collapse;background:#F8FAFC;border-radius:8px;overflow:hidden;">
      <tr><td style="padding:10px 12px;border-bottom:1px solid #EEF2F7;font-size:14px;color:#64748B;width:92px;">面试岗位</td><td style="padding:10px 12px;border-bottom:1px solid #EEF2F7;font-size:14px;color:#334155;">{{position}}</td></tr>
      <tr><td style="padding:10px 12px;border-bottom:1px solid #EEF2F7;font-size:14px;color:#64748B;width:92px;">面试时间</td><td style="padding:10px 12px;border-bottom:1px solid #EEF2F7;font-size:14px;color:#334155;">{{timeLabel}}</td></tr>
      <tr><td style="padding:10px 12px;border-bottom:1px solid #EEF2F7;font-size:14px;color:#64748B;width:92px;">面试形式</td><td style="padding:10px 12px;border-bottom:1px solid #EEF2F7;font-size:14px;color:#334155;">{{typeLabel}}</td></tr>
      <tr><td style="padding:10px 12px;border-bottom:1px solid #EEF2F7;font-size:14px;color:#64748B;width:92px;">面试地点</td><td style="padding:10px 12px;border-bottom:1px solid #EEF2F7;font-size:14px;color:#334155;">{{location}}</td></tr>
      {{interviewerRow}}
    </table>
    <div style="margin-top:18px;">
      <div style="font-size:14px;font-weight:600;color:#0F172A;">{{meetingSectionTitle}}</div>
      {{meetingSection}}
    </div>
    <div style="margin-top:20px;padding:12px 14px;background:#FFFBEB;border-radius:8px;font-size:13px;color:#92400E;line-height:1.7;">
      温馨提示：<br/>
      1. 请提前 10 分钟进入会议/到达面试地点，并准备好简历与相关材料；<br/>
      2. 如需调整时间，请直接回复本邮件或联系 HR；<br/>
      3. 本邮件由系统自动发送，请勿直接回复。
    </div>
  </div>
</div>`,

  candidate_email_text: [
    '{{candidateName}} 您好，感谢您应聘「{{position}}」。您的面试安排如下：',
    '',
    '面试岗位：{{position}}',
    '面试时间：{{timeLabel}}',
    '面试形式：{{typeLabel}}',
    '面试地点：{{location}}',
    '{{interviewerText}}',
    '',
    '{{meetingText}}',
    '',
    '温馨提示：请提前 10 分钟入场，如需调整时间请回复本邮件或联系 HR。',
  ].join('\n'),

  interviewer_reminder: '面试提醒：{{candidateName}}\n岗位：{{position}}\n面试时间：{{interviewTime}}',

  business_card_title: '简历筛选待处理：{{position}}',
  business_card_body: '您有 {{count}} 份候选人简历待处理，已统一汇总到待筛选列表，请点击链接完成筛选',
  business_card_button: '进入待筛选简历',
  interview_notice_title: '🎯 面试安排通知',
  interview_notice_body: '{{operatorName}} 为候选人安排了面试，请留意后续会议邀请，及时查看候选人简历，面试结束后在系统内填写评价。',
  interview_notice_button: '🔍 查看候选人',
  interview_group_notice_title: '🎯 面试安排提醒',
  interview_group_notice_body: '请相关面试官尽快安排面试。',
  new_candidate_card_title: '🆕 新候选人：{{candidateName}}',
  card_footer: '发送自 招聘管理智能小助手',
};

/** 从 system_configs 读取模板配置，未配置/解析失败时回退默认模板（与线上覆盖合并） */
export async function loadTemplates(db: D1Database): Promise<DefaultTemplates> {
  const merged: DefaultTemplates = { ...DEFAULT_TEMPLATES };
  try {
    const row = await db.prepare(
      'SELECT template_configs FROM system_configs ORDER BY updated_at DESC LIMIT 1',
    ).first() as any;
    if (row?.template_configs) {
      const configs = JSON.parse(row.template_configs);
      if (configs && typeof configs === 'object') {
        for (const key of Object.keys(DEFAULT_TEMPLATES)) {
          const value = configs[key];
          if (typeof value === 'string' && value.trim() !== '') merged[key] = value;
        }
      }
    }
  } catch { /* 配置解析失败回退默认 */ }
  return merged;
}
