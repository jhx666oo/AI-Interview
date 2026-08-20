import { describe, expect, it, vi } from 'vitest';
import { cancelMailSync } from './mailSyncActions';

describe('邮件同步取消操作', () => {
  it('为每个正在同步的邮箱调用取消接口', async () => {
    const request = {
      post: vi.fn().mockResolvedValue({ success: true }),
    };

    const result = await cancelMailSync(request, ['config-a', 'config-b']);

    expect(request.post).toHaveBeenCalledTimes(2);
    expect(request.post).toHaveBeenNthCalledWith(1, '/mail/sync/cancel', { configId: 'config-a' });
    expect(request.post).toHaveBeenNthCalledWith(2, '/mail/sync/cancel', { configId: 'config-b' });
    expect(result).toEqual(['config-a', 'config-b']);
  });
});
