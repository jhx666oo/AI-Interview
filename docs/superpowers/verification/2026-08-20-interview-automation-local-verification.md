# 面试自动化闭环本地验证证据

日期：2026-08-20
分支：`codex/interview-automation-closed-loop`

## 已通过

| 范围 | 命令 | 结果 |
|---|---|---|
| 前端 | `cd frontend && npm test -- --run --reporter=dot` | 43 个测试文件、198 个测试通过 |
| 前端构建 | `cd frontend && npm run build` | TypeScript、Vite、`_worker.js` 编译通过 |
| Worker | `cd worker && npm test -- --run --reporter=dot` | 85 个测试文件、679 个测试通过 |
| Queue consumer | `cd worker && npx esbuild src/interview-automation-consumer.ts --bundle --format=esm --outfile=/tmp/interview-automation-consumer.js` | 独立消费者 bundle 通过 |

## 已知提示与边界

- 前端测试会输出 jsdom 对 pseudo-element `getComputedStyle` 的既有提示，以及 Ant Design `Space.direction` 弃用提示；均未导致测试失败。
- Worker 全量测试通过；Worker 仓库仍有历史 TypeScript 类型告警，集中在既有 `index.ts` 的 Hono 上下文和旧接口兼容代码，不是本次自动化模块新增错误。自动化路由、repository、consumer、通知、日历和推进模块均已通过构建/定向测试覆盖。
- 尚未连接真实飞书、SMTP、Cloudflare Queue，也未执行远程 D1 migration；生产开关保持关闭。
- 生产前必须补做：历史面试数据审计、预览环境真实通知验收、重试/部分失败演练、浏览器矩阵和灰度观察。

## 当前防护配置

- API Worker：`INTERVIEW_AUTOMATION_ENABLED = "false"`。
- 岗位字段：`auto_business_screening_enabled = 0`（migration 默认值）。
- 招聘日历：未配置 `FEISHU_RECRUITMENT_CALENDAR_ID` 时，自动排期不会回退到 `primary` 日历。
