import type { InterviewNotificationChannel, InterviewNotificationStatus } from './types';

export type NotificationTemplateKey = 'scheduled' | 'reminder_30m' | 'rescheduled' | 'cancelled';

export interface NotificationInterview {
  id: string;
  version?: number | null;
  primary_interviewer?: string | null;
  secondary_interviewer?: string | null;
  candidate_email?: string | null;
}

export interface NotificationDelivery {
  channel: InterviewNotificationChannel;
  recipientType: 'primary_interviewer' | 'secondary_interviewer' | 'candidate' | 'hr';
  recipientId: string;
  send: () => Promise<{ status: InterviewNotificationStatus; externalMessageId?: string; lastError?: string }>;
}

export interface NotificationDeps {
  repo: {
    createOrGetNotification(input: Record<string, unknown>): Promise<any>;
    finishNotification(notificationId: string, outcome: Record<string, unknown>): Promise<void>;
  };
  buildDeliveries: (interview: NotificationInterview, templateKey: NotificationTemplateKey) => NotificationDelivery[];
}

export function notificationDedupeKey(input: {
  interviewId: string;
  version: number;
  templateKey: NotificationTemplateKey;
  channel: InterviewNotificationChannel;
  recipientId: string;
}): string {
  return [input.interviewId, `v${input.version}`, input.templateKey, input.channel, input.recipientId || 'missing'].join(':');
}

export async function deliverInterviewNotifications(
  interview: NotificationInterview,
  templateKey: NotificationTemplateKey,
  deps: NotificationDeps,
): Promise<{ status: 'succeeded' | 'partial'; channels: Record<InterviewNotificationChannel, InterviewNotificationStatus> }> {
  const channels = {} as Record<InterviewNotificationChannel, InterviewNotificationStatus>;
  const version = Number(interview.version || 1);
  for (const delivery of deps.buildDeliveries(interview, templateKey)) {
    const key = notificationDedupeKey({
      interviewId: interview.id,
      version,
      templateKey,
      channel: delivery.channel,
      recipientId: delivery.recipientId,
    });
    const record = await deps.repo.createOrGetNotification({
      interviewId: interview.id,
      channel: delivery.channel,
      recipientType: delivery.recipientType,
      recipientId: delivery.recipientId,
      templateKey,
      interviewVersion: version,
      dedupeKey: key,
    });
    if (record.status === 'sent' || record.status === 'skipped') {
      channels[delivery.channel] = record.status;
      continue;
    }
    const outcome = await delivery.send().catch((error: any) => ({
      status: 'failed' as const,
      lastError: error?.message || String(error),
    }));
    await deps.repo.finishNotification(record.id, outcome);
    channels[delivery.channel] = outcome.status;
  }
  return {
    status: Object.values(channels).includes('failed') ? 'partial' : 'succeeded',
    channels,
  };
}
