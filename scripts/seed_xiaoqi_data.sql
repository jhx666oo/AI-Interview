-- Seed resume_screening_queue with test data
INSERT INTO resume_screening_queue (id, resume_id, candidate_name, position_applied, mapped_position, city, ai_analysis, ai_result, match_score, risk_points, match_reasons, interview_questions, strengths, age, gender, education, file_name, email_subject, status, batch_num, reviewed_by, reviewed_at, created_at, updated_at) VALUES
('rsq001', '350cbb2f-1331-4d89-bb09-b0c31df6b448', '胡先生', '大客户经理', '大客户经理', '北京', '{"overall":"候选人具备5年大客户管理经验，与岗位高度匹配","score":4}', '{"recommend":"推荐面试","level":"B级"}', 4, '跳槽频率较高，2年内换过3份工作', '["5年大客户管理经验","熟悉北京市场","有医疗行业资源"]', '["请描述一个您主导的大客户开发案例","您如何处理客户流失风险"]', '["客户关系维护","商务谈判","市场分析"]', 28, '男', '本科', '胡先生_大客户经理.pdf', '简历-胡先生-大客户经理', 'pending', 'BATCH2026070901', NULL, NULL, datetime('now'), datetime('now'));

INSERT INTO resume_screening_queue (id, resume_id, candidate_name, position_applied, mapped_position, city, ai_analysis, ai_result, match_score, risk_points, match_reasons, interview_questions, strengths, age, gender, education, file_name, email_subject, status, batch_num, reviewed_by, reviewed_at, created_at, updated_at) VALUES
('rsq002', '01fc6d5c-1e6a-42c6-a334-30b2f7e45ffd', '陈浩志', '市场BD专员', '市场BD专员', '上海', '{"overall":"3年市场BD经验，熟悉线上线下推广","score":3}', '{"recommend":"待定","level":"C级"}', 3, '缺乏团队管理经验，薪资期望偏高', '["3年市场推广经验","有快消行业背景","执行力强"]', '["请分享一个您策划的BD活动案例","您如何评估BD渠道的效果"]', '["活动策划","渠道拓展","数据分析"]', 26, '男', '大专', '陈浩志_市场BD.pdf', '简历-陈浩志-市场BD专员', 'pending', 'BATCH2026070901', NULL, NULL, datetime('now'), datetime('now'));

INSERT INTO resume_screening_queue (id, resume_id, candidate_name, position_applied, mapped_position, city, ai_analysis, ai_result, match_score, risk_points, match_reasons, interview_questions, strengths, age, gender, education, file_name, email_subject, status, batch_num, reviewed_by, reviewed_at, created_at, updated_at) VALUES
('rsq003', '3b5684e1-5dc8-49e1-8bf0-60597ec8dd7e', '钟琰', '招商专员', '招商专员', '北京', '{"overall":"4年招商经验，有丰富的商户资源","score":5}', '{"recommend":"强烈推荐","level":"A级"}', 5, '无', '["4年招商经验","丰富的商户资源网络","过往业绩突出"]', '["请描述您最大的一笔招商签约案例","您如何维护商户关系"]', '["商户拓展","谈判签约","客户维护"]', 29, '女', '本科', '钟琰_招商专员.pdf', '简历-钟琰-招商专员', 'approved', 'BATCH2026070901', '系统管理员', datetime('now'), datetime('now'), datetime('now'));

INSERT INTO resume_screening_queue (id, resume_id, candidate_name, position_applied, mapped_position, city, ai_analysis, ai_result, match_score, risk_points, match_reasons, interview_questions, strengths, age, gender, education, file_name, email_subject, status, batch_num, reviewed_by, reviewed_at, created_at, updated_at) VALUES
('rsq004', '5f063f5d-d8c5-4883-9001-b056fea92536', '王先生', '运营专员', '运营专员', '深圳', '{"overall":"2年运营经验，熟悉社群和内容运营","score":3}', '{"recommend":"待定","level":"C级"}', 3, '经验偏少，缺少大型项目经历', '["熟悉社群运营","有内容创作能力","数据敏感度尚可"]', '["请介绍您运营过的社群规模和活跃度","您如何制定内容运营策略"]', '["社群运营","内容创作","数据分析"]', 24, '男', '本科', '王先生_运营专员.pdf', '简历-王先生-运营专员', 'pending', 'BATCH2026070901', NULL, NULL, datetime('now'), datetime('now'));

