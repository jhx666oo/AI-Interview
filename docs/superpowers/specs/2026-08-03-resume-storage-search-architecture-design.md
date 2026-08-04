# 简历存储、全文检索与长期数据架构设计

> 日期：2026-08-03  
> 状态：待用户评审  
> 适用项目：AI Interview（React/Vite + Cloudflare Pages/Workers + D1 + Queues）

## 1. 背景与结论

当前项目已经具备异步简历处理链路，但简历原文件、OCR 正文和 AI 长文本仍大量存放在 D1：

- PDF 在 `resume_files.content` 中以 Base64 保存。
- OCR 正文存放在 `resumes.ocr_markdown`、`resumes.raw_text`、`resumes.resume_markdown`。
- AI 完整结果存放在 `resumes.ai_review`、`resumes.ai_evaluation`。
- `GET /api/resumes` 会读取全部简历及上述长文本，再在 Worker 内存中筛选和分页。
- Queue Consumer、补解析接口、岗位排名、面试报告等多条旧链路直接读取 D1 长文本。
- 非管理员权限目前主要按“岗位负责人姓名”推导，尚无稳定的租户与数据所有者 ID。

这套结构可以支撑测试阶段，但不适合长期保存 OCR、每天批量入库以及几十人并发使用。问题不在 React 是否为静态页面，也不在 Cloudflare Worker 是否“动态”，而在于长文本、业务数据、搜索索引和统计事件没有分层。

本设计确定以下目标架构：

1. **R2 是简历文件与长文本真相源**：PDF、OCR、AI 完整分析和面试长报告存入私有 R2。
2. **D1 是当前阶段的结构化业务库**：保存候选人字段、分数、状态、对象引用、权限和事件，不保存 PDF Base64。
3. **AI Search 是第一阶段全文检索实现**：直接索引 R2 中派生的搜索文档，支持中文关键词和语义搜索。
4. **搜索服务必须可替换**：业务代码只依赖 `ResumeSearchService`，避免被 AI Search Beta 状态或未来价格锁死。
5. **PDF 默认保留 60 天**；OCR、AI 完整结果、面试结果和招聘过程数据长期留存，直到执行业务删除或后续合规留存策略。
6. **岗位转化率由不可变事件计算**，不把一个会不断被覆盖的百分比当作历史真相。
7. **迁移采用双写、校验、切读、清理**，不一次性删除现有 D1 数据。

## 2. 目标与非目标

### 2.1 目标

- 上传后立即生成简历记录并入队，关闭页面不影响 OCR、字段提取和 AI 初筛。
- 一次上传几十份简历时，文件存储和搜索索引不阻塞前端请求。
- 支持搜索“护士资格证”“SQL”“社区运营”等精确关键词。
- 支持搜索“有大型线下活动经验的人”“适合用户运营岗位的候选人”等语义描述。
- 搜索结果继续支持岗位、负责人、日期、学历、年龄、性别、AI 分数等结构化过滤。
- PDF 到期删除后，候选人卡片、OCR、AI 分析、面试结果和统计数据仍可使用。
- 删除候选人时，D1、R2、搜索索引和处理任务最终保持一致。
- 当前每天约 500 份简历时低成本运行，并为未来每天数千到上万份预留迁移边界。

### 2.2 非目标

- 本次不把前端迁移到 Next.js，也不以 SSR 为目标。
- 本次不立即将全部结构化数据迁移到 PostgreSQL。
- 第一阶段不提供“向所有简历提问并生成回答”的聊天功能。
- 搜索结果只帮助定位候选人，不直接自动录用或自动淘汰。
- 本次不把飞书改成业务真相源；飞书继续作为协作与结果镜像层。

## 3. 方案比较与选型

### 3.1 方案 A：D1 FTS5

在 D1 中建立 FTS5 虚拟表，中文使用 trigram 分词。

优点：

- 组件最少，开发和调试直接。
- 精确关键词搜索效果可控。
- 不依赖新的外部服务。

缺点：

- 搜索索引会重复占用 OCR 文本空间，trigram 索引增长尤其明显。
- 单个 D1 数据库存在 10GB 上限，不适合长期存放大规模全文索引。
- 只解决关键词搜索，无法自然处理同义词和语义描述。
- D1 导出含 FTS 虚拟表时存在额外处理要求。

结论：可作为本地测试或故障降级，不作为长期主搜索方案。

### 3.2 方案 B：Cloudflare AI Search + R2（推荐第一阶段）

将专门生成的 Markdown 搜索文档写入 R2，由 AI Search 建立关键词、BM25 和向量索引。

优点：

