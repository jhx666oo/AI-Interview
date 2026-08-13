# 岗位面试官来源统一 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让面试管理稳定使用标准岗位的默认一面/二面面试官，消除岗位管理、岗位映射和历史面试记录之间的读取冲突。

**Architecture:** 飞书招聘数据仍是同步源；`positions` 是本地标准岗位及其默认负责人/面试官的唯一读取源；`position_mappings` 只负责原始岗位名到标准岗位名的映射，不再参与面试官默认值读取。面试记录中已有明确人工值时保留，空值按原始岗位映射到标准岗位后回退到 `positions` 默认值。

**Tech Stack:** Cloudflare Worker、Hono、D1、TypeScript、Vitest、React/Ant Design。

## Global Constraints

- 不修改用户现有的生产数据，不在本轮执行生产部署。
- 不把岗位负责人自动加入一面/二面面试官字段。
- 不覆盖面试记录中已经明确填写的人工面试官。
- 兼容历史原始岗位名，包括 `IoT产品经理（双休｜入职五险一金）` 和 `IoT产品经理（双休）`。
- 保留 `position_mappings` 旧字段以兼容已有数据和页面，但业务读取不再依赖其 `responsible_person`、`interviewers`。

---

### Task 1: 固化面试官来源优先级

**Files:**
- Create: `worker/src/interviewer-assignment.ts`
- Modify: `worker/src/index.ts:resolveInterviewAssignments`
- Test: `worker/tests/interview-assignment.test.ts`

**Interfaces:**
- Produces `resolveInterviewAssignments(body, position)`，优先级为：明确请求值 > 标准岗位默认值 > 空值；不产生硬编码姓名。

- [ ] **Step 1: Write the failing test**

新增测试覆盖“空的岗位二面默认值不能被硬编码补成某个人”和“岗位负责人不参与面试官回退”。

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run worker/tests/interview-assignment.test.ts`

Expected: 新增断言失败，失败原因是当前逻辑或上游解析仍会产生硬编码二面值。

- [ ] **Step 3: Write minimal implementation**

将纯函数放到独立模块，统一清洗字符串；删除 `parseRequisitionRecord` 中 `secondary_interviewer` 的姓名硬编码；`index.ts` 仅复用该函数并继续导出兼容旧测试的函数名。

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run worker/tests/interview-assignment.test.ts`

Expected: PASS。

### Task 2: 让岗位映射只负责名称归一化

**Files:**
- Modify: `worker/src/index.ts:position-mappings/sync-from-feishu`
- Modify: `worker/src/index.ts:auth/sync-responsible-persons`
- Modify: `worker/src/index.ts:auth/fix-responsible-persons`
- Test: `worker/tests/position-mapping.test.ts`

**Interfaces:**
- `position_mappings` 的 `raw_name/raw_names/mapped_name` 继续用于解析；面试官默认读取不使用 `responsible_person/interviewers`。

- [ ] **Step 1: Write the failing test**

增加映射测试，证明同一个标准岗位下多个原始岗位别名都解析为 `软件产品经理（智能硬件方向）`，且映射记录中的人员字段不会改变默认面试官解析结果。

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run worker/tests/position-mapping.test.ts`

Expected: 新增行为断言在当前重复映射/人员字段参与逻辑下失败或无法表达。

- [ ] **Step 3: Write minimal implementation**

收敛同步入口：名称同步只维护别名和标准名；保留旧人员列不删除，但不再把飞书人员写入映射表作为面试官配置。负责人同步只更新 `positions`，不再更新映射表人员字段。

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run worker/tests/position-mapping.test.ts`

Expected: PASS。

### Task 3: 面试管理按标准岗位补齐默认面试官

**Files:**
- Modify: `worker/src/index.ts:/api/interviews`
- Modify: `worker/src/index.ts:/api/interviews/create-from-talent`
- Modify: `worker/src/index.ts:/api/interviews`
- Test: `worker/tests/interview-assignment.test.ts`

**Interfaces:**
- 面试列表返回 `standard_position`、`primary_interviewer`、`secondary_interviewer` 的有效值；明确存储值优先，空值才从标准岗位默认值补齐。

- [ ] **Step 1: Write the failing test**

增加纯函数测试：原始岗位名通过映射找到标准岗位时，空面试官返回岗位默认值；已有一面或二面值保持不变。

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run worker/tests/interview-assignment.test.ts`

Expected: 当前只按 `interviews` 存储字段返回，空值不会回退，测试失败。

- [ ] **Step 3: Write minimal implementation**

在 Worker 读取面试列表时加载标准岗位和映射，按 `position_id`、标准岗位名、原始岗位名依次解析岗位；用 `positions.primary_interviewer/secondary_interviewer` 填充空值。创建面试时使用标准岗位 ID 和标准岗位名；通知面试官也使用同一套默认解析结果，避免“保存的人”和“通知的人”不一致。

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run worker/tests/interview-assignment.test.ts`

Expected: PASS。

### Task 4: 前端岗位映射页面明确职责

**Files:**
- Modify: `frontend/src/pages/Settings/PositionMappings.tsx`
- Test: `frontend/src/pages/Interviews/interviewerDefaults.test.ts` or existing frontend test location

- [ ] **Step 1: Write the failing test**

为岗位映射页面的展示契约增加断言：页面不再把未分轮次的 `interviewers` 作为默认一面/二面来源，标准岗位的默认面试官来自岗位管理。

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run frontend/src/pages/Interviews/interviewerDefaults.test.ts`（若当前脚本不支持该路径，则运行对应 Vitest 文件）。

Expected: 当前映射页面仍展示和编辑通用“面试官”字段，契约断言失败。

- [ ] **Step 3: Write minimal implementation**

将岗位映射页面的人员区域改为“默认面试官请在岗位管理维护”的只读提示；保留负责人展示仅作为同步信息兼容显示，不作为面试管理配置入口。

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run frontend/src/pages/Interviews/interviewerDefaults.test.ts` 或项目实际对应测试命令。

Expected: PASS。

### Task 5: 全量验证并记录上线前状态

**Files:**
- No production data changes.

- [ ] **Step 1: Run Worker tests**

Run: `cd worker && npm test`

- [ ] **Step 2: Run frontend tests and build**

Run: `cd frontend && npm test -- --run && npm run build`

- [ ] **Step 3: Review diff and workspace status**

Run: `git diff --check && git status --short`

确认不包含 `frontend/dist.bak.1786592172/`、`package-lock.json` 等既有未跟踪文件。

- [ ] **Step 4: Report deployment gate**

只报告验证结果和待部署内容；生产部署需用户另行明确确认。
