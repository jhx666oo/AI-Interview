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

function splitInterviewerNames(value: string): string[] {
  return value
    .split(/[,，、/;；]/)
    .map((item) => item.trim())
    .filter(Boolean);
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

export function isEligibleForPush(
  resume: Pick<BusinessScreeningResume, 'screening_result' | 'status' | 'hr_disposition' | 'mapped_position' | 'position_applied'>,
  interviewer: { name: string; openId?: string },
): { ok: true } | { ok: false; reason: string } {
  if (text(resume.screening_result) !== '通过') {
    return { ok: false, reason: 'AI初筛未通过' };
  }
  if (text(resume.hr_disposition) === 'rejected' || text(resume.status) === 'rejected') {
    return { ok: false, reason: 'HR已淘汰该简历' };
  }
  if (!resolvePositionTitle(resume)) {
    return { ok: false, reason: '缺少标准岗位' };
  }
  if (!text(interviewer.name) || !text(interviewer.openId)) {
    return { ok: false, reason: '岗位未配置有效面试官' };
  }
  return { ok: true };
}

export function groupEligibleResumesByInterviewer(
  resumes: BusinessScreeningResume[],
  positions: PositionInterviewerConfig[],
  interviewerDirectory: InterviewerDirectoryEntry[],
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

  const groups = new Map<string, PushGroup>();
  for (const resume of resumes) {
    const positionTitle = resolvePositionTitle(resume);
    if (!positionTitle) continue;
    const position = positionsByTitle.get(positionTitle);
    if (!position) continue;

    const interviewerNames = [
      ...splitInterviewerNames(text(position.primary_interviewer)),
      ...splitInterviewerNames(text(position.secondary_interviewer)),
    ];

    for (const interviewerName of [...new Set(interviewerNames)]) {
      const directoryEntry = interviewerByName.get(interviewerName);
      const interviewer = normalizeInterviewer(directoryEntry || { name: interviewerName });
      if (!isEligibleForPush(resume, interviewer).ok) continue;

      const existing = groups.get(interviewer.name);
      if (existing) {
        existing.resumes.push(resume);
        if (!existing.positionTitles.includes(positionTitle)) existing.positionTitles.push(positionTitle);
        continue;
      }

      groups.set(interviewer.name, {
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
    return {
      nextStatus: current,
      changed: false,
      terminal: current === 'passed' || current === 'rejected',
      reason: 'business screening is not pending',
    };
  }

  return {
    nextStatus: action === 'approve' ? 'passed' : 'rejected',
    changed: true,
    terminal: true,
  };
}
