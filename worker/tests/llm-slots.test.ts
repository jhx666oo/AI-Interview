import { describe, expect, it } from 'vitest';
import { mergeLlmSlots } from '../src/llm-slots';

const fixedId = () => 'new-uuid';

describe('mergeLlmSlots', () => {
  it('keeps saved slots whose key is not re-typed (id match)', () => {
    const existing = [
      { id: 'slot-1', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash', apiKey: 'sk-existing-1' },
      { id: 'slot-2', baseUrl: 'https://token.sensenova.cn/v1', model: 'deepseek-v4-flash', apiKey: 'sk-existing-2' },
    ];
    const incoming = [
      { id: 'slot-1', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash', apiKey: '' }, // 未重填 key
      { id: 'slot-2', baseUrl: 'https://token.sensenova.cn/v1', model: 'deepseek-v4-flash', apiKey: '' },
      { baseUrl: 'https://opencode.ai/zen/v1', model: 'deepseek-v4-flash-free', apiKey: 'sk-new-3' }, // 新增
    ];
    const result = mergeLlmSlots(existing, incoming, fixedId);
    expect(result).toEqual([
      { id: 'slot-1', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash', apiKey: 'sk-existing-1' },
      { id: 'slot-2', baseUrl: 'https://token.sensenova.cn/v1', model: 'deepseek-v4-flash', apiKey: 'sk-existing-2' },
      { id: 'new-uuid', baseUrl: 'https://opencode.ai/zen/v1', model: 'deepseek-v4-flash-free', apiKey: 'sk-new-3' },
    ]);
  });

  it('dedupes identical baseUrl+model+apiKey triples', () => {
    const result = mergeLlmSlots([], [
      { baseUrl: 'https://api.agnes-ai.cn/v1', model: 'agnes-2.5-flash', apiKey: 'sk-a' },
      { baseUrl: 'https://api.agnes-ai.cn/v1/', model: 'agnes-2.5-flash', apiKey: 'sk-a' }, // 尾部斜杠归一化 + 重复
      { baseUrl: 'https://api.agnes-ai.cn/v1', model: 'agnes-2.5-flash', apiKey: 'sk-b' }, // 同端点不同 key，保留
    ], fixedId);
    expect(result).toHaveLength(2);
    expect(result[0].apiKey).toBe('sk-a');
    expect(result[1].apiKey).toBe('sk-b');
  });

  it('keeps different keys for the same endpoint+model', () => {
    const result = mergeLlmSlots([], [
      { baseUrl: 'https://token.sensenova.cn/v1', model: 'deepseek-v4-flash', apiKey: 'sk-1' },
      { baseUrl: 'https://token.sensenova.cn/v1', model: 'deepseek-v4-flash', apiKey: 'sk-2' },
    ], fixedId);
    expect(result).toHaveLength(2);
  });

  it('drops slots without model or without any key', () => {
    const result = mergeLlmSlots([], [
      { baseUrl: 'https://x.cn/v1', model: '', apiKey: 'sk-no-model' },
      { baseUrl: 'https://x.cn/v1', model: 'm1', apiKey: '' },
      { baseUrl: 'https://x.cn/v1', model: 'm2', apiKey: 'sk-ok' },
    ], fixedId);
    expect(result).toHaveLength(1);
    expect(result[0].model).toBe('m2');
  });

  it('falls back to position matching for legacy slots without ids', () => {
    const existing = [
      { baseUrl: 'https://api.deepseek.com', model: 'm1', apiKey: 'sk-legacy-1' },
    ];
    const incoming = [
      { baseUrl: 'https://api.deepseek.com', model: 'm1', apiKey: '' }, // 无 id，按位置沿用
    ];
    const result = mergeLlmSlots(existing, incoming, fixedId);
    expect(result[0].apiKey).toBe('sk-legacy-1');
    expect(result[0].id).toBe('new-uuid'); // 旧数据无 id，补齐新 id
  });

  it('preserves existing id when slot already has one', () => {
    const existing = [{ id: 'keep-me', baseUrl: 'https://a.cn/v1', model: 'm', apiKey: 'sk-1' }];
    const incoming = [{ id: 'keep-me', baseUrl: 'https://a.cn/v1', model: 'm', apiKey: 'sk-new' }];
    const result = mergeLlmSlots(existing, incoming, fixedId);
    expect(result[0]).toEqual({ id: 'keep-me', baseUrl: 'https://a.cn/v1', model: 'm', apiKey: 'sk-new' });
  });

  it('returns empty array when everything is dropped', () => {
    expect(mergeLlmSlots([], [{ baseUrl: 'https://x.cn', model: '', apiKey: '' }], fixedId)).toEqual([]);
    expect(mergeLlmSlots([], [], fixedId)).toEqual([]);
  });
});
