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

// 固定业务范围链接的周期长度：30 天
export const SCOPE_TOKEN_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

/** 计算当前所在链接周期序号：同一周期内链接保持唯一稳定，跨周期自然生成新链接 */
export function scopeTokenPeriodIndex(nowMs: number): number {
  return Math.floor(nowMs / SCOPE_TOKEN_PERIOD_MS);
}

/**
 * 生成"岗位+面试官"业务范围的确定性链接 token。
 * token = SHA-256(scopeKey + '::' + periodIndex)，同一周期内同 scope 的 token 恒定，
 * 因此同一业务范围（如魏秋柠筛某岗位）的链接固定唯一、可复用于多次推送；
 * 30 天周期结束后 periodIndex 变化 → token 变化 → 生成新链接。
 */
export async function createScopePublicToken(
  scopeKey: string,
  nowIso: string,
): Promise<{ token: string; tokenHash: string; periodIndex: number }> {
  const periodIndex = scopeTokenPeriodIndex(Date.parse(nowIso));
  const material = `${scopeKey}::${periodIndex}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
  const token = `bs-${toBase64Url(new Uint8Array(digest)).slice(0, 28)}`;
  return {
    token,
    tokenHash: await hashPublicToken(token),
    periodIndex,
  };
}
