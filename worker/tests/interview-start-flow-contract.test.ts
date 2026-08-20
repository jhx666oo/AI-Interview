import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');

function routeSlice(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + 1);
  if (start < 0 || end < 0) return '';
  return source.slice(start, end);
}

const startRoute = routeSlice(
  "app.post('/api/interviews/:id/start'",
  '// 从人才库一键开始面试',
);

const scheduleDirectRoute = routeSlice(
  "app.post('/api/interviews/:id/schedule-direct'",
  '// ---- 简历上传',
);

const cronReminder = routeSlice(
  'async function runUpcomingInterviewReminders',
  'export default {',
);

describe('开始面试联动流程契约（修复死代码/提醒签名）', () => {
  it('开始面试允许待安排(awaiting_schedule)面试直接开始（系统自动找空闲订日程）', () => {
    expect(startRoute).toContain("['awaiting_schedule', 'scheduled', 'notification_partial']");
  });

  it('开始面试处理器没有提前 return 死代码，最终返回 start_flow', () => {
    // 回归：8188d46 曾在 status 更新后提前 return，导致下方联动脉冲整段成为死代码
    expect(startRoute).not.toContain('return c.json(transformRow(startedRow));');
    expect(startRoute).toContain('start_flow: startFlow');
  });

  it('开始面试联动包含：找主面试官空闲时段、建飞书会议日程、发候选人邮件、提醒面试官', () => {
    expect(startRoute).toContain('findFirstFreeInterviewSlot');
    expect(startRoute).toContain('createInterviewCalendarEvent');
    expect(startRoute).toContain('sendCandidateInterviewEmail');
    expect(startRoute).toContain('sendInterviewerInterviewReminder');
    expect(startRoute).toContain('resolveExactInterviewerOpenId');
  });

  it('全部 sendInterviewerInterviewReminder 调用点都传对象输入（第三个参数不是裸 id 字符串）', () => {
    const callCount = (source.match(/sendInterviewerInterviewReminder\(/g) || []).length;
    expect(callCount).toBeGreaterThanOrEqual(4);
    // 旧 bug 形态：sendInterviewerInterviewReminder(env, db, id, { ... }) —— 第三个参数为裸标识符后接对象字面量
    const legacyPattern = /sendInterviewerInterviewReminder\(\s*[^,]+,\s*[^,]+,\s*[A-Za-z_$][\w$]*\s*,\s*\{/;
    expect(source).not.toMatch(legacyPattern);
    // 新形态：第三个参数为对象字面量（含 interviewId 字段）
    const objectCalls = source.match(/sendInterviewerInterviewReminder\(\s*[^,]+,\s*[^,]+,\s*\{\s*(?:interviewId|\n\s*interviewId)/g) || [];
    expect(objectCalls.length).toBe(callCount);
  });

  it('schedule-direct 建日程时把主/副面试官解析为日程参与人（使 30 分钟前日程提醒可触达）', () => {
    expect(scheduleDirectRoute).toContain('resolveExactInterviewerOpenId');
    expect(scheduleDirectRoute).toContain('attendeeOpenIds');
    expect(scheduleDirectRoute).not.toContain('attendeeOpenIds: []');
  });

  it('面试前30分钟 cron 提醒同样传对象输入，且不再引用不存在的 cardSent/fileSent 字段', () => {
    expect(cronReminder).toContain('sendInterviewerInterviewReminder(env, db, {');
    expect(cronReminder).toContain('interviewId: String(row.id)');
    expect(cronReminder).not.toContain('result.cardSent');
    expect(cronReminder).not.toContain('result.fileSent');
  });
});
