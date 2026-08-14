# 简历 AI 初筛关键词规则优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将简历 AI 初筛的「关键词匹配」从 5 分硬门槛调整为基于三个证据点、达到 2 分即可通过该门槛，并同步所有初筛入口、系统设置提示词和前端展示。

**Architecture:** 保留 `worker/src/resume-processing/weighted-screening.ts` 作为服务端评分和统一提示词规则源。服务端将关键词门槛和避坑门槛拆成独立常量，所有 AI 返回结果仍由服务端统一计算；通过 D1 migration 安全替换已保存的旧系统提示词，并在 `getAIPrompt` 层对自定义提示词追加/修正规则版本，防止旧配置绕过新规则。前端只调整门槛文案和测试，不复制服务端评分逻辑。

**Tech Stack:** Cloudflare Worker、Hono、TypeScript、Cloudflare D1、Vitest、React、Vite、Ant Design。

## Global Constraints

- 「关键词匹配」必须同时遵循三个证据点：5 年以上相关经验且命中任一关键词、明确 ODM/外包对接与需求管控、知名企业且有智能硬件相关经历。
- 关键词匹配 `score >= 2` 才通过该门槛；0–1 分仍失败。
- 「避坑雷区」继续要求 `score >= 5`。
- 关键词门槛和避坑门槛都满足后，五项能力加权分仍按当前规则以 4 分为通过线。
- `match_score` 和 `recommendation` 不得覆盖服务端最终判定。
- 不建立知名企业白名单；公司知名度不能单独替代智能硬件相关经历。
- 不修改简历原文、历史评估结果、岗位配置或加权维度权重。
- 不修改根目录未跟踪的 `package-lock.json` 以及现有用户未跟踪文件。
- 本计划不包含生产部署；生产 D1 migration、GitHub 推送和 Cloudflare 部署必须在用户明确确认后执行。

---

## 文件结构与职责

### 将修改的文件

- `worker/src/resume-processing/weighted-screening.ts`
  - 保存关键词/避坑门槛常量。
  - 执行服务端最终评分和门槛判定。
  - 输出所有初筛入口共用的规则提示词和提示词版本归一化函数。
- `worker/src/index.ts`
  - 使用新规则归一化 `getAIPrompt` 返回值。
  - 更新 legacy/reparse 路径中的旧门槛文字。
  - 更新系统设置默认提示词和 seed 默认值。
- `frontend/src/utils/resumeEvaluation.ts`
  - 更新关键词门槛的展示失败原因。
- `worker/tests/weighted-screening.test.ts`
  - 覆盖新的关键词门槛、避坑门槛和加权分行为。
- `worker/tests/screening-prompt.test.ts`
  - 覆盖提示词规则、旧提示词替换和版本标识。
- `frontend/src/utils/weightedScreeningDisplay.test.ts`
  - 更新前端失败文案断言。

### 将新增的文件

- `worker/migrations/0031_keyword_screening_rule_v2.sql`
  - 对 D1 中已有 `system_configs.prompt_configs` 的旧内置门槛句进行安全替换。
  - 只替换明确的旧规则文本，不删除其他自定义提示词内容。
- `docs/superpowers/specs/2026-08-14-keyword-screening-rule-design.md`
  - 已完成并经用户确认的设计文档。
- `docs/superpowers/plans/2026-08-14-keyword-screening-rule.md`
  - 本实施计划。

### 明确不修改的文件

- `docs/superpowers/handoffs/2026-08-13-resume-ai-evaluation-reliability/`
- `frontend/dist.bak.1786592172/`
- 根目录 `package-lock.json`
- 旧的历史设计/计划文档中的旧规则描述。它们属于历史记录，不作为运行时规则来源。

---

### Task 1: 先锁定服务端新门槛行为

**Files:**
- Modify: `worker/tests/weighted-screening.test.ts`
- Modify: `worker/src/resume-processing/weighted-screening.ts`

**Interfaces:**
- Consumes: `evaluateWeightedScreening(evaluation, configuredDimensions)`。
- Produces: `gate_results.keyword_match.passed` 使用 `score >= 2`；`gate_results.red_flag.passed` 继续使用 `score >= 5`；关键词失败原因为 `关键词匹配未达 2 分`。

- [ ] **Step 1: 替换旧的 5 分关键词门槛测试并补充 0/1/2/3 分边界测试**

在 `worker/tests/weighted-screening.test.ts` 中，将现有“关键词 4 分失败”测试改为关键词 1 分失败，并加入以下测试：