- 不需要在 Worker 内存中扫描 OCR。
- 与 R2 和 Workers 集成简单。
- 同时支持关键词和语义搜索。
- 当前开放测试期内，限额内索引与搜索不单独收费。
- 不需要维护搜索服务器、分词插件、备份和集群。

缺点：

- 当前属于开放测试期，未来正式价格尚未公布。
- 混合搜索单实例当前最多 50 万文件，需要提前设计分片。
- 自定义元数据字段数量有限，权限不能只依赖搜索服务过滤。
- R2 自动同步存在最终一致延迟，新简历不能保证上传后立即全文可搜。

结论：最适合当前规模，但必须通过接口隔离、D1 二次鉴权和可替换实现控制风险。

### 3.3 方案 C：自建 OpenSearch、Meilisearch 或 Typesense

在 Azure VM 或其他服务器上运行独立搜索服务。

优点：

- 搜索能力、索引结构和数据规模完全可控。
- 可按业务需要配置中文分词、同义词、排序和高亮。

缺点：

- 搜索索引常驻占用内存和磁盘，学生服务器容易成为单点故障。
- 需要处理升级、备份、监控、扩容、数据恢复和安全补丁。
- OpenSearch 生产环境资源与运维成本明显高于当前业务规模。

结论：不在当前阶段自建。当 AI Search 容量、价格或查询能力不再合适时，再迁往托管搜索服务或 PostgreSQL/专用搜索集群。

## 4. 目标架构

```text
React 简历管理页
  │
  ├─ 上传 PDF / 查看状态 / 结构化筛选
  └─ 关键词或语义搜索
          │
          ▼
Cloudflare Pages Worker API
  ├─ Auth + 权限范围
  ├─ ResumeRepository（D1）
  ├─ ResumeArtifactRepository（R2）
  └─ ResumeSearchService（可替换接口）
          │
          ├─────────────► D1
          │               候选人字段、岗位、状态、评分、事件、对象引用
          │
          ├─────────────► R2 私有桶
          │               PDF、OCR、AI 完整结果、面试报告、搜索文档
          │
          ├─────────────► AI Search
          │               关键词 + 语义索引，只返回 resume_id 和片段
          │
          └─────────────► Cloudflare Queue
                          OCR、字段提取、AI 初筛、搜索文档刷新、清理任务
```

### 4.1 数据真相边界

| 数据 | 真相源 | 说明 |
|---|---|---|
| PDF 原文件 | R2 | 默认 60 天后生命周期删除 |
| OCR Markdown/正文 | R2 | 长期保存，D1 只留对象键、摘要和状态 |
| AI 完整分析 JSON | R2 | 长期保存；D1 保留列表和筛选需要的投影字段 |
| 面试完整报告、长评语或转写 | R2 | 长期保存；面试状态、分数和结论留在 D1 |
| 候选人结构化字段 | D1 | 姓名、电话、学历、技能、年龄、岗位等 |
| AI 卡片投影 | D1 | 总分、维度分、推荐结论、硬性规则结果 |
| 招聘流程事件 | D1 | 追加写入，不覆盖历史 |
| 仪表盘快照 | D1 | 复用当前 `dashboard_snapshots` 设计 |
| 搜索索引 | AI Search | 派生数据，可重建，不作为业务真相源 |
| 飞书记录 | 飞书 | 协作镜像；失败可重试，不阻塞主链路 |

## 5. R2 对象设计与生命周期

### 5.1 Bucket 与访问策略

新建私有 R2 Bucket，例如 `ai-interview-resume-artifacts`。禁止配置公开读取域名。所有读取必须经过带鉴权的 Worker，或由 Worker 生成短时有效的签名 URL。

建议对象键：

```text
pdf/{tenantId}/{yyyy}/{mm}/{resumeId}/source-v1.pdf
ocr/{tenantId}/{yyyy}/{mm}/{resumeId}/ocr-v1.md
ai/{tenantId}/{yyyy}/{mm}/{resumeId}/screening-v1.json
interview/{tenantId}/{yyyy}/{mm}/{resumeId}/{interviewId}/report-v1.json
search/{tenantId}/{yyyy}/{mm}/{resumeId}/document-v1.md
```

顶层前缀按数据类别排列，便于设置生命周期规则：

- `pdf/`：创建 60 天后自动删除。
- `ocr/`、`ai/`、`interview/`：不自动删除；90 天后可转为 Infrequent Access。
- `search/`：保持 Standard，保证搜索同步；候选人删除时同步删除。

若 PDF 到期，D1 中的 `pdf_status` 根据 `pdf_expires_at` 显示为 `expired`。即使生命周期删除通知延迟，页面也不再提供原 PDF 下载。OCR 与 AI 结果不受影响。

### 5.2 不覆盖对象

对象键包含版本号。重新 OCR 或重新评估时写入新版本，D1 指向当前版本。验证完成后再异步删除旧版本，避免覆盖过程中出现半成品。

