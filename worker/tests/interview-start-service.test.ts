import { describe, expect, it } from 'vitest';
import { hashPublicToken } from '../src/business-screening/token';
import {
  frontendBaseUrl,
  interviewTypeLabel,
  loadInterviewStartContext,
  resolveEventTimeframe,
  sendCandidateInterviewEmail,
  type InterviewStartInterview,
} from '../src/interview-start/service';
import { buildInterviewInvitationEmail } from '../src/interview-start/email-template';

/**
 * 「开始面试」服务层测试：面试时间解析（北京时间）、
 * 上下文加载（候选人邮箱兜底）、候选人邮件状态、邮件模板内容。
 */

function fakeD1(rows: { interviews?: any[]; resumes?: any[]; configs?: any[]; updates?: any[] }) {
  const db: any = {
    updates: [] as any[],
    prepare(sql: string) {
      const make = (params: any[]) => ({
        bind: (...args: any[]) => make(args),
        first: async () => {
          if (sql.includes('FROM interviews WHERE id = ?')) {
            return (rows.interviews || []).find((r) => r.id === params[0]) || null;
          }
          if (sql.includes('FROM resumes WHERE id = ?')) {
            return (rows.resumes || []).find((r) => r.id === params[0]) || null;
          }
          if (sql.includes('FROM system_configs')) {
            return rows.configs?.[0] || null;
          }
          return null;
        },
        run: async () => {
          db.updates.push({ sql, params });
          return { meta: {} };
        },
      });
      return make([]);
    },
  };
  return db as unknown as D1Database;
}

const NOW = '2026-08-19T04:00:00.000Z'; // 北京时间 12:00

describe('resolveEventTimeframe（北京时间口径）', () => {
  it('裸 "YYYY-MM-DD HH:mm" 按 +08:00 解析', () => {
    const frame = resolveEventTimeframe({ id: 'x', interview_time: '2026-08-20 14:00' }, Date.parse('2026-08-19T04:00:00Z'));
    expect(frame.startTs).toBe(Math.floor(Date.parse('2026-08-20T14:00:00+08:00') / 1000));
    expect(frame.endTs - frame.startTs).toBe(3600);
    expect(frame.timeLabel).toBe('2026-08-20 14:00 ~ 2026-08-20 15:00');
  });

  it('已过期时间回退为当前时间起算', () => {
    const nowMs = Date.parse('2026-08-19T04:00:00Z');
    const frame = resolveEventTimeframe({ id: 'x', interview_time: '2026-08-01 10:00' }, nowMs);
    expect(frame.startTs).toBe(Math.floor(nowMs / 1000));
  });

  it('时间缺失回退为当前时间', () => {
    const nowMs = Date.parse('2026-08-19T04:00:00Z');
    const frame = resolveEventTimeframe({ id: 'x' }, nowMs);
    expect(frame.startTs).toBe(Math.floor(nowMs / 1000));
    expect(frame.endTs - frame.startTs).toBe(3600);
  });

  it('带时区的 ISO 串直接解析', () => {
    const frame = resolveEventTimeframe({ id: 'x', interview_time: '2026-08-20T06:00:00Z' }, Date.parse('2026-08-19T04:00:00Z'));
    expect(frame.startTs).toBe(Math.floor(Date.parse('2026-08-20T06:00:00Z') / 1000));
    // 展示为北京时间 14:00
    expect(frame.timeLabel).toBe('2026-08-20 14:00 ~ 2026-08-20 15:00');
  });
});

describe('interviewTypeLabel / frontendBaseUrl', () => {
  it('类型映射与兜底', () => {
    expect(interviewTypeLabel({ id: 'x', interview_type: 'onsite' })).toBe('现场面试');
    expect(interviewTypeLabel({ id: 'x', interview_type: 'video' })).toBe('线上面试');
    expect(interviewTypeLabel({ id: 'x' })).toBe('线上面试');
    expect(interviewTypeLabel({ id: 'x', interview_type: '电话初筛' })).toBe('电话初筛');
  });

  it('frontend_url 去尾斜杠，空值回退默认域名', () => {
    expect(frontendBaseUrl('https://example.com/')).toBe('https://example.com');
    expect(frontendBaseUrl(null)).toBe('https://ai-interview-88r.pages.dev');
    expect(frontendBaseUrl('  ')).toBe('https://ai-interview-88r.pages.dev');
  });
});

describe('loadInterviewStartContext', () => {
  it('邮箱优先 resumes.email 列，缺失时从 parsed_data 兜底', async () => {
    const db = fakeD1({
      interviews: [{ id: 'itv-1', resume_id: 'r-1', candidate_name: '张三', position_applied: '岗位A' }],
      resumes: [{ id: 'r-1', candidate_name: '张三', position_applied: '岗位A', email: 'a@qq.com' }],
    });
    const ctx = await loadInterviewStartContext(db, 'itv-1');
    expect(ctx!.candidateEmail).toBe('a@qq.com');

    const db2 = fakeD1({
      interviews: [{ id: 'itv-1', resume_id: 'r-1' }],
      resumes: [{ id: 'r-1', parsed_data: JSON.stringify({ email: 'b@163.com' }) }],
    });
    const ctx2 = await loadInterviewStartContext(db2, 'itv-1');
    expect(ctx2!.candidateEmail).toBe('b@163.com');
  });

  it('岗位名回退顺序：resumes.position_applied → mapped_position → interview.position_applied', async () => {
    const db = fakeD1({
      interviews: [{ id: 'itv-1', resume_id: 'r-1', position_applied: '兜底岗位' }],
      resumes: [{ id: 'r-1', mapped_position: '映射岗位' }],
    });
    const ctx = await loadInterviewStartContext(db, 'itv-1');
    expect(ctx!.positionName).toBe('映射岗位');
  });

  it('面试记录不存在返回 null', async () => {
    const ctx = await loadInterviewStartContext(fakeD1({}), 'missing');
    expect(ctx).toBeNull();
  });
});

