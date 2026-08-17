import { describe, expect, it } from 'vitest';
import { buildDashboardV3, scopeDashboardV3Board } from '../src/recruiting-operations/dashboard-v3';
import type { D1DashboardOverlay } from '../src/recruiting-operations/d1-dashboard-overlay';
import type { FeishuPositionMetric } from '../src/recruiting-operations/feishu-board-source';

const position = (overrides: Partial<FeishuPositionMetric> = {}): FeishuPositionMetric => ({
  feishu_record_id: 'rec-1', department: '职培事业部', position_name: '招聘专员', display_name: '招聘专员-杭州', city: '杭州',
  hrbps: ['雨菱'], priority: 'P1', status: '招聘中', headcount: 2, resume_push: 10,
  first_scheduled: 5, first_pass: 3, second_pass: 2, third_pass: null, offers: 1, hired: 1,
  elapsed_days: 8, weekly_target: 1, notes: '', ...overrides,
});

const overlay: D1DashboardOverlay = {
  byPosition: {
    'rec-1': {
      resume_push_increment: 2, first_scheduled_increment: 1, first_pass_increment: 1, second_pass_increment: 0,
      third_pass_increment: 0, offers_increment: 1, hired_increment: 0, source_resume_ids: ['local-1'],
    },
  },
  d1OnlyPositions: [],
  unmatchedResumeCount: 0,
};

describe('dashboard v3 aggregation', () => {
  it('merges D1 increments before computing the seven-level funnel', () => {
    const board = buildDashboardV3({ feishuPositions: [position()], d1Overlay: overlay, dataMode: 'live', updatedAt: '2026-08-17T00:00:00.000Z' });
    expect(board.totals.resume_push).toBe(12);
    expect(board.totals.first_scheduled).toBe(6);
    expect(board.totals.first_pass).toBe(4);
    expect(board.totals.final_pass).toBe(2);
    expect(board.totals.offers).toBe(2);
    expect(board.funnel.map((stage) => stage.key)).toEqual(['resume_push', 'first_scheduled', 'first_pass', 'second_pass', 'final_pass', 'offers', 'hired']);
  });

  it('keeps P2 out of KPI/division/HRBP totals and exposes it separately', () => {
    const board = buildDashboardV3({ feishuPositions: [position(), position({ feishu_record_id: 'rec-p2', priority: 'P2', display_name: '储备岗-杭州', resume_push: 99 })], d1Overlay: { ...overlay, byPosition: {} }, dataMode: 'live', updatedAt: '2026-08-17T00:00:00.000Z' });
    expect(board.totals.resume_push).toBe(10);
    expect(board.p2_positions).toHaveLength(1);
    expect(board.divisions).toHaveLength(1);
    expect(board.hrbps).toHaveLength(1);
  });

  it('uses the previous snapshot for weekly increments and avoids divide-by-zero', () => {
    const baseline = buildDashboardV3({ feishuPositions: [position({ resume_push: 8 })], d1Overlay: { ...overlay, byPosition: {} }, dataMode: 'snapshot', snapshotDate: '2026-08-16', updatedAt: '2026-08-16T00:00:00.000Z' });
    const board = buildDashboardV3({ feishuPositions: [position()], d1Overlay: { ...overlay, byPosition: {} }, baseline, dataMode: 'live', updatedAt: '2026-08-17T00:00:00.000Z' });
    expect(board.weekly_dynamic.resume_push).toBe(2);
    expect(board.totals.interview_pass_rate).toBe(40);
    expect(board.totals.offer_conversion_rate).toBe(50);
  });

  it('rebuilds owner-scoped totals instead of leaking company aggregates', () => {
    const board = buildDashboardV3({ feishuPositions: [position(), position({ feishu_record_id: 'rec-other', hrbps: ['魏魏'], resume_push: 20 })], d1Overlay: { ...overlay, byPosition: {} }, dataMode: 'snapshot', snapshotDate: '2026-08-17', updatedAt: '2026-08-17T00:00:00.000Z' });
    const scoped = scopeDashboardV3Board(board, '雨菱');
    expect(scoped.totals.resume_push).toBe(10);
    expect(scoped.funnel[0].count).toBe(10);
    expect(scoped.hrbps.map((item) => item.name)).toEqual(['雨菱']);
  });
});
