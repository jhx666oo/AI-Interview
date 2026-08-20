import { processInterviewAutomationMessage } from './interview-automation/consumer';
import { InterviewAutomationRepository } from './interview-automation/repository';
import { InterviewAutomationOrchestrator, automationError, classifyAutomationError, type AutomationHandler } from './interview-automation/orchestrator';
import { executeCancelJob, executeRescheduleJob, executeScheduleJob } from './interview-automation/schedule-service';
import { advanceInterview, createInitialInterviewFromBusinessPass } from './interview-automation/advance-service';
import { deliverInterviewNotifications, type NotificationDeps, type NotificationTemplateKey } from './interview-automation/notification-service';
import { sendInterviewerInterviewReminder } from './interview-start/reminders';
import { loadInterviewStartContext, sendCandidateInterviewEmail } from './interview-start/service';
import { getFeishuToken } from './index';
import { getResumeFileBytes } from './index';
import { hashPublicToken } from './business-screening/token';
import { createAutoBusinessScreeningBatch } from './business-screening/auto-dispatch';
import { sendFeishuMessageToUser } from './index';
import type { InterviewAutomationAction, InterviewAutomationQueueMessage } from './interview-automation/types';
import type { FeishuCalendarEnv } from './interview-start/feishu-calendar';

interface AutomationEnv extends FeishuCalendarEnv {
  DB: D1Database;
  FEISHU_RECRUITMENT_CALENDAR_ID?: string;
}

function parsePayload(job: any): Record<string, unknown> {
  if (job?.payload && typeof job.payload === 'object') return job.payload;
  try { return JSON.parse(job?.payload_json || '{}'); } catch { return {}; }
}

function createNotificationDeps(env: AutomationEnv, repo: InterviewAutomationRepository): NotificationDeps {
  return {
    repo,
    buildDeliveries: (interview: any, templateKey: NotificationTemplateKey) => {
      const deliveries: any[] = [];
      const primary = String(interview.primary_interviewer || interview.interviewer || '').trim();
      const secondary = String(interview.secondary_interviewer || '').trim();
      const interviewerNames = [...new Set([primary, secondary].filter(Boolean))];
      for (const interviewerName of interviewerNames) {
        deliveries.push({
          channel: 'feishu_card',
          recipientType: interviewerName === secondary && interviewerName !== primary ? 'secondary_interviewer' : 'primary_interviewer',
          recipientId: interviewerName,
          send: async () => {
            const token = await getFeishuToken(env as any);
            const result = await sendInterviewerInterviewReminder(env, env.DB, {
              interviewId: interview.id,
              userToken: token,
              operatorName: '系统自动通知',
              interviewerName,
            }, { now: () => new Date().toISOString(), uuid: () => crypto.randomUUID(), hashPublicToken, getResumeFileBytes, getBotToken: getFeishuToken as any });
            return result.cardSent
              ? { status: 'sent' as const, externalMessageId: `${interview.id}:${interviewerName}:${templateKey}` }
              : { status: 'failed' as const, lastError: result.reason || '飞书面试提醒发送失败' };
          },
        });
        deliveries.push({
          channel: 'feishu_file',
          recipientType: interviewerName === secondary && interviewerName !== primary ? 'secondary_interviewer' : 'primary_interviewer',
          recipientId: interviewerName,
          send: async () => ({ status: 'skipped' as const, lastError: '简历 PDF 已随飞书面试卡片一并发送' }),
        });
      }
      deliveries.push({
        channel: 'email', recipientType: 'candidate', recipientId: String(interview.candidate_email || '').trim(),
        send: async () => {
          const ctx = await loadInterviewStartContext(env.DB, interview.id);
          if (!ctx) return { status: 'failed' as const, lastError: '面试记录不存在' };
          const result = await sendCandidateInterviewEmail(env.DB, { ctx, meetingUrl: interview.meeting_url || interview.meeting_link || null, fromName: 'AI智能招聘系统', nowIso: new Date().toISOString() });
          return result.status === 'sent'
            ? { status: 'sent' as const, externalMessageId: `${interview.id}:candidate:${templateKey}` }
            : result.status === 'skipped'
              ? { status: 'skipped' as const, lastError: result.reason }
              : { status: 'failed' as const, lastError: result.reason };
        },
      });
      return deliveries;
    },
  };
}

