import { useMemo, useState } from 'react';
import { Card, Collapse, Empty, Progress, Space, Tag, Typography } from 'antd';
import { BarChartOutlined, ClockCircleOutlined, RiseOutlined, TeamOutlined } from '@ant-design/icons';
import type { DashboardV3Board, DashboardV3Division, DashboardV3Hrbp, DashboardV3Position } from '../v3-types';
import styles from '../dashboard.module.css';

const number = (value: number | null | undefined) => value == null ? '—' : value.toLocaleString('zh-CN');
const percent = (value: number | null | undefined) => value == null ? '—' : `${value.toFixed(1)}%`;

function Metric({ label, value, tone = 'default', hint }: { label: string; value: string; tone?: 'default' | 'blue' | 'green' | 'orange' | 'red'; hint?: string }) {
  return <div className={`${styles.v3Metric} ${styles[`v3Metric${tone[0].toUpperCase()}${tone.slice(1)}`]}`}>
    <span>{label}</span><strong>{value}</strong>{hint && <small>{hint}</small>}
  </div>;
}

function Funnel({ board }: { board: DashboardV3Board }) {
  const max = Math.max(1, ...board.funnel.map((stage) => stage.count));
  return <Card className={styles.v3FunnelCard} bordered={false}>
    <div className={styles.v3CardHeading}><div><span className={styles.v3Eyebrow}>PIPELINE</span><Typography.Title level={2}>全局招聘漏斗</Typography.Title><Typography.Text type="secondary">从简历入库到最终入职的全链路转化</Typography.Text></div><BarChartOutlined /></div>
    <div className={styles.v3FunnelRows}>
      {board.funnel.map((stage, index) => <div className={styles.v3FunnelRow} key={stage.key}>
        <span className={styles.v3FunnelLabel}>{stage.label}</span>
        <div className={styles.v3FunnelBar}><span style={{ width: `${Math.max(stage.count ? 3 : 0, stage.count / max * 100)}%`, background: index < 2 ? '#3f83f8' : '#4f46e5' }} /></div>
        <strong>{number(stage.count)}</strong><small>{index === 0 ? '入口' : percent(stage.conversion_rate)}</small>
      </div>)}
    </div>
  </Card>;
}

function DivisionCard({ division }: { division: DashboardV3Division }) {
  const [open, setOpen] = useState(false);
  const totals = division.totals;
  return <Card className={styles.v3DivisionCard} bordered={false}>
    <div className={styles.v3DivisionTitle}><div><Typography.Title level={3}>{division.department}</Typography.Title><Typography.Text type="secondary">HRBP：{division.hrbps.join('、') || '未分配'}</Typography.Text></div><Tag color="blue">{division.positions.length} 个岗位</Tag></div>
    <div className={styles.v3MetricsGrid}>
      <Metric label="在招岗位" value={number(totals.active_positions)} tone="blue" />
      <Metric label="在招人数" value={number(totals.headcount)} />
      <Metric label="简历推送" value={number(totals.resume_push)} />
      <Metric label="一面通过" value={number(totals.first_pass)} />
      <Metric label="终面通过" value={number(totals.final_pass)} />
      <Metric label="Offer" value={number(totals.offers)} tone="orange" />
      <Metric label="已入职" value={number(totals.hired)} tone="green" />
      <Metric label="面试通过率" value={percent(totals.interview_pass_rate)} />
    </div>
    <div className={styles.v3MiniFunnel}>{division.funnel.map((stage) => <div key={stage.key}><strong>{number(stage.count)}</strong><span>{stage.label}</span><small>{percent(stage.conversion_rate)}</small></div>)}</div>
    <button type="button" className={styles.v3ExpandButton} aria-expanded={open} onClick={() => setOpen((value) => !value)}>{open ? '收起岗位明细' : '展开岗位明细'} · {division.positions.length}</button>
    {open && <div className={styles.v3PositionList}>{division.positions.map((position) => <PositionRow key={position.position_id} position={position} />)}</div>}
  </Card>;
}

function PositionRow({ position }: { position: DashboardV3Position }) {
  return <div className={styles.v3PositionRow}>
    <div><strong>{position.display_name}</strong><span>{position.city || '城市未识别'} · {position.hrbps.join('、') || '未分配'}</span></div>
    <Space wrap size={[4, 4]}><Tag color={position.priority === 'P0' ? 'red' : 'blue'}>{position.priority}</Tag><Tag>{position.status || '未知状态'}</Tag><Tag color="geekblue">简历 {number(position.resume_push)}</Tag><Tag color="green">入职 {number(position.hired)}</Tag></Space>
  </div>;
}

