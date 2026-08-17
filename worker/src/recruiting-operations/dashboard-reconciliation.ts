import type { D1DashboardOverlay } from './d1-dashboard-overlay';
import type { FeishuPositionMetric } from './feishu-board-source';

export interface DashboardReconciliation {
  generated_at: string;
  feishu_position_count: number;
  d1_overlay_position_count: number;
  unmatched_resume_count: number;
  metric_differences: Array<{
    position_key: string;
    metric: string;
    feishu_value: number;
    d1_increment: number;
    merged_value: number;
    reason: string;
  }>;
}

const METRICS: Array<[keyof FeishuPositionMetric, keyof D1DashboardOverlay['byPosition'][string]]> = [
  ['resume_push', 'resume_push_increment'],
  ['first_scheduled', 'first_scheduled_increment'],
  ['first_pass', 'first_pass_increment'],
  ['second_pass', 'second_pass_increment'],
  ['offers', 'offers_increment'],
  ['hired', 'hired_increment'],
];

export function buildDashboardReconciliation(
  feishuPositions: FeishuPositionMetric[],
  overlay: D1DashboardOverlay,
  generatedAt = new Date().toISOString(),
): DashboardReconciliation {
  const differences: DashboardReconciliation['metric_differences'] = [];
  for (const position of feishuPositions) {
    const increment = overlay.byPosition[position.feishu_record_id];
    if (!increment) continue;
    for (const [feishuMetric, d1Metric] of METRICS) {
      const d1Value = Number(increment[d1Metric]) || 0;
      if (d1Value <= 0) continue;
      const feishuValue = Number(position[feishuMetric]) || 0;
      differences.push({
        position_key: position.feishu_record_id,
        metric: String(feishuMetric),
        feishu_value: feishuValue,
        d1_increment: d1Value,
        merged_value: feishuValue + d1Value,
        reason: 'D1 独有记录叠加到飞书岗位累计值',
      });
    }
  }
  return {
    generated_at: generatedAt,
    feishu_position_count: feishuPositions.length,
    d1_overlay_position_count: Object.keys(overlay.byPosition).length + overlay.d1OnlyPositions.length,
    unmatched_resume_count: overlay.unmatchedResumeCount,
    metric_differences: differences,
  };
}
