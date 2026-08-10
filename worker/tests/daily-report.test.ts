import { describe, expect, it } from 'vitest';
import {
  buildDailyReportFallbackSummary,
  buildDailyReportFeishuCard,
  buildDailyReportSnapshot,
  type DailyReportDataset,
  type DailyReportSnapshot,
} from '../src/daily-reports/report';
import {
  DAILY_REPORT_QUERY_LIMITS,
  buildStoredDailyReportCard,
  generateAndPersistDailyReport,
  generatePersistAndDeliverDailyReport,
  getShanghaiReportDate,
  loadDailyReportDataset,
  normalizeStoredDailyReportSnapshot,
  recordResumeDecisionTimestamp,
  sendStoredDailyReport,
} from '../src/daily-reports/service';

const emptyDataset = (): DailyReportDataset => ({
  positions: [],
  positionMappings: [],
  resumes: [],
  interviews: [],
  offers: [],
  onboardingRecords: [],
  allTimeResumes: 0,
});

const aggregateDataset: DailyReportDataset = {
  positions: [
    { id: 'p-hy', title: '社区运营', status: 'open', responsible_person: '何雨菱' },
    { id: 'p-du', title: '销售专员', status: 'published', responsible_person: '杜雁玲' },
    { id: 'p-wei', title: '人事专员', status: 'closed', responsible_person: '魏秋柠' },
  ],
  positionMappings: [
    { mapped_name: '销售专员', raw_name: '销售', raw_names: '["BD"]', responsible_person: '杜雁玲' },
    { mapped_name: '人事专员', raw_name: 'HR', raw_names: ['人事'], responsible_person: '魏秋柠' },
  ],
  resumes: [
    {
      id: 'r-hy', position_id: 'p-hy', mapped_position: '销售专员',
      created_at: '2026-08-09T16:00:00.000Z', updated_at: '2026-08-09T16:00:00.000Z',
      status: 'pending_screening', screening_result: 'pending',
    },
    {
      id: 'r-du', mapped_position: '  销售专员  ', position_applied: 'HR',
      created_at: '2026-08-09T15:59:59.999Z', updated_at: '2026-08-10T03:00:00.000Z',
      approved_at: '2026-08-10T03:00:00.000Z', status: 'approved', screening_result: '通过',
    },
    {
      id: 'r-wei', position_applied: 'HR',
      created_at: '2026-08-10T01:00:00.000Z', updated_at: '2026-08-10T04:00:00.000Z',
      rejected_at: '2026-08-10T04:00:00.000Z', status: 'rejected', screening_result: '淘汰',
    },
    {
      id: 'r-old-pending', position_id: 'p-hy', created_at: '2026-08-01T00:00:00.000Z',
      updated_at: '2026-08-01T00:00:00.000Z', status: 'pending_review', screening_result: 'pending',
    },
  ],
  interviews: [
    { id: 'i-hy', resume_id: 'r-hy', interview_time: '2026-08-10T15:59:59.999Z' },
    { id: 'i-next-day', resume_id: 'r-hy', interview_time: '2026-08-10T16:00:00.000Z' },
  ],
  offers: [
    { id: 'o-du', resume_id: 'r-du', sent_at: '2026-08-10T02:00:00.000Z' },
    { id: 'o-old', resume_id: 'r-du', sent_at: '2026-08-09T15:59:59.999Z' },
  ],
  onboardingRecords: [
    { id: 'on-wei', resume_id: 'r-wei', onboard_date: '2026-08-10' },
    { id: 'on-next', resume_id: 'r-wei', onboard_date: '2026-08-11' },
  ],
  allTimeResumes: 19,
};

const snapshotFixture: DailyReportSnapshot = buildDailyReportSnapshot(
  aggregateDataset,
  '2026-08-10',
  '2026-08-10T10:00:00.000Z',
);

