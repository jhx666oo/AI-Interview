import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildInterviewReminderCard,
  buildInterviewReminderView,
  deliverInterviewReminder,
} from '../src/feishu-notifications/interview-reminder';
import {
  loadInterviewReminderSource,
  resolveExactInterviewerOpenId,
  resolveReminderInterviewer,
} from '../src/feishu-notifications/reminder-source';
import { saveRefreshedUserToken } from '../src/feishu-notifications/user-token-storage';

const completeView = {
  name: '张三', education: '本科', age: 29, gender: '女', position: '社区运营',
  interviewTime: '2026-08-11 10:00', city: '北京', aiAdvice: '建议核实稳定性',
};

const deliveryInput = {
  userToken: 'user-token', resourceToken: 'tenant-token', receiverOpenId: 'ou_receiver',
  view: completeView, operatorName: '金皓翔',
  file: { bytes: new Uint8Array([1, 2, 3]), fileName: '张三.pdf' },
};

describe('interview reminders', () => {
  it('loads the resume by interview resume_id and attaches screening and task data', async () => {
    const queries: string[] = [];
    const db = {
      prepare(sql: string) {
        queries.push(sql);
        return {
          bind(...values: unknown[]) {
            return {
              first: async () => {
                if (sql.includes('FROM interviews')) return { id: 'iv-1', resume_id: 'resume-1', candidate_name: '请求体不可信', position_id: 'task-1' };
                if (sql.includes('FROM resumes')) return { id: values[0], candidate_name: '数据库候选人' };
                if (sql.includes('FROM resume_screening_queue')) return { resume_id: values[0], city: '北京' };
                if (sql.includes('FROM recruitment_tasks')) return { id: values[0], position_name: '社区运营' };
                return null;
              },
              all: async () => ({ results: [] }),
            };
          },
        };
      },
    };

    await expect(loadInterviewReminderSource(db as never, 'iv-1')).resolves.toMatchObject({
      interview: { id: 'iv-1' },
      resume: { id: 'resume-1', candidate_name: '数据库候选人' },
      screening: { resume_id: 'resume-1' },
      recruitmentTask: { id: 'task-1' },
    });
    expect(queries.filter((sql) => sql.includes('candidate_name = ?'))).toHaveLength(0);
  });

  it('rejects an ambiguous legacy candidate-name resume match', async () => {
    const db = {
      prepare(sql: string) {
        return {
          bind() {
            return {
              first: async () => sql.includes('FROM interviews')
                ? { id: 'iv-legacy', resume_id: '', candidate_name: '同名候选人' }
                : null,
              all: async () => ({ results: sql.includes('FROM resumes')
                ? [{ id: 'resume-1' }, { id: 'resume-2' }]
                : [] }),
            };
          },
        };
      },
    };

    await expect(loadInterviewReminderSource(db as never, 'iv-legacy')).rejects.toMatchObject({
      code: 'AMBIGUOUS_RESUME',
    });
  });

  it('only accepts an interviewer selected from the authoritative interview row', () => {
    const interview = { interviewer: '张三、李四', primary_interviewer: '张三', secondary_interviewer: '李四' };
    expect(resolveReminderInterviewer(interview, '李四')).toBe('李四');
    expect(resolveReminderInterviewer(interview, '请求体伪造面试官')).toBeNull();
  });

  it('does not resolve 李四 to a substring-only 李四郎 binding', async () => {
    const queries: string[] = [];
    const db = {
      prepare(sql: string) {
        queries.push(sql);
        return {
          bind(name: string) {
            return {
              all: async () => ({ results: sql.includes('WHERE full_name = ?') && name === '李四郎'
                ? [{ full_name: '李四郎', feishu_open_id: 'ou_wrong' }]
                : [] }),
            };
          },
        };
      },
    };

    await expect(resolveExactInterviewerOpenId(db as never, '李四')).resolves.toBeNull();
    expect(queries.some((sql) => sql.includes('FROM users') && !sql.includes('full_name = ?'))).toBe(false);
  });

  it('rejects conflicting duplicate exact interviewer mappings', async () => {
    const db = {
      prepare(sql: string) {
        return {
          bind() {
            return {
              all: async () => ({ results: sql.includes('interviewer_mappings')
                ? [{ open_id: 'ou_one' }, { open_id: 'ou_two' }]
                : [] }),
            };
          },
        };
      },
    };

    await expect(resolveExactInterviewerOpenId(db as never, '李四')).rejects.toMatchObject({
      code: 'AMBIGUOUS_INTERVIEWER_BINDING',
    });
  });

  it('rejects conflicting exact bindings across mappings and users', async () => {
    const queries: string[] = [];
    const db = {
      prepare(sql: string) {
        queries.push(sql);
        return {
          bind() {
            return {
              all: async () => ({ results: sql.includes('interviewer_mappings')
                ? [{ open_id: 'ou_mapping' }]
                : [{ feishu_open_id: 'ou_user' }] }),
            };
          },
        };
      },
    };

    await expect(resolveExactInterviewerOpenId(db as never, '李四')).rejects.toMatchObject({
      code: 'AMBIGUOUS_INTERVIEWER_BINDING',
    });
    expect(queries.some((sql) => sql.includes('FROM users'))).toBe(true);
  });

  it('uses an exact user binding when the optional mappings table is absent', async () => {
    const db = {
      prepare(sql: string) {
        return {
          bind() {
            return {
              all: async () => {
                if (sql.includes('interviewer_mappings')) throw new Error('D1_ERROR: no such table: interviewer_mappings');
                return { results: [{ feishu_open_id: 'ou_user' }] };
              },
            };
          },
        };
      },
    };

    await expect(resolveExactInterviewerOpenId(db as never, '李四')).resolves.toBe('ou_user');
  });

  it('propagates a users-table failure even when mappings contains a match', async () => {
    const db = {
      prepare(sql: string) {
        return {
          bind() {
            return {
              all: async () => {
                if (sql.includes('interviewer_mappings')) return { results: [{ open_id: 'ou_mapping' }] };
                throw new Error('D1_ERROR: database is locked');
              },
            };
          },
        };
      },
    };

    await expect(resolveExactInterviewerOpenId(db as never, '李四')).rejects.toThrow('database is locked');
  });

  it('treats missing optional enrichment schema as null', async () => {
    const db = {
      prepare(sql: string) {
        return {
          bind() {
            return {
              first: async () => {
                if (sql.includes('FROM interviews')) return { id: 'iv-1', resume_id: 'resume-1', position_id: 'task-1' };
                if (sql.includes('FROM resumes')) return { id: 'resume-1' };
                if (sql.includes('resume_screening_queue')) throw new Error('D1_ERROR: no such table: resume_screening_queue');
                if (sql.includes('recruitment_tasks')) throw new Error('D1_ERROR: no such column: updated_at');
                return null;
              },
              all: async () => ({ results: [] }),
            };
          },
        };
      },
    };

    await expect(loadInterviewReminderSource(db as never, 'iv-1')).resolves.toMatchObject({
      screening: null,
      recruitmentTask: null,
    });
  });

  it('does not hide real optional enrichment database failures', async () => {
    const db = {
      prepare(sql: string) {
        return {
          bind() {
            return {
              first: async () => {
                if (sql.includes('FROM interviews')) return { id: 'iv-1', resume_id: 'resume-1' };
                if (sql.includes('FROM resumes')) return { id: 'resume-1' };
                if (sql.includes('resume_screening_queue')) throw new Error('D1_ERROR: database is locked');
                return null;
              },
              all: async () => ({ results: [] }),
            };
          },
        };
      },
    };

    await expect(loadInterviewReminderSource(db as never, 'iv-1')).rejects.toThrow('database is locked');
  });

  it('saves refreshed tokens on old D1 schemas without feishu_token_failed_at', async () => {
    const updates: string[] = [];
    const db = {
      prepare(sql: string) {
        updates.push(sql);
        return {
          bind() {
            return {
              run: async () => {
                if (sql.includes('feishu_token_failed_at')) {
                  throw new Error('D1_ERROR: no such column: feishu_token_failed_at');
                }
                return { success: true };
              },
            };
          },
        };
      },
    };

    await expect(saveRefreshedUserToken(db as never, {
      email: 'current@example.com',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: 123,
      updatedAt: '2026-08-10T00:00:00.000Z',
    })).resolves.toBeUndefined();
    expect(updates).toHaveLength(2);
    expect(updates[1]).not.toContain('feishu_token_failed_at');
  });

  it('declares the failed-token marker in schema and the next numbered migration', async () => {
    const [schema, migration, workerSource] = await Promise.all([
      readFile(resolve(process.cwd(), 'schema.sql'), 'utf8'),
      readFile(resolve(process.cwd(), 'migrations/0025_feishu_token_failed_at.sql'), 'utf8'),
      readFile(resolve(process.cwd(), 'src/index.ts'), 'utf8'),
    ]);

    expect(schema).toMatch(/feishu_token_failed_at TEXT/);
    expect(migration).toContain('SELECT 1');
    expect(workerSource).toContain("ALTER TABLE users ADD COLUMN feishu_token_failed_at TEXT");
  });

  it('wires the endpoint to current-user text-link delivery without candidate-body or sender fallback paths', async () => {
    const source = await readFile(resolve(process.cwd(), 'src/index.ts'), 'utf8');
    const route = source.slice(
      source.indexOf("app.post('/api/interviews/:id/notify-interviewer'"),
      source.indexOf('// ==================== 飞书事件回调'),
    );

    expect(route).toContain('loadInterviewReminderSource(c.env.DB, id)');
    expect(route).toContain('getValidUserAccessToken(c.env, currentUser.email)');
    expect(route).toContain('sendFeishuTextMessage(userToken, openId,');
    expect(route).toContain('createOrReuseInterviewCardLink(c.env.DB,');
    expect(route).toContain('resolveExactInterviewerOpenId(c.env.DB, interviewerName)');
    expect(route).toContain('need_feishu_auth: true');
    expect(route).toContain('need_bind: true');
    expect(route).not.toContain('deliverInterviewReminder');
    expect(route).not.toContain('getResumeFileBytes(c.env, resumeId)');
    expect(route).not.toContain('body.candidate_name');
    expect(route).not.toContain('sendFeishuMessageWithFallback');
    expect(route).not.toMatch(/callAI|chat\/completions/);
  });

  it('uploads PDF before sending the card and file from the current user', async () => {
    const calls: string[] = [];
    const authorizations: Array<string | null> = [];
    const contentTypes: Array<string | null> = [];

    const result = await deliverInterviewReminder(deliveryInput, {
      fetch: async (url, init) => {
        const isUpload = String(url).includes('/files');
        calls.push(isUpload ? 'upload' : JSON.parse(String(init?.body)).msg_type);
        authorizations.push(new Headers(init?.headers).get('Authorization'));
        contentTypes.push(new Headers(init?.headers).get('Content-Type'));
        return Response.json(isUpload
          ? { code: 0, data: { file_key: 'file-key' } }
          : { code: 0, data: { message_id: 'message-id' } });
      },
    });

    expect(calls).toEqual(['upload', 'interactive', 'file']);
    expect(authorizations).toEqual(['Bearer tenant-token', 'Bearer user-token', 'Bearer user-token']);
    expect(contentTypes).toEqual([null, 'application/json; charset=utf-8', 'application/json; charset=utf-8']);
    expect(result).toMatchObject({ cardSent: true, fileSent: true, warning: null });
  });

  it('rejects delivery without a current-user token', async () => {
    await expect(deliverInterviewReminder({ ...deliveryInput, userToken: '' }, {
      fetch: async () => Response.json({ code: 0 }),
    })).rejects.toMatchObject({ code: 'FEISHU_AUTH_REQUIRED' });
  });

  it('preserves the numeric Feishu error code for non-expiry card failures', async () => {
    let refreshCalls = 0;
    await expect(deliverInterviewReminder({ ...deliveryInput, file: undefined }, {
      fetch: async () => Response.json({ code: 234567, msg: 'permission denied' }),
      refreshUserToken: async () => { refreshCalls += 1; return 'unused-token'; },
    })).rejects.toMatchObject({ code: 'FEISHU_DELIVERY_FAILED', feishuCode: 234567 });
    expect(refreshCalls).toBe(0);
  });

  it('refreshes the same user once and retries only an expired card request', async () => {
    const calls: Array<{ kind: string; authorization: string | null }> = [];
    let refreshCalls = 0;

    const result = await deliverInterviewReminder(deliveryInput, {
      fetch: async (url, init) => {
        const authorization = new Headers(init?.headers).get('Authorization');
        const kind = String(url).includes('/files') ? 'upload' : JSON.parse(String(init?.body)).msg_type;
        calls.push({ kind, authorization });
        if (kind === 'upload') return Response.json({ code: 0, data: { file_key: 'file-key' } });
        if (kind === 'interactive' && authorization === 'Bearer user-token') {
          return Response.json({ code: 99991677, msg: 'token expired' });
        }
        return Response.json({ code: 0, data: { message_id: 'message-id' } });
      },
      refreshUserToken: async () => { refreshCalls += 1; return 'same-user-refreshed-token'; },
    });

    expect(calls).toEqual([
      { kind: 'upload', authorization: 'Bearer tenant-token' },
      { kind: 'interactive', authorization: 'Bearer user-token' },
      { kind: 'interactive', authorization: 'Bearer same-user-refreshed-token' },
      { kind: 'file', authorization: 'Bearer same-user-refreshed-token' },
    ]);
    expect(refreshCalls).toBe(1);
    expect(result).toMatchObject({ cardSent: true, fileSent: true });
  });

  it('refreshes once at the file stage without repeating the delivered card or PDF upload', async () => {
    const calls: Array<{ kind: string; authorization: string | null }> = [];
    let refreshCalls = 0;

    const result = await deliverInterviewReminder(deliveryInput, {
      fetch: async (url, init) => {
        const authorization = new Headers(init?.headers).get('Authorization');
        const kind = String(url).includes('/files') ? 'upload' : JSON.parse(String(init?.body)).msg_type;
        calls.push({ kind, authorization });
        if (kind === 'upload') return Response.json({ code: 0, data: { file_key: 'file-key' } });
        if (kind === 'file' && authorization === 'Bearer user-token') {
          return Response.json({ code: 99991677, msg: 'token expired' });
        }
        return Response.json({ code: 0, data: { message_id: 'message-id' } });
      },
      refreshUserToken: async () => { refreshCalls += 1; return 'same-user-refreshed-token'; },
    });

    expect(calls.map(({ kind }) => kind)).toEqual(['upload', 'interactive', 'file', 'file']);
    expect(calls.at(-1)?.authorization).toBe('Bearer same-user-refreshed-token');
    expect(refreshCalls).toBe(1);
    expect(result).toMatchObject({ cardSent: true, fileSent: true });
  });

  it('returns actionable auth failure when the same-user refresh cannot produce a token', async () => {
    let refreshCalls = 0;
    await expect(deliverInterviewReminder({ ...deliveryInput, file: undefined }, {
      fetch: async () => Response.json({ code: 99991677, msg: 'token expired' }),
      refreshUserToken: async () => { refreshCalls += 1; return null; },
    })).rejects.toMatchObject({ code: 'FEISHU_AUTH_REQUIRED', feishuCode: 99991677 });
    expect(refreshCalls).toBe(1);
  });

  it('still sends a card when PDF upload fails', async () => {
    const messageTypes: string[] = [];
    const result = await deliverInterviewReminder(deliveryInput, {
      fetch: async (url, init) => {
        if (String(url).includes('/files')) return Response.json({ code: 999, msg: 'upload failed' });
        messageTypes.push(JSON.parse(String(init?.body)).msg_type);
        return Response.json({ code: 0, data: { message_id: 'message-id' } });
      },
    });

    expect(messageTypes).toEqual(['interactive']);
    expect(result).toMatchObject({ cardSent: true, fileSent: false });
    expect(result.warning).toContain('PDF');
  });

  it('rejects an over-limit streaming Feishu response before consuming its full body', async () => {
    let pulls = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls === 1) controller.enqueue(new Uint8Array(512 * 1024));
        else if (pulls === 2) controller.enqueue(new Uint8Array(600 * 1024));
        else controller.close();
      },
      cancel() {
        cancelled = true;
      },
    }, { highWaterMark: 0 });

    const result = await deliverInterviewReminder(deliveryInput, {
      fetch: async (url) => String(url).includes('/files')
        ? new Response(stream, { headers: { 'content-type': 'application/json' } })
        : Response.json({ code: 0, data: { message_id: 'message-id' } }),
    });

    expect(result).toMatchObject({ cardSent: true, fileSent: false });
    expect(pulls).toBe(2);
    expect(cancelled).toBe(true);
  });

  it.each([
    ['empty', new Uint8Array()],
    ['oversized', new Uint8Array(30 * 1024 * 1024 + 1)],
  ])('rejects a %s PDF before any network I/O', async (_label, bytes) => {
    let fetchCalls = 0;

    await expect(deliverInterviewReminder({
      ...deliveryInput,
      file: { bytes, fileName: 'resume.pdf' },
    }, {
      fetch: async () => {
        fetchCalls += 1;
        return Response.json({ code: 0 });
      },
    })).rejects.toMatchObject({ code: 'FEISHU_INVALID_PDF' });

    expect(fetchCalls).toBe(0);
  });

  it('normalizes all seven fields from authoritative resume data', () => {
    const view = buildInterviewReminderView({
      interview: { candidate_name: '候选人', position_applied: '旧岗位', interview_time: '2026-08-11T02:00:00.000Z' },
      resume: {
        candidate_name: '张三', mapped_position: '社区运营', gender: '', education: '', birthday: '1996-08-11',
        parsed_data: JSON.stringify({ highest_degree: '本科', gender: '女', city: '北京' }),
        ai_evaluation: JSON.stringify({ summary: '匹配岗位', risk_points: ['稳定性待核实'], interview_questions: ['请说明离职原因'] }),
      },
    }, new Date('2026-08-10T00:00:00.000Z'));

    expect(view).toMatchObject({ name: '张三', education: '本科', age: 29, gender: '女', position: '社区运营', city: '北京' });
    expect(view.aiAdvice).toContain('稳定性待核实');
  });

  it('uses the selected interview before stale screening data for name and position', () => {
    const view = buildInterviewReminderView({
      resume: {},
      screening: { candidate_name: '旧姓名', mapped_position: '旧岗位' },
      interview: { candidate_name: '当前姓名', position_applied: '当前岗位' },
      recruitmentTask: { candidate_name: '任务姓名', position: '任务岗位' },
    });

    expect(view).toMatchObject({ name: '当前姓名', position: '当前岗位' });
  });

  it('prefers valid parsed demographics and falls back from invalid parsed age to birthday', () => {
    const parsed = buildInterviewReminderView({
      resume: {
        education: '本科', gender: '男', birthday: '1980-01-01',
        parsed_data: JSON.stringify({ highest_degree: '硕士', gender: '女', age: '32' }),
      },
    }, new Date('2026-08-10T16:30:00.000Z'));
    const birthdayFallback = buildInterviewReminderView({
      resume: {
        birthday: '1996-08-11',
        parsed_data: { age: 121 },
      },
    }, new Date('2026-08-10T16:30:00.000Z'));

    expect(parsed).toMatchObject({ education: '硕士', gender: '女', age: 32 });
    expect(birthdayFallback.age).toBe(30);
  });

  it.each([
    [{ parsed_data: { city: '上海' } }, { city: '北京' }, { city: '杭州' }, { interview_location: '深圳' }, '上海'],
    [{}, { city: '北京' }, { city: '杭州' }, { interview_location: '深圳' }, '北京'],
    [{}, {}, { city: '杭州' }, { interview_location: '深圳' }, '杭州'],
    [{ position_location: '成都' }, {}, {}, { interview_location: '深圳' }, '成都'],
    [{}, {}, {}, { interview_location: '深圳' }, '深圳'],
  ])('uses the documented city fallback chain', (resume, screening, recruitmentTask, interview, expected) => {
    expect(buildInterviewReminderView({ resume, screening, recruitmentTask, interview }).city).toBe(expected);
  });

  it('renders attachment availability and never exposes raw JSON', () => {
    const card = buildInterviewReminderCard({
      name: '张三', education: '本科', age: 29, gender: '女', position: '社区运营',
      interviewTime: '2026-08-11 10:00', city: '北京', aiAdvice: '建议核实稳定性',
    }, { operatorName: '金皓翔', attachmentAvailable: true });
    const serialized = JSON.stringify(card);
    expect(serialized).toContain('简历 PDF 将在下一条消息发送');
    expect(serialized).toContain('学历');
    expect(serialized).not.toContain('risk_points');
  });

  it('renders a view-details button when a card link is provided', () => {
    const card = buildInterviewReminderCard({
      name: '张三', education: '本科', age: 29, gender: '女', position: '社区运营',
      interviewTime: '2026-08-11 10:00', city: '北京', aiAdvice: '建议核实稳定性',
    }, {
      operatorName: '金皓翔', attachmentAvailable: false,
      cardLink: 'https://ai-interview-88r.pages.dev/interview-card/ic-test-token',
    });
    const serialized = JSON.stringify(card);
    expect(serialized).toContain('查看面试详情（一面/二面评价）');
    expect(serialized).toContain('https://ai-interview-88r.pages.dev/interview-card/ic-test-token');
    expect(serialized).toContain('"tag":"button"');
  });

  it('omits the view-details button when no card link is available', () => {
    const card = buildInterviewReminderCard({
      name: '张三', education: '本科', age: 29, gender: '女', position: '社区运营',
      interviewTime: '2026-08-11 10:00', city: '北京', aiAdvice: '建议核实稳定性',
    }, { operatorName: '金皓翔', attachmentAvailable: false, cardLink: null });
    const serialized = JSON.stringify(card);
    expect(serialized).not.toContain('查看面试详情');
  });

  it('keeps timezone-less D1 interview time as Shanghai local time', () => {
    const view = buildInterviewReminderView({
      interview: { interview_time: '2026-08-11 10:15:30' },
    });

    expect(view.interviewTime).toBe('2026-08-11 10:15');
  });

  it('converts explicit UTC interview timestamps to Shanghai time', () => {
    const view = buildInterviewReminderView({
      interview: { interview_time: '2026-08-11T02:15:00.000Z' },
    });

    expect(view.interviewTime).toBe('2026-08-11 10:15');
  });

  it('shows an empty value for invalid interview times', () => {
    const view = buildInterviewReminderView({
      interview: { interview_time: 'not-a-date' },
    });

    expect(view.interviewTime).toBe('未填写');
  });

  it('combines current AI risk and question fields from object input', () => {
    const view = buildInterviewReminderView({
      resume: {
        ai_evaluation: {
          summary: '整体匹配',
          risks: '稳定性需核实',
          risk_points: ['薪资预期待确认'],
          suggested_questions: ['请说明职业规划'],
          interview_questions: '请说明离职原因',
        },
      },
    });

    expect(view.aiAdvice).toContain('稳定性需核实');
    expect(view.aiAdvice).toContain('薪资预期待确认');
    expect(view.aiAdvice).toContain('请说明职业规划');
    expect(view.aiAdvice).toContain('请说明离职原因');
  });

  it('normalizes string and array AI fields from JSON input within the advice limit', () => {
    const view = buildInterviewReminderView({
      resume: {
        ai_evaluation: JSON.stringify({
          risk: ['风险一', '风险二'],
          suggested_questions: '请描述一次冲突处理',
          interview_questions: ['请介绍过往项目'],
          risk_points: '补充风险',
        }),
      },
    });

    expect(view.aiAdvice).toContain('风险一');
    expect(view.aiAdvice).toContain('补充风险');
    expect(view.aiAdvice).toContain('请描述一次冲突处理');
    expect(view.aiAdvice).toContain('请介绍过往项目');
    expect(view.aiAdvice.length).toBeLessThanOrEqual(500);
  });

  it('falls through compatible AI sources and deduplicates bounded risks and questions', () => {
    const fromReview = buildInterviewReminderView({
      resume: {
        ai_evaluation: JSON.stringify({ dimensions: [] }),
        ai_review: JSON.stringify({
          summary: '整体匹配', recommendation: '建议进入面试',
          risks: ['稳定性待核实', '稳定性待核实', '薪资预期偏高', '通勤距离', '经验年限', '第五项不展示'],
          interview_questions: ['为何离职', '为何离职', '职业规划', '如何协作', '如何复盘', '第五题不展示'],
        }),
      },
      screening: { ai_analysis: JSON.stringify({ summary: '不应覆盖优先来源' }) },
    });
    const fromScreeningString = buildInterviewReminderView({
      screening: { ai_analysis: '建议核实最近一段经历的真实性。' },
    });

    expect(fromReview.aiAdvice).toContain('整体匹配');
    expect(fromReview.aiAdvice).toContain('建议进入面试');
    expect(fromReview.aiAdvice.match(/稳定性待核实/g)).toHaveLength(1);
    expect(fromReview.aiAdvice.match(/为何离职/g)).toHaveLength(1);
    expect(fromReview.aiAdvice).not.toContain('第五项不展示');
    expect(fromReview.aiAdvice).not.toContain('第五题不展示');
    expect(fromReview.aiAdvice).not.toContain('不应覆盖优先来源');
    expect(fromReview.aiAdvice.length).toBeLessThanOrEqual(500);
    expect(fromScreeningString.aiAdvice).toBe('建议核实最近一段经历的真实性。');
  });

  it('uses a fixed actionable recommendation when no stored AI advice is usable', () => {
    const view = buildInterviewReminderView({
      resume: { ai_evaluation: '', ai_review: '{}' },
      screening: { ai_analysis: null },
    });

    expect(view.aiAdvice).toBe('建议面试官重点核实岗位匹配、核心经历与稳定性，并结合简历原文人工判断。');
  });

  it('wires legacy-token retries only to the authenticated current user', async () => {
    const source = await readFile(resolve(process.cwd(), 'src/index.ts'), 'utf8');
    const validToken = source.slice(
      source.indexOf('async function getValidUserAccessToken'),
      source.indexOf('async function getFeishuToken'),
    );
    const route = source.slice(
      source.indexOf("app.post('/api/interviews/:id/notify-interviewer'"),
      source.indexOf('// ==================== 飞书事件回调'),
    );

    expect(validToken).toContain('row.feishu_token_expires_at <= 0');
    expect(validToken).toContain('return row.feishu_token');
    expect(route).toContain('getValidUserAccessToken(c.env, currentUser.email)');
    expect(route).toContain('need_feishu_auth: true');
    expect(route).not.toContain('refreshUserToken');
    expect(route).not.toContain('getAnyFeishuUserToken');
    expect(route).not.toContain('sendFeishuMessageWithFallback');
    expect(route).not.toContain('tenant_access_token');
  });
});
