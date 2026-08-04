import type { FunnelMetrics, FunnelMetricsQuery, FunnelStageMetrics, CandidateStage } from './types';

const FUNNEL_STAGES: CandidateStage[] = [
  'resume_received',
  'ai_screened',
  'hr_approved',
  'interview_scheduled',
  'interview_passed',
  'offer_sent',
  'offer_accepted',
  'hired',
];

export class FunnelQuery {
  constructor(private db: D1Database) {}

  async compute(query: FunnelMetricsQuery): Promise<FunnelMetrics> {
    if (query.mode === 'cohort') {
      return this.computeCohort(query);
    }
    return this.computeEventTime(query);
  }

  private async computeEventTime(query: FunnelMetricsQuery): Promise<FunnelMetrics> {
    const stages: FunnelStageMetrics[] = [];
    let previousCount: number | undefined;

    for (const stage of FUNNEL_STAGES) {
      let sql = `
        SELECT COUNT(DISTINCT resume_id) as count
        FROM candidate_stage_events
        WHERE stage = ? AND occurred_at >= ? AND occurred_at <= ?
      `;
      const params: any[] = [stage, query.from ?? '1970-01-01', query.to ?? '2099-12-31'];

      if (query.positionId) {
        sql += ' AND position_id = ?';
        params.push(query.positionId);
      }

      const row = await this.db.prepare(sql).bind(...params).first<{ count: number }>();
      const count = row?.count ?? 0;

      const rate = (previousCount != null && previousCount > 0)
        ? Math.round((count / previousCount) * 10000) / 100
        : undefined;

      stages.push({
        stage,
        count,
        previousStageCount: previousCount,
        conversionRate: rate,
      });

      previousCount = count;
    }

    return {
      stages,
      mode: query.mode,
      from: query.from,
      to: query.to,
      computedAt: new Date().toISOString(),
    };
  }

  private async computeCohort(query: FunnelMetricsQuery): Promise<FunnelMetrics> {
    // 先获取窗口内的 resume_received cohort
    let cohortSql = `
      SELECT DISTINCT resume_id
      FROM candidate_stage_events
      WHERE stage = 'resume_received' AND occurred_at >= ? AND occurred_at <= ?
    `;
    const params: any[] = [query.from ?? '1970-01-01', query.to ?? '2099-12-31'];

    if (query.positionId) {
      cohortSql += ' AND position_id = ?';
      params.push(query.positionId);
    }

    const cohort = await this.db.prepare(cohortSql).bind(...params).all<{ resume_id: string }>();
    const resumeIds = cohort.results.map(r => r.resume_id);
    const cohortSize = resumeIds.length;

    const stages: FunnelStageMetrics[] = [];
    let previousCount = cohortSize;

    for (const stage of FUNNEL_STAGES) {
      if (resumeIds.length === 0) {
        stages.push({ stage, count: 0, previousStageCount: previousCount, conversionRate: 0 });
        previousCount = 0;
        continue;
      }

      // 对每个 stage，统计 cohort 内有多少人到达
      const placeholders = resumeIds.map(() => '?').join(',');
      const row = await this.db.prepare(`
        SELECT COUNT(DISTINCT resume_id) as count
        FROM candidate_stage_events
        WHERE stage = ? AND resume_id IN (${placeholders})
      `).bind(stage, ...resumeIds).first<{ count: number }>();

      const count = row?.count ?? 0;
      const rate = previousCount > 0 ? Math.round((count / previousCount) * 10000) / 100 : 0;

      stages.push({
        stage,
        count,
        previousStageCount: previousCount,
        conversionRate: rate,
      });

      previousCount = count;
    }

    return {
      stages,
      mode: query.mode,
      from: query.from,
      to: query.to,
      computedAt: new Date().toISOString(),
    };
  }
}
