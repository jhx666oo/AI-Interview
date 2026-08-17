# 妙搭招聘仪表盘迁移与双源数据聚合实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不破坏现有 AI-Interview 业务、权限、快照和分享能力的前提下，将最新飞书妙搭招聘仪表盘的页面结构和视觉完整迁移到现有 `/dashboard`，并以飞书招聘岗位数据为主、以 D1 系统入库和流程数据为增量，生成一套统一、可验证的仪表盘数据。

**Architecture:** 浏览器只请求当前 Cloudflare Worker 的统一仪表盘接口，不再直接调用妙搭项目的 `@lark-apaas/client-toolkit`。Worker 负责读取两张飞书招聘表、读取 D1 的简历/面试/Offer/入职数据、按岗位合并去重、应用 P0/P1/P2 统计规则，再返回妙搭页面所需的规范化数据。迁移期间新增 v3 接口和 v3 快照格式，保留现有 v2 接口与分享格式，验收完成后再切换 `/dashboard`。

**Tech Stack:** React 19 + Vite 7 + TypeScript + Ant Design 6；Cloudflare Hono Worker；Cloudflare D1；飞书多维表格 REST API；Vitest；现有快照和分享链接机制。

## Global Constraints

- 飞书数据是岗位、事业部、HRBP 和岗位累计招聘指标的主数据源。
- “简历推送”定义为简历第一次进入 AI-Interview 系统，来源包括本地上传、外部接口、邮件拉取和飞书同步；同一份简历只能计一次。
- 全局 KPI、漏斗、事业部面板、HRBP 效能、AI 诊断和招聘动态只统计 P0-紧急、P1-正常岗位。
- P2-储备岗不计入上述任何统计，只在独立的“P2 储备岗”明细板块展示。
- 飞书岗位的 KPI/漏斗/事业部/HRBP 主统计集按“在招人数 > 0 且 招聘状态 != 已取消”筛选；已完成岗位仍可进入 P0/P1 统计，已取消岗位不进入这些主统计。
- 平均招聘周期使用独立的“周期统计集”：在满足“在招人数 > 0、P0/P1、招聘状态含完成或取消、已耗时天数 > 0”的记录中计算，因此已取消岗位可以参与周期均值，但不会进入 KPI、漏斗、事业部或 HRBP 的数量汇总。
- 漏斗是岗位累计值相加，不对候选人做 DISTINCT 去重；只有“简历第一次进入系统”的入口事件需要去重。
- 全局七级漏斗固定为：简历推送 → 安排1面 → 1面通过 → 2面通过 → 终面通过 → 发放Offer → 已入职。
- 终面通过规则固定为：`3面通过` 字段有值时使用 `3面通过`，否则使用 `2面通过`；“有值”按非 `null`、非 `undefined`、非空字符串判断，数值 0 仍视为有值。
- 面试通过率固定为 `终面通过 / 安排1面 * 100%`；Offer 转化率固定为 `Offer / 终面通过 * 100%`；入职转化率固定为 `入职 / Offer * 100%`。
- 平均招聘周期只统计招聘状态含“完成”或“取消”且 `已耗时天数 > 0` 的岗位；在途岗位只用于“在途参考”，不计入平均周期。
- HRBP 四段转化率固定为：`1面 / 简历`、`终面 / 1面`、`Offer / 终面`、`入职 / Offer`；颜色阈值为 `>=30%` 绿色、`>=15%` 橙色、`>0` 红色、`=0` 灰色。
- 不新增前端运行时依赖；不得在浏览器端引入妙搭项目的 NestJS、PostgreSQL、Drizzle 或 `@lark-apaas/client-toolkit`。
- 迁移期间不删除或修改现有 v2 接口；生产部署必须在本地和预览环境验收后，并获得明确上线确认。
- 迁移页面保留现有登录、负责人筛选、权限控制、实时/快照切换、分享链接和公开分享页能力。

## 1. 当前代码与迁移参考

妙搭最新压缩包中的页面组件位于：

