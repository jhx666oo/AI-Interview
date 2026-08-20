import { expect, it } from 'vitest';
import { getReminderFeedback } from './reminderFeedback';

it('reports complete delivery by the current Feishu user', () => {
  expect(getReminderFeedback({ ok: true, card_sent: true, card_link: 'https://example.com/card', sent_as: 'hr@example.com' }))
    .toEqual({ type: 'success', content: '已用你的飞书账号提醒面试官（含面试卡片链接）' });
});

it('keeps card delivery successful when an optional attachment warning is present', () => {
  expect(getReminderFeedback({ card_sent: true, warning: 'PDF 上传失败' }))
    .toEqual({ type: 'success', content: '已用你的飞书账号提醒面试官（含面试卡片链接）' });
});

it('asks the current user to authorize Feishu', () => {
  expect(getReminderFeedback({ need_feishu_auth: true }))
    .toEqual({ type: 'warning', content: '请先在个人设置中完成飞书授权，再发送面试提醒' });
});

it('requires authorization before sending even if a previous card flag is present', () => {
  expect(getReminderFeedback({ need_feishu_auth: true, card_sent: true }))
    .toEqual({ type: 'warning', content: '请先在个人设置中完成飞书授权，再发送面试提醒' });
});

it('reports the actionable interviewer binding message', () => {
  expect(getReminderFeedback({ need_bind: true, detail: '请先为面试官张三绑定飞书' }))
    .toEqual({ type: 'warning', content: '请先为面试官张三绑定飞书' });
});
