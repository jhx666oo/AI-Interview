# CI/CD 自动部署设计

## 目标

让仓库在推送到 `main` 时自动完成前端 Pages、内置 Pages Worker 和简历 Queue consumer 的生产部署；Pull Request 和其他分支只执行验证，不触碰生产。

## 当前上下文

- `.github/workflows/ci.yml` 已执行 Python 后端测试和前端构建，但没有执行 `worker` 测试或上线前自检。
- `.github/workflows/deploy.yml` 已能部署 `ai-interview` Pages 和 `resume-consumer`，但 Cloudflare account ID 硬编码，且缺少构建产物自检和部署后健康检查。
- GitHub Actions 已配置 `CLOUDFLARE_API_TOKEN`；账号 ID 作为非敏感仓库变量 `CLOUDFLARE_ACCOUNT_ID` 管理。

## 设计

### CI

保留 `push` 和 `pull_request` 触发。增加独立的 Worker job：安装 `worker/package-lock.json` 依赖并运行 `npm test`。前端 job 在构建后从仓库根目录运行 `node scripts/pre-deploy-check.mjs`，确保构建产物、路由标记、密钥扫描和旧域名扫描通过。

### 生产部署

`deploy.yml` 只响应 `main` 推送和手动触发。Pages job 构建一次前端产物，运行同一套上线前自检，然后部署 `ai-interview` Pages。Queue job 独立安装 Worker 依赖并部署 `worker/wrangler.resume-consumer.toml`。两个 job 均使用 `secrets.CLOUDFLARE_API_TOKEN` 与 `vars.CLOUDFLARE_ACCOUNT_ID`。

部署完成后，Pages job 使用 `curl --fail` 检查 `https://ai-interview-88r.pages.dev/health`，健康检查失败则让工作流失败，便于发现错误账号、错误项目或产物未生效。

### 安全与回滚

- Pull Request 不执行生产部署。
- API token 保持在 GitHub Actions Secret，不写入 YAML。
- 账号 ID 不属于敏感凭据，放在 Repository Variable，修改账号时无需改代码。
- 回滚通过重新运行目标历史 `main` 提交的部署 workflow 完成；不自动执行数据库迁移或生产数据修改。

## 验证标准

- CI 在 Worker、前端构建和上线前自检任一失败时阻止合并/发布。
- 推送到 `main` 时 Pages 和 Queue consumer 两个部署 job 均执行。
- 部署后 `/health` 返回 HTTP 200。
- 现有定时任务 workflow 保持不变。
