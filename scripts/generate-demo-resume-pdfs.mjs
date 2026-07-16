import { spawn } from "node:child_process";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = new URL("..", import.meta.url).pathname;
const uploadDir = join(root, "backend", "uploads", "demo");
const tempDir = "/tmp/ai-interview-demo-resumes";
const chromePath =
  process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const resumes = [
  ["demo.liuyue", "刘悦", "Demo AI 平台后端工程师", "资深后端工程师", 92, ["FastAPI", "PostgreSQL", "LLM 网关", "异步任务"], "主导过千万级招聘平台和模型调用网关建设，负责简历解析、任务调度和可观测性体系。"],
  ["demo.wangchen", "王辰", "Demo AI 平台后端工程师", "后端工程师", 86, ["Python", "任务队列", "模型评测", "API 设计"], "负责企业知识库和模型应用评测平台，熟悉复杂业务服务的拆分与治理。"],
  ["demo.zhaomin", "赵敏", "Demo AI 平台后端工程师", "平台工程师", 81, ["多云部署", "可观测性", "服务治理", "SQL"], "具备后端平台建设经验，长期负责稳定性、监控告警和发布流程优化。"],
  ["demo.suyun", "苏芸", "Demo 增长产品经理", "增长产品经理", 88, ["漏斗分析", "实验设计", "SaaS", "用户研究"], "负责 B 端增长实验、转化漏斗诊断和商业化策略，能推动跨部门目标对齐。"],
  ["demo.qiaoran", "乔然", "Demo 增长产品经理", "高级产品经理", 84, ["ATS", "CRM", "商业化", "数据分析"], "曾负责 ATS 和 CRM 的增长产品，熟悉渠道归因、销售线索和招聘业务闭环。"],
  ["demo.hexi", "何夕", "Demo 增长产品经理", "内容产品经理", 58, ["内容社区", "用户增长", "活动运营"], "产品经验偏内容社区，具备增长意识，但 B 端招聘业务经验相对不足。"],
  ["demo.linzhi", "林知", "Demo 前端体验工程师", "前端工程师", 90, ["React", "TypeScript", "React Flow", "复杂表单"], "长期负责可视化编辑器和低代码流程编排产品，重视交互细节与工程质量。"],
  ["demo.yanmo", "严墨", "Demo 前端体验工程师", "前端开发工程师", 64, ["React", "组件库", "状态管理"], "前端基础扎实，复杂场景下的工程化拆解和性能治理经验仍需加强。"],
  ["demo.tangqing", "唐青", "Demo 前端体验工程师", "高级前端工程师", 93, ["设计系统", "低代码平台", "可视化搭建", "性能优化"], "具备设计系统和低代码平台经验，能独立承担复杂产品的前端架构。"],
  ["demo.fangning", "方宁", "Demo 数据分析实习生", "数据分析实习生", 76, ["SQL", "Excel", "Python", "招聘分析"], "有招聘分析课程项目经历，能完成基础数据清洗、指标看板和结论汇报。"],
  ["demo.xujiayi", "徐嘉仪", "Demo 数据分析实习生", "数据分析实习生", 82, ["SQL", "Python", "可视化", "统计分析"], "数据分析基础扎实，能从业务问题出发构建分析框架，已确认入职实习。"],
  ["demo.mengfan", "孟凡", "Demo 数据分析实习生", "统计分析实习生", 70, ["统计学", "SQL", "A/B 测试"], "统计背景较好，业务表达和招聘场景理解仍需进一步观察。"],
];

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderResume([slug, name, position, headline, score, skills, summary]) {
  const email = `${slug}@talent.example`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <style>
    @page { size: A4; margin: 18mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: #0f172a;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      line-height: 1.7;
    }
    h1 { margin: 0; font-size: 32px; letter-spacing: 0; }
    h2 { margin: 26px 0 10px; font-size: 18px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; }
    .headline { margin-top: 4px; color: #2563eb; font-size: 16px; font-weight: 700; }
    .meta { margin-top: 14px; color: #475569; font-size: 13px; display: flex; gap: 16px; flex-wrap: wrap; }
    .summary { margin-top: 18px; padding: 14px 16px; border-radius: 10px; background: #f8fafc; border: 1px solid #e2e8f0; }
    .skills { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
    .skill { background: #eff6ff; color: #1d4ed8; border-radius: 999px; padding: 4px 10px; font-size: 12px; font-weight: 700; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 10px; }
    .item { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 14px; }
    .label { color: #64748b; font-size: 12px; }
    .value { margin-top: 4px; font-weight: 700; }
    ul { margin: 8px 0 0; padding-left: 20px; }
    li { margin-bottom: 6px; }
    .score { color: #059669; font-weight: 800; }
  </style>
</head>
<body>
  <h1>${escapeHtml(name)}</h1>
  <div class="headline">${escapeHtml(headline)} · 应聘 ${escapeHtml(position)}</div>
  <div class="meta">
    <span>${escapeHtml(email)}</span>
    <span>上海 / 可远程</span>
    <span>6 年工作经验</span>
    <span>AI 初筛匹配度 <span class="score">${score}/100</span></span>
  </div>

  <div class="summary">${escapeHtml(summary)}</div>

  <h2>核心技能</h2>
  <div class="skills">${skills.map((skill) => `<span class="skill">${escapeHtml(skill)}</span>`).join("")}</div>

  <h2>关键经历</h2>
  <ul>
    <li>负责招聘业务系统核心模块，从需求拆解、技术方案到上线复盘完整交付。</li>
    <li>参与 AI 辅助招聘能力建设，包括简历解析、候选人标签、面试题生成和评估报告。</li>
    <li>推动跨部门协作，沉淀流程规范、指标看板和异常处理机制。</li>
  </ul>

  <h2>项目亮点</h2>
  <div class="grid">
    <div class="item">
      <div class="label">项目一</div>
      <div class="value">智能招聘工作台</div>
      <p>搭建岗位、简历、面试和 Offer 的一体化协同流程，减少 HR 与用人部门之间的信息断点。</p>
    </div>
    <div class="item">
      <div class="label">项目二</div>
      <div class="value">AI 评估与自动化</div>
      <p>接入兼容 OpenAI SDK 的模型服务，支持提示词配置、后台任务和人工确认闭环。</p>
    </div>
  </div>

  <h2>教育背景</h2>
  <p>上海交通大学 · 计算机科学与技术 · 本科</p>
</body>
</html>`;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code}`));
    });
  });
}

async function ensureChrome() {
  await access(chromePath);
}

export async function generateDemoResumePdfs() {
  await ensureChrome();
  await mkdir(uploadDir, { recursive: true });
  await rm(tempDir, { recursive: true, force: true });
  await mkdir(tempDir, { recursive: true });

  for (const resume of resumes) {
    const [slug] = resume;
    const htmlPath = join(tempDir, `${slug}.html`);
    const pdfPath = join(uploadDir, `${slug}.pdf`);
    await writeFile(htmlPath, renderResume(resume), "utf8");
    await run(chromePath, [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--no-pdf-header-footer",
      "--print-to-pdf-no-header",
      `--print-to-pdf=${pdfPath}`,
      pathToFileURL(htmlPath).href,
    ]);
    console.log(`Generated ${pdfPath}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  generateDemoResumePdfs().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
