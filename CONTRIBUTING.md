# Contributing

感谢你愿意参与 AI Interview。这个项目希望保持“能直接跑起来、能被团队二次开发、能被真实招聘流程使用”的方向。

## 开发流程

1. Fork 仓库并创建功能分支。
2. 复制环境变量示例文件：

```bash
cp .env.example .env
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

3. 启动数据库、后端和前端：

```bash
make db
make dev-backend
make dev-frontend
```

4. 提交前至少运行：

```bash
make test-backend
make build-frontend
```

## 代码约定

- 后端保持 FastAPI + SQLAlchemy 的现有分层：`routes` 只处理 HTTP，业务逻辑放入 `services`。
- 前端优先复用 Ant Design、React Router、现有 request 封装和页面布局。
- 新增数据库字段需要补 Alembic migration。
- 不提交 `.env`、上传文件、构建产物、虚拟环境、`node_modules` 或 `__pycache__`。
- 面向候选人的页面需要注意隐私暴露和链接 token 的可访问范围。

## Pull Request 建议

- 清楚描述问题、方案和验证方式。
- UI 改动尽量附截图或录屏。
- 涉及招聘状态流转、权限、AI 调用、邮件发送的改动，请说明边界情况。

## Issue 建议

提交 Bug 时请包含：

- 版本或提交号
- 复现步骤
- 期望结果和实际结果
- 后端日志、浏览器控制台或网络请求截图
