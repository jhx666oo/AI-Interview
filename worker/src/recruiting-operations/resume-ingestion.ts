export type ResumeSource = 'local_upload' | 'external_api' | 'email' | 'feishu' | 'unknown';

export interface ResumeIngestionIdentity {
  receivedAt: string;
  source: ResumeSource;
  sourceRecordId: string;
  ingestKey: string;
}

export interface ResumeIngestionInput {
  source: ResumeSource | string;
  receivedAt?: string;
  fileSha256?: string;
  sourceRecordId?: string;
  emailMessageId?: string;
  attachmentIndex?: number;
}

export function normalizeResumeSource(source: unknown): ResumeSource {
  const value = String(source || '').trim().toLowerCase();
  if (value === 'local' || value === 'upload' || value === 'local_upload') return 'local_upload';
  if (value === 'external' || value === 'api' || value === 'external_api') return 'external_api';
  if (value === 'mail' || value === 'email') return 'email';
  if (value === 'feishu' || value === 'feishu_sync') return 'feishu';
  return 'unknown';
}

function clean(value: unknown): string {
  return String(value || '').trim();
}

function isoNow(): string {
  return new Date().toISOString();
}

export function buildResumeIngestionIdentity(input: ResumeIngestionInput): ResumeIngestionIdentity {
  const source = normalizeResumeSource(input.source);
  const fileSha256 = clean(input.fileSha256).toLowerCase();
  const sourceRecordId = clean(input.sourceRecordId);
  const emailMessageId = clean(input.emailMessageId);
  const attachmentIndex = Number.isInteger(input.attachmentIndex) ? String(input.attachmentIndex) : '';

  let ingestKey = '';
  if (fileSha256) ingestKey = `file:${fileSha256}`;
  else if (source === 'feishu' && sourceRecordId) ingestKey = `feishu:${sourceRecordId}`;
  else if (source === 'external_api' && sourceRecordId) ingestKey = `external:${sourceRecordId}`;
  else if (source === 'email' && emailMessageId && attachmentIndex !== '') ingestKey = `email:${emailMessageId}:${attachmentIndex}`;
  else if (sourceRecordId) ingestKey = `${source}:${sourceRecordId}`;
  else ingestKey = `${source}:${clean(input.receivedAt) || isoNow()}`;

  return {
    receivedAt: clean(input.receivedAt) || isoNow(),
    source,
    sourceRecordId,
    ingestKey,
  };
}

export function isSameResumeIngestion(left: Pick<ResumeIngestionIdentity, 'ingestKey'>, right: Pick<ResumeIngestionIdentity, 'ingestKey'>): boolean {
  return Boolean(left.ingestKey && right.ingestKey && left.ingestKey === right.ingestKey);
}
