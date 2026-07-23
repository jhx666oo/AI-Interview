# AI-Interview 工程改进总结

> 日期：2026-07-23 | 基于 3 份 AI 评估报告的务实改进计划 | 仅本地改动，未部署线上

## TL;DR

基于技术债评估（37 条）、事故响应（SEV-3）、性能可用性报告，制定了 3 批改进计划（实际 ~10h vs 报告建议 155h），全部完成并提交到本地 git（3 个 commit）。

## 三批改进详情

### 第一批：快赢改进（commit `25c82ff`）

| # | 改进项 | 文件 | 效果 |
|---|--------|------|------|
| 1 | 静态资源缓存 | `frontend/public/_headers` | assets 1年 immutable / 图片 1天 / html 不缓存 |
| 2 | SPA 路由回退 | `frontend/public/_redirects` | `/* → /index.html 200` |
| 3 | D1 索引优化 | `worker/schema.sql` | 新增 38 个索引覆盖所有高频查询表 |
| 4 | 飞书 token 缓存 | `worker/src/index.ts` | D1 settings 表缓存 token（110min TTL），减少重复 API 调用 |
| 5 | API 超时控制 | `worker/src/index.ts` | callAI 30s / getFeishuToken fetch 10s AbortController |
| 6 | 健康检查 | `worker/src/index.ts` | `GET /health` 端点 |

### 第二批：安全修复（commit `428fb9f`）

| # | 改进项 | 文件 | 安全影响 |
|---|--------|------|----------|
| 1 | 移除明文密码存储 | `worker/src/index.ts` + `lib/db.ts` | 密码不再以明文持久化到 DB |
| 2 | timing-safe 密码比较 | `worker/src/index.ts` | 防止时序侧信道攻击 |
| 3 | CORS 白名单 | `worker/src/index.ts` | 从 `*` 改为 4 个可信域名，9 处文件下载端点同步 |
| 4 | DOMPurify 防 XSS | `frontend/src/pages/Resumes/List.tsx` | 邮件预览 HTML 内容经净化 |
| 5 | 文档重写 | `CONTRIBUTING.md` + `SECURITY.md` | 从 FastAPI/PostgreSQL 改为 Workers/D1/Vite 实际栈 |

### 第三批：性能优化（commit `d073f3a`）

| # | 改进项 | 文件 | 性能影响 |
|---|--------|------|----------|
| 1 | Dashboard N+1 修复（3处） | `worker/src/index.ts` | funnel: 5→1 查询；positions: N*7→7 查询；interviewers: N*3→1 查询 |
| 2 | login-bg.jpg 压缩 | `frontend/public/login-bg.jpg` | 755K → 194K（74% 减少） |
| 3 | Vite chunk 拆分 | `frontend/vite.config.ts` | react-core(99KB) / antd(1.4MB) / xlsx(429KB) 独立缓存 |
| 4 | 面试列表分页 | `worker/src/index.ts` | 可选 `?page=1&pageSize=20`，向后兼容 |

## 验证结果

- ✅ Worker 编译成功（esbuild Node API）
- ✅ TypeScript 类型检查通过（`tsc --noEmit` 无报错）
- ✅ `/health` 端点正常返回
- ✅ 登录链路正常（JWT 签发 + 验证）
- ✅ CORS 白名单：合法来源返回 ACAO，非法来源拒绝
- ✅ Dashboard 各端点正常（funnel/interviewers/positions）
- ✅ 面试列表分页：传参返回 `{items,total,page,pageSize}`，不传返回数组（向后兼容）
- ✅ Vite 构建：chunk 正确拆分，无报错

## 修改文件清单

```
worker/src/index.ts          — N+1修复/CORS白名单/timing-safe/明文密码移除/token缓存/超时/健康检查/分页
worker/src/lib/db.ts         — serializeUser 移除 plain_password
worker/schema.sql            — 38 个 D1 索引
frontend/vite.config.ts      — manualChunks 优化
frontend/public/_headers     — 静态资源缓存规则（新建）
frontend/public/_redirects   — SPA 路由回退（新建）
frontend/public/login-bg.jpg — 压缩 755K→194K
frontend/src/pages/Resumes/List.tsx — DOMPurify XSS 防护
frontend/src/pages/Settings/Users.tsx — 密码列不再显示明文
frontend/package.json        — 新增 dompurify 依赖
CONTRIBUTING.md              — 重写为 Workers/D1 技术栈
SECURITY.md                  — 重写安全策略
```

## 未完成项（后续可做）

| 项目 | 原因 | 建议 |
|------|------|------|
| SECRET_KEY 迁移到 wrangler secret | 属于部署操作，用户要求不动线上 | 部署时执行 `wrangler secret put` |
| 简历列表服务端分页 | 简历数据来自飞书 Bitable API，分页需改 Bitable 调用层 | 评估 bitableListRecords 是否支持分页参数 |
| 升级 xlsx 依赖 | 需要检查 breaking changes | 单独评估版本兼容性 |
| 请求超时分级 | 不同接口应有不同超时（如文件上传更长） | 设计超时策略后实施 |

## 下一步建议

1. **本地测试**：启动前后端，在各页面操作验证功能无回归
2. **部署准备**：确认 `[ai]` binding 取消注释、`wrangler secret` 配置密钥后部署
3. **前端分页接入**：面试列表页面前端改用 `?page=1&pageSize=20` 获取分页数据
4. **监控**：部署后观察 `/health` 和 Dashboard 响应时间