### 5.3 完整性

每个对象保存：

- `sha256`
- MIME 类型
- 字节数
- 生成器版本
- 创建时间
- `resume_id`
- 数据范围或租户标识

写入成功后才更新 D1 当前版本指针。读取时发现对象不存在，返回明确的 `ARTIFACT_NOT_FOUND`，不能默认为空文本并继续 AI 评估。

## 6. D1 数据模型调整

### 6.1 `resume_artifacts`

新增通用对象引用表，避免继续给 `resumes` 增加大量长文本列：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | TEXT PK | UUID |
| `resume_id` | TEXT | 简历 ID |
| `artifact_type` | TEXT | `pdf`、`ocr`、`ai_analysis`、`interview_report`、`search_document` |
| `version` | INTEGER | 同类对象版本 |
| `object_key` | TEXT | R2 对象键 |
| `mime_type` | TEXT | 内容类型 |
| `size_bytes` | INTEGER | 字节数 |
| `sha256` | TEXT | 完整性校验 |
| `status` | TEXT | `pending`、`available`、`expired`、`deleted`、`failed` |
| `expires_at` | TEXT NULL | PDF 到期时间，长期数据为空 |
| `created_at` | TEXT | 创建时间 |
| `deleted_at` | TEXT NULL | 逻辑删除时间 |

约束与索引：

- `(resume_id, artifact_type, version)` 唯一。
- `(resume_id, artifact_type, status)` 索引。
- `expires_at` 索引，供清理核对任务使用。

### 6.2 `resume_search_state`

搜索索引是异步派生数据，需要单独记录状态：

| 字段 | 说明 |
|---|---|
| `resume_id` | 主键 |
| `document_version` | 搜索文档版本 |
| `content_hash` | 判断是否需要重建 |
| `provider` | `ai_search`、未来可为其他实现 |
| `instance_id` | 当前搜索分片 |
| `status` | `pending`、`indexing`、`indexed`、`failed`、`deleting` |
| `attempt_count` | 重试次数 |
| `error_code` / `error_message` | 诊断信息 |
| `indexed_at` / `updated_at` | 时间 |

### 6.3 `candidate_stage_events`

新增只追加、不原地修改的招聘流程事件表：

| 字段 | 说明 |
|---|---|
| `id` | UUID |
| `resume_id` | 候选简历 ID |
| `position_id` | 事件发生时对应岗位 |
| `event_type` | `resume_received`、`ai_screened`、`hr_approved`、`interview_scheduled`、`interview_passed`、`offer_sent`、`hired` 等 |
| `stage_from` / `stage_to` | 状态变化 |
| `occurred_at` | 实际发生时间 |
| `actor_user_id` | 操作者稳定 ID；系统任务使用 `system` |
| `source` | `ui`、`import`、`feishu`、`queue`、`migration` |
| `metadata` | JSON 扩展信息 |
| `created_at` | 记录写入时间 |

岗位转化率按事件时间计算。例如“7 月简历到一面转化率”必须使用 7 月事件或既定漏斗口径，而不是读取候选人今天的最终状态。

历史数据无法可靠推导每一次真实状态变化。迁移时只在存在可信时间戳时回填事件；其余数据标记 `source=migration`，不伪造精确时间。

### 6.4 `resumes` 保留字段

继续保留列表和规则引擎需要的结构化字段：

- 候选人身份和联系方式。
- `position_id`、岗位名称、负责人范围。
- 性别、生日或年龄、学历、学校、专业、技能、证书、工作年限。
- 当前阶段、审核状态、解析状态、错误码。
- AI 总分、能力维度分、推荐结果、硬性规则结果。
- 当前 OCR、AI、PDF 对象的状态摘要。

`raw_text`、`ocr_markdown`、`resume_markdown`、`ai_review`、`ai_evaluation` 在迁移期保留兼容，完成切读后不再作为主写入目标，最后置空或迁出。

## 7. 搜索文档与索引设计

### 7.1 派生搜索文档

不直接把原始 PDF 交给搜索服务。每份简历生成一份可重建的 Markdown：

```markdown
# 候选人
姓名：张三
应聘岗位：社区运营专员
学历：本科
学校：某大学
专业：市场营销
技能：社群运营、活动策划、数据分析
证书：...

## AI 标签与摘要
...

## OCR 正文
...
```

搜索文档包含：

- 规范化结构字段。
- OCR 正文。
- AI 摘要、优势、风险和能力维度名称。
- 不包含访问令牌、内部密钥、飞书凭据等系统数据。

AI 分析发生变化、岗位转移或字段人工修正时，搜索文档版本加一并重新索引。

### 7.2 AI Search 配置

