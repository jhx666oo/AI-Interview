# 业务筛选负责人统一链接与岗位筛选 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让同一负责人跨岗位、跨重复提醒复用同一个业务筛选链接，并在链接页面通过岗位复选框切换简历。

**Architecture:** 沿用现有 `resume_push_batches` 作为负责人的 canonical batch。推送和重发优先找到当前有效批次，找不到时回退到最近未撤销批次，复用原 token 并刷新 30 天到期时间；公开页继续使用现有 token 范围，只在前端增加岗位筛选状态和展示。

**Tech Stack:** Cloudflare Workers/Hono、D1、React、Ant Design、Vitest、现有 Feishu 消息发送链路。

## Global Constraints

- 同一负责人以飞书 `open_id` 作为唯一 scope。
- 不同负责人不得共用公开链接或候选人数据。
- 重复推送必须复用原 `batch_id`、token 和 URL；追加候选人按 `(batch_id, resume_id)` 去重。
- 推送或重发时将有效期刷新为当前时间后 30 天；被主动撤销的批次不得复用。
- 不改变现有公开回调的鉴权边界、dispatch group 校验和幂等决策规则。
- 不修改仪表盘和无关未跟踪文件。
- 先写失败测试，再写生产代码；完成前运行 Worker/Frontend 相关测试和构建校验。

---

### Task 1: 扩展负责人 canonical batch 存储能力

**Files:**
- Modify: `worker/src/business-screening/routes.ts`
- Modify: `worker/src/business-screening/repository.ts`
- Modify: `worker/tests/business-screening-routes.test.ts`
- Modify: `worker/tests/business-screening-repository.test.ts`

**Interfaces:**
- 新增 `loadLatestBatchByInterviewer(db, interviewerOpenId)`，返回该负责人最近的未撤销 scope 批次，允许 `active`、`completed`、`expired`。
- 新增 `refreshBatchExpiry(db, batchId, expiresAt)`，只更新批次到期时间。

- [x] **Step 1: 写失败测试。**

在 route harness 和 D1 store contract 中增加测试：已过期但未撤销的负责人批次可以被找回；批次刷新到期时间后仍保留原 batch/token；`revoked` 批次不会被选为 canonical batch。

- [x] **Step 2: 运行 focused route/repository 测试确认失败。**

Run: `cd worker && npm test -- --run tests/business-screening-routes.test.ts tests/business-screening-repository.test.ts`

Expected: 测试因 store 接口缺少 canonical lookup/expiry refresh 行为而失败。

- [x] **Step 3: 实现最小存储接口。**

在 `BusinessScreeningRouteStore` 增加方法；内存 harness 实现按 `interviewer_open_id`、`scope_key IS NOT NULL`、`status != 'revoked'` 倒序返回；D1 实现用 `ORDER BY created_at DESC LIMIT 1`，并增加 `refreshBatchExpiry` 的 UPDATE。

- [x] **Step 4: 运行 focused 测试确认通过。**

Run: `cd worker && npm test -- --run tests/business-screening-routes.test.ts tests/business-screening-repository.test.ts`

Expected: 新增测试与既有存储测试全部通过。

### Task 2: 推送/重发复用同一 URL并刷新 30 天

**Files:**
- Modify: `worker/src/business-screening/routes.ts`
- Modify: `worker/tests/business-screening-routes.test.ts`

**Interfaces:**
- 推送和重发继续返回 `batches[].url` / `url`，但对已过期 canonical batch 也返回原 URL。
- 飞书卡片使用 canonical batch 的当前待处理总数。

- [x] **Step 1: 写失败回归测试。**

增加测试覆盖：

```ts
it('reuses the same interviewer URL after expiry and refreshes it for 30 days', async () => {
  // first push captures URL; harness time advances beyond expires_at;
  // second push returns the same URL, one batch, and a new expires_at.
});

it('sends the same URL on repeated reminders and reports all pending items', async () => {
  // push one resume, push another resume for another position,
  // assert both Feishu cards have the same button URL and total pending count.
});
```

