import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  buildPositionSpecificScreeningRule,
  buildScreeningRulesPrompt,
  LEGACY_KEYWORD_GATE_TEXT,
  SCREENING_PROMPT_VERSION,
  WEIGHTED_SCREENING_PROMPT,
  normalizeScreeningPrompt,
} from '../src/resume-processing/weighted-screening';

describe('screening prompt rules', () => {
  it('keeps the global prompt position-neutral', () => {
    expect(WEIGHTED_SCREENING_PROMPT).toContain('当前岗位');
    expect(WEIGHTED_SCREENING_PROMPT).not.toContain('5 年及以上智能硬件');
    expect(WEIGHTED_SCREENING_PROMPT).not.toContain('嵌入式固件');
    expect(WEIGHTED_SCREENING_PROMPT).not.toContain('ODM');
    expect(WEIGHTED_SCREENING_PROMPT).not.toContain('知名企业');
    expect(WEIGHTED_SCREENING_PROMPT).toContain('具体通过阈值由本次请求附带');
    expect(buildScreeningRulesPrompt({ keyword_match_min_score: 2, red_flag_min_score: 5, weighted_score_min: 3.5 }))
      .toContain('五项能力加权分 >= 3.5 分');
    expect(buildScreeningRulesPrompt({ keyword_match_min_score: 2, red_flag_min_score: 5, weighted_score_min: 3.5 }))
      .toContain('三项必须同时满足');
  });

  it('removes the previously saved global keyword-gate-v2 block', () => {
    const normalized = normalizeScreeningPrompt('resume_screening', {
      system: `自定义评估要求。${LEGACY_KEYWORD_GATE_TEXT}\n[简历初筛规则版本：keyword-gate-v2]\n「关键词匹配」只按以下三个证据点评估：智能硬件、ODM、知名企业。`,
      user: '岗位：{position}\n简历：{resume_text}',
    });

    expect(normalized.system).not.toContain(LEGACY_KEYWORD_GATE_TEXT);
    expect(normalized.system).not.toContain('keyword-gate-v2');
    expect(normalized.system).not.toContain('智能硬件、ODM、知名企业');
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

  it('adds the smart-hardware rule only for a matching position context', () => {
    const smartHardwareRule = buildPositionSpecificScreeningRule({
      standardPosition: '软件产品经理（智能硬件方向）',
      description: '负责智能硬件产品规划和 IoT 云平台建设',
      requirements: '熟悉嵌入式、MQTT、OTA 升级',
      personalizedRequirements: '',
      capabilityDimensions: '',
    });
    const genericRule = buildPositionSpecificScreeningRule({
      standardPosition: '招聘专员',
      description: '负责招聘流程、面试安排和员工关系维护',
      requirements: '熟悉招聘渠道和劳动法规',
      personalizedRequirements: '',
      capabilityDimensions: '',
    });

    expect(smartHardwareRule).toContain('5 年及以上智能硬件');
    expect(smartHardwareRule).toContain('最终门槛以本次请求附带');
    expect(genericRule).toBe('');
  });

  it('uses D1-compatible substring matching in the prompt migration', async () => {
    const sql = await readFile(resolve(process.cwd(), 'migrations/0031_keyword_screening_rule_v2.sql'), 'utf8');
    expect(sql).toContain('instr(prompt_configs');
    expect(sql).not.toContain('LIKE');
    expect(sql).not.toContain('GLOB');
  });

  it('persists the position-neutral prompt when migrating saved settings', async () => {
    const sql = await readFile(resolve(process.cwd(), 'migrations/0033_position_aware_screening_prompt_v3.sql'), 'utf8');
    expect(sql).toContain('position-aware-v3');
    expect(sql).toContain('instr(prompt_configs');
    expect(sql).toContain('当前岗位上下文');
  });
});
