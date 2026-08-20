import { createResumePushBatch, insertResumePushBatchItemsIfAbsent, markResumesPushed } from './repository';
import { createScopePublicToken } from './token';
import type { BusinessScreeningResumeRecord } from './routes';

export interface AutoBusinessDispatchEnv {
  DB: D1Database;
  FRONTEND_BASE_URL?: string;
}

function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }

/** 自动路径的最小生产适配器：复用同一批次表/公开 token 结构，避免复制候选人数据。 */
export async function createAutoBusinessScreeningBatch(
  env: AutoBusinessDispatchEnv,
  resume: BusinessScreeningResumeRecord,
  deps: {
    uuid: () => string;
    now: () => string;
    getToken: () => Promise<string>;
    sendCard: (token: string, openId: string, card: unknown) => Promise<unknown>;
  },
): Promise<{ batchId: string; url: string; interviewer: string; sent: boolean }> {
  const positionId = text(resume.position_id);
  const position = positionId
    ? await env.DB.prepare('SELECT id, title, responsible_person FROM positions WHERE id = ? LIMIT 1').bind(positionId).first<any>()
    : await env.DB.prepare('SELECT id, title, responsible_person FROM positions WHERE title = ? LIMIT 1').bind(text(resume.mapped_position) || text(resume.position_applied)).first<any>();
  const interviewer = text(position?.responsible_person);
  if (!interviewer) throw new Error('POSITION_RESPONSIBLE_PERSON_MISSING');
  const mapping = await env.DB.prepare('SELECT name, open_id FROM interviewer_mappings WHERE name = ? LIMIT 1').bind(interviewer).first<any>();
  const openId = text(mapping?.open_id);
  if (!openId) throw new Error('INTERVIEWER_OPEN_ID_MISSING');

  const batchId = deps.uuid();
  const scopeKey = `auto:${openId}`;
  const issued = await createScopePublicToken(scopeKey, batchId);
  const nowIso = deps.now();
  const expiresAt = new Date(Date.parse(nowIso) + 30 * 86400_000).toISOString();
  const dispatchGroupId = deps.uuid();
  await createResumePushBatch(env.DB, {
    id: batchId,
    interviewerId: null,
    interviewerName: interviewer,
    interviewerOpenId: openId,
    tokenHash: issued.tokenHash,
    expiresAt,
    createdBy: 'automation',
    createdAt: nowIso,
    lastSentAt: null,
    dispatchGroupId,
    batchTitle: 'AI 初筛自动业务筛选',
    batchSubtitle: '请完成业务复核后进入面试安排',
    scopeKey,
  });
  await insertResumePushBatchItemsIfAbsent(env.DB, [{
    id: deps.uuid(), batchId, resumeId: resume.id, positionId: position?.id || positionId || null, createdAt: nowIso, dispatchGroupId,
  }]);
  await markResumesPushed(env.DB, [resume.id], batchId, dispatchGroupId);
  const base = text(env.FRONTEND_BASE_URL) || 'https://ai-interview-88r.pages.dev';
  const url = `${base.replace(/\/+$/, '')}/business-screening/${issued.token}`;
  const token = await deps.getToken();
  await deps.sendCard(token, openId, {
    config: { wide_screen_mode: true },
    header: { title: { tag: 'plain_text', content: 'AI 初筛通过：待业务筛选' }, template: 'blue' },
    elements: [
      { tag: 'div', text: { tag: 'lark_md', content: `候选人：${text(resume.candidate_name) || '候选人'}\n岗位：${text(resume.mapped_position) || text(resume.position_applied) || '未识别'}` } },
      { tag: 'action', actions: [{ tag: 'button', type: 'primary', text: { tag: 'plain_text', content: '进入业务筛选' }, url }] },
    ],
  });
  await env.DB.prepare('UPDATE resume_push_batches SET last_sent_at = ? WHERE id = ?').bind(deps.now(), batchId).run();
  return { batchId, url, interviewer, sent: true };
}
