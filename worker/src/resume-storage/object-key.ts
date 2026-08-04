/**
 * 确定性、无 PII 的对象键生成
 * 格式: {type}/{resumeId}/{version}_{timestamp}
 * 不包含候选人姓名、邮箱、电话等 PII
 */

export function generateObjectKey(
  type: string,
  resumeId: string,
  version: number = 1,
  timestamp?: string
): string {
  const ts = timestamp ?? new Date().toISOString().replace(/[:.]/g, '-');
  return `${type}/${resumeId}/${version}_${ts}`;
}

export function generateArtifactId(): string {
  return `art_${crypto.randomUUID()}`;
}

export function parseObjectKey(objectKey: string): {
  type: string;
  resumeId: string;
  version: number;
  timestamp: string;
} | null {
  const parts = objectKey.split('/');
  if (parts.length < 3) return null;
  const type = parts[0];
  const resumeId = parts[1];
  const versionPart = parts[2] ?? '';
  const underscoreIdx = versionPart.indexOf('_');
  if (underscoreIdx === -1) return null;
  const version = parseInt(versionPart.substring(0, underscoreIdx), 10);
  const timestamp = versionPart.substring(underscoreIdx + 1);
  if (isNaN(version)) return null;
  return { type, resumeId, version, timestamp };
}
