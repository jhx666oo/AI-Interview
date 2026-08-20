-- 面试轮次迁移前只读审计。此文件只包含 SELECT，不会修改任何数据。

-- 同一候选人同一轮存在多条未取消记录的冲突。
SELECT resume_id, round, COUNT(*) AS active_count
FROM interviews
WHERE COALESCE(resume_id, '') <> '' AND status <> 'cancelled'
GROUP BY resume_id, round
HAVING COUNT(*) > 1;

-- 仍依赖旧二面字段的记录，供回填脚本输入审阅。
SELECT id, resume_id, position_id, candidate_name, position_applied,
       round, result2, evaluation2, status2
FROM interviews
WHERE COALESCE(result2, 'pending') <> 'pending'
   OR COALESCE(evaluation2, '') <> ''
   OR COALESCE(status2, 'pending') <> 'pending';
