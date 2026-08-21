import React, { useEffect, useState, useCallback } from 'react';
import {
  Button, Card, Divider, Form, Input, Space, Typography, message, Alert, Spin, Tabs,
} from 'antd';
import { SaveOutlined, ReloadOutlined } from '@ant-design/icons';
import request from '../../utils/request';

const { Text, Paragraph } = Typography;
const { TextArea } = Input;

const PLACEHOLDERS: Record<string, string[]> = {
  candidate_email_subject: ['candidateName', 'position', 'timeLabel'],
  candidate_email_html: ['candidateName', 'position', 'timeLabel', 'typeLabel', 'location', 'interviewerRow', 'meetingSection', 'meetingSectionTitle', 'fromName'],
  candidate_email_text: ['candidateName', 'position', 'timeLabel', 'typeLabel', 'location', 'interviewerText', 'meetingText'],
  interviewer_reminder: ['candidateName', 'position', 'interviewTime'],
  business_card_title: ['position'],
  business_card_body: ['count', 'position'],
  business_card_button: ['position'],
  interview_notice_title: ['operatorName', 'candidateName', 'position'],
  interview_notice_body: ['operatorName', 'candidateName', 'position'],
  interview_notice_button: ['operatorName', 'candidateName', 'position'],
  card_footer: ['candidateName', 'position'],
};

const PlaceholderHint: React.FC<{ keys: string[] }> = ({ keys }) => (
  <Paragraph type="secondary" style={{ marginTop: 4, fontSize: 12 }}>
    可用占位符：
    {keys.map((k) => <Text code key={k} style={{ marginRight: 6 }}>{`{{${k}}}`}</Text>)}
  </Paragraph>
);

const TemplatesPage: React.FC = () => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const res = await request.get('/settings/templates') as any;
      form.setFieldsValue(res.templates || {});
    } catch { message.error('获取消息模板失败'); }
    finally { setLoading(false); }
  }, [form]);

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      await request.put('/settings/templates', { templates: values });
      message.success('消息模板已保存');
      fetchTemplates();
    } catch (e: any) {
      if (!e.errorFields) message.error(e.response?.data?.detail || '保存失败');
    } finally { setSaving(false); }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>消息模板</Typography.Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={fetchTemplates} loading={loading}>刷新</Button>
          <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={saving}>保存</Button>
        </Space>
      </div>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="这里配置所有发送给外部/他人的内容（候选人邮件、面试官提醒）。模板中用 {{占位符}} 引用动态数据，保存后立即对后续发送生效。"
      />
      <Spin spinning={loading}>
        <Card>
          <Form form={form} layout="vertical">
            <Tabs
              items={[
                {
                  key: 'email',
                  label: '候选人面试邀请邮件',
                  children: (
                    <>
                      <Form.Item name="candidate_email_subject" label="邮件主题"
                        rules={[{ required: true, message: '请填写邮件主题' }]}>
                        <Input placeholder="【面试邀请】{{candidateName}} - {{position}}（{{timeLabel}}）" />
                      </Form.Item>
                      <PlaceholderHint keys={PLACEHOLDERS.candidate_email_subject} />
                      <Form.Item name="candidate_email_html" label="邮件正文（HTML）"
                        rules={[{ required: true, message: '请填写邮件正文' }]}>
                        <TextArea rows={18} placeholder="<div>...</div>" style={{ fontFamily: 'monospace', fontSize: 12 }} />
                      </Form.Item>
                      <PlaceholderHint keys={PLACEHOLDERS.candidate_email_html} />
                      <Divider />
                      <Form.Item name="candidate_email_text" label="邮件正文（纯文本，兜底用）">
                        <TextArea rows={8} placeholder="纯文本正文" />
                      </Form.Item>
                      <PlaceholderHint keys={PLACEHOLDERS.candidate_email_text} />
                    </>
                  ),
                },
                {
                  key: 'reminder',
                  label: '面试官提醒（飞书消息）',
                  children: (
                    <>
                      <Form.Item name="interviewer_reminder" label="提醒文本（每行一条，会议链接/地点/卡片链接由系统自动追加）"
                        rules={[{ required: true, message: '请填写提醒文本' }]}>
                        <TextArea rows={8} placeholder={'面试提醒：{{candidateName}}\n岗位：{{position}}\n面试时间：{{interviewTime}}'} />
                      </Form.Item>
                      <PlaceholderHint keys={PLACEHOLDERS.interviewer_reminder} />
                    </>
                  ),
                },
                {
                  key: 'card',
                  label: '飞书卡片（业务推送/面试通知）',
                  children: (
                    <>
                      <Form.Item name="business_card_title" label="业务筛选推送卡片标题"
                        rules={[{ required: true, message: '请填写卡片标题' }]}>
                        <Input placeholder="简历筛选待处理：{{position}}" />
                      </Form.Item>
                      <PlaceholderHint keys={PLACEHOLDERS.business_card_title} />
                      <Form.Item name="business_card_body" label="业务筛选推送卡片正文"
                        rules={[{ required: true, message: '请填写卡片正文' }]}>
                        <TextArea rows={3} placeholder="您有 {{count}} 份候选人简历待处理，已统一汇总到待筛选列表，请点击链接完成筛选" />
                      </Form.Item>
                      <PlaceholderHint keys={PLACEHOLDERS.business_card_body} />
                      <Form.Item name="business_card_button" label="业务筛选推送卡片按钮文案">
                        <Input placeholder="进入待筛选简历" />
                      </Form.Item>
                      <PlaceholderHint keys={PLACEHOLDERS.business_card_button} />
                      <Divider />
                      <Form.Item name="interview_notice_title" label="面试安排通知卡片标题（发给面试官）"
                        rules={[{ required: true, message: '请填写卡片标题' }]}>
                        <Input placeholder="🎯 面试安排通知" />
                      </Form.Item>
                      <PlaceholderHint keys={PLACEHOLDERS.interview_notice_title} />
                      <Form.Item name="interview_notice_body" label="面试安排通知卡片正文"
                        rules={[{ required: true, message: '请填写卡片正文' }]}>
                        <TextArea rows={3} placeholder="{{operatorName}} 为候选人安排了面试，请留意后续会议邀请，及时查看候选人简历，面试结束后在系统内填写评价。" />
                      </Form.Item>
                      <PlaceholderHint keys={PLACEHOLDERS.interview_notice_body} />
                      <Form.Item name="interview_notice_button" label="面试安排通知卡片按钮文案">
                        <Input placeholder="🔍 查看候选人" />
                      </Form.Item>
                      <Divider />
                      <Form.Item name="card_footer" label="卡片统一落款">
                        <Input placeholder="发送自 招聘管理智能小助手" />
                      </Form.Item>
                      <PlaceholderHint keys={PLACEHOLDERS.card_footer} />
                    </>
                  ),
                },
              ]}
            />
          </Form>
        </Card>
      </Spin>
    </div>
  );
};

export default TemplatesPage;