describe('sendCandidateInterviewEmail', () => {
  const baseCtx = {
    interview: { id: 'itv-1', interview_time: '2026-08-20 14:00', interview_type: 'video', primary_interviewer: '李四' },
    candidateEmail: 'cand@qq.com',
    candidateName: '张三',
    positionName: '前端工程师',
  };

  it('无邮箱 → skipped 并给出原因', async () => {
    const result = await sendCandidateInterviewEmail(fakeD1({}), {
      ctx: { ...baseCtx, candidateEmail: null }, meetingUrl: null, fromName: '招聘系统', nowIso: NOW,
    });
    expect(result.status).toBe('skipped');
    expect(result.reason).toContain('邮箱');
  });

  it('SMTP 未配置 → skipped', async () => {
    const result = await sendCandidateInterviewEmail(fakeD1({ configs: [{}] }), {
      ctx: baseCtx, meetingUrl: null, fromName: '招聘系统', nowIso: NOW,
    });
    expect(result.status).toBe('skipped');
    expect(result.reason).toContain('SMTP');
  });

  it('发送成功 → sent 并记录发送时间', async () => {
    const db = fakeD1({
      configs: [{ smtp_host: 'smtp.qq.com', smtp_port: 465, smtp_username: 'hr@qq.com', smtp_password: 'c', mail_from: 'hr@qq.com', mail_from_name: 'XX招聘', mail_enabled: 1 }],
    });
    const sent: any[] = [];
    const replies = ['220 ready', '250 ok', '334 VXNlcm5hbWU6', '334 UGFzc3dvcmQ6', '235 ok', '250 ok', '250 ok', '354 go', '250 queued', '221 bye'];
    const result = await sendCandidateInterviewEmail(db, {
      ctx: baseCtx, meetingUrl: 'https://vc.feishu.cn/j/abc', fromName: 'XX招聘', nowIso: NOW,
    }, {
      openTransport: async () => ({
        writeLine: async (line: string) => { sent.push(line); },
        readLine: async () => replies.shift() ?? null,
        upgradeTls: async () => {},
        close: async () => {},
      }),
    });
    expect(result.status).toBe('sent');
    // 邮件内容包含会议链接与邀请链接（正文为 76 列折行的 Base64，按段拼接后解码校验）
    const dataIdx = sent.indexOf('DATA');
    const message = sent[dataIdx + 1] as string;
    const decodedParts: string[] = [];
    let buffer = '';
    for (const line of message.split('\r\n')) {
      if (/^[A-Za-z0-9+/=]+$/.test(line) && line.length > 0) {
        buffer += line;
      } else {
        if (buffer) {
          try { decodedParts.push(Buffer.from(buffer, 'base64').toString('utf8')); } catch { /* ignore */ }
          buffer = '';
        }
        decodedParts.push(line);
      }
    }
    if (buffer) { try { decodedParts.push(Buffer.from(buffer, 'base64').toString('utf8')); } catch { /* ignore */ } }
    const decoded = decodedParts.join('\n');
    expect(decoded).toContain('vc.feishu.cn/j/abc');
    // 邮件只含会议链接，不附带候选人免登录详情链接
    expect(decoded).not.toContain('ii-');
    expect(decoded).not.toContain('interview-invite');
    // 记录 invite_email_sent_at
    const update = (db as any).updates.find((u: any) => u.sql.includes('invite_email_sent_at'));
    expect(update).toBeTruthy();
    expect(update.params[0]).toBe(NOW);
  });

  it('SMTP 应答失败 → failed', async () => {
    const db = fakeD1({
      configs: [{ smtp_host: 'a', smtp_port: 465, smtp_username: 'b', smtp_password: 'c', mail_from: 'd@e.com', mail_from_name: 'n', mail_enabled: 1 }],
    });
    const result = await sendCandidateInterviewEmail(db, {
      ctx: baseCtx, meetingUrl: null, fromName: 'n', nowIso: NOW,
    }, {
      openTransport: async () => ({
        writeLine: async () => {},
        readLine: async () => '535 auth failed',
        upgradeTls: async () => {},
        close: async () => {},
      }),
    });
    expect(result.status).toBe('failed');
    expect(result.reason).toContain('535');
  });
});

describe('buildInterviewInvitationEmail', () => {
  it('主题与正文包含关键信息', () => {
    const email = buildInterviewInvitationEmail({
      candidateName: '张三', positionName: '前端工程师', timeLabel: '2026-08-20 14:00 ~ 15:00',
      interviewTypeLabel: '线上面试', location: null, interviewerName: '李四',
      meetingUrl: 'https://vc.feishu.cn/j/abc', fromName: 'XX招聘',
    });
    expect(email.subject).toContain('张三');
    expect(email.subject).toContain('前端工程师');
    expect(email.html).toContain('https://vc.feishu.cn/j/abc');
    expect(email.html).not.toContain('ii-token');
    expect(email.html).not.toContain('interview-invite');
    expect(email.html).toContain('李四');
    expect(email.html).toContain('提前 10 分钟');
    expect(email.text).toContain('https://vc.feishu.cn/j/abc');
    expect(email.text).not.toContain('ii-token');
    expect(email.text).toContain('张三');
  });

  it('无会议链接时给出行外提示', () => {
    const email = buildInterviewInvitationEmail({
      candidateName: '张三', positionName: 'P', timeLabel: 'T', meetingUrl: null, fromName: 'F',
    });
    expect(email.html).toContain('会议链接将另行提供');
  });
});
