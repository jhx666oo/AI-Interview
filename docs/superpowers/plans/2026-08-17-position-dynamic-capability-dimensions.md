# 岗位动态能力维度评估适配 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让简历 AI 评估严格按照当前岗位实际配置的任意数量能力维度运行、校验、保存和展示，同时兼容未配置维度的历史岗位旧 7 维度模式。

**Architecture:** 增加纯函数维度协议模块，统一定义岗位有效维度、legacy 7 维度、门槛维度和普通加权维度。所有 AI 入口先解析岗位评估配置，再把动态维度名称传入提示词、结构化校验、补评分和加权判定；数据库字段保持现有 JSON 结构，不增加 migration。前端继续渲染持久化结果中的实际维度，但去除固定七项/五项文案。

**Tech Stack:** Cloudflare Worker + Hono + D1 + Cloudflare Queue/R2 Consumer；React + TypeScript + Vite + Ant Design；Vitest；GitHub Actions 触发 Cloudflare Pages/Worker 生产部署。

## Global Constraints

- 岗位配置 3、4、5、6、7 或任意正整数数量的维度时，AI 必须只评估该岗位配置的维度。
- 未配置任何维度的历史岗位继续使用旧的 7 项维度兼容模式。
- 关键词匹配、避坑雷区只有在当前岗位配置时才启用对应门槛；未配置时跳过门槛且不展示门槛结果。
- 只有当前岗位普通维度参与加权；有正权重时按权重计算，没有正权重时按普通维度等权计算。
- AI 返回的岗位外额外维度不得持久化。
- 不自动改写历史简历评估结果；上线后通过重新评估更新结果。
- 生产上线必须推送 GitHub main，由 .github/workflows/deploy.yml 触发；禁止直接从本地部署生产。
- 根目录未跟踪的 package-lock.json、文档、备份目录和其他用户文件不得加入提交。

---

## 文件结构与职责

### 新建文件

- worker/src/resume-processing/screening-dimensions.ts：维度类型、legacy 7 维度常量、门槛识别、有效维度解析和普通维度筛选。
- worker/tests/screening-dimensions.test.ts：任意数量维度、legacy 回退、重复维度、门槛识别和权重归一化。
- worker/tests/dynamic-screening-evaluation.test.ts：动态提示词、结构化校验、动态门槛、动态加权和额外维度过滤。
- worker/tests/position-screening-profile.test.ts：岗位维度来源和统一上下文解析。
- worker/tests/direct-dynamic-screening-routes.test.ts：单份、reparse、批量和 screening queue 路由契约。

### 修改文件

- worker/src/resume-processing/weighted-screening.ts
- worker/src/resume-processing/dimension-scores.ts
- worker/src/resume-processing/structured-output.ts
- worker/src/resume-processing/screening-queue-evaluation.ts
- worker/src/resume-processing/types.ts
- worker/src/index.ts
- worker/src/resume-consumer.ts
- frontend/src/utils/resumeEvaluation.ts
- frontend/src/pages/Resumes/List.tsx
- frontend/src/pages/Resumes/Detail.tsx
- frontend/src/pages/Settings/System.tsx
- frontend/src/components/ScreeningRulesFields.tsx
- frontend/src/pages/Settings/CapabilityDimensions.tsx
- frontend/src/pages/Positions/List.tsx
- 相关 Worker/Frontend 测试文件

---

### Task 1: 建立岗位动态维度协议

**Files:**
- Create: worker/src/resume-processing/screening-dimensions.ts
- Create: worker/tests/screening-dimensions.test.ts
- Modify: worker/src/resume-processing/weighted-screening.ts
- Modify: worker/src/index.ts

**Interfaces:**

~~~ts
export type ScreeningDimensionDefinition = {
  name: string;
  description: string;
  weight: number | null;
  isGate: boolean;
};

export const LEGACY_SCREENING_DIMENSION_NAMES: readonly string[];

export function normalizeScreeningDimensions(value: unknown): ScreeningDimensionDefinition[];
export function resolveEffectiveScreeningDimensions(configured: readonly ScreeningDimensionDefinition[] | null | undefined): ScreeningDimensionDefinition[];
export function requiredDimensionNames(configured: readonly ScreeningDimensionDefinition[] | null | undefined): string[];
export function isScreeningGateDimension(name: string): boolean;
export function getActiveGateDimensions(dimensions: readonly ScreeningDimensionDefinition[]): ScreeningDimensionDefinition[];
export function getWeightedDimensions(dimensions: readonly ScreeningDimensionDefinition[]): ScreeningDimensionDefinition[];
~~~

