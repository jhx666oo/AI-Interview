/**
 * Setup script: Add CLOUDFLARE_API_TOKEN as a GitHub Actions secret
 * 
 * Usage: node scripts/setup-github-secret.mjs <github-token>
 * 
 * You need a GitHub Personal Access Token with `repo` scope.
 * Create one at: https://github.com/settings/tokens
 * 
 * Then run:
 *   node scripts/setup-github-secret.mjs ghp_xxxxxxxxxxxx
 */
import { execSync } from 'child_process';

const GITHUB_TOKEN = process.argv[2];
const CLOUDFLARE_TOKEN = process.env.CLOUDFLARE_API_TOKEN || '';

if (!GITHUB_TOKEN) {
  console.log('❌ 请提供 GitHub Token');
  console.log('用法: node scripts/setup-github-secret.mjs <github-token>');
  console.log('');
  console.log('也请先设置 CLOUDFLARE_API_TOKEN 环境变量，');
  console.log('或者在 Cloudflare 创建 API Token 后粘贴过来。');
  process.exit(1);
}

// First, get the repo's public key
async function main() {
  // Get public key
  const keyResp = await fetch('https://api.github.com/repos/huangwei-gem/zpzt/actions/secrets/public-key', {
    headers: { Authorization: `token ${GITHUB_TOKEN}` },
  });
  if (!keyResp.ok) {
    const err = await keyResp.text();
    console.error('❌ 获取公钥失败:', err);
    process.exit(1);
  }
  const { key_id, key } = await keyResp.json();
  console.log('✅ 获取 GitHub 公钥成功');

  // Encrypt the secret using libsodium
  // We need sodium to encrypt the value
  // Simple XOR won't work - GitHub uses libsodium sealed box
  // Let's use a subprocess to call node with sodium-universal
  
  const secretValue = CLOUDFLARE_TOKEN || (await promptForToken());
  
  // Encrypt using sodium
  const sodium = (await import('sodium-universal')).sodium;
  const binKey = Buffer.from(key, 'base64');
  const ciphertext = Buffer.alloc(sodium.crypto_box_SEALBYTES + secretValue.length);
  sodium.crypto_box_seal(ciphertext, Buffer.from(secretValue), binKey);
  const encryptedValue = ciphertext.toString('base64');
  
  // Set the secret
  const setResp = await fetch('https://api.github.com/repos/huangwei-gem/zpzt/actions/secrets/CLOUDFLARE_API_TOKEN', {
    method: 'PUT',
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      encrypted_value: encryptedValue,
      key_id,
    }),
  });
  
  if (setResp.ok) {
    console.log('✅ CLOUDFLARE_API_TOKEN 已设置成功！');
    console.log('下次 push 到 main 分支时会自动部署到 Cloudflare Pages。');
  } else {
    console.error('❌ 设置失败:', await setResp.text());
  }
}

function promptForToken() {
  return new Promise((resolve) => {
    console.log('\n⚠️ 未设置 CLOUDFLARE_API_TOKEN 环境变量');
    console.log('请先创建一个 Cloudflare API Token:');
    console.log('1. 打开 https://dash.cloudflare.com/profile/api-tokens');
    console.log('2. 点击 "Create Token"');
    console.log('3. 选择 "Edit Cloudflare Workers" 模板');
    console.log('4. 在 Permissions 中添加: Account > Cloudflare Pages > Edit');
    console.log('5. 复制生成的 token\n');
    process.exit(1);
  });
}

main().catch(console.error);
