// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MiaodaDashboardView } from './MiaodaDashboardView';
import type { DashboardV3Board } from '../v3-types';

const board: DashboardV3Board = {
  schema_version: 'dashboard-v3',
  data_mode: 'live',
  snapshot_date: '2026-08-16',
  updated_at: '2026-08-17T08:00:00.000Z',
  data_source: 'static_excel',
  kpis: {},
  funnel: [
    { key: 'resume_push', label: '简历推送', count: 10, conversion_rate: null },
    { key: 'first_scheduled', label: '安排1面', count: 5, conversion_rate: 50 },
    { key: 'first_pass', label: '1面通过', count: 2, conversion_rate: 40 },
    { key: 'second_pass', label: '2面通过', count: 1, conversion_rate: 50 },
    { key: 'final_pass', label: '终面通过', count: 1, conversion_rate: 100 },
    { key: 'offers', label: '发放Offer', count: 1, conversion_rate: 100 },
    { key: 'hired', label: '已入职', count: 1, conversion_rate: 100 },
  ],
  totals: {
    active_positions: 1, headcount: 2, resume_push: 10, first_scheduled: 5, first_pass: 2,
    second_pass: 1, final_pass: 1, offers: 1, hired: 1, interview_pass_rate: 20,
    offer_conversion_rate: 100, hire_conversion_rate: 100, average_completed_cycle_days: 8.5,
    in_progress_position_count: 1, in_progress_average_elapsed_days: 12,
  },
  divisions: [{
    department: '职培事业部', hrbps: ['王凯月'], positions: [], p0_position_count: 1, p1_position_count: 0,
    completed_position_count: 0, in_progress_position_count: 1, in_progress_average_elapsed_days: 12,
    totals: {
      active_positions: 1, headcount: 2, resume_push: 10, first_scheduled: 5, first_pass: 2,
      second_pass: 1, final_pass: 1, offers: 1, hired: 1, interview_pass_rate: 20,
      offer_conversion_rate: 100, hire_conversion_rate: 100, average_completed_cycle_days: null,
      in_progress_position_count: 1, in_progress_average_elapsed_days: 12,
    },
    funnel: [],
  }],
  hrbps: [],
  positions: [],
  p2_positions: [],
  insights: { summary: '当前有 1 个统计岗位。', bottlenecks: ['安排1面转化率为 50%'], recommendations: ['优先复盘筛选环节。'] },
  weekly_dynamic: { resume_push: 2, first_scheduled: 1, first_pass: 1, second_pass: 0, final_pass: 0, offers: 0, hired: 0, baseline_date: '2026-08-09' },
};

describe('MiaodaDashboardView', () => {
  afterEach(() => cleanup());

  it('renders the reference dashboard sections and live values', () => {
    render(<MiaodaDashboardView board={board} />);
    expect(screen.getByText('总体概览')).toBeTruthy();
    expect(screen.getByText('招聘漏斗（全事业部汇总 · 岗位累计口径）')).toBeTruthy();
    expect(screen.getByText('周招聘动态')).toBeTruthy();
    expect(screen.getByText('职培事业部')).toBeTruthy();
    expect(screen.getAllByText('简历推送').length).toBeGreaterThan(0);
    expect(screen.getByText('当前有 1 个统计岗位。')).toBeTruthy();
  });

  it('exposes funnel stages as hoverable data points with entry and previous-stage rates', () => {
    const view = render(<MiaodaDashboardView board={{ ...board, funnel: [
      { key: 'resume_push', label: '简历推送', count: 10, conversion_rate: null },
      { key: 'first_scheduled', label: '安排1面', count: 5, conversion_rate: 50 },
    ] }} />);

    const firstStage = view.getAllByRole('img', {
      name: '简历推送：10人，相对上一层100.0%，相对总入口100.0%',
    })[0];
    expect(firstStage).toBeTruthy();
    expect(view.getAllByRole('img', {
      name: '安排1面：5人，相对上一层50.0%，相对总入口50.0%',
    }).length).toBeGreaterThan(0);
  });

  it('uses a stable progressive silhouette independent of stage count outliers', () => {
    const view = render(<MiaodaDashboardView board={{ ...board, funnel: [
      { key: 'resume_push', label: '简历推送', count: 100, conversion_rate: null },
      { key: 'first_scheduled', label: '安排1面', count: 20, conversion_rate: 20 },
      { key: 'first_pass', label: '1面通过', count: 1, conversion_rate: 5 },
    ] }} />);

    const widths = view.getAllByRole('img')
      .map((shape) => (shape.firstElementChild as HTMLElement | null)?.style.width ?? '')
      .filter(Boolean);
    expect(widths).toEqual(['100%', '65%', '30%']);
  });

  it('renders each funnel stage as an inverted trapezoid', () => {
    const view = render(<MiaodaDashboardView board={board} />);
    const shape = view.getAllByRole('img')
      .map((item) => item.firstElementChild as HTMLElement | null)
      .find((item) => item?.style.width === '100%');

    expect(shape?.style.clipPath).toBe('polygon(0% 0%, 100% 0%, 93% 100%, 7% 100%)');
  });

  it('provides a weekly dynamic refresh control', async () => {
    let refreshCount = 0;
    const view = render(<MiaodaDashboardView board={board} onRefresh={async () => { refreshCount += 1; }} />);
    fireEvent.click(view.getByRole('button', { name: '刷新' }));
    await waitFor(() => expect(refreshCount).toBe(1));
  });

  it('renders the grouped detail table with a collapsed department control', () => {
    const detailPosition = {
      position_id: 'position-1', department: '职培事业部', position_name: '招聘销售', display_name: '招聘销售-杭州',
      city: '杭州', hrbps: ['王凯月'], priority: 'P1' as const, status: '初筛中', headcount: 1,
      resume_push: 2, first_scheduled: 1, first_pass: 0, second_pass: 0, third_pass: 0, final_pass: 0,
      offers: 0, hired: 0, elapsed_days: 4, weekly_target: 0, notes: '待跟进', data_sources: ['static_excel'],
    };
    render(<MiaodaDashboardView board={{ ...board, positions: [detailPosition], divisions: [] }} />);
    expect(screen.getAllByText('招聘销售-杭州').length).toBeGreaterThan(0);
    expect(screen.getByText('合计')).toBeTruthy();
    const toggle = screen.getByRole('button', { name: /职培事业部/ });
    fireEvent.click(toggle);
    expect(screen.queryAllByText('招聘销售-杭州')).toHaveLength(0);
    fireEvent.click(toggle);
    expect(screen.getAllByText('招聘销售-杭州').length).toBeGreaterThan(0);
  });

  it('uses the blue tone for the OFFER中 status tag', () => {
    const offerPosition = {
      position_id: 'position-offer', department: '职培事业部', position_name: '招聘销售', display_name: '招聘销售-杭州',
      city: '杭州', hrbps: ['王凯月'], priority: 'P1' as const, status: 'OFFER中', headcount: 1,
      resume_push: 2, first_scheduled: 1, first_pass: 1, second_pass: 1, third_pass: 0, final_pass: 1,
      offers: 0, hired: 0, elapsed_days: 4, weekly_target: 0, notes: '待发放', data_sources: ['static_excel'],
    };
    render(<MiaodaDashboardView board={{ ...board, positions: [offerPosition], divisions: [] }} />);
    expect(screen.getAllByText('OFFER中').every((element) => element.className.includes('miaodaStatusBlue'))).toBe(true);
  });
});