- [ ] 写失败测试：四项护士岗位、3/5/6/8 项任意数量、空配置 legacy 七项、重复/空名称去重、只把实际配置的关键词匹配或避坑雷区识别为门槛。
- [ ] 运行测试确认失败：

~~~bash
cd worker && npm test -- --run tests/screening-dimensions.test.ts
~~~

预期：失败，因为动态协议模块不存在。
- [ ] 实现纯函数协议。legacy 顺序为核心画像、核心职责、任职要求、企业背景、加分项、关键词匹配、避坑雷区；旧普通权重为 25、22、22、13、10；非空配置原顺序保留，空配置才回退 legacy 七项；权重只接受有限且大于等于 0 的数。
- [ ] 在 weighted-screening.ts 中把旧 WEIGHTED_SCREENING_DIMENSION_NAMES 指向 legacy 常量，避免现有旧调用失效；index.ts 不再维护第二套维度归一化规则。
- [ ] 运行：

~~~bash
cd worker && npm test -- --run tests/screening-dimensions.test.ts tests/weighted-screening.test.ts
~~~

预期：新增和旧测试全部通过。
- [ ] 提交本任务：

~~~bash
git add worker/src/resume-processing/screening-dimensions.ts worker/tests/screening-dimensions.test.ts worker/src/resume-processing/weighted-screening.ts worker/src/index.ts
git commit -m "refactor: centralize dynamic screening dimensions"
~~~

只添加本任务文件，不加入其他未跟踪文件。

### Task 2: 让结构化 AI 输出按岗位维度校验

**Files:**
- Modify: worker/src/resume-processing/dimension-scores.ts
- Modify: worker/src/resume-processing/structured-output.ts
- Modify: worker/src/resume-consumer.ts
- Create: worker/tests/dynamic-screening-evaluation.test.ts
- Modify: worker/tests/resume-dimension-scores.test.ts
- Modify: worker/tests/structured-output.test.ts

**Interfaces:**

~~~ts
export function normalizeScreeningEvaluation(value: unknown, requiredNames?: readonly string[]): Record<string, any>;
export function requireCompleteScreeningEvaluation(value: unknown, requiredNames?: readonly string[]): Record<string, any>;
export function assembleScreeningEvaluation(primary: Record<string, unknown>, supplemental: unknown, requiredNames: readonly string[]): Record<string, unknown>;
export function buildScreeningRepairPrompt(kind: StructuredOutputKind, rawResponse: string, failureCode: StructuredOutputFailureCode, requiredNames: readonly string[]): { system: string; user: string };
export async function parseStructuredOutput(raw: string, kind: StructuredOutputKind, extractJson: (text: string) => unknown, repair: (input: RepairInput) => Promise<string>, requiredNames: readonly string[]): Promise<StructuredOutputResult>;
~~~

- [ ] 写失败测试：四项完整结果通过、缺一项失败、修复提示词只列四项、AI 返回七项时最终过滤为四项。
- [ ] 运行确认失败：

~~~bash
cd worker && npm test -- --run tests/dynamic-screening-evaluation.test.ts tests/resume-dimension-scores.test.ts tests/structured-output.test.ts
~~~

预期：动态断言失败，因为当前默认仍是七项。
- [ ] 让 normalizeScreeningEvaluation、嵌套 summary 恢复、完整性检查、requireComplete、merge/assemble、repair prompt 和 parseStructuredOutput 使用同一份 requiredNames；调用方省略时才使用 legacy 七项。
- [ ] 让 Consumer 包装器 parseScreeningResponse 和 tryParseDimensionScores 接收并传递 requiredNames，不允许 Consumer 路径隐式回退七项。
- [ ] 运行同一组 focused tests，预期全部通过，旧七项测试保持通过。
- [ ] 提交本任务：

~~~bash
git add worker/src/resume-processing/dimension-scores.ts worker/src/resume-processing/structured-output.ts worker/src/resume-consumer.ts worker/tests/dynamic-screening-evaluation.test.ts worker/tests/resume-dimension-scores.test.ts worker/tests/structured-output.test.ts
git commit -m "feat: validate resume screening dimensions per position"
~~~

### Task 3: 让门槛和加权判定动态化

