import type { D1Database } from '@cloudflare/workers-types';
import {
  createD1BusinessScreeningRouteStore,
  pushResumesToBusinessScreening,
  type BusinessScreeningRouteDeps,
  type BusinessScreeningRouteStore,
} from './routes';
import { createScopePublicToken } from './token';
import { resolveExactInterviewerOpenId } from '../feishu-notifications/reminder-source';

/**
 * AI 初筛结果自动联动业务筛选（简历处理队列在初筛完成后调用）：
 * - screening_result = '通过' → 自动推送到业务筛选链接（追加到该面试官的固定批次/链接；
 *   仅当新建批次时尝试发送飞书卡片，追加到已有批次不重复打扰）；
 * - screening_result = '不通过' → 自动从业务筛选链接移除（删除未决条目并重置推送状态，
 *   业务已进入终态或 HR 已淘汰时不改动）。
 * 全程 best-effort：任一环节失败不影响简历处理主流程。
 */

export interface BusinessScreeningAutoLinkDeps {
  now: () => string;
  uuid: () => string;
  createScopePublicToken: typeof createScopePublicToken;
  store: BusinessScreeningRouteStore;
}

export function buildBusinessScreeningAutoLinkDeps(): BusinessScreeningAutoLinkDeps {
  return {
    now: () => new Date().toISOString(),
    uuid: () => crypto.randomUUID(),
    createScopePublicToken,
    store: createD1BusinessScreeningRouteStore(resolveExactInterviewerOpenId),
  };
}

export interface BusinessScreeningAutoLinkResult {
  action: 'push' | 'remove' | 'skip';
  detail?: string;
}

export async function syncAiResultToBusinessScreening(
  db: D1Database,
  deps: BusinessScreeningAutoLinkDeps,
  resumeId: string,
): Promise<BusinessScreeningAutoLinkResult> {
  const row = await db.prepare(
    `SELECT id, screening_result, hr_disposition, business_screening_status, status
       FROM resumes
      WHERE id = ?
      LIMIT 1`,
  ).bind(resumeId).first<{
    id: string;
    screening_result: string | null;
    hr_disposition: string | null;
    business_screening_status: string | null;
    status: string | null;
  }>();
  if (!row) return { action: 'skip', detail: 'resume not found' };
  const result = (row.screening_result || '').trim();

  if (result === '通过') {
    // 自动推送：复用统一推送服务。系统身份（user=null）下不会发送飞书卡片；
    // 仅新建批次时尝试发送，追加到已有批次不重复打扰。
    const push = await pushResumesToBusinessScreening(
      db,
      deps as unknown as BusinessScreeningRouteDeps,
      {
        ids: [resumeId],
        silent: false,
        notifyNewBatchOnly: true,
        createdBy: 'system-ai-auto',
      },
      { origin: 'https://ai-interview-88r.pages.dev', user: null, env: {} },
    );
    const detail = push.ok
      ? `pushed=${push.pushed.length}`
      : `failed=${JSON.stringify({ skipped: push.skipped, failed: push.failed })}`;
    return { action: 'push', detail };
  }

  if (result === '不通过') {
    const { removed } = await deps.store.removeResumeFromBusinessScreeningBatches(db, resumeId, deps.now());
    return { action: 'remove', detail: `removed=${removed}` };
  }

  return { action: 'skip', detail: 'no screening_result' };
}