describe('buildDailyReportSnapshot', () => {
  it('always emits the three owners in the required order plus aggregate totals', () => {
    expect(snapshotFixture.rows.map((row) => row.owner)).toEqual(['何雨菱', '杜雁玲', '魏秋柠']);
    expect(snapshotFixture.rows).toEqual([
      {
        owner: '何雨菱', openPositions: 1, todayNew: 1, pending: 2,
        todayApproved: 0, todayRejected: 0, todayInterviews: 1, todayOffers: 0, todayOnboarding: 0,
      },
      {
        owner: '杜雁玲', openPositions: 1, todayNew: 0, pending: 0,
        todayApproved: 1, todayRejected: 0, todayInterviews: 0, todayOffers: 1, todayOnboarding: 0,
      },
      {
        owner: '魏秋柠', openPositions: 0, todayNew: 1, pending: 0,
        todayApproved: 0, todayRejected: 1, todayInterviews: 0, todayOffers: 0, todayOnboarding: 1,
      },
    ]);
    expect(snapshotFixture.totals).toEqual({
      openPositions: 2,
      todayNew: 2,
      pending: 2,
      todayApproved: 1,
      todayRejected: 1,
      todayInterviews: 1,
      todayOffers: 1,
      todayOnboarding: 1,
      allTimeResumes: 19,
    });
  });

  it('uses exact position id before mapped title and exact mapped title before alias', () => {
    const dataset = emptyDataset();
    dataset.positions = [
      { id: 'p1', title: '客户运营', status: 'open', responsible_person: '何雨菱' },
    ];
    dataset.positionMappings = [
      { mapped_name: '客户运营', raw_name: 'HR', responsible_person: '杜雁玲' },
      { mapped_name: '人事专员', raw_name: 'HR', responsible_person: '魏秋柠' },
    ];
    dataset.resumes = [
      {
        id: 'by-id', position_id: 'p1', mapped_position: '客户运营', position_applied: 'HR',
        created_at: '2026-08-10T00:00:00Z', status: 'pending_screening',
      },
      {
        id: 'by-mapped', mapped_position: '人事专员', position_applied: 'HR',
        created_at: '2026-08-10T00:00:00Z', status: 'pending_screening',
      },
    ];

    const snapshot = buildDailyReportSnapshot(dataset, '2026-08-10', '2026-08-10T10:00:00.000Z');

    expect(snapshot.rows.map((row) => row.todayNew)).toEqual([1, 0, 1]);
    expect(snapshot.unassigned).toBe(0);
  });

  it('does not assign ambiguous records, reports each record once, and never duplicates metrics', () => {
    const dataset = emptyDataset();
    dataset.positionMappings = [
      { mapped_name: '共享岗位', raw_name: '共享', responsible_person: '何雨菱' },
      { mapped_name: '共享岗位', raw_name: '共享', responsible_person: '杜雁玲' },
    ];
    dataset.resumes = [{
      id: 'ambiguous', mapped_position: '共享岗位', position_applied: '共享',
      created_at: '2026-08-10T01:00:00Z', status: 'pending_screening', screening_result: 'pending',
    }];

    const snapshot = buildDailyReportSnapshot(dataset, '2026-08-10', '2026-08-10T10:00:00.000Z');

    expect(snapshot.unassigned).toBe(1);
    expect(snapshot.rows.reduce((sum, row) => sum + row.todayNew, 0)).toBe(0);
    expect(snapshot.rows.reduce((sum, row) => sum + row.pending, 0)).toBe(0);
  });

  it('uses the exact report date with Asia/Shanghai boundaries rather than the host date', () => {
    const dataset = emptyDataset();
    dataset.positions = [{ id: 'p1', title: '运营', status: 'open', responsible_person: '何雨菱' }];
    dataset.resumes = [
      { id: 'before', position_id: 'p1', created_at: '2026-08-09T15:59:59.999Z', status: 'approved', screening_result: '通过', approved_at: '2026-08-10T15:59:59.999Z' },
      { id: 'start', position_id: 'p1', created_at: '2026-08-09T16:00:00.000Z', status: 'approved', screening_result: '通过', approved_at: '2026-08-10T16:00:00.000Z' },
      { id: 'end', position_id: 'p1', created_at: '2026-08-10T15:59:59.999Z', status: 'approved', screening_result: '通过', approved_at: '2026-08-09T16:00:00.000Z' },
      { id: 'after', position_id: 'p1', created_at: '2026-08-10T16:00:00.000Z', status: 'approved', screening_result: '通过', approved_at: '2026-08-09T15:59:59.999Z' },
    ];

    const snapshot = buildDailyReportSnapshot(dataset, '2026-08-10', '2099-01-01T00:00:00.000Z');

    expect(snapshot.rows[0].todayNew).toBe(2);
    expect(snapshot.rows[0].todayApproved).toBe(2);
    expect(snapshot.reportDate).toBe('2026-08-10');
    expect(snapshot.generatedAt).toBe('2099-01-01T00:00:00.000Z');
  });

  it('treats an unzoned evening interview as Shanghai wall-clock time without shifting its day', () => {
    const dataset = emptyDataset();
    dataset.positions = [{ id: 'p1', title: '运营', status: 'open', responsible_person: '何雨菱' }];
    dataset.interviews = [
      { id: 'local-evening', position_id: 'p1', interview_time: '2026-08-10 20:00' },
      { id: 'local-seconds', position_id: 'p1', interview_time: '2026-08-10 20:00:30' },
      { id: 'zoned-next-day', position_id: 'p1', interview_time: '2026-08-10T16:00:00Z' },
    ];

    const august10 = buildDailyReportSnapshot(dataset, '2026-08-10', '2026-08-10T10:00:00.000Z');
    const august11 = buildDailyReportSnapshot(dataset, '2026-08-11', '2026-08-11T10:00:00.000Z');

    expect(august10.rows[0].todayInterviews).toBe(2);
    expect(august11.rows[0].todayInterviews).toBe(1);
  });

  it('rejects invalid unzoned Shanghai wall-clock values', () => {
    const dataset = emptyDataset();
    dataset.positions = [{ id: 'p1', title: '运营', status: 'open', responsible_person: '何雨菱' }];
    dataset.interviews = [
      { id: 'invalid-hour', position_id: 'p1', interview_time: '2026-08-10 25:00' },
      { id: 'invalid-minute', position_id: 'p1', interview_time: '2026-08-10 20:60' },
    ];

    const snapshot = buildDailyReportSnapshot(dataset, '2026-08-10', '2026-08-10T10:00:00.000Z');

    expect(snapshot.rows[0].todayInterviews).toBe(0);
  });

  it('rejects impossible calendar dates before parsing zoned and D1 UTC timestamps', () => {
    const dataset = emptyDataset();
    dataset.positions = [{ id: 'p1', title: '运营', status: 'open', responsible_person: '何雨菱' }];
    dataset.interviews = [
      { id: 'invalid-zoned-date', position_id: 'p1', interview_time: '2026-02-30T00:00:00Z' },
    ];
    dataset.resumes = [
      { id: 'invalid-d1-date', position_id: 'p1', created_at: '2026-02-30 00:00:00', status: 'approved' },
    ];

    const normalizedMarchDay = buildDailyReportSnapshot(dataset, '2026-03-02', '2026-03-02T10:00:00.000Z');

    expect(normalizedMarchDay.rows[0].todayInterviews).toBe(0);
    expect(normalizedMarchDay.rows[0].todayNew).toBe(0);
  });

  it('rejects out-of-range zoned time and offset components', () => {
    const dataset = emptyDataset();
    dataset.positions = [{ id: 'p1', title: '运营', status: 'open', responsible_person: '何雨菱' }];
    dataset.interviews = [
      { id: 'invalid-hour', position_id: 'p1', interview_time: '2026-08-10T25:00:00Z' },
      { id: 'invalid-minute', position_id: 'p1', interview_time: '2026-08-10T20:60:00Z' },
      { id: 'invalid-second', position_id: 'p1', interview_time: '2026-08-10T20:00:60Z' },
      { id: 'invalid-offset-hour', position_id: 'p1', interview_time: '2026-08-10T20:00:00+24:00' },
      { id: 'invalid-offset-minute', position_id: 'p1', interview_time: '2026-08-10T20:00:00+08:60' },
    ];

    const snapshot = buildDailyReportSnapshot(dataset, '2026-08-10', '2026-08-10T10:00:00.000Z');

    expect(snapshot.rows[0].todayInterviews).toBe(0);
  });

  it('converts valid Z and supported numeric offsets to the Shanghai report date', () => {
    const dataset = emptyDataset();
    dataset.positions = [{ id: 'p1', title: '运营', status: 'open', responsible_person: '何雨菱' }];
    dataset.interviews = [
      { id: 'z-crossing', position_id: 'p1', interview_time: '2026-08-10T16:00:00Z' },
      { id: 'colon-offset', position_id: 'p1', interview_time: '2026-08-11T00:00:00.123+08:00' },
      { id: 'compact-offset', position_id: 'p1', interview_time: '2026-08-11T00:00:00+0800' },
    ];

    const snapshot = buildDailyReportSnapshot(dataset, '2026-08-11', '2026-08-11T10:00:00.000Z');

    expect(snapshot.rows[0].todayInterviews).toBe(3);
  });

  it('does not recount old screening results after an unrelated edit today', () => {
    const dataset = emptyDataset();
    dataset.positions = [{ id: 'p1', title: '运营', status: 'open', responsible_person: '杜雁玲' }];
    dataset.resumes = [
      {
        id: 'old-approved', position_id: 'p1', status: 'approved', screening_result: '通过',
        approved_at: '2026-08-08T03:00:00Z', updated_at: '2026-08-10T03:00:00Z',
      },
      {
        id: 'old-rejected', position_id: 'p1', status: 'rejected', screening_result: '淘汰',
        rejected_at: '2026-08-08T04:00:00Z', updated_at: '2026-08-10T04:00:00Z',
      },
    ];

    const snapshot = buildDailyReportSnapshot(dataset, '2026-08-10', '2026-08-10T10:00:00.000Z');

    expect(snapshot.rows[1].todayApproved).toBe(0);
    expect(snapshot.rows[1].todayRejected).toBe(0);
  });

  it('counts approved_at and rejected_at on the report date without using updated_at', () => {
    const dataset = emptyDataset();
    dataset.positions = [{ id: 'p1', title: '运营', status: 'open', responsible_person: '魏秋柠' }];
    dataset.resumes = [
      {
        id: 'approved-today', position_id: 'p1', status: 'approved', screening_result: '通过',
        approved_at: '2026-08-10T03:00:00Z', updated_at: '2026-08-08T03:00:00Z',
      },
      {
        id: 'rejected-today', position_id: 'p1', status: 'rejected', screening_result: '淘汰',
        rejected_at: '2026-08-10T04:00:00Z', updated_at: '2026-08-08T04:00:00Z',
      },
    ];

    const snapshot = buildDailyReportSnapshot(dataset, '2026-08-10', '2026-08-10T10:00:00.000Z');

    expect(snapshot.rows[2].todayApproved).toBe(1);
    expect(snapshot.rows[2].todayRejected).toBe(1);
  });

  it('counts explicit decision timestamps even when a linked legacy status was not synchronized', () => {
    const dataset = emptyDataset();
    dataset.positions = [{ id: 'p1', title: '运营', status: 'open', responsible_person: '魏秋柠' }];
    dataset.resumes = [
      { id: 'approved', position_id: 'p1', status: 'pending_review', approved_at: '2026-08-10T03:00:00Z' },
      { id: 'rejected', position_id: 'p1', status: 'pending_review', rejected_at: '2026-08-10T04:00:00Z' },
    ];

    const snapshot = buildDailyReportSnapshot(dataset, '2026-08-10', '2026-08-10T10:00:00.000Z');

    expect(snapshot.rows[2]).toMatchObject({ todayApproved: 1, todayRejected: 1, pending: 0 });
  });

  it('keeps cumulative totals separate from report-day activity', () => {
    const dataset = emptyDataset();
    dataset.allTimeResumes = 42;
    dataset.positions = [{ id: 'p1', title: '运营', status: 'closed', responsible_person: '杜雁玲' }];
    dataset.resumes = [
      { id: 'pending-old', position_id: 'p1', created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z', status: 'pending_review' },
      { id: 'approved-old', position_id: 'p1', created_at: '2026-07-01T00:00:00Z', updated_at: '2026-08-09T00:00:00Z', status: 'approved', screening_result: '通过' },
    ];

    const snapshot = buildDailyReportSnapshot(dataset, '2026-08-10', '2026-08-10T10:00:00.000Z');

    expect(snapshot.rows[1].pending).toBe(1);
    expect(snapshot.rows[1].todayNew).toBe(0);
    expect(snapshot.rows[1].todayApproved).toBe(0);
    expect(snapshot.totals.allTimeResumes).toBe(42);
  });

  it('returns an immutable JSON-safe v2 zero snapshot', () => {
    const snapshot = buildDailyReportSnapshot(emptyDataset(), '2026-08-10', '2026-08-10T10:00:00.000Z');

    expect(snapshot.version).toBe('v2');
    expect(snapshot.rows.map((row) => row.owner)).toEqual(['何雨菱', '杜雁玲', '魏秋柠']);
    expect(snapshot.totals.allTimeResumes).toBe(0);
    expect(snapshot.unassigned).toBe(0);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.rows)).toBe(true);
    expect(snapshot.rows.every(Object.isFrozen)).toBe(true);
    expect(Object.isFrozen(snapshot.totals)).toBe(true);
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  });
});