第一阶段配置：

- `vector=true`
- `keyword=true`
- `fusion_method=rrf`
- `keyword_tokenizer=trigram`
- 默认最大返回 20，服务端硬上限 50。
- 关闭公共搜索端点和聊天补全入口。
- 不使用生成式回答，避免额外 LLM 成本和候选人信息泄露风险。

建议使用的五个自定义元数据：

1. `tenant_id`
2. `position_id`
3. `owner_user_id`
4. `created_at_epoch`
5. `is_active`

当前系统没有稳定的 `tenant_id` 和 `owner_user_id`，第一阶段可写默认租户，并将负责人姓名映射为过渡 owner key；后续用户与岗位数据模型必须补稳定 ID。负责人姓名只用于兼容，不能作为长期权限主键。

### 7.3 搜索服务接口

业务层只依赖以下抽象：

```ts
interface ResumeSearchService {
  search(input: ResumeSearchQuery, scope: AccessScope): Promise<SearchPage>;
  requestIndex(resumeId: string, version: number): Promise<void>;
  requestDelete(resumeId: string): Promise<void>;
  getHealth(): Promise<SearchHealth>;
}
```

AI Search、D1 FTS 或未来的 OpenSearch 都实现这一接口。前端 API 契约不随搜索提供商变化。

### 7.4 查询流程与权限

```text
GET /api/resumes/search?q=社区运营&position_id=...&page_size=20
  │
  ├─ 1. JWT 鉴权
  ├─ 2. 计算 AccessScope（租户、角色、岗位负责人）
  ├─ 3. AI Search 带元数据过滤检索
  ├─ 4. 得到 resume_id、相关度和命中片段
  ├─ 5. D1 按 ID 批量查询结构化卡片
  ├─ 6. D1 再次执行权限过滤和 deleted_at 过滤
  └─ 7. 按搜索排名返回结果
```

搜索服务元数据过滤只是性能优化，不是最终安全边界。即使搜索服务错误返回了越权 ID，D1 二次过滤也必须移除该结果。

搜索 API 返回：

- 候选人卡片结构字段。
- `resume_id`。
- 相关度。
- 命中片段和命中类型（关键词/语义）。
- `search_index_status`。

不返回完整 OCR。完整 OCR 只能通过带鉴权的详情接口按单份读取。

### 7.5 一致性与延迟

简历结构化数据完成后立即可在普通列表和字段过滤中出现。全文检索允许最终一致：

- 目标：95% 新简历在处理完成后 15 分钟内可搜。
- 页面显示“全文索引中”，不能误报为解析失败。
- 索引失败不回滚 OCR 或 AI 结果。
- 搜索服务不可用时，降级为姓名、岗位和结构化字段搜索，并显示“全文搜索暂不可用”。

## 8. 上传、处理与索引数据流

### 8.1 上传请求

浏览器上传采用两阶段直传，避免几十份 PDF 同时经过 Worker 内存：

1. `POST /api/resumes/uploads/init` 校验文件名、类型、大小、操作者和岗位权限。
2. API 创建 `resumes(parse_status=uploading)` 和 `resume_artifacts(type=pdf, status=pending)`，由服务端生成不可猜测的 R2 对象键。
3. API 返回 5～10 分钟有效的 R2 签名 PUT URL、`resume_id` 和 `upload_id`。
4. 浏览器直接 PUT 到 R2；批量上传并发控制在 3～5，单份失败不影响其他文件。
5. 浏览器调用 `POST /api/resumes/uploads/:uploadId/complete`。
6. API 用 R2 HEAD 校验对象存在、字节数、Content-Type 和预期范围，将 artifact 标记 `available`、`expires_at=+60d`。
7. 此时才创建 `resume_processing_jobs` 并投递 `resume-processing` Queue。
8. 完成接口返回 `202`、`resume_id`、`job_id`、`parse_status=queued`。

R2 CORS 只允许生产域名、受控预览域名和本地开发地址执行 PUT，并限制允许的请求头。签名 URL 的对象键由服务端固定，客户端不能借此覆盖其他候选人的文件。

如果直传成功但浏览器未调用 complete，定时清理任务在 24 小时后删除未完成对象和 `pending` artifact。若 R2 写入或 HEAD 校验失败，不创建可消费的 Queue 消息；简历记录标记 `upload_failed`，用户可以重试。

服务端对接的外部简历 API 可复用 init/complete 协议；确实无法直传的受信客户端可使用单独的流式上传接口，但不能恢复 D1 Base64 存储。

### 8.2 Queue Consumer

