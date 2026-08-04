import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  Input,
  List,
  Modal,
  Radio,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  AppstoreOutlined,
  DownloadOutlined,
  ClearOutlined,
  LinkOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import request from '../../utils/request';
import { downloadExcel } from '../../utils/exportExcel';
import { useAuth } from '../../contexts/AuthContext';
import { useOwner } from '../../contexts/OwnerContext';
import { RecruitingBoardView } from './components/RecruitingBoardView';
import type {
  BoardPosition,
  BoardTotals,
  DashboardDataMode,
  DashboardShareLink,
  DashboardSnapshotMeta,
  DivisionBoard,
  FunnelStage,
  HrbpBoard,
  RecruitingBoard,
} from './types';
import styles from './dashboard.module.css';

type Priority = BoardPosition['priority'];
type ShareExpiry = '1d' | '7d' | '30d' | 'permanent';

const funnelDefinitions: Array<Pick<FunnelStage, 'key' | 'label'>> = [
  { key: 'resumes', label: '已入库简历' },
  { key: 'ai_screened', label: 'AI 初筛完成' },
  { key: 'first_interview', label: '安排面试' },
  { key: 'first_pass', label: '一面通过' },
  { key: 'second_pass', label: '二面通过' },
  { key: 'third_pass', label: '三面通过' },
  { key: 'offers', label: 'Offer' },
  { key: 'hired', label: '入职' },
];

function calculateTotals(positions: BoardPosition[]): BoardTotals {
  const totals = positions.reduce<Omit<BoardTotals, 'interview_pass_rate'>>((result, position) => {
    const active = position.status === '招聘中';
    result.active_positions += active ? 1 : 0;
    result.total_headcount += active ? position.headcount : 0;
    result.total_resumes += position.total_resumes;
    result.ai_screened += position.ai_screened;
    result.first_interview += position.first_interview;
    result.first_pass += position.first_pass;
    result.second_pass += position.second_pass;
    result.third_pass += position.third_pass;
    result.offers += position.offers;
    result.hired += position.hired;
    return result;
  }, {
    active_positions: 0,
    total_headcount: 0,
    total_resumes: 0,
    ai_screened: 0,
    first_interview: 0,
    first_pass: 0,
    second_pass: 0,
    third_pass: 0,
    offers: 0,
    hired: 0,
  });
  const passRate = totals.first_interview > 0
    ? Math.round(totals.third_pass / totals.first_interview * 1000) / 10
    : null;
  return { ...totals, interview_pass_rate: passRate };
}

function groupDivisions(positions: BoardPosition[]): DivisionBoard[] {
  const grouped = new Map<string, BoardPosition[]>();
  positions.forEach((position) => {
    const division = position.division || '未分配事业部';
    grouped.set(division, [...(grouped.get(division) || []), { ...position, division }]);
  });
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right, 'zh-Hans-CN'))
    .map(([division, rows]) => ({
      division,
      hrbps: [...new Set(rows.map((row) => row.hrbp).filter(Boolean))].sort((left, right) => left.localeCompare(right, 'zh-Hans-CN')),
      positions: [...rows].sort((left, right) => left.position.localeCompare(right.position, 'zh-Hans-CN')),
      ...calculateTotals(rows),
    }));
}

function groupHrbps(positions: BoardPosition[]): HrbpBoard[] {
  const grouped = new Map<string, BoardPosition[]>();
  positions.forEach((position) => {
    const hrbp = position.hrbp || '未分配HRBP';
    grouped.set(hrbp, [...(grouped.get(hrbp) || []), { ...position, hrbp }]);
  });
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right, 'zh-Hans-CN'))
    .map(([hrbp, rows]) => ({
      hrbp,
      divisions: [...new Set(rows.map((row) => row.division || '未分配事业部'))].sort((left, right) => left.localeCompare(right, 'zh-Hans-CN')),
      positions: [...rows].sort((left, right) => left.position.localeCompare(right.position, 'zh-Hans-CN')),
      p0_positions: rows.filter((row) => row.priority === 'P0').length,
      average_hiring_days: null,
      ...calculateTotals(rows),
    }));
}

