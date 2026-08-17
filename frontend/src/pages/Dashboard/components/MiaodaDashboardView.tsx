import { useMemo, useState } from 'react';
import { Tag } from 'antd';
import { CaretDownOutlined, CaretRightOutlined, ClockCircleOutlined } from '@ant-design/icons';
import type {
  DashboardV3Board,
  DashboardV3Division,
  DashboardV3FunnelStage,
  DashboardV3Hrbp,
  DashboardV3Position,
} from '../v3-types';
import styles from '../dashboard.module.css';

const number = (value: number | null | undefined) => value == null ? '—' : value.toLocaleString('zh-CN');
const percent = (value: number | null | undefined) => value == null ? 'N/A' : `${value.toFixed(1)}%`;
const rate = (numerator: number, denominator: number) => denominator > 0 ? (numerator / denominator) * 100 : null;

function SectionHeading({ eyebrow, title, description, meta }: { eyebrow?: string; title: string; description?: string; meta?: string }) {
  return <div className={styles.miaodaSectionHeading}>
    <div className={styles.miaodaSectionTitleGroup}>
      <span className={styles.miaodaSectionMarker} aria-hidden="true" />
      <div>
        {eyebrow && <span className={styles.miaodaEyebrow}>{eyebrow}</span>}
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
    </div>
    {meta && <span className={styles.miaodaSectionMeta}>{meta}</span>}
  </div>;
}

function MetricCard({ label, value, caption, tone = 'neutral' }: { label: string; value: string; caption?: string; tone?: 'neutral' | 'red' | 'green' | 'orange' | 'blue' }) {
  return <article className={`${styles.miaodaMetricCard} ${styles[`miaodaMetric${tone[0].toUpperCase()}${tone.slice(1)}`]}`}>
    <span className={styles.miaodaMetricLabel}>{label}</span>
    <strong>{value}</strong>
    {caption && <small>{caption}</small>}
  </article>;
}

function Overview({ board }: { board: DashboardV3Board }) {
  const { totals } = board;
  const completed = Math.max(0, totals.active_positions - totals.in_progress_position_count);
  return <section className={styles.miaodaSection}>
    <SectionHeading title="总体概览" />
    <div className={styles.miaodaScopeNote}><strong>【数据范围】</strong>仅统计 P0-紧急 / P1-正常岗位，P2-储备岗不计入任何统计，仅在下方 P2 明细板块单独展示。</div>
    <div className={styles.miaodaMetricGrid}>
      <MetricCard label="在招岗位" value={number(totals.active_positions)} caption={`已完结${completed} + 在途${totals.in_progress_position_count}`} tone="red" />
      <MetricCard label="在招人数" value={number(totals.headcount)} caption="累计口径" />
      <MetricCard label="简历推送" value={number(totals.resume_push)} caption="岗位累计值" tone="red" />
      <MetricCard label="安排面试" value={number(totals.first_scheduled)} caption="岗位累计值" />
      <MetricCard label="面试通过率" value={percent(totals.interview_pass_rate)} caption={`终面${number(totals.final_pass)} ÷ 1面${number(totals.first_scheduled)}`} tone="red" />
      <MetricCard label="发放Offer" value={number(totals.offers)} caption={`已入职 ${number(totals.hired)}`} />
      <MetricCard label="平均招聘周期" value={totals.average_completed_cycle_days == null ? '—' : `${totals.average_completed_cycle_days.toFixed(1)}天`} caption={`仅已完结岗 ${completed} 个`} />
    </div>
    <div className={styles.miaodaInProgressNote}><strong>在途参考：</strong>在途岗位 {number(totals.in_progress_position_count)} 个 · 平均已耗时 {totals.in_progress_average_elapsed_days == null ? '—' : `${totals.in_progress_average_elapsed_days.toFixed(1)} 天`}（不计入平均周期）</div>
  </section>;
}

function Diagnostic({ board }: { board: DashboardV3Board }) {
  const lines = [
    board.insights.summary,
    ...board.insights.bottlenecks.map((item) => `漏斗诊断：${item}`),
    ...board.insights.recommendations.map((item) => `行动建议：${item}`),
  ].filter(Boolean);
  return <section className={styles.miaodaDiagnostic}>
    <div className={styles.miaodaDiagnosticTitle}><span>◌</span><strong>AI 智能总结 · 全局诊断</strong></div>
    <ol>{(lines.length ? lines : ['暂无足够数据生成 AI 诊断。']).map((line, index) => <li key={`${line}-${index}`}>{line}</li>)}</ol>
  </section>;
}