- `client/src/pages/RecruitmentDashboardPage/RecruitmentDashboardPage.tsx`
- `client/src/pages/RecruitmentDashboardPage/HeaderSection.tsx`
- `client/src/pages/RecruitmentDashboardPage/KpiOverviewSection.tsx`
- `client/src/pages/RecruitmentDashboardPage/FunnelChartSection.tsx`
- `client/src/pages/RecruitmentDashboardPage/DepartmentPanelSection.tsx`
- `client/src/pages/RecruitmentDashboardPage/HrbpEfficiencySection.tsx`
- `client/src/pages/RecruitmentDashboardPage/PositionDetailSection.tsx`
- `client/src/pages/RecruitmentDashboardPage/AiInsightsSection.tsx`
- `client/src/pages/RecruitmentDashboardPage/WeeklyDynamicSection.tsx`
- `client/src/pages/RecruitmentDashboardPage/realtimeSync.ts`
- `client/src/pages/RecruitmentDashboardPage/fieldMapping.ts`

妙搭项目的 `realtimeSync.ts` 目前在客户端直接读取两张飞书表，并把字段归一为 `IPosition`；这段逻辑只作为字段映射参考，不直接复制到现有前端。

现有 AI-Interview 相关文件：

- `frontend/src/pages/Dashboard/index.tsx`：当前仪表盘容器、实时/快照、负责人筛选和分享操作。
- `frontend/src/pages/Dashboard/types.ts`：当前 `RecruitingBoard`、岗位、事业部和 HRBP 类型。
- `frontend/src/pages/Dashboard/components/RecruitingBoardView.tsx`：当前 KPI、漏斗和事业部展示。
- `frontend/src/pages/Dashboard/components/PositionSummaryTable.tsx`：当前岗位明细表。
- `frontend/src/pages/SharedDashboard/index.tsx`：公开分享页。
- `frontend/src/pages/Dashboard/dashboard.module.css`：当前仪表盘样式。
- `worker/src/recruiting-operations/dashboard.ts`：当前 v2 看板聚合、漏斗和 HRBP 分组逻辑。
- `worker/src/recruiting-operations/share-links.ts`：分享数据模式和过期逻辑。
- `worker/src/index.ts`：当前 Hono 路由、D1 查询、飞书调用和 `/api/dashboard/*` 接口。
- `worker/schema.sql` 与 `worker/migrations/`：D1 表结构和迁移。

## 2. 规范化数据契约

### Task 1: 建立 v3 仪表盘数据类型和口径文档

**Files:**

- Create: `docs/dashboard-migration/data-contract.md`
- Create: `worker/src/recruiting-operations/dashboard-v3-types.ts`
- Create: `worker/tests/dashboard-v3-types.test.ts`
- Modify: `README.md`，增加 v3 仪表盘数据口径链接

**Interfaces:**

```ts
export type DashboardPriority = 'P0' | 'P1' | 'P2';

export interface DashboardV3Position {
  position_id: string;
  department: string;
  position_name: string;
  display_name: string;
  city: string;
  hrbps: string[];
  priority: DashboardPriority;
  status: string;
  headcount: number;
  resume_push: number;
  first_scheduled: number;
  first_pass: number;
  second_pass: number;
  third_pass: number;
  final_pass: number;
  offers: number;
  hired: number;
  elapsed_days: number;
  weekly_target: number;
  notes: string;
  data_sources: Array<'feishu' | 'd1' | 'merged'>;
  unmatched?: boolean;
}

export interface DashboardV3Totals {
  active_positions: number;
  headcount: number;
  resume_push: number;
  first_scheduled: number;
  first_pass: number;
  second_pass: number;
  final_pass: number;
  offers: number;
  hired: number;
  interview_pass_rate: number | null;
  offer_conversion_rate: number | null;
  hire_conversion_rate: number | null;
  average_completed_cycle_days: number | null;
  in_progress_position_count: number;
  in_progress_average_elapsed_days: number | null;
}

export interface DashboardV3Division {
  department: string;
  hrbps: string[];
  totals: DashboardV3Totals;
  positions: DashboardV3Position[];
  funnel: Array<{ key: string; label: string; count: number; conversion_rate: number | null }>;
  p0_position_count: number;
  p1_position_count: number;
  completed_position_count: number;
  in_progress_position_count: number;
  in_progress_average_elapsed_days: number | null;
}

export interface DashboardV3Hrbp {
  name: string;
  department: string;
  position_count: number;
  headcount: number;
  p0_position_count: number;
  p0_headcount: number;
  average_completed_cycle_days: number | null;
  in_progress_position_count: number;
  in_progress_average_elapsed_days: number | null;
  resume_push: number;
  first_scheduled: number;
  first_pass: number;
  second_pass: number;
  final_pass: number;
  offers: number;
  hired: number;
  conversion_rates: {
    first_over_resume: number | null;
    final_over_first: number | null;
    offer_over_final: number | null;
    hired_over_offer: number | null;
  };
}

export interface DashboardV3Board {
  schema_version: 'dashboard-v3';
  data_mode: 'live' | 'snapshot';
  snapshot_date: string | null;
  updated_at: string;
  kpis: Record<string, { value: number | null; available: boolean; caption?: string }>;
  funnel: Array<{ key: string; label: string; count: number; conversion_rate: number | null }>;
  divisions: Array<DashboardV3Division>;
  hrbps: Array<DashboardV3Hrbp>;
  p2_positions: DashboardV3Position[];
  positions: DashboardV3Position[];
  totals: DashboardV3Totals;
  insights: { summary: string; bottlenecks: string[]; recommendations: string[] };
  weekly_dynamic: { resume_push: number; first_scheduled: number; offers: number; hired: number; baseline_date: string | null };
}
```