function makeFunnel(totals: BoardTotals): FunnelStage[] {
  const values: Record<string, number> = {
    resumes: totals.total_resumes,
    ai_screened: totals.ai_screened,
    first_interview: totals.first_interview,
    first_pass: totals.first_pass,
    second_pass: totals.second_pass,
    third_pass: totals.third_pass,
    offers: totals.offers,
    hired: totals.hired,
  };
  return funnelDefinitions.map((stage) => ({ ...stage, count: values[stage.key] || 0 }));
}

function makeInsights(totals: BoardTotals, stages: FunnelStage[]): RecruitingBoard['insights'] {
  const conversions = stages.slice(0, -1).flatMap((stage, index) => stage.count > 0 ? [{
    from: stage,
    to: stages[index + 1],
    rate: Math.round(stages[index + 1].count / stage.count * 1000) / 10,
  }] : []);
  if (conversions.length === 0) {
    return {
      summary: '暂无足够漏斗数据，暂不生成招聘诊断。',
      bottlenecks: ['暂无足够漏斗数据'],
      recommendations: ['暂无足够漏斗数据'],
    };
  }
  const bottleneck = conversions.reduce((lowest, current) => current.rate < lowest.rate ? current : lowest);
  const transition = `${bottleneck.from.label}至${bottleneck.to.label}`;
  return {
    summary: `当前筛选范围有 ${totals.active_positions} 个在招岗位，累计 ${totals.total_resumes} 份简历。`,
    bottlenecks: [`${transition}转化率最低，为 ${bottleneck.rate}%。`],
    recommendations: [`建议优先复盘${transition}环节并补充有效候选人来源。`],
  };
}

function rebuildBoard(board: RecruitingBoard, positions: BoardPosition[]): RecruitingBoard {
  const totals = calculateTotals(positions);
  const funnel = makeFunnel(totals);
  return {
    ...board,
    kpis: {
      active_positions: { value: totals.active_positions, available: true },
      total_headcount: { value: totals.total_headcount, available: true },
      total_resumes: { value: totals.total_resumes, available: true },
      first_interview: { value: totals.first_interview, available: true },
      interview_pass_rate: { value: totals.interview_pass_rate, available: totals.interview_pass_rate !== null },
      offers: { value: totals.offers, available: true },
      hired: { value: totals.hired, available: true },
      weekly_requirement_completion: { value: null, available: false },
    },
    funnel: { stages: funnel },
    insights: makeInsights(totals, funnel),
    divisions: groupDivisions(positions),
    hrbps: groupHrbps(positions),
    totals,
  };
}