describe('buildDailyReportFeishuCard', () => {
  it('renders an official native table with nine declared columns and four rows', () => {
    const card = buildDailyReportFeishuCard(snapshotFixture, '今日重点推进待初筛简历。');
    const elements = card.elements as Array<Record<string, unknown>>;
    const table = elements.find((element) => element.tag === 'table') as Record<string, unknown>;
    const columns = table.columns as Array<Record<string, unknown>>;
    const rows = table.rows as Array<Record<string, unknown>>;

    expect(columns.map((column) => column.name)).toEqual([
      'owner', 'open_positions', 'today_new', 'pending', 'today_approved',
      'today_rejected', 'today_interviews', 'today_offers', 'today_onboarding',
    ]);
    expect(columns.map((column) => column.display_name)).toEqual([
      '负责人', '开放岗位', '今日新增', '待初筛', '今日通过', '今日淘汰', '今日面试', 'Offer', '入职',
    ]);
    expect(columns.every((column) => column.data_type === 'text')).toBe(true);
    expect(table.freeze_first_column).toBe(true);
    expect(rows).toHaveLength(4);
    expect(rows.map((row) => row.owner)).toEqual(['何雨菱', '杜雁玲', '魏秋柠', '合计']);
    expect(rows[3]).toMatchObject({ today_offers: '1', today_onboarding: '1' });
    expect(JSON.stringify(card)).toContain('今日重点推进待初筛简历。');
  });
});

