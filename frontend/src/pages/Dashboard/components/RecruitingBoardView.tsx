import type { CSSProperties, ReactNode } from 'react';
import {
  ApartmentOutlined,
  BulbOutlined,
  CheckCircleOutlined,
  FileSearchOutlined,
  FlagOutlined,
  RiseOutlined,
  SolutionOutlined,
  TeamOutlined,
  UserSwitchOutlined,
} from '@ant-design/icons';
import { Card, Tag } from 'antd';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { DashboardMetric, FunnelStage, RecruitingBoard } from '../types';
import { PositionSummaryTable } from './PositionSummaryTable';
import styles from '../dashboard.module.css';

const kpiDefinitions: Array<{
  key: string;
  label: string;
  suffix?: string;
  color: string;
  icon: ReactNode;
}> = [
  { key: 'active_positions', label: '在招岗位', suffix: '个', color: '#3B82F6', icon: <ApartmentOutlined /> },
  { key: 'total_resumes', label: '已入库简历', suffix: '份', color: '#6366F1', icon: <FileSearchOutlined /> },
  { key: 'first_interview', label: '安排面试', suffix: '人', color: '#8B5CF6', icon: <UserSwitchOutlined /> },
  { key: 'interview_pass_rate', label: '面试通过率', suffix: '%', color: '#06B6D4', icon: <RiseOutlined /> },
  { key: 'offers', label: '发放 Offer', suffix: '份', color: '#F59E0B', icon: <FlagOutlined /> },
  { key: 'hired', label: '已入职', suffix: '人', color: '#10B981', icon: <CheckCircleOutlined /> },
  { key: 'weekly_requirement_completion', label: '本周需求完成', suffix: '%', color: '#64748B', icon: <SolutionOutlined /> },
];

const funnelColors = ['#3B82F6', '#4F46E5', '#6366F1', '#7C3AED', '#8B5CF6', '#A855F7', '#D946EF', '#10B981'];

function metricValue(metric: DashboardMetric | undefined): string {
  if (!metric?.available || metric.value == null) return '—';
  return metric.value.toLocaleString('zh-CN', { maximumFractionDigits: 1 });
}

function SectionTitle({
  eyebrow,
  children,
  description,
}: {
  eyebrow: string;
  children: ReactNode;
  description?: string;
}) {
  return (
    <div className={styles.sectionHeading}>
      <div>
        <span className={styles.sectionEyebrow}>{eyebrow}</span>
        <h2>{children}</h2>
      </div>
      {description && <p>{description}</p>}
    </div>
  );
}

function KpiGrid({ board }: { board: RecruitingBoard }) {
  const dataCaption = board.data_mode === 'snapshot'
    ? `快照 · ${board.snapshot_date || '历史数据'}`
    : '实时汇总';

  return (
    <section className={styles.boardSection} aria-labelledby="dashboard-overview-title">
      <SectionTitle eyebrow="Overview" description="聚焦招聘进程中的核心经营指标">
        <span id="dashboard-overview-title">总体概览</span>
      </SectionTitle>
      <div className={styles.kpiGrid}>
        {kpiDefinitions.map((item) => {
          const metric = board.kpis[item.key];
          const unavailable = !metric?.available || metric.value == null;
          return (
            <Card
              key={item.key}
              className={styles.kpiCard}
              style={{ '--kpi-accent': item.color } as CSSProperties}
            >
              <div className={styles.kpiTopLine}>
                <span className={styles.kpiIcon}>{item.icon}</span>
                <span className={styles.kpiLabel}>{item.label}</span>
              </div>
              <div className={styles.kpiValue}>
                {metricValue(metric)}
                {!unavailable && item.suffix && <span>{item.suffix}</span>}
              </div>
              {item.key === 'weekly_requirement_completion' && unavailable
                ? <div className={styles.kpiUnavailable}>暂未采集</div>
                : <div className={styles.kpiCaption}>
                  {item.key === 'active_positions'
                    ? `在招人数 ${metricValue(board.kpis.total_headcount)} 人 · ${dataCaption}`
                    : dataCaption}
                </div>}
            </Card>
          );
        })}
      </div>
    </section>
  );
}

