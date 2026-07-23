# Contributing

感谢你愿意参与 AI Interview。本项目是一个基于 Cloudflare Workers + D1 + React 的 AI 智能面试管理系统。

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | Vite + React 19 + Ant Design + Tailwind CSS |
| 后端 | Cloudflare Workers (Hono 框架) + TypeScript |
| 数据库 | Cloudflare D1 (SQLite) |
| AI | DeepSeek API (通过环境变量配置) |
| 集成 | 飞书 Bitable / OAuth |
| 部署 | Cloudflare Pages |

## 开发环境搭建

### 前置要求

- Node.js 22+
- npm 或 pnpm
- Cloudflare 账号（用于 wrangler CLI）

### 1. 克隆并安装依赖

```bash
git clone <repo-url>
cd ai-interview

# 前端依赖
cd frontend && npm install

# Worker 依赖（esbuild 用于本地编译）
cd ../worker && npm install
```

### 2. 配置环境变量

```bash
# 前端
cp frontend/.env.example frontend/.env  # 如有

# Worker 本地开发变量
cp frontend/.dev.vars.example frontend/.dev.vars
# 编辑 .dev.vars 填入：
#   SECRET_KEY=<你的密钥>
#   FEISHU_APP_ID=<飞书应用ID>
#   FEISHU_APP_SECRET=<飞书应用密钥>
#   AI_API_KEY=<DeepSeek API Key>
#   AI_BASE_URL=https://api.deepseek.com
```

### 3. 初始化本地 D1 数据库

```bash
cd frontend
npx wrangler d1 execute ai-interview-db --local --file=../worker/schema.sql
```

### 4. 启动本地开发

```bash
# 编译 Worker（esbuild Node API，沙箱兼容）
cd /path/to/ai-interview
node -e "const e=require('./worker/node_modules/esbuild'); e.build({entryPoints:['worker/src/index.ts'],bundle:true,outfile:'frontend/dist/_worker.js',format:'esm',platform:'browser',target:'es2021',minify:true,external:['__STATIC_CONTENT_MANIFEST']})"

# 构建前端静态资源
cd frontend && npm run build

# 重编 Worker（npm run build 会清空 dist，需重新编译）
cd .. && node -e "const e=require('./worker/node_modules/esbuild'); e.build({entryPoints:['worker/src/index.ts'],bundle:true,outfile:'frontend/dist/_worker.js',format:'esm',platform:'browser',target:'es2021',minify:true,external:['__STATIC_CONTENT_MANIFEST']})"

# 启动本地后端（端口 8000）
cd frontend && npx wrangler pages dev dist --port 8000

# 另开终端启动前端 dev server（端口 5173）
cd frontend && npm run dev
```

> **注意**：本地开发时需注释 `frontend/wrangler.toml` 中的 `[ai]` binding，否则 wrangler 远程 AI 会话认证会失败。生产部署时取消注释。

### 5. 部署到生产

```bash
# 1. 取消注释 wrangler.toml 中的 [ai] binding
# 2. 清缓存重建
cd frontend && rm -rf dist node_modules/.vite && npm run build
# 3. 重编 Worker
cd .. && node -e "const e=require('./worker/node_modules/esbuild'); e.build({entryPoints:['worker/src/index.ts'],bundle:true,outfile:'frontend/dist/_worker.js',format:'esm',platform:'browser',target:'es2021',minify:true,external:['__STATIC_CONTENT_MANIFEST']})"
# 4. 部署
cd frontend && CLOUDFLARE_ACCOUNT_ID=<your-account-id> npx wrangler pages deploy dist
```

## 代码约定

### 后端 (Worker)

- **框架**：Hono（轻量 Web 框架，运行于 Cloudflare Workers）
- **入口**：`worker/src/index.ts`（当前为单体文件，计划拆分到 `routes/` + `lib/`）
- **数据库**：D1 (SQLite)，schema 定义在 `worker/schema.sql`
- 新增数据库字段需在 `schema.sql` 末尾追加 ALTER 语句，并通过 `wrangler d1 execute --remote` 执行远程迁移
- 所有外部 API 调用必须设置 AbortController 超时
- 密码使用 HMAC-SHA256 哈希，比较时使用 timing-safe 方式
- **不存储明文密码**：`plain_password` 列仅用于旧数据兼容，新代码不读写

### 前端

- **UI 库**：Ant Design + Tailwind CSS
- **状态管理**：React Context（AuthContext、OwnerContext）
- **请求封装**：`src/utils/request.ts`（基于 fetch，自动注入 JWT）
- 渲染用户输入或 AI 生成内容时，使用 DOMPurify 净化 HTML
- 新增页面放在 `src/pages/` 下，路由配置在 `src/router/`

### 通用

- 不提交 `.dev.vars`、`.env`、`node_modules`、`dist`、`.wrangler` 目录
- 不在代码中硬编码密钥（SECRET_KEY、FEISHU_APP_SECRET、AI_API_KEY 等），使用环境变量
- 提交前确保 `npm run build`（前端）和 Worker 编译无报错

## Pull Request 建议

- 清楚描述问题、方案和验证方式
- UI 改动尽量附截图
- 涉及招聘状态流转、权限、AI 调用、邮件发送的改动，请说明边界情况
- 数据库变更需附迁移 SQL

## Issue 建议

提交 Bug 时请包含：

- 版本或提交号
- 复现步骤
- 期望结果和实际结果
- 浏览器控制台或网络请求截图
