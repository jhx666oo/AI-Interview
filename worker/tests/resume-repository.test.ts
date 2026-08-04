import { describe, expect, it } from 'vitest';

describe('text repository', () => {
  it('exports TextRepository class', async () => {
    const mod = await import('../src/resume-repositories/text-repository');
    expect(mod.TextRepository).toBeDefined();
  });

  it('implements getCurrent and putVersion', async () => {
    const { TextRepository } = await import('../src/resume-repositories/text-repository');
    const proto = TextRepository.prototype;
    expect(typeof proto.getCurrent).toBe('function');
    expect(typeof proto.putVersion).toBe('function');
  });
});

describe('analysis repository', () => {
  it('exports AnalysisRepository class', async () => {
    const mod = await import('../src/resume-repositories/analysis-repository');
    expect(mod.AnalysisRepository).toBeDefined();
  });

  it('implements getCurrent and putVersion', async () => {
    const { AnalysisRepository } = await import('../src/resume-repositories/analysis-repository');
    const proto = AnalysisRepository.prototype;
    expect(typeof proto.getCurrent).toBe('function');
    expect(typeof proto.putVersion).toBe('function');
  });
});