**Files:**
- Modify: worker/src/resume-processing/weighted-screening.ts
- Modify: worker/src/resume-processing/screening-queue-evaluation.ts
- Modify: worker/src/resume-processing/types.ts
- Modify: worker/tests/weighted-screening.test.ts
- Modify: worker/tests/screening-queue-evaluation.test.ts
- Modify: worker/tests/dynamic-screening-evaluation.test.ts

- [ ] 写失败测试：四项岗位没有避坑雷区时不生成 red_flag gate；配置关键词匹配时仍检查关键词；普通维度没有正权重时等权平均；没有普通维度时返回明确不通过而不除零。
- [ ] 运行确认失败：

~~~bash
cd worker && npm test -- --run tests/dynamic-screening-evaluation.test.ts tests/weighted-screening.test.ts tests/screening-queue-evaluation.test.ts
~~~

预期：当前 evaluator 仍固定补七项、检查两个门槛、计算五项旧能力。
- [ ] 修改 evaluator：先解析 effective dimensions；只生成当前清单 dimensions；只为 active gates 生成 gate_results；从非门槛维度生成 weightedDimensions。
- [ ] 有正权重时按正权重计算；没有正权重时对普通维度等权；普通维度为空时返回 weighted_score null、不通过和“岗位未配置可加权的普通能力维度”。
- [ ] 将 WEIGHTED_SCREENING_PROMPT 改为岗位无关，不再出现固定七项和“五项能力”；新增 buildPositionDimensionContract(dimensions)，生成当前岗位按配置顺序的“必须且只能返回 N 项”协议。
- [ ] 让 buildScreeningQueuePersistence 和队列完成判断接收 effective dimensions/requiredNames，保存 canonical 结果。
- [ ] 运行 focused tests，预期全部通过。
- [ ] 提交本任务：

~~~bash
git add worker/src/resume-processing/weighted-screening.ts worker/src/resume-processing/screening-queue-evaluation.ts worker/src/resume-processing/types.ts worker/tests/weighted-screening.test.ts worker/tests/screening-queue-evaluation.test.ts worker/tests/dynamic-screening-evaluation.test.ts
git commit -m "feat: calculate screening results from position dimensions"
~~~

### Task 4: 统一岗位评估配置来源

**Files:**
- Modify: worker/src/index.ts
- Modify: worker/src/resume-consumer.ts
- Create: worker/tests/position-screening-profile.test.ts
- Modify: worker/tests/screening-rules-api.test.ts
- Modify: worker/tests/position-capability-sync.test.ts

**Interface:**

~~~ts
export type PositionScreeningProfile = {
  standardPosition: string;
  description: string;
  requirements: string;
  personalizedRequirements: string;
  capabilityDimensions: string;
  capabilityDimensionItems: ScreeningDimensionDefinition[];
  screeningRules: ResolvedScreeningRules;
  usesLegacyDimensions: boolean;
};
~~~

- [ ] 写失败测试：独立 capability_dimensions 非空时优先于 positions JSON；独立表为空时回退 positions；两处都空时 usesLegacyDimensions 为 true；四项配置返回四个结构化 items 和同顺序文本。
- [ ] 运行确认失败：

~~~bash
cd worker && npm test -- --run tests/position-screening-profile.test.ts tests/screening-rules-api.test.ts tests/position-capability-sync.test.ts
~~~

- [ ] 扩展 getPositionContext/getPositionRequirements，保持当前数据源优先级，返回结构化 capabilityDimensionItems、usesLegacyDimensions，并由同一数组生成 capabilityDimensions 文本；不得从格式化文本反向解析名称。
- [ ] D1/R2 Consumer 使用 context.capabilityDimensionItems，移除重复的岗位维度读取；仍可单独读取 hard_requirements 等其他字段。
- [ ] 运行 focused tests，预期通过。
- [ ] 提交本任务：

~~~bash
git add worker/src/index.ts worker/src/resume-consumer.ts worker/tests/position-screening-profile.test.ts worker/tests/screening-rules-api.test.ts worker/tests/position-capability-sync.test.ts
git commit -m "refactor: share position screening profile"
~~~

### Task 5: 迁移 D1/R2 Consumer

**Files:**
- Modify: worker/src/resume-consumer.ts
- Modify: worker/src/resume-processing/screening-queue-evaluation.ts
- Modify: worker/tests/resume-consumer.test.ts
- Modify: worker/tests/resume-processor.test.ts
- Modify: worker/tests/dynamic-screening-evaluation.test.ts

