# AI Interview 项目交接（2026-08-03）

> 本文用于交给下一个开发 Agent。以代码、Git 历史和已验证的生产环境为准；不包含账号密码、Token 或任何密钥。

## 1. 当前交接结论

- 项目：AI Interview 智能招聘管理系统（React/Vite + Cloudflare Pages/Workers + D1 + 飞书 + DeepSeek/MinerU）。
- 当前开发分支：`codex/recruitment-dashboard-rebuild`。
- GitHub 已推送到同名远端分支，最新提交：`dff6a46 fix: skip automatic Feishu file caching`。
- 生产站点：<https://ai-interview-88r.pages.dev>；最近部署预览：<https://572e6600.ai-interview-88r.pages.dev>。
- 已用生产管理员鉴权验证：`GET /api/resumes` 返回 `200`（当时返回 4 条线上数据）。
- 本地已验证：`http://localhost:5173/resumes` 能加载 56 条本地 D1 简历，且“全选本页”可正常选中当前页卡片。

## 2. 最近已完成事项

### 招聘运营仪表盘（主要功能）

仪表盘已按参考招聘看板完成重构，并已部署。核心提交范围为 `6e11e0b` 至 `aa03abf`：

- `/dashboard` 具备实时数据与按上海日期保存的不可变快照。
- 覆盖 KPI、AI 招聘诊断、招聘漏斗、事业部分看板、HRBP 效能、可折叠的全量岗位明细。
- 管理员可保存快照；定时任务在北京时间每日 23:55 自动存档。
- 分享支持实时或固定快照、有效期、撤销；分享页复用完整看板并隐藏内部操作。
- D1 迁移文件：`worker/migrations/0010_dashboard_snapshots.sql`，已应用到生产库。

入口和实现重点：

- `frontend/src/pages/Dashboard/`
- `worker/src/recruiting-operations/`
- `worker/src/index.ts` 中的 dashboard / share API 与 cron handler

### 简历管理：批量选择与稳定性

最近三个用户可见修复均已上线：

1. `8e5f12b feat: add current-page resume selection`
   - 简历管理工具栏增加“全选本页”。
   - 只影响当前 20 条分页数据，跨页已选内容保留；支持半选状态。
   - 代码：`frontend/src/utils/resumeSelection.ts`、`frontend/src/pages/Resumes/List.tsx`。

2. `d4c5a1d fix: repair legacy resume list schema`
   - 根因：旧本地 D1 缺 `ai_evaluation` 等列，`GET /api/resumes` 产生 500。
   - 现在访问简历列表时会安全尝试补齐旧库所需列（重复列会忽略），无需手动先访问初始化接口。
   - 代码：`worker/src/resume-schema.ts`、`worker/src/index.ts`、`worker/schema.sql`。
   - 已在本地验证修复前为 `D1_ERROR: no such column: ai_evaluation`，修复后接口为 200。

3. `dff6a46 fix: skip automatic Feishu file caching`
   - 根因：简历页加载后自动请求 `POST /api/resumes/cache-files`；本地飞书 token 过期时，飞书返回 `99991663 Invalid access token`，导致控制台反复出现 500。
   - 已移除列表加载时的隐式缓存请求。此缓存只是预览优化，移除不会影响列表、筛选、上传或批量操作。
   - `POST /api/resumes/cache-files` 路由仍保留；若未来需要手动批量缓存飞书附件，先修复/重新授权飞书 token，再以显式运维操作调用。

## 3. 简历 AI 流程与产品口径

用户当前最关注简历 AI 筛选。既定口径如下：

- 上传时先建立 D1 简历与处理任务；字段提取与 AI 初筛走 Queue 消费者，因此用户关闭或刷新页面后任务也应继续。
- AI 评估由三部分组成：岗位能力维度、个性化需求（加分项）、硬性要求（确定性规则；字段不确定时待人工复核，不自动拒绝）。
- 卡片显示能力维度及“总分 X/Y”，不再使用“综合分”字样。
- 简历页支持按 AI 总分、性别以及年龄区间筛选；年龄/性别来自字段提取结果。
- 刚上传简历按 `created_at` 倒序，需立即排在最前。
- 详情页应兼容 AI 返回字符串或数组，避免对非数组调用 `.map()`（此前已修过）。

关键代码：

- 前端列表：`frontend/src/pages/Resumes/List.tsx`
- 前端详情：`frontend/src/pages/Resumes/Detail.tsx`
- AI 结果展示工具：`frontend/src/utils/resumeEvaluation.ts`
- 异步消费者：`worker/src/resume-consumer.ts`
- 处理器：`worker/src/resume-processing/`
- 主 API：`worker/src/index.ts`

