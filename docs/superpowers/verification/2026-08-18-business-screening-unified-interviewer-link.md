# 业务筛选负责人统一链接与岗位筛选验证记录

日期：2026-08-18

## 本次验证范围

- 同一负责人跨多个岗位推送时复用同一个业务筛选链接。
- 同一负责人重复推送、批次重发时复用同一个业务筛选链接。
- 已过期但未撤销的 canonical 批次再次推送/重发时保留原链接，并从当前时间刷新 30 天有效期。
- 飞书消息展示该负责人统一工作台的当前待处理总数。
- 公开业务筛选页支持岗位复选筛选，显示各岗位待处理数/总数，并保留已处理候选人状态。
- 现有不同负责人隔离、业务筛选回调和旧版无 scope 批次重发行为保持不变。

## 验证结果

### Worker

命令：

```text
cd worker && npm test -- --run
```

结果：通过，71 个测试文件、558 项测试通过。

重点新增回归：

- 过期 canonical 负责人批次复用原 batch/token，并刷新到 2026-09-11。
- 同一负责人跨岗位重复推送使用同一 URL，飞书消息从本次新增数切换为统一批次待处理总数。
- 过期批次重发使用同一 URL，批次恢复 active，且不创建新 token。

### Frontend

命令：

```text
cd frontend && npm test -- --run
```

结果：通过，40 个测试文件、188 项测试通过。

命令：

```text
cd frontend && npm run build
```

结果：通过，TypeScript/Vite 构建完成，`_worker.js` 编译成功；公开业务筛选页面产物已包含岗位筛选逻辑。

### Cloudflare 部署预检

命令：

```text
cd worker && npx wrangler deploy --dry-run
```

结果：通过，Wrangler 4.123.0 完成 dry-run，未执行生产部署。

### 差异检查

命令：

```text
git diff --check
```

结果：通过，无空白或补丁格式错误。

## 已知基线问题

`cd worker && npx tsc --noEmit` 仍会报告仓库既有类型错误，主要集中在 `worker/src/index.ts` 的 Hono/Env 类型、旧接口类型和若干历史代码路径；`worker/src/business-screening/routes.ts` 的 `getResumeFileBytes` 两处报错在本次改动前的基线提交中也已存在。本次业务筛选新增的 canonical 查询、有效期刷新、统一消息和前端岗位筛选未产生新的独立类型错误；前端正式构建与 Worker 打包均已通过。

## 交付状态

- 本地代码实现和验证已完成。
- 未创建提交、未推送 GitHub、未执行生产部署。
- 工作区中其他已有未跟踪文件未纳入本次改动。
