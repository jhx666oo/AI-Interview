# Interview Automation Rollout Gates

这份清单是生产发布前的门禁，不代表当前已经上线。

1. 远程只读审计 `scripts/audit_interview_rounds.sql`，确认未取消的 `resume_id + round` 重复数为零。
2. 在预览环境成功应用 D1 migrations 0046、0047；0048 必须在重复审计通过后再应用。
3. API、独立 Queue consumer 和 Pages 预览部署通过健康检查。
4. `INTERVIEW_AUTOMATION_ENABLED=false` 烟囱测试确认原有手动业务筛选、安排面试和提醒流程不受影响。
5. 只开启一个内部测试岗位，完成 10 名候选人的业务通过、一面、二面闭环。
6. 观察 24 小时：重复面试/事件/消息为零，公开链接越权写入为零，人才档案误删除为零。
7. 只有管理员和 HR 签字后，才按岗位扩大开启范围。
8. 回滚只关闭开关并回退应用代码；不反向删除新增 D1 表、作业、通知和审计记录。

## 当前状态

- 代码已在本地实施分支完成测试，生产 D1、Queue、飞书和 SMTP 尚未执行真实验收。
- 全局开关和岗位开关默认关闭。
- 独立 consumer 需要单独配置 `FEISHU_APP_ID`、`FEISHU_APP_SECRET` 和 SMTP secrets；招聘日历需配置 `FEISHU_RECRUITMENT_CALENDAR_ID`。
