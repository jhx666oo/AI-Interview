import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

describe('upload session schema', () => {
  it('creates resume_upload_sessions with correct constraints', async () => {
    const sql = await readFile(resolve(process.cwd(), 'migrations/0012_resume_upload_sessions.sql'), 'utf8');
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS resume_upload_sessions/);
    expect(sql).toMatch(/resume_id TEXT NOT NULL UNIQUE/);
    expect(sql).toMatch(/expected_pdf_size INTEGER NOT NULL CHECK/);
    expect(sql).toMatch(/status.*IN \('initiated','completed','expired','failed'\)/);
    expect(sql).toMatch(/idx_resume_upload_sessions_expiry/);
  });
});

describe('upload service', () => {
  it('exports UploadService class', async () => {
    const mod = await import('../src/resume-uploads/service');
    expect(mod.UploadService).toBeDefined();
  });

  it('has expected public methods', async () => {
    const { UploadService } = await import('../src/resume-uploads/service');
    const proto = UploadService.prototype;
    expect(typeof proto.initUpload).toBe('function');
    expect(typeof proto.completeUpload).toBe('function');
    expect(typeof proto.failUpload).toBe('function');
    expect(typeof proto.expireAbandoned).toBe('function');
  });
});

describe('presigner', () => {
  it('generates a presigned URL with correct format', async () => {
    const { generatePresignedPutUrl } = await import('../src/resume-uploads/presigner');
    const url = await generatePresignedPutUrl({
      accountId: 'test-account',
      bucketName: 'test-bucket',
      objectKey: 'pdf/test/1_2026-08-03T12-00-00Z',
      accessKeyId: 'test-key',
      secretAccessKey: 'test-secret',
      sha256: 'test-sha256',
    });
    expect(url).toContain('X-Amz-Algorithm=AWS4-HMAC-SHA256');
    expect(url).toContain('X-Amz-Credential=');
    expect(url).toContain('X-Amz-Signature=');
    expect(url).toContain('X-Amz-Expires=600');
    expect(url).toContain('test-bucket');
    expect(url).toContain('pdf/test/1_2026-08-03T12-00-00Z');
  });
});

describe('upload routes', () => {
  it('exports createUploadRoutes', async () => {
    const mod = await import('../src/resume-uploads/routes');
    expect(typeof mod.createUploadRoutes).toBe('function');
  });
});

describe('upload cleanup', () => {
  it('exports cleanupAbandonedUploads', async () => {
    const mod = await import('../src/resume-uploads/cleanup');
    expect(typeof mod.cleanupAbandonedUploads).toBe('function');
  });
});
