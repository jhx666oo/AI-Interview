import React, { useEffect, useState } from 'react';
import { Card, Form, Input, Button, message, Typography, Space, Table, Tag } from 'antd';
import { SaveOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import request from '../../utils/request';

const { TextArea } = Input;
const { Text } = Typography;

const JDManagementEditor: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [record, setRecord] = useState<any>(null);
  const [form] = Form.useForm();

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await request.get(`/jd-management/${id}`) as any;
      setRecord(res);
      form.setFieldsValue({ description: res.description, requirements: res.requirements });
    } catch (e: any) { message.error('加载失败'); } finally { setLoading(false); }
  };

  useEffect(() => { if (id) fetchData(); }, [id]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const values = await form.validateFields();
      await request.put(`/jd-management/${id}`, values);
      message.success('JD 已保存，新版本已创建');
      fetchData();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error('保存失败');
    } finally { setSaving(false); }
  };

  const verColumns = [
    { title: '版本', dataIndex: 'version_number', key: 'version_number', width: 60 },
    { title: '修改人', dataIndex: 'created_by', key: 'created_by', width: 120 },
    {
      title: '修改时间', dataIndex: 'created_at', key: 'created_at', width: 160,
      render: (v: string) => v ? new Date(v).toLocaleString('zh-CN') : '-',
    },
    {
      title: 'JD 快照', dataIndex: 'description', key: 'description', ellipsis: true,
      render: (v: string) => <Text ellipsis style={{ maxWidth: 300 }} title={v}>{v?.slice(0, 60) || '-'}</Text>,
    },
  ];

  return (
    <Card
      title={record ? `编辑 JD：${record.title}` : '加载中...'}
      extra={<Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/jd-management')}>返回列表</Button>}
      loading={loading}
    >
      <Form form={form} layout="vertical">
        <Form.Item label="岗位部门"><Input value={record?.department} disabled /></Form.Item>
        <Form.Item name="description" label="岗位描述 (JD)" rules={[{ required: true }]}>
          <TextArea rows={8} placeholder="输入岗位描述..." />
        </Form.Item>
        <Form.Item name="requirements" label="任职要求">
          <TextArea rows={4} placeholder="输入任职要求..." />
        </Form.Item>
        <Space>
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={handleSave}>保存（创建新版本）</Button>
        </Space>
      </Form>

      {record?.versions?.length > 0 && (
        <Card title="版本历史" size="small" style={{ marginTop: 24 }}>
          <Table dataSource={record.versions} columns={verColumns} rowKey="id" size="small" pagination={false} />
        </Card>
      )}
    </Card>
  );
};

export default JDManagementEditor;
