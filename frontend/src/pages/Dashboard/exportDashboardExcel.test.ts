import { describe, expect, it } from 'vitest';
import { buildMiaodaExportRows, MIAODA_EXPORT_HEADERS } from './exportDashboardExcel';
import type { DashboardV3Board } from './v3-types';

const board = {
  schema_version: 'dashboard-v3',
  data_mode: 'snapshot',
  snapshot_date: '2026-08-16',
  updated_at: '2026-08-16T17:30:00+08:00',
  kpis: {},
  funnel: [],
  divisions: [],
  hrbps: [],
  p2_positions: [],
  positions: [{
    position_id: 'position-1',
    department: '职培事业部',
    position_name: '招生销售',
    display_name: '招生销售-北京',
    position_type: '招生销售',
    city: '北京',
    hrbps: ['王凯月'],
    priority: 'P1',
    status: 'OFFER中',
    headcount: 5,
    resume_push: 38,
    first_scheduled: 24,
    first_pass: 9,
    second_pass: 8,
    third_pass: 5,
    final_pass: 5,
    offers: 4,
    hired: 3,
    elapsed_days: 30,
    weekly_target: 3,
    notes: '（8月7日入职）',
    data_sources: ['static_excel'],
  }],
  totals: {
    active_positions: 1, headcount: 5, resume_push: 38, first_scheduled: 24, first_pass: 9,
    second_pass: 8, final_pass: 5, offers: 4, hired: 3, interview_pass_rate: 20.8,
    offer_conversion_rate: 80, hire_conversion_rate: 75, average_completed_cycle_days: null,
    in_progress_position_count: 1, in_progress_average_elapsed_days: 30,
  },
  insights: { summary: '', bottlenecks: [], recommendations: [] },
  weekly_dynamic: { resume_push: 0, first_scheduled: 0, offers: 0, hired: 0, baseline_date: null },
} satisfies DashboardV3Board;

describe('buildMiaodaExportRows', () => {
  it('matches the 2026-08-16 workbook headers, order, and row values', () => {
    const [row] = buildMiaodaExportRows(board);

    expect(Object.keys(row)).toEqual([...MIAODA_EXPORT_HEADERS]);
    expect(row).toEqual({
      事业部: '职培事业部',
      岗位名称: '招生销售-北京',
      岗位类型: '招生销售',
      城市: '北京',
      HRBP: '王凯月',
      招聘状态: 'OFFER中',
      在招人数: 5,
      简历推送: 38,
      安排1面: 24,
      '1面通过': 9,
      '2面通过': 8,
      终面通过: 5,
      发放Offer: 4,
      入职数: 3,
      已耗时天数: 30,
      备注: '（8月7日入职）',
      本周需完结: 3,
    });
  });

  it('exports multiple HRBPs as a readable single cell and falls back for missing type', () => {
    const [row] = buildMiaodaExportRows({
      ...board,
      positions: [{ ...board.positions[0], position_type: undefined, hrbps: ['何雨菱', '魏秋柠'] }],
    });

    expect(row.HRBP).toBe('何雨菱 / 魏秋柠');
    expect(row.岗位类型).toBe('招生销售');
  });

  it('includes P2 reserve positions in the full workbook export', () => {
    const p2 = { ...board.positions[0], position_id: 'p2', priority: 'P2' as const, position_type: '储备岗位' };
    const rows = buildMiaodaExportRows({ ...board, p2_positions: [p2] });

    expect(rows).toHaveLength(2);
    expect(rows[1].招聘状态).toBe('OFFER中');
  });
});
