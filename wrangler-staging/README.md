# Staging 环境配置

## 前置步骤

```bash
# 1. 创建 staging D1 数据库
npx wrangler d1 create ai-interview-db-staging

# 2. 创建 staging R2 bucket
npx wrangler r2 bucket create ai-interview-resume-artifacts-staging

# 3. 获取 database_id（从第1步的输出中复制）
```

## 配置

复制以下文件替换原配置，把 `YOUR_STAGING_D1_ID` 替换为实际的 database_id：

```bash
# 替换 wrangler 配置
cp wrangler-staging/frontend.wrangler.jsonc frontend/wrangler.jsonc
cp wrangler-staging/worker.wrangler.jsonc worker/wrangler.jsonc
cp wrangler-staging/worker.wrangler.resume-consumer.jsonc worker/wrangler.resume-consumer.jsonc
```

## 部署

```bash
# 构建前端
cd frontend && npm run build && cd ..

# 部署到 staging 项目
npx wrangler pages deploy frontend/dist \
  --project-name ai-interview-staging
```

## 开启 Feature Flag

在 Cloudflare Dashboard → staging 项目 → 环境变量中添加：

```
R2_ARTIFACT_WRITE=true
R2_ARTIFACT_READ=true
DIRECT_R2_UPLOAD=true
RESUME_SQL_LIST=true
RECRUITMENT_EVENTS=true
RESUME_HYBRID_SEARCH=true
```

## 测试完成后

在 Dashboard 中删除这些环境变量（或设为 false），然后将 wrangler.jsonc 恢复为生产配置。