describe('buildDailyReportFallbackSummary', () => {
  it('identifies highest activity, largest pending queue, and one next-day action in bounded Chinese', () => {
    const summary = buildDailyReportFallbackSummary(snapshotFixture);

    expect(summary).toContain('何雨菱');
    expect(summary).toContain('待初筛');
    expect(summary).toContain('明日');
    expect(summary.length).toBeGreaterThanOrEqual(60);
    expect(summary.length).toBeLessThanOrEqual(150);
  });

  it('handles zero data deterministically without inventing activity', () => {
    const snapshot = buildDailyReportSnapshot(emptyDataset(), '2026-08-10', '2026-08-10T10:00:00.000Z');
    const summary = buildDailyReportFallbackSummary(snapshot);

    expect(summary).toContain('当日无新增推进');
    expect(summary).toContain('明日');
    expect(summary.length).toBeLessThanOrEqual(150);
  });
});

describe('normalizeStoredDailyReportSnapshot', () => {
  it('converts a legacy report into a v2 display snapshot without inventing owner data', () => {
    const snapshot = normalizeStoredDailyReportSnapshot({
      report_date: '2026-08-09',
      total_resumes: 10,
      pending_screening: 2,
      approved: 1,
      rejected: 1,
      total_interviews: 1,
      total_onboarding: 0,
    });

    expect(snapshot.rows.map((row) => row.todayNew)).toEqual([0, 0, 0]);
    expect(snapshot.rows.map((row) => row.pending)).toEqual([0, 0, 0]);
    expect(snapshot.totals).toMatchObject({
      allTimeResumes: 10,
      pending: 2,
      todayApproved: 1,
      todayRejected: 1,
      todayInterviews: 1,
      todayOnboarding: 0,
    });
  });
});

