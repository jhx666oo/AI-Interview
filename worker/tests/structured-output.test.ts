import { describe, expect, it } from 'vitest';
import { WEIGHTED_SCREENING_DIMENSION_NAMES } from '../src/resume-processing/weighted-screening';
import {
  parseStructuredOutput,
  type StructuredOutputFailureCode,
} from '../src/resume-processing/structured-output';

function sevenDimensions() {
  return WEIGHTED_SCREENING_DIMENSION_NAMES.map((name, index) => ({
    name,
    score: (index % 5) + 1,
    reason: `${name} 满足要求`,
  }));
}

describe('parseStructuredOutput screening mode', () => {
  it('unwraps an evaluation JSON accidentally placed inside summary', async () => {
    const result = await parseStructuredOutput(
      JSON.stringify({ summary: JSON.stringify({ summary: '正常摘要', dimensions: sevenDimensions() }) }),
      'screening',
      JSON.parse,
      async () => { throw new Error('repair should not run'); },
    );
    expect(result.diagnostics.repairAttempted).toBe(false);
    expect(result.value).toMatchObject({ summary: '正常摘要' });
  });

  it('repairs prompt-like summary once', async () => {
    let calls = 0;
    const result = await parseStructuredOutput(
      JSON.stringify({ summary: '# 人才能力评估AI打分提示词\n请根据以下简历逐项打分……' }),
      'screening',
      JSON.parse,
      async () => {
        calls++;
        return JSON.stringify({ summary: '修复后的摘要', dimensions: sevenDimensions() });
      },
    );
    expect(calls).toBe(1);
    expect(result.diagnostics.repairAttempted).toBe(true);
    expect(result.value).toMatchObject({ summary: '修复后的摘要' });
  });

  it('fails after exactly one unsuccessful repair', async () => {
    let calls = 0;
    await expect(parseStructuredOutput(
      JSON.stringify({ summary: '# prompt' }),
      'screening',
      JSON.parse,
      async () => { calls++; return JSON.stringify({ summary: '# prompt again' }); },
    )).rejects.toMatchObject({ code: 'AI_SCREENING_INVALID_DIMENSIONS' });
    expect(calls).toBe(1);
  });

  it('rejects non-object screening responses with INVALID_JSON', async () => {
    let calls = 0;
    await expect(parseStructuredOutput(
      '"plain text no json"',
      'screening',
      JSON.parse,
      async () => { calls++; throw new Error('no repair for non-json'); },
    )).rejects.toMatchObject({ code: 'AI_SCREENING_INVALID_JSON' });
    expect(calls).toBe(0);
  });

  it('exposes dimension names and response chars in diagnostics', async () => {
    const result = await parseStructuredOutput(
      JSON.stringify({ summary: 'ok', dimensions: sevenDimensions() }),
      'screening',
      JSON.parse,
      async () => { throw new Error('repair should not run'); },
    );
    expect(result.diagnostics.responseChars).toBeGreaterThan(0);
    expect(result.diagnostics.dimensionNames).toEqual([...WEIGHTED_SCREENING_DIMENSION_NAMES]);
  });

  it('truncates repair input to 12000 characters', async () => {
    let repairInput = '';
    await parseStructuredOutput(
      JSON.stringify({ summary: '# prompt', dimensions: sevenDimensions().slice(0, 3) }),
      'screening',
      JSON.parse,
      async (input) => { repairInput = input.raw; return JSON.stringify({ summary: '修复后', dimensions: sevenDimensions() }); },
    );
    expect(repairInput.length).toBeLessThanOrEqual(12000);
  });
});

describe('parseStructuredOutput dimensions mode', () => {
  it('accepts a dimensions array', async () => {
    const result = await parseStructuredOutput(
      JSON.stringify(sevenDimensions()),
      'dimensions',
      JSON.parse,
      async () => { throw new Error('repair should not run'); },
    );
    expect(Array.isArray(result.value)).toBe(true);
    expect(result.value).toHaveLength(7);
  });

  it('accepts { dimensions: [...] } wrapper', async () => {
    const result = await parseStructuredOutput(
      JSON.stringify({ dimensions: sevenDimensions() }),
      'dimensions',
      JSON.parse,
      async () => { throw new Error('repair should not run'); },
    );
    expect(Array.isArray(result.value)).toBe(true);
    expect(result.value).toHaveLength(7);
  });

  it('repairs missing dimensions once then fails with clear code', async () => {
    let calls = 0;
    await expect(parseStructuredOutput(
      JSON.stringify(sevenDimensions().slice(0, 3)),
      'dimensions',
      JSON.parse,
      async () => { calls++; return JSON.stringify(sevenDimensions().slice(0, 3)); },
    )).rejects.toMatchObject({ code: 'AI_SCREENING_INVALID_DIMENSIONS' });
    expect(calls).toBe(1);
  });
});
