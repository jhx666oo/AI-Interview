import type { DashboardDataMode } from './share-links';
import {
  buildFunnelStages,
  DASHBOARD_DIVISION_FUNNEL_STAGES,
  finalPassCount,
  isStatisticalPriority,
  rateOrNull,
  type DashboardV3Board,
  type DashboardV3Division,
  type DashboardV3Hrbp,
  type DashboardV3Position,
  type DashboardV3Totals,
} from './dashboard-v3-types';
import type { D1DashboardOverlay } from './d1-dashboard-overlay';
import { finalPass, isCycleEligiblePosition, isP2Position, isStatisticalPosition, type FeishuPositionMetric } from './feishu-board-source';
import { buildRecruitingBoard, type RecruitingBoard, type RecruitingBoardPositionRow } from './dashboard';

function emptyTotals(): DashboardV3Totals {
  return {
    active_positions: 0, headcount: 0, resume_push: 0, first_scheduled: 0, first_pass: 0,
    second_pass: 0, final_pass: 0, offers: 0, hired: 0, interview_pass_rate: null,
    offer_conversion_rate: null, hire_conversion_rate: null, average_completed_cycle_days: null,
    in_progress_position_count: 0, in_progress_average_elapsed_days: null,
  };
}

function mergePosition(source: FeishuPositionMetric, overlay: D1DashboardOverlay['byPosition'][string] | undefined): DashboardV3Position {
  const increment = overlay || {
    resume_push_increment: 0, first_scheduled_increment: 0, first_pass_increment: 0,
    second_pass_increment: 0, third_pass_increment: 0, offers_increment: 0, hired_increment: 0,
    source_resume_ids: [],
  };
  const thirdPass = source.third_pass === null && increment.third_pass_increment === 0
    ? null
    : source.third_pass === null ? increment.third_pass_increment : source.third_pass + increment.third_pass_increment;
  const secondPass = source.second_pass + increment.second_pass_increment;
  const firstPass = source.first_pass + increment.first_pass_increment;
  const firstScheduled = source.first_scheduled + increment.first_scheduled_increment;
  return {
    position_id: source.feishu_record_id,
    department: source.department,
    position_name: source.position_name,
    display_name: source.display_name,
    city: source.city,
    hrbps: source.hrbps,
    priority: source.priority,
    status: source.status,
    headcount: source.headcount,
    resume_push: source.resume_push + increment.resume_push_increment,
    first_scheduled: firstScheduled,
    first_pass: firstPass,
    second_pass: secondPass,
    third_pass: thirdPass ?? 0,
    final_pass: finalPass({ third_pass: thirdPass, second_pass: secondPass }),
    offers: source.offers + increment.offers_increment,
    hired: source.hired + increment.hired_increment,
    elapsed_days: source.elapsed_days,
    weekly_target: source.weekly_target,
    notes: source.notes,
    data_sources: increment.source_resume_ids.length > 0 || Object.values(increment).some((value) => typeof value === 'number' && value > 0)
      ? ['merged']
      : ['feishu'],
  };
}

function totalsFor(positions: DashboardV3Position[], cyclePositions: DashboardV3Position[] = positions): DashboardV3Totals {
  const totals = positions.reduce((result, position) => {
    result.active_positions += 1;
    result.headcount += position.headcount;
    result.resume_push += position.resume_push;
    result.first_scheduled += position.first_scheduled;
    result.first_pass += position.first_pass;
    result.second_pass += position.second_pass;
    result.final_pass += position.final_pass;
    result.offers += position.offers;
    result.hired += position.hired;
    if (!/(完成|取消)/.test(position.status)) {
      result.in_progress_position_count += 1;
    }
    return result;
  }, emptyTotals());
  totals.interview_pass_rate = rateOrNull(totals.final_pass, totals.first_scheduled);
  totals.offer_conversion_rate = rateOrNull(totals.offers, totals.final_pass);
  totals.hire_conversion_rate = rateOrNull(totals.hired, totals.offers);
  const completed = cyclePositions.filter((position) => /(完成|取消)/.test(position.status) && position.elapsed_days > 0);
  totals.average_completed_cycle_days = completed.length > 0
    ? Math.round(completed.reduce((sum, position) => sum + position.elapsed_days, 0) / completed.length * 10) / 10
    : null;
  const inProgress = positions.filter((position) => !/(完成|取消)/.test(position.status));
  totals.in_progress_average_elapsed_days = inProgress.length > 0
    ? Math.round(inProgress.reduce((sum, position) => sum + position.elapsed_days, 0) / inProgress.length * 10) / 10
    : null;
  return totals;
}

