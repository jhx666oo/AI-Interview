import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callAI, callAIWithMetadata } from '../src/index';

function makeEnv(overrides: Record<string, unknown> = {}) {
  const db = {
    prepare(_sql: string) {
      return {
        bind() { return this as any; },
        all: async () => ({ results: [] }),
        first: async () => null,
        run: async () => ({ meta: { changes: 0 } }),
      };
    },
  };
  return {
    DB: db as any,
    SECRET_KEY: 'test',
    AI_API_KEY: 'test-key',
    AI_BASE_URL: 'https://api.deepseek.com',
    AI_MODEL: 'deepseek-chat',
    AI: {
      run: vi.fn().mockResolvedValue({ response: 'workers-ai-result' }),
    } as any,
    RESUME_PROCESSING_QUEUE: { send: async () => undefined } as any,
    AI_FALLBACK_ENABLED: 'false',
    ...overrides,
  } as any;
}

function okResponse(content: string, extra: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content }, ...extra }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

// 模拟 system_configs 表返回一行（含 llm_* ~ llm4_* 列），用于多配置降级测试
function envWithSystemConfig(row: Record<string, unknown> = {}, overrides: Record<string, unknown> = {}) {
  const db = {
    prepare() {
      return {
        bind() { return this as any; },
        all: async () => ({ results: [] }),
        first: async () => row,
        run: async () => ({ meta: { changes: 0 } }),
      };
    },
  };
  return {
    ...makeEnv(overrides),
    DB: db as any,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('callAIWithMetadata', () => {
  // 默认随机起点会随机选择配置；以下多配置用例固定 Math.random=0（从配置 1 开始），
  // 保持"第一个配置成功则使用之 / 失败按顺序降级"的既有断言语义。
  beforeEach(() => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });
  it('requests JSON mode for structured calls', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('{"ok":true}'));
    vi.stubGlobal('fetch', fetchMock);

    await callAIWithMetadata(makeEnv(), 'return JSON', 'return JSON', 'deepseek-chat', {
      structured: true,
      maxTokens: 8192,
      temperature: 0,
    });

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(request.body));
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.max_tokens).toBe(8192);
    expect(body.temperature).toBe(0);
  });

  it('does not use reasoning content as the final answer', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(okResponse('', {
      message: { content: '', reasoning_content: '这是思考过程，不是 JSON' },
    })));
    vi.stubGlobal('fetch', fetchMock);

    const resultPromise = callAIWithMetadata(makeEnv(), 'return JSON', 'return JSON');
    const rejection = expect(resultPromise).rejects.toMatchObject({ code: 'AI_RESPONSE_EMPTY' });
    await vi.advanceTimersByTimeAsync(5000);
    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('retries a reasoning-only response before accepting a later content response', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okResponse('', {
        message: { content: '', reasoning_content: '暂时只有思考过程' },
      }))
      .mockResolvedValueOnce(okResponse('{"ok":true}'));
    vi.stubGlobal('fetch', fetchMock);

    const resultPromise = callAIWithMetadata(makeEnv(), 'return JSON', 'return JSON');
    await vi.advanceTimersByTimeAsync(1000);
    const result = await resultPromise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.text).toBe('{"ok":true}');
    expect(result.metadata.attempt).toBe(2);
  });

  it('records the provider finish reason', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('{"ok":true}', {
      finish_reason: 'length',
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await callAIWithMetadata(makeEnv(), 'return JSON', 'return JSON');

    expect(result.metadata.finishReason).toBe('length');
  });

  it('retries retryable HTTP statuses up to 3 total attempts', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 500 }))
      .mockResolvedValueOnce(new Response('{}', { status: 502 }))
      .mockResolvedValueOnce(okResponse('最终结果'));
    vi.stubGlobal('fetch', fetchMock);

    const resultPromise = callAIWithMetadata(makeEnv(), 'sys', 'user', 'deepseek-chat');
    const result = await vi.advanceTimersByTimeAsync(5000).then(() => resultPromise);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.metadata.provider).toBe('configured_api');
    expect(result.metadata.attempt).toBe(3);
    expect(result.text).toBe('最终结果');
  });

  it('does not retry 400 format errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('bad request', { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(callAIWithMetadata(makeEnv(), 'sys', 'user')).rejects.toThrow(/400/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('classifies a provider that rejects JSON mode', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('response_format json_object is not supported', { status: 400 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(callAIWithMetadata(makeEnv(), 'return JSON', 'return JSON', 'deepseek-chat', {
      structured: true,
    })).rejects.toMatchObject({ code: 'AI_JSON_MODE_UNSUPPORTED' });
  });

  it('does not fall back when AI_FALLBACK_ENABLED is false', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response('{}', { status: 500 })));
    vi.stubGlobal('fetch', fetchMock);
    const env = makeEnv({ AI_FALLBACK_ENABLED: 'false' });

    await expect(callAIWithMetadata(env, 'sys', 'user')).rejects.toThrow(/500/);
    expect(env.AI.run).not.toHaveBeenCalled();
  });

  it('falls back to Workers AI with provider metadata when enabled', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response('{}', { status: 500 })));
    vi.stubGlobal('fetch', fetchMock);
    const aiRun = vi.fn().mockResolvedValue({ response: 'workers-ai-result' });
    const env = makeEnv({ AI_FALLBACK_ENABLED: 'true', AI: { run: aiRun } });

    const resultPromise = callAIWithMetadata(env, 'sys', 'user');
    const result = await vi.advanceTimersByTimeAsync(5000).then(() => resultPromise);

    expect(result.text).toBe('workers-ai-result');
    expect(result.metadata.provider).toBe('workers_ai');
    expect(aiRun).toHaveBeenCalled();
  });

  it('exposes model and response chars in metadata', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('评估通过'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await callAIWithMetadata(makeEnv(), 'sys', 'user', 'deepseek-chat');
    expect(result.metadata.model).toBe('deepseek-chat');
    expect(result.metadata.responseChars).toBe(4);
  });

  it('times out while reading a response body instead of leaving the job running forever', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => new Promise(() => undefined),
    });
    vi.stubGlobal('fetch', fetchMock);

    const resultPromise = callAIWithMetadata(makeEnv(), 'sys', 'user');
    const rejection = expect(resultPromise).rejects.toThrow(/超时/);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(90_000);

    await rejection;
  });
  it('uses the first config when it succeeds even if a backup is configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('from-config-1'));
    vi.stubGlobal('fetch', fetchMock);
    const env = envWithSystemConfig({
      llm_api_key: 'key-1', llm_base_url: 'https://config1.example.com', llm_model: 'model-1',
      llm2_api_key: 'key-2', llm2_base_url: 'https://config2.example.com', llm2_model: 'model-2',
    });

    const result = await callAIWithMetadata(env, 'sys', 'user');
    expect(result.text).toBe('from-config-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('config1.example.com');
  });

  it('falls back from the first config to the second when the first fails', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 500 }))
      .mockResolvedValueOnce(new Response('{}', { status: 500 }))
      .mockResolvedValueOnce(new Response('{}', { status: 500 }))
      .mockResolvedValueOnce(okResponse('from-config-2'));
    vi.stubGlobal('fetch', fetchMock);
    const env = envWithSystemConfig({
      llm_api_key: 'key-1', llm_base_url: 'https://config1.example.com', llm_model: 'model-1',
      llm2_api_key: 'key-2', llm2_base_url: 'https://config2.example.com', llm2_model: 'model-2',
    });

    const resultPromise = callAIWithMetadata(env, 'sys', 'user');
    const result = await vi.advanceTimersByTimeAsync(10_000).then(() => resultPromise);

    expect(result.text).toBe('from-config-2');
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const config2Url = String(fetchMock.mock.calls[3][0]);
    expect(config2Url).toContain('config2.example.com');
    const body2 = JSON.parse(String((fetchMock.mock.calls[3][1] as RequestInit).body));
    expect(body2.model).toBe('model-2');
  });

  it('skips backup configs that have no api key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('only-config-1'));
    vi.stubGlobal('fetch', fetchMock);
    const env = envWithSystemConfig({
      llm_api_key: 'key-1', llm_base_url: 'https://config1.example.com', llm_model: 'model-1',
      llm2_api_key: '', llm3_api_key: undefined, llm4_api_key: null,
    });

    const result = await callAIWithMetadata(env, 'sys', 'user');
    expect(result.text).toBe('only-config-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('defaults to a random start config so concurrent batch calls spread across models', async () => {
    // Math.random≈0.5 → start=1 → 先尝试配置 2（而不是所有请求都挤在配置 1）
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const fetchMock = vi.fn().mockResolvedValue(okResponse('from-config-2'));
    vi.stubGlobal('fetch', fetchMock);
    const env = envWithSystemConfig({
      llm_api_key: 'key-1', llm_base_url: 'https://config1.example.com', llm_model: 'model-1',
      llm2_api_key: 'key-2', llm2_base_url: 'https://config2.example.com', llm2_model: 'model-2',
    });

    const result = await callAIWithMetadata(env, 'sys', 'user');
    expect(result.text).toBe('from-config-2');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('config2.example.com');
  });

  it('reads all 7 slots from llm_slots and spreads attempts across them', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(6 / 7); // start=6 → 先尝试第 7 个配置
    const fetchMock = vi.fn().mockResolvedValue(okResponse('from-config-7'));
    vi.stubGlobal('fetch', fetchMock);
    const slots = Array.from({ length: 7 }, (_, i) => ({
      baseUrl: `https://config${i + 1}.example.com/v1`,
      model: `model-${i + 1}`,
      apiKey: `key-${i + 1}`,
    }));
    const env = envWithSystemConfig({ llm_slots: slots });

    const result = await callAIWithMetadata(env, 'sys', 'user');
    expect(result.text).toBe('from-config-7');
    expect(String(fetchMock.mock.calls[0][0])).toContain('config7.example.com');
  });

  it('pins the start config via startIndex and wraps around to the next model on failure', async () => {
    // startIndex=1（配置 2）：配置 2 连续 500 重试 3 次失败后，环绕降级到配置 3 成功
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 500 }))
      .mockResolvedValueOnce(new Response('{}', { status: 500 }))
      .mockResolvedValueOnce(new Response('{}', { status: 500 }))
      .mockResolvedValueOnce(okResponse('from-config-3'));
    vi.stubGlobal('fetch', fetchMock);
    const env = envWithSystemConfig({
      llm_api_key: 'key-1', llm_base_url: 'https://config1.example.com', llm_model: 'model-1',
      llm2_api_key: 'key-2', llm2_base_url: 'https://config2.example.com', llm2_model: 'model-2',
      llm3_api_key: 'key-3', llm3_base_url: 'https://config3.example.com', llm3_model: 'model-3',
    });

    const resultPromise = callAIWithMetadata(env, 'sys', 'user', undefined, { startIndex: 1 });
    const result = await vi.advanceTimersByTimeAsync(10_000).then(() => resultPromise);

    expect(result.text).toBe('from-config-3');
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(String(fetchMock.mock.calls[3][0])).toContain('config3.example.com');
  });
});

describe('callAI compatibility wrapper', () => {
  it('still returns a plain string', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('字符串结果'));
    vi.stubGlobal('fetch', fetchMock);

    const text = await callAI(makeEnv(), 'sys', 'user', 'deepseek-chat');
    expect(typeof text).toBe('string');
    expect(text).toBe('字符串结果');
  });
});
