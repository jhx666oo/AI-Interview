import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildDailyReportCandidateDetails,
  buildDailyReportFallbackSummary,
  buildDailyReportSnapshot,
  type DailyReportDataset,
} from '../src/daily-reports/report';
import {
  DAILY_REPORT_DATASET_SQL,
  DailyReportDeliveryError,
  generateAndPersistDailyReport,
  generatePersistAndDeliverDailyReport,
  mapHrDecision,
  syncLinkedResumeScreeningDecision,
} from '../src/daily-reports/service';

function dataset(): DailyReportDataset {
  return {
    positions: [{ id: 'p1', title: '运营', status: 'open', responsible_person: '何雨菱' }],
    positionMappings: [],
    resumes: [],
    interviews: [],
    offers: [],
    onboardingRecords: [],
    allTimeResumes: 0,
  };
}

describe('daily report SQL schema contracts', () => {
  it('projects real interview and onboarding title columns from the checked-in schema', async () => {
    const schema = await readFile(resolve(process.cwd(), 'schema.sql'), 'utf8');
    const interviewsSchema = schema.slice(
      schema.indexOf('CREATE TABLE IF NOT EXISTS interviews'),
      schema.indexOf('-- Interview Panels'),
    );
    const onboardingSchema = schema.slice(
      schema.indexOf('CREATE TABLE IF NOT EXISTS onboarding_records'),
      schema.indexOf('-- Probation Records'),
    );

    expect(interviewsSchema).toContain('position_applied TEXT');
    expect(interviewsSchema).not.toContain('position_title TEXT');
    expect(DAILY_REPORT_DATASET_SQL.interviews).toContain('position_applied AS position_title');
    expect(DAILY_REPORT_DATASET_SQL.interviews).not.toMatch(/SELECT[\s\S]*position_id,\s*position_title,/);
    expect(onboardingSchema).toContain('position_title TEXT');
    expect(DAILY_REPORT_DATASET_SQL.onboardingRecords).toContain('position_title');
  });

  it('uses format-specific interview bounds and one UTC offer window rather than a 32-hour OR union', () => {
    expect(DAILY_REPORT_DATASET_SQL.interviews).toContain('substr(trim(interview_time), 1, 10) = ?');
    expect(DAILY_REPORT_DATASET_SQL.interviews).toContain("upper(substr(trim(interview_time), -1)) = 'Z'");
    expect(DAILY_REPORT_DATASET_SQL.offers.match(/datetime\(sent_at\)/g)).toHaveLength(2);
    expect(DAILY_REPORT_DATASET_SQL.offers).not.toContain('localStart');
  });

  it('keeps migration 0026 as the sole upgrade path for approved_at', async () => {
    const source = await readFile(resolve(process.cwd(), 'src/index.ts'), 'utf8');
    const init = source.slice(source.indexOf("app.get('/api/init/status'"), source.indexOf('// v2.0: create jd_versions table'));
    const migration = await readFile(resolve(process.cwd(), 'migrations/0026_resume_approved_at.sql'), 'utf8');
    expect(migration).toContain('ALTER TABLE resumes ADD COLUMN approved_at TEXT');
    expect(init).not.toContain('ALTER TABLE resumes ADD COLUMN approved_at TEXT');
  });
});

