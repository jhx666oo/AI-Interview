-- 自定义筛选候选池提速：岗位过滤走索引，避免每次全表扫描
CREATE INDEX IF NOT EXISTS idx_resumes_mapped_position ON resumes(mapped_position);
CREATE INDEX IF NOT EXISTS idx_resumes_position_applied ON resumes(position_applied);
