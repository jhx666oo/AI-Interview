# 招聘运营能力优化设计

## 目标

在不改变现有“D1 为计算真相源、飞书为协作镜像”原则的前提下，补齐三项招聘运营能力：批量入库、岗位能力维度与硬条件筛选、岗位漏斗仪表盘及限时分享页。

## 范围与顺序

1. 批量入库：简历列表勾选后一次性入库，提供逐条结果。
2. 岗位筛选规则：能力维度及权重影响 AI 匹配分；年龄、性别、学历仅标记，不强制隐藏候选人。
3. 仪表盘和分享页：按事业部汇总、按岗位展开的漏斗看板；可生成有有效期的脱敏只读链接。

评测集建设、AI 准确率评估、BOSS/邮箱抓取、试用期及入职模块不在本次范围内。

## 一、批量入库

### 用户体验

- 简历列表保留跨页勾选状态，并新增“批量入库”小按钮，位于批量删除附近。
- 点击后显示确认弹窗：候选人数、目标状态、不可入库记录数。
- 提交后显示成功、跳过、失败数量；失败项可展开查看原因。
- 仅 `admin` 和 `hr` 能执行，面试官不显示此操作。

### 业务规则

- D1 的 `resumes.status` 是入库状态事实来源，批量操作按 `resume.id` 更新，绝不按姓名。
- 允许 `pending_screening`、`pending_review`、`approved` 状态请求入库；已入库记录返回 `skipped`。
- 每条成功记录设置 `status='approved'`、`stage='talent_pool'`，写入操作日志。
- 飞书更新是单条独立最佳努力同步；失败不回滚 D1，并在响应中标记 `feishu_sync='failed'`。

### 接口

`POST /api/resumes/batch-approve-to-talent-pool`

```json
{ "resume_ids": ["uuid-1", "uuid-2"] }
```

返回：

```json
{
  "total": 2,
  "approved": ["uuid-1"],
  "skipped": [{ "id": "uuid-2", "reason": "already_approved" }],
  "failed": []
}
```

## 二、岗位能力维度与硬条件筛选

### 数据模型

- 继续复用 `positions.capability_dimensions`，标准结构为：

```json
[
  { "name": "AI 应用能力", "weight": 40, "description": "能将 AI 工具用于业务交付" },
  { "name": "内容运营", "weight": 35, "description": "具备内容策划和增长经验" }
]
```

- 继续复用 `job_requisitions.hard_requirements`，标准结构为：

```json
[
  { "field": "age", "operator": "between", "value": [22, 35] },
  { "field": "gender", "operator": "equals", "value": "女" },
  { "field": "education", "operator": "in", "value": ["本科", "硕士", "博士"] }
]
```

- `resumes.hard_requirement_result` 保存逐项结果：`passed`、`unmet_items`、`unknown_items`、`message`。
- `resumes.ai_evaluation` 保存各能力维度的原始评分与理由；列表卡片统一显示为五分制。

### 计算与展示

- AI 提示词读取岗位维度和权重，输出每个维度的分数、理由及总匹配分。
- 总匹配分使用权重归一化计算；无权重时按等权平均。
- 硬条件在 AI 字段提取完成后执行。缺失字段标记为“待人工确认”，而不是判定不通过。
- 简历列表提供筛选：硬条件“全部 / 已满足 / 存在不满足 / 待确认”、最低 AI 匹配分、维度名称。
- 硬条件不合格候选人仍显示，但使用醒目标签并支持排序靠后。

## 三、招聘运营仪表盘

### 信息结构

仪表盘参考“五大事业部招聘看板”的岗位漏斗表结构，视觉沿用现有蓝紫色、Ant Design 卡片、Tag 和表格风格。

- 顶部筛选：数据日期、事业部、HRBP、优先级、岗位状态。
- 总览指标：在招岗位、需求人数、简历数、面试中、Offer、已入职。
- 主表：按事业部折叠汇总；展开后展示岗位行。
- 岗位列：事业部、HRBP、在招职位、优先级、需求人数、简历、一面、一面通过、二面通过、三面通过、通过率、Offer、入职、备注、状态。
- 颜色：P0 红色、P1 橙色、P2 灰蓝；初筛中/面试中/Offer 中/已完成使用状态标签。

### 聚合数据

`GET /api/dashboard/recruiting-board`

- 从 `positions`、`job_requisitions`、`resumes`、`interviews`、`offers`、`onboarding_records` 聚合。
- 所有统计按岗位 ID 关联，岗位缺失时按标准岗位名回退并标记 `unmatched`。
- 通过率定义为“最近有效面试阶段通过人数 / 进入该阶段人数”；分母为 0 时显示 `-`。
- 事业部汇总是其岗位明细的求和，不能再单独维护一份汇总数据。

## 四、限时分享页

### 安全模型

- 新表 `dashboard_share_links`：`id`、`token_hash`、`scope_type`、`scope_ids`、`expires_at`、`revoked_at`、`created_by`、`created_at`。
- 不保存明文 token；创建时生成随机 token，数据库仅存 SHA-256 哈希。
- token 有效期选项：1 天、7 天、30 天、长期；长期可由创建者手动关闭。
- 分享页为实时数据，不保存数据快照；链接失效、撤销或不存在时返回 404。
- 分享响应只含岗位级汇总，不返回候选人姓名、联系方式、简历、AI 原始评估或操作入口。

### 接口与页面

- `POST /api/dashboard/share-links`：仅 admin/hr，创建链接和有效期。
- `GET /api/dashboard/share-links`：创建者查看已生成链接。
- `DELETE /api/dashboard/share-links/:id`：撤销链接。
- `GET /api/shared/dashboard/:token`：无需登录，读取已脱敏的招聘看板。
- 内部仪表盘右上角“分享看板”按钮弹出有效期单选项和生成结果；已分享链接支持复制、查看到期时间和关闭。
- 分享页路径不使用主系统 Layout，不显示侧边栏、筛选编辑、候选人详情或管理操作。

## 错误处理与审计

- 批量入库逐条隔离失败，单条异常不影响其余候选人。
- 不存在、过期、撤销的分享 token 统一返回 404，避免泄露链接状态。
- 创建、撤销分享链接与批量入库均写入 `operation_logs`，不记录 token 或候选人敏感内容。

## 验收标准

- 跨两页选择 3 份简历可一次入库，刷新后状态不回退；飞书失败不会撤销 D1 入库。
- 一个岗位配置 40/35/25 权重后，AI 结果和列表维度卡片显示对应维度；硬条件不满足仍可见且可筛选。
- 仪表盘按事业部折叠、按岗位展开，岗位与事业部数值一致；指标与数据表实时同步。
- 生成 1 天分享链接后，匿名窗口能访问脱敏看板；过期或撤销后访问返回 404；分享页不出现候选人个人信息。
