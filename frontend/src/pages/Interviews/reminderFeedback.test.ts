import { expect, it } from 'vitest';
import { getReminderFeedback } from './reminderFeedback';

it('reports complete delivery by the current Feishu user', () => {
  expect(getReminderFeedback({ card_sent: true, file_sent: true, sent_as: 'hr@example.com' }))
    .toEqual({ type: 'success', content: '已用你的飞书账号提醒面试官，并发送简历 PDF' });
});

it('returns a warning when the card arrived but the PDF failed', () => {
  expect(getReminderFeedback({ card_sent: true, file_sent: false, warning: 'PDF 上传失败' }))
    .toEqual({ type: 'warning', content: '卡片已发送，但简历 PDF 未发送：PDF 上传失败' });
});

it('asks the current user to authorize Feishu', () => {
  expect(getReminderFeedback({ need_feishu_auth: true }))
    .toEqual({ type: 'warning', content: '请先在个人设置中完成飞书授权，再发送面试提醒' });
});

it('reports the actionable interviewer binding message', () => {
  expect(getReminderFeedback({ need_bind: true, detail: '请先为面试官张三绑定飞书' }))
    .toEqual({ type: 'warning', content: '请先为面试官张三绑定飞书' });
});
