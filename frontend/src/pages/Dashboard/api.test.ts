import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from '../../utils/request';
import { fetchDashboardV3, syncDashboardV3 } from './api';

vi.mock('../../utils/request', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

describe('dashboard v3 data source API', () => {
  beforeEach(() => vi.clearAllMocks());

  it('passes the selected static or Feishu source to the board endpoint', async () => {
    vi.mocked(request.get).mockResolvedValue({} as never);

    await fetchDashboardV3('live', undefined, undefined, 'static');
    expect(request.get).toHaveBeenCalledWith('/dashboard/recruiting-board-v3', { params: { mode: 'live', source: 'static' } });

    await fetchDashboardV3('live', undefined, undefined, 'feishu');
    expect(request.get).toHaveBeenLastCalledWith('/dashboard/recruiting-board-v3', { params: { mode: 'live', source: 'feishu' } });
  });

  it('uses the admin sync endpoint to load current Feishu data', async () => {
    vi.mocked(request.post).mockResolvedValue({} as never);

    await syncDashboardV3();

    expect(request.post).toHaveBeenCalledWith('/dashboard/recruiting-board-v3/sync', {});
  });
});
