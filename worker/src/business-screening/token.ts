const TOKEN_BYTE_LENGTH = 32;

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function hashPublicToken(token: string): Promise<string> {
  const encoded = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return toHex(new Uint8Array(digest));
}

export async function createPublicToken(): Promise<{ token: string; tokenHash: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_BYTE_LENGTH));
  const token = toBase64Url(bytes);
  return {
    token,
    tokenHash: await hashPublicToken(token),
  };
}

// 固定业务范围链接：同一 scope（岗位+面试官）的批次在 30 天有效期内复用同一个 batchId，
// token = SHA-256(scopeKey + '::' + batchId)，因此有效期内链接恒定唯一；
// 批次过期后新建批次（新 batchId）→ 生成新链接（新 30 天周期）。
export async function createScopePublicToken(
  scopeKey: string,
  batchId: string,
): Promise<{ token: string; tokenHash: string }> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${scopeKey}::${batchId}`));
  const token = `bs-${toBase64Url(new Uint8Array(digest)).slice(0, 28)}`;
  return {
    token,
    tokenHash: await hashPublicToken(token),
  };
}