function Funnel({ stages }: { stages: DashboardV3FunnelStage[] }) {
  const max = Math.max(1, ...stages.map((stage) => stage.count));
  return <section className={styles.miaodaSection}>
    <SectionHeading title="招聘漏斗（全事业部汇总 · 岗位累计口径）" />
    <div className={styles.miaodaFunnelCard}>
      {stages.map((stage, index) => {
        const conversion = index === 0 ? 100 : stage.conversion_rate;
        const width = `${Math.max(stage.count > 0 ? 18 : 8, stage.count / max * 100)}%`;
        return <div className={styles.miaodaFunnelRow} key={stage.key}>
          <div className={styles.miaodaFunnelShapeWrap}><div className={styles.miaodaFunnelShape} style={{ width, opacity: stage.count === 0 ? 0.72 : 1 }} /></div>
          <div className={styles.miaodaFunnelText}><strong>{stage.label}</strong><span>{number(stage.count)}</span><small>转化率 {percent(conversion)}</small></div>
        </div>;
      })}
    </div>
  </section>;
}

function WeeklyDynamic({ board }: { board: DashboardV3Board }) {
  const dynamic = board.weekly_dynamic;
  const items = [
    ['新增简历', dynamic.resume_push],
    ['新增面试', dynamic.first_scheduled],
    ['新增1面通过', dynamic.first_pass],
    ['新增2面通过', dynamic.second_pass],
    ['新增终面', dynamic.final_pass],
    ['新增Offer', dynamic.offers],
    ['新增入职', dynamic.hired],
  ] as const;
  return <section className={styles.miaodaWeeklyPanel}>
    <div className={styles.miaodaWeeklyHeading}><SectionHeading title="周招聘动态" meta={`${dynamic.baseline_date ? `${dynamic.baseline_date} 起` : '实时累计'} · 数据更新于 ${new Date(board.updated_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`} /></div>
    <div className={styles.miaodaWeeklyHero}>
      <MetricCard label="在招岗位数" value={number(board.totals.active_positions)} caption={`截至 ${board.snapshot_date || '今日'}`} />
      <MetricCard label="本周新增岗位" value="—" caption="暂无岗位新增快照" tone="blue" />
    </div>
    <div className={styles.miaodaWeeklyGrid}>{items.map(([label, value]) => <MetricCard key={label} label={label} value={number(value)} />)}</div>
    <p className={styles.miaodaWeeklyHint}>本周新增为当前数据与上次快照的差值；未建立基准快照的指标显示为 0 或 —。</p>
  </section>;
}

function DivisionCard({ division }: { division: DashboardV3Division }) {
  const totals = division.totals;
  const p0Headcount = division.positions.filter((position) => position.priority === 'P0').reduce((sum, position) => sum + position.headcount, 0);
  return <article className={styles.miaodaDivisionCard}>
    <div className={styles.miaodaDivisionHeader}><div><h3>{division.department}</h3><p>HRBP：{division.hrbps.join(' / ') || '未分配'}</p></div><span className={styles.miaodaDivisionBadge}>{division.positions.length} 个岗位</span></div>
    <div className={styles.miaodaDivisionMetrics}>
      <MetricCard label="在招岗位" value={number(totals.active_positions)} />
      <MetricCard label="在招人数" value={number(totals.headcount)} />
      <MetricCard label="P0-紧急岗位" value={number(division.p0_position_count)} tone="red" />
      <MetricCard label="P0在招人数" value={number(p0Headcount)} tone="red" />
      <MetricCard label="已完结平均周期" value={totals.average_completed_cycle_days == null ? '暂无' : `${totals.average_completed_cycle_days.toFixed(1)}天`} />
      <MetricCard label="简历推送" value={number(totals.resume_push)} />
      <MetricCard label="安排1面" value={number(totals.first_scheduled)} />
      <MetricCard label="面试通过率" value={percent(totals.interview_pass_rate)} tone={totals.interview_pass_rate != null && totals.interview_pass_rate >= 30 ? 'green' : 'red'} />
    </div>
    <div className={styles.miaodaInProgressMini}>在途参考：在途岗位 {number(division.in_progress_position_count)} 个 · 平均已耗时 {division.in_progress_average_elapsed_days == null ? '—' : `${division.in_progress_average_elapsed_days.toFixed(1)}天`}</div>
    <MiniFunnel stages={division.funnel} />
  </article>;
}