```ts
it('rejects keyword scores below two without calculating a score', () => {
  for (const keywordScore of [0, 1]) {
    const result = evaluateWeightedScreening({
      dimensions: config.map(d => ({
        name: d.name,
        score: d.name === '关键词匹配' ? keywordScore : 5,
      })),
    }, config);

    expect(result.screening_result).toBe('不通过');
    expect(result.weighted_score).toBeNull();
    expect(result.gate_results.keyword_match).toEqual({ score: keywordScore, passed: false });
    expect(result.screening_reason).toBe('关键词匹配未达 2 分');
  }
});

it.each([2, 3])('allows keyword score %s to enter weighted evaluation', (keywordScore) => {
  const result = evaluateWeightedScreening({
    dimensions: config.map(d => ({
      name: d.name,
      score: d.name === '关键词匹配' ? keywordScore : 5,
    })),
  }, config);

  expect(result.gate_results.keyword_match).toEqual({ score: keywordScore, passed: true });
  expect(result.weighted_score).not.toBeNull();
});
```

- [ ] **Step 2: 运行测试确认旧实现失败**

运行：

```bash
cd /Users/jhx/Desktop/天鹅到家/dvS2cn/ai-interview/worker
npm test -- tests/weighted-screening.test.ts
```

预期：新加入的 2 分场景失败，旧实现仍将 2 分作为关键词门槛失败；旧的 1 分/0 分断言可能因旧文案不同而失败。

- [ ] **Step 3: 在服务端实现可读的独立门槛常量**

在 `worker/src/resume-processing/weighted-screening.ts` 的维度常量附近加入：

```ts
export const KEYWORD_MATCH_MIN_SCORE = 2;
export const RED_FLAG_MIN_SCORE = 5;
```

将 `evaluateWeightedScreening` 中的门槛逻辑改为：

```ts
const gate_results = {
  keyword_match: { score: keywordScore, passed: keywordScore >= KEYWORD_MATCH_MIN_SCORE },
  red_flag: { score: redFlagScore, passed: redFlagScore >= RED_FLAG_MIN_SCORE },
};

if (!gate_results.keyword_match.passed) {
  return {
    dimensions,
    weighted_score: null,
    screening_result: '不通过' as const,
    screening_reason: `关键词匹配未达 ${KEYWORD_MATCH_MIN_SCORE} 分`,
    gate_results,
  };
}

if (!gate_results.red_flag.passed) {
  return {
    dimensions,
    weighted_score: null,
    screening_result: '不通过' as const,
    screening_reason: `避坑雷区未达 ${RED_FLAG_MIN_SCORE} 分`,
    gate_results,
  };
}
```

不要修改五项能力的 `DEFAULT_WEIGHTS` 或 `weighted_score >= 4` 逻辑。

- [ ] **Step 4: 运行服务端单测确认门槛行为通过**

运行：

```bash
cd /Users/jhx/Desktop/天鹅到家/dvS2cn/ai-interview/worker
npm test -- tests/weighted-screening.test.ts
```

预期：该文件全部通过，关键词 2/3 分进入加权计算，关键词 0/1 分失败，避坑雷区 4 分仍失败。

---

### Task 2: 建立统一的新提示词规则和自定义提示词归一化

**Files:**
- Modify: `worker/src/resume-processing/weighted-screening.ts`
- Modify: `worker/src/index.ts`
- Modify: `worker/src/resume-consumer.ts`（仅在存在旧的直接规则文案时修改）
- Create: `worker/tests/screening-prompt.test.ts`

**Interfaces:**
- Consumes: `getAIPrompt(env, key, defaultPrompt)`。
- Produces: `WEIGHTED_SCREENING_PROMPT`、`SCREENING_PROMPT_VERSION`、`normalizeScreeningPrompt(key, prompt)`；所有 `resume_screening` 和 `resume_screening_supplement` 调用都得到当前规则。

- [ ] **Step 1: 为提示词归一化写失败测试**

新建 `worker/tests/screening-prompt.test.ts`，使用以下测试结构：

```ts
import { describe, expect, it } from 'vitest';
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
});
```

- [ ] **Step 2: 运行提示词测试确认辅助接口尚未实现**

运行：

```bash
cd /Users/jhx/Desktop/天鹅到家/dvS2cn/ai-interview/worker
npm test -- tests/screening-prompt.test.ts
```

预期：因新导出常量和函数尚未存在而失败。

- [ ] **Step 3: 在统一规则源中加入版本化提示词和归一化函数**

在 `worker/src/resume-processing/weighted-screening.ts` 中加入：

