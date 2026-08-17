/**
 * AI 模型配置槽位（llm_slots）合并与去重。
 * 前端出于安全不回填完整 API Key，已保存槽位（携带 id）未重填 key 时需沿用原 key，
 * 否则整体替换会丢失已有模型配置。
 */

export type LLMSlot = {
  id: string;
  baseUrl: string;
  model: string;
  apiKey: string;
};

/** 纠正常见的错误 Base URL 尾部斜杠（与 index.ts normalizeBaseUrl 行为一致） */
function normalizeBaseUrl(raw: string): string {
  const u = (raw || '').trim();
  if (!u) return '';
  const lower = u.toLowerCase().replace(/\/+$/, '');
  if (lower.includes('platform.deepseek.com')) return 'https://api.deepseek.com';
  return u.replace(/\/+$/, '');
}

/** 把 DB 读取结果（可能是 JSON 字符串或数组）规范化为槽位对象数组 */
function toSlotArray(v: unknown): any[] {
  if (Array.isArray(v)) return v.filter((s) => s && typeof s === 'object');
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) return parsed.filter((s) => s && typeof s === 'object');
    } catch { /* 忽略非法 JSON */ }
  }
  return [];
}

/**
 * 合并 llm_slots 保存请求：
 * 1. 未重填 key 的已存槽位（按 id 匹配，兼容按保存顺序回退）沿用原 key，避免整体覆盖丢失；
 * 2. 按 (baseUrl, model, apiKey) 精确去重，重复配置只保留第一个；
 * 3. 为每个槽位补齐稳定 id（新槽位生成 uuid，旧槽位保留原 id）。
 */
export function mergeLlmSlots(
  existingSlots: unknown,
  incomingSlots: unknown,
  newId: () => string = () => crypto.randomUUID(),
): LLMSlot[] {
  const existing = toSlotArray(existingSlots);
  const existingById = new Map<string, any>();
  existing.forEach((s: any) => { if (s.id) existingById.set(String(s.id), s); });

  const incoming = toSlotArray(incomingSlots);
  const seen = new Set<string>();
  const result: LLMSlot[] = [];
  let idxFallback = 0;

  for (const raw of incoming) {
    const s: any = raw;
    const baseUrl = normalizeBaseUrl(String(s.baseUrl || s.base_url || '').trim());
    const model = String(s.model || '').trim();
    const apiKey = String(s.apiKey || s.api_key || '').trim();

    // 未重填 key：优先按 id 沿用原 key，其次按保存顺序（index）回退匹配旧数据（无 id 的存量槽位）
    let finalKey = apiKey;
    if (!finalKey) {
      const byId = s.id ? existingById.get(String(s.id)) : undefined;
      if (byId?.apiKey) {
        finalKey = String(byId.apiKey).trim();
      } else {
        const legacy = existing[idxFallback];
        if (legacy?.apiKey && String(legacy.apiKey).trim()) {
          finalKey = String(legacy.apiKey).trim();
        }
        idxFallback++;
      }
    } else {
      idxFallback++;
    }

    if (!finalKey || !model) continue; // 无 key 或无模型名，无法使用

    const dedupeKey = `${baseUrl}\u0000${model}\u0000${finalKey}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    result.push({
      id: s.id && existingById.has(String(s.id)) ? String(s.id) : newId(),
      baseUrl,
      model,
      apiKey: finalKey,
    });
  }
  return result;
}
