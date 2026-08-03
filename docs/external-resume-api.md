# 对外简历上传接口文档

> 外部系统通过本接口上传简历 PDF，系统自动完成文本提取（OCR）、字段解析、AI 初筛匹配，处理结果实时同步至前端简历列表。

---

## 接口信息

| 项目 | 内容 |
|------|------|
| **接口地址** | `POST https://ai-interview-88r.pages.dev/api/resumes/external` |
| **请求格式** | `multipart/form-data` |
| **认证方式** | API Key（`x-api-key` header） |
| **处理方式** | 异步处理（202 接受 → 后台队列处理 → 前端可见） |

---

## 认证

通过 `x-api-key` 请求头传递密钥：

```bash
x-api-key: wafgxP9rsgZvuql_WZ1L7ydpWLkSj-u1GwZN-iFvSZs
```

未提供或无效密钥返回 `401 Unauthorized`。

---

## 请求参数

| 参数 | 位置 | 类型 | 必填 | 说明 |
|------|------|------|------|------|
| `file` | body | File | ✅ | PDF 格式简历文件，文件名建议包含姓名和岗位便于自动识别 |
| `position_applied` | body | string | | 指定应聘岗位名称。不传时尝试从文件名解析（格式 `姓名_岗位.pdf` 或 `【岗位_城市_薪资】姓名_年限.pdf`） |
| `candidate_name` | body | string | | 候选人姓名。不传时尝试从文件名解析 |
| `raw_text` | body | string | | 调用方已提取的简历纯文本内容。提供后跳过 OCR 步骤，队列直接进行字段提取和 AI 初筛，处理速度更快 |
| `source` | body | string | | 来源标识，用于区分不同外部系统。写入简历的 `parsed_data.source` 字段。默认 `external` |

### 文件名解析规则

与前端手动上传一致的解析逻辑：

- **格式一**：`【社群运营专员_杭州_6-8K】张三_3年.pdf` → 岗位：`社群运营专员`，姓名：`张三`
- **格式二**：`李四_测试工程师.pdf` → 姓名：`李四`，岗位：`测试工程师`
- 其他格式：文件名去掉 `.pdf` 后缀作为候选人姓名

---

## 返回说明

### 成功接受（202 Accepted）

```json
{
  "id": "99088b3c-a590-459d-8b4d-540b5a52b280",
  "job_id": "afaa88d9-bf30-43f7-afbb-6c20c1ec04f0",
  "candidate_name": "张三",
  "position_applied": "测试工程师",
  "status": "queued",
  "parse_status": "queued",
  "detail": "简历已接收，正在后台解析（字段提取 + AI 初筛）..."
}
```

| 字段 | 说明 |
|------|------|
| `id` | 简历唯一 ID，可用于后续查询处理状态 |
| `job_id` | 后台处理任务 ID |
| `candidate_name` | 最终确定的候选人姓名 |
| `position_applied` | 最终确定的应聘岗位 |
| `status` | 当前状态，固定为 `queued` |
| `parse_status` | 解析状态：`queued`（有 raw_text 直接入队）/ `ocr_queued`（需 OCR 后入队） |

### 错误响应

**400 Bad Request** — 文件格式不正确
```json
{ "detail": "仅支持 PDF 格式" }
```

**401 Unauthorized** — 缺少或无效 API Key
```json
{ "detail": "Missing API key or token" }
```

**500 Internal Server Error** — 服务端处理失败
```json
{ "detail": "保存文件失败: ..." }
```

---

## 处理流程说明

上传成功后，系统按以下链路自动处理：

```
上传 PDF → 保存文件(D1) → 创建简历记录 → 入队
                                            ↓
    ┌─── 有 raw_text ──→ 直接字段提取 → AI 初筛 → 更新 D1
    │
    └─── 无 raw_text ──→ MinerU OCR → 字段提取 → AI 初筛 → 更新 D1
```

- **字段提取**：AI 从简历文本中提取姓名、性别、年龄、学历、工作经验、技能、证书等结构化字段
- **AI 初筛**：根据岗位能力维度评估匹配度，生成匹配分数（0-100）、推荐结果（通过/存疑/淘汰）、优劣势分析
- 处理完成后，前端简历列表页面自动刷新即可看到结果（含 AI 评分、维度得分等）

> 处理耗时：有 raw_text 约 10-30 秒，走 OCR 约 1-5 分钟（取决于 PDF 页数和 MinerU 服务响应）。

---

## 调用示例

### cURL

```bash
# 带 raw_text（推荐，处理更快）
curl -X POST https://ai-interview-88r.pages.dev/api/resumes/external \
  -H "x-api-key: wafgxP9rsgZvuql_WZ1L7ydpWLkSj-u1GwZN-iFvSZs" \
  -F "file=@resume.pdf" \
  -F "position_applied=社区运营专员" \
  -F "candidate_name=张三" \
  -F "raw_text=张三，3年社区运营经验，擅长用户增长..." \
  -F "source=猎头系统"

# 纯文件上传（走 OCR）
curl -X POST https://ai-interview-88r.pages.dev/api/resumes/external \
  -H "x-api-key: wafgxP9rsgZvuql_WZ1L7ydpWLkSj-u1GwZN-iFvSZs" \
  -F "file=@resume.pdf"
```

### Python

```python
import requests

API_KEY = "wafgxP9rsgZvuql_WZ1L7ydpWLkSj-u1GwZN-iFvSZs"
URL = "https://ai-interview-88r.pages.dev/api/resumes/external"

with open("resume.pdf", "rb") as f:
    resp = requests.post(
        URL,
        headers={"x-api-key": API_KEY},
        files={"file": f},
        data={
            "position_applied": "社区运营专员",
            "candidate_name": "张三",
            "source": "猎头系统",
        },
    )

if resp.status_code == 202:
    result = resp.json()
    print(f"上传成功，简历 ID: {result['id']}")
else:
    print(f"上传失败: {resp.json()}")
```

### JavaScript / Node.js

```javascript
const FormData = require("form-data");
const fs = require("fs");

const form = new FormData();
form.append("file", fs.createReadStream("resume.pdf"));
form.append("position_applied", "社区运营专员");
form.append("source", "猎头系统");

const resp = await fetch("https://ai-interview-88r.pages.dev/api/resumes/external", {
  method: "POST",
  headers: { "x-api-key": "wafgxP9rsgZvuql_WZ1L7ydpWLkSj-u1GwZN-iFvSZs" },
  body: form,
});
const data = await resp.json();
console.log(data);
```

---

## 查询处理结果

上传后可通过前端页面或简历查询接口查看处理状态：

```bash
# 需要先登录获取 JWT token
TOKEN=$(curl -s -X POST "https://ai-interview-88r.pages.dev/api/auth/token" \
  -d "username=admin@example.com&password=admin123" | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# 查询简历详情
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://ai-interview-88r.pages.dev/api/resumes/{id}"
```

简历状态字段说明：

| `parse_status` | 说明 |
|----------------|------|
| `ocr_processing` | 正在 OCR 解析文本中 |
| `pending_screening` | 文本已提取，等待 AI 初筛（或处理中） |
| `ai_screened` | AI 初筛完成，前端可见结果 |

---

## 限制说明

| 项目 | 限制 |
|------|------|
| 文件格式 | 仅支持 PDF |
| 文件大小 | 建议不超过 20MB（D1 base64 存储限制） |
| API Key | 生产环境通过 `wrangler pages secret` 设置，如有更换需求请管理员操作 |

---

## 变更记录

| 日期 | 版本 | 说明 |
|------|------|------|
| 2026-08-03 | v1 | 初始版本 |