1. 按 `job_id` 幂等领取任务。
2. 优先从 R2 获取 PDF 或已存在 OCR。
3. 完成 OCR，将 Markdown 写入 R2，写 `resume_artifacts(type=ocr)`。
4. 从 OCR 提取字段，结构化投影写 D1。
5. 完成 AI 初筛：完整 JSON 写 R2；卡片字段和规则结果写 D1。
6. 写入 `candidate_stage_events(ai_screened)`。
7. 生成新的 `search/.../document-vN.md`。
8. 将 `resume_search_state` 标记为 `pending`，触发或等待批量索引同步。
9. 主任务完成；飞书回写继续使用独立可重试逻辑。

Queue 至少一次投递，因此每一步必须根据对象版本、哈希和任务状态保持幂等。禁止重新引入 `waitUntil` 承载 OCR、AI 或索引关键任务。

### 8.3 详情读取

新增 `ResumeTextRepository` 和 `ResumeAnalysisRepository`：

- 首选读取 R2 当前对象。
- 迁移期若对象不存在，降级读取旧 D1 列。
- 降级命中后可异步补写 R2。
- 调用方不再直接查询 `raw_text` 或 `ocr_markdown`。

当前岗位排名、重新解析、能力评分、面试报告等所有直接读取长文本的代码均需逐步改为调用 Repository。

## 9. PDF 到期与候选人删除

### 9.1 PDF 到期

- R2 生命周期在 60 天后删除 `pdf/` 对象。
- D1 保留 `expires_at`，页面按时间立即显示“原文件已过期”。
- 可通过 R2 删除事件或每日核对任务更新 artifact 状态。
- PDF 删除不删除 OCR、AI、面试和搜索文档。
- 若到期后需要重新 OCR，用户必须重新上传原文件；新 PDF 创建新版本和新的 60 天期限。

### 9.2 删除候选人

业务删除采用可恢复的两阶段方式：

1. D1 将简历标记 `deleted_at`，列表与搜索接口立即不可见。
2. 投递清理任务，删除搜索文档、OCR、AI、PDF、面试长报告和飞书镜像。
3. 搜索索引完成删除后，更新 `resume_search_state`。
4. 结构化记录根据业务要求软删除一段时间后再物理删除。

清理失败进入重试和告警，不允许前端显示删除成功后又因旧索引重新出现。D1 二次过滤保证删除即时生效。

## 10. 岗位转化率与历史数据

### 10.1 事件口径

至少记录以下事件：

```text
resume_received
ai_screened
hr_approved / hr_rejected
interview_scheduled(round)
interview_completed(round)
interview_passed(round) / interview_failed(round)
offer_sent / offer_accepted / offer_rejected
hired
candidate_withdrawn
position_transferred
```

### 10.2 转化率定义

每个指标必须在代码和仪表盘中固定分子、分母以及日期归属：

- 简历推送到安排面试：`interview_scheduled(round=1) / resume_received`
- 一面通过率：`interview_passed(round=1) / interview_completed(round=1)`
- Offer 转化率：`offer_accepted / offer_sent`
- 入职转化率：`hired / offer_accepted`

“按入库批次观察最终转化”和“按事件发生日期统计当期动作”是两种不同口径，接口必须明确 `cohort` 或 `event_time`，不能混用。

### 10.3 快照

当前招聘仪表盘已有按日快照能力。后续快照应由事件聚合生成，并保留生成版本和口径版本。这样规则调整时可以解释历史数字差异。

## 11. API 设计

### 11.1 新增接口

| 方法 | 路径 | 作用 |
|---|---|---|
| `POST` | `/api/resumes/uploads/init` | 创建上传记录并返回短时 R2 签名 PUT URL |
| `POST` | `/api/resumes/uploads/:uploadId/complete` | 校验 R2 对象并创建处理任务 |
| `GET` | `/api/resumes/search` | 关键词/语义搜索，支持结构化过滤 |
| `GET` | `/api/resumes/:id/artifacts` | 返回可见 artifact 状态，不暴露对象私有键 |
| `GET` | `/api/resumes/:id/text` | 鉴权后读取 OCR 正文 |
| `GET` | `/api/resumes/:id/analysis` | 鉴权后读取 AI 完整分析 |
| `GET` | `/api/resumes/:id/file` | 从 R2 流式读取或返回短时签名地址 |
| `POST` | `/api/resumes/:id/reindex` | 管理员或失败重试触发重新索引 |
| `GET` | `/api/admin/resume-search/health` | 索引积压、失败和提供商健康状态 |

### 11.2 列表接口必须同步改造

`GET /api/resumes` 改为真正的 SQL 分页和 SQL 过滤：

- 只选择列表卡片需要的列。
- 禁止选择 `raw_text`、`ocr_markdown`、`resume_markdown` 和完整 AI JSON。
- 权限、岗位、状态、姓名、年龄、性别、学历、分数等尽量在 SQL `WHERE` 中完成。
- 使用游标分页或受控 `page/page_size`，单页最大 100。
- `COUNT(*)` 和聚合结果按过滤条件缓存或预聚合，避免每次扫描全表。