```ts
export const SCREENING_PROMPT_VERSION = '[简历初筛规则版本：keyword-gate-v2]';
export const LEGACY_KEYWORD_GATE_TEXT = '其中「关键词匹配」与「避坑雷区」是硬门槛，只有各自为 5 分才通过；其余五项用于计算加权分。';

export const WEIGHTED_SCREENING_PROMPT = `${SCREENING_PROMPT_VERSION}
初筛必须且只能返回以下七个能力维度，每项 score 为 0-5 整数并提供中文事实依据：${WEIGHTED_SCREENING_DIMENSION_NAMES.join('、')}。
「关键词匹配」只按以下三个证据点评估：
1. 相关经验：必须同时具备 5 年及以上智能硬件、IoT 或嵌入式相关产品经验，并命中“嵌入式固件、IoT 云平台、MQTT 协议、设备端需求、OTA 升级、软硬件联调”中的任一关键词或等价表述；
2. 外部开发协同：明确描述 ODM、外包或外部研发团队对接，以及需求拆解、进度/质量管理、验收或交付等需求管控职责；
3. 知名企业相关经历：在京东、小米、海尔等同类知名企业工作，且该段经历实际涉及智能硬件、IoT 或嵌入式产品。知名企业名称本身不能单独算命中。
三个证据点中完整命中至少一个，关键词匹配可评 2 分；命中两个可评 3 分；三项均命中时可评 4-5 分。关键词匹配 score >= 2 通过该门槛，0-1 分不通过；「避坑雷区」仍需 score >= 5。其余五项用于计算加权分，最终是否通过由服务端计算；match_score 和 recommendation 仅作非权威参考。`;

export function normalizeScreeningPrompt(
  key: string,
  prompt: { system: string; user: string },
) {
  if (key !== 'resume_screening' && key !== 'resume_screening_supplement') return prompt;
  if (prompt.system.includes(SCREENING_PROMPT_VERSION)) return prompt;
  const withoutLegacyRule = prompt.system.replace(LEGACY_KEYWORD_GATE_TEXT, '').trim();
  return {
    ...prompt,
    system: `${withoutLegacyRule}\n\n${WEIGHTED_SCREENING_PROMPT}`,
  };
}
```

保留现有 `WEIGHTED_SCREENING_DIMENSION_NAMES` 和五项加权维度定义；只替换旧的 `WEIGHTED_SCREENING_PROMPT` 内容。

- [ ] **Step 4: 让 `getAIPrompt` 对自定义和默认提示词统一应用规则**

在 `worker/src/index.ts` 的 import 中加入 `normalizeScreeningPrompt`，并将 `getAIPrompt` 改为：

```ts
export async function getAIPrompt(env: Env, key: string, defaultPrompt: { system: string; user: string }): Promise<{ system: string; user: string }> {
  const custom = await getCustomPrompt(env, key);
  const prompt = custom?.system && custom?.user
    ? { system: custom.system, user: custom.user }
    : defaultPrompt;
  return normalizeScreeningPrompt(key, prompt);
}
```

这样旧的数据库自定义提示词不会绕过新规则；已经包含版本标识的新默认提示词不会重复追加。

- [ ] **Step 5: 清理 index.ts 中剩余的旧规则直写**

更新 `worker/src/index.ts` 中仍然写着“关键词匹配和避坑雷区均为硬门槛，只有 5 分才通过”的 legacy/reparse/系统默认提示词，统一改为引用 `${WEIGHTED_SCREENING_PROMPT}` 或使用新规则文本。尤其检查以下区域：

- legacy 初筛结构说明约 882 行；
- reparse 默认系统提示词约 6592 行；
- 系统设置 `resume_screening` 和 `resume_screening_supplement` 默认值约 7717 行；
- 其他通过 `rg -n "只有 5 分|关键词匹配未达 5 分" worker/src` 找到的运行时代码。

不要修改与「避坑雷区」5 分门槛相符的文案。

- [ ] **Step 6: 运行提示词测试和旧文案扫描**

运行：

```bash
cd /Users/jhx/Desktop/天鹅到家/dvS2cn/ai-interview/worker
npm test -- tests/screening-prompt.test.ts tests/weighted-screening.test.ts
rg -n "只有 5 分才通过|关键词匹配未达 5 分" src tests
```

预期：两个测试文件通过；运行时代码中不再出现旧关键词 5 分门槛文案，历史测试/文档若仍有旧规则需在后续判断是否属于历史记录，不得误改用户未跟踪 handoff 文件。

---

### Task 3: 将新规则安全同步到 D1 系统设置提示词

