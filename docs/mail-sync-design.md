# 邮件简历自动同步 · 实现方案（GitHub Actions 云端定时）

> 版本：v1.0 · 2026-08-03
> 目标：把「飞书邮箱 → 简历自动上传平台」能力落地，不依赖 QwenPaw 外部脚本，不改动生产架构

---

## 一、背景与目标

招聘团队希望应聘者把简历发到指定飞书邮箱后，系统自动抓取附件并上传平台，自动进入 AI 解析流程。

**现状约束**
- 生产 API 运行在 Cloudflare Worker（无服务器沙箱），**无法建立 IMAP 长连接**，邮件抓取不能放生产 Worker。
- 原 QwenPaw 外部脚本（`resume_automation.py`）已实现抓取/去重/上传，需要收编进项目仓库。

**方案结论**
- 抓取端：仓库内 Python 脚本（`scripts/mail_sync.py`），调度跑在 **GitHub Actions** 云端（每 30 分钟）。
- 上传端：复用生产现有 `POST /api/resumes`，AI 解析链路零改动。
- 生产环境：**不做任何部署变更**。

---

## 二、总体架构

```
┌─────────────── GitHub Actions（云端，每 30 分钟） ───────────────┐
│                                                                  │
│  mail-sync-cron.yml 触发                                         │
│    → checkout 仓库代码                                           │
│    → 安装 Python 依赖                                            │
│    → Secrets 注入环境变量（邮箱账号/密码/管理员凭据）              │
│    → 运行 scripts/mail_sync.py                                   │
│                                                                  │
│  脚本内部：                                                      │
│  ① IMAP over SSL 连接飞书邮箱 (imap.feishu.cn:993)               │
│  ② 主题关键词过滤：简历/简歷/resume/cv/求职/应聘/候选人           │
│  ③ 附件提取：.pdf / .doc / .docx                                │
│  ④ 去重：已处理邮件 ID（本地状态文件）+ 候选人姓名级去重           │
│  ⑤ 登录平台获取 JWT（管理员账号）                                │
│  ⑥ 逐个调用 POST /api/resumes 上传附件                           │
└──────────────────────────────┬──────────────────────────────────┘
                               │ HTTPS
                               ▼
┌────────────────────── 生产环境（已就绪，零改动） ─────────────────┐
│  Cloudflare Worker  POST /api/resumes                            │
│    → D1 写入简历 → 投递解析队列                                   │
│    → OCR/字段提取 → AI 初筛 → 简历列表展示                        │
└─────────────────────────────────────────────────────────────────┘
```

---

## 三、详细设计

### 3.1 脚本模块 `scripts/mail_sync.py`

复用现有 `resume_automation.py` 已验证的核心逻辑，改造为：

```
输入（环境变量）
  MAIL_HOST        默认 imap.feishu.cn
  MAIL_PORT        默认 993
  MAIL_USER        邮箱账号
  MAIL_PASSWORD    邮箱专用密码（非登录密码）
  ADMIN_EMAIL      平台管理员账号
  ADMIN_PASSWORD   平台管理员密码
  API_BASE         默认 https://ai-interview-88r.pages.dev
  MAX_EMAILS       单次扫描上限（默认 50，防止首次全量过大）

处理流程
  1. 读取本地状态文件 email_state.json（已处理邮件 ID 集合）
     - GitHub Actions 每次全新机器，状态文件默认不保留 → 见 3.3 去重
  2. IMAP 登录 → SELECT INBOX → SEARCH ALL
  3. 逐封：主题含关键词 → 提取附件（pdf/doc/docx）
  4. 登录平台 POST /api/auth/token 获取 JWT
  5. 对每个附件：
     a. 按文件名推断候选人姓名（支持 【岗位】姓名.pdf / 姓名_岗位.pdf）
     b. 调用 GET /api/resumes 查重（姓名 + 岗位名同时匹配则跳过）
     c. 无重复 → POST /api/resumes（multipart: file + position_id 可选）
  6. 每封邮件独立 try/except，单封失败不影响后续
  7. 汇总输出：处理 N 封、上传 M 份、跳过 K 份、失败 L 份
```

**依赖**：仅 Python 标准库（`imaplib`、`email`、`ssl`、`requests`）。`requests` 需安装（见 3.2）。

### 3.2 Workflow `.github/workflows/mail-sync-cron.yml`