describe('explicit daily decision semantics', () => {
  it('keeps AI-screened rows pending until an explicit decision timestamp exists', () => {
    const input = dataset();
    input.resumes = [
      { id: 'ai-pass', position_id: 'p1', status: 'pending_screening', screening_result: '通过' },
      { id: 'ai-fail', position_id: 'p1', status: 'pending_review', screening_result: '不通过' },
      { id: 'approved', position_id: 'p1', status: 'pending_review', screening_result: '不通过', approved_at: '2026-08-10T01:00:00Z' },
      { id: 'rejected', position_id: 'p1', status: 'pending_screening', screening_result: '通过', rejected_at: '2026-08-10T02:00:00Z' },
    ];

    const snapshot = buildDailyReportSnapshot(input, '2026-08-10', '2026-08-10T10:00:00Z');

    expect(snapshot.rows[0]).toMatchObject({ pending: 2, todayApproved: 1, todayRejected: 1 });
  });

  it('does not count status or AI labels without the dedicated report-day timestamp', () => {
    const input = dataset();
    input.resumes = [
      { id: 'status-approved', position_id: 'p1', status: 'approved', screening_result: '通过' },
      { id: 'status-rejected', position_id: 'p1', status: 'rejected', screening_result: '不通过' },
    ];

    const snapshot = buildDailyReportSnapshot(input, '2026-08-10', '2026-08-10T10:00:00Z');

    expect(snapshot.rows[0]).toMatchObject({ pending: 0, todayApproved: 0, todayRejected: 0 });
  });
});

describe('immutable candidate detail snapshot', () => {
  it('uses the aggregate owner resolver, fixed owner order, de-duplicates ids, and does not guess ambiguity', () => {
    const input = dataset();
    input.positionMappings = [
      { mapped_name: '共享岗位', raw_name: '共享', responsible_person: '何雨菱' },
      { mapped_name: '共享岗位', raw_name: '共享', responsible_person: '杜雁玲' },
    ];
    input.resumes = [
      { id: 'owned', position_id: 'p1', candidate_name: '甲', approved_at: '2026-08-10T01:00:00Z' },
      { id: 'owned', position_id: 'p1', candidate_name: '重复甲', approved_at: '2026-08-10T01:00:00Z' },
      { id: 'ambiguous', mapped_position: '共享岗位', candidate_name: '乙', approved_at: '2026-08-10T02:00:00Z' },
    ];

    const details = buildDailyReportCandidateDetails(input, '2026-08-10');

    expect(details.groups.map((group) => group.responsible_person)).toEqual(['何雨菱', '杜雁玲', '魏秋柠', '未分配']);
    expect(details.groups[0].candidates.map((candidate) => candidate.resume_id)).toEqual(['owned']);
    expect(details.groups[3].candidates.map((candidate) => candidate.resume_id)).toEqual(['ambiguous']);
    expect(details.stats).toEqual({
      total: 2,
      by_person: { '何雨菱': 1, '杜雁玲': 0, '魏秋柠': 0, '未分配': 1 },
    });
  });

  it('bounds every persisted candidate text field', () => {
    const input = dataset();
    const long = '长'.repeat(2_000);
    input.resumes = [{
      id: 'r1', position_id: 'p1', candidate_name: long, education: long, gender: long,
      position_applied: long, approved_at: '2026-08-10T01:00:00Z',
      parsed_city: long, ai_summary: long, recommendation: long,
    }];

    const candidate = buildDailyReportCandidateDetails(input, '2026-08-10').groups[0].candidates[0];

    for (const value of Object.values(candidate)) {
      if (typeof value === 'string') expect(value.length).toBeLessThanOrEqual(300);
    }
  });

  it('builds stats and candidate details before AI from the same single loaded dataset', async () => {
    const input = dataset();
    input.resumes = [{ id: 'r1', position_id: 'p1', candidate_name: 'AI前姓名', approved_at: '2026-08-10T01:00:00Z' }];
    let loads = 0;
    const writes: unknown[][] = [];
    const db = {
      prepare() {
        return { bind(...values: unknown[]) { return { async run() { writes.push(values); return { meta: { changes: 1 } }; } }; } };
      },
    };

    const report = await generateAndPersistDailyReport({ DB: db as never }, '2026-08-10', {
      id: () => 'daily-same-read',
      generatedAt: () => '2026-08-10T10:00:00Z',
      loadDataset: async () => { loads += 1; return input; },
      summarize: async () => {
        input.resumes[0].candidate_name = 'AI期间姓名';
        input.resumes.push({ id: 'late', position_id: 'p1', candidate_name: 'AI期间新增', approved_at: '2026-08-10T03:00:00Z' });
        throw new Error('fallback');
      },
    });

    expect(loads).toBe(1);
    expect(report.snapshot.totals.todayApproved).toBe(1);
    expect(JSON.parse(report.candidate_details).groups[0].candidates).toMatchObject([{ name: 'AI前姓名', resume_id: 'r1' }]);
    expect(JSON.parse(report.candidate_details).groups[0].candidates).toHaveLength(1);
    expect(writes).toHaveLength(1);
  });

  it('fails explicitly before persistence when serialized candidate details exceed the byte cap', async () => {
    const input = dataset();
    input.resumes = Array.from({ length: 1_000 }, (_, index) => ({
      id: `r-${index}`,
      position_id: 'p1',
      candidate_name: `候选人-${index}`,
      approved_at: '2026-08-10T01:00:00Z',
      ai_summary: '摘'.repeat(300),
    }));
    let writes = 0;
    const db = {
      prepare() {
        return { bind() { return { async run() { writes += 1; return { meta: { changes: 1 } }; } }; } };
      },
    };

    await expect(generateAndPersistDailyReport({ DB: db as never }, '2026-08-10', {
      loadDataset: async () => input,
      summarize: async () => '',
    })).rejects.toThrow(/candidate_details.*byte limit/i);
    expect(writes).toBe(0);
  });
});

