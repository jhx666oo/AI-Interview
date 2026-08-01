import React, { useEffect, useState } from 'react';
import { Card, Descriptions, Tag, Button, Row, Col, Typography, message, Divider, Spin, Progress, Modal, Form, Input, Space, Select, Rate, List, Avatar, Statistic, Empty, Tabs } from 'antd';
import { useParams, useNavigate } from 'react-router-dom';
import request from '../../utils/request';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { DownloadOutlined, FilePdfOutlined, ArrowLeftOutlined, CloseCircleOutlined, EditOutlined, SaveOutlined, ReloadOutlined, UserOutlined, CheckCircleOutlined, TeamOutlined, SolutionOutlined, ClockCircleOutlined, RobotOutlined, ThunderboltOutlined } from '@ant-design/icons';
import RejectReasonSelector, { REJECT_REASONS } from '../../components/RejectReasonSelector';
import { useAuth } from '../../contexts/AuthContext';
import { getMaximizedPdfPreviewUrl } from '../../utils/pdfPreview';
import { normalizeResumeEvaluation } from '../../utils/resumeEvaluation';

const { Title, Paragraph, Text } = Typography;
const { TextArea } = Input;

// 状态映射
const STATUS_MAP: Record<string, { text: string; color: string }> = {
  pending_screening: { text: '待初筛', color: 'warning' },
  pending_review: { text: '待评审', color: 'warning' },
  pending_dept_review: { text: '待部门评审', color: 'cyan' },
  pending_hr_decision: { text: '待HR决策', color: 'purple' },
  auto_rejected_pending_review: { text: 'AI建议淘汰', color: 'orange' },
  pending_interview: { text: '待面试', color: 'geekblue' },
  interview_passed: { text: '面试通过', color: 'lime' },
  interview_failed: { text: '面试未通过', color: 'magenta' },
  offer_pending: { text: 'Offer待确认', color: 'blue' },
  offer_accepted: { text: '已接受Offer', color: 'success' },
  offer_rejected: { text: '已拒绝Offer', color: 'error' },
  onboarding: { text: '入职中', color: 'blue' },
  completed: { text: '已完成', color: 'success' },
  rejected: { text: '已淘汰', color: 'error' },
  hired: { text: '已录用', color: 'success' },
  waitlist: { text: '备选', color: 'gold' },
};

