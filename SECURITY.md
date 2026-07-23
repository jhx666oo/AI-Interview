# Security Policy

## 支持范围

当前主分支会接收安全修复。正式发布版本后，建议以 GitHub Release 标记受支持版本。

## 报告安全问题

请不要在公开 Issue 中披露可利用漏洞。可以通过仓库维护者公开的安全联系方式报告，并尽量包含：

- 影响范围
- 复现步骤
- 相关日志或请求样例
- 可能的修复建议

## 部署安全清单

### 密钥管理

- **SECRET_KEY**：使用强随机值（≥32 字节），通过 `wrangler secret put SECRET_KEY` 设置，不写入代码或配置文件
- **FEISHU_APP_SECRET**：同上，通过 wrangler secret 管理
- **AI_API_KEY**（DeepSeek）：同上，通过 wrangler secret 管理
- 本地开发使用 `frontend/.dev.vars`，**不提交到 Git**（已在 .gitignore 中）
- 生产环境禁止使用默认密码 `123456`，首次部署后立即修改管理员密码

### 密码存储

- 密码使用 HMAC-SHA256 哈希存储，**不保存明文**
- 密码比较使用 timing-safe 方式（常量时间比较），防止时序侧信道攻击
- 用户创建/重置密码时，明文密码仅一次性返回给管理员，不持久化到数据库

### CORS 配置

- 生产环境仅允许 `https://ai-interview-88r.pages.dev` 域名
- 本地开发允许 `localhost:5173`、`localhost:4173`、`localhost:8000`
- 禁止使用 `Access-Control-Allow-Origin: *`

### XSS 防护

- 前端渲染用户输入或 AI 生成的 HTML 内容时，必须使用 DOMPurify 净化
- 谨慎使用 `dangerouslySetInnerHTML`，使用前确保内容已过 DOMPurify.sanitize()

### 数据库安全

- D1 数据库使用 Cloudflare 托管，无需自建数据库账号
- 敏感数据（简历、面试评价、Offer 信息）设置合理的访问权限
- 定期清理过期的简历 PDF 缓存（`/api/resumes/cleanup-pdfs`）

### API 安全

- 所有需认证的接口使用 JWT Bearer Token
- AI API 调用设置 30 秒超时（AbortController）
- 飞书 API 调用设置 10 秒超时
- 飞书 tenant_access_token 缓存在 D1 中（110 分钟 TTL），减少重复请求

### 文件上传安全

- 对上传文件进行容量、类型限制
- 简历 PDF 通过飞书 Drive API 代理下载，不直接暴露飞书 token

### HTTPS

- Cloudflare Pages 默认提供 HTTPS
- 确保所有外部 API 调用使用 HTTPS

## 已知限制

- 当前未实现完整的审计日志（计划中）
- 当前无自动化测试覆盖（计划中）
- Worker 为单体文件（6900+ 行），计划拆分为 routes/ + lib/ 模块
