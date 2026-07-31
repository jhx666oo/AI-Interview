import { useEffect, useMemo, useState } from 'react';
import { Alert, Card, Col, Row, Spin, Table, Tag, Typography } from 'antd';
import { useParams } from 'react-router-dom';
import request from '../../utils/request';

const { Title, Text } = Typography;

interface PublicPosition {
  position?: string;
  hrbp?: string;
  urgency?: string;
  headcount?: number;
  total_resumes?: number;
  first_interview?: number;
  first_interview_passed?: number;
  second_interview_passed?: number;
  third_interview_passed?: number;
  pass_rate?: number | null;
  offer_count?: number;
  onboarded_count?: number;
  remark?: string;
  status?: string;
}

interface PublicDivision extends Omit<PublicPosition, 'position'> {
  division?: string;
  positions: PublicPosition[];
}

interface PublicBoard {
  updated_at: string;
  kpis: Record<string, number>;
  rows: PublicDivision[];
}

const columns = [
  { title: '事业部 / 职位', dataIndex: 'position', width: 190, render: (value: string, row: PublicDivision | PublicPosition) => value || ('division' in row ? row.division : '-') },
  { title: 'HRBP', dataIndex: 'hrbp', width: 100, render: (value: string) => value || '-' },
  { title: '优先级', dataIndex: 'urgency', width: 78, align: 'center' as const, render: (value: string) => <Tag color={value === 'P0' ? 'red' : value === 'P1' ? 'orange' : 'blue'}>{value || 'P2'}</Tag> },
  { title: '需求人数', dataIndex: 'headcount', width: 85, align: 'center' as const },
  { title: '简历', dataIndex: 'total_resumes', width: 65, align: 'center' as const },
  { title: '1面', dataIndex: 'first_interview', width: 60, align: 'center' as const },
  { title: '1面通过', dataIndex: 'first_interview_passed', width: 76, align: 'center' as const },
  { title: '2面通过', dataIndex: 'second_interview_passed', width: 76, align: 'center' as const },
  { title: '3面通过', dataIndex: 'third_interview_passed', width: 76, align: 'center' as const },
  { title: '通过率', dataIndex: 'pass_rate', width: 74, align: 'center' as const, render: (value: number | null) => value == null ? '-' : `${value}%` },
  { title: 'Offer', dataIndex: 'offer_count', width: 64, align: 'center' as const },
  { title: '入职', dataIndex: 'onboarded_count', width: 60, align: 'center' as const },
  { title: '备注', dataIndex: 'remark', width: 130, render: (value: string) => value || '-' },
  { title: '状态', dataIndex: 'status', width: 82, align: 'center' as const, render: (value: string) => <Tag color={value === '已完成' ? 'success' : 'processing'}>{value || '招聘中'}</Tag> },
];

const SharedDashboard = () => {
  const { token } = useParams();
  const [board, setBoard] = useState<PublicBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    if (!token) return;
    request.get(`/shared/dashboard/${token}`)
      .then((data: PublicBoard) => setBoard(data))
      .catch(() => setInvalid(true))
      .finally(() => setLoading(false));
  }, [token]);

  const kpis = useMemo(() => [
    ['在招岗位', board?.kpis.active_positions, '#3B82F6'], ['需求人数', board?.kpis.total_headcount, '#6366F1'],
    ['简历', board?.kpis.total_resumes, '#8B5CF6'], ['面试中', board?.kpis.first_interview, '#EC4899'],
    ['Offer', board?.kpis.offers, '#F59E0B'], ['已入职', board?.kpis.hired, '#10B981'],
  ], [board]);

  if (loading) return <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Spin size="large" /></div>;
  if (invalid || !board) return <div style={{ maxWidth: 560, margin: '16vh auto', padding: 24 }}><Alert type="warning" showIcon message="分享链接不可用" description="该链接已过期、被撤销或不存在。" /></div>;

  return <main style={{ maxWidth: 1600, margin: '0 auto', padding: '32px 24px' }}>
    <div style={{ marginBottom: 24 }}>
      <Title level={3} style={{ marginBottom: 4 }}>招聘运营看板</Title>
      <Text type="secondary">数据更新时间：{new Date(board.updated_at).toLocaleString('zh-CN')} · 仅含聚合数据</Text>
    </div>
    <Card size="small" style={{ marginBottom: 20, borderRadius: 8 }}>
      <Row gutter={[16, 12]}>{kpis.map(([label, value, color]) => <Col key={String(label)} xs={12} sm={8} md={4}><div style={{ textAlign: 'center' }}><Text type="secondary">{label}</Text><div style={{ fontSize: 25, fontWeight: 700, color: String(color) }}>{value ?? 0}</div></div></Col>)}</Row>
    </Card>
    <Card title="事业部招聘漏斗" size="small" style={{ borderRadius: 8 }}>
      <Table<PublicDivision>
        rowKey={(row) => row.division || 'unassigned'} size="small" columns={columns} dataSource={board.rows} pagination={false} scroll={{ x: 1420 }}
        expandable={{ defaultExpandAllRows: true, rowExpandable: (row) => row.positions.length > 0, expandedRowRender: (row) => <Table<PublicPosition> rowKey={(position) => position.position || 'position'} size="small" showHeader={false} columns={columns} dataSource={row.positions} pagination={false} /> }}
      />
    </Card>
  </main>;
};

export default SharedDashboard;
