import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { generateDemoResumePdfs } from "./generate-demo-resume-pdfs.mjs";

const root = new URL("..", import.meta.url).pathname;
const outputDir = join(root, "docs", "assets", "screenshots");
const chromePath =
  process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const chromePort = Number(process.env.CHROME_DEBUG_PORT || 9222);
const appUrl = process.env.APP_URL || "http://127.0.0.1:5173";
const apiUrl = process.env.API_URL || "http://127.0.0.1:8000/api";
const userDataDir = "/tmp/ai-interview-screenshot-chrome";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function login() {
  const body = new URLSearchParams();
  body.set("username", process.env.DEMO_EMAIL || "admin@example.com");
  body.set("password", process.env.DEMO_PASSWORD || "admin123");

  const response = await fetch(`${apiUrl}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    throw new Error(`Login failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  return data.access_token;
}

async function apiGet(path, token) {
  const response = await fetch(`${apiUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`GET ${path} failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

async function waitForChrome() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${chromePort}/json/version`);
      if (response.ok) return response.json();
    } catch {
      // Keep polling until Chrome exposes the debugging endpoint.
    }
    await wait(250);
  }
  throw new Error("Chrome debugging endpoint did not become available.");
}

class CdpClient {
  constructor(wsUrl) {
    this.id = 0;
    this.pending = new Map();
    this.sessions = new Map();
    this.ws = new WebSocket(wsUrl);
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });

    this.ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result || {});
      }
    });
  }

  send(method, params = {}, sessionId) {
    const id = (this.id += 1);
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  close() {
    this.ws.close();
  }
}

async function waitForPageReady(client, sessionId, marker) {
  for (let i = 0; i < 80; i += 1) {
    const result = await client.send(
      "Runtime.evaluate",
      {
        expression: `({ ready: document.readyState, text: document.body ? document.body.innerText.slice(0, 4000) : "" })`,
        returnByValue: true,
      },
      sessionId,
    );
    const value = result.result?.value || {};
    if (value.ready === "complete" && (!marker || value.text.includes(marker))) {
      await wait(800);
      return;
    }
    await wait(250);
  }
}

async function capture(client, sessionId, path, fileName, marker) {
  await client.send("Page.navigate", { url: `${appUrl}${path}` }, sessionId);
  await waitForPageReady(client, sessionId, marker);
  const screenshot = await client.send(
    "Page.captureScreenshot",
    { format: "png", fromSurface: true },
    sessionId,
  );
  await writeFile(join(outputDir, fileName), Buffer.from(screenshot.data, "base64"));
  console.log(`Captured ${fileName}`);
}

async function captureScrolled(client, sessionId, path, fileName, marker, scrollY) {
  await client.send("Page.navigate", { url: `${appUrl}${path}` }, sessionId);
  await waitForPageReady(client, sessionId, marker);
  await client.send(
    "Runtime.evaluate",
    { expression: `window.scrollTo(0, ${Number(scrollY) || 0});` },
    sessionId,
  );
  await wait(600);
  const screenshot = await client.send(
    "Page.captureScreenshot",
    { format: "png", fromSurface: true },
    sessionId,
  );
  await writeFile(join(outputDir, fileName), Buffer.from(screenshot.data, "base64"));
  console.log(`Captured ${fileName}`);
}

async function capturePromptSettings(client, sessionId) {
  await client.send("Page.navigate", { url: `${appUrl}/settings/system` }, sessionId);
  await waitForPageReady(client, sessionId, "提示词配置");
  await client.send(
    "Runtime.evaluate",
    {
      expression: `
        window.scrollTo(0, 1200);
        setTimeout(() => {
          const tabs = Array.from(document.querySelectorAll('.ant-tabs-tab'));
          const resumeTab = tabs.find((node) => node.innerText.includes('简历分析'));
          if (resumeTab) resumeTab.click();
        }, 100);
      `,
    },
    sessionId,
  );
  await wait(1000);
  const screenshot = await client.send(
    "Page.captureScreenshot",
    { format: "png", fromSurface: true },
    sessionId,
  );
  await writeFile(join(outputDir, "prompt-settings.png"), Buffer.from(screenshot.data, "base64"));
  console.log("Captured prompt-settings.png");
}

async function main() {
  await mkdir(outputDir, { recursive: true });
  await generateDemoResumePdfs();
  await rm(userDataDir, { recursive: true, force: true });

  const token = await login();
  const chrome = spawn(chromePath, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${chromePort}`,
    `--user-data-dir=${userDataDir}`,
    "--window-size=1440,1000",
    "about:blank",
  ], { stdio: "ignore" });

  try {
    const version = await waitForChrome();
    const client = new CdpClient(version.webSocketDebuggerUrl);
    await client.open();
    const { targetId } = await client.send("Target.createTarget", { url: `${appUrl}/login` });
    const { sessionId } = await client.send("Target.attachToTarget", { targetId, flatten: true });

    await client.send("Page.enable", {}, sessionId);
    await client.send("Runtime.enable", {}, sessionId);
    await client.send(
      "Emulation.setDeviceMetricsOverride",
      { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false },
      sessionId,
    );
    await waitForPageReady(client, sessionId, "AI 智能面试系统");
    await client.send(
      "Runtime.evaluate",
      {
        expression: `localStorage.setItem("token", ${JSON.stringify(token)}); location.href = "/dashboard";`,
      },
      sessionId,
    );
    await waitForPageReady(client, sessionId, "招聘漏斗");

    const resumes = await apiGet("/resumes", token);
    const interviews = await apiGet("/interviews", token);
    const resumeForAi = resumes.find((item) => item.candidate_name === "刘悦") || resumes[0];
    const scoreInterview = interviews.find((item) => item.resume?.candidate_name === "王辰") || interviews.find((item) => item.status === "scheduled");
    const resultInterview = interviews.find((item) => item.resume?.candidate_name === "唐青") || interviews.find((item) => item.status === "completed");

    await capture(client, sessionId, "/dashboard", "dashboard.png", "招聘漏斗");
    await capture(client, sessionId, "/positions", "positions.png", "Demo AI 平台后端工程师");
    await capture(client, sessionId, "/resumes", "resumes.png", "刘悦");
    if (resumeForAi?.id) {
      await capture(client, sessionId, `/resumes/${resumeForAi.id}`, "resume-ai-analysis.png", "AI 初审评价");
    }
    await capture(client, sessionId, "/interviews", "interviews.png", "王辰");
    if (scoreInterview?.id) {
      await capture(client, sessionId, `/interviews/${scoreInterview.id}/score`, "interview-score.png", "面试评分");
    }
    if (resultInterview?.id) {
      await capture(client, sessionId, `/interviews/${resultInterview.id}/result`, "interview-ai-result.png", "AI 综合面试分析");
    }
    await capture(client, sessionId, "/coding-tests", "coding-tests.png", "Demo 后端工程师在线笔试");
    await capture(client, sessionId, "/workflows", "workflows.png", "Demo 高匹配候选人自动推进");
    await capture(client, sessionId, "/settings/system", "ai-model-settings.png", "模型配置");
    await capturePromptSettings(client, sessionId);

    const publicPosition = await fetch(`${apiUrl}/positions/public`).then((res) => res.json());
    const demoPublic = publicPosition.find((item) => item.title?.startsWith("Demo ")) || publicPosition[0];
    if (demoPublic?.id) {
      await capture(client, sessionId, `/public/jobs/${demoPublic.id}`, "public-job.png", demoPublic.title);
    }

    client.close();
  } finally {
    chrome.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
