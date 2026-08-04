import { describe, expect, it } from 'vitest';

describe('feature flags', () => {
  it('all flags default to false when env is empty', async () => {
    const { parseFeatureFlags } = await import('../src/resume-config/flags');
    const flags = parseFeatureFlags({});
    expect(flags.r2ArtifactWrite).toBe(false);
    expect(flags.r2ArtifactRead).toBe(false);
    expect(flags.directR2Upload).toBe(false);
    expect(flags.sqlResumeList).toBe(false);
    expect(flags.hybridSearch).toBe(false);
    expect(flags.recruitmentEvents).toBe(false);
    expect(flags.recruitmentEventMetrics).toBe(false);
  });

  it('all flags default to false when env has other values', async () => {
    const { parseFeatureFlags } = await import('../src/resume-config/flags');
    const flags = parseFeatureFlags({ SOME_OTHER_KEY: 'true' });
    expect(flags.r2ArtifactWrite).toBe(false);
    expect(flags.hybridSearch).toBe(false);
  });

  it('enables flags when env vars are exactly "true"', async () => {
    const { parseFeatureFlags } = await import('../src/resume-config/flags');
    const flags = parseFeatureFlags({
      R2_ARTIFACT_WRITE: 'true',
      R2_ARTIFACT_READ: 'true',
      DIRECT_R2_UPLOAD: 'true',
      RESUME_SQL_LIST: 'true',
      RESUME_HYBRID_SEARCH: 'true',
      RECRUITMENT_EVENTS: 'true',
      RECRUITMENT_EVENT_METRICS: 'true',
    });
    expect(flags.r2ArtifactWrite).toBe(true);
    expect(flags.r2ArtifactRead).toBe(true);
    expect(flags.directR2Upload).toBe(true);
    expect(flags.sqlResumeList).toBe(true);
    expect(flags.hybridSearch).toBe(true);
    expect(flags.recruitmentEvents).toBe(true);
    expect(flags.recruitmentEventMetrics).toBe(true);
  });

  it('is case-insensitive', async () => {
    const { parseFeatureFlags } = await import('../src/resume-config/flags');
    const flags = parseFeatureFlags({ R2_ARTIFACT_WRITE: 'True' });
    expect(flags.r2ArtifactWrite).toBe(true);
  });

  it('treats non-"true" values as false', async () => {
    const { parseFeatureFlags } = await import('../src/resume-config/flags');
    const flags = parseFeatureFlags({ R2_ARTIFACT_WRITE: '1' });
    expect(flags.r2ArtifactWrite).toBe(false);
  });
});