这是提升并发能力的必要项，不能只迁移 PDF 而保留当前全量读取。

## 12. 权限与隐私

简历、联系方式、OCR 和面试结论属于个人数据，搜索会显著放大误授权风险。

必须满足：

- R2 Bucket 私有。
- 所有 artifact 接口经过 JWT 鉴权。
- HR 只能查询自己负责岗位范围内的简历；管理员可跨范围。
- 搜索前做元数据范围过滤，搜索后再用 D1 做二次权限过滤。
- 新数据模型逐步用稳定的 `user_id`、`position_id`、`tenant_id`，不长期依赖姓名字符串。
- 管理员的下载、导出、批量搜索和删除写入操作日志。
- 搜索返回片段默认隐藏完整电话、邮箱和身份证号等敏感字段。
- 日志不得输出 OCR 全文、AI 完整结果、R2 签名 URL 或访问密钥。
- 删除和导出操作要有可审计记录。

## 13. 容量与成本估算

以下只是容量规划假设，实际以生产监控为准：

### 13.1 当前规模：500 份/天

- 年入库约 18.25 万份。
- 假设 OCR 文本平均 10～30KB，年新增约 1.8～5.5GB。
- R2 Standard 当前为 `$0.015/GB-month`，长文本存储成本很低。
- 假设 PDF 平均 1MB、保留 60 天，稳定存量约 30GB，未计免费额度时约 `$0.45/月`。
- AI Search 混合搜索单实例 50 万文件，约可容纳 2.7 年当前规模。
- AI Search 当前开放测试期限额内免费，但未来计费未知，预算必须保留变化空间。

### 13.2 未来规模：10,000 份/天

- 年入库约 365 万份。
- 60 天、平均 1MB PDF 的稳定存量约 600GB，R2 Standard 约 `$9/月`，另计操作费用。
- 单个 AI Search 混合实例约 50 天达到 50 万文件，需要按租户/时间分片。
- 跨实例搜索当前最多一次查询 10 个实例；若需要跨多年全库搜索，应迁移到更适合超大规模的搜索服务或申请提高限制。
- 此阶段 AI/OCR 调用额度、搜索分片和数据库结构化数据容量会比 R2 存储费更早成为主要瓶颈。

### 13.3 迁移触发条件

满足任一条件时启动搜索或数据库升级评审：

- 单个搜索实例达到 35 万份文档。
- 每日入库连续 30 天超过 3,000 份。
- 搜索 P95 超过 2 秒或索引 P95 超过 30 分钟。
- 全历史查询需要覆盖超过 10 个搜索实例。
- AI Search 正式价格超出批准预算。
- 单个 D1 数据库预计 6 个月内超过 7GB。

结构化数据库后续优先迁移到托管 PostgreSQL；Worker 通过 Hyperdrive 或标准服务 API 访问。Azure 学生 VM 可用于开发或搜索验证，不建议成为唯一生产数据库或搜索节点。

## 14. 失败处理、监控与告警

### 14.1 状态分离

解析、搜索和飞书同步是三个独立状态：

- `processing_status`
- `search_index_status`
- `feishu_sync_status`

任何一个失败都不能覆盖其他两个已经成功的结果。

### 14.2 重试

- R2 写入、搜索索引和删除任务使用 Queue 重试和指数退避。
- 4xx 配置或权限错误进入失败状态，不无限重试。
- 429、5xx、网络超时可重试。
- 消息达到最大重试次数后进入 DLQ，并保留 `resume_id`、步骤、错误码和最近一次错误。

### 14.3 指标

至少监控：

- 上传成功率和 R2 写入失败率。
- Queue backlog、最老消息年龄、消费者成功率和重试次数。
- OCR、字段提取、AI 初筛各步骤 P50/P95。
- `pending/indexing/failed` 搜索文档数。
- 从处理完成到可搜索的延迟。
- 搜索 QPS、P50/P95、零结果率和降级次数。
- R2 存储量、D1 大小和 D1 rows read/written。
- PDF 到期删除数量与清理失败数量。

告警优先级：

- P1：越权搜索、私有对象公开、批量数据删除异常。
- P2：Queue 停止消费、搜索不可用、索引积压超过 30 分钟。
- P3：单份简历 OCR/索引失败、飞书镜像失败。

## 15. 迁移与发布方案

### 阶段 0：基线与准备

