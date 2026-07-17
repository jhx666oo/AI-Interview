import { useEffect, useState, useMemo } from 'react';
import { Card, Row, Col, Typography, Spin, message, Table, Tag, Space, Button, Input, Select } from 'antd';
import { SyncOutlined, ReloadOutlined, SearchOutlined, ClearOutlined } from '@ant-design/icons';
import request from '../../utils/request';

const { Title, Text } = Typography;

interface FunnelStage {
  name: string;
  count: number;
}

interface DivisionData {
  name: string;
  hrbp: string;
  active_positions: number;
  total_headcount: number;
  total_resumes: number;
  scheduled_interviews: number;
  interview_pass_rate: number;
  hired: number;
  funnel: { stages: FunnelStage[] };
}

interface OverviewData {
  active_positions: number;
  total_headcount: number;
  total_resumes: number;
  scheduled_interviews: number;
  push_conversion_rate: number;
  interview_pass_rate: number;
  offers: number;
  offer_conversion_rate: number;
  hired: number;
  hire_conversion_rate: number;
  pending_onboarding: number;
  last_updated: string;
}

interface DashboardOverview {
  overview: OverviewData;
  funnel: { stages: FunnelStage[] };
  divisions: DivisionData[];
}

interface PositionDetail {
  division: string;
  hrbp: string;
  position: string;
  headcount: number;
  total_resumes: number;
  first_interview: number;
  first_pass: number;
  second_pass: number;
  third_pass: number;
  pass_rate: string;
  offers: number;
  hired: number;
  notes: string;
  status: string;
}