**Files:**
- Create: `worker/migrations/0031_keyword_screening_rule_v2.sql`
- Modify: `worker/src/index.ts`（仅 seed 默认值与提示词版本维护）

**Interfaces:**
- Consumes: `system_configs.prompt_configs` JSON 文本和 `LEGACY_KEYWORD_GATE_TEXT` 对应的旧内置句子。
- Produces: 已保存的 `resume_screening` / `resume_screening_supplement` 系统提示词不再保留旧的关键词 5 分硬门槛，并保留其他自定义内容。

- [ ] **Step 1: 编写可重复执行的 D1 migration**

创建 `worker/migrations/0031_keyword_screening_rule_v2.sql`，使用 `REPLACE` 只替换旧内置规则句，避免覆盖整段 JSON：

```sql
UPDATE system_configs
SET prompt_configs = REPLACE(
  prompt_configs,
  '其中「关键词匹配」与「避坑雷区」是硬门槛，只有各自为 5 分才通过；其余五项用于计算加权分。',
  '[简历初筛规则版本：keyword-gate-v2] 关键词匹配按三个证据点评估：一、5 年及以上智能硬件/IoT/嵌入式相关产品经验且命中嵌入式固件、IoT 云平台、MQTT 协议、设备端需求、OTA 升级、软硬件联调中的任一关键词；二、明确 ODM/外包/外部研发团队对接和需求管控；三、知名企业背景且实际从事智能硬件、IoT 或嵌入式产品。完整命中至少一项可评 2 分，命中两项可评 3 分，三项均命中可评 4-5 分；关键词匹配 score >= 2 通过该门槛，避坑雷区仍需 score >= 5，最终是否通过由服务端计算。'
)
WHERE prompt_configs LIKE '%其中「关键词匹配」与「避坑雷区」是硬门槛，只有各自为 5 分才通过；其余五项用于计算加权分。%';
```

迁移必须只修改 `prompt_configs`，不得修改 LLM key、base URL、model、邮件配置或其他系统配置。

- [ ] **Step 2: 更新 seed-defaults 的默认提示词**

在 `worker/src/index.ts` 的 `defaults.resume_screening.system` 和 `defaults.resume_screening_supplement.system` 中删除旧的“两个维度均为 5 分”文字，改为引用当前 `WEIGHTED_SCREENING_PROMPT`，保证后续重新初始化提示词不会恢复旧规则。

- [ ] **Step 3: 在本地验证 migration 文本和 JSON 保留策略**

使用项目现有 D1 本地配置执行 migration，或至少通过 SQLite/D1 兼容环境验证：

1. 包含旧规则句子的 JSON 能被替换；
2. 旧规则句子之外的自定义 system/user 字段仍保留；
3. 不包含旧规则句子的配置不会被更新；
4. migration 文件只执行一次有效替换，不会破坏 JSON。

如果本地 D1 不可用，使用 Worker 测试中的纯字符串 fixture 验证 `REPLACE` 的输入/输出，并在日志中记录无法执行本地 migration 的原因；不要连接生产 D1。

---

### Task 4: 更新前端关键词门槛展示

**Files:**
- Modify: `frontend/src/utils/resumeEvaluation.ts`
- Modify: `frontend/src/utils/weightedScreeningDisplay.test.ts`

**Interfaces:**
- Consumes: API 返回的 `gate_results.keyword_match` 和 `screening_reason`。
- Produces: 前端关键词失败原因显示“关键词匹配未达 2 分”，避坑雷区仍显示“命中避坑雷区”。

- [ ] **Step 1: 更新前端展示测试的旧文案**

将 `frontend/src/utils/weightedScreeningDisplay.test.ts` 中的 fixture 和期望值从：

```ts
screening_reason: '关键词匹配未达 5 分；命中避坑雷区'
```

改为：

```ts
screening_reason: '关键词匹配未达 2 分；命中避坑雷区'
```

并将关键词 gate 的期望 reason 改为 `关键词匹配未达 2 分`。

- [ ] **Step 2: 修改前端 gate 默认失败原因**

在 `frontend/src/utils/resumeEvaluation.ts` 的 `gateDefinitions` 中将：

```ts
{ key: 'keyword_match', label: '关键词匹配', reason: '关键词匹配未达 5 分' }
```

改为：

```ts
{ key: 'keyword_match', label: '关键词匹配', reason: '关键词匹配未达 2 分' }
```

不要把阈值复制到其他组件；列表和详情页继续通过该工具函数展示。

- [ ] **Step 3: 运行前端相关测试和类型检查**

运行：

