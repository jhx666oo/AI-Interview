import React, { useEffect, useState } from 'react';
import { Card, Table, Button, Space, Tag, message, Typography, Modal } from 'antd';
import SimplePagination from '../../components/SimplePagination';
import { EditOutlined, ThunderboltOutlined, ReloadOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import request from '../../utils/request';
import { PageHeader, ResponsiveToolbar, TableViewport } from '../../components/Responsive';

const { Text } = Typography;

const statusConfig: Record<string, { color: string; text: string }> = {
  open: { color: 'green', text: '开放' },
  closed: { color: 'default', text: '关闭' },
  draft: { color: 'default', text: '草稿' },
};

const JDManagementList: React.FC = () => {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [evaluating, setEvaluating] = useState<string | null>(null);
  const [tablePage, setTablePage] = useState(1);
  const pageSize = 10;
  const navigate = useNavigate();

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await request.get('/jd-management') as any;
      setData(Array.isArray(res) ? res : []);
    } catch (e: any) {
      message.error('加载失败: ' + (e.response?.data?.detail || e.message));
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const handleEvaluate = async (id: string) => {
    setEvaluating(id);
    try {
      const res = await request.post(`/jd-management/${id}/evaluate`) as any;
      if (res.detail) { message.error(res.detail); }
      else {
        Modal.info({
          title: 'AI 评估结果',
          content: (
            <div>
              <p>可读性: {res.readability}/10</p>
              <p>完整性: {res.completeness}/10</p>
              <p>吸引力: {res.attractiveness}/10</p>
              <p>岗位匹配度: {res.match}/10</p>
              <p style={{ marginTop: 8 }}><Text strong>改进建议：</Text>{res.suggestions}</p>
            </div>
          ),
        });
      }
    } catch (e: any) {
      message.error('AI 评估失败: ' + (e.response?.data?.detail || e.message));
    } finally { setEvaluating(null); }
  };

  const columns = [
    { title: '岗位名称', dataIndex: 'title', key: 'title', width: 200 },
    { title: '部门', dataIndex: 'department', key: 'department', width: 120 },
    {
      title: 'JD 预览', dataIndex: 'description', key: 'description', ellipsis: true,
      render: (v: string) => <Text ellipsis style={{ maxWidth: 300 }}>{v?.slice(0, 80) || '-'}</Text>,
    },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 80,
      render: (v: string) => { const c = statusConfig[v] || { color: 'default', text: v }; return <Tag color={c.color}>{c.text}</Tag>; },
    },
    {
      title: '最近修改', dataIndex: 'updated_at', key: 'updated_at', width: 160,
      render: (v: string) => v ? new Date(v).toLocaleString('zh-CN') : '-',
    },
    {
      title: '操作', key: 'action', width: 200,
      render: (_: any, record: any) => (
        <Space>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => navigate(`/jd-management/${record.id}`)}>编辑</Button>
          <Button type="link" size="small" icon={<ThunderboltOutlined />} loading={evaluating === record.id} onClick={() => handleEvaluate(record.id)}>AI 评估</Button>
        </Space>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="JD 管理" />
      <Card>
        <ResponsiveToolbar actions={<Button icon={<ReloadOutlined />} onClick={fetchData}>刷新</Button>}>
          <span />
        </ResponsiveToolbar>
        <TableViewport>
          <Table dataSource={data.slice((tablePage - 1) * pageSize, tablePage * pageSize)} columns={columns} rowKey="id" loading={loading} pagination={false} />
        </TableViewport>
        <SimplePagination current={tablePage} pageSize={pageSize} total={data.length} onChange={setTablePage} />
    </Card>
    </>
  );
};

export default JDManagementList;
