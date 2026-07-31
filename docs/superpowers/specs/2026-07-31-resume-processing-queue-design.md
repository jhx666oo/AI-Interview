# 简历 AI 处理队列化设计

## 目标

将简历字段提取、MinerU OCR 与 AI 初筛从浏览器页面和 Pages 请求生命周期中移出。上传一批简历后，处理必须持续运行；刷新、关闭或离开页面不得造成任务丢失、重复评估或状态停滞。

本次只改造简历 AI 处理链路，不改岗位、面试、飞书数据模型，也不迁移现有历史结果。

## 成功标准

- 每份简历以 `resume.id` 为唯一处理对象；同名候选人不会互相更新。
- 上传接口在创建 D1 记录并成功入队后立即返回，不调用 MinerU 或 AI。
- 文本型和扫描型 PDF 最终均走同一后半段：字段提取后再进行 AI 初筛。
- 每份简历在任意时刻最多有一个活动任务；刷新页面不会重复投递。
- 一次提交数十份简历时，队列缓冲任务，AI 与 OCR 以受控并发消费。
- 飞书回写失败不会阻断 D1 中的 AI 结果；可单独重试。

## 架构

```text
React 页面
  │ 上传、查询任务状态
  ▼
Pages API（生产者）
  │ D1: resumes + resume_processing_jobs
  │ Queue: resume-processing
  ▼
Cloudflare Queue
  ▼
Resume Consumer Worker（消费者）
  │ 1. 文本获取 / MinerU OCR
  │ 2. 字段提取
  │ 3. AI 初筛
  │ 4. D1 写入结果
  └─► Queue: resume-feishu-sync（独立、可重试）
```

Pages API 只配置 Queue producer binding。Queue consumer 是独立 Worker，拥有 D1、AI、MinerU 和飞书所需 bindings/secrets。

## 数据模型

新增 `resume_processing_jobs`：

| 字段 | 含义 |
|---|---|
| `id` | UUID，任务标识 |
| `resume_id` | 简历 ID；活动任务的唯一键 |
| `status` | `queued`、`running`、`completed`、`failed`、`cancelled` |
| `step` | `extracting_text`、`extracting_fields`、`screening`、`syncing_feishu` |
| `attempt_count` | 消费尝试次数 |
| `error_code` / `error_message` | 可展示、可诊断的失败信息 |
| `created_at` / `started_at` / `completed_at` / `updated_at` | 生命周期时间戳 |
| `version` | 乐观锁版本，防止重复消费者覆盖 |

约束：同一 `resume_id` 在 `queued` 或 `running` 状态最多一条记录。所有业务写入使用 `resume.id`，禁止按 `candidate_name` 查找或更新。

`resumes.parse_status` 保留为兼容展示字段，并映射为：

| 任务状态 | `parse_status` |
|---|---|
| 排队 | `queued` |
| 文本 / OCR 提取中 | `extracting_text` |
| 字段提取中 | `extracting_fields` |
| AI 初筛中 | `screening` |
| 完成 | `ai_screened` |
| 失败 | `failed` |

## 处理流程

### 上传

1. Pages API 验证 PDF，创建 `resumes` 与 `resume_files` D1 记录。
2. 创建任务记录，状态为 `queued`，并以 `resume.id` 投递 `resume-processing`。
3. Queue 写入成功后立即返回 `202` 与 `resume_id`、`job_id`、`parse_status=queued`。
4. 飞书创建/回写不在请求关键路径；失败记录同步任务或错误，不回滚简历任务。

### Consumer

每条 Queue 消息先以条件更新领取任务；若任务已完成、被取消或已由其他消费者领取，则确认消息并退出。

1. **文本获取**：优先 `ocr_markdown`，再 `raw_text`；两者均不足时，读取 `resume_files`，调用 MinerU 并轮询结果，写 `ocr_markdown`。
2. **字段提取**：调用唯一的 `extractResumeFields(resumeId, text)` 服务，写 `parsed_data` 和可查询字段。
3. **AI 初筛**：调用唯一的 `screenResume(resumeId, text, parsedData, positionContext)` 服务，写 `ai_review`、`ai_evaluation`、`match_score`、`screening_result`。
4. **完成**：在同一 D1 更新中将 job 标记为 `completed`、简历标记为 `ai_screened`；随后投递飞书同步消息。

各步骤必须幂等：已写入 OCR/字段/评估结果时，重试从下一个未完成步骤继续，不重复消耗 AI 额度。

## 并发、重试与错误

- Queue consumer 从 `max_concurrency = 3` 起步；上线后依据 DeepSeek 与 MinerU 限流逐步调整至 5。
- 消费者每次处理一份简历，避免单个慢 OCR 阻塞一批消息。
- MinerU、AI、飞书使用不同错误码：`OCR_*`、`FIELDS_*`、`SCREENING_*`、`FEISHU_*`。
- OCR 与 AI 失败使用 Queue 重试和指数退避；达到上限后进入 DLQ，并将 job 标记为 `failed`。
- 飞书同步独立消费；失败不改变 `ai_screened`，仅保留 `feishu_sync_status=failed` 和错误信息。
- 不使用 `waitUntil` 承载 OCR 或 AI 主任务。

## 前端契约

- 上传完成后立即把返回的简历插入列表，并显示 `queued`。
- 页面只轮询存在活动状态的简历；轮询 API 只读 D1。
- 禁止列表加载自动调用 `auto-evaluate-all`、`batch-auto-screen` 或其它评估接口。
- 详情页显示当前步骤、失败原因与“重试任务”按钮；重试创建新任务或安全恢复失败任务，不直接重复调用 AI。
- 旧“单条初筛”“批量初筛”入口先路由到统一的任务创建接口，旧实现确认无调用后删除。

## 验证

1. 上传可文本提取 PDF：任务依次通过字段提取、初筛并完成。
2. 上传扫描 PDF：Consumer 完成 MinerU 后继续字段提取和初筛。
3. 同名候选人各上传一份：两份结果只写回自己的 `resume.id`。
4. 上传后刷新、关闭页面再打开：任务继续，状态可恢复。
5. 同时上传 20 份：任务均入队，Consumer 并发不超过配置值，无重复 job。
6. 模拟 DeepSeek、MinerU、飞书分别失败：主任务失败/重试或飞书待同步的状态符合设计。

## 非本次范围

- 将 PDF 从 D1 base64 迁移到 R2。
- 历史 `resumes` 数据的批量重处理。
- 岗位、面试或飞书表字段重构。
- 以 Cloudflare Workflows 替换 Queue Consumer。
