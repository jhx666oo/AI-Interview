// ==================== Crypto Utilities ====================

async function hmacSha256(key: string, message: string): Promise<ArrayBuffer> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw', enc.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  );
  return crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message));
}

function bufToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function b64ToBuf(s: string): Uint8Array {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function b64url(s: string): string {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlBuf(buf: ArrayBuffer): string {
  return bufToB64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function createJwt(secretKey: string, email: string): Promise<string> {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const exp = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
  const payload = b64url(JSON.stringify({ sub: email, exp }));
  const data = `${header}.${payload}`;
  const sig = await hmacSha256(secretKey, data);
  return `${data}.${b64urlBuf(sig)}`;
}

export async function verifyJwt(secretKey: string, token: string): Promise<any | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts;
  const data = `${header}.${payload}`;
  const expectedSig = b64urlBuf(await hmacSha256(secretKey, data));
  if (sig !== expectedSig) return null;
  try {
    const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const obj = JSON.parse(decoded);
    if (obj.exp && obj.exp < Math.floor(Date.now() / 1000)) return null;
    return obj;
  } catch { return null; }
}

export async function hashPassword(secretKey: string, password: string): Promise<string> {
  return bufToB64(await hmacSha256(secretKey, password));
}

export async function verifyPassword(secretKey: string, password: string, hash: string): Promise<boolean> {
  const computed = await hashPassword(secretKey, password);
  return computed === hash;
}
