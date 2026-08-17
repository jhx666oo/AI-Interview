import { describe, expect, it } from 'vitest';
import { buildDashboardReconciliation } from '../src/recruiting-operations/dashboard-reconciliation';

describe('dashboard reconciliation', () => {
  it('reports Feishu values, D1 increments and merged values without affecting KPI aggregation', () => {
    const result = buildDashboardReconciliation([
      {
        feishu_record_id: 'feishu-1', department: '职培事业部', position_name: '运营', display_name: '运营-杭州', city: '杭州', hrbps: ['何雨菱'], priority: 'P1', status: '招聘中', headcount: 1,
        resume_push: 10, first_scheduled: 2, first_pass: 1, second_pass: 0, third_pass: null, offers: 0, hired: 0, elapsed_days: 4, weekly_target: 0, notes: '',
      },
    ], {
      byPosition: { 'feishu-1': { resume_push_increment: 3, first_scheduled_increment: 1, first_pass_increment: 0, second_pass_increment: 0, third_pass_increment: 0, offers_increment: 0, hired_increment: 0, source_resume_ids: ['r1', 'r2', 'r3'] } },
      d1OnlyPositions: [], unmatchedResumeCount: 2,
    });
    expect(result.metric_differences).toContainEqual(expect.objectContaining({ metric: 'resume_push', feishu_value: 10, d1_increment: 3, merged_value: 13 }));
    expect(result.unmatched_resume_count).toBe(2);
  });
});