- [ ] 先编写测试，验证七级漏斗顺序、终面兜底和 P2 排除规则。
- [ ] 运行 `npm --prefix worker test -- dashboard-v3-types.test.ts`，确认测试先失败。
- [ ] 实现纯类型辅助函数和 `data-contract.md`，明确每个字段的来源、单位、空值和公式。
- [ ] 增加“妙搭字段 → v3 字段 → 现有 v2 字段”的对照表，明确不再使用 `ai_screened` 代替 `first_pass`。
- [ ] 重新运行聚焦测试和 `npx tsc -p worker/tsconfig.json --noEmit`。

## 3. 简历首次进入系统的统一入口指标

### Task 2: 增加简历来源、首次接收时间和幂等键

**Files:**

- Create: `worker/migrations/0031_resume_ingestion_identity.sql`
- Modify: `worker/schema.sql`
- Modify: `worker/src/resume-schema.ts`
- Modify: `worker/src/index.ts`
- Create: `worker/src/recruiting-operations/resume-ingestion.ts`
- Create: `worker/tests/resume-ingestion.test.ts`

**Schema:**

```sql
ALTER TABLE resumes ADD COLUMN resume_received_at TEXT;
ALTER TABLE resumes ADD COLUMN resume_source TEXT DEFAULT 'unknown';
ALTER TABLE resumes ADD COLUMN resume_source_record_id TEXT DEFAULT '';
ALTER TABLE resumes ADD COLUMN resume_ingest_key TEXT DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_resumes_received_at ON resumes(resume_received_at);
CREATE INDEX IF NOT EXISTS idx_resumes_ingest_key ON resumes(resume_ingest_key);
CREATE INDEX IF NOT EXISTS idx_resumes_source_record ON resumes(resume_source, resume_source_record_id);
```

**Interfaces:**

```ts
export type ResumeSource = 'local_upload' | 'external_api' | 'email' | 'feishu' | 'unknown';

export interface ResumeIngestionIdentity {
  receivedAt: string;
  source: ResumeSource;
  sourceRecordId: string;
  ingestKey: string;
}

export function buildResumeIngestionIdentity(input: {
  source: ResumeSource;
  receivedAt?: string;
  fileSha256?: string;
  sourceRecordId?: string;
  emailMessageId?: string;
  attachmentIndex?: number;
}): ResumeIngestionIdentity;
```

- [ ] 为本地 PDF 上传使用 `file_sha256` 生成 `ingestKey`。
- [ ] 为飞书同步使用 `feishu:<record_id>` 生成 `ingestKey`。
- [ ] 为外部接口使用 `external:<provider>:<source_record_id>` 生成 `ingestKey`。
- [ ] 为邮件使用 `email:<message_id>:<attachment_index>` 生成 `ingestKey`。
- [ ] 所有入口在写入 `resumes` 时设置 `resume_received_at`，首次写入后不因重试、OCR 或 AI 重试而改变。
- [ ] 现有历史记录回填 `resume_received_at = COALESCE(created_at, updated_at)`，并将无法确认来源的记录标记为 `unknown`，不伪造原始接收时间。
- [ ] 测试相同来源键幂等、同一文件重传幂等、不同岗位允许同名候选人分别计数。

## 4. 飞书岗位数据适配

### Task 3: 将妙搭字段映射迁移到 Worker 纯函数

**Files:**

