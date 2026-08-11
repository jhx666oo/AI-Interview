import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Card, Descriptions, Button, Rate, Input, message, Spin, Result, Space, Tag, Typography, Divider
} from 'antd';
import {
  CheckCircleOutlined, CloseCircleOutlined, ClockCircleOutlined
} from '@ant-design/icons';
import request from '../../utils/request';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

interface ResumeData {
  id: string;
  candidate_name: string;
  email: string;
  contact: string;
  match_score: number;
  ai_review: string;
  resume_markdown: string;
  parsed_data: any;
  standard_position?: string;
  position_applied?: string;
  position: {
    id: string;
    title: string;
    description: string;
    requirements: string;
  };
  status: string;
  department_reviews: any[];
}

const PublicReview: React.FC = () => {
  const { resumeId, reviewerId } = useParams<{ resumeId: string; reviewerId: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [resume, setResume] = useState<ResumeData | null>(null);
  const [existingReview, setExistingReview] = useState<any>(null);

  const [technicalScore, setTechnicalScore] = useState<number>(0);
  const [experienceScore, setExperienceScore] = useState<number>(0);
  const [overallScore, setOverallScore] = useState<number>(0);
  const [recommendation, setRecommendation] = useState<string>('');
  const [comment, setComment] = useState<string>('');

  useEffect(() => {
    fetchResume();
  }, [resumeId]);

  const fetchResume = async () => {
    setLoading(true);
    try {
      const res = await request.get(`/public/review/${resumeId}?reviewer_id=${reviewerId}`);
      setResume(res.resume);
      setExistingReview(res.existing_review);

      if (res.existing_review) {
        setTechnicalScore(res.existing_review.technical_score || 0);
        setExperienceScore(res.existing_review.experience_score || 0);
        setOverallScore(res.existing_review.overall_score || 0);
        setRecommendation(res.existing_review.recommendation || '');
        setComment(res.existing_review.comment || '');
      }
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '获取简历信息失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!recommendation) {
      message.warning('请选择推荐意见');
      return;
    }

    setSubmitting(true);
    try {
      await request.post(`/public/review/${resumeId}/submit`, {
        reviewer_id: reviewerId,
        technical_score: technicalScore,
        experience_score: experienceScore,
        overall_score: overallScore,
        recommendation: recommendation,
        comment: comment,
      });
      message.success('审核已提交');
      fetchResume();
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!resume) {
    return (
      <div style={{ padding: 40 }}>
        <Result status="404" title="简历不存在" subTitle="该简历可能已被删除或链接无效" />
      </div>
    );
  }

  if (existingReview?.is_completed) {
    return (
      <div style={{ padding: 40, maxWidth: 800, margin: '0 auto' }}>
        <Result
          status="success"
          title="审核已完成"
          subTitle="您已完成该简历的审核，感谢您的参与！"
          extra={[
            <Button type="primary" key="back" onClick={() => navigate('/')}>
              返回首页
            </Button>,
          ]}
        />
      </div>
    );
  }

  return (
    <div style={{ padding: 'clamp(16px, 5vw, 40px)', maxWidth: 1000, margin: '0 auto' }}>
      <Card>
        <Title level={3}>简历审核</Title>
        <Text type="secondary">请仔细阅读简历信息并给出您的评审意见</Text>

        <Divider />

        <Descriptions title="候选人信息" bordered column={{ xs: 1, sm: 2 }} style={{ marginBottom: 24 }}>
          <Descriptions.Item label="姓名">{resume.candidate_name}</Descriptions.Item>
          <Descriptions.Item label="应聘岗位">{resume.standard_position || resume.position?.title || resume.position_applied || '-'}</Descriptions.Item>
          <Descriptions.Item label="邮箱">{resume.email}</Descriptions.Item>
          <Descriptions.Item label="联系电话">{resume.contact}</Descriptions.Item>
          <Descriptions.Item label="匹配度评分">
            <Tag color={resume.match_score >= 80 ? 'green' : resume.match_score >= 60 ? 'blue' : 'orange'}>
              {resume.match_score}分
            </Tag>
          </Descriptions.Item>
        </Descriptions>

        {resume.ai_review && (
          <Card title="AI 初筛意见" style={{ marginBottom: 24 }} size="small">
            <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{resume.ai_review}</div>
          </Card>
        )}

        {resume.resume_markdown && (
          <Card title="简历详情" style={{ marginBottom: 24 }} size="small">
            <div style={{ whiteSpace: 'pre-wrap', maxHeight: 400, overflow: 'auto', overflowWrap: 'anywhere' }}>
              {resume.resume_markdown}
            </div>
          </Card>
        )}

        <Divider />

        <Title level={4}>评审意见</Title>

        <div style={{ marginBottom: 24 }}>
          <Text>技术能力评分</Text>
          <div>
            <Rate value={technicalScore} onChange={setTechnicalScore} count={10} />
            <Text style={{ marginLeft: 8 }}>{technicalScore}分</Text>
          </div>
        </div>

        <div style={{ marginBottom: 24 }}>
          <Text>经验匹配评分</Text>
          <div>
            <Rate value={experienceScore} onChange={setExperienceScore} count={10} />
            <Text style={{ marginLeft: 8 }}>{experienceScore}分</Text>
          </div>
        </div>

        <div style={{ marginBottom: 24 }}>
          <Text>综合评分</Text>
          <div>
            <Rate value={overallScore} onChange={setOverallScore} count={10} />
            <Text style={{ marginLeft: 8 }}>{overallScore}分</Text>
          </div>
        </div>

        <div style={{ marginBottom: 24 }}>
          <Text>推荐意见</Text>
          <div style={{ marginTop: 8 }}>
            <Space wrap>
              <Button
                type={recommendation === 'recommend' ? 'primary' : 'default'}
                icon={<CheckCircleOutlined />}
                onClick={() => setRecommendation('recommend')}
                style={{ backgroundColor: recommendation === 'recommend' ? '#52c41a' : undefined, borderColor: '#52c41a' }}
              >
                推荐
              </Button>
              <Button
                type={recommendation === 'not_recommend' ? 'primary' : 'default'}
                danger={recommendation === 'not_recommend'}
                icon={<CloseCircleOutlined />}
                onClick={() => setRecommendation('not_recommend')}
              >
                不推荐
              </Button>
              <Button
                type={recommendation === 'pending' ? 'primary' : 'default'}
                icon={<ClockCircleOutlined />}
                onClick={() => setRecommendation('pending')}
              >
                待定
              </Button>
            </Space>
          </div>
        </div>

        <div style={{ marginBottom: 24 }}>
          <Text>详细评价</Text>
          <TextArea
            rows={4}
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder="请输入您的详细评价意见..."
            style={{ marginTop: 8 }}
          />
        </div>

        <div style={{ textAlign: 'center', marginTop: 32 }}>
          <Button type="primary" size="large" onClick={handleSubmit} loading={submitting}>
            提交审核
          </Button>
        </div>
      </Card>
    </div>
  );
};

export default PublicReview;
