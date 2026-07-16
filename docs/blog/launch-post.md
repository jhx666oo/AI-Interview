# AI Interview：一个能真实跑起来的开源 AI 招聘工作台

![AI Interview 数据分析仪表盘](../assets/screenshots/dashboard.png)

招聘系统最难的地方，往往不是做一个候选人表单，而是把所有分散的信息重新连起来：岗位需求在文档里，简历在邮箱里，面试评价在聊天记录里，笔试链接在另一个平台，Offer 又回到邮件线程。每一步都有人参与，每一步又都可能丢上下文。

AI Interview 想解决的正是这个问题。它是一个开源的智能招聘管理系统，面向 HR、招聘负责人、面试官和用人部门，把岗位、简历、AI 初筛、部门评审、面试、笔试、Offer、招聘数据和自动化工作流放到一个产品里。

更重要的是，它不是一个只停留在“AI 概念”的 Demo。下面这些截图都来自本地运行后的演示数据，包含真实生成的测试简历 PDF、AI 分析结果、面试评分页、面试结果分析、模型配置和提示词配置。

## AI 先读简历，但最终判断仍然留给人

![简历管理](../assets/screenshots/resumes.png)

简历进入系统后，AI Interview 会完成上传、查重、解析状态跟踪、岗位匹配评分和候选人状态流转。HR 不再只是看到一个附件，而是可以直接看到候选人与岗位之间的关系。

真正的核心在简历详情页。系统会基于岗位要求生成候选人画像、匹配分、初筛建议、亮点、风险点和可追问方向。HR 可以采纳 AI 建议，也可以覆盖建议、转岗重评或发起用人部门评审。

![简历 AI 分析结果](../assets/screenshots/resume-ai-analysis.png)

这个设计刻意保留了人工确认闭环。AI 负责把高频阅读和信息整理做掉，人负责做最终判断。对于招聘团队来说，这比“自动录用/自动淘汰”的黑盒体验更可控，也更容易落地。

## 面试页不是填表，而是 AI 辅助评估现场

面试评分页把候选人简历最大化展示在左侧，右侧是结构化面试题、参考答案、评分标准和面试小组提交状态。面试官不需要在多个窗口之间来回切换，可以边看简历边记录评分。

![AI 面试评分界面](../assets/screenshots/interview-score.png)

题目可以结合候选人背景、岗位要求和题库内容生成。对于技术岗位，系统可以把简历中的项目经历转化成更具体的追问；对于产品、运营或数据岗位，也可以围绕业务理解、项目复盘和协作能力生成题目。

面试结束后，AI Interview 会继续把分散的评价汇总起来。系统支持多位面试官评分、文字评价、录音上传和转写，再生成综合面试分析、优势、风险和录用建议。

![面试结果 AI 分析](../assets/screenshots/interview-ai-result.png)

这让面试反馈不再只是几句零散评论，而是变成一个可追踪、可复盘、可继续流转的候选人评估报告。

## AI 能力可以配置，而不是写死在代码里

一个招聘系统如果要进入真实团队，模型和提示词就不能写死。AI Interview 提供了模型配置页，支持 OpenAI SDK 兼容接口。你可以接 DashScope、OpenAI，也可以接企业内部模型网关。

![AI 模型配置](../assets/screenshots/ai-model-settings.png)

提示词同样可以在后台维护。简历分析、Markdown 生成、面试题生成、面试结果分析、笔试评价等任务都可以配置不同模板。团队可以根据岗位类型、行业术语和内部评价标准持续调优。

![AI 提示词配置](../assets/screenshots/prompt-settings.png)

这也是 AI Interview 适合作为开源项目二次开发的原因：它把 AI 能力做成了产品里的可运营对象，而不是一段隐藏在服务层里的调用代码。

## 从岗位发布到候选人投递

![岗位管理](../assets/screenshots/positions.png)

招聘流程从岗位开始。AI Interview 支持岗位创建、状态管理、JD 生成、公开发布和岗位统计。岗位信息不只是一个表单，它会参与后续简历匹配、面试题生成和招聘漏斗分析。

公开职位页让候选人可以直接查看岗位并投递简历，适合团队把职位页放到官网、社群或招聘渠道中。

![公开职位页](../assets/screenshots/public-job.png)

## 笔试、工作流和数据看板，把招聘变成可运营流程

技术岗位常常需要笔试或作业。AI Interview 提供在线笔试模块，支持算法题、选择题、问答题、公开答题链接、代码运行和 AI 评价，方便团队把测评结果纳入同一条候选人流程。

![在线笔试](../assets/screenshots/coding-tests.png)

当招聘流程越来越复杂，系统还需要能自动推进。AI Interview 内置了基于 React Flow 的可视化工作流，支持 LLM、条件判断、HTTP 请求、邮件、数据库、人工输入等节点。你可以围绕“高匹配候选人自动推进”“面试结束后自动生成报告”“Offer 过期提醒”等场景继续扩展。

![工作流编排](../assets/screenshots/workflows.png)

最后，仪表盘会把招聘变成可运营的过程。团队可以看到招聘漏斗、岗位分析、面试官分析和时间趋势，回答这些很实际的问题：

- 哪些岗位卡在简历初筛？
- 哪些岗位面试通过率异常低？
- 面试官的完成率和评分稳定性如何？
- Offer 发出后的接受率如何？
- 招聘周期是否在变长？

## 技术架构

![系统架构](../assets/architecture.svg)

AI Interview 采用前后端分离架构：

- 前端：React 19、Vite、TypeScript、Ant Design、React Router、Recharts、React Flow
- 后端：FastAPI、SQLAlchemy、Alembic、Pydantic、JWT、Background Tasks
- 数据库：PostgreSQL 15
- AI：OpenAI SDK 兼容接口，支持 DashScope、OpenAI 或企业内部兼容模型网关
- 部署：Docker Compose、Nginx、GitHub Actions

这套组合足够轻量，适合本地开发，也方便部署到企业内网或云服务器。对于想做二次开发的团队，岗位、简历、面试、笔试、Offer 和工作流都有明确模块边界。

## 快速体验

```bash
git clone <your-repo-url>
cd ai-interview
cp .env.example .env
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
docker compose up -d postgres
```

启动后端：

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

启动前端：

```bash
cd frontend
npm install
npm run dev
```

访问 `http://localhost:5173`，开发环境默认账号是 `admin@example.com / admin123`。生产环境请务必修改初始管理员密码、数据库密码和 `SECRET_KEY`。

如果你想生成和本文一样的演示素材，可以写入演示数据并重新截图：

```bash
cd backend
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/ai_interview_demo python scripts/seed_demo_data.py
cd ..
node scripts/generate-demo-resume-pdfs.mjs
node scripts/capture-demo-screenshots.mjs
```

## 一个更现实的 AI 招聘产品起点

AI Interview 的定位不是替招聘团队做出录用决定，而是让招聘团队拥有一个更清晰、更自动化、更可追踪的协作系统。它把 AI 放在真正需要它的位置：阅读材料、整理结构化信息、生成建议、辅助面试、汇总反馈，并把最终判断权留给人。

如果你正在做招聘数字化、AI 面试、人才测评或内部流程自动化，这个项目可以直接作为一个可运行的起点。

欢迎 Star、Fork、提交 Issue，也欢迎把它改造成你自己团队真正想用的招聘工作台。
