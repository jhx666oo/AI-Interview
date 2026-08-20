export const DEFAULT_MIAODA_MAIL_SYNC_BASE_URL =
  'https://ywwlaii6ga7.feishuapp.com/app/app_17cg57ghxq5/openapi/mail-sync';

export interface MiaodaMailSyncEnv {
  MIAODA_MAIL_SYNC_BASE_URL?: string;
  MIAODA_API_KEY?: string;
}

export function getMiaodaMailSyncConfig(env: MiaodaMailSyncEnv): {
  baseUrl: string;
  apiKey: string;
} {
  const baseUrl = env.MIAODA_MAIL_SYNC_BASE_URL?.trim() || DEFAULT_MIAODA_MAIL_SYNC_BASE_URL;
  const apiKey = env.MIAODA_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('MIAODA_API_KEY 未配置');
  }
  return { baseUrl: baseUrl.replace(/\/$/, ''), apiKey };
}
