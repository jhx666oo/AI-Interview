import type {
  BusinessScreeningAction,
  BusinessScreeningResume,
  BusinessScreeningStatus,
  DecisionResult,
  InterviewerDirectoryEntry,
  PositionInterviewerConfig,
  PushGroup,
} from './types';

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeInterviewer(entry: InterviewerDirectoryEntry | { name?: string | null; openId?: string | null } | null | undefined): { name: string; openId?: string } {
  return {
    name: text(entry?.name),
    openId: text(entry?.openId),
  };
}

function resolvePositionTitle(resume: Pick<BusinessScreeningResume, 'mapped_position' | 'position_applied'>): string {
  return text(resume.mapped_position) || text(resume.position_applied);
}

export interface PushEligibilityOptions {
  /** 历史兼容参数：保留给现有临时链接调用方 */
  skipAiCheck?: boolean;
  /** 临时链接模式：跳过「业务筛选已发起/已完成」检查，允许已推送过的简历也进入自定义临时链接 */
  skipPushStateCheck?: boolean;
}

export function isEligibleForPush(
  resume: Pick<BusinessScreeningResume, 'screening_result' | 'status' | 'hr_disposition' | 'mapped_position' | 'position_applied' | 'business_screening_status'>,
  interviewer: { name: string; openId?: string | null },
  options?: PushEligibilityOptions,
): { ok: true } | { ok: false; reason: string } {
  const pushed = text(resume.hr_disposition) === 'pushed';
  const businessStatus = pushed ? text(resume.business_screening_status) : '';
  if (text(resume.hr_disposition) === 'rejected' || text(resume.status) === 'rejected') {
    return { ok: false, reason: 'HR已淘汰该简历' };
  }
  if (!options?.skipPushStateCheck && text(resume.hr_disposition) === 'pushed' && (businessStatus === '' || businessStatus === 'not_ready')) {
    return { ok: false, reason: '业务筛选已发起，请使用批次重发' };
  }
  if (!options?.skipPushStateCheck && businessStatus === 'pending') {
    return { ok: false, reason: '业务筛选已发起，请使用批次重发' };
  }
  if (!options?.skipPushStateCheck && (businessStatus === 'passed' || businessStatus === 'rejected')) {
    return { ok: false, reason: '业务筛选已完成' };
  }
  if (!resolvePositionTitle(resume)) {
    return { ok: false, reason: '缺少标准岗位' };
  }
  if (!text(interviewer.name) || !text(interviewer.openId)) {
    return { ok: false, reason: '岗位未配置有效责任人' };
  }
  return { ok: true };
}

export function groupEligibleResumesForPush(
  resumes: BusinessScreeningResume[],
  positions: PositionInterviewerConfig[],
  interviewerDirectory: InterviewerDirectoryEntry[],
  resolveStandardTitle?: (rawTitle: string) => string,
  options?: PushEligibilityOptions,
): Map<string, PushGroup> {
  const positionsByTitle = new Map<string, PositionInterviewerConfig>();
  for (const position of positions) {
    const title = text(position.title);
    if (title && !positionsByTitle.has(title)) positionsByTitle.set(title, position);
  }

  const interviewerByName = new Map<string, InterviewerDirectoryEntry>();
  for (const interviewer of interviewerDirectory) {
    const name = text(interviewer.name);
    if (name && !interviewerByName.has(name)) interviewerByName.set(name, interviewer);
  }

  const resolve = resolveStandardTitle || ((rawTitle: string) => rawTitle);
  const groups = new Map<string, PushGroup>();
  for (const resume of resumes) {
    const rawTitle = resolvePositionTitle(resume);
    if (!rawTitle) continue;
    const positionTitle = resolve(rawTitle);
    const position = positionsByTitle.get(positionTitle);
    if (!position) continue;

    const interviewerNames = uniqueNames(text(position.responsible_person));

    for (const interviewerName of interviewerNames) {
      const directoryEntry = interviewerByName.get(interviewerName);
      const interviewer = normalizeInterviewer(directoryEntry || { name: interviewerName });
      if (!isEligibleForPush(resume, interviewer, options).ok) continue;

      // 飞书 openId 是面试官的稳定身份键，避免同一人因名称差异被拆成多个链接批次。
      const groupKey = interviewer.openId || interviewer.name;
      const existing = groups.get(groupKey);
      if (existing) {
        existing.resumes.push(resume);
        if (!existing.positionTitles.includes(positionTitle)) existing.positionTitles.push(positionTitle);
        continue;
      }

      groups.set(groupKey, {
        interviewer: {
          name: interviewer.name,
          openId: interviewer.openId!,
          userId: directoryEntry?.userId || null,
        },
        resumes: [resume],
        positionTitles: [positionTitle],
      });
    }
  }

  return groups;
}

function uniqueNames(value: string): string[] {
  return value
    .split(/[,，、/;；]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function decideBusinessScreening(
  current: BusinessScreeningStatus,
  action: BusinessScreeningAction,
): DecisionResult {
  if (current === 'passed' || current === 'rejected') {
    return {
      nextStatus: current,
      changed: false,
      terminal: true,
      reason: action === (current === 'passed' ? 'approve' : 'reject')
        ? undefined
        : 'business screening already completed',
    };
  }

  if (current !== 'pending') {
    // current 只能是 not_ready：尚未发起业务筛选，不是终态
    return {
      nextStatus: current,
      changed: false,
      terminal: false,
      reason: 'business screening is not pending',
    };
  }

  return {
    nextStatus: action === 'approve' ? 'passed' : 'rejected',
    changed: true,
    terminal: true,
  };
}
