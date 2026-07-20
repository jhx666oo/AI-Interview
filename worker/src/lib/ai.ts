// ==================== AI Config & Helpers ====================

import { now } from './db';

export function extractJSON(text: string): any {
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const start = cleaned.search(/[\[\{]/);
  const end = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'));
  if (start >= 0 && end > start) {
    return JSON.parse(cleaned.substring(start, end + 1));
  }
  return JSON.parse(cleaned);
}

// ==================== AI 每日 Token 限额 ====================
const DEFAULT_DAILY_TOKEN_LIMIT = 1_000_000;

export function getDailyTokenLimit(env: any): number {
  const v = env.AI_DAILY_TOKEN_LIMIT ? parseInt(env.AI_DAILY_TOKEN_LIMIT, 10) : NaN;
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_DAILY_TOKEN_LIMIT;
}

export function todayStr(): string {
  const nowDate = new Date(Date.now() + 8 * 3600 * 1000);
  return nowDate.toISOString().slice(0, 10);
}

export async function ensureAiUsageTable(env: any): Promise<void> {
  try {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS ai_usage (date TEXT PRIMARY KEY, total_tokens INTEGER DEFAULT 0, updated_at TEXT)`
    ).run();
  } catch (e) {
    console.error('[AI] ensureAiUsageTable failed:', e);
  }
}

export async function getTodayTokenUsage(env: any): Promise<number> {
  try {
    const row = await env.DB.prepare('SELECT total_tokens FROM ai_usage WHERE date = ?')
      .bind(todayStr()).first() as any;
    return row?.total_tokens || 0;
  } catch { return 0; }
}

export async function addTokenUsage(env: any, tokens: number): Promise<void> {
  if (!tokens || tokens <= 0) return;
  try {
    await env.DB.prepare(
      `INSERT INTO ai_usage (date, total_tokens, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(date) DO UPDATE SET total_tokens = total_tokens + excluded.total_tokens, updated_at = excluded.updated_at`
    ).bind(todayStr(), tokens, new Date().toISOString()).run();
  } catch (e) {
    console.error('[AI] addTokenUsage failed:', e);
  }
}

export async function getCustomPrompt(env: any, key: string): Promise<{ system: string; user: string } | null> {
  try {
    const row = await env.DB.prepare(
      'SELECT prompt_configs FROM system_configs ORDER BY updated_at DESC LIMIT 1'
    ).first() as any;
    if (!row?.prompt_configs) return null;
    const configs = JSON.parse(row.prompt_configs);
    const prompts = configs.prompts || configs;
    return prompts[key] || null;
  } catch { return null; }
}

export async function callAI(env: any, systemPrompt: string, userPrompt: string, model?: string): Promise<string> {
  if (env.AI_API_KEY) {
    await ensureAiUsageTable(env);
    const limit = getDailyTokenLimit(env);
    const usedToday = await getTodayTokenUsage(env);
    if (usedToday >= limit) {
      throw new Error(`AI 已达每日 token 限额（上限 ${limit}，今日已用 ${usedToday}）。`);
    }

    const baseUrl = (env.AI_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '');
    const deepseekModel = env.AI_MODEL || model || 'deepseek-v4-flash';
    const resp = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.AI_API_KEY}`,
      },
      body: JSON.stringify({
        model: deepseekModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 4096,
      }),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`DeepSeek API error ${resp.status}: ${errText}`);
    }
    const data: any = await resp.json();
    const totalTokens = data?.usage?.total_tokens || 0;
    if (totalTokens > 0) await addTokenUsage(env, totalTokens);
    if (data?.choices?.[0]?.message?.content) {
      return data.choices[0].message.content;
    }
    throw new Error(`DeepSeek API response format unexpected: ${JSON.stringify(data)}`);
  }

  // 降级：Cloudflare Workers AI
  if (!env.AI) throw new Error('AI not configured: set AI_API_KEY env or add Workers AI binding');
  const aiModel = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
  async function runModel(name: string): Promise<string> {
    const result: any = await env.AI.run(name, {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 4096,
    });
    if (typeof result === 'string') return result;
    if (result?.choices?.[0]?.message?.content) return result.choices[0].message.content;
    if (typeof result?.response === 'string') return result.response;
    if (typeof result?.result?.response === 'string') return result.result.response;
    if (result instanceof Response) return await result.text();
    if (result?.response instanceof ReadableStream) {
      return await new Response(result.response).text();
    }
    return JSON.stringify(result);
  }
  try {
    return await runModel(aiModel);
  } catch (primaryErr: any) {
    try {
      return await runModel('@cf/meta/llama-3.1-8b-instruct');
    } catch (fallbackErr: any) {
      throw new Error(`AI inference failed: ${primaryErr.message}; fallback: ${fallbackErr.message}`);
    }
  }
}
