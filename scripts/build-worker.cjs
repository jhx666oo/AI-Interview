/**
 * 构建 Pages Functions（functions/ 目录模式）入口。
 * 在 `npm run build` 后自动执行。
 *
 * 背景：Pages Advanced Mode（_worker.js）在部分项目上不生效（部署成功但
 * Functions 不更新），改用 Cloudflare 最稳定老牌的 functions/ 目录模式：
 *   - dist/_worker_src.mjs      ：esbuild 打包 worker/src/index.ts（保留 default export）
 *   - dist/functions/[[route]].js：Functions 入口，onRequest 转发给 Hono app.fetch
 * 注意：dist 里不能再有 _worker.js（Advanced Mode 优先于 functions/，会互相冲突）。
 *
 * 使用 esbuild Node API（避免 macOS 沙箱拦截 esbuild CLI 的问题）
 * 用法：node scripts/build-worker.cjs
 */
const path = require('path');
const fs = require('fs');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const WORKER_SRC = path.resolve(PROJECT_ROOT, 'worker', 'src', 'index.ts');
const DIST_DIR = path.resolve(PROJECT_ROOT, 'frontend', 'dist');
const WORKER_BUNDLE = path.join(DIST_DIR, '_worker_src.mjs');
const FUNCTIONS_ENTRY = path.join(DIST_DIR, 'functions', '[[route]].js');

// 从 worker/node_modules 加载 esbuild（避免沙箱拦截 CLI 包装脚本）
const esbuildPaths = [
  path.resolve(PROJECT_ROOT, 'worker', 'node_modules', 'esbuild'),
  path.resolve(PROJECT_ROOT, 'node_modules', 'esbuild'),
];

let esbuild;
for (const p of esbuildPaths) {
  try {
    esbuild = require(p);
    break;
  } catch {}
}
if (!esbuild) {
  console.error('[build-worker] ❌ 找不到 esbuild 模块，请确认已安装');
  process.exit(1);
}

console.log('[build-worker] 开始编译 Pages Functions（functions/ 目录模式）...');
console.log(`  源文件: ${WORKER_SRC}`);
console.log(`  输出:   ${FUNCTIONS_ENTRY} (+ ${WORKER_BUNDLE})`);

async function main() {
  // 1) 打包 worker 源码（保留 default export { fetch, scheduled }）
  await esbuild.build({
    entryPoints: [WORKER_SRC],
    bundle: true,
    outfile: WORKER_BUNDLE,
    format: 'esm',
    platform: 'browser',
    target: 'es2021',
    minify: true,
    external: ['__STATIC_CONTENT_MANIFEST'],
  });
  console.log('[build-worker] ✅ _worker_src.mjs 编译成功');

  // 2) 删除 dist/_worker.js，避免 Advanced Mode 与 functions/ 冲突
  const legacyWorker = path.join(DIST_DIR, '_worker.js');
  if (fs.existsSync(legacyWorker)) {
    fs.rmSync(legacyWorker);
    console.log('[build-worker] 🗑️  已移除 dist/_worker.js（改用 functions/ 目录模式）');
  }

  // 3) 生成 functions/[[route]].js 入口
  fs.mkdirSync(path.dirname(FUNCTIONS_ENTRY), { recursive: true });
  fs.writeFileSync(
    FUNCTIONS_ENTRY,
    [
      "import mod from '../_worker_src.mjs';",
      '',
      '/** 由 build-worker.cjs 自动生成：把全部请求转发给 Hono app */',
      'export const onRequest = async (context) => {',
      '  const response = await mod.fetch(context.request, context.env, context);',
      '  return response;',
      '};',
      '',
    ].join('\n'),
    'utf8',
  );
  console.log(`[build-worker] ✅ ${FUNCTIONS_ENTRY} 生成成功`);
}

main().catch((err) => {
  console.error('[build-worker] ❌ 编译失败:', err);
  process.exit(1);
});
