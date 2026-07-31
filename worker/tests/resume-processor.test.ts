import { describe, expect, it } from 'vitest';
import { processResume } from '../src/resume-processing/processor';

describe('resume processor', () => {
  it('extracts fields before screening and writes only the target resume id', async () => {
    const writes: string[] = [];
    const calls: string[] = [];
    await processResume({ jobId: 'job-1', resumeId: 'resume-1' }, {
      getResume: async () => ({ id: 'resume-1', raw_text: 'candidate resume text', parsed_data: null, ai_evaluation: null }),
      getText: async () => 'candidate resume text',
      extractFields: async () => { calls.push('fields'); return { school: 'A大学' }; },
      screen: async () => { calls.push('screen'); return { match_score: 82, summary: 'good' }; },
      updateResume: async (id) => { writes.push(id); },
      setJobStep: async () => undefined,
    });
    expect(calls).toEqual(['fields', 'screen']);
    expect(writes).toEqual(['resume-1', 'resume-1', 'resume-1']);
  });

  it('does not call AI again when both fields and screening are persisted', async () => {
    let aiCalls = 0;
    await processResume({ jobId: 'job-1', resumeId: 'resume-1' }, {
      getResume: async () => ({ id: 'resume-1', raw_text: 'candidate resume text', parsed_data: '{"school":"A大学"}', ai_evaluation: '{"match_score":82}' }),
      getText: async () => 'candidate resume text',
      extractFields: async () => { aiCalls += 1; return {}; },
      screen: async () => { aiCalls += 1; return {}; },
      updateResume: async () => undefined,
      setJobStep: async () => undefined,
    });
    expect(aiCalls).toBe(0);
  });
});
