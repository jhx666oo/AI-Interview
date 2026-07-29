#!/usr/bin/env node
/**
 * 上线前自检脚本（2026-07-29 上线自检流程改造）
 *
 * 检查项：
 *   1. 构建产物存在性与新鲜度（dist/_worker.js、dist/index.html）
 *   2. Worker 产物路由完整性（feishu/config、operation-logs、cron 鉴权）
 *   3. 明文密钥扫描（源码/配置中不得出现已知密钥模式）
 *   4. wrangler.toml 不得含明文 SECRET_KEY / AI_API_KEY / *_SECRET
 *   5. 旧 URL（ai-interview-22u）残留扫描
 *
 * 用法：node scripts/pre-deploy-check.mjs
 * 约定：任何一项失败 exit 1，禁止部署。
 * 标准部署流程：
 *   cd frontend && rm -rf dist node_modules/.vite && npm run build \
 *     && node ../scripts/pre-deploy-check.mjs \
 *     && CLOUDFLARE_ACCOUNT_ID=ed758fc82ca4400593ddb447d3db57a4 npx wrangler pages deploy dist
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'frontend', 'dist');
const WORKER_JS = path.join(DIST, '_worker.js');

let failed = 0;
const ok = (msg) => console.log(`  ✅ ${msg}`);
const fail = (msg) => { failed++; console.error(`  ❌ ${msg}`); };

console.log('== 上线前自检 ==\n');

// 1. 构建产物
console.log('[1] 构建产物检查');
if (!fs.existsSync(WORKER_JS)) fail('dist/_worker.js 不存在，请先 npm run build');
else {
  const age = Date.now() - fs.statSync(WORKER_JS).mtimeMs;
  if (age > 30 * 60 * 1000) fail(`dist/_worker.js 已超过 30 分钟未重新构建（${Math.round(age / 60000)} 分钟前），请重新 build`);
  else ok(`_worker.js 存在且新鲜（${Math.round(age / 1000)}s 前构建）`);
}
if (!fs.existsSync(path.join(DIST, 'index.html'))) fail('dist/index.html 不存在');
else ok('index.html 存在');

// 2. Worker 产物路由完整性
console.log('\n[2] Worker 产物路由完整性');
if (fs.existsSync(WORKER_JS)) {
  const worker = fs.readFileSync(WORKER_JS, 'utf8');
  for (const marker of ['feishu/config', 'operation_logs', 'X-Cron-Secret', 'notify-interviewer']) {
    if (worker.includes(marker)) ok(`产物包含 ${marker}`);
    else fail(`产物缺失 ${marker} —— 可能是旧产物覆盖（检查 public/ 下是否混入 _worker.js）`);
  }
}

// 3. 明文密钥扫描（源码目录）
console.log('\n[3] 明文密钥扫描');
const SECRET_PATTERNS = [
  { re: /sk-[a-f0-9]{32}/g, name: 'DeepSeek/OpenAI 风格 API Key (sk-...)' },
  { re: /appSecret:\s*['"][A-Za-z0-9]{20,}['"]/g, name: '飞书 appSecret 明文' },
  { re: /app_secret['"]?\s*[:=]\s*['"][A-Za-z0-9]{20,}['"]/g, name: 'app_secret 明文' },
];
const SCAN_DIRS = [
  path.join(ROOT, 'worker', 'src'),
  path.join(ROOT, 'frontend', 'src'),
  path.join(ROOT, 'scripts'),
];
const scanFiles = [];
const walk = (dir) => {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(ts|tsx|js|mjs|cjs|toml|json)$/.test(e.name)) scanFiles.push(p);
  }
};
SCAN_DIRS.forEach(walk);
scanFiles.push(path.join(ROOT, 'frontend', 'wrangler.toml'), path.join(ROOT, 'worker', 'wrangler.toml'));
let secretHits = 0;
for (const f of scanFiles) {
  if (!fs.existsSync(f)) continue;
  const content = fs.readFileSync(f, 'utf8');
  for (const { re, name } of SECRET_PATTERNS) {
    re.lastIndex = 0;
    if (re.test(content)) { fail(`${path.relative(ROOT, f)} 命中「${name}」`); secretHits++; }
  }
}
if (secretHits === 0) ok(`扫描 ${scanFiles.length} 个文件，无明文密钥`);

// 4. wrangler.toml 明文密钥键
console.log('\n[4] wrangler.toml 检查');
for (const toml of [path.join(ROOT, 'frontend', 'wrangler.toml'), path.join(ROOT, 'worker', 'wrangler.toml')]) {
  if (!fs.existsSync(toml)) continue;
  const content = fs.readFileSync(toml, 'utf8');
  const bad = content.match(/^(SECRET_KEY|AI_API_KEY|FEISHU_APP_SECRET|CRON_SECRET)\s*=\s*"[^"]+"/m);
  if (bad) fail(`${path.relative(ROOT, toml)} 含明文密钥 ${bad[1]}（应使用 wrangler pages secret put）`);
  else ok(`${path.relative(ROOT, toml)} 无明文密钥键`);
}

// 5. 旧 URL 残留
console.log('\n[5] 旧 URL 残留扫描');
let urlHits = 0;
const SELF = fileURLToPath(import.meta.url);
const OLD_URL = ['ai-interview-', '22u'].join(''); // 拆开拼接，避免自检脚本自身命中
for (const f of scanFiles) {
  if (!fs.existsSync(f) || path.resolve(f) === SELF) continue;
  if (fs.readFileSync(f, 'utf8').includes(OLD_URL)) { fail(`${path.relative(ROOT, f)} 含旧 URL ${OLD_URL}`); urlHits++; }
}
if (urlHits === 0) ok('无旧 URL 残留');

console.log(`\n== 自检${failed ? '未通过' : '通过'}：${failed} 项失败 ==`);
process.exit(failed ? 1 : 0);