export function createProductionHandlers(env: AutomationEnv, repo: InterviewAutomationRepository): Record<InterviewAutomationAction, AutomationHandler> {
  return {
    auto_business_screening: async (job) => {
      const resumeId = String(job.resume_id || '');
      const resume = await env.DB.prepare('SELECT * FROM resumes WHERE id = ?').bind(resumeId).first<any>();
      if (!resume) throw automationError('RESUME_NOT_FOUND', '自动业务筛选找不到简历', false);
      const result = await createAutoBusinessScreeningBatch(env, resume, {
        uuid: () => crypto.randomUUID(),
        now: () => new Date().toISOString(),
        getToken: () => getFeishuToken(env as any),
        sendCard: sendFeishuMessageToUser,
      });
      return { status: 'succeeded', result };
    },
    create_next_round: async (job) => {
      const current = job.interview_id ? await repo.loadInterview(String(job.interview_id)) : null;
      if (current) return { status: 'succeeded', result: await advanceInterview(current.id, 'passed', { repo }) };
      const payload = parsePayload(job);
      const positionId = typeof payload.positionId === 'string' ? payload.positionId : undefined;
      if (!job.resume_id) throw automationError('RESUME_REQUIRED', '找不到待推进的简历记录', false);
      return {
        status: 'succeeded',
        result: await createInitialInterviewFromBusinessPass(String(job.resume_id), positionId, { repo }),
      };
    },
    schedule: async (job) => {
      const interview = await repo.requireInterview(String(job.interview_id || ''));
      const schedule = await executeScheduleJob(interview, env, { repo });
      const notifications = await deliverInterviewNotifications({ ...interview, calendar_event_id: schedule.calendarEventId, meeting_url: schedule.meetingUrl }, 'scheduled', createNotificationDeps(env, repo));
      return { status: notifications.status, schedule, notifications };
    },
    reschedule: async (job) => {
      const interview = await repo.requireInterview(String(job.interview_id || ''));
      const schedule = await executeRescheduleJob(interview, env, { repo });
      const notifications = await deliverInterviewNotifications(interview, 'rescheduled', createNotificationDeps(env, repo));
      return { status: notifications.status, schedule, notifications };
    },
    cancel: async (job) => {
      const interview = await repo.requireInterview(String(job.interview_id || ''));
      const schedule = await executeCancelJob(interview, env, { repo });
      const notifications = await deliverInterviewNotifications(interview, 'cancelled', createNotificationDeps(env, repo));
      return { status: notifications.status, schedule, notifications };
    },
    notify_interviewer: async (job) => {
      const notificationId = String(parsePayload(job).notification_id || '');
      if (!notificationId) throw automationError('NOTIFICATION_REQUIRED', '通知记录缺失', false);
      const notification = await env.DB.prepare('SELECT * FROM interview_notifications WHERE id = ?').bind(notificationId).first<any>();
      if (!notification) throw automationError('NOTIFICATION_NOT_FOUND', '通知记录不存在', false);
      const interview = await repo.requireInterview(String(notification.interview_id));
      const result = await deliverInterviewNotifications(interview, String(notification.template_key || 'scheduled') as NotificationTemplateKey, createNotificationDeps(env, repo));
      return { status: result.status, notification_id: notificationId, notifications: result };
    },
    notify_candidate: async (job) => {
      const notificationId = String(parsePayload(job).notification_id || '');
      if (!notificationId) throw automationError('NOTIFICATION_REQUIRED', '通知记录缺失', false);
      const notification = await env.DB.prepare('SELECT * FROM interview_notifications WHERE id = ?').bind(notificationId).first<any>();
      if (!notification) throw automationError('NOTIFICATION_NOT_FOUND', '通知记录不存在', false);
      const interview = await repo.requireInterview(String(notification.interview_id));
      const result = await deliverInterviewNotifications(interview, String(notification.template_key || 'scheduled') as NotificationTemplateKey, createNotificationDeps(env, repo));
      return { status: result.status, notification_id: notificationId, notifications: result };
    },
    advance: async (job) => {
      const payload = parsePayload(job);
      const result = payload.result === 'failed' ? 'failed' : 'passed';
      return { status: 'succeeded', result: await advanceInterview(String(job.interview_id || ''), result, { repo }) };
    },
  };
}

export default {
  async queue(batch: MessageBatch<InterviewAutomationQueueMessage>, env: AutomationEnv): Promise<void> {
    const repo = new InterviewAutomationRepository(env.DB, { uuid: () => crypto.randomUUID(), now: () => new Date().toISOString() });
    const orchestrator = new InterviewAutomationOrchestrator(createProductionHandlers(env, repo));
    for (const message of batch.messages) {
      const result = await processInterviewAutomationMessage(message.body, {
        repo,
        orchestrator,
        classifyError: classifyAutomationError,
      });
      if (result.status === 'queued' && result.delaySeconds) message.retry({ delaySeconds: result.delaySeconds });
      else message.ack();
    }
  },
};
