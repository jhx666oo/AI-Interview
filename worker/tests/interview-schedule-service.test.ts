import { describe, expect, it, vi } from 'vitest';
import { executeCancelJob, executeRescheduleJob, executeScheduleJob } from '../src/interview-automation/schedule-service';

const interview = {
  id: 'iv-1', candidate_name: '张三', position_applied: '前端工程师', round: 1,
  scheduled_start_at: '2026-08-21T02:00:00.000Z', scheduled_end_at: '2026-08-21T03:00:00.000Z',
  timezone: 'Asia/Shanghai', calendar_event_id: '', calendar_id: '', meeting_url: '',
};

function deps() {
  return {
    repo: { markScheduled: vi.fn(), markScheduleCancelled: vi.fn() },
    createCalendarEvent: vi.fn(async () => ({ eventId: 'evt-1', meetingUrl: 'https://vc.feishu.cn/j/1' })),
    updateCalendarEvent: vi.fn(async () => ({ ok: true })),
    deleteCalendarEvent: vi.fn(async () => undefined),
  };
}

describe('interview schedule service', () => {
  it('refuses automatic scheduling without a recruitment calendar id', async () => {
    await expect(executeScheduleJob(interview, {} as any, deps())).rejects.toMatchObject({ code: 'CALENDAR_NOT_CONFIGURED', retryable: false });
  });

  it('uses the configured recruitment calendar and writes the resulting event', async () => {
    const d = deps();
    const result = await executeScheduleJob(interview, { FEISHU_RECRUITMENT_CALENDAR_ID: 'recruiting-calendar' }, d);
    expect(result).toMatchObject({ calendarId: 'recruiting-calendar', calendarEventId: 'evt-1' });
    expect(d.createCalendarEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ calendarId: 'recruiting-calendar' }));
    expect(d.repo.markScheduled).toHaveBeenCalledWith('iv-1', 'recruiting-calendar', 'evt-1', 'https://vc.feishu.cn/j/1');
  });

  it('does not create a second event when an event id already exists', async () => {
    const d = deps();
    const result = await executeScheduleJob({ ...interview, calendar_event_id: 'evt-existing' }, { FEISHU_RECRUITMENT_CALENDAR_ID: 'recruiting-calendar' }, d);
    expect(result.calendarEventId).toBe('evt-existing');
    expect(d.createCalendarEvent).not.toHaveBeenCalled();
  });

  it('updates and cancels existing calendar events explicitly', async () => {
    const d = deps();
    await executeRescheduleJob({ ...interview, calendar_event_id: 'evt-1', calendar_id: 'recruiting-calendar' }, {} as any, d);
    expect(d.updateCalendarEvent).toHaveBeenCalledWith(expect.anything(), 'evt-1', expect.objectContaining({ calendarId: 'recruiting-calendar' }));
    await executeCancelJob({ ...interview, calendar_event_id: 'evt-1', calendar_id: 'recruiting-calendar' }, {} as any, d);
    expect(d.deleteCalendarEvent).toHaveBeenCalledWith(expect.anything(), 'recruiting-calendar', 'evt-1');
    expect(d.repo.markScheduleCancelled).toHaveBeenCalledWith('iv-1');
  });
});