function groupDivisions(positions: DashboardV3Position[], cyclePositions: DashboardV3Position[]): DashboardV3Division[] {
  const groups = new Map<string, DashboardV3Position[]>();
  for (const position of positions) groups.set(position.department, [...(groups.get(position.department) || []), position]);
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right, 'zh-Hans-CN')).map(([department, rows]) => {
    const cycleRows = cyclePositions.filter((position) => position.department === department);
    const totals = totalsFor(rows, cycleRows);
    return {
      department,
      hrbps: [...new Set(rows.flatMap((position) => position.hrbps))].sort((left, right) => left.localeCompare(right, 'zh-Hans-CN')),
      totals,
      positions: rows,
      funnel: buildFunnelStages(totals, DASHBOARD_DIVISION_FUNNEL_STAGES),
      p0_position_count: rows.filter((position) => position.priority === 'P0').length,
      p1_position_count: rows.filter((position) => position.priority === 'P1').length,
      completed_position_count: rows.filter((position) => /(完成|取消)/.test(position.status)).length,
      in_progress_position_count: totals.in_progress_position_count,
      in_progress_average_elapsed_days: totals.in_progress_average_elapsed_days,
    };
  });
}

function groupHrbps(positions: DashboardV3Position[], cyclePositions: DashboardV3Position[]): DashboardV3Hrbp[] {
  const groups = new Map<string, DashboardV3Position[]>();
  for (const position of positions) {
    for (const name of position.hrbps.length > 0 ? position.hrbps : ['未分配']) {
      groups.set(name, [...(groups.get(name) || []), position]);
    }
  }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right, 'zh-Hans-CN')).map(([name, rows]) => {
    const cycleRows = cyclePositions.filter((position) => rows.includes(position));
    const totals = totalsFor(rows, cycleRows);
    return {
      name,
      department: [...new Set(rows.map((position) => position.department))].join('、'),
      position_count: rows.length,
      headcount: totals.headcount,
      p0_position_count: rows.filter((position) => position.priority === 'P0').length,
      p0_headcount: rows.filter((position) => position.priority === 'P0').reduce((sum, position) => sum + position.headcount, 0),
      average_completed_cycle_days: totals.average_completed_cycle_days,
      in_progress_position_count: totals.in_progress_position_count,
      in_progress_average_elapsed_days: totals.in_progress_average_elapsed_days,
      resume_push: totals.resume_push,
      first_scheduled: totals.first_scheduled,
      first_pass: totals.first_pass,
      second_pass: totals.second_pass,
      final_pass: totals.final_pass,
      offers: totals.offers,
      hired: totals.hired,
      conversion_rates: {
        first_over_resume: rateOrNull(totals.first_scheduled, totals.resume_push),
        final_over_first: rateOrNull(totals.final_pass, totals.first_scheduled),
        offer_over_final: rateOrNull(totals.offers, totals.final_pass),
        hired_over_offer: rateOrNull(totals.hired, totals.offers),
      },
    };
  });
}

function insights(totals: DashboardV3Totals, unmatchedResumeCount: number): DashboardV3Board['insights'] {
  const stages = buildFunnelStages(totals);
  const conversions = stages.slice(1).filter((stage) => stage.conversion_rate !== null) as Array<typeof stages[number] & { conversion_rate: number }>;
  if (conversions.length === 0) {
    return {
      summary: `当前有 ${totals.active_positions} 个统计岗位，暂无足够漏斗数据。`,
      bottlenecks: unmatchedResumeCount > 0 ? [`有 ${unmatchedResumeCount} 份简历未匹配岗位`] : ['暂无足够漏斗数据'],
      recommendations: ['补充岗位映射并推进待处理招聘环节。'],
    };
  }
  const bottleneck = conversions.reduce((lowest, current) => current.conversion_rate < lowest.conversion_rate ? current : lowest);
  return {
    summary: `当前有 ${totals.active_positions} 个统计岗位，累计收到 ${totals.resume_push} 份简历。`,
    bottlenecks: [`${bottleneck.label}环节转化率为 ${bottleneck.conversion_rate}%，需要优先关注。`, ...(unmatchedResumeCount > 0 ? [`${unmatchedResumeCount} 份简历尚未匹配到岗位。`] : [])],
    recommendations: [`建议优先复盘${bottleneck.label}前一环节的处理效率，并持续核对飞书与 D1 数据。`],
  };
}

function dynamicValue(current: number, baseline: number | undefined): number {
  return baseline === undefined ? 0 : Math.max(0, current - baseline);
}