const Dashboard: React.FC = () => {
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [positions, setPositions] = useState<PositionDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // 筛选状态
  const [filterDivision, setFilterDivision] = useState<string | undefined>(undefined);
  const [filterStatus, setFilterStatus] = useState<string | undefined>(undefined);
  const [searchPosition, setSearchPosition] = useState('');

  const fetchData = async (showLoading = true) => {
    if (showLoading) setLoading(true);
    else setRefreshing(true);
    try {
      const res = await request.get('/dashboard/overview') as any;
      // 后端返回 {overview, funnel, divisions}，直接使用
      setOverview({
        overview: res.overview || {},
        funnel: res.funnel || { stages: [] },
        divisions: res.divisions || [],
      });

      // 加载岗位明细
      const positionsRes = await request.get('/dashboard/positions');
      setPositions((positionsRes as any).positions || (positionsRes as any).position_details || positionsRes);
    } catch (e: any) {
      console.error('Dashboard error:', e);
      message.error('获取看板数据失败: ' + (e.response?.data?.detail || e.message));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const overviewData = overview?.overview;

  // KPI 卡片配置
  const kpiCards = [
    { label: '在招岗位', value: overviewData?.active_positions ?? '-', unit: '个', color: '#3B82F6' },
    { label: '在招人数', value: overviewData?.total_headcount ?? '-', unit: '人', color: '#10B981' },
    { label: '简历推送', value: overviewData?.total_resumes ?? '-', unit: '份', color: '#6366F1' },
    { label: '安排面试', value: overviewData?.scheduled_interviews ?? '-', unit: '场', color: '#F59E0B' },
    { label: '推送转化率', value: overviewData?.push_conversion_rate ?? '-', unit: '%', color: '#EF4444' },
    { label: '面试通过率', value: overviewData?.interview_pass_rate ?? '-', unit: '%', color: '#8B5CF6' },
    { label: '发放Offer', value: overviewData?.offers ?? '-', unit: '个', color: '#EC4899' },
    { label: 'Offer转化率', value: overviewData?.offer_conversion_rate ?? '-', unit: '%', color: '#14B8A6' },
    { label: '已入职', value: overviewData?.hired ?? '-', unit: '人', color: '#F97316' },
    { label: '入职转化率', value: overviewData?.hire_conversion_rate ?? '-', unit: '%', color: '#06B6D4' },
    { label: '待入职', value: overviewData?.pending_onboarding ?? '-', unit: '人', color: '#A855F7' },
  ];

  // 漏斗阶段
  const funnelColors = ['#3B82F6', '#6366F1', '#8B5CF6', '#EC4899', '#EF4444', '#F59E0B'];
  const maxFunnelCount = Math.max(...((overview?.funnel?.stages || []).map(s => s.count || 0) || [1]), 1);

  // 岗位明细列
  // 筛选选项（动态从数据中提取）
  const divisionOptions = useMemo(() => {
    if (!Array.isArray(positions)) return [];
    const set = new Set(positions.map(p => p.division).filter(Boolean));
    return Array.from(set).sort();
  }, [positions]);
  const statusOptions = useMemo(() => {
    if (!Array.isArray(positions)) return [];
    const set = new Set(positions.map(p => p.status).filter(Boolean));
    return Array.from(set).sort();
  }, [positions]);

  // 筛选后的数据
  const filteredPositions = useMemo(() => {
    if (!Array.isArray(positions)) return [];
    return positions.filter(p => {
      if (filterDivision && p.division !== filterDivision) return false;
      if (filterStatus && p.status !== filterStatus) return false;
      if (searchPosition) {
        const kw = searchPosition.toLowerCase();
        if (!p.position.toLowerCase().includes(kw) && !p.division.toLowerCase().includes(kw)) return false;
      }
      return true;
    });
  }, [positions, filterDivision, filterStatus, searchPosition]);

  const positionColumns = [
    { title: '所属事业部', dataIndex: 'division', key: 'division', width: 140 },
    { title: 'HRBP', dataIndex: 'hrbp', key: 'hrbp', width: 100 },
    { title: '在招职位', dataIndex: 'position', key: 'position', width: 160 },
    { title: '在招人数', dataIndex: 'headcount', key: 'headcount', width: 80, align: 'center' as const },
    { title: '简历推送', dataIndex: 'total_resumes', key: 'total_resumes', width: 80, align: 'center' as const },
    { title: '1面', dataIndex: 'first_interview', key: 'first_interview', width: 60, align: 'center' as const },
    { title: '1面通过', dataIndex: 'first_pass', key: 'first_pass', width: 70, align: 'center' as const },
    { title: '2面通过', dataIndex: 'second_pass', key: 'second_pass', width: 70, align: 'center' as const },
    { title: '3面通过', dataIndex: 'third_pass', key: 'third_pass', width: 70, align: 'center' as const },
    { title: '通过率', dataIndex: 'pass_rate', key: 'pass_rate', width: 70, align: 'center' as const },
    { title: 'Offer', dataIndex: 'offers', key: 'offers', width: 60, align: 'center' as const },
    { title: '入职', dataIndex: 'hired', key: 'hired', width: 60, align: 'center' as const },
    {
      title: '备注', dataIndex: 'notes', key: 'notes', width: 180,
      render: (v: string) => v ? <Text type="secondary" style={{ fontSize: 12 }}>{v}</Text> : '-',
    },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 80, align: 'center' as const,
      render: (s: string) => {
        const color = s === '推进中' ? 'processing' : s === '招聘中' ? 'success' : 'default';
        return <Tag color={color}>{s}</Tag>;
      },
    },
  ];

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
        <Spin size="large" description="加载看板数据..." />
      </div>
    );
  }

  return (
    <div>
      {/* 头部 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <Title level={4} style={{ margin: 0, fontWeight: 700 }}>
            三大事业部招聘看板
          </Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            数据截止：{overviewData?.last_updated ? new Date(overviewData.last_updated).toLocaleString('zh-CN') : '加载中'}
          </Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} loading={refreshing} onClick={() => fetchData(false)}>
            刷新
          </Button>
        </Space>
      </div>

      {/* 总体概览 KPI */}
      <Card
        size="small"
        style={{ marginBottom: 20, borderRadius: 8 }}
        styles={{ body: { padding: '16px 20px' } }}
      >
        <Text strong style={{ fontSize: 14, marginBottom: 12, display: 'block' }}>
          总体概览
        </Text>
        <Row gutter={[16, 12]}>
          {kpiCards.map((kpi, idx) => (
            <Col key={idx} xs={12} sm={6} md={4} lg={2}>
              <div style={{ textAlign: 'center' }}>
                <Text type="secondary" style={{ fontSize: 12 }}>{kpi.label}</Text>
                <div style={{
                  fontSize: 24,
                  fontWeight: 700,
                  color: kpi.color,
                  lineHeight: 1.4,
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {kpi.value}
                  <span style={{ fontSize: 13, color: '#94A3B8', fontWeight: 400, marginLeft: 2 }}>{kpi.unit}</span>
                </div>
              </div>
            </Col>
          ))}
        </Row>
      </Card>

      {/* 招聘漏斗 + 事业部看板 */}
      <Row gutter={[20, 20]} style={{ marginBottom: 20 }}>
        {/* 漏斗 */}
        <Col xs={24} lg={8}>
          <Card
            size="small"
            title={<Text strong style={{ fontSize: 14 }}>招聘漏斗（全事业部汇总）</Text>}
            style={{ borderRadius: 8, height: '100%' }}
          >
            {overview?.funnel?.stages?.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {overview.funnel.stages.map((stage, idx) => {
                  const pct = maxFunnelCount > 0 ? Math.round((stage.count / maxFunnelCount) * 100) : 0;
                  return (
                    <div key={stage.name}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                        <span>{stage.name}</span>
                        <Text strong>{stage.count}</Text>
                      </div>
                      <div style={{
                        height: 8,
                        background: '#F1F5F9',
                        borderRadius: 4,
                        overflow: 'hidden',
                      }}>
                        <div style={{
                          width: `${pct}%`,
                          height: '100%',
                          background: funnelColors[idx % funnelColors.length],
                          borderRadius: 4,
                          transition: 'width 0.6s ease',
                        }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <Text type="secondary">暂无数据</Text>
            )}
          </Card>
        </Col>

        {/* 事业部分部 */}
        <Col xs={24} lg={16}>
          <Card
            size="small"
            title={<Text strong style={{ fontSize: 14 }}>事业部分部看板</Text>}
            style={{ borderRadius: 8, height: '100%' }}
          >
            <Row gutter={[16, 16]}>
              {overview?.divisions?.length ? overview.divisions.map((div, idx) => (
                <Col xs={24} sm={12} key={idx}>
                  <div style={{
                    padding: 16,
                    background: idx % 2 === 0 ? '#F8FAFC' : '#FFFBEB',
                    borderRadius: 8,
                    border: '1px solid #F1F5F9',
                    height: '100%',
                  }}>
                    <div style={{ marginBottom: 8 }}>
                      <Text strong style={{ fontSize: 15 }}>{div.name}</Text>
                      <br />
                      <Text type="secondary" style={{ fontSize: 12 }}>HRBP：{div.hrbp}</Text>
                    </div>
                    <Row gutter={[8, 8]}>
                      <Col span={8} style={{ textAlign: 'center' }}>
                        <Text type="secondary" style={{ fontSize: 11 }}>在招岗位</Text>
                        <div style={{ fontSize: 20, fontWeight: 700, color: '#3B82F6' }}>{div.active_positions}</div>
                      </Col>
                      <Col span={8} style={{ textAlign: 'center' }}>
                        <Text type="secondary" style={{ fontSize: 11 }}>在招人数</Text>
                        <div style={{ fontSize: 20, fontWeight: 700, color: '#10B981' }}>{div.total_headcount}</div>
                      </Col>
                      <Col span={8} style={{ textAlign: 'center' }}>
                        <Text type="secondary" style={{ fontSize: 11 }}>简历推送</Text>
                        <div style={{ fontSize: 20, fontWeight: 700, color: '#6366F1' }}>{div.total_resumes}</div>
                      </Col>
                    </Row>
                    {div.funnel?.stages?.length && (
                      <div style={{ marginTop: 12 }}>
                        <Text type="secondary" style={{ fontSize: 11 }}>招聘漏斗</Text>
                        {div.funnel.stages.filter(s => s.count > 0).map((s, si) => {
                          const max = Math.max(...div.funnel.stages.map(x => x.count), 1);
                          return (
                            <div key={si} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                              <Text style={{ fontSize: 11, width: 60, flexShrink: 0 }}>{s.name}</Text>
                              <div style={{
                                flex: 1,
                                height: 6,
                                background: '#F1F5F9',
                                borderRadius: 3,
                                overflow: 'hidden',
                              }}>
                                <div style={{
                                  width: `${(s.count / max) * 100}%`,
                                  height: '100%',
                                  background: funnelColors[si % funnelColors.length],
                                  borderRadius: 3,
                                }} />
                              </div>
                              <Text style={{ fontSize: 11, width: 40, textAlign: 'right' }}>{s.count}</Text>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </Col>
              )) : (
                <Col span={24}><Text type="secondary">暂无事业部数据</Text></Col>
              )}
            </Row>
          </Card>
        </Col>
      </Row>

      {/* 全量岗位明细汇总 */}
      <Card
        size="small"
        title={<Text strong style={{ fontSize: 14 }}>全量岗位明细汇总</Text>}
        style={{ borderRadius: 8 }}
        extra={
          <Button size="small" icon={<SyncOutlined />} loading={refreshing} onClick={() => fetchData(false)}>
            刷新
          </Button>
        }
      >
        <div style={{ marginBottom: 12 }}>
          <Space wrap>
            <Input
              placeholder="搜索职位/事业部..."
              prefix={<SearchOutlined />}
              value={searchPosition}
              onChange={e => setSearchPosition(e.target.value)}
              style={{ width: 200 }}
              allowClear
            />
            <Select
              placeholder="筛选事业部"
              value={filterDivision}
              onChange={v => setFilterDivision(v)}
              allowClear
              style={{ width: 160 }}
              options={divisionOptions.map(d => ({ label: d, value: d }))}
            />
            <Select
              placeholder="筛选状态"
              value={filterStatus}
              onChange={v => setFilterStatus(v)}
              allowClear
              style={{ width: 140 }}
              options={statusOptions.map(s => ({ label: s, value: s }))}
            />
            {(filterDivision || filterStatus || searchPosition) && (
              <Button
                size="small"
                icon={<ClearOutlined />}
                onClick={() => { setFilterDivision(undefined); setFilterStatus(undefined); setSearchPosition(''); }}
              >
                清除筛选
              </Button>
            )}
            <Text type="secondary" style={{ fontSize: 12 }}>
              {filteredPositions.length !== positions.length
                ? `筛选出 ${filteredPositions.length} / 共 ${positions.length} 条`
                : `共 ${positions.length} 条`}
            </Text>
          </Space>
        </div>
        <Table
          dataSource={filteredPositions}
          columns={positionColumns}
          rowKey="position"
          size="small"
          pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }}
          scroll={{ x: 1400 }}
          locale={{ emptyText: '暂无岗位数据' }}
        />
      </Card>
    </div>
  );
};

export default Dashboard;