- 统计生产 `resumes`、`resume_files` 的数量、总字节和长文本分布。
- 记录当前上传、OCR、AI 和列表接口性能。
- 确认生产 Cloudflare Paid 计划、R2 与 AI Search 可用性。
- 建立 feature flags：`R2_ARTIFACT_WRITE`、`R2_ARTIFACT_READ`、`RESUME_HYBRID_SEARCH`。

### 阶段 1：存储抽象与数据库迁移

- 新增 `ResumeArtifactRepository`、`ResumeTextRepository`、`ResumeAnalysisRepository`。
- 新增 `resume_artifacts`、`resume_search_state`、`candidate_stage_events`。
- 为 Pages Worker 和 Queue Consumer 增加 R2 binding。
- 保持旧 D1 读写不变，先通过测试。

### 阶段 2：新上传灰度与长文本双写

- 新增 init/complete 两阶段上传和 R2 CORS；前端 PDF 直传 R2。
- PDF 不做 R2→D1 Base64 双写。通过 feature flag 让测试账号先走 R2 新路径，其余账号暂时走旧上传路径；这样既能灰度，又不会为了回滚而重复下载、编码和保存 PDF。
- OCR 和 AI 完整结果写 R2，同时保留 D1 兼容列。
- 对每次双写校验大小与 SHA-256。
- 观察至少一轮真实批量上传，确保关页面后仍能完成。

### 阶段 3：R2 切读

- Repository 首选 R2、D1 fallback。
- 改造重新解析、能力评分、岗位排名和面试报告等直接读长文本的路径。
- 文件预览切到 R2。
- 确认错误处理和回滚开关有效。

### 阶段 4：全文检索试点

- 生成 `search_document`。
- 建立一个非公开 AI Search 混合实例。
- 先索引少量脱敏测试数据，验证中文 trigram 和语义召回。
- 接入 `/api/resumes/search`，开启管理员 feature flag。
- 验证权限二次过滤、删除和重新索引。

### 阶段 5：历史回填

- 以 Queue 小批量迁移旧 PDF、OCR 和 AI 结果。
- 每份只处理一次，按 `content_hash` 幂等。
- 控制并发，避免影响实时上传和 AI 初筛。
- 建立迁移进度表：总数、成功、跳过、失败和重试。
- 历史搜索文档分批索引，不一次提交全部数据。

### 阶段 6：停止 D1 长文本主写入

- 在 R2 读取稳定且历史覆盖率达到 100% 后，关闭 D1 PDF Base64 写入。
- `GET /api/resumes` 移除所有长文本列并改成 SQL 分页。
- 观察至少 7 天。
- 清空已确认迁移的 `resume_files.content` 和长文本兼容列，保留迁移审计。

### 阶段 7：生命周期和正式开放搜索

- 启用 `pdf/` 60 天生命周期删除。
- 开放 HR 搜索入口。
- 启用索引延迟、失败率、容量和成本告警。
- 在达到容量触发线前完成下一代搜索/数据库评审。

## 16. 代码边界建议

建议新增：

```text
worker/src/resume-storage/
  types.ts
  artifact-repository.ts
  r2-artifact-store.ts
  text-repository.ts
  analysis-repository.ts
  lifecycle.ts

worker/src/resume-search/
  types.ts
  search-service.ts
  ai-search-provider.ts
  search-document.ts
  access-scope.ts
  index-jobs.ts

worker/src/recruitment-events/
  event-repository.ts
  funnel-metrics.ts
```

现有 `worker/src/index.ts` 只负责路由装配，不继续加入 R2、搜索和迁移的完整实现。Queue Consumer 依赖上述服务接口，避免再次复制查询和更新逻辑。

前端建议新增：

```text
frontend/src/pages/Resumes/components/ResumeSearchBar.tsx
frontend/src/pages/Resumes/components/SearchStatus.tsx
frontend/src/services/resumeSearch.ts
```

搜索状态与普通筛选状态分开。清空关键词后恢复普通分页列表，不保留旧搜索排名。

## 17. 测试与验收

### 17.1 单元测试

- R2 对象键生成、版本和生命周期时间计算。
- Repository 的 R2 优先、D1 fallback 和缺失错误。
- 搜索文档字段规范化与敏感字段处理。
- AccessScope 对 admin、HR 和无负责人用户的行为。
- 搜索结果 D1 二次权限过滤。
- 事件幂等写入和转化率口径。

### 17.2 集成测试

- 文本 PDF 上传、R2 保存、Queue 处理、OCR/AI artifact 和搜索文档生成。
- 扫描 PDF 经 MinerU 后完成同一链路。
- 同名候选人不会串写 artifact 或索引。
- AI Search 不可用时列表和详情仍正常。
- R2 对象不存在时迁移期 fallback 正常。
- 删除候选人后立即无法通过搜索访问，后台最终清理所有对象。
- PDF 到期后原文件不可读，但 OCR、AI 和面试结果可读。