- Create: `worker/src/recruiting-operations/feishu-board-source.ts`
- Create: `worker/tests/feishu-board-source.test.ts`
- Modify: `worker/src/index.ts`，在现有 Bitable 辅助函数附近接入数据读取器

**Interfaces:**

```ts
export interface FeishuBoardSourceRecord {
  record_id: string;
  fields: Record<string, unknown>;
  table: 'zhipei' | 'yanglao';
}

export interface FeishuPositionMetric {
  feishu_record_id: string;
  department: string;
  position_name: string;
  display_name: string;
  city: string;
  hrbps: string[];
  priority: DashboardPriority;
  status: string;
  headcount: number;
  resume_push: number;
  first_scheduled: number;
  first_pass: number;
  second_pass: number;
  third_pass: number | null;
  offers: number;
  hired: number;
  elapsed_days: number;
  weekly_target: number;
  notes: string;
}

export function normalizeFeishuPositionRecord(record: FeishuBoardSourceRecord): FeishuPositionMetric | null;
export function isStatisticalPosition(position: FeishuPositionMetric): boolean;
export function isP2Position(position: FeishuPositionMetric): boolean;
export function isCycleEligiblePosition(position: FeishuPositionMetric): boolean;
export function finalPass(position: Pick<FeishuPositionMetric, 'third_pass' | 'second_pass'>): number;
```

- [ ] 从最新妙搭 `realtimeSync.ts` 迁移数字、日期、人员选择器和事业部归一化逻辑。
- [ ] 保留两张表的字段差异：职培使用“所属部门”，养老表使用“所属事业部”。
- [ ] 统一事业部名称为：养老及商业事业部、AI创新事业部、雏渐肥事业部、职培事业部。
- [ ] 优先级优先读字段值；字段为空时，再按备注含 `P2` 或状态含“储备”判定 P2。
- [ ] 生成两套明确的集合：主统计集按 `在招人数 > 0 && 招聘状态 != 已取消` 筛选；周期统计集额外保留 P0/P1 且状态含“完成/取消”、已耗时天数大于 0 的记录。
- [ ] P2 记录保留在完整明细中，但不进入统计行。
- [ ] 测试两张表字段名、User ID 映射失败回退、P2 判定、已取消岗位仅参与平均周期、终面通过值为 0 的边界。

## 5. D1 系统增量聚合

### Task 4: 按岗位聚合 D1 新增简历和流程数据

**Files:**

- Create: `worker/src/recruiting-operations/d1-dashboard-overlay.ts`
- Create: `worker/tests/d1-dashboard-overlay.test.ts`
- Modify: `worker/src/index.ts`，为聚合层提供 D1 查询调用

**Interfaces:**

```ts
export interface D1DashboardOverlay {
  byPosition: Record<string, {
    resume_push_increment: number;
    first_scheduled_increment: number;
    first_pass_increment: number;
    second_pass_increment: number;
    third_pass_increment: number;
    offers_increment: number;
    hired_increment: number;
    source_resume_ids: string[];
  }>;
  d1OnlyPositions: DashboardV3Position[];
  unmatchedResumeCount: number;
}

export async function loadD1DashboardOverlay(
  db: D1Database,
  feishuPositions: FeishuPositionMetric[],
  at: Date,
): Promise<D1DashboardOverlay>;
```

- [ ] 用 `resume_ingest_key`、`resume_source_record_id` 和同步产生的 Feishu record ID 识别已经包含在飞书统计中的记录。
- [ ] 仅将 D1 独有的首次接收简历计入 `resume_push_increment`。
- [ ] 将 D1 独有的面试、Offer、入职记录按岗位归属聚合；已有飞书来源 ID 的记录不再重复增加。
- [ ] 岗位归属优先使用 `position_id`，其次使用岗位映射后的标准岗位名和城市。
- [ ] 无法匹配岗位的 D1 简历不进入任何岗位统计，单独返回 `unmatchedResumeCount`，供诊断区域展示。
- [ ] D1 中只有本地岗位、飞书没有对应岗位时，保留为 `d1OnlyPositions`；只有 P0/P1 规则满足时才进入统计，P2 仍单独展示。
- [ ] 测试本地上传、飞书同步、外部接口、邮件来源的合并；测试重复同步不增加数量；测试岗位映射失败不会污染其他岗位。

## 6. 构建统一 v3 聚合结果

### Task 5: 生成 KPI、漏斗、事业部、HRBP 和动态数据

