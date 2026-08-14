import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  LEGACY_KEYWORD_GATE_TEXT,
  SCREENING_PROMPT_VERSION,
  WEIGHTED_SCREENING_PROMPT,
  normalizeScreeningPrompt,
} from '../src/resume-processing/weighted-screening';

describe('screening prompt rules', () => {
  it('describes the three keyword evidence points and the new thresholds', () => {
    expect(WEIGHTED_SCREENING_PROMPT).toContain('5 年及以上');
    expect(WEIGHTED_SCREENING_PROMPT).toContain('嵌入式固件');
    expect(WEIGHTED_SCREENING_PROMPT).toContain('ODM');
    expect(WEIGHTED_SCREENING_PROMPT).toContain('知名企业');
    expect(WEIGHTED_SCREENING_PROMPT).toContain('关键词匹配 2 分或以上');
    expect(WEIGHTED_SCREENING_PROMPT).toContain('避坑雷区仍需 5 分');
  });

  it('replaces the legacy gate sentence in a saved custom screening prompt', () => {
    const normalized = normalizeScreeningPrompt('resume_screening', {
      system: `自定义评估要求。${LEGACY_KEYWORD_GATE_TEXT}`,
      user: '岗位：{position}\n简历：{resume_text}',
    });

    expect(normalized.system).not.toContain(LEGACY_KEYWORD_GATE_TEXT);
    expect(normalized.system).toContain(SCREENING_PROMPT_VERSION);
    expect(normalized.user).toContain('{resume_text}');
  });

  it('does not duplicate the current rule block', () => {
    const prompt = {
      system: `自定义评估要求。${WEIGHTED_SCREENING_PROMPT}`,
      user: '简历：{resume_text}',
    };
    expect(normalizeScreeningPrompt('resume_screening_supplement', prompt)).toEqual(prompt);
  });

  it('uses D1-compatible substring matching in the prompt migration', async () => {
    const sql = await readFile(resolve(process.cwd(), 'migrations/0031_keyword_screening_rule_v2.sql'), 'utf8');
    expect(sql).toContain('instr(prompt_configs');
    expect(sql).not.toContain('LIKE');
    expect(sql).not.toContain('GLOB');
  });
});
