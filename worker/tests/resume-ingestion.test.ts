import { describe, expect, it } from 'vitest';
import { buildResumeIngestionIdentity, normalizeResumeSource } from '../src/recruiting-operations/resume-ingestion';

describe('resume ingestion identity', () => {
  it('uses a stable file hash for local uploads', () => {
    const first = buildResumeIngestionIdentity({ source: 'local_upload', fileSha256: 'ABC123', receivedAt: '2026-08-17T01:02:03.000Z' });
    const retry = buildResumeIngestionIdentity({ source: 'local_upload', fileSha256: 'ABC123', receivedAt: '2026-08-18T01:02:03.000Z' });
    expect(first.ingestKey).toBe('file:abc123');
    expect(retry.ingestKey).toBe(first.ingestKey);
    expect(retry.receivedAt).toBe('2026-08-18T01:02:03.000Z');
  });

  it('namespaces external, email, and Feishu source IDs', () => {
    expect(buildResumeIngestionIdentity({ source: 'feishu', sourceRecordId: 'rec001' }).ingestKey).toBe('feishu:rec001');
    expect(buildResumeIngestionIdentity({ source: 'external_api', sourceRecordId: 'provider:001' }).ingestKey).toBe('external:provider:001');
    expect(buildResumeIngestionIdentity({ source: 'email', emailMessageId: '<mail-1>', attachmentIndex: 2 }).ingestKey).toBe('email:<mail-1>:2');
    expect(buildResumeIngestionIdentity({ source: 'email', emailMessageId: '<mail-1>', attachmentIndex: 0 }).ingestKey).toBe('email:<mail-1>:0');
  });

  it('does not fall back to candidate name as an identity key', () => {
    expect(buildResumeIngestionIdentity({ source: 'unknown' }).ingestKey).toMatch(/^unknown:/);
    expect(buildResumeIngestionIdentity({ source: 'unknown' }).ingestKey).not.toContain('张三');
  });

  it('normalizes unsupported source values to unknown', () => {
    expect(normalizeResumeSource('mail')).toBe('email');
    expect(normalizeResumeSource('feishu_sync')).toBe('feishu');
    expect(normalizeResumeSource('something-else')).toBe('unknown');
  });
});