**Files:**

- Create: `worker/src/recruiting-operations/dashboard-v3.ts`
- Create: `worker/tests/dashboard-v3.test.ts`
- Modify: `worker/src/recruiting-operations/dashboard.ts`，只增加 v2/v3 转换函数，不改变现有 v2 结果

**Interfaces:**

```ts
export function buildDashboardV3(input: {
  feishuPositions: FeishuPositionMetric[];
  d1Overlay: D1DashboardOverlay;
  baseline?: DashboardV3Board | null;
  dataMode: 'live' | 'snapshot';
  snapshotDate?: string | null;
  updatedAt: string;
}): DashboardV3Board;

export function toLegacyRecruitingBoard(board: DashboardV3Board): RecruitingBoard;
```

- [ ] 先把飞书岗位和 D1 增量合并成岗位行，再计算所有总计；禁止先分别求总数再相加。
- [ ] 统计集合只使用 P0/P1；P2 只写入 `p2_positions`。
- [ ] 全局漏斗使用七级指标并计算每级相对上一阶段的转化率。
- [ ] 事业部漏斗使用六级指标，不展示终面通过节点。
- [ ] HRBP 卡片计算四段转化率和平均完结周期，并应用规定的颜色阈值。
- [ ] 平均完结周期只从周期统计集计算；已取消岗位不增加 KPI/漏斗数量，但在周期均值中保留。
- [ ] 计算已完结岗位数、在途岗位数、在途平均耗时和 P0 在招人数。
- [ ] 用上一份有效快照计算招聘动态：新增简历、新增1面、新增 Offer、新增入职；首次无基线时返回 0 并标记 `baseline_date: null`。
- [ ] AI 诊断只消费已聚合的确定性指标，不读取原始简历或调用 AI；诊断输出必须包含当前数据截止时间。
- [ ] 为旧分享页提供 `toLegacyRecruitingBoard`，确保 v2 消费者不会收到未知字段或错误阶段。
- [ ] 测试：P2 排除、终面兜底、岗位累计而非 DISTINCT、转化率除零、平均周期、动态基线、负责人筛选。

## 7. 新接口和快照兼容

### Task 6: 增加 `/api/dashboard/recruiting-board-v3`

**Files:**

- Modify: `worker/src/index.ts`
- Modify: `worker/src/recruiting-operations/share-links.ts`
- Modify: `worker/src/recruiting-operations/types.ts`
- Create: `worker/tests/dashboard-v3-routes.test.ts`
- Modify: `worker/migrations/0010_dashboard_snapshots.sql` only if v3 payload metadata requires a new nullable column; otherwise将 `schema_version` 保存在 `payload_json`

**Interfaces:**

```text
GET /api/dashboard/recruiting-board-v3?mode=live&responsible_person=<name>
GET /api/dashboard/recruiting-board-v3?mode=snapshot&snapshot_date=YYYY-MM-DD
```

- [ ] `mode=live` 调用飞书读取、D1 overlay 和 `buildDashboardV3`。
- [ ] `mode=snapshot` 读取 D1 中 `schema_version = dashboard-v3` 的快照。
- [ ] 快照创建接口默认保存 v3 payload，但保留读取旧 v2 快照的能力。
- [ ] 快照生成失败时返回明确错误，不写入半成品记录。
- [ ] 负责人筛选在聚合前应用岗位范围，确保 KPI、漏斗、事业部和 HRBP 统计一致。
- [ ] 共享链接的实时模式调用 v3 聚合；旧快照继续走旧转换器；公开分享不得暴露 D1 原始简历字段。
- [ ] 测试未登录 401、非法 mode 400、无快照 404、负责人过滤、v2/v3 快照兼容和分享脱敏。

## 8. 迁移妙搭视觉和页面组件

### Task 7: 在当前 Ant Design 前端中重做妙搭页面

**Files:**

