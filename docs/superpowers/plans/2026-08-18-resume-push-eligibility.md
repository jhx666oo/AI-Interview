# 简历全量推送规则 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让所有非终态简历都可以发起业务筛选推送，不再要求 AI 初筛结果为“通过”，同时保留 HR 淘汰、业务筛选状态、标准岗位和责任人校验。

**Architecture:** 继续复用现有的前端 `getBusinessScreeningActions` 和后端 `isEligibleForPush` 两个统一资格判断入口。前端负责按钮展示，后端负责最终安全校验；两处都只移除 AI 结果门槛，不改变按负责人复用链接、飞书发送和业务筛选回调链路。

**Tech Stack:** React 19、TypeScript、Ant Design、Vitest、Cloudflare Worker、Hono、D1。

## Global Constraints

- AI 初筛结果仅用于展示和筛选，不作为业务筛选推送的阻断条件。
- HR 已淘汰、已发起业务筛选、业务筛选已完成的简历不可重复推送。
- 缺少标准岗位或有效责任人的简历继续被跳过并返回明确原因。
- 不修改 AI 初筛算法、业务筛选链接复用策略、业务筛选回调和飞书消息发送逻辑。
- 保留当前工作区中的既有未跟踪文件，不将其加入本次变更。

---

## 文件结构与职责

- `frontend/src/pages/Resumes/businessScreening.ts`：前端业务筛选状态推断和按钮展示资格。
- `frontend/src/pages/Resumes/businessScreening.test.ts`：前端资格判断单元测试。
- `worker/src/business-screening/service.ts`：后端统一推送资格和按责任人分组。
- `worker/tests/business-screening-routes.test.ts`：后端推送接口集成测试。
- `docs/superpowers/specs/2026-08-18-resume-push-eligibility-design.md`：已确认的需求设计。

## Task 1: 先锁定前端全量推送资格

**Files:**
- Modify: `/Users/jhx/Desktop/天鹅到家/dvS2cn/ai-interview/frontend/src/pages/Resumes/businessScreening.test.ts`
- Modify: `/Users/jhx/Desktop/天鹅到家/dvS2cn/ai-interview/frontend/src/pages/Resumes/businessScreening.ts`

**Interfaces:**
- Consumes: `ResumeBusinessScreeningRecord`、`getBusinessScreeningActions`。
- Produces: `getBusinessScreeningActions` 在 `business_screening_status = not_ready` 且非终态时，不检查 `screening_result` 即返回 `primary: { key: 'push', label: '推送' }`。

- [ ] **Step 1: Write the failing tests**

在 `describe('resume business screening helpers', ...)` 中新增以下测试，覆盖 AI 不通过、未评估可以推送，以及已有终态保护：

```ts
it('shows push for AI-rejected resumes that are not otherwise terminal', () => {
  const actions = getBusinessScreeningActions({
    status: 'pending_review',
    screening_result: '不通过',
    hr_disposition: 'pending',
    business_screening_status: 'not_ready',
  });

  expect(actions.primary).toEqual({ key: 'push', label: '推送' });
});

it('shows push for resumes without an AI screening result', () => {
  const actions = getBusinessScreeningActions({
    status: 'pending_screening',
    screening_result: null,
    hr_disposition: 'pending',
    business_screening_status: 'not_ready',
  });

  expect(actions.primary).toEqual({ key: 'push', label: '推送' });
});

it('keeps push hidden for HR-rejected and completed business-screening resumes', () => {
  expect(getBusinessScreeningActions({
    status: 'pending_review',
    screening_result: '不通过',
    hr_disposition: 'rejected',
    business_screening_status: 'not_ready',
  }).primary).toBeNull();

  expect(getBusinessScreeningActions({
    status: 'pending_review',
    screening_result: '不通过',
    hr_disposition: 'pushed',
    business_screening_status: 'pending',
  }).primary).toBeNull();

  expect(getBusinessScreeningActions({
    status: 'pending_review',
    screening_result: '不通过',
    hr_disposition: 'pushed',
    business_screening_status: 'passed',
  }).primary).toBeNull();
});
```

- [ ] **Step 2: Run the focused frontend test and verify it fails**

Run:

```bash
cd /Users/jhx/Desktop/天鹅到家/dvS2cn/ai-interview/frontend
npm test -- --run src/pages/Resumes/businessScreening.test.ts
```

Expected: the new AI 不通过和未评估测试失败，当前实现返回 `primary: null`。

- [ ] **Step 3: Write the minimal frontend implementation**

在 `frontend/src/pages/Resumes/businessScreening.ts` 中删除仅用于推送资格判断的局部变量：

```ts
const screeningResult = clean(record.screening_label) || clean(record.screening_result);
```

并将：

