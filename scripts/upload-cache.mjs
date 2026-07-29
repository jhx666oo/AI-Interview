/**
 * 上传已下载的 PDF 到 Worker D1 缓存
 * 使用 ?secret=SECRET_KEY 绕过 JWT 认证
 *
 * ⚠️ 运行前请设置环境变量：
 *   set SECRET_KEY=your_secret_key
 *   set FEISHU_APP_ID=your_app_id
 *   set FEISHU_APP_SECRET=your_app_secret
 *   set FEISHU_APP_TOKEN=your_bitable_app_token
 */
import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..');
const WORKER_DIR = join(__dirname, '..', 'worker');
const BASE = 'https://ai-interview-88r.pages.dev';
const SECRET_KEY = process.env.SECRET_KEY || '';

// hiring-platform: https://hiring-platform-ex4.pages.dev

const FEISHU_CONFIG = {
  appId: process.env.FEISHU_APP_ID || '',
  appSecret: process.env.FEISHU_APP_SECRET || '',
  appToken: process.env.FEISHU_APP_TOKEN || '',
  talentTableId: 'tblWkwsoTIPhzusI',
};

async function getFeishuToken() {
  const resp = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: FEISHU_CONFIG.appId, app_secret: FEISHU_CONFIG.appSecret }),
  });
  const data = await resp.json();
  if (data.code !== 0) throw new Error(`获取 token 失败: ${JSON.stringify(data)}`);
  return data.tenant_access_token;
}

async function listRecords(token, pageToken = null) {
  const params = new URLSearchParams({ page_size: '100' });
  if (pageToken) params.set('page_token', pageToken);
  const resp = await fetch(
    `https://open.feishu.cn/open-apis/bitable/v1/apps/${FEISHU_CONFIG.appToken}/tables/${FEISHU_CONFIG.talentTableId}/records?${params}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await resp.json();
  if (data.code !== 0) throw new Error(`查询 Bitable 失败: ${JSON.stringify(data)}`);
  return data.data;
}

function findFileInfo(record) {
  for (const [key, val] of Object.entries(record.fields || {})) {
    if (Array.isArray(val)) {
      for (const item of val) {
        if (item?.file_token) return { fileToken: item.file_token, tmpUrl: item.tmp_url, fileName: item.name || key };
      }
    }
  }
  return null;
}

async function downloadPdf(token, fileToken, tmpUrl) {
  const batchUrl = tmpUrl + '&file_tokens=' + fileToken;
  const resp = await fetch(batchUrl, { headers: { Authorization: `Bearer ${token}` } });
  const json = await resp.json();
  if (json.code !== 0 || !json.data?.tmp_download_urls?.[0]?.tmp_download_url) return null;
  const downloadUrl = json.data.tmp_download_urls[0].tmp_download_url;
  const fileResp = await fetch(downloadUrl, { redirect: 'follow' });
  if (!fileResp.ok) return null;
  const buf = await fileResp.arrayBuffer();
  return buf;
}

async function httpUpload(recordId, fileBuffer, fileName) {
  // 构造 form-data
  const boundary = '----' + Math.random().toString(36).slice(2);
  let body = '';
  body += `--${boundary}\r\n`;
  body += `Content-Disposition: form-data; name="file"; filename="${fileName.replace(/"/g, '_')}"\r\n`;
  body += `Content-Type: application/pdf\r\n\r\n`;
  // Binary part
  const encoder = new TextEncoder();
  const bodyStart = encoder.encode(body);
  const bodyEnd = encoder.encode(`\r\n--${boundary}\r\n`);
  body += `Content-Disposition: form-data; name="name"\r\n\r\n${fileName.replace(/\.pdf$/i, '')}\r\n`;
  body += `--${boundary}--\r\n`;
  const bodyEnd2 = encoder.encode(body);

  // Combine: header + binary + footer
  const totalLength = bodyStart.length + fileBuffer.byteLength + bodyEnd2.length;
  const combined = new Uint8Array(totalLength);
  combined.set(bodyStart, 0);
  combined.set(new Uint8Array(fileBuffer), bodyStart.length);
  combined.set(bodyEnd2, bodyStart.length + fileBuffer.byteLength);

  const resp = await fetch(`${BASE}/api/resumes/${recordId}/cache-file?secret=${encodeURIComponent(SECRET_KEY)}`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body: combined,
  });
  return resp.ok;
}

async function main() {
  console.log('=== 批量上传 PDF 到 D1 ===\n');
  
  // 1. 获取飞书 token
  console.log('[1] 获取飞书 token...');
  const token = await getFeishuToken();
  console.log('  ✅\n');

  // 2. 查询所有记录
  console.log('[2] 查询人才库 Bitable...');
  let allRecords = [];
  let pageToken = null;
  do {
    const data = await listRecords(token, pageToken);
    allRecords = allRecords.concat(data.items || []);
    pageToken = data.has_more ? data.page_token : null;
  } while (pageToken);
  console.log(`  ✅ ${allRecords.length} 条\n`);

  // 3. 筛选有附件的
  const files = [];
  for (const record of allRecords) {
    const info = findFileInfo(record);
    if (info) files.push({ recordId: record.record_id, ...info });
  }
  console.log(`  ✅ ${files.length} 条有附件\n`);

  // 4. 检查已有缓存
  try {
    const out = execSync('wrangler d1 execute ai-interview-db --remote --command "SELECT id FROM resume_files"', {
      cwd: WORKER_DIR, encoding: 'utf-8', timeout: 30000,
    });
    const json = JSON.parse(out.match(/\[[\s\S]*\]/)?.[0] || '[]');
    const existingIds = new Set((json[0]?.results || []).map(r => r.id));
    console.log(`  已有 ${existingIds.size} 条缓存\n`);

    // 过滤掉已缓存的
    const toUpload = files.filter(f => !existingIds.has(f.recordId));
    console.log(`  需要上传: ${toUpload.length} 条\n`);

    if (toUpload.length === 0) {
      console.log('无需上传，都已缓存。');
      return;
    }

    // 5. 下载并上传
    console.log('[5] 下载并上传...');
    let success = 0, fail = 0;
    for (let i = 0; i < toUpload.length; i++) {
      const r = toUpload[i];
      process.stdout.write(`  [${i+1}/${toUpload.length}] ${r.fileName.substring(0, 36)}... `);

      const buf = await downloadPdf(token, r.fileToken, r.tmpUrl);
      if (!buf || new TextDecoder().decode(new Uint8Array(buf.slice(0, 5))) !== '%PDF-') {
        process.stdout.write('❌ 下载失败\n');
        fail++;
        continue;
      }

      const ok = await httpUpload(r.recordId, buf, r.fileName);
      if (ok) {
        process.stdout.write(`✅ ${(buf.byteLength/1024).toFixed(0)} KB\n`);
        success++;
      } else {
        process.stdout.write('❌ 上传失败\n');
        fail++;
      }
    }

    console.log(`\n=== 完成 ===`);
    console.log(`✅ 成功: ${success}`);
    console.log(`❌ 失败: ${fail}`);
  } catch (e) {
    console.error('错误:', e.message);
  }
}

main().catch(e => console.error('异常:', e));
