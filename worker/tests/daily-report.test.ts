import { describe, expect, it } from 'vitest';
import {
  buildDailyReportFallbackSummary,
  buildDailyReportFeishuCard,
  buildDailyReportSnapshot,
  type DailyReportDataset,
  type DailyReportSnapshot,
} from '../src/daily-reports/report';

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
      status: 'approved', screening_result: '通过',
    },
    {
      id: 'r-wei', position_applied: 'HR',
      created_at: '2026-08-10T01:00:00.000Z', updated_at: '2026-08-10T04:00:00.000Z',
      status: 'rejected', screening_result: '淘汰',
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
      { id: 'before', position_id: 'p1', created_at: '2026-08-09T15:59:59.999Z', status: 'approved', screening_result: '通过', updated_at: '2026-08-10T15:59:59.999Z' },
      { id: 'start', position_id: 'p1', created_at: '2026-08-09T16:00:00.000Z', status: 'approved', screening_result: '通过', updated_at: '2026-08-10T16:00:00.000Z' },
      { id: 'end', position_id: 'p1', created_at: '2026-08-10T15:59:59.999Z', status: 'approved', screening_result: '通过', updated_at: '2026-08-09T16:00:00.000Z' },
      { id: 'after', position_id: 'p1', created_at: '2026-08-10T16:00:00.000Z', status: 'approved', screening_result: '通过', updated_at: '2026-08-09T15:59:59.999Z' },
    ];

    const snapshot = buildDailyReportSnapshot(dataset, '2026-08-10', '2099-01-01T00:00:00.000Z');

    expect(snapshot.rows[0].todayNew).toBe(2);
    expect(snapshot.rows[0].todayApproved).toBe(2);
    expect(snapshot.reportDate).toBe('2026-08-10');
    expect(snapshot.generatedAt).toBe('2099-01-01T00:00:00.000Z');
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
