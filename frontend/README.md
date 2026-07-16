# AI Interview Frontend

React + Vite 前端应用，负责招聘工作台、公开职位页、候选人笔试页、Offer 确认页和可视化工作流编辑器。

## 本地开发

```bash
cp .env.example .env
npm install
npm run dev
```

默认开发服务器地址为 <http://localhost:5173>。如果后端没有使用默认 `http://localhost:8000`，请修改 `.env` 中的 `VITE_API_URL`。

## 构建

```bash
npm run build
npm run preview
```

生产镜像使用 `nginx.conf` 将 `/api` 和 `/uploads` 代理到后端服务。
