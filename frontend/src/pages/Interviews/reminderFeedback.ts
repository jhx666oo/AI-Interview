export interface ReminderDeliveryResponse {
  card_sent?: boolean;
  file_sent?: boolean;
  sent_as?: string;
  warning?: string | null;
  detail?: string;
  need_bind?: boolean;
  need_feishu_auth?: boolean;
}

export function getReminderFeedback(response: ReminderDeliveryResponse) {
  if (response.need_feishu_auth && response.card_sent && !response.file_sent) {
    return {
      type: 'warning' as const,
      content: '面试提醒卡片已发送；飞书授权已失效，简历 PDF 未发送。请重新授权，勿重复发送整条提醒',
    };
  }
  if (response.need_feishu_auth) {
    return { type: 'warning' as const, content: '请先在个人设置中完成飞书授权，再发送面试提醒' };
  }
  if (response.need_bind) {
    return {
      type: 'warning' as const,
      content: response.detail || '面试官尚未绑定飞书，请先在系统设置 → 面试官管理中配置',
    };
  }
  if (response.card_sent && response.file_sent) {
    return { type: 'success' as const, content: '已用你的飞书账号提醒面试官，并发送简历 PDF' };
  }
  return {
    type: 'warning' as const,
    content: `卡片已发送，但简历 PDF 未发送：${response.warning || '附件暂不可用'}`,
  };
}