function MiniFunnel({ stages }: { stages: DashboardV3FunnelStage[] }) {
  const max = Math.max(1, ...stages.map((stage) => stage.count));
  return <div className={styles.miaodaMiniFunnel}><h4>招聘漏斗（累计口径）</h4><div className={styles.miaodaMiniFunnelRows}>{stages.map((stage) => <div className={styles.miaodaMiniFunnelItem} key={stage.key}><strong>{number(stage.count)}</strong><div className={styles.miaodaMiniBar}><span style={{ width: `${Math.max(stage.count > 0 ? 8 : 0, stage.count / max * 100)}%` }} /></div><span>{stage.label}</span><small>{stage.conversion_rate == null ? '—' : `转化率 ${percent(stage.conversion_rate)}`}</small></div>)}</div></div>;
}

function HrbpCard({ hrbp }: { hrbp: DashboardV3Hrbp }) {
  const nodes = [
    ['简历', hrbp.resume_push, null],
    ['1面', hrbp.first_scheduled, hrbp.conversion_rates.first_over_resume],
    ['终面', hrbp.final_pass, hrbp.conversion_rates.final_over_first],
    ['Offer', hrbp.offers, hrbp.conversion_rates.offer_over_final],
    ['入职', hrbp.hired, hrbp.conversion_rates.hired_over_offer],
  ] as const;
  return <article className={styles.miaodaHrbpCard}>
    <div className={styles.miaodaHrbpHeader}><div><h3>{hrbp.name}</h3><span>{hrbp.department}</span></div><span className={styles.miaodaAiLabel}>✧ AI 分析</span></div>
    <div className={styles.miaodaHrbpMetrics}>
      <MetricCard label="负责岗位" value={number(hrbp.position_count)} />
      <MetricCard label="在招人数" value={number(hrbp.headcount)} />
      <MetricCard label="已完结平均招聘周期" value={hrbp.average_completed_cycle_days == null ? '暂无' : `${hrbp.average_completed_cycle_days.toFixed(1)}天`} />
      <MetricCard label="P0-紧急岗位" value={number(hrbp.p0_position_count)} tone="red" />
      <MetricCard label="P0在招人数" value={number(hrbp.p0_headcount)} tone="red" />
    </div>
    <div className={styles.miaodaHrbpInProgress}>在途参考：在途岗位 {number(hrbp.in_progress_position_count)} 个 · 平均已耗时 {hrbp.in_progress_average_elapsed_days == null ? '—' : `${hrbp.in_progress_average_elapsed_days.toFixed(1)}天`}</div>
    <div className={styles.miaodaHrbpPipeline}>{nodes.map(([label, count, conversion], index) => <div key={label} className={styles.miaodaHrbpNode}><strong>{number(count)}</strong><span>{label}</span><small className={conversion === null ? styles.miaodaRateNeutral : conversion != null && conversion >= 30 ? styles.miaodaRateGood : conversion != null && conversion >= 15 ? styles.miaodaRateWarn : conversion != null && conversion > 0 ? styles.miaodaRateBad : styles.miaodaRateNeutral}>{conversion == null ? '—' : percent(conversion)}</small>{index < nodes.length - 1 && <i>→</i>}</div>)}</div>
  </article>;
}

function FieldDefinitions() {
  const items = [
    '在招岗位数：仅统计 P0/P1 且在统计周期内未完结的岗位；P2 储备岗不计入。',
    '安排面试：所有 P0/P1 岗位安排 1 面字段的累计值，采用岗位累计口径。',
    '面试通过率：终面通过数 ÷ 安排1面数；终面通过优先取 3 面，否则取 2 面。',
    '已完结平均招聘周期：只统计已完成/已取消且耗时大于 0 的岗位，在途岗位单独参考。',
    '漏斗口径：简历推送、1面、2面、终面、Offer、入职均为岗位累计值；本周新增为快照差值。',
  ];
  return <section id="dashboard-field-definitions" className={styles.miaodaFieldDefinitions}><SectionHeading title="字段释义" /><ol>{items.map((item) => <li key={item}>{item}</li>)}</ol></section>;
}

function positionStatusGroup(position: DashboardV3Position): 'inProgress' | 'completed' {
  return /(完成|取消)/.test(position.status) ? 'completed' : 'inProgress';
}

type PositionTotals = Pick<DashboardV3Position, 'headcount' | 'resume_push' | 'first_scheduled' | 'first_pass' | 'second_pass' | 'final_pass' | 'offers' | 'hired'>;