describe('daily-report D1 dataset loading', () => {
  it('uses exact Shanghai boundaries, necessary columns, and report-day event filters', async () => {
    const queries: Array<{ sql: string; values: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        return {
          bind(...values: unknown[]) {
            queries.push({ sql, values });
            return {
              async all() {
                if (sql.includes('FROM positions')) return { results: [{ id: 'p1', title: '运营', status: 'open', responsible_person: '何雨菱' }] };
                if (sql.includes('FROM position_mappings')) return { results: [] };
                if (sql.includes('FROM resumes')) return { results: [{ id: 'r1', position_id: 'p1', status: 'pending_screening' }] };
                if (sql.includes('FROM interviews')) return { results: [] };
                if (sql.includes('FROM offers')) return { results: [] };
                if (sql.includes('FROM onboarding_records')) return { results: [] };
                throw new Error(`unexpected query: ${sql}`);
              },
              async first() {
                if (sql.includes('COUNT(*)') && sql.includes('FROM resumes')) return { cnt: 7 };
                throw new Error(`unexpected query: ${sql}`);
              },
            };
          },
        };
      },
    };

    const dataset = await loadDailyReportDataset(db as never, '2026-08-10');

    expect(dataset.allTimeResumes).toBe(7);
    expect(queries.some(({ sql }) => /SELECT\s+\*/i.test(sql))).toBe(false);
    const resumeQuery = queries.find(({ sql }) => sql.includes('FROM resumes') && !sql.includes('COUNT(*)'))!;
    expect(resumeQuery.sql).toContain('approved_at');
    expect(resumeQuery.sql).toContain('rejected_at');
    expect(resumeQuery.sql).toContain('LIMIT');
    expect(resumeQuery.values).toEqual([
      '2026-08-09T16:00:00.000Z',
      '2026-08-10T16:00:00.000Z',
      '2026-08-09T16:00:00.000Z',
      '2026-08-10T16:00:00.000Z',
      '2026-08-09T16:00:00.000Z',
      '2026-08-10T16:00:00.000Z',
    ]);
  });

  it('fails explicitly instead of silently truncating an oversized dataset', async () => {
    const db = {
      prepare(sql: string) {
        return {
          bind() {
            return {
              async all() {
                if (sql.includes('FROM positions')) {
                  return { results: Array.from({ length: DAILY_REPORT_QUERY_LIMITS.positions + 1 }, (_, index) => ({ id: `p${index}` })) };
                }
                return { results: [] };
              },
              async first() { return { cnt: 0 }; },
            };
          },
        };
      },
    };

    await expect(loadDailyReportDataset(db as never, '2026-08-10'))
      .rejects.toThrow(/positions.*exceeds/i);
  });

  it('derives the default report date from the Shanghai calendar rather than UTC', () => {
    expect(getShanghaiReportDate(new Date('2026-08-09T16:30:00.000Z'))).toBe('2026-08-10');
  });

  it('keeps old databases usable without treating updated_at as an approval event', async () => {
    const db = {
      prepare(sql: string) {
        return {
          bind() {
            return {
              async all() {
                if (sql.includes('datetime(approved_at)')) throw new Error('no such column: approved_at');
                if (sql.includes('FROM resumes')) return { results: [{ id: 'pending-old', status: 'pending_review', approved_at: null }] };
                if (sql.includes('FROM offers')) throw new Error('no such table: offers');
                if (sql.includes('FROM onboarding_records')) throw new Error('no such table: onboarding_records');
                return { results: [] };
              },
              async first() { return { cnt: 1 }; },
            };
          },
        };
      },
    };

    const dataset = await loadDailyReportDataset(db as never, '2026-08-10');

    expect(dataset.resumes).toEqual([{ id: 'pending-old', status: 'pending_review', approved_at: null }]);
    expect(dataset.offers).toEqual([]);
    expect(dataset.onboardingRecords).toEqual([]);
  });

  it('propagates core table failures instead of producing an incomplete report', async () => {
    const db = {
      prepare(sql: string) {
        return {
          bind() {
            return {
              async all() {
                if (sql.includes('FROM interviews')) throw new Error('D1 interview read failed');
                return { results: [] };
              },
              async first() { return { cnt: 0 }; },
            };
          },
        };
      },
    };

    await expect(loadDailyReportDataset(db as never, '2026-08-10'))
      .rejects.toThrow('D1 interview read failed');
  });
});

