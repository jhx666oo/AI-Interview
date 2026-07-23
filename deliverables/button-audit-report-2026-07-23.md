# AI-Interview 前端按钮安全审计报告

> 日期：2026-07-23 | 审计范围：26 个页面文件，84 个按钮处理器

## 总览

| 风险等级 | 数量 | 占比 |
|----------|------|------|
| **高** | 8 | ~9% |
| **中** | 48 | ~57% |
| **低** | 30 | ~36% |

## 高风险项（8 项，必须优先修复）

| # | 文件 | 按钮 | 问题 |
|---|------|------|------|
| 1 | Interviews/List.tsx | 提醒面试官 | 无 loading，可重复发送提醒 |
| 2 | Interviews/List.tsx | 发起背调 | 无 loading，可重复创建背调 |
| 3 | Interviews/Result.tsx | 录用/下一轮/待定/淘汰 | 四个确认按钮均无 loading |
| 4 | Onboarding/List.tsx | 转入试用期 | 无 loading，可重复创建试用期记录 |
| 5 | Probation/List.tsx | 转正 | Popconfirm 无 loading，可重复触发 |
| 6 | BackgroundChecks/List.tsx | 发起入职 | 无 loading，可重复创建入职记录 |
| 7 | Workflows/List.tsx | 执行 | 无 loading，可重复触发工作流执行 |
| 8 | InterviewerMappings.tsx | 通知所有面试官 | 无 loading，可重复发送通知 |

## 系统性问题（5 类）

### 1. Modal confirmLoading 缺失（最普遍）
涉及 12+ 个文件，Modal `onOk` 未设 `confirmLoading`，用户可反复点击"确定"导致重复提交。
- Resumes/Detail.tsx（全部 5 个 Modal）、Requisitions/List.tsx、Positions/List.tsx、Onboarding/List.tsx、Probation/List.tsx、BackgroundChecks/List.tsx、InterviewerMappings.tsx、PositionMappings.tsx、CapabilityDimensions.tsx、Workflows/List.tsx、Workflows/Editor.tsx、Resumes/List.tsx

### 2. 通用错误消息（丢失服务端详情）
大量处理器用 `message.error('保存失败')` 丢弃了 `e.response?.data?.detail`。
- Resumes/Detail.tsx（全部 9 个）、Interviews/Score.tsx（6 个）、Onboarding/Probation/BackgroundChecks（多数）

### 3. 无状态回滚（乐观更新后数据不一致）
仅 2 个处理器有回滚机制（Resumes/List.tsx 的 handleReject 和 handleApproveToTalentPool），其余 82 个均无。

### 4. 空 catch 块 / 静默吞错
- Positions/List.tsx handleOk：catch 块仅注释无反馈
- Positions/List.tsx handleDedup：逐条删除失败静默跳过

### 5. Promise.all 批量操作无逐条错误处理
6 处批量操作（删除/审批/状态变更），任一条目失败即整体失败，不告诉用户哪些成功哪些失败。

## 最佳实践参考

以下处理器实现最完整，可作为改进模板：
- Login/index.tsx handleLogin
- Settings/Users.tsx handleOk
- Settings/Mail.tsx handleSave
- Resumes/List.tsx handleReject（含状态回滚）
