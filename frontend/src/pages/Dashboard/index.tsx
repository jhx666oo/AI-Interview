import { useEffect, useMemo, useState } from 'react';
import { Button, Card, Col, Input, Row, Select, Space, Spin, Table, Tag, Typography, message } from 'antd';
import { ClearOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import request from '../../utils/request';
import { useOwner } from '../../contexts/OwnerContext';

const { Title, Text } = Typography;

type Priority = 'P0' | 'P1' | 'P2';

interface PositionRow {
  position_id: string;
  division: string;
  hrbp: string;
  position: string;
  priority: Priority;
  headcount: number;
  total_resumes: number;
  first_interview: number;
  first_pass: number;
  second_pass: number;
  third_pass: number;
  offers: number;
  hired: number;
  notes: string;
  status: string;
  unmatched?: boolean;
}

interface DivisionRow extends Omit<PositionRow, 'position_id' | 'position' | 'notes' | 'unmatched'> {
  pass_rate: number | null;
  positions: PositionRow[];
}

interface BoardResponse {
  version: string;
  updated_at: string;
  kpis: {
    active_positions: number;
    total_headcount: number;
    total_resumes: number;
    first_interview: number;
    offers: number;
    hired: number;
  };
  rows: DivisionRow[];
}

const priorityColors: Record<Priority, string> = { P0: 'red', P1: 'orange', P2: 'blue' };

function groupFilteredPositions(positions: PositionRow[]): DivisionRow[] {
  const groups = new Map<string, DivisionRow>();
  for (const position of positions) {
    const division = position.division || '未分配事业部';
    let group = groups.get(division);
    if (!group) {
      group = {
        division,
        hrbp: position.hrbp,
        priority: position.priority,
        headcount: 0,
        total_resumes: 0,
        first_interview: 0,
        first_pass: 0,
        second_pass: 0,
        third_pass: 0,
        offers: 0,
        hired: 0,
        status: position.status,
        pass_rate: null,
        positions: [],
      };
      groups.set(division, group);
    }
    group.positions.push(position);
    group.headcount += position.headcount;
    group.total_resumes += position.total_resumes;
    group.first_interview += position.first_interview;
    group.first_pass += position.first_pass;
    group.second_pass += position.second_pass;
    group.third_pass += position.third_pass;
    group.offers += position.offers;
    group.hired += position.hired;
  }
  return [...groups.values()].map((group) => ({ ...group, pass_rate: group.first_interview ? Math.round(group.first_pass / group.first_interview * 100) : null }));
}

function PipelineTag({ status }: { status: string }) {
  const color = status === '已完成' ? 'success' : status === '暂停' ? 'warning' : status === '已终止' ? 'default' : 'processing';
  return <Tag color={color}>{status || '招聘中'}</Tag>;
}

const Dashboard: React.FC = () => {
  const [board, setBoard] = useState<BoardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [division, setDivision] = useState<string>();
  const [hrbp, setHrbp] = useState<string>();
  const [priority, setPriority] = useState<Priority>();
  const [status, setStatus] = useState<string>();
  const [keyword, setKeyword] = useState('');
  const { selectedOwner } = useOwner();

  const fetchBoard = async (showLoading = true) => {
    if (showLoading) setLoading(true); else setRefreshing(true);
    try {
      const params = selectedOwner ? { responsible_person: selectedOwner } : {};
      setBoard(await request.get('/dashboard/recruiting-board', { params }) as BoardResponse);
    } catch (error) {
      console.error('Recruiting board error:', error);
      message.error('看板数据加载失败，请稍后重试');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { fetchBoard(); }, [selectedOwner]);

  const positions = useMemo(() => board?.rows.flatMap((row) => row.positions) || [], [board]);
  const divisions = useMemo(() => [...new Set(positions.map((row) => row.division).filter(Boolean))].sort(), [positions]);
  const hrbps = useMemo(() => [...new Set(positions.map((row) => row.hrbp).filter(Boolean))].sort(), [positions]);
  const statuses = useMemo(() => [...new Set(positions.map((row) => row.status).filter(Boolean))].sort(), [positions]);

  const filteredRows = useMemo(() => groupFilteredPositions(positions.filter((position) => {
      if (division && position.division !== division) return false;
      if (hrbp && position.hrbp !== hrbp) return false;
      if (priority && position.priority !== priority) return false;
      if (status && position.status !== status) return false;
      const search = keyword.trim().toLowerCase();
      return !search || position.position.toLowerCase().includes(search) || position.division.toLowerCase().includes(search);
    })), [division, hrbp, keyword, positions, priority, status]);

  const columns = [
    { title: '事业部 / 职位', dataIndex: 'position', key: 'position', width: 190, render: (value: string, row: DivisionRow | PositionRow) => value || row.division },
    { title: 'HRBP', dataIndex: 'hrbp', key: 'hrbp', width: 100, render: (value: string) => value || '-' },
    { title: '优先级', dataIndex: 'priority', key: 'priority', width: 78, align: 'center' as const, render: (value: Priority) => <Tag color={priorityColors[value] || 'blue'}>{value || 'P2'}</Tag> },
    { title: '需求人数', dataIndex: 'headcount', key: 'headcount', width: 85, align: 'center' as const },
    { title: '简历', dataIndex: 'total_resumes', key: 'total_resumes', width: 65, align: 'center' as const },
    { title: '1面', dataIndex: 'first_interview', key: 'first_interview', width: 60, align: 'center' as const },
    { title: '1面通过', dataIndex: 'first_pass', key: 'first_pass', width: 76, align: 'center' as const },
    { title: '2面通过', dataIndex: 'second_pass', key: 'second_pass', width: 76, align: 'center' as const },
    { title: '3面通过', dataIndex: 'third_pass', key: 'third_pass', width: 76, align: 'center' as const },
    { title: '通过率', dataIndex: 'pass_rate', key: 'pass_rate', width: 74, align: 'center' as const, render: (value: number | null) => value == null ? '-' : `${value}%` },
    { title: 'Offer', dataIndex: 'offers', key: 'offers', width: 64, align: 'center' as const },
    { title: '入职', dataIndex: 'hired', key: 'hired', width: 60, align: 'center' as const },
    { title: '备注', dataIndex: 'notes', key: 'notes', width: 130, render: (value: string) => value || '-' },
    { title: '状态', dataIndex: 'status', key: 'status', width: 82, align: 'center' as const, render: (value: string) => <PipelineTag status={value} /> },
  ];

  if (loading) return <div style={{ height: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Spin size="large" description="加载招聘看板..." /></div>;

  const kpis = [
    ['在招岗位', board?.kpis.active_positions, '#3B82F6'], ['需求人数', board?.kpis.total_headcount, '#6366F1'],
    ['简历', board?.kpis.total_resumes, '#8B5CF6'], ['面试中', board?.kpis.first_interview, '#EC4899'],
    ['Offer', board?.kpis.offers, '#F59E0B'], ['已入职', board?.kpis.hired, '#10B981'],
  ];

  return <div>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
      <div><Title level={4} style={{ margin: 0, fontWeight: 700 }}>招聘运营看板</Title><Text type="secondary">数据更新时间：{board?.updated_at ? new Date(board.updated_at).toLocaleString('zh-CN') : '-'}</Text></div>
      <Button icon={<ReloadOutlined />} loading={refreshing} onClick={() => fetchBoard(false)}>刷新</Button>
    </div>
    <Card size="small" style={{ marginBottom: 20, borderRadius: 8 }}>
      <Row gutter={[16, 12]}>{kpis.map(([label, value, color]) => <Col key={String(label)} xs={12} sm={8} md={4}><div style={{ textAlign: 'center' }}><Text type="secondary">{label}</Text><div style={{ fontSize: 25, fontWeight: 700, color: String(color) }}>{value ?? 0}</div></div></Col>)}</Row>
    </Card>
    <Card size="small" title="事业部招聘漏斗" style={{ borderRadius: 8 }}>
      <Space wrap style={{ marginBottom: 14 }}>
        <Input value={keyword} onChange={(event) => setKeyword(event.target.value)} prefix={<SearchOutlined />} placeholder="搜索职位 / 事业部" style={{ width: 200 }} allowClear />
        <Select value={division} onChange={setDivision} placeholder="事业部" allowClear style={{ width: 130 }} options={divisions.map((value) => ({ value }))} />
        <Select value={hrbp} onChange={setHrbp} placeholder="HRBP" allowClear style={{ width: 130 }} options={hrbps.map((value) => ({ value }))} />
        <Select value={priority} onChange={setPriority} placeholder="优先级" allowClear style={{ width: 110 }} options={(['P0', 'P1', 'P2'] as Priority[]).map((value) => ({ value }))} />
        <Select value={status} onChange={setStatus} placeholder="岗位状态" allowClear style={{ width: 120 }} options={statuses.map((value) => ({ value }))} />
        {(division || hrbp || priority || status || keyword) && <Button size="small" icon={<ClearOutlined />} onClick={() => { setDivision(undefined); setHrbp(undefined); setPriority(undefined); setStatus(undefined); setKeyword(''); }}>清除筛选</Button>}
      </Space>
      <Table<DivisionRow>
        rowKey="division"
        size="small"
        columns={columns}
        dataSource={filteredRows}
        pagination={false}
        scroll={{ x: 1420 }}
        expandable={{
          defaultExpandAllRows: true,
          rowExpandable: (row) => row.positions.length > 0,
          expandedRowRender: (row) => <Table<PositionRow> rowKey="position_id" size="small" showHeader={false} columns={columns} dataSource={row.positions.map((position) => ({ ...position, pass_rate: position.first_interview ? Math.round(position.first_pass / position.first_interview * 100) : null }))} pagination={false} />,
        }}
        locale={{ emptyText: '暂无匹配岗位数据' }}
      />
    </Card>
  </div>;
};

export default Dashboard;
