import { describe, expect, it, vi } from 'vitest';
import { deliverInterviewNotifications, notificationDedupeKey, type NotificationDelivery } from '../src/interview-automation/notification-service';

function repoWith(records: Record<string, any>[] = []) {
  return {
    records,
    createOrGetNotification: vi.fn(async (input: any) => {
      const existing = records.find((row) => row.dedupe_key === input.dedupeKey);
      if (existing) return { ...existing, created: false };
      const row = { id: `n-${records.length + 1}`, dedupe_key: input.dedupeKey, status: 'queued', ...input };
      records.push(row);
      return { ...row, created: true };
    }),
    finishNotification: vi.fn(async (id: string, outcome: any) => {
      const row = records.find((item) => item.id === id);
      if (row) Object.assign(row, outcome);
    }),
  };
}

describe('interview notification service', () => {
  it('records card success, pdf failure and email success independently', async () => {
    const repo = repoWith();
    const deliveries: NotificationDelivery[] = [
      { channel: 'feishu_card', recipientType: 'primary_interviewer', recipientId: 'ou-1', send: async () => ({ status: 'sent', externalMessageId: 'msg-card' }) },
      { channel: 'feishu_file', recipientType: 'primary_interviewer', recipientId: 'ou-1', send: async () => ({ status: 'failed', lastError: 'upload timeout' }) },
      { channel: 'email', recipientType: 'candidate', recipientId: 'candidate@example.com', send: async () => ({ status: 'sent', externalMessageId: 'smtp-message' }) },
    ];
    const result = await deliverInterviewNotifications({ id: 'iv-1', version: 1 }, 'scheduled', { repo, buildDeliveries: () => deliveries });
    expect(result.status).toBe('partial');
    expect(result.channels).toEqual({ feishu_card: 'sent', feishu_file: 'failed', email: 'sent' });
    expect(repo.finishNotification).toHaveBeenCalledTimes(3);
  });

  it('does not resend successful channels for the same interview version', async () => {
    const key = notificationDedupeKey({ interviewId: 'iv-1', version: 1, templateKey: 'scheduled', channel: 'feishu_card', recipientId: 'ou-1' });
    const repo = repoWith([{ id: 'n-1', dedupe_key: key, status: 'sent' }]);
    const send = vi.fn(async () => ({ status: 'sent' as const }));
    const result = await deliverInterviewNotifications({ id: 'iv-1', version: 1 }, 'scheduled', {
      repo,
      buildDeliveries: () => [{ channel: 'feishu_card', recipientType: 'primary_interviewer', recipientId: 'ou-1', send }],
    });
    expect(result.channels.feishu_card).toBe('sent');
    expect(send).not.toHaveBeenCalled();
  });

  it('marks missing candidate email as skipped without failing scheduling', async () => {
    const repo = repoWith();
    const result = await deliverInterviewNotifications({ id: 'iv-1', version: 1, candidate_email: '' }, 'scheduled', {
      repo,
      buildDeliveries: () => [{ channel: 'email', recipientType: 'candidate', recipientId: 'missing', send: async () => ({ status: 'skipped', lastError: 'missing candidate email' }) }],
    });
    expect(result.channels.email).toBe('skipped');
    expect(result.status).toBe('succeeded');
  });
});
