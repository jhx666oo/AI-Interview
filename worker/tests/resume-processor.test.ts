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

  it('extracts fields when upload only stored a candidate-name placeholder', async () => {
    let fieldCalls = 0;
    const updates: Record<string, unknown>[] = [];
    await processResume({ jobId: 'job-1', resumeId: 'resume-1' }, {
      getResume: async () => ({ id: 'resume-1', raw_text: 'candidate resume text', parsed_data: '{"name":"候选人"}', ai_evaluation: '{"match_score":82}' }),
      getText: async () => 'candidate resume text',
      extractFields: async () => { fieldCalls += 1; return { name: '候选人', school: 'A大学' }; },
      screen: async () => ({}),
      updateResume: async (_id, update) => { updates.push(update); },
      setJobStep: async () => undefined,
    });
    expect(fieldCalls).toBe(1);
    expect(updates.at(-1)).toMatchObject({ parse_status: 'ai_screened' });
  });

  it('persists the queue screening hard-condition result without changing AI evidence', async () => {
    const updates: Record<string, unknown>[] = [];
    await processResume({ jobId: 'job-1', resumeId: 'resume-1' }, {
      getResume: async () => ({ id: 'resume-1', raw_text: 'candidate resume text', parsed_data: '{"age":30}', ai_evaluation: null }),
      getText: async () => 'candidate resume text',
      extractFields: async () => ({}),
      screen: async () => ({
        match_score: 82,
        dimensions: [{ name: '沟通', score: 4, reason: '有跨部门经验', weight: 100 }],
        hard_requirement_result: { passed: true, unmet_items: [], unknown_items: ['education'], message: '待复核' },
      }),
      updateResume: async (_id, update) => { updates.push(update); },
      setJobStep: async () => undefined,
    });
    expect(updates.at(-1)).toMatchObject({
      parse_status: 'ai_screened',
      hard_requirement_result: JSON.stringify({ passed: true, unmet_items: [], unknown_items: ['education'], message: '待复核' }),
    });
    expect(JSON.parse(String(updates.at(-1)?.ai_evaluation))).toMatchObject({
      dimensions: [{ name: '沟通', score: 4, reason: '有跨部门经验', weight: 100 }],
    });
  });
});
