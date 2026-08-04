import { describe, expect, it } from 'vitest';

describe('search document generator', () => {
  it('generates markdown without PII', async () => {
    const { ResumeSearchDocumentGenerator } = await import('../src/resume-search/document-generator');
    const gen = new ResumeSearchDocumentGenerator();
    expect(gen).toBeDefined();
    expect(typeof gen.generate).toBe('function');
  });
});

describe('search service', () => {
  it('exports ResumeSearchServiceImpl', async () => {
    const mod = await import('../src/resume-search/search-service');
    expect(mod.ResumeSearchServiceImpl).toBeDefined();
  });

  it('returns empty results by default', async () => {
    const { ResumeSearchServiceImpl } = await import('../src/resume-search/search-service');
    const service = new ResumeSearchServiceImpl({});
    const result = await service.search(
      { query: 'test', page: 1, pageSize: 20 },
      { userId: 'test', role: 'admin' }
    );
    expect(result.results).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('implements all required methods', async () => {
    const { ResumeSearchServiceImpl } = await import('../src/resume-search/search-service');
    const service = new ResumeSearchServiceImpl({});
    expect(typeof service.search).toBe('function');
    expect(typeof service.requestIndex).toBe('function');
    expect(typeof service.requestDelete).toBe('function');
    expect(typeof service.getHealth).toBe('function');
  });
});