- [ ] 写失败集成测试：四项岗位的 D1/R2 prompt 只包含四个配置名称；不请求核心画像/企业背景；缺失补评分只接收当前岗位缺失项；持久化 dimensions 恰好四项；未配置避坑雷区不生成 red_flag 失败。
- [ ] 运行确认失败：

~~~bash
cd worker && npm test -- --run tests/resume-consumer.test.ts tests/resume-processor.test.ts tests/dynamic-screening-evaluation.test.ts
~~~

- [ ] 在最终 user prompt 最后追加 buildPositionDimensionContract(screeningDimensions)，顺序晚于自定义提示词、岗位上下文、岗位专属规则和阈值规则。
- [ ] 用 requiredNames = screeningDimensions.map(item => item.name)，将它传入主评估 parse、修复、missingDimensionNames、assemble 和 requireComplete。
- [ ] 两次补评分只使用当前岗位缺失维度；详细维度 prompt 使用 screeningDimensions，不创建旧七项映射。
- [ ] 用 effective screeningDimensions 调用 enrichScreeningEvaluation；只保存 canonical dimensions/configured_dimensions。
- [ ] 运行 focused Consumer tests，预期通过，包含 D1、R2 和 legacy 七项回归。
- [ ] 提交本任务：

~~~bash
git add worker/src/resume-consumer.ts worker/src/resume-processing/screening-queue-evaluation.ts worker/tests/resume-consumer.test.ts worker/tests/resume-processor.test.ts worker/tests/dynamic-screening-evaluation.test.ts
git commit -m "feat: evaluate queued resumes with position dimensions"
~~~

### Task 6: 迁移单份、重新评估、批量和初筛队列路由

**Files:**
- Modify: worker/src/index.ts
- Modify: worker/tests/screening-queue-evaluation.test.ts
- Modify: worker/tests/reprocess.test.ts
- Modify: worker/tests/custom-screen.test.ts
- Create: worker/tests/direct-dynamic-screening-routes.test.ts

- [ ] 写失败路由契约测试：四项岗位覆盖单份 AI 初筛、单份 reparse、批量兼容路径和 resume-screening ai-analyze，最终 persistence 只有四项且只包含已配置 gate。
- [ ] 运行确认失败：

~~~bash
cd worker && npm test -- --run tests/direct-dynamic-screening-routes.test.ts tests/screening-queue-evaluation.test.ts tests/reprocess.test.ts tests/custom-screen.test.ts
~~~

- [ ] 更新 buildAIScreeningPrompt 和各 route prompt，使用 effective position dimensions 生成 JSON schema 和动态 contract；runtime 中的固定七项 join 全部改为动态清单，legacy 常量仅用于无配置回退。
- [ ] 将 requiredNames 传入 requireComplete、missingDimensionNames、assemble；将 effectiveDimensions 传入 enrich 和 buildScreeningQueuePersistence。
- [ ] ai_review、ai_evaluation、飞书镜像和 screening queue ai_analysis 全部使用 enrich 返回的 canonical 结果，不直接序列化原始 AI dimensions。
- [ ] 运行 focused route tests，预期通过自定义四项和 legacy 七项。
- [ ] 提交本任务：

~~~bash
git add worker/src/index.ts worker/tests/direct-dynamic-screening-routes.test.ts worker/tests/screening-queue-evaluation.test.ts worker/tests/reprocess.test.ts worker/tests/custom-screen.test.ts
git commit -m "feat: apply dynamic dimensions to all screening routes"
~~~

### Task 7: 清除前端固定维度假设

**Files:**
- Modify: frontend/src/utils/resumeEvaluation.ts
- Modify: frontend/src/pages/Resumes/List.tsx
- Modify: frontend/src/pages/Resumes/Detail.tsx
- Modify: frontend/src/pages/Settings/System.tsx
- Modify: frontend/src/components/ScreeningRulesFields.tsx
- Modify: frontend/src/pages/Settings/CapabilityDimensions.tsx
- Modify: frontend/src/pages/Positions/List.tsx
- Create: frontend/src/utils/dynamicResumeEvaluation.test.ts

- [ ] 写失败测试：四维结果和只有 keyword_match 的 gate_results，normalize 返回四项，getDimensionScoreTotal 返回 total 15/maximum 20，getScreeningGateRows 只返回关键词门槛。
- [ ] 运行 focused tests：

