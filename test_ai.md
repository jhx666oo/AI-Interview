# AI 分析系统说明

## 当前 AI 架构

系统自带完整的 AI 分析引擎，**不依赖飞书 AI**。代码在 `worker/src/index.ts`：

### 调用优先级

```
① 环境变量 AI_API_KEY 存在
   → 调用 DeepSeek Chat API（默认 https://api.deepseek.com）
   → 模型：deepseek-chat
   → max_tokens: 4096

② 环境变量 AI 未设但 AI_API_KEY 未设
   → 降级 Cloudflare Workers AI
   → 模型：@cf/meta/llama-3.3-70b-instruct-fp8-fast
   → 再次降级：@cf/meta/llama-3.1-8b-instruct

③ 都没配置
   → 报错：AI not configured
```

### 已配置

| 密钥 | 状态 |
|------|------|
| `AI_API_KEY` | ✅ 已设为你的 DeepSeek 密钥 |
| `AI_BASE_URL` | ✅ 设为 https://api.deepseek.com |
| SECRET_KEY / FEISHU_* | 硬编码 fallback 在代码中 |

### AI 功能使用场景

- **简历初筛**：`POST /api/resumes/:id/ai-screen` — AI 分析简历，生成评估报告
- **人才库 AI 推荐**：`POST /api/talent-pool/:id/ai-recommend` — 基于简历推荐面试方向
- **面试综合分析**：AI 自动生成面试评价和录用建议

### 如果用其他 API（兼容 OpenAI 格式）

设置环境变量即可：
```bash
# 改为阿里通义千问
npx wrangler secret put AI_BASE_URL  # 输入 https://dashscope.aliyuncs.com/compatible-mode/v1

# 改为 OpenAI
npx wrangler secret put AI_BASE_URL  # 输入 https://api.openai.com/v1

# 更换密钥
npx wrangler secret put AI_API_KEY   # 输入新密钥
```