- [x] **Step 2: 运行测试确认 RED。**

Run: `cd worker && npm test -- --run tests/business-screening-routes.test.ts`

Expected: 过期后当前实现创建新 token/批次，或消息数量仍是本次新增数量，测试失败。

- [x] **Step 3: 调整推送路由。**

查找顺序为 `loadBatchByScope` → `loadBatchByInterviewer` → `loadLatestBatchByInterviewer`。命中历史批次后复用其 batchId/token scope，调用 `resetBatchActive`、`refreshBatchExpiry(resolveExpiresAt(nowIso, body.expires_in_days))`，再追加候选人。新建批次仍默认 30 天。

在 `markResumesPushed` 后调用 `countPendingBatchItems`，将结果传给 Feishu 卡片。卡片文案改为“已统一汇总到待筛选列表”，按钮改为“进入待筛选简历”。重发路径复用同一逻辑并刷新到期时间。

- [x] **Step 4: 运行 focused 测试确认 GREEN。**

Run: `cd worker && npm test -- --run tests/business-screening-routes.test.ts tests/business-screening-repository.test.ts`

Expected: 现有业务筛选 route/repository 测试和新增长期复用测试全部通过。

### Task 3: 公开页增加岗位复选筛选

**Files:**
- Modify: `frontend/src/pages/Public/businessScreeningLogic.ts`
- Modify: `frontend/src/pages/Public/businessScreening.test.ts`
- Modify: `frontend/src/pages/Public/BusinessScreening.tsx`
- Modify: `frontend/src/pages/Public/BusinessScreening.contract.test.ts`

**Interfaces:**
- 新增纯函数 `getBusinessScreeningPositions(resumes)` 返回去重且稳定排序的岗位名。
- 新增纯函数 `filterBusinessScreeningResumes(resumes, selectedPositions)`；空选择集合表示全部岗位。

- [x] **Step 1: 写失败纯逻辑测试。**

覆盖岗位去重、岗位复选过滤、空集合显示全部，以及当前候选人被过滤后能回退到可见候选人。

- [x] **Step 2: 运行测试确认 RED。**

Run: `cd frontend && npm test -- --run src/pages/Public/businessScreening.test.ts`

Expected: 新函数不存在或返回值不符合预期。

- [x] **Step 3: 实现纯函数与页面状态。**

在公开页加载数据后计算岗位列表，默认选择全部岗位。增加岗位 `Checkbox.Group`，每个选项显示该岗位的待处理数/总数；将候选人列表、详情、全选和自动跳转逻辑切换为使用过滤后的可见集合，决策请求仍使用原 token 和 resumeId。

- [x] **Step 4: 保持移动端布局。**

岗位筛选区域使用 `display:flex`、`flex-wrap` 和可换行标签，确保手机端不产生横向滚动；保留现有候选人列表/详情的响应式单列布局。

- [x] **Step 5: 运行 Frontend focused tests。**

Run: `cd frontend && npm test -- --run src/pages/Public/businessScreening.test.ts src/pages/Public/BusinessScreening.contract.test.ts`

Expected: 新增逻辑测试和现有页面契约测试全部通过。

### Task 4: 全量验证和交付检查

**Files:**
- Modify: `docs/superpowers/verification/2026-08-18-business-screening-unified-interviewer-link.md`

- [x] **Step 1: 运行 Worker 全量测试。**

Run: `cd worker && npm test -- --run`

- [x] **Step 2: 运行 Frontend 全量测试和构建。**

Run: `cd frontend && npm test -- --run && npm run build`

- [x] **Step 3: 运行差异和部署预检。**

Run: `git diff --check` and `cd worker && npx wrangler deploy --dry-run`

- [x] **Step 4: 写验证记录。**

记录测试数量、构建结果、dry-run 结果、未跟踪文件未被修改的事实；不执行生产部署，等待用户明确要求上线。