- Create: `frontend/src/pages/Dashboard/components/MiaodaDashboardView.tsx`
- Create: `frontend/src/pages/Dashboard/components/MiaodaHeaderSection.tsx`
- Create: `frontend/src/pages/Dashboard/components/MiaodaKpiOverviewSection.tsx`
- Create: `frontend/src/pages/Dashboard/components/MiaodaFunnelChartSection.tsx`
- Create: `frontend/src/pages/Dashboard/components/MiaodaDivisionPanelSection.tsx`
- Create: `frontend/src/pages/Dashboard/components/MiaodaHrbpEfficiencySection.tsx`
- Create: `frontend/src/pages/Dashboard/components/MiaodaPositionDetailSection.tsx`
- Create: `frontend/src/pages/Dashboard/components/MiaodaAiInsightsSection.tsx`
- Create: `frontend/src/pages/Dashboard/components/MiaodaWeeklyDynamicSection.tsx`
- Create: `frontend/src/pages/Dashboard/miaoda-dashboard.module.css`
- Modify: `frontend/src/pages/Dashboard/types.ts`
- Create: `frontend/src/pages/Dashboard/miaoda-dashboard.test.tsx`

**Interfaces:**

```tsx
export interface MiaodaDashboardViewProps {
  board: DashboardV3Board;
  onRefresh: () => void;
  refreshing: boolean;
}
```

- [ ] 以妙搭压缩包的组件层次和截图为视觉参考，使用当前项目已有的 Ant Design、Recharts 和 CSS Modules。
- [ ] 保留当前系统品牌、侧边栏和顶部用户区，不引入妙搭的 Layout、Tailwind 或 shadcn 运行时。
- [ ] KPI 卡片展示妙搭字段名称和副文案：安排1面、终面、Offer、入职及对应转化率。
- [ ] 全局漏斗显示七级指标；事业部面板显示六级 mini 漏斗；P2 单独显示。
- [ ] 全量岗位明细支持事业部折叠/展开，并显示合计行。
- [ ] 表格在小屏幕使用现有 `ResponsiveDataView`/卡片降级；大屏幕显示完整表格；不得恢复不可见的重复分页 UI。
- [ ] 所有数值使用 `font-variant-numeric: tabular-nums`，百分比和天数统一格式化。
- [ ] 空数据、飞书失败、D1 增量失败和部分数据可用时分别显示状态，不用 0 掩盖数据源错误。
- [ ] 测试 KPI 文案、P2 分离、事业部折叠、HRBP 转化率颜色、漏斗值和错误态。

## 9. 接入仪表盘容器并保留原能力

### Task 8: 将 `/dashboard` 接入 v3，同时保留实时/快照/分享控制

**Files:**

- Modify: `frontend/src/pages/Dashboard/index.tsx`
- Modify: `frontend/src/pages/Dashboard/types.ts`
- Create: `frontend/src/pages/Dashboard/api.ts`
- Modify: `frontend/src/pages/SharedDashboard/index.tsx`
- Create: `frontend/src/pages/Dashboard/dashboard-v3-integration.test.tsx`

- [ ] 新增 `fetchDashboardV3(mode, snapshotDate, responsiblePerson)` API 函数，所有请求继续通过 `frontend/src/utils/request.ts`。
- [ ] 保留当前负责人筛选、实时/快照模式、快照创建、分享链接创建/撤销和有效期选择。
- [ ] 页面加载默认请求 v3；增加仅管理员可见的“旧版 v2 对照”开发开关，不在生产默认显示。
- [ ] 分享链接生成时记录 `data_mode` 和 `snapshot_id`，v3 快照使用 v3 payload。
- [ ] v2 旧分享链接继续由后端转换为公开安全结构，不能直接渲染内部 `DashboardV3Board`。
- [ ] 页面刷新、切换日期、切换负责人、失败重试时保持原有 loading 和 message 行为。
- [ ] 测试请求参数、模式切换、负责人筛选、快照创建、分享链接和错误恢复。

## 10. 数据对照和验收工具

### Task 9: 增加飞书/D1/仪表盘对账输出

**Files:**

- Create: `worker/src/recruiting-operations/dashboard-reconciliation.ts`
- Create: `worker/tests/dashboard-reconciliation.test.ts`
- Create: `frontend/src/pages/Dashboard/components/DataSourceStatus.tsx`
- Modify: `frontend/src/pages/Dashboard/components/MiaodaDashboardView.tsx`

**Interfaces:**

```ts
export interface DashboardReconciliation {
  generated_at: string;
  feishu_position_count: number;
  d1_overlay_position_count: number;
  unmatched_resume_count: number;
  metric_differences: Array<{
    position_key: string;
    metric: string;
    feishu_value: number;
    d1_increment: number;
    merged_value: number;
    reason: string;
  }>;
}
```

