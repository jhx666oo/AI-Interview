import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const formSource = readFileSync(new URL('./Form.tsx', import.meta.url), 'utf8');
const listSource = readFileSync(new URL('./List.tsx', import.meta.url), 'utf8');

describe('position interviewer selector wiring', () => {
  it('uses directory-backed interviewer options in both position editors', () => {
    expect(formSource).toContain("from './interviewerOptions'");
    expect(formSource).toContain('buildInterviewerOptions(');
    expect(formSource).toContain("request.get('/auth/interviewers')");
    expect(formSource).toContain('<AutoComplete');

    expect(listSource).toContain("from './interviewerOptions'");
    expect(listSource).toContain('buildInterviewerOptions(');
    expect(listSource).toContain("request.get('/auth/interviewers')");
    expect(listSource).toContain('<AutoComplete');
  });

  it('allows a name outside the directory to be entered directly', () => {
    expect(formSource).toContain('AutoComplete');
    expect(listSource).toContain('AutoComplete');
  });

  it('no longer uses the old free-text interviewer placeholders', () => {
    expect(formSource).not.toContain('默认：杜雁玲');
    expect(formSource).not.toContain('默认：何雨菱');
    expect(listSource).not.toContain('默认：杜雁玲');
    expect(listSource).not.toContain('默认：何雨菱');
  });
});
