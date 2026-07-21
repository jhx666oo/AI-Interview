import React, { useEffect, useState } from 'react';
import { Table, Button, Input, message, Popconfirm, Space, Card, Typography } from 'antd';
import { PlusOutlined, DeleteOutlined, SaveOutlined, BellOutlined } from '@ant-design/icons';
import request from '../../utils/request';

const { Title } = Typography;

interface InterviewerMapping {
  name: string;
  open_id: string;
}

const InterviewerMappings: React.FC = () => {
  const [data, setData] = useState<InterviewerMapping[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => { fetchMappings(); }, []);

  const fetchMappings = async () => {
    setLoading(true);
    try {
      const res = await request.get('/interviewer-mappings') as any[];
      setData(res || []);
    } catch { message.error('加载失败'); }
    finally { setLoading(false); }
  };

  const handleAdd = () => {
    setData([...data, { name: '', open_id: '' }]);
  };

  const handleDelete = (index: number) => {
    setData(data.filter((_, i) => i !== index));
  };

  const handleChange = (index: number, field: 'name' | 'open_id', value: string) => {
    const updated = [...data];
    updated[index][field] = value;
    setData(updated);
  };

  const handleSave = async () => {
    const valid = data.filter(d => d.name.trim());
    if (valid.length === 0) {
      message.warning('请至少填写一个面试官姓名');
      return;
    }
    try {
      await request.post('/interviewer-mappings', { mappings: valid });
      message.success('保存成功');
      fetchMappings();
    } catch { message.error('保存失败'); }
  };

  const handleNotifyAll = async () => {
    if (data.length === 0) { message.warning('没有配置面试官'); return; }
    try {
      await request.post('/settings/interviewers/notify-all', {
        title: '📢 系统通知',
        content: '请登录 AI 智能招聘系统查看最新消息。',
      });
      message.success('已发送通知');
    } catch { message.error('通知发送失败'); }
  };

  const columns = [
    {
      title: '姓名',
      dataIndex: 'name',
      render: (_: string, record: InterviewerMapping, index: number) => (
        <Input
          placeholder="面试官姓名"
          value={record.name}
          onChange={e => handleChange(index, 'name', e.target.value)}
          style={{ width: 160 }}
        />
      ),
    },
    {
      title: 'Open ID',
      dataIndex: 'open_id',
      render: (_: string, record: InterviewerMapping, index: number) => (
        <Input
          placeholder="ou_xxxxxxxx"
          value={record.open_id}
          onChange={e => handleChange(index, 'open_id', e.target.value)}
          style={{ width: 260 }}
        />
      ),
    },
    {
      title: '操作',
      width: 80,
      render: (_: any, __: InterviewerMapping, index: number) => (
        <Popconfirm title="确认删除？" onConfirm={() => handleDelete(index)}>
          <Button type="link" danger icon={<DeleteOutlined />} size="small">删除</Button>
        </Popconfirm>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <Title level={4} style={{ margin: 0 }}>面试官映射管理</Title>
          <Space>
            <Button icon={<BellOutlined />} onClick={handleNotifyAll}>通知全部面试官</Button>
            <Button icon={<PlusOutlined />} type="dashed" onClick={handleAdd}>添加</Button>
            <Button icon={<SaveOutlined />} type="primary" onClick={handleSave}>保存</Button>
          </Space>
        </div>
        <Table
          dataSource={data}
          columns={columns}
          rowKey={(_, idx) => `${idx}`}
          loading={loading}
          pagination={false}
          locale={{ emptyText: '暂无映射，请点击「添加」配置面试官姓名与飞书 Open ID' }}
        />
      </Card>
    </div>
  );
};

export default InterviewerMappings;
