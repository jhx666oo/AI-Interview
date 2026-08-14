import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const indexSource = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
const optimizedListSource = readFileSync(new URL('../src/resume-list/optimized-handler.ts', import.meta.url), 'utf8');

function getResumeListRouteSource(): string {
  const start = indexSource.indexOf("app.get('/api/resumes'");
  const end = indexSource.indexOf('\napp.', start + 1);
  return indexSource.slice(start, end === -1 ? undefined : end);
}

describe('resume list hot path', () => {
  it('does not recover stale jobs while serving every list refresh', () => {
    expect(getResumeListRouteSource()).not.toContain('recoverStaleResumeProcessingJobs');
  });

  it('does not run compatibility migrations from the optimized list handler', () => {
    expect(optimizedListSource).not.toContain('ensureResumeListSchema');
  });
});