~~~bash
cd frontend && npm test -- --run src/utils/dynamicResumeEvaluation.test.ts src/utils/weightedScreeningDisplay.test.ts
~~~

预期：固定七/五项断言失败时先定位并记录。
- [ ] 门槛行只从实际 gate_results 生成；失败原因优先使用 persisted screening_reason，不默认展示两个门槛。
- [ ] 文案改为普通维度加权最低分、仅岗位普通维度参与加权分，并明确岗位维度数量不固定、门槛维度可选。
- [ ] 检查列表、详情、导出路径，保留 scoreDetails.length 和 getDimensionScoreTotal 的动态流程，移除非 legacy 语义的固定 7、7/7、五项和固定名称判断。
- [ ] 运行：

~~~bash
cd frontend && npm test -- --run src/utils/dynamicResumeEvaluation.test.ts src/utils/weightedScreeningDisplay.test.ts && npx tsc -b
~~~

预期：通过。
- [ ] 提交本任务：

~~~bash
git add frontend/src/utils/resumeEvaluation.ts frontend/src/pages/Resumes/List.tsx frontend/src/pages/Resumes/Detail.tsx frontend/src/pages/Settings/System.tsx frontend/src/components/ScreeningRulesFields.tsx frontend/src/pages/Settings/CapabilityDimensions.tsx frontend/src/pages/Positions/List.tsx frontend/src/utils/dynamicResumeEvaluation.test.ts
git commit -m "fix: display position-specific screening dimensions"
~~~

### Task 8: 回归测试、构建和 GitHub 发布前检查

**Files:**
- Modify only source and test files listed in Tasks 1-7.
- Do not add root package-lock.json, frontend/dist.bak.1786592172/, unrelated docs, or user files.

- [ ] 增加任意数量矩阵测试：对 3、4、5、6、7、8 项逐一验证 requiredNames、parse/repair、canonical persistence、gate_results 和 weighted dimensions 数量一致。
- [ ] 增加 malformed-AI 测试：自定义四项收到旧七项时只保存四项；缺一项时只按四项修复；修复不完整时返回动态缺失错误。
- [ ] 运行完整测试：

~~~bash
cd frontend && npm test -- --reporter=dot
cd ../worker && npm test -- --reporter=dot
~~~

预期：前端和 Worker 测试全部通过；已有非阻塞 Ant Design warning 可以存在。
- [ ] 运行构建和检查：

~~~bash
cd frontend && npm run build
git diff --check
git status --short
~~~

预期：前端和 _worker.js 构建成功；无 whitespace 错误；用户未跟踪文件仍未 staged。
- [ ] 检查生成 Worker：

~~~bash
rg -n "必须且只能返回|当前岗位|七个能力维度|五项能力|普通维度" frontend/dist/_worker.js worker/src frontend/src
~~~

预期：动态 contract 存在；固定七/五项文字只出现在明确 legacy 兼容逻辑或历史测试 fixture。
- [ ] 请求用户确认提交和生产发布。未确认前不执行 git push、不执行生产部署；确认后只推送 GitHub main 并监控 Deploy to Cloudflare workflow，不直接本地部署。

## 验收与数据刷新

- 生产发布通过 GitHub Actions 完成，确认 D1 migration、Pages、Resume Consumer Worker 和 health check 全部成功。
- 访问 https://ai-interview-88r.pages.dev/health，预期 status=ok 且 ai_binding=true。
- 代码上线不自动修改历史简历结果；护士岗位需用批量重新评估更新旧的七项结果。
- 验证护士岗位显示 4 项，再验证一个 5 项岗位、一个 6 项岗位和一个 7 项岗位，确认数量没有硬编码。
- 不直接修改生产 D1，不手动清理历史评估数据。

## Plan self-review

- 覆盖任意数量维度，不仅是四项和七项。
- 覆盖 D1、R2、单份、reparse、批量和 screening queue 全部 AI 入口。
- 未配置门槛明确跳过且不展示。
- 空配置 legacy 回退与非空自定义配置严格区分。
- 动态清单贯穿 prompt、parse、repair、supplement、persistence、scoring 和 display。
- 不需要 migration，因为现有 JSON 字段已经支持任意数组。
- 生产只允许 GitHub Actions 部署。
- 没有 TODO、TBD 或未指定的“处理边界情况”步骤。