describe('HR and linked screening decisions', () => {
  it('maps frontend and legacy HR decisions explicitly', () => {
    expect(mapHrDecision('pending_interview')).toEqual({ status: 'pending_interview', stage: 'interview', event: 'approved' });
    expect(mapHrDecision('rejected')).toEqual({ status: 'rejected', stage: 'rejected', event: 'rejected' });
    expect(mapHrDecision('reject')).toEqual({ status: 'rejected', stage: 'rejected', event: 'rejected' });
    expect(mapHrDecision('waitlist')).toEqual({ status: 'waitlist', stage: 'screening', event: 'reset' });
    expect(() => mapHrDecision('unknown')).toThrow(/unsupported HR decision/i);
  });

  it('synchronizes card/queue store and discard to linked resume business state plus timestamp', async () => {
    const updates: Array<{ sql: string; values: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        return { bind(...values: unknown[]) { return { async run() { updates.push({ sql, values }); return { meta: { changes: 1 } }; } }; } };
      },
    };

    await syncLinkedResumeScreeningDecision(db as never, 'resume-store', 'store', '2026-08-10T01:00:00Z');
    await syncLinkedResumeScreeningDecision(db as never, 'resume-discard', 'discard', '2026-08-10T02:00:00Z');

    expect(updates.some(({ sql, values }) => sql.includes("status = 'approved'") && values.at(-1) === 'resume-store')).toBe(true);
    expect(updates.some(({ sql, values }) => sql.includes('approved_at = ?') && values.at(-1) === 'resume-store')).toBe(true);
    expect(updates.some(({ sql, values }) => sql.includes("status = 'rejected'") && values.at(-1) === 'resume-discard')).toBe(true);
    expect(updates.some(({ sql, values }) => sql.includes('rejected_at = ?') && values.at(-1) === 'resume-discard')).toBe(true);
  });

  it('keeps linked screening decisions operational before migration 0026', async () => {
    const statuses: string[] = [];
    const db = {
      prepare(sql: string) {
        return { bind() { return { async run() {
          if (sql.includes('approved_at')) throw new Error('no such column: approved_at');
          statuses.push(sql);
          return { meta: { changes: 1 } };
        } }; } };
      },
    };

    await expect(syncLinkedResumeScreeningDecision(db as never, 'resume-old', 'store', '2026-08-10T01:00:00Z')).resolves.toBeUndefined();
    expect(statuses.some((sql) => sql.includes("status = 'approved'"))).toBe(true);
  });

  it('wires both direct queue routes and both card callback branches through linked resume synchronization', async () => {
    const source = await readFile(resolve(process.cwd(), 'src/index.ts'), 'utf8');
    const approve = source.slice(source.indexOf("app.post('/api/resume-screening/:id/approve'"), source.indexOf("app.post('/api/resume-screening/:id/reject'"));
    const reject = source.slice(source.indexOf("app.post('/api/resume-screening/:id/reject'"), source.indexOf("app.post('/api/resume-screening/batch-analyze'"));
    const callback = source.slice(source.indexOf("app.post('/api/feishu/card-action'"), source.indexOf('// ==================== 事件回调 Endpoint'));
    expect(approve).toContain("syncLinkedResumeScreeningDecision(c.env.DB, record.resume_id, 'store'");
    expect(reject).toContain("syncLinkedResumeScreeningDecision(c.env.DB, record.resume_id, 'discard'");
    expect(callback).toContain("syncLinkedResumeScreeningDecision(c.env.DB, record.resume_id, 'store'");
    expect(callback).toContain("syncLinkedResumeScreeningDecision(c.env.DB, record.resume_id, 'discard'");
  });
});