- [ ] 对每个岗位输出飞书原值、D1 增量和最终值。
- [ ] 统计未匹配岗位和未匹配简历数量。
- [ ] 仪表盘仅在管理员调试模式显示数据源状态，普通用户不暴露内部 ID。
- [ ] 对账结果不参与 KPI 计算，只用于迁移验收和问题定位。
- [ ] 测试同一岗位合并、D1-only 岗位、P2 对账和未匹配记录。

## 11. 测试与本地验收

### Task 10: 完成本地回归矩阵

**Files:**

- Create: `worker/tests/fixtures/dashboard-v3-feishu.json`
- Create: `worker/tests/fixtures/dashboard-v3-d1.json`
- Create: `frontend/src/pages/Dashboard/fixtures/dashboard-v3-board.json`
- Create: `docs/dashboard-migration/local-acceptance.md`

- [ ] 使用固定 fixture 验证全局漏斗：简历推送、安排1面、1面通过、2面通过、终面通过、Offer、入职。
- [ ] 验证终面字段 3 面为 0 时仍按“有值”使用 3 面；字段为空时回退 2 面。
- [ ] 验证 P2 岗位只出现在 P2 明细，不进入 KPI、事业部、HRBP 和 AI 诊断。
- [ ] 验证 HRBP 四段转化率和颜色阈值。
- [ ] 验证本周动态与上一份快照的增量计算。
- [ ] 验证本地上传、邮件、外部接口、飞书同步的简历入口去重。
- [ ] 运行：

```bash
npm --prefix worker test
npm --prefix frontend test
npx tsc -p worker/tsconfig.json --noEmit
npm --prefix frontend run build
```

- [ ] 启动本地 Worker 和 Vite，使用测试账号检查 `/dashboard`、`/shared/dashboard/:token`、快照切换和分享链接。
- [ ] 在 1440px、1280px、1024px 和 13 寸笔记本常见宽度下检查页面，不出现横向页面溢出或重复分页。
- [ ] 对照妙搭截图检查颜色、卡片层级、漏斗标签、事业部折叠、HRBP 卡片和全量岗位明细。

## 12. 灰度上线和回滚

### Task 11: 预览环境切换和生产发布

**Files:**

- Modify: `frontend/src/pages/Dashboard/index.tsx`，仅在验收通过后移除开发对照开关
- Modify: `worker/src/index.ts`，仅在 v3 对账通过后将 v3 设为默认
- Create: `docs/dashboard-migration/release-checklist.md`

- [ ] 先部署 Worker/Pages 预览版本，不修改生产 D1 数据。
- [ ] 在预览环境生成一份 v3 快照，与妙搭同一时刻数据逐岗位对账。
- [ ] 检查生产现有 v2 分享链接仍然可用。
- [ ] 上线前导出 `dashboard_snapshots` 和 `dashboard_share_links` 的只读备份。
- [ ] 生产切换使用可回滚开关；若飞书调用错误率、D1 查询错误率或指标差异超过验收阈值，立即切回 v2。
- [ ] 只有用户明确确认后才执行生产部署、D1 migration 和默认路由切换。

## 13. 建议的提交边界

实施时按以下独立提交进行，便于审查和回滚：

1. `docs: define dashboard v3 data contract`
2. `feat: add resume ingestion identity`
3. `feat: normalize feishu dashboard source`
4. `feat: aggregate d1 dashboard increments`
5. `feat: build dashboard v3 board`
6. `feat: add dashboard v3 api and snapshot compatibility`
7. `feat: port miaoda dashboard sections`
8. `feat: connect dashboard page to v3 board`
9. `test: add dashboard reconciliation fixtures`
10. `docs: add dashboard migration acceptance checklist`

每个提交都必须通过对应聚焦测试、TypeScript 检查和 `git diff --check`；任何生产部署提交必须单独获得上线确认。

## 14. 完成定义

迁移完成必须同时满足：

- `/dashboard` 视觉结构与妙搭目标页面一致。
- 七级全局漏斗、六级事业部漏斗和 HRBP 四段转化率严格遵守本计划口径。
- P2 岗位只出现在独立明细板块。
- 简历推送包含本地、外部接口、邮件和飞书进入系统的简历，并能幂等去重。
- 飞书主数据和 D1 增量均可在对账结果中解释。
- 实时、快照、分享、负责人筛选、公开分享和旧链接均可用。
- 现有简历、岗位、面试、Offer、入职业务不受影响。
- 本地和预览环境验收通过后，才进行生产切换。
