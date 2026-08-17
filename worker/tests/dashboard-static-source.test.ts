import { describe, expect, it } from 'vitest';
import {
  STATIC_DASHBOARD_SNAPSHOT_DATE,
  loadStaticDashboardPositions,
} from '../src/recruiting-operations/dashboard-static-source';
import { finalPass } from '../src/recruiting-operations/feishu-board-source';
import { buildDashboardV3 } from '../src/recruiting-operations/dashboard-v3';

const emptyOverlay = {
  byPosition: {},
  d1OnlyPositions: [],
  unmatchedResumeCount: 0,
} as const;

describe('static recruitment dashboard snapshot', () => {
  it('loads the 2026-08-16 Excel snapshot and separates the five P2 rows', () => {
    const positions = loadStaticDashboardPositions();

    expect(STATIC_DASHBOARD_SNAPSHOT_DATE).toBe('2026-08-16');
    expect(positions).toHaveLength(42);
    expect(positions.filter((position) => position.priority === 'P2')).toHaveLength(5);

    const statistical = positions.filter((position) => position.priority !== 'P2');
    expect(statistical.reduce((sum, position) => sum + position.resume_push, 0)).toBe(971);
    expect(statistical.reduce((sum, position) => sum + position.first_scheduled, 0)).toBe(363);
    expect(statistical.reduce((sum, position) => sum + finalPass(position), 0)).toBe(54);
    expect(statistical.reduce((sum, position) => sum + position.offers, 0)).toBe(24);
    expect(statistical.reduce((sum, position) => sum + position.hired, 0)).toBe(20);

    expect(positions.find((position) => position.display_name === '招生销售-厦门')?.priority).toBe('P2');
    expect(positions.find((position) => position.display_name === '商家运营专员-杭州')?.priority).toBe('P2');
    expect(positions.find((position) => position.display_name === '招生销售-北京')?.hrbps).toEqual(['王凯月']);
  });

  it('marks the board as sourced from the static Excel snapshot', () => {
    const board = buildDashboardV3({
      feishuPositions: loadStaticDashboardPositions(),
      d1Overlay: emptyOverlay,
      dataMode: 'live',
      dataSource: 'static_excel',
      snapshotDate: STATIC_DASHBOARD_SNAPSHOT_DATE,
      updatedAt: '2026-08-16T09:30:00.000Z',
    });

    expect(board.data_source).toBe('static_excel');
    expect(board.snapshot_date).toBe(STATIC_DASHBOARD_SNAPSHOT_DATE);
    expect(board.totals.resume_push).toBe(971);
  });
});
