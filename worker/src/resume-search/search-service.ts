import type { ResumeSearchService, ResumeSearchQuery, ResumeAccessScope, ResumeSearchPage, ResumeSearchHealth } from '../resume-storage/types';

export class ResumeSearchServiceImpl implements ResumeSearchService {
  constructor(private env: Record<string, string | undefined>) {}

  async search(_input: ResumeSearchQuery, _scope: ResumeAccessScope): Promise<ResumeSearchPage> {
    // Phase 4: 占位实现，返回空结果
    // 后续对接 AI Search API 时实现真实搜索
    console.warn('[ResumeSearch] search() called but not yet implemented');
    return { results: [], total: 0, page: _input.page ?? 1, pageSize: _input.pageSize ?? 20 };
  }

  async requestIndex(resumeId: string, version: number): Promise<void> {
    // Phase 4: 占位
    console.warn(`[ResumeSearch] requestIndex(${resumeId}, v${version}) - not yet implemented`);
  }

  async requestDelete(resumeId: string): Promise<void> {
    // Phase 4: 占位
    console.warn(`[ResumeSearch] requestDelete(${resumeId}) - not yet implemented`);
  }

  async getHealth(): Promise<ResumeSearchHealth> {
    return { healthy: true, indexCount: 0, pendingCount: 0 };
  }
}
