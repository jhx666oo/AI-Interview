/**
 * 事件仓库 — 写入 candidate_stage_events 表
 * 支持幂等写入，INSERT ON CONFLICT DO NOTHING
 */
import type { CandidateStage } from './types';

export class EventRepository {
  constructor(private db: D1Database) {}

  /**
   * 追加一条事件记录（幂等）
   * @returns true 表示新创建，false 表示已存在（幂等跳过）
   */
  async append(event: {
    resumeId: string;
    positionId?: string;
    stage: CandidateStage;
    action: string;
    occurredAt?: string;
    actorUserId?: string;
    source?: string;
    sourceRecordId?: string;
    dedupeKey: string;
    metadata?: Record<string, unknown>;
  }): Promise<boolean> {
    const id = `evt_${crypto.randomUUID()}`;
    const result = await this.db.prepare(`
      INSERT INTO candidate_stage_events (id, resume_id, position_id, stage, action, occurred_at, actor_user_id, source, dedupe_key, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(dedupe_key) DO NOTHING
    `).bind(
      id,
      event.resumeId,
      event.positionId ?? null,
      event.stage,
      event.action,
      event.occurredAt ?? new Date().toISOString(),
      event.actorUserId ?? null,
      event.source ?? 'system',
      event.dedupeKey,
      JSON.stringify(event.metadata ?? {}),
    ).run();

    return (result.meta.changes ?? 0) > 0;
  }

  /**
   * 生成确定性的 dedupe key
   */
  static makeDedupeKey(params: {
    resumeId: string;
    stage: string;
    action: string;
    source: string;
    sourceRecordId?: string;
  }): string {
    const base = params.sourceRecordId
      ? `${params.source}:${params.sourceRecordId}:${params.stage}:${params.action}`
      : `${params.resumeId}:${params.stage}:${params.action}`;
    return base;
  }
}
