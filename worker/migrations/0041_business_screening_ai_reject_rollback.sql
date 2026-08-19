-- AI 初筛不通过的简历不能停留在业务筛选待处理状态。
-- 仅回退尚未进入终态的历史推送记录；已经 HR/业务淘汰的简历保留终态。
UPDATE resume_push_batch_items
   SET status = 'rejected',
       remark = 'AI初筛不通过，已从业务筛选链接移除',
       processed_at = datetime('now')
 WHERE status = 'pending'
   AND EXISTS (
         SELECT 1
           FROM resumes r
          WHERE r.id = resume_push_batch_items.resume_id
            AND r.screening_result = '不通过'
            AND r.hr_disposition = 'pushed'
            AND r.status NOT IN ('approved', 'rejected')
       );

UPDATE resumes
   SET hr_disposition = 'pending',
       business_screening_status = 'not_ready',
       business_screening_remark = '',
       business_screened_at = NULL,
       business_screened_by = '',
       business_screening_batch_id = '',
       business_screening_dispatch_group_id = '',
       updated_at = datetime('now')
 WHERE screening_result = '不通过'
   AND hr_disposition = 'pushed'
   AND status NOT IN ('approved', 'rejected');

-- 如果一个活动批次里已经没有任何仍处于 pushed 状态的简历，则旧链接失效。
UPDATE resume_push_batches
   SET status = 'revoked'
 WHERE status = 'active'
   AND EXISTS (
         SELECT 1
           FROM resume_push_batch_items i
           JOIN resumes r ON r.id = i.resume_id
          WHERE i.batch_id = resume_push_batches.id
            AND r.screening_result = '不通过'
       )
   AND NOT EXISTS (
         SELECT 1
           FROM resume_push_batch_items i
           JOIN resumes r ON r.id = i.resume_id
          WHERE i.batch_id = resume_push_batches.id
            AND r.hr_disposition = 'pushed'
       );