## 4. 本地开发与验证

### 启动

```bash
# 终端 1
cd worker
npm run dev -- --port 8788

# 终端 2
cd frontend
npm run dev -- --port 5173
```

前端通过 Vite 代理将 `/api` 转至本地 Worker。不要提交本地配置文件 `frontend/.wrangler.local.toml`。

常用验证：

```bash
cd worker && npm test
cd frontend && npm run build
cd frontend && node ../scripts/pre-deploy-check.mjs
```

最近验证结果：

- Worker：11 个测试文件、64 个测试全部通过。
- 前端：TypeScript、Vite 构建、Pages `_worker.js` 编译全部通过。
- 已知构建提示：`pdfjs-dist` 的 `eval` 警告，未阻断构建。

### 本地 D1 备注

本地 D1 的历史库可能比 `schema.sql` 老。当前简历列表首次访问会调用 `ensureResumeListSchema()` 自动补齐列表需要的字段。

如需人工核对本地数据库，数据库通常位于：

```text
worker/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite
```

不要删除该目录，否则会丢失本地测试数据。

## 5. 部署流程

Pages 中的 `_worker.js` 由 `frontend` 构建过程从 `worker/src/index.ts` 编译，因此仅改主 API 时也应重新构建并发布 Pages。

```bash
# 1) 构建
cd frontend && npm run build

# 2) 上线前检查
node ../scripts/pre-deploy-check.mjs

# 3) 发布 Pages（必须带 account ID，避免 Wrangler 使用错误账号）
CLOUDFLARE_ACCOUNT_ID=ed758fc82ca4400593ddb447d3db57a4 \
  npx wrangler pages deploy dist --project-name ai-interview --branch main
```

若修改 `worker/src/resume-consumer.ts` 或 `worker/src/resume-processing/`，还必须单独发布 Queue 消费者：

```bash
cd worker
npx wrangler deploy --config wrangler.resume-consumer.toml
```

注意：生产密钥应始终由 Cloudflare Secrets 管理；不要把密钥写入仓库或命令行输出。

## 6. 当前 Git 状态与工作树注意事项

```text
分支：codex/recruitment-dashboard-rebuild
远端：origin/codex/recruitment-dashboard-rebuild
最新提交：dff6a46
```

当前存在两个未跟踪的本地文件/目录，属于用户环境，后续 Agent 不要误提交或删除：

- `.superpowers/`
- `frontend/.wrangler.local.toml`

仓库还保留若干旧功能分支（如 `codex/normalize-resume-fields`、`codex/show-resume-total-score` 等）。当前仪表盘重构分支已包含其用户可见成果；合并旧分支前先逐项比较，避免重复或冲突。

## 7. 已知问题与建议优先级

1. **飞书本地授权过期**：`cache-files` 路由若手动调用仍会因飞书 token 无效失败。当前自动调用已移除，所以不影响日常简历页；如业务需要批量附件缓存，应先完成飞书 OAuth/Token 刷新排查。
2. **图表开发警告**：开发控制台偶见 Recharts 容器宽高为 `-1` 的 warning。它不阻断页面功能，通常出现在容器尚未布局完成时；若需要消除，检查 Dashboard 图表父容器高度与 `ResponsiveContainer` 的最小尺寸。
3. **数据模型历史负担**：`worker/schema.sql`、历史本地库和运行时列兼容曾有漂移。新增 `resumes` 列时同时更新 schema、运行时兼容列表与自动化测试；生产 D1 migration 需要特别小心重复列失败。
4. **飞书与 D1 边界**：列表读取以 D1 为准；飞书用于协作展示、同步与附件入口。不要重新把列表渲染改回“每次从飞书拉全量”，否则速度和稳定性会下降。
5. **批量 AI 历史代码**：代码中仍存在旧的按 `candidate_name` 更新的批量评估路径，重名候选人可能导致误更新。后续改造应统一改为按 `resume.id` 更新，并避免依赖 `waitUntil` 作为关键 AI 任务执行方式。

## 8. 继续工作时的建议

1. 先从 `git status -sb` 和本文件确认环境，保留用户未跟踪文件。
2. 开始功能改动前，先查看 `docs/superpowers/specs/` 与 `docs/superpowers/plans/` 中仪表盘和全选本页的决策记录。
3. 对简历 AI/数据库问题，优先做带鉴权的 `/api/resumes` API 验证；控制台 warning 与实际 500 要分开处理。
4. 每次发布前运行 Worker 测试、前端构建和 `pre-deploy-check.mjs`，部署后用生产接口鉴权验证关键 endpoint。