const ResumeDetail: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [resume, setResume] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [form] = Form.useForm();
  const [rejectForm] = Form.useForm();
  const [hrDecisionForm] = Form.useForm();
  const [deptReviewForm] = Form.useForm();

  // 获取用户角色
  const userRole = (user as any)?.role?.value ?? (user as any)?.role;

  // 部门评审相关状态
  const [deptReviewSummary, setDeptReviewSummary] = useState<any>(null);
  const [reviewers, setReviewers] = useState<any[]>([]);
  const [isDeptReviewModalVisible, setIsDeptReviewModalVisible] = useState(false);
  const [isAssignReviewerModalVisible, setIsAssignReviewerModalVisible] = useState(false);
  const [isRejectModalVisible, setIsRejectModalVisible] = useState(false);
  const [isHRDecisionModalVisible, setIsHRDecisionModalVisible] = useState(false);
  const [isSubmitReviewModalVisible, setIsSubmitReviewModalVisible] = useState(false);
  const [myReview, setMyReview] = useState<any>(null);
  const [submitReviewForm] = Form.useForm();
  const [aiScreening, setAiScreening] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    if (id) {
      fetchResume(id);
      fetchReviewers();
    }
  }, [id]);

  const fetchResume = async (resumeId: string) => {
    setLoading(true);
    try {
      const res = await request.get(`/resumes/${resumeId}`) as any;
      setResume(res);

      // 获取部门评审汇总
      if (res.status === 'pending_dept_review' || res.status === 'pending_hr_decision' || res.department_reviews) {
        fetchDeptReviewSummary(resumeId);
      }

      // 检查当前用户是否是被指派的评审人
      if (res.department_reviews && user?.id) {
        const myReviewRecord = res.department_reviews.find((r: any) => r.reviewer_id === user.id);
        if (myReviewRecord) {
          setMyReview(myReviewRecord);
        }
      }
    } catch (error) {
      message.error('获取简历详情失败');
    } finally {
      setLoading(false);
    }
  };

  const fetchDeptReviewSummary = async (resumeId: string) => {
    try {
      const res = await request.get(`/resumes/${resumeId}/department-reviews`);
      setDeptReviewSummary(res);
    } catch (error) {
      console.error('获取部门评审汇总失败', error);
    }
  };

  const fetchReviewers = async () => {
    try {
      const res = await request.get('/auth/interviewers');
      setReviewers(res);
    } catch (error) {
      console.error('获取评审人列表失败', error);
    }
  };

  const handleUpdate = async () => {
      setUpdating(true);
      try {
          const values = await form.validateFields();
          await request.put(`/resumes/${id}`, {
              candidate_name: values.candidate_name,
              email: values.email,
              contact: values.contact,
          });
          message.success('更新成功');
          setIsEditing(false);
          fetchResume(id!);
      } catch (error) {
          message.error((error as any)?.response?.data?.detail || '更新失败');
      } finally {
          setUpdating(false);
      }
  };

  const getStatusInfo = (status: string, parseStatus?: string) => {
      if (parseStatus === 'failed') return { text: '解析失败', color: 'error' };
      if (parseStatus === 'processing') return { text: '解析中', color: 'processing' };
      return STATUS_MAP[status] || { text: status, color: 'default' };
  };

  if (loading || !resume) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" />
      </div>
    );
  }

  const parsedData = resume.parsed_data || {};
  const token = localStorage.getItem('token') || '';
  const fileApiUrl = id ? `/api/resumes/${id}/file?token=${encodeURIComponent(token)}` : '';
  const downloadUrl = id ? `/api/resumes/${id}/file?download=true&token=${encodeURIComponent(token)}` : '';
  const pdfPreviewUrl = fileApiUrl ? getMaximizedPdfPreviewUrl(fileApiUrl) : '';
  const statusInfo = getStatusInfo(resume.status, resume.parse_status);
  const normalizedEvaluation = normalizeResumeEvaluation(resume);
  const aiReview = normalizedEvaluation.source || resume.ai_review || resume.ai_evaluation;
  const aiDimensions = normalizedEvaluation.dimensions;
  const aiContentStyle: React.CSSProperties = {
    maxWidth: '100%',
    minWidth: 0,
    overflowX: 'auto',
    overflowWrap: 'anywhere',
    wordBreak: 'break-word',
  };

  const getParseStatusText = (parseStatus?: string) => {
    if (parseStatus === 'ai_screened' || parseStatus === 'completed' || parseStatus === 'ocr_done') return 'AI 解析完成';
    if (parseStatus === 'queued') return '已入队，等待处理';
    if (parseStatus === 'extracting_text') return '正在提取简历文本';
    if (parseStatus === 'extracting_fields') return '正在提取字段';
    if (parseStatus === 'screening') return '正在 AI 初筛';
    if (parseStatus === 'failed') return '解析失败';
    return '待解析';
  };

  const formatExperience = (value: unknown) => {
    if (!value) return '未识别';
    const text = String(value);
    return text.includes('年') ? text : `${text}年`;
  };

  // AI初筛
  const handleAIScreen = async () => {
    setAiScreening(true);
    try {
      const res = await request.post(`/resumes/${id}/ai-screen`);
      message.success('AI初筛完成');
      fetchResume(id!);
    } catch (error) {
      message.error((error as any)?.response?.data?.detail || 'AI初筛失败，请检查AI服务配置');
    } finally {
      setAiScreening(false);
    }
  };

  const handleReparse = () => {
    Modal.confirm({
      title: '重新解析简历',
      content: '将重新调用 AI 解析该简历，并覆盖现有解析结果。',
      okText: '确认',
      cancelText: '取消',
      onOk: async () => {
        try {
          await request.post(`/resumes/${id}/reparse`);
          message.success('已开始重新解析');
          fetchResume(id!);
        } catch (error) {
          message.error((error as any)?.response?.data?.detail || '重新解析失败');
        }
      },
    });
  };

  // 确认淘汰低分简历
  const handleConfirmRejection = async () => {
    setSubmitting(true);
    try {
      const values = await rejectForm.validateFields();
      const formData = new FormData();
      formData.append('reason_category', values.reject_reason_category);
      if (values.reject_reason_detail) {
        formData.append('reason_detail', values.reject_reason_detail);
      }
      formData.append('hr_id', user?.id || '');

      await request.post(`/resumes/${id}/confirm-rejection`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      message.success('已确认淘汰');
      setIsRejectModalVisible(false);
      rejectForm.resetFields();
      fetchResume(id!);
    } catch (error) {
      message.error((error as any)?.response?.data?.detail || '操作失败');
    } finally {
      setSubmitting(false);
    }
  };

  // 覆盖AI淘汰建议
  const handleOverrideRejection = async () => {
    setSubmitting(true);
    Modal.confirm({
      title: '恢复简历',
      content: '确定要将此简历恢复到评审流程吗？',
      okText: '确认',
      cancelText: '取消',
      onOk: async () => {
        try {
          const formData = new FormData();
          formData.append('hr_id', user?.id || '');
          await request.post(`/resumes/${id}/override-rejection`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
          });
          message.success('已恢复到评审流程');
          fetchResume(id!);
        } catch (error) {
          message.error((error as any)?.response?.data?.detail || '操作失败');
        } finally {
          setSubmitting(false);
        }
      }
    });
  };

  // 指派评审人
  const handleAssignReviewer = async () => {
    setSubmitting(true);
    try {
      const values = await deptReviewForm.validateFields();
      const reviewerIds = values.reviewer_ids; // 多选

      // 批量指派评审人
      for (const reviewerId of reviewerIds) {
        const formData = new FormData();
        formData.append('reviewer_id', reviewerId);
        await request.post(`/resumes/${id}/department-reviews`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });
      }

      message.success(`已指派 ${reviewerIds.length} 位评审人`);
      setIsAssignReviewerModalVisible(false);
      deptReviewForm.resetFields();
      fetchResume(id!);
      fetchDeptReviewSummary(id!);
    } catch (error) {
      message.error((error as any)?.response?.data?.detail || '指派失败');
    } finally {
      setSubmitting(false);
    }
  };

  // HR决策
  const handleHRDecision = async () => {
    setSubmitting(true);
    try {
      const values = await hrDecisionForm.validateFields();

      if (values.decision === 'rejected' && !values.reject_reason_category) {
        message.error('淘汰时必须选择淘汰原因');
        setSubmitting(false);
        return;
      }

      const payload: any = {
        hr_id: user?.id,
        decision: values.decision,
        hr_comment: values.hr_comment || null,
      };

      if (values.decision === 'rejected') {
        payload.reject_reason_category = values.reject_reason_category;
        payload.reject_reason_detail = values.reject_reason_detail || null;
      }

      await request.post(`/resumes/${id}/hr-decision`, payload);

      message.success('决策已提交');
      setIsHRDecisionModalVisible(false);
      hrDecisionForm.resetFields();
      fetchResume(id!);
    } catch (error) {
      message.error((error as any)?.response?.data?.detail || '操作失败');
    } finally {
      setSubmitting(false);
    }
  };

  // 提交部门评审
  const handleSubmitReview = async () => {
    setSubmitting(true);
    try {
      const values = await submitReviewForm.validateFields();
      const formData = new FormData();
      formData.append('reviewer_id', user?.id || '');
      formData.append('technical_score', values.technical_score || '');
      formData.append('experience_score', values.experience_score || '');
      formData.append('overall_score', values.overall_score || '');
      formData.append('recommendation', values.recommendation || '');
      formData.append('comment', values.comment || '');

      await request.put(
        `/resumes/${id}/department-reviews/${myReview.id}`,
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      );

      message.success('评审已提交');
      setIsSubmitReviewModalVisible(false);
      submitReviewForm.resetFields();
      fetchResume(id!);
      fetchDeptReviewSummary(id!);
    } catch (error) {
      message.error((error as any)?.response?.data?.detail || '提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  // 转岗
  const handleTransfer = (newPositionId: string, positionTitle: string) => {
    Modal.confirm({
      title: '确认转岗',
      content: `确定将该候选人转岗到「${positionTitle}」吗？转岗后将重新进行简历分析。`,
      okText: '确认转岗',
      cancelText: '取消',
      onOk: async () => {
        try {
          const formData = new FormData();
          formData.append('new_position_id', newPositionId);
          await request.post(`/resumes/${id}/transfer`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
          });
          message.success('转岗成功，正在重新解析简历');
          fetchResume(id!);
        } catch (error) {
          message.error((error as any)?.response?.data?.detail || '转岗失败');
        }
      }
    });
  };

  // 渲染操作按钮区域
  const renderActionButtons = () => {
    const buttons: React.ReactNode[] = [];

    // 检查当前用户是否是被指派的评审人且未完成评审
    const isAssignedReviewer = myReview && !myReview.is_completed;

    // 如果是被指派的评审人，显示提交评审按钮
    if (isAssignedReviewer) {
      buttons.push(
        <Button
          key="submit-review"
          type="primary"
          icon={<SolutionOutlined />}
          onClick={() => setIsSubmitReviewModalVisible(true)}
        >
          提交评审
        </Button>
      );
      return buttons; // 评审人只显示提交评审按钮
    }

    // 以下操作仅对 HR 和 Admin 显示
    if (userRole !== 'admin' && userRole !== 'hr') {
      return buttons;
    }

    // 基础操作
    if (!isEditing) {
      buttons.push(
        <Button size="small" key="ai-screen" type="primary" loading={aiScreening} icon={<ThunderboltOutlined />} onClick={handleAIScreen} style={{background: 'linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)', border: 'none'}}>AI初筛</Button>,
        <Button size="small" key="reparse" icon={<ReloadOutlined />} onClick={handleReparse} disabled={resume?.parse_status === 'processing'}>重新解析</Button>,
        <Button size="small" key="edit" icon={<EditOutlined />} onClick={() => {
          form.setFieldsValue({
            candidate_name: resume.candidate_name,
            email: resume.email,
            contact: resume.contact,
            highest_degree: resume.parsed_data?.highest_degree,
            school: resume.parsed_data?.school,
            major: resume.parsed_data?.major,
            years_of_experience: resume.parsed_data?.years_of_experience,
            recent_company: resume.parsed_data?.recent_company
          });
          setIsEditing(true);
        }}>编辑</Button>
      );
    } else {
      buttons.push(
        <Button key="save" icon={<SaveOutlined />} type="primary" loading={updating} onClick={handleUpdate}>保存</Button>,
        <Button key="cancel" onClick={() => setIsEditing(false)}>取消</Button>
      );
      return buttons;
    }

    // 根据状态显示不同操作
    if (resume.status === 'auto_rejected_pending_review') {
      buttons.push(
        <Button size="small" key="confirm-reject" danger icon={<CloseCircleOutlined />} onClick={() => setIsRejectModalVisible(true)}>确认淘汰</Button>,
        <Button size="small" key="override" type="primary" icon={<CheckCircleOutlined />} onClick={handleOverrideRejection}>恢复评审</Button>
      );
    } else if (resume.status === 'pending_review') {
      // 待评审状态：可以直接HR决策，指派评审人在部门评审卡片头部
      buttons.push(
        <Button size="small" key="hr-decision" icon={<SolutionOutlined />} onClick={() => setIsHRDecisionModalVisible(true)}>直接决策</Button>
      );
    } else if (resume.status === 'pending_hr_decision') {
      buttons.push(
        <Button size="small" key="hr-decision" type="primary" icon={<SolutionOutlined />} onClick={() => setIsHRDecisionModalVisible(true)}>HR决策</Button>
      );
    } else if (resume.status === 'pending_interview') {
      // 初审通过，可以安排面试
      buttons.push(
        <Button size="small" key="schedule-interview" type="primary" icon={<TeamOutlined />} onClick={() => navigate('/resumes')}>安排面试</Button>
      );
    } else if (resume.status !== 'rejected' && resume.status !== 'completed') {
      buttons.push(
        <Button size="small" key="reject" danger icon={<CloseCircleOutlined />} onClick={() => setIsRejectModalVisible(true)}>淘汰</Button>
      );
    }

    return buttons;
  };

  // 渲染部门评审区域
  const renderDepartmentReviewSection = () => {
    if (!['pending_review', 'pending_dept_review', 'pending_hr_decision', 'rejected', 'completed', 'waitlist', 'pending_interview'].includes(resume.status)) {
      return null;
    }

    return (
      <Card
        title={<span><TeamOutlined style={{ marginRight: 8 }} />部门评审</span>}
        style={{ marginTop: 24, borderRadius: '16px' }}
        extra={['pending_review', 'pending_dept_review'].includes(resume.status) && (userRole === 'admin' || userRole === 'hr') && (
          <Button type="primary" size="small" onClick={() => setIsAssignReviewerModalVisible(true)}>指派评审人</Button>
        )}
      >
        {deptReviewSummary && deptReviewSummary.total_reviewers > 0 ? (
          <>
            <Row gutter={24} style={{ marginBottom: 24 }}>
              <Col span={6}>
                <Statistic title="评审人数" value={`${deptReviewSummary.completed_reviewers}/${deptReviewSummary.total_reviewers}`} />
              </Col>
              <Col span={6}>
                <Statistic
                  title="技术评分"
                  value={deptReviewSummary.avg_technical_score?.toFixed(1) || '-'}
                  suffix={deptReviewSummary.avg_technical_score ? '/10' : ''}
                />
              </Col>
              <Col span={6}>
                <Statistic
                  title="经验评分"
                  value={deptReviewSummary.avg_experience_score?.toFixed(1) || '-'}
                  suffix={deptReviewSummary.avg_experience_score ? '/10' : ''}
                />
              </Col>
              <Col span={6}>
                <Statistic title="推荐比例" value={(deptReviewSummary.recommend_ratio * 100).toFixed(0)} suffix="%" />
              </Col>
            </Row>

            {deptReviewSummary.reviews && deptReviewSummary.reviews.length > 0 && (
              <List
                header="评审详情"
                dataSource={deptReviewSummary.reviews}
                renderItem={(review: any) => (
                  <List.Item>
                    <List.Item.Meta
                      avatar={<Avatar icon={<UserOutlined />} />}
                      title={
                        <Space>
                          <span>{review.reviewer_name || '评审人'}</span>
                          <Tag color={review.is_completed ? 'green' : 'default'}>
                            {review.is_completed ? '已完成' : '待评审'}
                          </Tag>
                          {review.recommendation && review.is_completed && (
                            <Tag color={review.recommendation === 'recommend' ? 'green' : review.recommendation === 'not_recommend' ? 'red' : 'gold'}>
                              {review.recommendation === 'recommend' ? '推荐' : review.recommendation === 'not_recommend' ? '不推荐' : '待定'}
                            </Tag>
                          )}
                        </Space>
                      }
                      description={
                        review.is_completed ? (
                          <Space orientation="vertical" style={{ width: '100%' }}>
                            <Space>
                              <Text type="secondary">技术: {review.technical_score}/10</Text>
                              <Text type="secondary">经验: {review.experience_score}/10</Text>
                              <Text type="secondary">综合: {review.overall_score}/10</Text>
                            </Space>
                            {review.comment && <Text>{review.comment}</Text>}
                          </Space>
                        ) : (
                          <Text type="secondary">等待评审</Text>
                        )
                      }
                    />
                  </List.Item>
                )}
              />
            )}
          </>
        ) : (
          <Empty description="暂无部门评审记录" />
        )}
      </Card>
    );
  };

  return (
    <div style={{ height: 'calc(100vh - 100px)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/resumes')}>返回列表</Button>
      </div>
      <div style={{ flex: 1, display: 'flex', gap: '24px', overflow: 'hidden' }}>
      {/* Left: File Preview */}
      <div style={{ flex: '1 1 45%', minWidth: 0, background: '#fff', borderRadius: '16px', border: '1px solid #E2E8F0', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '16px 24px', borderBottom: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#F8FAFC' }}>
          <Title level={5} style={{ margin: 0 }}>简历原件预览</Title>
          <Button type="primary" icon={<DownloadOutlined />} href={downloadUrl} target="_blank">
            下载原件
          </Button>
        </div>
        <div style={{ flex: 1, background: '#F1F5F9' }}>
          {id ? (
            <iframe
              src={pdfPreviewUrl}
              style={{ width: '100%', height: '100%', border: 'none', display: 'block', background: '#fff' }}
              title="Resume Preview"
            />
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94A3B8' }}>
              暂无文件
            </div>
          )}
        </div>
      </div>

      {/* Right: AI Analysis & Details */}
      <div style={{ flex: '1 1 55%', minWidth: 0, overflowY: 'auto', paddingRight: '4px' }}>
        <Card
          variant="borderless"
          style={{ borderRadius: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', border: '1px solid #E2E8F0' }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, gap: 20, flexWrap: 'wrap' }}>
            {/* 姓名 + 邮箱 */}
            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 120 }}>
              {isEditing ? (
                  <Form form={form} layout="inline">
                      <Form.Item name="candidate_name" style={{ marginBottom: 0 }}>
                          <Input placeholder="姓名" disabled={updating} style={{ fontSize: 24, fontWeight: 600, width: 150 }} />
                      </Form.Item>
                  </Form>
              ) : (
                  <Title level={2} style={{ margin: 0 }}>{resume.candidate_name}</Title>
              )}

              <div style={{ marginTop: 8 }}>
                {isEditing ? (
                    <Form form={form} layout="inline" style={{ marginTop: 8 }}>
                         <Form.Item name="email" style={{ marginBottom: 0 }}>
                             <Input placeholder="邮箱" disabled={updating} style={{ width: 200 }} />
                         </Form.Item>
                         <Form.Item name="contact" style={{ marginBottom: 0 }}>
                             <Input placeholder="电话" disabled={updating} style={{ width: 150 }} />
                         </Form.Item>
                    </Form>
                ) : (
                    <Space wrap size={12}>
                        <Text
                          type="secondary"
                          ellipsis={{ tooltip: resume.email }}
                          style={{ maxWidth: 260 }}
                        >
                          {resume.email}
                        </Text>
                        <Text type="secondary">{resume.contact}</Text>
                    </Space>
                )}
              </div>
            </div>

            {/* 匹配度 + 状态 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ textAlign: 'center' }}>
                <Text type="secondary" style={{ fontSize: 11 }}>匹配度</Text>
                <div style={{ marginTop: 2 }}>
                  <Progress
                    type="circle"
                    percent={resume.match_score}
                    size={44}
                    format={percent => <span style={{ fontSize: 13, fontWeight: 700, color: '#0F172A' }}>{percent}%</span>}
                    strokeColor={resume.match_score >= 80 ? '#10B981' : resume.match_score >= 60 ? '#F59E0B' : '#EF4444'}
                  />
                </div>
              </div>
              <Tag color={statusInfo.color} style={{ fontSize: 13, padding: '4px 10px', margin: 0 }}>
                {statusInfo.text}
              </Tag>
            </div>

            {/* 操作按钮 */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {renderActionButtons()}
            </div>
          </div>

          <Descriptions column={2} bordered size="small">
            <Descriptions.Item label="应聘岗位">{resume.standard_position || resume.position?.title || resume.position_applied || '-'}</Descriptions.Item>
            <Descriptions.Item label="学历">{parsedData.highest_degree || '未识别'}</Descriptions.Item>
            <Descriptions.Item label="毕业院校">{parsedData.school || '未识别'}</Descriptions.Item>
            <Descriptions.Item label="专业">{parsedData.major || '未识别'}</Descriptions.Item>
            <Descriptions.Item label="工作年限">{formatExperience(parsedData.years_of_experience)}</Descriptions.Item>
            <Descriptions.Item label="最近公司">{parsedData.recent_company || '未识别'}</Descriptions.Item>
            <Descriptions.Item label="性别">{parsedData.gender || resume.gender || '未识别'}</Descriptions.Item>
            <Descriptions.Item label="出生年月">{parsedData.birthday || '未识别'}</Descriptions.Item>
            <Descriptions.Item label="当前职位">{parsedData.current_position || '未识别'}</Descriptions.Item>
            <Descriptions.Item label="技能">
              {Array.isArray(parsedData.skills) && parsedData.skills.length
                ? parsedData.skills.join('、')
                : (typeof parsedData.skills === 'string' && parsedData.skills ? parsedData.skills : '未识别')}
            </Descriptions.Item>
            <Descriptions.Item label="证书/资质">
              {Array.isArray(parsedData.certifications) && parsedData.certifications.length
                ? parsedData.certifications.join('、')
                : '未识别'}
            </Descriptions.Item>
            <Descriptions.Item label="自我评价" span={2}>
              {parsedData.self_evaluation || '未识别'}
            </Descriptions.Item>
            {Array.isArray(parsedData.work_experience) && parsedData.work_experience.length > 0 && (
              <Descriptions.Item label="工作经历" span={2}>
                {parsedData.work_experience.map((w: any, i: number) => (
                  <div key={i} style={{ marginBottom: 6 }}>
                    <strong>{w.company || '公司不详'}</strong> · {w.title || ''}（{w.duration || `${w.start || ''}~${w.end || ''}`}）
                    {w.description && <div style={{ color: '#666' }}>{w.description}</div>}
                  </div>
                ))}
              </Descriptions.Item>
            )}
            {Array.isArray(parsedData.education) && parsedData.education.length > 0 && (
              <Descriptions.Item label="教育经历" span={2}>
                {parsedData.education.map((e: any, i: number) => (
                  <div key={i} style={{ marginBottom: 4 }}>
                    <strong>{e.school || '学校不详'}</strong> · {e.degree || ''} · {e.major || ''}（{e.start || ''}~{e.end || ''}）
                  </div>
                ))}
              </Descriptions.Item>
            )}
            <Descriptions.Item label="电话">{resume.contact || parsedData.phone || '未识别'}</Descriptions.Item>
            <Descriptions.Item label="解析状态">{getParseStatusText(resume.parse_status)}</Descriptions.Item>
            <Descriptions.Item label="失败原因">{resume.parse_status === 'failed' ? (resume.parse_error || '未知') : '-'}</Descriptions.Item>
            {resume.reject_reason_category && (
              <>
                <Descriptions.Item label="淘汰原因">
                  {REJECT_REASONS.find(r => r.value === resume.reject_reason_category)?.label || resume.reject_reason_category}
                </Descriptions.Item>
                <Descriptions.Item label="详细说明">{resume.reject_reason_detail || '-'}</Descriptions.Item>
              </>
            )}
          </Descriptions>
        </Card>

        <Tabs
          style={{ marginTop: 16 }}
          items={[
            {
              key: 'ai',
              label: (<Space><RobotOutlined style={{ color: '#6366F1' }} />AI 智能分析</Space>),
              children: (<>
          {/* AI 智能初筛评价 */}
          <Card bordered={false} style={{ borderRadius: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', border: '1px solid #E2E8F0' }}>
          <div style={{ marginBottom: 8 }}>
            <Text strong style={{ fontSize: 16, color: '#6366F1' }}>AI 智能初筛评价</Text>
          </div>
          {aiReview ? (
            typeof aiReview === 'object' ? (
              <div style={{ background: '#F8FAFC', padding: '20px', borderRadius: '12px', border: '1px solid #E2E8F0', ...aiContentStyle }}>
                {aiDimensions.length > 0 && (
                  <div style={{ marginBottom: 16, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {aiDimensions.map((dimension) => (
                      <Tag key={dimension.name} color={dimension.score >= 4 ? 'green' : dimension.score >= 3 ? 'blue' : dimension.score >= 2 ? 'orange' : 'red'} style={{ margin: 0, whiteSpace: 'normal', wordBreak: 'break-word' }}>
                        {dimension.name} {dimension.score}/5
                      </Tag>
                    ))}
                  </div>
                )}
                {aiReview.summary && (
                  <div style={{ marginBottom: 16, padding: '12px 16px', background: '#EEF2FF', borderRadius: '8px', borderLeft: '4px solid #6366F1', ...aiContentStyle }}>
                    <Text strong style={{ color: '#4338CA' }}>总体评价：</Text>
                    <Text style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{aiReview.summary}</Text>
                  </div>
                )}
                {aiReview.recommendation && (
                  <div style={{ marginBottom: 16 }}>
                    <Tag color={aiReview.recommendation.includes('strongly_recommend') ? 'green' : aiReview.recommendation.includes('recommend') && !aiReview.recommendation.includes('not') ? 'blue' : aiReview.recommendation.includes('neutral') ? 'gold' : 'red'} style={{ fontSize: 14, padding: '4px 12px', whiteSpace: 'normal', wordBreak: 'break-word' }}>
                      {aiReview.recommendation === 'strongly_recommend' ? '强烈推荐' : aiReview.recommendation === 'recommend' ? '推荐' : aiReview.recommendation === 'neutral' ? '中立' : aiReview.recommendation === 'not_recommend' ? '不推荐' : aiReview.recommendation === 'strongly_not_recommend' ? '强烈不推荐' : aiReview.recommendation}
                    </Tag>
                  </div>
                )}
                {aiReview.strengths && aiReview.strengths.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <Text strong style={{ color: '#10B981', display: 'block', marginBottom: 8 }}>✓ 核心优势</Text>
                    <div>
                      {aiReview.strengths.map((s: string, i: number) => (
                        <Tag key={i} color="green" style={{ marginBottom: 4, padding: '2px 8px', whiteSpace: 'normal', wordBreak: 'break-word' }}>{s}</Tag>
                      ))}
                    </div>
                  </div>
                )}
                {aiReview.risks && aiReview.risks.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <Text strong style={{ color: '#EF4444', display: 'block', marginBottom: 8 }}>⚠ 潜在风险</Text>
                    <div>
                      {aiReview.risks.map((r: string, i: number) => (
                        <Tag key={i} color="red" style={{ marginBottom: 4, padding: '2px 8px', whiteSpace: 'normal', wordBreak: 'break-word' }}>{r}</Tag>
                      ))}
                    </div>
                  </div>
                )}
                {aiReview.skill_match && (aiReview.skill_match.matched?.length > 0 || aiReview.skill_match.gaps?.length > 0) && (
                  <Row gutter={16} style={{ marginBottom: 16 }}>
                    <Col span={12}>
                      <Text strong style={{ color: '#3B82F6', display: 'block', marginBottom: 8 }}>匹配技能</Text>
                      {(aiReview.skill_match.matched || []).map((s: string, i: number) => (
                        <Tag key={i} color="blue" style={{ marginBottom: 4, padding: '2px 8px', whiteSpace: 'normal', wordBreak: 'break-word' }}>{s}</Tag>
                      ))}
                    </Col>
                    <Col span={12}>
                      <Text strong style={{ color: '#F59E0B', display: 'block', marginBottom: 8 }}>技能差距</Text>
                      {(aiReview.skill_match.gaps || []).map((s: string, i: number) => (
                        <Tag key={i} color="orange" style={{ marginBottom: 4, padding: '2px 8px', whiteSpace: 'normal', wordBreak: 'break-word' }}>{s}</Tag>
                      ))}
                    </Col>
                  </Row>
                )}
                {aiReview.suggested_questions && aiReview.suggested_questions.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <Text strong style={{ display: 'block', marginBottom: 8, color: '#7C3AED' }}>❓ 建议面试问题</Text>
                    {aiReview.suggested_questions.map((q: string, i: number) => (
                      <div key={i} style={{ padding: '8px 12px', marginBottom: 4, background: '#FDF4FF', borderRadius: '6px', borderLeft: '3px solid #7C3AED', fontSize: 14, ...aiContentStyle }}>
                        {i + 1}. {q}
                      </div>
                    ))}
                  </div>
                )}
                {aiReview.experience_analysis && (
                  <div style={{ padding: '12px 16px', background: '#F0FDF4', borderRadius: '8px', borderLeft: '4px solid #10B981', ...aiContentStyle }}>
                    <Text strong style={{ color: '#15803D' }}>经验分析：</Text>
                    <Text style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{aiReview.experience_analysis}</Text>
                  </div>
                )}
                {aiReview.raw_response && (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{aiReview.raw_response}</ReactMarkdown>
                )}
              </div>
            ) : (
              <div style={{ background: '#F8FAFC', padding: '20px', borderRadius: '12px', border: '1px solid #E2E8F0', color: '#334155', fontSize: '15px', lineHeight: 1.8, ...aiContentStyle }}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{String(aiReview)}</ReactMarkdown>
              </div>
            )
          ) : (
            <div style={{ background: '#F8FAFC', padding: '32px 20px', borderRadius: '12px', border: '1px dashed #CBD5E1', textAlign: 'center', color: '#94A3B8' }}>
              <RobotOutlined style={{ fontSize: 40, marginBottom: 12, color: '#CBD5E1' }} />
              <div style={{ fontSize: 14 }}>暂无AI评价，点击“AI初筛”按钮生成</div>
            </div>
          )}

          {/* 其他岗位匹配推荐 */}
          {resume.other_position_matches && resume.other_position_matches.length > 0 && (
            <>
              <Divider style={{ borderColor: '#E2E8F0' }}>其他岗位匹配推荐</Divider>
              <div style={{
                background: '#F0F9FF',
                padding: '20px',
                borderRadius: '12px',
                border: '1px solid #BAE6FD',
              }}>
                <Text type="secondary" style={{ marginBottom: 12, display: 'block' }}>
                  该候选人与以下岗位也有较好的匹配度，可考虑转岗推荐
                </Text>
                <List
                  dataSource={resume.other_position_matches}
                  renderItem={(match: any) => (
                    <List.Item style={{ border: 'none', padding: '12px 0' }}>
                      <Card
                        size="small"
                        style={{ width: '100%', background: '#fff', borderRadius: 8 }}
                        bodyStyle={{ padding: '12px 16px' }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div style={{ flex: 1 }}>
                            <Space>
                              <Text strong>{match.position_title}</Text>
                              {match.is_better_match && (
                                <Tag color="green">更适合</Tag>
                              )}
                            </Space>
                            {match.reason && (
                              <Text type="secondary" style={{ display: 'block', marginTop: 4, fontSize: 13 }}>
                                {match.reason}
                              </Text>
                            )}
                          </div>
                          <Space>
                            <Progress
                              type="circle"
                              percent={match.match_score}
                              width={45}
                              format={percent => <span style={{ fontSize: 12, fontWeight: 600 }}>{percent}%</span>}
                              strokeColor={match.match_score >= 80 ? '#10B981' : match.match_score >= 60 ? '#F59E0B' : '#EF4444'}
                            />
                            {(userRole === 'admin' || userRole === 'hr') && match.position_id && (
                              <Button
                                type="primary"
                                size="small"
                                onClick={() => handleTransfer(match.position_id, match.position_title)}
                              >
                                转岗
                              </Button>
                            )}
                          </Space>
                        </div>
                      </Card>
                    </List.Item>
                  )}
                />
              </div>
            </>
          )}
        </Card></>
            )},
            {
              key: 'reviews',
              label: (<Space><TeamOutlined />部门评审</Space>),
              children: (<>{renderDepartmentReviewSection()}</>)
            },
          ]}
        />
      </div>
      </div>

      {/* 淘汰确认弹窗 */}
      <Modal
        title="确认淘汰"
        open={isRejectModalVisible}
        onOk={handleConfirmRejection}
        onCancel={() => { setIsRejectModalVisible(false); rejectForm.resetFields(); }}
        okText="确认淘汰"
        cancelText="取消"
        okType="danger"
        confirmLoading={submitting}
      >
        <Form form={rejectForm} layout="vertical" style={{ marginTop: 24 }}>
          <RejectReasonSelector />
        </Form>
      </Modal>

      {/* 指派评审人弹窗 */}
      <Modal
        title="指派部门评审人"
        open={isAssignReviewerModalVisible}
        onOk={handleAssignReviewer}
        onCancel={() => { setIsAssignReviewerModalVisible(false); deptReviewForm.resetFields(); }}
        okText="确认指派"
        cancelText="取消"
        confirmLoading={submitting}
      >
        <Form form={deptReviewForm} layout="vertical" style={{ marginTop: 24 }}>
          <Form.Item
            name="reviewer_ids"
            label="选择评审人（可多选）"
            rules={[{ required: true, message: '请选择至少一位评审人' }]}
          >
            <Select
              mode="multiple"
              placeholder="请选择评审人，可多选"
              size="large"
              showSearch
              optionFilterProp="children"
              style={{ width: '100%' }}
            >
              {reviewers.map((r: any) => (
                <Select.Option key={r.id} value={r.id}>{r.full_name || r.email}</Select.Option>
              ))}
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      {/* HR决策弹窗 */}
      <Modal
        title="HR决策"
        open={isHRDecisionModalVisible}
        onOk={handleHRDecision}
        onCancel={() => { setIsHRDecisionModalVisible(false); hrDecisionForm.resetFields(); }}
        okText="提交决策"
        cancelText="取消"
        width={500}
        confirmLoading={submitting}
      >
        <Form form={hrDecisionForm} layout="vertical" style={{ marginTop: 24 }}>
          <Form.Item
            name="decision"
            label="决策结果"
            rules={[{ required: true, message: '请选择决策结果' }]}
          >
            <Select placeholder="请选择决策结果" size="large">
              <Select.Option value="pending_interview">进入面试</Select.Option>
              <Select.Option value="waitlist">加入备选</Select.Option>
              <Select.Option value="rejected">淘汰</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item
            noStyle
            shouldUpdate={(prevValues, currentValues) => prevValues.decision !== currentValues.decision}
          >
            {({ getFieldValue }) =>
              getFieldValue('decision') === 'rejected' && (
                <RejectReasonSelector />
              )
            }
          </Form.Item>

          <Form.Item
            name="hr_comment"
            label="HR备注"
          >
            <TextArea rows={3} placeholder="请输入备注信息（可选）" maxLength={500} showCount />
          </Form.Item>
        </Form>
      </Modal>

      {/* 提交评审弹窗 */}
      <Modal
        title="提交部门评审"
        open={isSubmitReviewModalVisible}
        onOk={handleSubmitReview}
        onCancel={() => { setIsSubmitReviewModalVisible(false); submitReviewForm.resetFields(); }}
        okText="提交评审"
        cancelText="取消"
        width={500}
        confirmLoading={submitting}
      >
        <Form form={submitReviewForm} layout="vertical" style={{ marginTop: 24 }}>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item
                name="technical_score"
                label="技术评分"
                extra="1-10分"
              >
                <Select placeholder="技术评分" size="large">
                  {[1,2,3,4,5,6,7,8,9,10].map(n => (
                    <Select.Option key={n} value={n}>{n}分</Select.Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="experience_score"
                label="经验评分"
                extra="1-10分"
              >
                <Select placeholder="经验评分" size="large">
                  {[1,2,3,4,5,6,7,8,9,10].map(n => (
                    <Select.Option key={n} value={n}>{n}分</Select.Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="overall_score"
                label="综合评分"
                extra="1-10分"
              >
                <Select placeholder="综合评分" size="large">
                  {[1,2,3,4,5,6,7,8,9,10].map(n => (
                    <Select.Option key={n} value={n}>{n}分</Select.Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <Form.Item
            name="recommendation"
            label="推荐意见"
            rules={[{ required: true, message: '请选择推荐意见' }]}
          >
            <Select placeholder="请选择推荐意见" size="large">
              <Select.Option value="recommend">推荐</Select.Option>
              <Select.Option value="not_recommend">不推荐</Select.Option>
              <Select.Option value="pending">待定</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item
            name="comment"
            label="评审意见"
          >
            <TextArea rows={4} placeholder="请输入详细评审意见（可选）" maxLength={1000} showCount />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default ResumeDetail;