function InsightCard({ insights }: { insights: RecruitingBoard['insights'] }) {
  return (
    <section className={styles.boardSection} aria-labelledby="dashboard-insights-title">
      <SectionTitle eyebrow="Insights" description="基于当前漏斗聚合数据生成的确定性诊断">
        <span id="dashboard-insights-title">AI 智能总结</span>
      </SectionTitle>
      <Card className={styles.insightCard}>
        <div className={styles.insightSummary}>
          <span className={styles.insightIcon}><BulbOutlined /></span>
          <div>
            <span className={styles.insightLabel}>当前概况</span>
            <p>{insights.summary || '暂无足够数据生成招聘概况。'}</p>
          </div>
        </div>
        <div className={styles.insightColumns}>
          <div className={styles.insightList}>
            <h3><span className={styles.warningDot} />漏斗短板</h3>
            <ul>
              {(insights.bottlenecks.length ? insights.bottlenecks : ['暂无足够漏斗数据']).map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
          <div className={styles.insightList}>
            <h3><span className={styles.successDot} />行动建议</h3>
            <ul>
              {(insights.recommendations.length ? insights.recommendations : ['暂无足够漏斗数据']).map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
        </div>
      </Card>
    </section>
  );
}

function RecruitingFunnel({ stages }: { stages: FunnelStage[] }) {
  return (
    <section className={styles.boardSection} aria-labelledby="dashboard-funnel-title">
      <SectionTitle eyebrow="Pipeline" description="从简历入库到最终入职的全链路转化">
        <span id="dashboard-funnel-title">全局招聘漏斗</span>
      </SectionTitle>
      <Card className={styles.funnelCard}>
        {stages.length === 0 ? <div className={styles.emptyState}>暂无漏斗数据</div> : (
          <div className={styles.funnelChart}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stages} layout="vertical" margin={{ top: 4, right: 44, bottom: 4, left: 4 }}>
                <CartesianGrid stroke="#E2E8F0" strokeDasharray="4 4" horizontal={false} />
                <XAxis type="number" hide domain={[0, 'dataMax']} />
                <YAxis
                  type="category"
                  dataKey="label"
                  axisLine={false}
                  tickLine={false}
                  width={94}
                  tick={{ fill: '#64748B', fontSize: 12 }}
                />
                <RechartsTooltip
                  cursor={{ fill: 'rgba(99, 102, 241, 0.06)' }}
                  formatter={(value) => [`${Number(value || 0).toLocaleString('zh-CN')} 人`, '数量']}
                  contentStyle={{ borderRadius: 10, borderColor: '#E2E8F0', boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)' }}
                />
                <Bar dataKey="count" barSize={18} radius={[0, 8, 8, 0]}>
                  {stages.map((stage, index) => <Cell key={stage.key} fill={funnelColors[index % funnelColors.length]} />)}
                  <LabelList
                    dataKey="count"
                    position="right"
                    formatter={(value) => Number(value || 0).toLocaleString('zh-CN')}
                    style={{ fill: '#0F172A', fontSize: 12, fontWeight: 600 }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>
    </section>
  );
}

function MiniFunnel({ values }: { values: Array<{ label: string; value: number }> }) {
  const max = Math.max(...values.map((item) => item.value), 1);
  return (
    <div className={styles.miniFunnel}>
      {values.map((item, index) => (
        <div className={styles.miniFunnelRow} key={item.label}>
          <span>{item.label}</span>
          <div className={styles.miniFunnelTrack}>
            <span
              style={{ width: `${item.value === 0 ? 0 : Math.max(item.value / max * 100, 5)}%`, background: funnelColors[index % funnelColors.length] }}
            />
          </div>
          <strong>{item.value}</strong>
        </div>
      ))}
    </div>
  );
}

function DivisionBoardGrid({ divisions }: { divisions: RecruitingBoard['divisions'] }) {
  return (
    <section className={styles.boardSection} aria-labelledby="dashboard-divisions-title">
      <SectionTitle eyebrow="Divisions" description="对比各事业部的需求规模与关键转化">
        <span id="dashboard-divisions-title">事业部分部看板</span>
      </SectionTitle>
      {divisions.length === 0 ? <Card><div className={styles.emptyState}>暂无事业部数据</div></Card> : (
        <div className={styles.divisionGrid}>
          {divisions.map((division) => {
            const p0Positions = division.positions.filter((position) => position.priority === 'P0').length;
            return (
              <Card className={styles.entityCard} key={division.division}>
                <div className={styles.entityCardHeader}>
                  <div>
                    <span className={styles.entityIcon}><ApartmentOutlined /></span>
                    <h3>{division.division}</h3>
                  </div>
                  {p0Positions > 0 && <Tag color="red">P0 · {p0Positions}</Tag>}
                </div>
                <div className={styles.entityOwner}>HRBP：{division.hrbps.join('、') || '未分配'}</div>
                <div className={styles.entityStats}>
                  <div><strong>{division.active_positions}</strong><span>在招岗位</span></div>
                  <div><strong>{division.total_headcount}</strong><span>在招人数</span></div>
                  <div><strong>{division.interview_pass_rate == null ? '—' : `${division.interview_pass_rate}%`}</strong><span>通过率</span></div>
                </div>
                <MiniFunnel values={[
                  { label: '简历', value: division.total_resumes },
                  { label: '面试', value: division.first_interview },
                  { label: 'Offer', value: division.offers },
                  { label: '入职', value: division.hired },
                ]} />
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}

function HrbpEfficiencyGrid({ cards }: { cards: RecruitingBoard['hrbps'] }) {
  return (
    <section className={styles.boardSection} aria-labelledby="dashboard-hrbp-title">
      <SectionTitle eyebrow="Efficiency" description="按负责人观察招聘负载与结果产出">
        <span id="dashboard-hrbp-title">招聘效能（按 HRBP）</span>
      </SectionTitle>
      {cards.length === 0 ? <Card><div className={styles.emptyState}>暂无 HRBP 数据</div></Card> : (
        <div className={styles.hrbpGrid}>
          {cards.map((card) => (
            <Card className={styles.entityCard} key={card.hrbp}>
              <div className={styles.entityCardHeader}>
                <div>
                  <span className={`${styles.entityIcon} ${styles.hrbpIcon}`}><TeamOutlined /></span>
                  <h3>{card.hrbp}</h3>
                </div>
                {card.p0_positions > 0 && <Tag color="red">P0 · {card.p0_positions}</Tag>}
              </div>
              <div className={styles.entityOwner}>{card.divisions.join('、') || '未分配事业部'}</div>
              <div className={styles.entityStats}>
                <div><strong>{card.active_positions}</strong><span>负责岗位</span></div>
                <div><strong>{card.total_headcount}</strong><span>在招人数</span></div>
                <div><strong>{card.average_hiring_days == null ? '—' : `${card.average_hiring_days} 天`}</strong><span>平均周期</span></div>
              </div>
              <MiniFunnel values={[
                { label: '简历', value: card.total_resumes },
                { label: '面试', value: card.first_interview },
                { label: 'Offer', value: card.offers },
                { label: '入职', value: card.hired },
              ]} />
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}

export function RecruitingBoardView({ board }: { board: RecruitingBoard }) {
  return (
    <div className={styles.board}>
      <KpiGrid board={board} />
      <InsightCard insights={board.insights} />
      <RecruitingFunnel stages={board.funnel.stages} />
      <DivisionBoardGrid divisions={board.divisions} />
      <HrbpEfficiencyGrid cards={board.hrbps} />
      <section className={styles.boardSection} aria-labelledby="dashboard-details-title">
        <SectionTitle eyebrow="Details" description="按事业部展开查看岗位级招聘进展">
          <span id="dashboard-details-title">全量岗位明细汇总</span>
        </SectionTitle>
        <PositionSummaryTable divisions={board.divisions} totals={board.totals} />
      </section>
    </div>
  );
}
