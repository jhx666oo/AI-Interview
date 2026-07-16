/**
 * 飞书多维表格 → AI Interview 需求同步脚本
 * 
 * 方式1: 直接通过 Worker API 同步（推荐，需要 Worker 已部署且有飞书凭证）
 *   node scripts/sync-feishu.mjs --api https://你的域名/api
 * 
 * 方式2: 本地使用 lark-cli 拉取数据后推送给 Worker API
 *   node scripts/sync-feishu.mjs --local --api https://你的域名/api
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_FILE = path.join(__dirname, 'feishu_requisitions_raw.json');

const args = process.argv.slice(2);
const apiBase = args.find(a => a.startsWith('--api='))?.split('=')[1] || 'http://localhost:5173';
const useLocal = args.includes('--local');
const token = args.find(a => a.startsWith('--token='))?.split('=')[1];

async function main() {
  console.log('=== 飞书多维表格 → AI Interview 需求同步 ===\n');

  let result;

  if (useLocal) {
    // 本地模式：用 lark-cli 获取数据
    console.log('[1/3] 从飞书获取需求数据...');
    const output = execSync(
      'lark-cli base +record-list --base-token NVh9bDiNRaF0ZysxjeLc5ID2n9c --table-id tblEiMBFXcvSspQd --page-size 500 --format json',
      { encoding: 'utf-8', timeout: 30000 }
    );
    fs.writeFileSync(RAW_FILE, output);
    console.log(`  ✅ 已保存到 ${RAW_FILE}`);
  } else {
    // 直接走 Worker API（推荐）
    console.log('[1/3] 直接通过 Worker API 同步...');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const resp = await fetch(`${apiBase}/requisitions/sync-feishu`, {
      method: 'POST',
      headers,
    });
    result = await resp.json();
    if (result.ok) {
      console.log(`  ✅ ${result.message}`);
    } else {
      console.error(`  ❌ ${result.detail}`);
      process.exit(1);
    }
    return;
  }

  // 本地模式后续步骤
  console.log('\n[2/3] 获取 API Token...');
  let authToken = token;
  if (!authToken) {
    // 从登录接口获取
    const loginResp = await fetch(`${apiBase}/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'username=admin@example.com&password=admin123',
    });
    const loginData = await loginResp.json();
    authToken = loginData.access_token;
    if (!authToken) {
      console.error('  ❌ 无法获取 API Token，请通过 --token=xxx 传入');
      process.exit(1);
    }
    console.log('  ✅ 已获取 Token');
  }

  console.log('\n[3/3] 推送数据到 Worker...');
  const syncResp = await fetch(`${apiBase}/requisitions/sync-feishu`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`,
    },
  });
  result = await syncResp.json();
  if (result.ok) {
    console.log(`  ✅ ${result.message}`);
  } else {
    console.error(`  ❌ ${result.detail}`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('同步失败:', err.message);
  process.exit(1);
});
