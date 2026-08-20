import type { BusinessScreeningResumeRecord } from './routes';

export interface DispatchBusinessScreeningInput {
  resumeIds: string[];
  createdBy: string;
  source: 'manual' | 'automation';
}

export interface DispatchBusinessScreeningGroup {
  interviewer: { name: string; openId?: string | null };
  resumes: BusinessScreeningResumeRecord[];
}

export interface DispatchBusinessScreeningDeps {
  db: D1Database;
  store: {
    listResumesByIds(db: D1Database, ids: string[]): Promise<BusinessScreeningResumeRecord[]>;
  };
  groupEligibleResumes: (resumes: BusinessScreeningResumeRecord[]) => Promise<DispatchBusinessScreeningGroup[]>;
  createOrReuseBatch: (group: DispatchBusinessScreeningGroup, createdBy: string) => Promise<{ id: string; url: string }>;
  sendBatchCard: (batch: { id: string; url: string }, interviewer: DispatchBusinessScreeningGroup['interviewer']) => Promise<void>;
  collectSkipped?: (resumes: BusinessScreeningResumeRecord[], groups: DispatchBusinessScreeningGroup[]) => Array<{ resumeId: string; reason: string }>;
}

/** 手动推送与自动推送共用的最小编排契约，避免自动路径复制批次/卡片逻辑。 */
export async function dispatchBusinessScreening(
  input: DispatchBusinessScreeningInput,
  deps: DispatchBusinessScreeningDeps,
): Promise<{ batches: Array<{ id: string; interviewerName: string; resumeIds: string[]; url: string }>; skipped: Array<{ resumeId: string; reason: string }> }> {
  const ids = [...new Set(input.resumeIds.map((id) => String(id || '').trim()).filter(Boolean))];
  const resumes = await deps.store.listResumesByIds(deps.db, ids);
  const groups = await deps.groupEligibleResumes(resumes);
  const batches: Array<{ id: string; interviewerName: string; resumeIds: string[]; url: string }> = [];
  for (const group of groups) {
    const batch = await deps.createOrReuseBatch(group, input.createdBy);
    await deps.sendBatchCard(batch, group.interviewer);
    batches.push({ id: batch.id, interviewerName: group.interviewer.name, resumeIds: group.resumes.map((resume) => resume.id), url: batch.url });
  }
  return { batches, skipped: deps.collectSkipped?.(resumes, groups) || [] };
}