describe('daily-report generation and stored delivery', () => {
  it('persists one immutable v2 snapshot and matching candidate details from one generation pass', async () => {
    const writes: Array<{ sql: string; values: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        return {
          bind(...values: unknown[]) {
            writes.push({ sql, values });
            return { async run() { return { meta: { changes: 1 } }; } };
          },
        };
      },
    };
    let summaryCalls = 0;
    let summaryInput: DailyReportSnapshot | undefined;

    const report = await generateAndPersistDailyReport(
      { DB: db as never },
      '2026-08-10',
      {
        id: () => 'daily-1',
        generatedAt: () => '2026-08-10T10:00:00.000Z',
        loadDataset: async () => aggregateDataset,
        summarize: async (snapshot) => {
          summaryCalls += 1;
          summaryInput = snapshot;
          return '何雨菱推进量较高，待初筛队列需优先处理。明日建议集中清理存量并及时安排面试。';
        },
      },
    );

    expect(summaryCalls).toBe(1);
    expect(summaryInput).toEqual(report.snapshot);
    expect(JSON.stringify(summaryInput)).not.toContain('测试候选人');
    expect(report.snapshot.totals).toEqual(snapshotFixture.totals);
    expect(writes).toHaveLength(1);
    expect(writes[0].sql).toContain('candidate_details');
    const storedSnapshot = JSON.parse(String(writes[0].values[10]));
    const storedDetails = JSON.parse(String(writes[0].values[11]));
    expect(storedSnapshot.totals).toEqual(report.snapshot.totals);
    expect(storedDetails.stats).toEqual({
      total: 1,
      by_person: { '何雨菱': 0, '杜雁玲': 1, '魏秋柠': 0, '未分配': 0 },
    });
    expect(storedDetails.groups[1].candidates).toMatchObject([{ resume_id: 'r-du' }]);
    expect(writes[0].values.slice(2, 9)).toEqual([
      report.snapshot.totals.allTimeResumes,
      report.snapshot.totals.pending,
      report.snapshot.totals.todayApproved,
      report.snapshot.totals.todayRejected,
      report.snapshot.totals.todayInterviews,
      report.snapshot.totals.todayOffers,
      report.snapshot.totals.todayOnboarding,
    ]);
  });

  it('uses the deterministic bounded fallback when AI fails or returns unusable output', async () => {
    const db = {
      prepare() {
        return { bind() { return { async run() { return { meta: { changes: 1 } }; } }; } };
      },
    };
    let calls = 0;
    const report = await generateAndPersistDailyReport(
      { DB: db as never },
      '2026-08-10',
      {
        id: () => 'daily-2',
        generatedAt: () => '2026-08-10T10:00:00.000Z',
        loadDataset: async () => aggregateDataset,
        summarize: async () => {
          calls += 1;
          throw new Error('AI unavailable');
        },
      },
    );

    expect(calls).toBe(1);
    expect(report.ai_summary).toBe(buildDailyReportFallbackSummary(report.snapshot));
    expect(report.ai_summary.length).toBeLessThanOrEqual(150);
  });

  it('builds and sends historical cards only from the stored row without aggregation or AI dependencies', async () => {
    const stored = {
      id: 'daily-stored',
      report_date: snapshotFixture.reportDate,
      ai_summary: '使用已保存的简短摘要。',
      stats: JSON.stringify(snapshotFixture),
    };
    const delivered: unknown[] = [];

    const card = buildStoredDailyReportCard(stored);
    await sendStoredDailyReport(stored, { type: 'chat', id: 'oc_chat' }, async (target, value) => {
      delivered.push({ target, value });
    });

    expect(JSON.stringify(card)).toContain('"tag":"table"');
    expect(delivered).toEqual([{ target: { type: 'chat', id: 'oc_chat' }, value: card }]);
  });

  it('uses the same persisted-row sender for cron generation and manual stored sending', async () => {
    const db = {
      prepare() {
        return { bind() { return { async run() { return { meta: { changes: 1 } }; } }; } };
      },
    };
    const delivered: Array<{ target: unknown; card: unknown }> = [];
    const dependencies = {
      id: () => 'daily-cron',
      generatedAt: () => '2026-08-10T10:00:00.000Z',
      loadDataset: async () => aggregateDataset,
      summarize: async () => '今日招聘工作稳步推进，明日继续清理待初筛队列。',
    };
    const deliver = async (target: { type: 'chat' | 'user'; id: string }, card: unknown) => {
      delivered.push({ target, card });
    };

    const generated = await generatePersistAndDeliverDailyReport(
      { DB: db as never },
      '2026-08-10',
      { type: 'chat', id: 'cron-chat' },
      dependencies,
      deliver,
    );
    await sendStoredDailyReport(generated, { type: 'chat', id: 'manual-chat' }, deliver);

    expect(delivered).toHaveLength(2);
    expect(delivered[0].card).toEqual(buildStoredDailyReportCard(generated));
    expect(delivered[1].card).toEqual(buildStoredDailyReportCard(generated));
  });

  it('rejects invalid report dates before querying or persisting', async () => {
    const db = { prepare() { throw new Error('database must not be queried'); } };
    await expect(generateAndPersistDailyReport({ DB: db as never }, '2026-02-30', {
      id: () => 'never',
      generatedAt: () => '2026-08-10T10:00:00.000Z',
      loadDataset: async () => emptyDataset(),
      summarize: async () => '',
    })).rejects.toThrow(/YYYY-MM-DD/);
  });
});