function HrbpCard({ hrbp }: { hrbp: DashboardV3Hrbp }) {
  return <Card className={styles.v3HrbpCard} bordered={false}>
    <div className={styles.v3HrbpHeading}><TeamOutlined /><div><Typography.Title level={4}>{hrbp.name}</Typography.Title><Typography.Text type="secondary">{hrbp.department}</Typography.Text></div></div>
    <div className={styles.v3HrbpMetrics}><Metric label="负责岗位" value={number(hrbp.position_count)} /><Metric label="在招人数" value={number(hrbp.headcount)} /><Metric label="P0岗位" value={number(hrbp.p0_position_count)} tone="red" /><Metric label="平均周期" value={hrbp.average_completed_cycle_days == null ? '—' : `${hrbp.average_completed_cycle_days.toFixed(1)}天`} /></div>
    <div className={styles.v3ConversionLine}><span>简历 {number(hrbp.resume_push)}</span><span>→</span><span>一面 {number(hrbp.first_scheduled)} <b>{percent(hrbp.conversion_rates.first_over_resume)}</b></span><span>→</span><span>终面 {number(hrbp.final_pass)} <b>{percent(hrbp.conversion_rates.final_over_first)}</b></span><span>→</span><span>Offer {number(hrbp.offers)} <b>{percent(hrbp.conversion_rates.offer_over_final)}</b></span><span>→</span><span>入职 {number(hrbp.hired)} <b>{percent(hrbp.conversion_rates.hired_over_offer)}</b></span></div>
  </Card>;
}

export function MiaodaDashboardView({ board }: { board: DashboardV3Board }) {
  const [p2Open, setP2Open] = useState(false);
  const totals = board.totals;
  const dynamic = board.weekly_dynamic;
  const cards = useMemo(() => [
    ['在招岗位', number(totals.active_positions), 'blue'], ['在招人数', number(totals.headcount), 'default'], ['简历推送', number(totals.resume_push), 'blue'], ['安排1面', number(totals.first_scheduled), 'default'], ['终面通过', number(totals.final_pass), 'green'], ['发放Offer', number(totals.offers), 'orange'], ['已入职', number(totals.hired), 'green'], ['面试通过率', percent(totals.interview_pass_rate), 'default'],
  ] as const, [totals]);
  return <div className={styles.v3Dashboard}>
    <section className={styles.v3Hero}><div><span className={styles.v3Eyebrow}>RECRUITING OPERATIONS</span><Typography.Title>全局招聘漏斗</Typography.Title><Typography.Paragraph>以飞书招聘数据为主，叠加系统简历入库与流程数据 · {board.data_mode === 'snapshot' ? `快照 ${board.snapshot_date || ''}` : '最新实时数据'}</Typography.Paragraph></div><div className={styles.v3HeroBadge}><ClockCircleOutlined /> 更新于 {new Date(board.updated_at).toLocaleString('zh-CN')}</div></section>
    <section className={styles.v3KpiGrid}>{cards.map(([label, value, tone]) => <Metric key={label} label={label} value={value} tone={tone} />)}</section>
    <Funnel board={board} />
    <section className={styles.v3Section}><div className={styles.v3SectionTitle}><div><span className={styles.v3Eyebrow}>DIVISIONS</span><Typography.Title level={2}>事业部分部看板</Typography.Title><Typography.Text type="secondary">对比各事业部的需求规模与关键转化</Typography.Text></div></div><div className={styles.v3DivisionGrid}>{board.divisions.map((division) => <DivisionCard key={division.department} division={division} />)}</div></section>
    <section className={styles.v3Section}><div className={styles.v3SectionTitle}><div><span className={styles.v3Eyebrow}>HRBP PERFORMANCE</span><Typography.Title level={2}>HRBP 效能</Typography.Title><Typography.Text type="secondary">按负责人查看转化链路与招聘周期</Typography.Text></div></div><div className={styles.v3HrbpGrid}>{board.hrbps.map((hrbp) => <HrbpCard key={hrbp.name} hrbp={hrbp} />)}</div></section>
    <Card className={styles.v3InsightCard} bordered={false}><div className={styles.v3CardHeading}><RiseOutlined /><Typography.Title level={3}>招聘动态与 AI 诊断</Typography.Title></div><Typography.Paragraph>{board.insights.summary}</Typography.Paragraph><Collapse ghost items={[{ key: 'diagnosis', label: '查看诊断与行动建议', children: <div><p><strong>漏斗短板：</strong>{board.insights.bottlenecks.join('；')}</p><p><strong>建议：</strong>{board.insights.recommendations.join('；')}</p><p><strong>本周动态：</strong>新增简历 {dynamic.resume_push} · 安排1面 {dynamic.first_scheduled} · Offer {dynamic.offers} · 入职 {dynamic.hired}</p></div> }]} /></Card>
    <Card className={styles.v3P2Card} bordered={false}><button type="button" className={styles.v3P2Toggle} aria-expanded={p2Open} onClick={() => setP2Open((value) => !value)}><span><span className={styles.v3Eyebrow}>P2 RESERVE</span><Typography.Title level={3}>P2 储备岗</Typography.Title></span><Tag>{board.p2_positions.length} 个岗位</Tag></button>{p2Open && (board.p2_positions.length ? <div className={styles.v3PositionList}>{board.p2_positions.map((position) => <PositionRow key={position.position_id} position={position} />)}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无 P2 储备岗位" />)}</Card>
  </div>;
}
