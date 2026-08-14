import { afterEach, describe, expect, it, vi } from 'vitest';
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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('callAIWithMetadata', () => {
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
    const fetchMock = vi.fn().mockResolvedValue(okResponse('', {
      message: { content: '', reasoning_content: '这是思考过程，不是 JSON' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(callAIWithMetadata(makeEnv(), 'return JSON', 'return JSON'))
      .rejects.toMatchObject({ code: 'AI_RESPONSE_EMPTY' });
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