export function buildDashboardV3(input: {
  feishuPositions: FeishuPositionMetric[];
  d1Overlay: D1DashboardOverlay;
  baseline?: DashboardV3Board | null;
  dataMode: DashboardDataMode;
  snapshotDate?: string | null;
  updatedAt: string;
}): DashboardV3Board {
  const merged = input.feishuPositions.map((position) => mergePosition(position, input.d1Overlay.byPosition[position.feishu_record_id]));
  const d1Only = input.d1Overlay.d1OnlyPositions;
  const statistical = [...merged.filter((position) => isStatisticalPosition({ ...position, headcount: position.headcount })), ...d1Only.filter((position) => isStatisticalPriority(position.priority) && position.headcount > 0 && position.status !== '已取消')];
  const p2 = [...merged.filter((position) => isP2Position(position)), ...d1Only.filter((position) => isP2Position(position))];
  const cyclePositions = merged.filter((position) => isCycleEligiblePosition({ ...position, headcount: position.headcount }));
  const totals = totalsFor(statistical, cyclePositions);
  const baselineTotals = input.baseline?.totals;
  return {
    schema_version: 'dashboard-v3',
    data_mode: input.dataMode,
    snapshot_date: input.snapshotDate || null,
    updated_at: input.updatedAt,
    kpis: {
      active_positions: { value: totals.active_positions, available: true },
      headcount: { value: totals.headcount, available: true },
      resume_push: { value: totals.resume_push, available: true },
      first_scheduled: { value: totals.first_scheduled, available: true },
      first_pass: { value: totals.first_pass, available: true },
      final_pass: { value: totals.final_pass, available: true },
      offers: { value: totals.offers, available: true },
      hired: { value: totals.hired, available: true },
      interview_pass_rate: { value: totals.interview_pass_rate, available: totals.interview_pass_rate !== null },
      offer_conversion_rate: { value: totals.offer_conversion_rate, available: totals.offer_conversion_rate !== null },
      hire_conversion_rate: { value: totals.hire_conversion_rate, available: totals.hire_conversion_rate !== null },
    },
    funnel: buildFunnelStages(totals),
    divisions: groupDivisions(statistical, cyclePositions),
    hrbps: groupHrbps(statistical, cyclePositions),
    p2_positions: p2,
    positions: statistical,
    totals,
    insights: insights(totals, input.d1Overlay.unmatchedResumeCount),
    weekly_dynamic: {
      resume_push: dynamicValue(totals.resume_push, baselineTotals?.resume_push),
      first_scheduled: dynamicValue(totals.first_scheduled, baselineTotals?.first_scheduled),
      offers: dynamicValue(totals.offers, baselineTotals?.offers),
      hired: dynamicValue(totals.hired, baselineTotals?.hired),
      baseline_date: input.baseline?.snapshot_date || null,
    },
  };
}

/**
 * Applies the same owner scope to a stored board that is applied while loading
 * live data.  Rebuilding the aggregates here is important: filtering only the
 * position array would leave global KPIs and funnel totals from another
 * owner's data visible in a shared/snapshot view.
 */
export function scopeDashboardV3Board(board: DashboardV3Board, owner: string | null): DashboardV3Board {
  if (!owner) return board;
  const positions = board.positions.filter((position) => position.hrbps.includes(owner));
  const cyclePositions = positions.filter((position) => /(完成|取消)/.test(position.status) && position.elapsed_days > 0);
  const totals = totalsFor(positions, cyclePositions);
  return {
    ...board,
    positions,
    p2_positions: board.p2_positions.filter((position) => position.hrbps.includes(owner)),
    totals,
    funnel: buildFunnelStages(totals),
    divisions: groupDivisions(positions, cyclePositions),
    hrbps: groupHrbps(positions, cyclePositions).filter((hrbp) => hrbp.name === owner),
    kpis: {
      ...board.kpis,
      active_positions: { value: totals.active_positions, available: true },
      headcount: { value: totals.headcount, available: true },
      resume_push: { value: totals.resume_push, available: true },
      first_scheduled: { value: totals.first_scheduled, available: true },
      first_pass: { value: totals.first_pass, available: true },
      final_pass: { value: totals.final_pass, available: true },
      offers: { value: totals.offers, available: true },
      hired: { value: totals.hired, available: true },
      interview_pass_rate: { value: totals.interview_pass_rate, available: totals.interview_pass_rate !== null },
      offer_conversion_rate: { value: totals.offer_conversion_rate, available: totals.offer_conversion_rate !== null },
      hire_conversion_rate: { value: totals.hire_conversion_rate, available: totals.hire_conversion_rate !== null },
    },
    insights: insights(totals, 0),
  };
}

export function toLegacyRecruitingBoard(board: DashboardV3Board): RecruitingBoard {
  const rows: RecruitingBoardPositionRow[] = board.positions.map((position) => ({
    position_id: position.position_id,
    division: position.department,
    hrbp: position.hrbps.join('/'),
    position: position.display_name,
    priority: position.priority,
    headcount: position.headcount,
    total_resumes: position.resume_push,
    ai_screened: position.first_pass,
    first_interview: position.first_scheduled,
    first_pass: position.first_pass,
    second_pass: position.second_pass,
    third_pass: position.final_pass,
    offers: position.offers,
    hired: position.hired,
    notes: position.notes,
    status: position.status,
    unmatched: position.unmatched,
  }));
  return buildRecruitingBoard(rows, {
    dataMode: board.data_mode,
    updatedAt: board.updated_at,
    snapshotDate: board.snapshot_date,
  });
}
