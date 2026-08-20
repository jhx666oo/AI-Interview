export interface ReminderDeliveryResponse {
  ok?: boolean;
  card_sent?: boolean;
  card_link?: string | null;
  sent_as?: string;
  warning?: string | null;
  detail?: string;
  need_bind?: boolean;
  need_feishu_auth?: boolean;
}

export function getReminderFeedback(response: ReminderDeliveryResponse) {
  if (response.need_feishu_auth) {
    return { type: 'warning' as const, content: '请先在个人设置中完成飞书授权，再发送面试提醒' };
  }
  if (response.need_bind) {
    return {
      type: 'warning' as const,
      content: response.detail || '面试官尚未绑定飞书，请先在系统设置 → 面试官管理中配置',
    };
  }
  if (response.ok || response.card_sent) {
    return { type: 'success' as const, content: '已用你的飞书账号提醒面试官（含面试卡片链接）' };
  }
  return {
    type: 'warning' as const,
    content: response.detail || '发送失败，请重试',
  };
}