```bash
cd /Users/jhx/Desktop/天鹅到家/dvS2cn/ai-interview/frontend
npm test -- --run src/utils/weightedScreeningDisplay.test.ts
npx tsc -b
```

预期：相关测试通过，TypeScript 无错误。

---

### Task 5: 端到端回归与提交前检查

**Files:**
- Test: `worker/tests/weighted-screening.test.ts`
- Test: `worker/tests/screening-prompt.test.ts`
- Test: `frontend/src/utils/weightedScreeningDisplay.test.ts`
- Check: `worker/src/resume-processing/weighted-screening.ts`
- Check: `worker/src/index.ts`
- Check: `worker/migrations/0031_keyword_screening_rule_v2.sql`

**Interfaces:**
- Consumes: Task 1–4 的服务端规则、提示词、migration 和前端展示。
- Produces: 可审计的测试结果和提交前变更清单；不自动部署生产。

- [ ] **Step 1: 扫描所有运行时旧门槛引用**

运行：

```bash
cd /Users/jhx/Desktop/天鹅到家/dvS2cn/ai-interview
rg -n "关键词匹配未达 5 分|关键词匹配.*只有 5 分|关键词匹配和避坑雷区.*5 分|只有各自为 5 分" worker/src frontend/src
```

预期：运行时代码不再保留旧的关键词 5 分门槛；避坑雷区单独 5 分的文案可以保留。

- [ ] **Step 2: 运行 Worker 全量测试**

运行：

```bash
cd /Users/jhx/Desktop/天鹅到家/dvS2cn/ai-interview/worker
npm test
```

预期：Worker 全部测试通过。

- [ ] **Step 3: 运行前端全量测试和类型检查**

运行：

```bash
cd /Users/jhx/Desktop/天鹅到家/dvS2cn/ai-interview/frontend
npm test -- --reporter=dot
npx tsc -b
```

预期：前端全部测试通过，类型检查通过。

- [ ] **Step 4: 检查变更范围并保留用户文件**

运行：

```bash
cd /Users/jhx/Desktop/天鹅到家/dvS2cn/ai-interview
git diff --check
git status --short
git diff -- worker/src/resume-processing/weighted-screening.ts worker/src/index.ts worker/src/resume-consumer.ts frontend/src/utils/resumeEvaluation.ts worker/migrations/0031_keyword_screening_rule_v2.sql
```

确认：

- 只包含本功能相关的 tracked 文件修改；
- 根目录 `package-lock.json` 等用户未跟踪文件未被加入；
- 没有生产 D1 写入、GitHub 推送或 Cloudflare 部署操作。

- [ ] **Step 5: 提交前向用户报告并请求发布确认**

在测试全部通过后，向用户报告：

1. 关键词 2/3 分的行为；
2. 避坑雷区和加权分是否保持不变；
3. 系统设置提示词迁移是否已包含；
4. 测试结果和工作区变更；
5. 是否需要用户明确确认后再提交、推送和部署生产。

不在本计划内自动执行生产部署。

---

## 实施顺序与检查点

1. Task 1 完成后，确认服务端门槛行为正确。
2. Task 2 完成后，确认所有运行时初筛入口使用新提示词。
3. Task 3 完成后，确认 D1 已有系统设置不会继续保留旧门槛。
4. Task 4 完成后，确认前端文案与服务端失败原因一致。
5. Task 5 完成后，再决定是否创建提交和发布。

## 回滚

如果回归验证或小范围生产验证发现通过率异常：

1. 将 `KEYWORD_MATCH_MIN_SCORE` 恢复为 5；
2. 回滚 `WEIGHTED_SCREENING_PROMPT` 到上一版本；
3. 回滚或补充 D1 prompt migration；
4. 保留新增测试并调整其期望值，确保回滚后的行为仍可验证。

## Plan self-review

- Spec coverage: 三个证据点、2 分门槛、避坑雷区 5 分、整体加权分、提示词同步、已有配置迁移、前端文案、测试、验收和回滚分别由 Task 1–5 覆盖。
- Placeholder scan: 计划不使用未定义的占位步骤或模糊的“稍后补充”描述；每个代码改动步骤都提供了目标路径、接口和示例内容。
- Type consistency: `normalizeScreeningPrompt(key, prompt)` 在 Task 2 定义并由 `getAIPrompt` 调用；`KEYWORD_MATCH_MIN_SCORE` 和 `RED_FLAG_MIN_SCORE` 在 Task 1 定义并由服务端 evaluator 使用；前端只消费 API gate 结果，不重复实现服务端算法。
- Scope safety: 未跟踪用户文件、历史 handoff、生产环境和其他系统配置均明确排除。