```ts
const canPush = screeningResult === '通过' && businessStatus === 'not_ready' && !isTerminalStatus;
```

改为依赖业务状态、HR 淘汰状态和终态：

```ts
const isHrRejected = clean(record.hr_disposition) === 'rejected' || record.status === 'rejected';
const canPush = businessStatus === 'not_ready' && !isTerminalStatus && !isHrRejected;
```

不要移除 AI 结果字段类型，因为列表仍需要展示 AI 结果。

- [ ] **Step 4: Run the focused frontend test and verify it passes**

Run the same command from Step 2.

Expected: all `businessScreening.test.ts` tests pass。

## Task 2: 先锁定后端接口全量推送资格

**Files:**
- Modify: `/Users/jhx/Desktop/天鹅到家/dvS2cn/ai-interview/worker/tests/business-screening-routes.test.ts`
- Modify: `/Users/jhx/Desktop/天鹅到家/dvS2cn/ai-interview/worker/tests/business-screening-service.test.ts`
- Modify: `/Users/jhx/Desktop/天鹅到家/dvS2cn/ai-interview/worker/src/business-screening/service.ts`

**Interfaces:**
- Consumes: `isEligibleForPush`、`POST /api/resumes/business-screening/push`。
- Produces: 普通推送和 `temp_link` 推送使用相同的 AI 结果资格；`isEligibleForPush` 仍返回现有中文跳过原因。

- [ ] **Step 1: Replace the obsolete AI-gate route test with all-status coverage**

在 `worker/tests/business-screening-routes.test.ts` 中，将当前测试 `temp_link mode lets AI-rejected resumes into a temporary link while normal push skips them` 改为普通推送即可接受 AI 不通过和未评估简历。测试应保留同一个 `buildHarness`，并使用两份可推送简历：

```ts
it('pushes AI-rejected and unevaluated resumes through the normal route', async () => {
  const { request, batches } = buildHarness({
    apiKeyOwnerEmail: 'hr@example.com',
    resumes: [
      {
        id: 'resume-ai-no',
        candidate_name: '候选人丙',
        screening_result: '不通过',
        status: 'pending_screening',
        hr_disposition: 'pending',
        mapped_position: '标准运营',
        position_applied: '标准运营',
        business_screening_status: 'not_ready',
      },
      {
        id: 'resume-unassessed',
        candidate_name: '候选人丁',
        screening_result: null,
        status: 'pending_screening',
        hr_disposition: 'pending',
        mapped_position: '标准运营',
        position_applied: '标准运营',
        business_screening_status: 'not_ready',
      },
    ],
  });
  const response = await request('https://ai-interview-88r.pages.dev/api/resumes/business-screening/push', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer hr-token',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ids: ['resume-ai-no', 'resume-unassessed'] }),
  });

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({
    ok: true,
    pushed: ['resume-ai-no', 'resume-unassessed'],
    skipped: [],
  });
  expect(batches.size).toBe(1);
});
```

另新增一个 route-level regression test，确认 HR 淘汰和业务状态终态仍会被跳过，断言原因分别为 `HR已淘汰该简历`、`业务筛选已发起，请使用批次重发` 和 `业务筛选已完成`。

在 route regression 中再加入历史脏数据：`hr_disposition = 'pushed'` 且 `business_screening_status` 为空或为 `'not_ready'`，普通推送必须跳过，并返回 `业务筛选已发起，请使用批次重发`。

测试代码：

```ts
it('still skips HR-rejected and business-screening terminal resumes', async () => {
  const { request } = buildHarness({
    resumes: [
      {
        id: 'resume-hr-rejected',
        candidate_name: 'HR已淘汰',
        screening_result: '不通过',
        status: 'pending_review',
        hr_disposition: 'rejected',
        mapped_position: '标准运营',
        position_applied: '标准运营',
        business_screening_status: 'not_ready',
      },
      {
        id: 'resume-screening-pending',
        candidate_name: '业务筛选中',
        screening_result: null,
        status: 'pending_review',
        hr_disposition: 'pushed',
        mapped_position: '标准运营',
        position_applied: '标准运营',
        business_screening_status: 'pending',
      },
      {
        id: 'resume-screening-done',
        candidate_name: '业务筛选完成',
        screening_result: null,
        status: 'approved',
        hr_disposition: 'pushed',
        mapped_position: '标准运营',
        position_applied: '标准运营',
        business_screening_status: 'passed',
      },
    ],
  });
  const response = await request('https://ai-interview-88r.pages.dev/api/resumes/business-screening/push', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer hr-token',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ids: ['resume-hr-rejected', 'resume-screening-pending', 'resume-screening-done'] }),
  });

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({
    ok: true,
    pushed: [],
    skipped: [
      { id: 'resume-hr-rejected', reason: 'HR已淘汰该简历' },
      { id: 'resume-screening-pending', reason: '业务筛选已发起，请使用批次重发' },
      { id: 'resume-screening-done', reason: '业务筛选已完成' },
    ],
  });
});
```

