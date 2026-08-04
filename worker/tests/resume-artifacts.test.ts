import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

describe('resume artifact migration schema', () => {
  it('creates resume_artifacts table with all constraints', async () => {
    const sql = await readFile(resolve(process.cwd(), 'migrations/0011_resume_artifacts.sql'), 'utf8');
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS resume_artifacts/);
    expect(sql).toMatch(/resume_id TEXT NOT NULL/);
    expect(sql).toMatch(/type TEXT NOT NULL CHECK/);
    expect(sql).toMatch(/object_key TEXT NOT NULL/);
    expect(sql).toMatch(/byte_size INTEGER NOT NULL CHECK/);
    expect(sql).toMatch(/status TEXT NOT NULL DEFAULT 'pending'/);
    expect(sql).toMatch(/is_current INTEGER NOT NULL DEFAULT 0/);
    // Check artifact types
    expect(sql).toMatch(/'pdf'/);
    expect(sql).toMatch(/'ocr'/);
    expect(sql).toMatch(/'ai_analysis'/);
    expect(sql).toMatch(/'search_document'/);
    // Check statuses
    expect(sql).toMatch(/'pending'/);
    expect(sql).toMatch(/'available'/);
    expect(sql).toMatch(/'expired'/);
    expect(sql).toMatch(/'deleted'/);
    // Check indexes
    expect(sql).toMatch(/idx_resume_artifacts_resume_id/);
    expect(sql).toMatch(/idx_resume_artifacts_type_status/);
    expect(sql).toMatch(/idx_resume_artifacts_object_key/);
    expect(sql).toMatch(/idx_resume_artifacts_resume_type_version/);
    expect(sql).toMatch(/idx_resume_artifacts_current/);
  });
});

describe('object key generation', () => {
  it('generates deterministic keys without PII', async () => {
    const { generateObjectKey, parseObjectKey, generateArtifactId } = await import('../src/resume-storage/object-key');
    
    const key = generateObjectKey('pdf', 'resume_123', 1, '2026-08-03T12-00-00Z');
    expect(key).toBe('pdf/resume_123/1_2026-08-03T12-00-00Z');
    expect(key).not.toMatch(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/); // no email
    expect(key).not.toMatch(/1[3-9]\d{9}/); // no phone

    const parsed = parseObjectKey(key);
    expect(parsed).not.toBeNull();
    expect(parsed!.type).toBe('pdf');
    expect(parsed!.resumeId).toBe('resume_123');
    expect(parsed!.version).toBe(1);
    expect(parsed!.timestamp).toBe('2026-08-03T12-00-00Z');

    const id = generateArtifactId();
    expect(id).toMatch(/^art_[a-f0-9-]+$/);
  });

  it('generates unique artifact IDs', async () => {
    const { generateArtifactId } = await import('../src/resume-storage/object-key');
    const ids = new Set(Array.from({ length: 100 }, () => generateArtifactId()));
    expect(ids.size).toBe(100);
  });

  it('returns null for invalid object keys', async () => {
    const { parseObjectKey } = await import('../src/resume-storage/object-key');
    expect(parseObjectKey('')).toBeNull();
    expect(parseObjectKey('invalid')).toBeNull();
    expect(parseObjectKey('a/b')).toBeNull();
    expect(parseObjectKey('a/b/c')).toBeNull(); // no underscore in version part
  });
});

describe('artifact repository', () => {
  it('exports ArtifactRepository class', async () => {
    const mod = await import('../src/resume-storage/artifact-repository');
    expect(mod.ArtifactRepository).toBeDefined();
  });

  it('has expected public methods', async () => {
    const { ArtifactRepository } = await import('../src/resume-storage/artifact-repository');
    const proto = ArtifactRepository.prototype;
    expect(typeof proto.insert).toBe('function');
    expect(typeof proto.setCurrent).toBe('function');
    expect(typeof proto.updateStatus).toBe('function');
    expect(typeof proto.getCurrentByType).toBe('function');
    expect(typeof proto.listByResume).toBe('function');
    expect(typeof proto.listByTypeAndStatus).toBe('function');
    expect(typeof proto.getById).toBe('function');
  });
});

describe('R2 artifact store', () => {
  it('exports R2ArtifactStore class', async () => {
    const mod = await import('../src/resume-storage/r2-artifact-store');
    expect(mod.R2ArtifactStore).toBeDefined();
  });

  it('has expected public methods', async () => {
    const { R2ArtifactStore } = await import('../src/resume-storage/r2-artifact-store');
    const proto = R2ArtifactStore.prototype;
    expect(typeof proto.put).toBe('function');
    expect(typeof proto.get).toBe('function');
    expect(typeof proto.head).toBe('function');
    expect(typeof proto.delete).toBe('function');
  });
});
