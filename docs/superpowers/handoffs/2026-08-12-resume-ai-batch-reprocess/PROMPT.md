# 可直接交给其他 AI 的执行提示词

你现在要在现有项目中直接实现“简历管理页 AI 批量重评与进度追踪”功能。请先阅读下面两个文件，再开始改代码：

1. \`docs/superpowers/handoffs/2026-08-12-resume-ai-batch-reprocess/DESIGN.md\`
2. \`docs/superpowers/handoffs/2026-08-12-resume-ai-batch-reprocess/IMPLEMENTATION_PLAN.md\`

项目目录：

\`\`\`text
/Users/jhx/Desktop/天鹅到家/dvS2cn/ai-interview
\`\`\`

## 必须实现的结果

在简历管理页的 \`AI 工具\` 菜单中提供：

\`\`\`text
AI 工具 ▾
├─ 全部重评
├─ 重评未评估/失败简历
└─ 清除已淘汰
\`\`\`

两个重评入口都按当前登录用户有权限看到的简历执行，不受当前页、当前分页或 \`selectedRowKeys\` 影响。页面顶部显示真实批次进度，包含总数、百分比、已完成、排队中、评估中、失败、跳过和当前候选人；刷新页面后能恢复。评估开始后必须隐藏旧的 AI 分数和维度，评估失败也不能继续显示旧分数。

## 执行要求

- 严格按 \`IMPLEMENTATION_PLAN.md\` 的 Task 0 到 Task 9 顺序执行。
- 先阅读现有实现再修改，不要重写现有队列、OCR、AI 评估和权限逻辑。
- 复用 \`resume_processing_jobs\`、Cloudflare Queue、现有历史批次协调器和 \`getOwnerName\`。
- 新增 D1 migration，并同步更新 \`worker/schema.sql\`。
- \`POST /api/resumes/batch-reprocess\` 新 UI 使用 \`{ scope: 'all' }\` 或 \`{ scope: 'incomplete_or_failed' }\`；保留旧 \`{ ids }\` 兼容能力。
- 新增活动批次和指定批次查询接口，并让普通和优化简历列表接口都返回评估任务状态字段。
- 队列消费者必须把 job 的领取、步骤、完成、最终失败状态幂等地同步到批次明细。
- 保持用户可见范围校验；其他用户不能通过 batch ID 读取批次进度或失败候选人。
- 不清除 \`status\`、\`stage\`、\`hr_review\`、面试记录、原始简历文本、OCR 数据或人工流程数据。
- 不要把旧的选择依赖重新引入 AI 工具菜单；勾选简历只继续影响入库、淘汰、删除等业务批量操作。
- 不要把进度只放在 React state；D1 批次明细和任务表必须是进度真相源。

## 明确禁止

- 不要修改根目录未跟踪的 \`package-lock.json\`。
- 不要执行 \`git reset --hard\`、\`git checkout --\` 或删除用户文件。
- 不要创建分支或 worktree。
- 不要提交 commit、push GitHub、创建 PR 或部署 Cloudflare 生产环境；这些动作必须等用户单独明确授权。
- 不要手动修改生产 D1 或 secrets。
- 不要用 SSE/WebSocket 扩大范围。
- 不要新增独立失败重试按钮；用户再次执行“重评未评估/失败简历”即可重试。

## 验证要求

至少运行并报告以下命令的真实输出结果：

\`\`\`bash
cd frontend
npm test -- --reporter=dot
npx tsc -b
npm run build

cd ../worker
npm test -- --run
npx tsc --noEmit
\`\`\`

完成后运行：

\`\`\`bash
git diff --check
git status --short
git diff --stat
\`\`\`

最终回复必须包含：

1. 改了哪些文件以及每组改动的目的；
2. migration 文件名；
3. 测试、类型检查、构建的真实结果；
4. 是否存在未解决问题；
5. 明确说明没有部署生产、没有推送 GitHub、没有提交 commit。

如果遇到真正阻塞实现的接口或数据问题，先说明具体错误、已检查的文件和不修改生产的替代方案；不要擅自扩大范围。
