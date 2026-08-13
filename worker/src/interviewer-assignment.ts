import {
  buildPositionMappingFromRows,
  resolveMappedPosition,
  normalizePositionKey,
  type PositionMappingRow,
} from './position-mapping';

export type PositionDefault = {
  id?: string;
  title?: string;
  primary_interviewer?: string | null;
  secondary_interviewer?: string | null;
};

export type StoredInterview = {
  position_id?: unknown;
  position_applied?: unknown;
  interviewer?: unknown;
  primary_interviewer?: unknown;
  secondary_interviewer?: unknown;
};

export type PositionDefaultsIndex = {
  byId: Map<string, PositionDefault>;
  byTitle: Map<string, PositionDefault>;
  mapping: Map<string, string>;
};

const clean = (value: unknown): string => {
  if (value === undefined || value === null) return '';
  return String(value).trim();
};

const cleanStoredInterviewer = (value: unknown): string => {
  const normalized = clean(value);
  return normalized === '待分配' ? '' : normalized;
};

export function resolveInterviewAssignments(body: any, position: PositionDefault | null | undefined): {
  interviewer: string;
  primaryInterviewer: string;
  secondaryInterviewer: string;
} {
  const primaryInterviewer = clean(
    body?.interviewer_name || body?.primary_interviewer || body?.interviewer || position?.primary_interviewer,
  );
  const secondaryInterviewer = clean(body?.secondary_interviewer || position?.secondary_interviewer);
  return {
    interviewer: primaryInterviewer || '待分配',
    primaryInterviewer,
    secondaryInterviewer,
  };
}

export function resolveStoredInterviewAssignments(
  interview: StoredInterview,
  position: PositionDefault | null | undefined,
): {
  interviewer: string;
  primaryInterviewer: string;
  secondaryInterviewer: string;
} {
  const storedPositionId = clean(interview?.position_id);
  const storedPositionApplied = clean(interview?.position_applied);
  const isLegacyRawPosition = Boolean(
    position?.id
      && storedPositionId
      && storedPositionId !== position.id
      && normalizePositionKey(storedPositionId) !== normalizePositionKey(position.title)
      && !storedPositionApplied,
  );
  return resolveInterviewAssignments(isLegacyRawPosition ? {} : {
    interviewer_name: cleanStoredInterviewer(interview?.primary_interviewer)
      || cleanStoredInterviewer(interview?.interviewer),
    secondary_interviewer: cleanStoredInterviewer(interview?.secondary_interviewer),
  }, position);
}

export function buildPositionDefaultsIndex(
  positions: PositionDefault[],
  mappings: PositionMappingRow[],
): PositionDefaultsIndex {
  const byId = new Map<string, PositionDefault>();
  const byTitle = new Map<string, PositionDefault>();
  for (const position of positions || []) {
    const normalized: PositionDefault = {
      id: clean(position?.id),
      title: clean(position?.title),
      primary_interviewer: clean(position?.primary_interviewer),
      secondary_interviewer: clean(position?.secondary_interviewer),
    };
    if (normalized.id) byId.set(normalized.id, normalized);
    const titleKey = normalizePositionKey(normalized.title);
    if (titleKey && !byTitle.has(titleKey)) byTitle.set(titleKey, normalized);
  }
  return {
    byId,
    byTitle,
    mapping: buildPositionMappingFromRows(mappings || []),
  };
}

export function resolvePositionDefaults(
  index: PositionDefaultsIndex,
  interview: Pick<StoredInterview, 'position_id' | 'position_applied'>,
): PositionDefault | null {
  const names = [clean(interview?.position_id), clean(interview?.position_applied)].filter(Boolean);
  for (const name of names) {
    const byId = index.byId.get(name);
    if (byId) return byId;
    const direct = index.byTitle.get(normalizePositionKey(name));
    if (direct) return direct;
    const mapped = resolveMappedPosition(index.mapping, name);
    const mappedPosition = index.byTitle.get(normalizePositionKey(mapped));
    if (mappedPosition) return mappedPosition;
  }
  return null;
}
