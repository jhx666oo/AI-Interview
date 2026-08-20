import {
  createInterviewCalendarEvent,
  deleteInterviewCalendarEvent,
  updateInterviewCalendarEventTime,
  type FeishuCalendarEnv,
  type InterviewCalendarEventInput,
} from '../interview-start/feishu-calendar';
import { automationError } from './orchestrator';

export interface ScheduleInterviewRow {
  id: string;
  candidate_name?: string | null;
  position_applied?: string | null;
  round?: number | null;
  interview_type?: string | null;
  interview_location?: string | null;
  primary_interviewer?: string | null;
  secondary_interviewer?: string | null;
  scheduled_start_at?: string | null;
  scheduled_end_at?: string | null;
  interview_time?: string | null;
  duration_minutes?: number | null;
  timezone?: string | null;
  calendar_id?: string | null;
  calendar_event_id?: string | null;
  meeting_url?: string | null;
}

export interface ScheduleEnv extends FeishuCalendarEnv {
  FEISHU_RECRUITMENT_CALENDAR_ID?: string;
}

export interface ScheduleResult {
  calendarId: string;
  calendarEventId?: string;
  meetingUrl?: string;
  cancelled?: boolean;
  externalEventExisted?: boolean;
}

export interface ScheduleDeps {
  repo: {
    markScheduled(interviewId: string, calendarId: string, eventId: string, meetingUrl: string): Promise<void>;
    markScheduleCancelled(interviewId: string): Promise<void>;
  };
  createCalendarEvent?: (env: ScheduleEnv, input: InterviewCalendarEventInput) => Promise<{ eventId: string; meetingUrl: string | null }>;
  updateCalendarEvent?: (env: ScheduleEnv, eventId: string, input: { startTimestamp: number; endTimestamp: number; timezone?: string; calendarId?: string }) => Promise<{ ok: boolean; error?: string }>;
  deleteCalendarEvent?: (env: ScheduleEnv, calendarId: string, eventId: string) => Promise<void>;
  buildDescription?: (interview: ScheduleInterviewRow) => string;
  resolveAttendees?: (interview: ScheduleInterviewRow) => Promise<string[]>;
}

function requiredTimestamp(value: unknown, code: string): number {
  const timestamp = Date.parse(String(value || ''));
  if (!Number.isFinite(timestamp)) throw automationError(code, '面试开始和结束时间必填且格式正确', false);
  return Math.floor(timestamp / 1000);
}

function calendarIdFor(interview: ScheduleInterviewRow, env: ScheduleEnv): string {
  return String(interview.calendar_id || env.FEISHU_RECRUITMENT_CALENDAR_ID || '').trim();
}

export async function executeScheduleJob(
  interview: ScheduleInterviewRow,
  env: ScheduleEnv,
  deps: ScheduleDeps,
): Promise<ScheduleResult> {
  const calendarId = calendarIdFor(interview, env);
  if (!calendarId) throw automationError('CALENDAR_NOT_CONFIGURED', '未配置招聘日历', false);
  const startTimestamp = requiredTimestamp(interview.scheduled_start_at, 'INTERVIEW_TIME_REQUIRED');
  const endTimestamp = requiredTimestamp(interview.scheduled_end_at, 'INTERVIEW_TIME_REQUIRED');
  if (endTimestamp <= startTimestamp) throw automationError('INTERVIEW_TIME_INVALID', '面试结束时间必须晚于开始时间', false);
  if (interview.calendar_event_id) {
    return { calendarId, calendarEventId: interview.calendar_event_id, meetingUrl: interview.meeting_url || '' };
  }

  const create = deps.createCalendarEvent || (async (targetEnv, input) => {
    const result = await createInterviewCalendarEvent(targetEnv, input);
    return { eventId: result.eventId, meetingUrl: result.meetingUrl };
  });
  const event = await create(env, {
    calendarId,
    summary: `面试 - ${interview.candidate_name || '候选人'} - ${interview.position_applied || '应聘岗位'} - 第${interview.round || 1}轮`,
    description: deps.buildDescription?.(interview) || 'AI Interview 面试安排',
    startTimestamp,
    endTimestamp,
    timezone: interview.timezone || 'Asia/Shanghai',
    attendeeOpenIds: await (deps.resolveAttendees?.(interview) || Promise.resolve([])),
  });
  await deps.repo.markScheduled(interview.id, calendarId, event.eventId, event.meetingUrl || '');
  return { calendarId, calendarEventId: event.eventId, meetingUrl: event.meetingUrl || '' };
}

export async function executeRescheduleJob(
  interview: ScheduleInterviewRow,
  env: ScheduleEnv,
  deps: ScheduleDeps,
): Promise<ScheduleResult> {
  if (!interview.calendar_event_id) return executeScheduleJob(interview, env, deps);
  const calendarId = calendarIdFor(interview, env);
  if (!calendarId) throw automationError('CALENDAR_NOT_CONFIGURED', '未配置招聘日历', false);
  const startTimestamp = requiredTimestamp(interview.scheduled_start_at, 'INTERVIEW_TIME_REQUIRED');
  const endTimestamp = requiredTimestamp(interview.scheduled_end_at, 'INTERVIEW_TIME_REQUIRED');
  if (endTimestamp <= startTimestamp) throw automationError('INTERVIEW_TIME_INVALID', '面试结束时间必须晚于开始时间', false);
  const update = deps.updateCalendarEvent || (async (targetEnv, eventId, input) => updateInterviewCalendarEventTime(targetEnv, eventId, input));
  const result = await update(env, interview.calendar_event_id, {
    calendarId,
    startTimestamp,
    endTimestamp,
    timezone: interview.timezone || 'Asia/Shanghai',
  });
  if (!result.ok) throw automationError('CALENDAR_UPDATE_FAILED', result.error || '飞书日程更新失败', true);
  await deps.repo.markScheduled(interview.id, calendarId, interview.calendar_event_id, interview.meeting_url || '');
  return { calendarId, calendarEventId: interview.calendar_event_id, meetingUrl: interview.meeting_url || '' };
}

export async function executeCancelJob(
  interview: ScheduleInterviewRow,
  env: ScheduleEnv,
  deps: ScheduleDeps,
): Promise<ScheduleResult> {
  const calendarId = calendarIdFor(interview, env);
  if (interview.calendar_id && interview.calendar_event_id) {
    const remove = deps.deleteCalendarEvent || deleteInterviewCalendarEvent;
    await remove(env, calendarId, interview.calendar_event_id);
  }
  await deps.repo.markScheduleCancelled(interview.id);
  return { calendarId, cancelled: true, externalEventExisted: Boolean(interview.calendar_event_id) };
}
