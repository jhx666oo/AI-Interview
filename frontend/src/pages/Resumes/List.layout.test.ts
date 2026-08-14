import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./List.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');

describe('resume card layout contracts', () => {
  it('keeps candidate name as a server-side filter', () => {
    expect(source).toContain("params.candidate_name = searchCandidateName.trim()");
    expect(source).toContain('placeholder="搜索面试者姓名"');
  });

  it('invalidates stale list responses when a new search starts', () => {
    expect(source).toContain('const requestVersion = resumeRefreshVersion.current.invalidate();');
    expect(source).toContain('pollingEnabled, reprocessBatchActive, isCustomMode, searchCandidateName, searchStatus');
  });

  it('does not reload the full resume list on every active batch progress poll', () => {
    const pollingStart = source.indexOf('const startReprocessPolling =');
    const pollingEnd = source.indexOf('const stopReprocessPolling =', pollingStart);

    expect(pollingStart).toBeGreaterThan(-1);
    expect(pollingEnd).toBeGreaterThan(pollingStart);
    expect(source.slice(pollingStart, pollingEnd)).not.toContain('setReprocessBatch(res);\n          fetchResumes(');
  });

  it('keeps parsing polling disabled while a reprocess batch is active', () => {
    expect(source).toContain('pollingEnabled && !reprocessBatchActive');
    expect(source).toContain('reprocessBatch?.status');
  });

  it('serializes resume list refresh requests', () => {
    expect(source).toContain('resumeListRequestInFlightRef');
  });

  it('uses the guarded list loader for parsing status polling', () => {
    const pollingStart = source.indexOf('// 轮询检查解析状态');
    const pollingEnd = source.indexOf('// Batch reprocess polling', pollingStart);
    const pollingSource = source.slice(pollingStart, pollingEnd);

    expect(pollingSource).toContain('const res = await fetchResumes(true');
    expect(pollingSource).not.toContain("request.get('/resumes'");
  });

  it('keeps header groups separate from the evaluation dimension row', () => {
    const headerStart = source.indexOf('className="resume-card__header"');
    const evaluationStart = source.indexOf('className="resume-card__evaluation"', headerStart);
    const dimensionsStart = source.indexOf('className="resume-card__dimensions"', evaluationStart);

    expect(headerStart).toBeGreaterThan(-1);
    expect(source.slice(headerStart, evaluationStart)).toContain('resume-card__identity');
    expect(source.slice(headerStart, evaluationStart)).toContain('resume-card__status');
    expect(source.slice(headerStart, evaluationStart)).toContain('resume-card__actions');
    expect(dimensionsStart).toBeGreaterThan(evaluationStart);
  });

  it('declares a desktop single-row header with a narrow-screen fallback', () => {
    expect(css).toMatch(/\.resume-card__header\s*\{[\s\S]*?flex-wrap:\s*nowrap/);
    expect(css).toMatch(/@media \(max-width: 1199px\)[\s\S]*?\.resume-card__header[\s\S]*?flex-wrap:\s*wrap/);
  });
});
