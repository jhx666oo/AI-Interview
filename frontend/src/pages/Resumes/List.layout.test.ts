import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./List.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');

describe('resume card layout contracts', () => {
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