describe('cron delivery and request boundaries', () => {
  it('validates the cron target before loading or persisting a report', async () => {
    let loads = 0;
    let writes = 0;
    const db = { prepare() { return { bind() { return { async run() { writes += 1; return { meta: { changes: 1 } }; } }; } }; } };

    await expect(generatePersistAndDeliverDailyReport(
      { DB: db as never },
      '2026-08-10',
      { type: 'chat', id: '' },
      { loadDataset: async () => { loads += 1; return dataset(); }, summarize: async () => '' },
      async () => undefined,
    )).rejects.toThrow(/delivery target/i);
    expect(loads).toBe(0);
    expect(writes).toBe(0);
  });

  it('preserves the persisted report id when delivery fails', async () => {
    const db = { prepare() { return { bind() { return { async run() { return { meta: { changes: 1 } }; } }; } }; } };

    const promise = generatePersistAndDeliverDailyReport(
      { DB: db as never },
      '2026-08-10',
      { type: 'chat', id: 'oc_chat' },
      { id: () => 'daily-delivery-failed', loadDataset: async () => dataset(), summarize: async () => '' },
      async () => { throw new Error('Feishu unavailable'); },
    );

    await expect(promise).rejects.toMatchObject({
      name: 'DailyReportDeliveryError',
      reportId: 'daily-delivery-failed',
      message: expect.stringContaining('Feishu unavailable'),
    } satisfies Partial<DailyReportDeliveryError>);
  });

  it('falls back for AI output outside the accepted 100-150 character range', async () => {
    const input = dataset();
    const db = { prepare() { return { bind() { return { async run() { return { meta: { changes: 1 } }; } }; } }; } };
    const report = await generateAndPersistDailyReport({ DB: db as never }, '2026-08-10', {
      loadDataset: async () => input,
      summarize: async () => '过短摘要',
    });
    expect(report.ai_summary).toBe(buildDailyReportFallbackSummary(report.snapshot));
  });

  it('handles malformed generate/send JSON as 400 and reads the cron chat id from Env', async () => {
    const source = await readFile(resolve(process.cwd(), 'src/index.ts'), 'utf8');
    const generate = source.slice(source.indexOf("app.post('/api/daily-reports/generate'"), source.indexOf("app.delete('/api/daily-reports/:id'"));
    const send = source.slice(source.indexOf("app.post('/api/daily-reports/:id/send'"), source.indexOf('// ==================== Feishu Sync'));
    const cron = source.slice(source.indexOf("app.post('/api/cron/daily-report'"), source.indexOf('/**\n * 面试提醒'));
    expect(generate).toContain('请求体必须是合法 JSON');
    expect(send).toContain('请求体必须是合法 JSON');
    expect(generate).toContain('400');
    expect(send).toContain('400');
    expect(source).toContain('FEISHU_RECRUITMENT_GROUP_CHAT_ID?: string');
    expect(cron).toContain('c.env.FEISHU_RECRUITMENT_GROUP_CHAT_ID');
    expect(cron).toContain('503');
    expect(cron).toContain('日报已生成但推送失败');
  });
});