function sumPositionTotals(positions: DashboardV3Position[]): PositionTotals {
  return positions.reduce<PositionTotals>((total, position) => ({
    headcount: total.headcount + position.headcount,
    resume_push: total.resume_push + position.resume_push,
    first_scheduled: total.first_scheduled + position.first_scheduled,
    first_pass: total.first_pass + position.first_pass,
    second_pass: total.second_pass + position.second_pass,
    final_pass: total.final_pass + position.final_pass,
    offers: total.offers + position.offers,
    hired: total.hired + position.hired,
  }), {
    headcount: 0,
    resume_push: 0,
    first_scheduled: 0,
    first_pass: 0,
    second_pass: 0,
    final_pass: 0,
    offers: 0,
    hired: 0,
  });
}

function TableRate({ finalPass, firstScheduled }: { finalPass: number; firstScheduled: number }) {
  const value = rate(finalPass, firstScheduled);
  return <span className={styles.miaodaTableRate}>
    <i style={{ width: `${Math.min(100, value || 0)}%` }} />
    {percent(value)}
  </span>;
}

function DetailTable({ title, positions, accent }: { title: string; positions: DashboardV3Position[]; accent: 'red' | 'blue' | 'green' }) {
  const grouped = useMemo(() => [...positions.reduce((map, position) => map.set(position.department, [...(map.get(position.department) || []), position]), new Map<string, DashboardV3Position[]>()).entries()], [positions]);
  const [open, setOpen] = useState<Record<string, boolean>>(() => Object.fromEntries(grouped.map(([department]) => [department, true])));
  const toggle = (department: string) => setOpen((value) => ({ ...value, [department]: value[department] === false }));
  if (positions.length === 0) return null;
  const grandTotal = sumPositionTotals(positions);
  return <section className={styles.miaodaDetailSection}>
    <div className={`${styles.miaodaDetailHeading} ${styles[`miaodaDetailHeading${accent[0].toUpperCase()}${accent.slice(1)}`]}`}>
      <span className={styles.miaodaSectionMarker} aria-hidden="true" />
      <h3>{title}</h3>
      <span>{positions.length} 个岗位</span>
    </div>
    <div className={`${styles.miaodaDetailTableCard} ${styles[`miaodaDetail${accent[0].toUpperCase()}${accent.slice(1)}`]}`}>
      <div className={styles.miaodaDesktopTableWrap}><table className={styles.miaodaDetailTable}><thead><tr><th>事业部</th><th>HRBP</th><th>在招职位</th><th>优先级</th><th>在招人数</th><th>简历</th><th>1面</th><th>1面通过</th><th>2面通过</th><th>终面通过</th><th>通过率</th><th>Offer</th><th>入职</th><th>备注</th><th>状态</th></tr></thead>{grouped.map(([department, rows]) => {
        const subtotal = sumPositionTotals(rows);
        return <tbody key={department}>
          <tr className={styles.miaodaDepartmentRow}>
            <td colSpan={4}><button type="button" onClick={() => toggle(department)} aria-expanded={open[department]}>{open[department] ? <CaretDownOutlined /> : <CaretRightOutlined />} {department}<span>{rows.length} 个岗位</span></button></td>
            <td>{number(subtotal.headcount)}</td><td>{number(subtotal.resume_push)}</td><td>{number(subtotal.first_scheduled)}</td><td>{number(subtotal.first_pass)}</td><td>{number(subtotal.second_pass)}</td><td>{number(subtotal.final_pass)}</td><td><TableRate finalPass={subtotal.final_pass} firstScheduled={subtotal.first_scheduled} /></td><td>{number(subtotal.offers)}</td><td>{number(subtotal.hired)}</td><td colSpan={2} />
          </tr>
          {open[department] && rows.map((position) => <PositionTableRow key={position.position_id} position={position} />)}
        </tbody>;
      })}<tfoot><tr className={styles.miaodaGrandTotalRow}><td colSpan={4}>合计</td><td>{number(grandTotal.headcount)}</td><td>{number(grandTotal.resume_push)}</td><td>{number(grandTotal.first_scheduled)}</td><td>{number(grandTotal.first_pass)}</td><td>{number(grandTotal.second_pass)}</td><td>{number(grandTotal.final_pass)}</td><td><TableRate finalPass={grandTotal.final_pass} firstScheduled={grandTotal.first_scheduled} /></td><td>{number(grandTotal.offers)}</td><td>{number(grandTotal.hired)}</td><td colSpan={2} /></tr></tfoot></table></div>
      <div className={styles.miaodaMobileRows}>{positions.filter((position) => open[position.department] !== false).map((position) => <PositionMobileRow key={position.position_id} position={position} />)}</div>
    </div>
  </section>;
}