- [ ] **Step 2: Run the focused worker tests and verify the new tests fail**

Run:

```bash
cd /Users/jhx/Desktop/天鹅到家/dvS2cn/ai-interview/worker
npm test -- --run tests/business-screening-routes.test.ts
```

Expected: 新增的 AI 不通过/未评估普通推送断言失败，当前返回 `AI初筛未通过`。

- [ ] **Step 3: Write the minimal backend implementation**

在 `worker/src/business-screening/service.ts` 的 `isEligibleForPush` 中删除以下 AI 结果门槛：

```ts
if (!options?.skipAiCheck && text(resume.screening_result) !== '通过') {
  return { ok: false, reason: 'AI初筛未通过' };
}
```

保留 `PushEligibilityOptions`、`skipAiCheck` 和现有 route 参数以兼容已经存在的临时链接调用；移除 AI 门槛后，`skipAiCheck` 不再改变资格判断，并将临时链接模式的注释更新为“历史兼容参数”。不能保留“普通推送”和“临时链接”两套不同的 AI 资格语义。必须保留后续 HR、业务状态、岗位和责任人检查。

在 `worker/src/business-screening/service.ts` 中，在 HR 淘汰检查之后、业务状态检查之前增加：

```ts
if (text(resume.hr_disposition) === 'pushed' && (!resume.business_screening_status || resume.business_screening_status === 'not_ready')) {
  return { ok: false, reason: '业务筛选已发起，请使用批次重发' };
}
```

这样前后端对历史脏数据使用同一条重复推送保护。

- [ ] **Step 4: Run the focused worker tests and verify they pass**

Run the same command from Step 2。

Expected: 业务筛选 route 测试全部通过。

同时更新 `worker/tests/business-screening-service.test.ts` 中仍锁定旧 AI 门槛的单元测试契约：

- 将测试描述从“仅 AI 通过可推送”改为“非终态且通过其他校验的简历可推送”；
- 将 `screening_result = '不通过'` 且其他字段有效的断言改为 `{ ok: true }`；
- 将分组测试中 AI 不通过但非终态、岗位和责任人均有效的 `r3` 纳入对应责任人的分组，断言张三组包含 `['r1', 'r3']`。

## Task 3: 回归验证前端、后端和构建

**Files:**
- Modify: no additional production files unless a focused test exposes a direct regression in the two eligibility paths above.
- Test: `/Users/jhx/Desktop/天鹅到家/dvS2cn/ai-interview/frontend/src/pages/Resumes/businessScreening.test.ts`
- Test: `/Users/jhx/Desktop/天鹅到家/dvS2cn/ai-interview/worker/tests/business-screening-routes.test.ts`

**Interfaces:**
- Consumes: Tasks 1–2 的统一前后端资格规则。
- Produces: 可审计的测试结果和构建结果；不执行生产部署。

- [ ] **Step 1: Run frontend full test suite**

Run:

```bash
cd /Users/jhx/Desktop/天鹅到家/dvS2cn/ai-interview/frontend
npm test -- --run
```

Expected: Vitest 全部通过。

- [ ] **Step 2: Run worker full test suite**

Run:

```bash
cd /Users/jhx/Desktop/天鹅到家/dvS2cn/ai-interview/worker
npm test -- --run
```

Expected: Worker Vitest 全部通过。

- [ ] **Step 3: Run the production frontend build**

Run:

```bash
cd /Users/jhx/Desktop/天鹅到家/dvS2cn/ai-interview/frontend
npm run build
```

Expected: TypeScript 检查、Vite 构建和 Worker bundle 构建全部成功。

- [ ] **Step 4: Review the diff and preserve unrelated files**

Run:

```bash
cd /Users/jhx/Desktop/天鹅到家/dvS2cn/ai-interview
git diff -- frontend/src/pages/Resumes/businessScreening.ts frontend/src/pages/Resumes/businessScreening.test.ts worker/src/business-screening/service.ts worker/tests/business-screening-routes.test.ts
git status --short
```

Expected: 仅包含本需求涉及的前后端资格判断和测试变更；既有未跟踪文件不被改写、不被加入提交。

## Execution Notes

- 本次只实现本地代码和测试，不自动执行 Cloudflare Pages/Worker 生产部署；生产部署需要用户单独明确确认。
- 当前工作区存在其他未跟踪文档、备份目录和资料文件，执行时不得清理或覆盖。
- 不修改业务筛选链接稳定唯一、按负责人跨岗位聚合、链接有效期和飞书消息逻辑。
