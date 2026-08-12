export type BusinessScreeningStatus =
  | 'not_ready'
  | 'pending'
  | 'passed'
  | 'rejected';

export type ResumeBusinessScreeningRecord = {
  status?: string | null;
  screening_result?: string | null;
  screening_label?: string | null;
  hr_disposition?: string | null;
  business_screening_status?: string | null;
};

export type BusinessScreeningAction = {
  key: 'push' | 'reject';
  label: string;
};

export type BusinessScreeningTag = {
  key: BusinessScreeningStatus;
  label: string;
  color: string;
};

export type BusinessScreeningActions = {
  primary: BusinessScreeningAction | null;
  secondary: BusinessScreeningAction | null;
  tags: BusinessScreeningTag[];
};

export type BusinessScreeningFilterMeta = {
  color: string;
  text: string;
  params: Record<string, string>;
};

const clean = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export function inferBusinessScreeningStatus(record: ResumeBusinessScreeningRecord): BusinessScreeningStatus {
  const explicit = clean(record.business_screening_status);
  if (explicit === 'pending') {
    if (record.status === 'approved') return 'passed';
    if (record.status === 'rejected' && clean(record.hr_disposition) === 'pushed') return 'rejected';
    return 'pending';
  }
  if (explicit === 'pending' || explicit === 'passed' || explicit === 'rejected' || explicit === 'not_ready') {
    return explicit;
  }

  const hrDisposition = clean(record.hr_disposition);
  if (hrDisposition === 'pushed') {
    if (record.status === 'approved') return 'passed';
    if (record.status === 'rejected') return 'rejected';
    return 'pending';
  }

  const screeningResult = clean(record.screening_label) || clean(record.screening_result);
  if (record.status === 'approved' && screeningResult === '通过') return 'passed';

  return 'not_ready';
}

export function getBusinessScreeningActions(record: ResumeBusinessScreeningRecord): BusinessScreeningActions {
  const businessStatus = inferBusinessScreeningStatus(record);
  const screeningResult = clean(record.screening_label) || clean(record.screening_result);
  const tags: BusinessScreeningTag[] = [];

  if (businessStatus === 'pending') {
    tags.push({ key: 'pending', label: '待业务筛选', color: 'processing' });
  } else if (businessStatus === 'passed') {
    tags.push({ key: 'passed', label: '业务已通过', color: 'success' });
  } else if (businessStatus === 'rejected' && clean(record.hr_disposition) === 'pushed') {
    tags.push({ key: 'rejected', label: '业务不通过', color: 'error' });
  }

  const isTerminalStatus = record.status === 'approved' || record.status === 'rejected' || record.status === 'completed';
  const canPush = screeningResult === '通过' && businessStatus === 'not_ready' && !isTerminalStatus;
  const canReject = businessStatus !== 'pending' && !isTerminalStatus;

  return {
    primary: canPush ? { key: 'push', label: '推送' } : null,
    secondary: canReject ? { key: 'reject', label: '淘汰' } : null,
    tags,
  };
}

export function getBusinessScreeningStatusMeta(filter: string): BusinessScreeningFilterMeta | null {
  if (filter === 'business_screening_pending') {
    return { color: 'processing', text: '待业务筛选', params: { business_screening_status: 'pending' } };
  }
  if (filter === 'business_screening_passed') {
    return { color: 'success', text: '业务已通过', params: { business_screening_status: 'passed' } };
  }
  if (filter === 'business_screening_rejected') {
    return { color: 'error', text: '业务不通过', params: { business_screening_status: 'rejected' } };
  }
  return null;
}

export function summarizePushResult(result: {
  pushed?: string[];
  skipped?: Array<{ id: string; reason: string }>;
  failed?: Array<{ interviewer: string; reason: string }>;
  batches?: Array<{ batchId: string; interviewer: string; url: string; itemCount: number }>;
}): string {
  const pushed = Array.isArray(result.pushed) ? result.pushed.length : 0;
  const skipped = Array.isArray(result.skipped) ? result.skipped.length : 0;
  const failed = Array.isArray(result.failed) ? result.failed.length : 0;
  const batches = Array.isArray(result.batches) ? result.batches.length : 0;
  return `推送完成：成功 ${pushed} 份，跳过 ${skipped} 份，发送失败 ${failed} 个面试官批次，生成 ${batches} 个推送批次`;
}