function PositionTableRow({ position }: { position: DashboardV3Position }) {
  const interviewRate = rate(position.final_pass, position.first_scheduled);
  return <tr><td>{position.department}</td><td>{position.hrbps.join(' / ') || '未分配'}</td><td><strong>{position.display_name}</strong></td><td><Tag className={styles.miaodaPriorityTag}>{position.priority === 'P0' ? 'P0-紧急' : position.priority === 'P1' ? 'P1-正常' : 'P2-储备'}</Tag></td><td>{number(position.headcount)}</td><td>{number(position.resume_push)}</td><td>{number(position.first_scheduled)}</td><td>{number(position.first_pass)}</td><td>{number(position.second_pass)}</td><td>{number(position.final_pass)}</td><td><span className={styles.miaodaTableRate}><i style={{ width: `${Math.min(100, interviewRate || 0)}%` }} />{percent(interviewRate)}</span></td><td>{number(position.offers)}</td><td>{number(position.hired)}</td><td className={styles.miaodaNoteCell}>{position.notes || '—'}</td><td><Tag color={/(完成|取消)/.test(position.status) ? 'green' : 'red'}>{position.status || '未知'}</Tag></td></tr>;
}

function PositionMobileRow({ position }: { position: DashboardV3Position }) {
  return <article className={styles.miaodaMobileRow}><div className={styles.miaodaMobileRowHeader}><strong>{position.display_name}</strong><Tag color={position.priority === 'P0' ? 'red' : 'blue'}>{position.priority}</Tag></div><p>{position.department} · {position.hrbps.join(' / ') || '未分配'} · {position.city || '城市未识别'}</p><div className={styles.miaodaMobileMetrics}><span>在招 {number(position.headcount)}</span><span>简历 {number(position.resume_push)}</span><span>1面 {number(position.first_scheduled)}</span><span>终面 {number(position.final_pass)}</span><span>Offer {number(position.offers)}</span><span>入职 {number(position.hired)}</span></div><Tag color={/(完成|取消)/.test(position.status) ? 'green' : 'red'}>{position.status || '未知'}</Tag></article>;
}

export function MiaodaDashboardView({ board }: { board: DashboardV3Board }) {
  const statisticalInProgress = board.positions.filter((position) => positionStatusGroup(position) === 'inProgress');
  const completed = board.positions.filter((position) => positionStatusGroup(position) === 'completed');
  const sourceDescription = board.data_source === 'static_excel' ? 'Excel 静态快照 + 系统 D1 流程数据' : board.data_source === 'feishu' ? '飞书实时数据 + 系统 D1 流程数据' : '飞书、Excel 与系统 D1 合并数据';
  return <div className={styles.miaodaDashboard}>
    <div className={styles.miaodaDataMeta}><span>数据截止：{board.snapshot_date || new Date(board.updated_at).toLocaleDateString('zh-CN')}</span><span>{sourceDescription}</span><span><ClockCircleOutlined /> 最近更新 {new Date(board.updated_at).toLocaleString('zh-CN')}</span></div>
    <Overview board={board} />
    <Diagnostic board={board} />
    <Funnel stages={board.funnel} />
    <WeeklyDynamic board={board} />
    <section className={styles.miaodaSection}><SectionHeading title="事业部分部看板" description="数据起始日期：职培事业部-2026/6/11，其他四大事业部-2026/7/16" /><div className={styles.miaodaDivisionGrid}>{board.divisions.map((division) => <DivisionCard key={division.department} division={division} />)}</div></section>
    <section className={styles.miaodaSection}><SectionHeading title="招聘效能（按 HRBP）" description={`数据截至 ${board.snapshot_date || new Date(board.updated_at).toLocaleDateString('zh-CN')} · 已剔除 P2 储备岗`} /><div className={styles.miaodaHrbpGrid}>{board.hrbps.map((hrbp) => <HrbpCard key={hrbp.name} hrbp={hrbp} />)}</div></section>
    <FieldDefinitions />
    <section className={styles.miaodaDetailSection}>
      <SectionHeading title="全量岗位明细汇总" />
      <DetailTable title="全量岗位明细-在途招聘中" positions={statisticalInProgress} accent="red" />
      <DetailTable title="全量岗位明细-P2储备岗" positions={board.p2_positions} accent="blue" />
      <DetailTable title="全量岗位明细-已完结" positions={completed} accent="green" />
    </section>
  </div>;
}
