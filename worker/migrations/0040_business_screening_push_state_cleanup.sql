-- 业务筛选状态必须以真实推送批次为前置条件。
-- 清理历史上没有任何推送批次、却被写入业务筛选状态的简历；
-- 已经通过推送按钮进入过批次的简历（包括 HR 后续淘汰）保留原状态。
UPDATE resumes
   SET business_screening_status = 'not_ready',
       business_screening_remark = '',
       business_screened_at = NULL,
       business_screened_by = '',
       business_screening_batch_id = '',
       business_screening_dispatch_group_id = ''
 WHERE business_screening_status IN ('pending', 'passed', 'rejected')
   AND NOT EXISTS (
         SELECT 1
           FROM resume_push_batch_items
          WHERE resume_push_batch_items.resume_id = resumes.id
       );