### 17.3 负载测试

- 一次上传 50 份，API 快速返回且任务全部入队。
- 以 500 份/天模型模拟查询和索引，Worker 无全表长文本读取。
- 搜索 20 并发用户，P95 目标小于 2 秒。
- 新简历全文可搜 P95 小于 15 分钟。
- Queue 并发必须受 AI/MinerU 配额控制，不以页面是否停留为条件。

### 17.4 安全测试

- HR 无法通过关键词猜测或 resume ID 查看其他负责人简历。
- 未登录用户无法访问 OCR、AI、PDF 和搜索接口。
- 搜索结果片段不泄漏被屏蔽的敏感字段。
- 签名 URL 过期后不可复用。
- 日志和错误响应不包含正文、Token 和对象签名。

### 17.5 上线验收条件

- 新上传数据 R2 双写成功率至少 99.9%。
- 迁移样本 SHA-256、大小与可读性一致。
- 列表 API 不再读取长文本，支持数据库级分页。
- 关闭浏览器后 OCR、AI 和索引继续执行。
- 关键词搜索、语义搜索、岗位过滤和权限过滤通过验收。
- 搜索服务故障不会导致简历列表和详情整体 500。
- 删除、到期与重试流程都有可观察状态。
- 生产部署具备明确回滚开关。

## 18. 回滚策略

- 阶段 1～5 保留迁移前的 D1 数据和长文本兼容列，Repository 同时支持 R2 与旧 D1 读取。关闭上传 feature flag 只影响后续新上传；已经走 R2 新路径的简历仍由 Repository 正常读取，不能依赖回退到不存在的 Base64 副本。
- 搜索功能异常时关闭 `RESUME_HYBRID_SEARCH`，退回普通结构化筛选。
- R2 写入异常时停止创建新任务并提示上传失败，不能悄悄只写 D1 Base64。
- 未完成 100% 校验前，不清空 D1 长文本和 `resume_files.content`。
- 生命周期规则最后启用；启用前导出待删除对象清单并抽样核对。
- 生产数据迁移、生命周期和部署必须分别审批，不在一次发布中同时执行。

## 19. 风险与应对

| 风险 | 应对 |
|---|---|
| AI Search Beta 后续涨价或变更 | 搜索抽象、feature flag、可重建搜索文档 |
| AI Search 单实例 50 万文件 | 35 万触发分片评审；按租户/时间分片 |
| 搜索索引短暂返回已删对象 | D1 二次过滤；删除状态优先 |
| 当前负责人姓名不稳定 | 引入稳定 user ID；姓名仅过渡 |
| 旧接口直接读 D1 长文本 | 统一 Repository；通过 `rg` 和测试逐一清理 |
| 双写不一致 | SHA-256 校验、状态表、可重试迁移 |
| 生命周期误删 | PDF 单独前缀、60 天、最后启用、启用前清单核对 |
| OCR/AI 永久保存带来隐私风险 | 私有存储、最小权限、审计、可执行删除策略 |
| 大批历史回填影响在线业务 | 独立 Queue、低优先级、限流、可暂停 |

## 20. 官方资料

- Cloudflare D1 FTS5：<https://developers.cloudflare.com/d1/sql-api/sql-statements/>
- Cloudflare D1 Limits：<https://developers.cloudflare.com/d1/platform/limits/>
- Cloudflare D1 Pricing：<https://developers.cloudflare.com/d1/platform/pricing/>
- Cloudflare R2 Pricing：<https://developers.cloudflare.com/r2/pricing/>
- Cloudflare R2 Lifecycle：<https://developers.cloudflare.com/r2/buckets/object-lifecycles/>
- Cloudflare AI Search R2 数据源：<https://developers.cloudflare.com/ai-search/configuration/data-source/r2/>
- Cloudflare AI Search Hybrid Search：<https://developers.cloudflare.com/ai-search/configuration/indexing/hybrid-search/>
- Cloudflare AI Search Limits & Pricing：<https://developers.cloudflare.com/ai-search/platform/limits-pricing/>
- Cloudflare Vectorize Pricing：<https://developers.cloudflare.com/workers/platform/pricing/#vectorize>
- Cloudflare Workers AI Pricing：<https://developers.cloudflare.com/workers-ai/platform/pricing/>

## 21. 已确认的产品决策

- PDF 不永久保存，默认保留 60 天。
- OCR 正文长期保存。
- AI 完整分析长期保存。
- 面试结果长期保存。
- 岗位转化率和历史仪表盘数据必须可追溯。
- 搜索第一版包含关键词与语义检索，但不提供生成式聊天回答。
- 系统继续优先使用 Cloudflare；Azure 学生服务器不作为生产唯一依赖。
