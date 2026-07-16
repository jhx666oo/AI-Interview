import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, Typography, Tag, Descriptions, Button, Divider, Form, Input, Upload, message, Result, Spin } from 'antd';
import { UploadOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import request from '../../utils/request';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const { Title, Paragraph, Text } = Typography;

const PublicJobDetail: React.FC = () => {
  const { id } = useParams();
  const [position, setPosition] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [form] = Form.useForm();

  useEffect(() => {
    if (id) {
      fetchPosition(id);
    }
  }, [id]);

  const fetchPosition = async (positionId: string) => {
    setLoading(true);
    try {
      const res = await request.get(`/positions/${positionId}`);
      if (res.status !== 'published') {
        message.error('该岗位已下架或不存在');
        setPosition(null);
      } else {
        setPosition(res);
      }
    } catch (error) {
      message.error('获取岗位详情失败');
    } finally {
      setLoading(false);
    }
  };

  const onFinish = async (values: any) => {
    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('position_id', id!);
      formData.append('candidate_name', values.name);
      formData.append('email', values.email);
      formData.append('contact', values.phone);
      formData.append('file', values.file.file);

      await request.post('/resumes', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      setSubmitted(true);
    } catch (error) {
      message.error('投递失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#F8FAFC' }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!position && !loading) {
    return (
      <div style={{ height: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center', background: '#F8FAFC' }}>
        <Result
          status="404"
          title="岗位不存在或已下架"
          subTitle="请联系招聘方确认岗位状态"
        />
      </div>
    );
  }

  if (submitted) {
    return (
      <div style={{ height: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center', background: '#F8FAFC' }}>
        <Card style={{ width: 500, borderRadius: 16, boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
          <Result
            status="success"
            title="简历投递成功！"
            subTitle="我们将尽快评估您的简历，请留意邮件或电话通知。"
            extra={[
              <Button type="primary" key="back" onClick={() => window.location.reload()}>
                返回岗位详情
              </Button>,
            ]}
          />
        </Card>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#F8FAFC', padding: '40px 20px' }}>
      <div style={{ maxWidth: 800, margin: '0 auto' }}>
        <Card bordered={false} style={{ borderRadius: 16, boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
          <div style={{ marginBottom: 32 }}>
            <Title level={2} style={{ margin: 0, color: '#0F172A' }}>{position.title}</Title>
            <div style={{ marginTop: 12, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <Tag color="blue">{position.department || '研发部'}</Tag>
              <Tag color="green">{position.location || '北京'}</Tag>
              <Tag color="orange">{position.salary_range || '面议'}</Tag>
            </div>
          </div>

          <Divider />

          <div style={{ marginBottom: 32 }}>
            <Title level={4}>岗位职责</Title>
            <div style={{ 
              background: '#F1F5F9', 
              padding: '20px', 
              borderRadius: '8px', 
              color: '#334155',
              lineHeight: 1.8
            }}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {position.description || '暂无描述'}
              </ReactMarkdown>
            </div>
          </div>

          <div style={{ marginBottom: 32 }}>
            <Title level={4}>任职要求</Title>
            <div style={{ 
              background: '#F1F5F9', 
              padding: '20px', 
              borderRadius: '8px', 
              color: '#334155',
              lineHeight: 1.8
            }}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {position.requirements || '暂无详细要求'}
              </ReactMarkdown>
            </div>
          </div>

          <Divider />

          <div style={{ marginTop: 40 }}>
            <Title level={3} style={{ textAlign: 'center', marginBottom: 32 }}>投递简历</Title>
            <Form
              form={form}
              layout="vertical"
              onFinish={onFinish}
              size="large"
              style={{ maxWidth: 500, margin: '0 auto' }}
            >
              <Form.Item
                name="name"
                label="您的姓名"
                rules={[{ required: true, message: '请输入您的姓名' }]}
              >
                <Input placeholder="请输入您的真实姓名" />
              </Form.Item>

              <Form.Item
                name="email"
                label="电子邮箱"
                rules={[
                  { required: true, message: '请输入您的电子邮箱' },
                  { type: 'email', message: '请输入有效的邮箱地址' }
                ]}
              >
                <Input placeholder="用于接收面试通知" />
              </Form.Item>

              <Form.Item
                name="phone"
                label="联系电话"
                rules={[{ required: true, message: '请输入您的联系电话' }]}
              >
                <Input placeholder="请输入手机号码" />
              </Form.Item>

              <Form.Item
                name="file"
                label="简历附件"
                rules={[{ required: true, message: '请上传您的简历文件' }]}
                extra="仅支持 PDF 格式，大小不超过 10MB"
              >
                <Upload 
                  maxCount={1}
                  beforeUpload={(file) => {
                    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
                    if (!isPdf) {
                      message.error('只允许上传 PDF 格式的文件');
                      return Upload.LIST_IGNORE;
                    }
                    return false;
                  }}
                  accept=".pdf"
                >
                  <Button icon={<UploadOutlined />}>上传简历</Button>
                </Upload>
              </Form.Item>

              <Form.Item style={{ marginTop: 32 }}>
                <Button type="primary" htmlType="submit" loading={submitting} block style={{ height: 48, fontSize: 16 }}>
                  立即投递
                </Button>
              </Form.Item>
            </Form>
          </div>
        </Card>
        
        <div style={{ textAlign: 'center', marginTop: 32, color: '#94A3B8' }}>
          <Text type="secondary">Powered by AI Interview System</Text>
        </div>
      </div>
    </div>
  );
};

export default PublicJobDetail;