INSERT INTO resume_screening_queue (id, resume_id, candidate_name, position_applied, mapped_position, city, ai_analysis, ai_result, match_score, risk_points, match_reasons, interview_questions, strengths, age, gender, education, file_name, email_subject, status, batch_num, reviewed_by, reviewed_at, created_at, updated_at) VALUES
('rsq005', '4becd4b8-9997-4d2a-88f7-10545774e0d7', '王博谦', '渠道经理', '渠道经理', '北京', '{"overall":"6年渠道管理经验，有团队带教经历","score":4}', '{"recommend":"推荐面试","level":"B级"}', 4, '期望薪资超出预算20%', '["6年渠道管理经验","有团队管理经历","熟悉华北市场"]', '["请描述您的渠道管理方法论","您如何激励渠道合作伙伴"]', '["渠道管理","团队领导","战略规划"]', 31, '男', '硕士', '王博谦_渠道经理.pdf', '简历-王博谦-渠道经理', 'approved', 'BATCH2026070901', '系统管理员', datetime('now'), datetime('now'), datetime('now'));

INSERT INTO resume_screening_queue (id, resume_id, candidate_name, position_applied, mapped_position, city, ai_analysis, ai_result, match_score, risk_points, match_reasons, interview_questions, strengths, age, gender, education, file_name, email_subject, status, batch_num, reviewed_by, reviewed_at, created_at, updated_at) VALUES
('rsq006', 'f2105061-ce29-445a-85f5-221ba04adc15', '万佳', '商务专员', '商务专员', '广州', '{"overall":"1年商务经验，基础扎实但深度不足","score":2}', '{"recommend":"不推荐","level":"D级"}', 2, '经验不足1年，缺少独立项目经历', '["有一定商务基础","学习能力强"]', '["请描述您参与过的商务项目","您如何开发新客户"]', '["商务沟通","客户开发"]', 23, '女', '大专', '万佳_商务专员.pdf', '简历-万佳-商务专员', 'rejected', 'BATCH2026070901', '系统管理员', datetime('now'), datetime('now'), datetime('now'));

INSERT INTO resume_screening_queue (id, resume_id, candidate_name, position_applied, mapped_position, city, ai_analysis, ai_result, match_score, risk_points, match_reasons, interview_questions, strengths, age, gender, education, file_name, email_subject, status, batch_num, reviewed_by, reviewed_at, created_at, updated_at) VALUES
('rsq007', 'cab7c246-2622-4d33-80cd-fece58601c26', '刘超群', '大客户经理', '大客户经理', '北京', '{"overall":"7年大客户管理经验，业绩优秀","score":5}', '{"recommend":"强烈推荐","level":"A级"}', 5, '无', '["7年大客户管理经验","年均签约额超500万","有政府及央企客户资源"]', '["请描述您最大的客户签约案例","您如何管理大客户的生命周期"]', '["大客户管理","战略销售","关系维护"]', 32, '男', '本科', '刘超群_大客户经理.pdf', '简历-刘超群-大客户经理', 'pending', 'BATCH2026070901', NULL, NULL, datetime('now'), datetime('now'));

INSERT INTO resume_screening_queue (id, resume_id, candidate_name, position_applied, mapped_position, city, ai_analysis, ai_result, match_score, risk_points, match_reasons, interview_questions, strengths, age, gender, education, file_name, email_subject, status, batch_num, reviewed_by, reviewed_at, created_at, updated_at) VALUES
('rsq008', '9fd09020-b169-462e-8fde-28651b5eea10', '李晨旭', '市场BD主管', '市场BD主管', '上海', '{"overall":"5年市场BD经验，2年团队管理经验","score":4}', '{"recommend":"推荐面试","level":"B级"}', 4, '跨行业跳槽，需适应期', '["5年BD经验","有团队管理经历","数据驱动型选手"]', '["请描述您的团队管理风格","您如何制定年度BD计划"]', '["团队管理","BD策略","数据分析"]', 30, '男', '本科', '李晨旭_市场BD主管.pdf', '简历-李晨旭-市场BD主管', 'pending', 'BATCH2026070901', NULL, NULL, datetime('now'), datetime('now'));

-- Seed recruitment_tasks
INSERT INTO recruitment_tasks (id, requisition_id, position_name, department, city, target_count, status, interviewers, responsible_person, created_at, updated_at) VALUES
('rt001', 'aa1d48e5-5332-414b-a956-8d861691115e', '招商专员', 'AI创新事业部 / 劳动者增长部', '北京', 1, 'open', '["张经理","李总监"]', '何雨菱', datetime('now'), datetime('now'));

INSERT INTO recruitment_tasks (id, requisition_id, position_name, department, city, target_count, status, interviewers, responsible_person, created_at, updated_at) VALUES
('rt002', 'd74052d9-afc7-4337-93ab-995c96570f20', '市场BD主管', '养老及商业事业部 / 综合渠道部', '北京', 1, 'open', '["王总监"]', '杜雁玲', datetime('now'), datetime('now'));