describe('resume decision timestamps', () => {
  it('sets only the current explicit decision timestamp and clears the opposite one', async () => {
    const updates: Array<{ sql: string; values: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        return {
          bind(...values: unknown[]) {
            return {
              async run() {
                updates.push({ sql, values });
                return { meta: { changes: 1 } };
              },
            };
          },
        };
      },
    };

    await recordResumeDecisionTimestamp(db as never, 'r1', 'approved', '2026-08-10T01:00:00.000Z');
    await recordResumeDecisionTimestamp(db as never, 'r1', 'rejected', '2026-08-10T02:00:00.000Z');
    await recordResumeDecisionTimestamp(db as never, 'r1', 'reset', '2026-08-10T03:00:00.000Z');

    expect(updates[0]).toMatchObject({ values: ['2026-08-10T01:00:00.000Z', 'r1'] });
    expect(updates[0].sql).toContain('approved_at = ?');
    expect(updates[0].sql).toContain('rejected_at = NULL');
    expect(updates[1].sql).toContain('rejected_at = ?');
    expect(updates[1].sql).toContain('approved_at = NULL');
    expect(updates[2].sql).toContain('approved_at = NULL');
    expect(updates[2].sql).toContain('rejected_at = NULL');
  });

  it('keeps core decisions operational on a pre-0026 database without inventing approval time', async () => {
    const legacyUpdates: string[] = [];
    const db = {
      prepare(sql: string) {
        return {
          bind() {
            return {
              async run() {
                if (sql.includes('approved_at')) throw new Error('no such column: approved_at');
                legacyUpdates.push(sql);
                return { meta: { changes: 1 } };
              },
            };
          },
        };
      },
    };

    await expect(recordResumeDecisionTimestamp(db as never, 'r1', 'approved', '2026-08-10T01:00:00.000Z'))
      .resolves.toBe(false);
    await expect(recordResumeDecisionTimestamp(db as never, 'r1', 'rejected', '2026-08-10T02:00:00.000Z'))
      .resolves.toBe(true);
    expect(legacyUpdates).toHaveLength(1);
    expect(legacyUpdates[0]).toContain('rejected_at = ?');
    expect(legacyUpdates[0]).not.toContain('approved_at');
  });
});
