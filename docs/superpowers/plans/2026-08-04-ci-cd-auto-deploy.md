# CI/CD 自动部署实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended) or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 完善 GitHub Actions，使 `main` 自动部署 Pages 与简历 Queue consumer，并让 CI 在部署前验证 Worker、前端构建和上线自检。

**Architecture:** 保留现有 Pages 与 consumer 两个部署 job；把账号 ID 从 workflow 硬编码移到 GitHub Repository Variable；CI 与生产部署共用前端构建和 `pre-deploy-check`；部署完成后请求生产 `/health` 做冒烟验证。Pull Request 和非 `main` 分支只运行 CI。

**Tech Stack:** GitHub Actions、Node.js 20、npm ci、Vitest、Vite、Cloudflare Wrangler Action v3。

## Global Constraints

- 不在 workflow 中写入 API token、账号密钥或其他敏感信息。
- 生产部署只允许 `main` push 或 `workflow_dispatch`。
- Queue consumer 使用 `worker/wrangler.resume-consumer.toml` 单独部署。
- 不执行生产 D1 migration，不自动修改业务数据。
- 保留现有定时任务 workflow。
- 不覆盖现有的简历入库修复。

---

### Task 1: 补齐 CI 验证

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: 增加 Worker 测试 job**

新增 `worker` job，使用 Node.js 20，在 `worker` 目录运行 `npm ci` 与 `npm test`。

- [ ] **Step 2: 增加前端部署前自检**

在前端构建完成后，从仓库根目录执行：

```bash
node scripts/pre-deploy-check.mjs
```

- [ ] **Step 3: 验证 YAML 与本地命令**

运行：

```bash
cd worker && npm test
cd ../frontend && npm run build
cd .. && node scripts/pre-deploy-check.mjs
```

预期：Worker 测试全部通过、前端构建退出码为 0、自检失败数为 0。

### Task 2: 完善生产部署 workflow

**Files:**
- Modify: `.github/workflows/deploy.yml`

- [ ] **Step 1: 使用 Repository Variable 管理账号 ID**

将 `accountId: ed758fc82ca4400593ddb447d3db57a4` 改为：

```yaml
accountId: ${{ vars.CLOUDFLARE_ACCOUNT_ID }}
```

- [ ] **Step 2: 在 Pages job 中加入构建和自检**

构建后执行 `node scripts/pre-deploy-check.mjs`，再部署 `ai-interview` Pages。保留现有 consumer job。

- [ ] **Step 3: 增加部署后健康检查**

Pages 部署成功后执行：

```bash
curl --fail --retry 3 --retry-delay 5 https://ai-interview-88r.pages.dev/health
```

- [ ] **Step 4: 增加并发控制**

同一 workflow 使用 `concurrency`，取消同一分支正在运行的旧部署，避免旧提交覆盖新提交。

### Task 3: 配置 GitHub Repository Variable

**External configuration:** GitHub repository `jhx666oo/AI-Interview`。

- [ ] **Step 1: 写入非敏感账号变量**

设置 `CLOUDFLARE_ACCOUNT_ID=ed758fc82ca4400593ddb447d3db57a4`。保留现有 `CLOUDFLARE_API_TOKEN` Secret，不读取或输出其值。

- [ ] **Step 2: 核对 Secret 名称**

确认 `CLOUDFLARE_API_TOKEN` 已存在；缺失时只报告，不生成或猜测 token。

### Task 4: 端到端验证与提交

- [ ] **Step 1: 检查 workflow 文件格式和 diff**

运行 `git diff --check`，确认 workflow 只使用已有 secret/variable 名称。

- [ ] **Step 2: 运行完整本地验证**

运行 Worker 测试、前端构建和 `node scripts/pre-deploy-check.mjs`。

- [ ] **Step 3: 提交配置变更**

```bash
git add .github/workflows/ci.yml .github/workflows/deploy.yml worker/src/index.ts worker/tests/resume-approval.test.ts
git commit -m "ci: automate pages and resume consumer deployment"
```

- [ ] **Step 4: 推送并观察 workflow**

推送分支并创建/合并到 `main` 后，使用 `gh run list --workflow deploy.yml` 查看 Pages、consumer、health check 三个阶段的结果。未经用户明确要求，不直接执行生产部署。
