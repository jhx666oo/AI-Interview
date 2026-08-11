import React, { useEffect, useState } from 'react';
import { Card, Table, Button, Tag, Space, message, Empty, Spin } from 'antd';
import SimplePagination from '../../components/SimplePagination';
import { EyeOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import request from '../../utils/request';
import { PageHeader, ResponsiveDataView } from '../../components/Responsive';

interface PendingReview {
  review_id: string;
  resume_id: string;
  candidate_name: string;
  position_title: string;
  match_score: number;
  status: string;
  created_at: string;
}

const MyReviews: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [pendingReviews, setPendingReviews] = useState<PendingReview[]>([]);
  const [tablePage, setTablePage] = useState(1);
  const pageSize = 10;

  useEffect(() => {
    fetchPendingReviews();
  }, [user?.id]);

  const fetchPendingReviews = async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const res = await request.get('/resumes/my-reviews', {
        params: { reviewer_id: user.id }
      });
      setPendingReviews(res);
    } catch (error) {
      message.error('获取待评审列表失败');
    } finally {
      setLoading(false);
    }
  };

  const columns = [
    {
      title: '候选人',
      dataIndex: 'candidate_name',
      key: 'candidate_name',
      render: (text: string) => <span style={{ fontWeight: 500 }}>{text || '未知'}</span>,
    },
    {
      title: '应聘岗位',
      dataIndex: 'position_title',
      key: 'position_title',
    },
    {
      title: 'AI匹配度',
      dataIndex: 'match_score',
      key: 'match_score',
      render: (score: number) => (
        <Tag color={score >= 80 ? 'green' : score >= 60 ? 'orange' : 'red'}>
          {score}%
        </Tag>
      ),
    },
    {
      title: '指派时间',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (date: string) => new Date(date).toLocaleString('zh-CN'),
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: PendingReview) => (
        <Space>
          <Button
            type="primary"
            icon={<EyeOutlined />}
            onClick={() => navigate(`/resumes/${record.resume_id}`)}
          >
            查看并评审
          </Button>
        </Space>
      ),
    },
  ];

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 400 }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="我的待评审" description="您被指派的待评审简历列表" />

      <Card>
        {pendingReviews.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="暂无待评审的简历"
          />
        ) : (
          <>
          <ResponsiveDataView
              columns={columns}
              dataSource={pendingReviews.slice((tablePage - 1) * pageSize, tablePage * pageSize)}
              rowKey="review_id"
              pagination={false}
              card={{
                title: record => record.candidate_name || '未知',
                subtitle: record => record.position_title || '-',
                status: record => (columns[2] as any).render(record.match_score),
                fields: [
                  { key: 'created_at', label: '指派时间', level: 'detail', render: record => (columns[3] as any).render(record.created_at) },
                ],
                actions: record => (columns[4] as any).render(null, record),
              }}
            />
        <SimplePagination current={tablePage} pageSize={pageSize} total={pendingReviews.length} onChange={setTablePage} />
          </>
        )}
      </Card>
    </div>
  );
};

export default MyReviews;