```yaml
name: Mail Sync Cron

on:
  schedule:
    - cron: '*/30 * * * *'   # 每 30 分钟（UTC，即北京时间每 30 分钟）
  workflow_dispatch: {}       # 支持手动触发（测试用）

jobs:
  mail-sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      - run: pip install requests
      - run: python scripts/mail_sync.py
        env:
          MAIL_USER: ${{ secrets.MAIL_USER }}
          MAIL_PASSWORD: ${{ secrets.MAIL_PASSWORD }}
          ADMIN_EMAIL: ${{ secrets.ADMIN_EMAIL }}
          ADMIN_PASSWORD: ${{ secrets.ADMIN_PASSWORD }}
          API_BASE: https://ai-interview-88r.pages.dev
```

> 参考：项目现有 `.github/workflows/interview-reminder-cron.yml` 已采用同一模式。

### 3.3 去重策略（重点）

GitHub Actions 每次运行都是全新机器，本地文件不保留。采用**三层去重**：

| 层级 | 实现 | 作用 |
|------|------|------|
| ① 邮件 ID（当次运行内） | 内存集合 | 同一封邮件多附件不重复处理 |
| ② 候选人姓名（跨运行） | 上传前调 `GET /api/resumes` 查重 | 姓名+岗位已存在则跳过，跨运行生效 |
| ③ 时间窗口 | 只扫近 7 天邮件（IMAP `SINCE`） | 首次接入不全量处理历史邮件 |

**说明**：简历文件名通常含姓名（如 `孟祥瑞_7年.pdf`），姓名级去重即可满足"同主题再发一次不产生重复记录"的验收要求。若后续需要更精确的邮件级去重，再加生产 D1 表 `mail_sync_processed`（需要新增接口，作为二期增强）。

### 3.4 上传细节

- 岗位：`position_id` **可选**。文件名含岗位名时（如 `【产品运营经理（双休）_长沙】孟祥瑞.pdf`）由 Worker 自动匹配岗位；否则进"待分配"（当前上传接口已支持可选岗位）。
- 来源标记：二期可在 `resumes` 表加 `source` 字段（`email_sync` / `manual_upload`），D1 migration + 运行时兼容补齐。

### 3.5 日志与可观测性

- 脚本输出结构化摘要（处理/上传/跳过/失败计数）
- GitHub Actions 运行页可见每次执行日志
- 失败时 `::warning::` / `::error::` 标记，便于在 Actions 页面定位

---

## 四、安全设计

| 项 | 措施 |
|----|------|
| 邮箱密码 | 飞书**邮箱专用密码**，存 GitHub Actions Secrets，绝不入代码库 |
| 管理员密码 | 同上，Secrets 注入 |
| 现有脚本明文密码 | `resume_automation.py` 内含明文凭据，**不提交到 git** |
| 日志脱敏 | 脚本内不打印密码；异常信息截断敏感字段 |

---

## 五、验收标准

1. 往配置邮箱发一封带 PDF 附件的邮件（主题含"简历"）→ ≤30 分钟内平台简历列表出现该候选人并进入 AI 解析
2. 同一份简历再触发一次 → 不产生重复记录（姓名去重）
3. 手动触发 workflow（`workflow_dispatch`）可立即验证
4. 多封邮件 → 全部处理，不遗漏
5. 非简历邮件（无关键词/无附件）→ 忽略
6. 邮箱密码错误 → 任务失败并留日志，不崩溃、不影响后续任务

---

## 六、实施步骤

1. **收编脚本**：新建 `scripts/mail_sync.py`（移植 IMAP/去重/上传逻辑，改造为环境变量配置）
2. **新增 workflow**：`.github/workflows/mail-sync-cron.yml`
3. **配置 Secrets**：仓库 Settings → Secrets and variables → Actions，添加 `MAIL_USER` / `MAIL_PASSWORD` / `ADMIN_EMAIL` / `ADMIN_PASSWORD`
4. **本地先验证**：本地跑一次脚本，确认能抓取并上传（此时若担心污染生产，可先指向本地 Worker `http://localhost:8788`）
5. **手动触发测试**：在 GitHub Actions 页面点 `Run workflow`，发一封测试邮件验证
6. **观察稳定后**：交给招聘团队验收

---

## 七、风险与备选

| 风险 | 影响 | 应对 |
|------|------|------|
| 云端 IP 被飞书邮箱风控 | 抓取失败 | 换内网常驻机器跑同一脚本（方案 A） |
| 首次全量邮件多 | 扫描慢 | `SINCE` 时间窗口 + `MAX_EMAILS` 上限 |
| 文件名无姓名 | 去重失效 | 附件级 MD5 去重（二期）或平台 `source` 字段 |
| GitHub 免费额度 | 每月 2000 分钟 | 30 分钟一次仅耗约 1440 分钟/月，足够 |

**备选方案 A（内网常驻）**：同一脚本部署在公司内网机器，crontab/常驻进程每 30 分钟执行，适合对 IP 稳定性有要求的场景。
