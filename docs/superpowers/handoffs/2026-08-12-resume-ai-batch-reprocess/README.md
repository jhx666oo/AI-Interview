# 简历 AI 批量重评交接包

这个文件夹用于直接交给其他智能体或模型执行“简历管理页 AI 批量重评与进度追踪”。

文件说明：

- \`DESIGN.md\`：自包含的功能设计摘要，包含页面交互、状态规则、数据模型、接口和验收标准。
- \`IMPLEMENTATION_PLAN.md\`：按 Task 0～Task 9 排列的逐任务实施计划，包含文件范围、接口、测试和验证命令。
- \`PROMPT.md\`：可以直接复制给其他 AI 的执行提示词。

执行前提：

- 当前工作区是 \`/Users/jhx/Desktop/天鹅到家/dvS2cn/ai-interview\`。
- 根目录未跟踪的 \`package-lock.json\` 必须保留，不能修改或加入提交。
- 本交接包只授权本地代码修改和本地验证；不授权创建分支、提交、推送、创建 PR、生产部署、生产 D1 或 secrets 修改。
- 生产部署仍须遵循项目现有流程，并在用户明确同意后单独处理。

建议使用方式：

1. 复制 \`PROMPT.md\` 全文。
2. 发送给能访问上述项目目录的 AI。
3. 要求它先读取 \`DESIGN.md\` 和 \`IMPLEMENTATION_PLAN.md\)，再逐项执行。
4. 收到实现报告后，检查 diff、测试结果和生产操作声明，再决定是否要求提交或部署。

原始完整设计文档仍位于：

\`docs/superpowers/specs/2026-08-12-resume-ai-batch-reprocess-progress-design.md\`
