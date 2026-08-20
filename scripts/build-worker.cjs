/**
 * 构建 _worker.js（Pages Advanced Mode）
 * 在 `npm run build` 后自动执行，确保 _worker.js 用最新源码编译
 *
 * 使用 esbuild Node API（避免 macOS 沙箱拦截 esbuild CLI 的问题）
 * 用法：node scripts/build-worker.cjs
 */
const path = require('path');
const fs = require('fs');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const WORKER_SRC = path.resolve(PROJECT_ROOT, 'worker', 'src', 'index.ts');
const OUT_FILE = path.resolve(PROJECT_ROOT, 'frontend', 'dist', '_worker.js');

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

console.log('[build-worker] 开始编译 _worker.js...');
console.log(`  源文件: ${WORKER_SRC}`);
console.log(`  输出:   ${OUT_FILE}`);

esbuild
  .build({
    entryPoints: [WORKER_SRC],
    bundle: true,
    outfile: OUT_FILE,
    format: 'esm',
    platform: 'browser',
    target: 'es2021',
    minify: true,
    external: ['__STATIC_CONTENT_MANIFEST'],
  })
  .then(() => {
    console.log('[build-worker] ✅ _worker.js 编译成功');
  })
  .catch((err) => {
    console.error('[build-worker] ❌ 编译失败:', err);
    process.exit(1);
  });