const Dashboard: React.FC = () => {
  const [board, setBoard] = useState<RecruitingBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [dataMode, setDataMode] = useState<DashboardDataMode>('live');
  const [snapshotDate, setSnapshotDate] = useState<string>();
  const [snapshots, setSnapshots] = useState<DashboardSnapshotMeta[]>([]);
  const [creatingSnapshot, setCreatingSnapshot] = useState(false);
  const [division, setDivision] = useState<string>();
  const [hrbp, setHrbp] = useState<string>();
  const [priority, setPriority] = useState<Priority>();
  const [status, setStatus] = useState<string>();
  const [keyword, setKeyword] = useState('');
  const [shareOpen, setShareOpen] = useState(false);
  const [shareExpiry, setShareExpiry] = useState<ShareExpiry>('7d');
  const [shareMode, setShareMode] = useState<DashboardDataMode>('live');
  const [shareSnapshotId, setShareSnapshotId] = useState<string>();
  const [shareLinks, setShareLinks] = useState<DashboardShareLink[]>([]);
  const [creatingShare, setCreatingShare] = useState(false);
  const [newShareUrl, setNewShareUrl] = useState('');
  const { user } = useAuth();
  const { selectedOwner } = useOwner();

  const fetchBoard = useCallback(async (showLoading = true) => {
    if (dataMode === 'snapshot' && !snapshotDate) return;
    if (showLoading) setLoading(true);
    else setRefreshing(true);
    try {
      const params = dataMode === 'snapshot'
        ? { mode: 'snapshot', snapshot_date: snapshotDate, ...(selectedOwner ? { responsible_person: selectedOwner } : {}) }
        : { mode: 'live', ...(selectedOwner ? { responsible_person: selectedOwner } : {}) };
      setBoard(await request.get('/dashboard/recruiting-board', { params }) as RecruitingBoard);
    } catch (error) {
      console.error('Recruiting board error:', error);
      message.error('看板数据加载失败，请稍后重试');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [dataMode, selectedOwner, snapshotDate]);

  useEffect(() => {
    void fetchBoard();
  }, [fetchBoard]);

  const loadSnapshots = async () => {
    try {
      const data = await request.get('/dashboard/snapshots') as { snapshots: DashboardSnapshotMeta[] };
      setSnapshots(data.snapshots || []);
    } catch {
      message.error('快照列表加载失败');
    }
  };

  useEffect(() => {
    void loadSnapshots();
  }, []);

  const createMissingSnapshot = async () => {
    setCreatingSnapshot(true);
    try {
      const snapshot = await request.post('/dashboard/snapshots', {}) as DashboardSnapshotMeta;
      await loadSnapshots();
      setSnapshotDate(snapshot.snapshot_date);
      setDataMode('snapshot');
      message.success('今日快照已保存');
    } catch (error) {
      const status = (error as { response?: { status?: number } })?.response?.status;
      if (status === 409) message.warning('今日快照已存在');
      else message.error('今日快照保存失败');
    } finally {
      setCreatingSnapshot(false);
    }
  };

  const loadShareLinks = async () => {
    try {
      const data = await request.get('/dashboard/share-links') as { links: DashboardShareLink[] };
      setShareLinks(data.links || []);
    } catch {
      message.error('分享链接加载失败');
    }
  };

  const openShareModal = async () => {
    setShareOpen(true);
    setNewShareUrl('');
    await Promise.all([loadSnapshots(), loadShareLinks()]);
  };

  const createShareLink = async () => {
    setCreatingShare(true);
    try {
      const data = await request.post('/dashboard/share-links', {
        expiry: shareExpiry,
        data_mode: shareMode,
        snapshot_id: shareMode === 'snapshot' ? shareSnapshotId : null,
      }) as { token: string };
      const url = `${window.location.origin}/shared/dashboard/${data.token}`;
      setNewShareUrl(url);
      await navigator.clipboard?.writeText(url);
      message.success('分享链接已生成并复制');
      await loadShareLinks();
    } catch {
      message.error('分享链接创建失败');
    } finally {
      setCreatingShare(false);
    }
  };

  const copyShareLink = async (url: string) => {
    try {
      await navigator.clipboard?.writeText(url);
      message.success('已复制链接');
    } catch {
      message.error('复制失败，请手动复制');
    }
  };

  const revokeShareLink = async (id: string) => {
    try {
      await request.delete(`/dashboard/share-links/${id}`);
      message.success('链接已撤销');
      await loadShareLinks();
    } catch {
      message.error('撤销失败');
    }
  };

  const positions = useMemo(() => board?.divisions.flatMap((row) => row.positions) || [], [board]);
  const divisionOptions = useMemo(() => [...new Set(positions.map((row) => row.division).filter(Boolean))].sort(), [positions]);
  const hrbpOptions = useMemo(() => [...new Set(positions.map((row) => row.hrbp).filter(Boolean))].sort(), [positions]);
  const statusOptions = useMemo(() => [...new Set(positions.map((row) => row.status).filter(Boolean))].sort(), [positions]);
  const hasFilters = Boolean(division || hrbp || priority || status || keyword.trim());

  const filteredBoard = useMemo(() => {
    if (!board || !hasFilters) return board;
    const search = keyword.trim().toLocaleLowerCase('zh-CN');
    const filteredPositions = positions.filter((position) => {
      if (division && position.division !== division) return false;
      if (hrbp && position.hrbp !== hrbp) return false;
      if (priority && position.priority !== priority) return false;
      if (status && position.status !== status) return false;
      if (!search) return true;
      return [position.position, position.division, position.hrbp]
        .some((value) => value.toLocaleLowerCase('zh-CN').includes(search));
    });
    return rebuildBoard(board, filteredPositions);
  }, [board, division, hasFilters, hrbp, keyword, positions, priority, status]);

  const clearFilters = () => {
    setDivision(undefined);
    setHrbp(undefined);
    setPriority(undefined);
    setStatus(undefined);
    setKeyword('');
  };


  const handleExportExcel = () => {
    if (!board) return;
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const periodEnd = now.toISOString().slice(0, 10);
    const rows = board.divisions.flatMap((div) => {
      return div.positions.map((pos) => {
        const passRate = pos.first_interview > 0
          ? Math.round(pos.third_pass / pos.first_interview * 1000) / 10
          : 0;
        const startDate = (pos as any).created_at ? (pos as any).created_at.slice(0, 10) : "";
        const endDate = pos.status === "已完成" || pos.status === "已终止" ? periodEnd : "";
        const daysElapsed = startDate
          ? Math.floor((now.getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24))
          : 0;
        return {
          "所属事业部": div.division || "",
          "负责HRBP": pos.hrbp || "",
          "岗位名称": pos.position || "",
          "城市": (pos as any).location || "",
          "优先级": pos.priority || "",
          "在招人数": pos.headcount || 0,
          "简历推送": pos.total_resumes || 0,
          "安排 1 面": pos.first_interview || 0,
          "1 面通过": pos.first_pass || 0,
          "2 面通过": pos.second_pass || 0,
          "3 面通过": pos.third_pass || 0,
          "面试通过率": passRate ? `${passRate}%` : "0%",
          "发放 Offer数": pos.offers || 0,
          "入职数": pos.hired || 0,
          "开始周期": startDate,
          "结束周期": endDate,
          "已耗时天数": daysElapsed,
          "备注": pos.notes || "",
          "招聘状态": pos.status || "",
          "统计周期-开始": periodStart,
          "统计周期-截止": periodEnd,
        };
      });
    });
    if (rows.length === 0) { message.warning("暂无数据可导出"); return; }
    downloadExcel(rows, `招聘看板_${periodEnd}`);
    message.success("导出成功");
  };

  if (loading) {
    return <div style={{ height: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Spin size="large" description="加载招聘看板..." /></div>;
  }

  if (!filteredBoard) {
    return <Card><div style={{ padding: 32, textAlign: 'center', color: 'var(--text-secondary)' }}>看板暂时无法加载，请稍后刷新重试。</div></Card>;
  }

  return (
    <div className={styles.dashboardPage}>
      <section className={styles.pageHeader} aria-labelledby="recruiting-dashboard-title">
        <div>
          <div className={styles.pageTitleRow}>
            <span className={styles.pageTitleIcon}><AppstoreOutlined /></span>
            <h1 id="recruiting-dashboard-title">招聘运营看板</h1>
          </div>
          <p>数据更新时间：{board?.updated_at ? new Date(board.updated_at).toLocaleString('zh-CN') : '—'}</p>
        </div>
        <div className={styles.pageActions}>
          <Select
            aria-label="看板数据版本"
            value={dataMode === 'live' ? 'live' : snapshotDate}
            onChange={(value) => {
              if (value === 'live') {
                setDataMode('live');
                setSnapshotDate(undefined);
              } else {
                setSnapshotDate(value);
                setDataMode('snapshot');
              }
            }}
            style={{ width: 180 }}
            options={[
              { value: 'live', label: '最新实时数据' },
              ...snapshots.map((item) => ({ value: item.snapshot_date, label: item.snapshot_date })),
            ]}
          />
          {user?.role === 'admin' && (
            <Button disabled={dataMode !== 'live'} loading={creatingSnapshot} onClick={createMissingSnapshot}>保存今日快照</Button>
          )}
          <Button icon={<LinkOutlined />} onClick={openShareModal}>分享看板</Button>
          <Button icon={<DownloadOutlined />} onClick={handleExportExcel}>导出 Excel</Button>
          <Button icon={<ReloadOutlined />} loading={refreshing} onClick={() => fetchBoard(false)}>刷新当前数据</Button>
        </div>
      </section>

      <Card className={styles.filterCard} size="small">
        <div className={styles.filterBar}>
          <Input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            prefix={<SearchOutlined />}
            placeholder="搜索职位 / 事业部 / HRBP"
            style={{ width: 230 }}
            allowClear
          />
          <Select value={division} onChange={setDivision} placeholder="事业部" allowClear style={{ width: 150 }} options={divisionOptions.map((value) => ({ value }))} />
          <Select value={hrbp} onChange={setHrbp} placeholder="HRBP" allowClear style={{ width: 140 }} options={hrbpOptions.map((value) => ({ value }))} />
          <Select value={priority} onChange={setPriority} placeholder="优先级" allowClear style={{ width: 115 }} options={(['P0', 'P1', 'P2'] as Priority[]).map((value) => ({ value }))} />
          <Select value={status} onChange={setStatus} placeholder="岗位状态" allowClear style={{ width: 130 }} options={statusOptions.map((value) => ({ value }))} />
          {hasFilters && <Button icon={<ClearOutlined />} onClick={clearFilters}>清除筛选</Button>}
        </div>
      </Card>

      <RecruitingBoardView board={filteredBoard} />

      <Modal title="分享招聘看板" open={shareOpen} onCancel={() => setShareOpen(false)} footer={null} destroyOnHidden>
        <Typography.Paragraph type="secondary">公开链接仅展示聚合招聘数据，不包含候选人或 AI 评估信息。</Typography.Paragraph>
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Radio.Group
            value={shareMode}
            onChange={(event) => {
              setShareMode(event.target.value);
              setShareSnapshotId(undefined);
            }}
          >
            <Space direction="vertical">
              <Radio value="live">分享最新实时数据</Radio>
              <Radio value="snapshot">固定为历史快照</Radio>
            </Space>
          </Radio.Group>
          {shareMode === 'snapshot' && (
            <Select
              value={shareSnapshotId}
              onChange={setShareSnapshotId}
              placeholder="选择快照日期"
              style={{ width: '100%' }}
              options={snapshots.map((item) => ({ value: item.id, label: item.snapshot_date }))}
            />
          )}
          <Radio.Group value={shareExpiry} onChange={(event) => setShareExpiry(event.target.value)}>
            <Space direction="vertical">
              <Radio value="1d">1 天有效</Radio>
              <Radio value="7d">7 天有效</Radio>
              <Radio value="30d">30 天有效</Radio>
              <Radio value="permanent">长期有效（可随时撤销）</Radio>
            </Space>
          </Radio.Group>
          <Button
            type="primary"
            disabled={shareMode === 'snapshot' && !shareSnapshotId}
            loading={creatingShare}
            onClick={createShareLink}
          >生成并复制链接</Button>
          {newShareUrl && <Input value={newShareUrl} readOnly addonAfter={<Button type="link" size="small" onClick={() => copyShareLink(newShareUrl)}>复制</Button>} />}
          <Typography.Text strong>已创建链接</Typography.Text>
          <List
            size="small"
            bordered
            dataSource={shareLinks}
            locale={{ emptyText: '暂无分享链接' }}
            renderItem={(link) => (
              <List.Item actions={link.revoked_at
                ? [<Tag key="revoked">已撤销</Tag>]
                : [<Button key="revoke" type="link" danger onClick={() => revokeShareLink(link.id)}>撤销</Button>]}
              >
                <span>
                  {link.data_mode === 'snapshot'
                    ? `固定快照：${snapshots.find((item) => item.id === link.snapshot_id)?.snapshot_date || '未知日期'}`
                    : '实时数据'}
                  {' · '}{link.expires_at ? `有效至 ${new Date(link.expires_at).toLocaleString('zh-CN')}` : '长期有效'}
                  {' · '}创建于 {new Date(link.created_at).toLocaleString('zh-CN')}
                </span>
              </List.Item>
            )}
          />
        </Space>
      </Modal>
    </div>
  );
};

export default Dashboard;
