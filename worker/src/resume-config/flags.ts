/**
 * 统一的 Feature Flag 解析器
 * 所有新功能默认关闭，通过环境变量中的字符串 "true" 开启
 */

export interface ResumeFeatureFlags {
  r2ArtifactWrite: boolean;
  r2ArtifactRead: boolean;
  directR2Upload: boolean;
  sqlResumeList: boolean;
  hybridSearch: boolean;
  recruitmentEvents: boolean;
  recruitmentEventMetrics: boolean;
}

export function parseFeatureFlags(env: Record<string, string | undefined>): ResumeFeatureFlags {
  const enabled = (key: string): boolean => (env[key] ?? '').toLowerCase() === 'true';
  return {
    r2ArtifactWrite: enabled('R2_ARTIFACT_WRITE'),
    r2ArtifactRead: enabled('R2_ARTIFACT_READ'),
    directR2Upload: enabled('DIRECT_R2_UPLOAD'),
    sqlResumeList: enabled('RESUME_SQL_LIST'),
    hybridSearch: enabled('RESUME_HYBRID_SEARCH'),
    recruitmentEvents: enabled('RECRUITMENT_EVENTS'),
    recruitmentEventMetrics: enabled('RECRUITMENT_EVENT_METRICS'),
  };
}