INSERT INTO recruitment_tasks (id, requisition_id, position_name, department, city, target_count, status, interviewers, responsible_person, created_at, updated_at) VALUES
('rt003', '960e36ca-bf66-4a03-89ec-f552a2316064', '产品运营经理', 'AI创新事业部 / AI智聘', '北京', 1, 'open', '["陈经理","赵总监"]', '何雨菱', datetime('now'), datetime('now'));

INSERT INTO recruitment_tasks (id, requisition_id, position_name, department, city, target_count, status, interviewers, responsible_person, created_at, updated_at) VALUES
('rt004', '037a3d3c-d709-4f55-bf46-09c0ba7eca40', '高级JAVA开发', 'AI创新事业部 / AI智聘', '北京', 1, 'in_progress', '["刘架构师","孙经理"]', '杜雁玲', datetime('now'), datetime('now'));

INSERT INTO recruitment_tasks (id, requisition_id, position_name, department, city, target_count, status, interviewers, responsible_person, created_at, updated_at) VALUES
('rt005', '33e63f1a-2ebb-4f64-8d27-09fc8c957fdd', '劳动者运营实习生', 'AI创新事业部 / AI智聘', '北京', 2, 'open', '["周经理"]', '何雨菱', datetime('now'), datetime('now'));

-- Seed daily_reports
INSERT INTO daily_reports (id, report_date, report_type, title, content, stats, status, created_at) VALUES
('dr001', '2026-07-08', 'daily', '2026年7月8日招聘日报', '{"new_resumes":12,"interviews_scheduled":5,"interviews_completed":3,"offers_extended":1,"talent_pool_added":2,"screening_approved":3,"screening_rejected":1}', '今日收到简历12份，AI初筛完成12份。通过初筛3人，淘汰1人。安排面试5场，完成面试3场。发出Offer 1份。人才库新增2人。整体招聘效率良好，招商专员岗位已收到高质量候选人。', 'published', datetime('now'));

INSERT INTO daily_reports (id, report_date, report_type, title, content, stats, status, created_at) VALUES
('dr002', '2026-07-07', 'daily', '2026年7月7日招聘日报', '{"new_resumes":8,"interviews_scheduled":4,"interviews_completed":2,"offers_extended":0,"talent_pool_added":1,"screening_approved":2,"screening_rejected":2}', '今日收到简历8份，AI初筛完成8份。通过初筛2人，淘汰2人。安排面试4场，完成面试2场。人才库新增1人。市场BD主管岗位候选人质量参差不齐，建议扩大渠道。', 'published', datetime('now'));

INSERT INTO daily_reports (id, report_date, report_type, title, content, stats, status, created_at) VALUES
('dr003', '2026-07-06', 'weekly', '2026年7月第1周招聘周报', '{"new_resumes":45,"interviews_scheduled":18,"interviews_completed":12,"offers_extended":3,"talent_pool_added":8,"screening_approved":15,"screening_rejected":10}', '本周共收到简历45份，AI初筛全部完成。通过初筛15人，淘汰10人。安排面试18场，完成面试12场。发出Offer 3份。人才库新增8人。本周招聘重点推进了招商专员和大客户经理岗位，整体进展顺利。', 'published', datetime('now'));

INSERT INTO daily_reports (id, report_date, report_type, title, content, stats, status, created_at) VALUES
('dr004', '2026-07-05', 'daily', '2026年7月5日招聘日报', '{"new_resumes":15,"interviews_scheduled":6,"interviews_completed":4,"offers_extended":2,"talent_pool_added":3,"screening_approved":4,"screening_rejected":3}', '今日收到简历15份，AI初筛完成15份。通过初筛4人，淘汰3人。安排面试6场，完成面试4场。发出Offer 2份。人才库新增3人。今日高级JAVA开发岗位收到多位优质候选人，建议优先安排面试。', 'published', datetime('now'));

INSERT INTO daily_reports (id, report_date, report_type, title, content, stats, status, created_at) VALUES
('dr005', '2026-07-09', 'interview_summary', '2026年7月9日面试统计', '{"total_interviews":6,"passed":4,"failed":1,"pending":1,"pass_rate":80}', '今日共安排面试6场，通过4场，不通过1场，待定1场，通过率80%。招商专员岗位面试表现优秀，建议尽快发Offer。市场BD主管岗位候选人专业能力达标但薪资预期偏高，需进一步沟通。', 'published', datetime('now'));
