import { useEffect, useMemo, useRef, useState } from 'react';
import { Table, Tag, Tooltip, type TableColumnsType } from 'antd';
import { TableViewport } from '../../../components/Responsive';
import { useResponsiveMode } from '../../../components/Responsive/responsiveMode';
import type { BoardPosition, BoardTotals, DivisionBoard } from '../types';
import styles from '../dashboard.module.css';

type DivisionTableRow = DivisionBoard & {
  key: string;
  kind: 'division';
};

type PositionTableRow = BoardPosition & {
  key: string;
  kind: 'position';
};

type TableRow = DivisionTableRow | PositionTableRow;

const priorityColors: Record<BoardPosition['priority'], string> = {
  P0: 'red',
  P1: 'orange',
  P2: 'blue',
};

function PipelineTag({ status }: { status: string }) {
  const color = status === '已完成'
    ? 'success'
    : status === '暂停'
      ? 'warning'
      : status === '已终止'
        ? 'default'
        : 'processing';
  return <Tag color={color}>{status || '招聘中'}</Tag>;
}

function getPassRate(firstInterview: number, thirdPass: number): number | null {
  if (firstInterview <= 0) return null;
  return Math.round(thirdPass / firstInterview * 1000) / 10;
}

function displayNumber(value: number | null | undefined): number | string {
  return value ?? '—';
}

function SummaryMetric({ label, value }: { label: string; value: number | string | null | undefined }) {
  return (
    <div className={styles.summaryCardMetric}>
      <span>{label}</span>
      <strong>{value ?? '—'}</strong>
    </div>
  );
}

export function PositionSummaryTable({
  divisions,
  totals,
  testWidth,
}: {
  divisions: DivisionBoard[];
  totals: BoardTotals;
  /** Test-only width override for responsive dashboard regression coverage. */
  testWidth?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mode = useResponsiveMode(containerRef, testWidth);
  const sortedDivisions = useMemo(
    () => [...divisions].sort((left, right) => left.division.localeCompare(right.division, 'zh-Hans-CN')),
    [divisions],
  );
  const divisionSignature = sortedDivisions.map((row) => row.division).join('\u0000');
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(sortedDivisions.slice(0, 1).map((row) => row.division)),
  );

  useEffect(() => {
    setExpanded((current) => {
      const validNames = new Set(sortedDivisions.map((row) => row.division));
      const retained = new Set([...current].filter((name) => validNames.has(name)));
      if (retained.size === 0 && sortedDivisions[0]) retained.add(sortedDivisions[0].division);
      return retained;
    });
  }, [divisionSignature, sortedDivisions]);

  const dataSource = useMemo<TableRow[]>(() => sortedDivisions.flatMap((division) => [
    { key: `division:${division.division}`, kind: 'division' as const, ...division },
    ...(expanded.has(division.division)
      ? division.positions.map((position) => ({
        key: `position:${position.position_id}`,
        kind: 'position' as const,
        ...position,
      }))
      : []),
  ]), [expanded, sortedDivisions]);

  const toggleDivision = (division: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(division)) next.delete(division);
      else next.add(division);
      return next;
    });
  };
  const [expandedPositions, setExpandedPositions] = useState<Set<string>>(() => new Set());

  const togglePosition = (positionId: string) => {
    setExpandedPositions((current) => {
      const next = new Set(current);
      if (next.has(positionId)) next.delete(positionId);
      else next.add(positionId);
      return next;
    });
  };

  const columns: TableColumnsType<TableRow> = [
    {
      title: '事业部 / 在招职位',
      key: 'position',
      width: 210,
      fixed: 'left',
      render: (_, row) => row.kind === 'division' ? (
        <button
          type="button"
          className={styles.expandButton}
          aria-expanded={expanded.has(row.division)}
          aria-label={`${expanded.has(row.division) ? '收起' : '展开'}${row.division}`}
          onClick={() => toggleDivision(row.division)}
        >
          <span aria-hidden="true">{expanded.has(row.division) ? '▼' : '▶'}</span>
          <span>{row.division}</span>
          <span className={styles.positionCount}>{row.positions.length} 个职位</span>
        </button>
      ) : (
        <span className={styles.positionName}>{row.position || '未命名职位'}</span>
      ),
    },
    {
      title: 'HRBP',
      key: 'hrbp',
      width: 130,
      render: (_, row) => row.kind === 'division' ? row.hrbps.join('、') || '—' : row.hrbp || '—',
    },
    {
      title: '优先级',
      key: 'priority',
      width: 78,
      align: 'center',
      render: (_, row) => row.kind === 'position'
        ? <Tag color={priorityColors[row.priority]}>{row.priority}</Tag>
        : '—',
    },
    { title: '在招人数', dataIndex: 'total_headcount', key: 'total_headcount', width: 88, align: 'center', render: (_, row) => row.kind === 'division' ? row.total_headcount : row.headcount },
    { title: '简历', dataIndex: 'total_resumes', key: 'total_resumes', width: 72, align: 'center' },
    { title: '一面', dataIndex: 'first_interview', key: 'first_interview', width: 68, align: 'center' },
    { title: '一面通过', dataIndex: 'first_pass', key: 'first_pass', width: 86, align: 'center' },
    { title: '二面通过', dataIndex: 'second_pass', key: 'second_pass', width: 86, align: 'center' },
    { title: '三面通过', dataIndex: 'third_pass', key: 'third_pass', width: 86, align: 'center' },
    {
      title: '通过率',
      key: 'interview_pass_rate',
      width: 78,
      align: 'center',
      render: (_, row) => {
        const rate = row.kind === 'division'
          ? row.interview_pass_rate
          : getPassRate(row.first_interview, row.third_pass);
        return rate == null ? '—' : `${rate}%`;
      },
    },
    { title: 'Offer', dataIndex: 'offers', key: 'offers', width: 70, align: 'center' },
    { title: '入职', dataIndex: 'hired', key: 'hired', width: 68, align: 'center' },
    {
      title: '备注',
      key: 'notes',
      width: 180,
      ellipsis: true,
      render: (_, row) => row.kind === 'position' && row.notes ? (
        <Tooltip title={row.notes} placement="topLeft">
          <span className={styles.noteText}>{row.notes}</span>
        </Tooltip>
      ) : '—',
    },
    {
      title: '状态',
      key: 'status',
      width: 94,
      align: 'center',
      fixed: 'right',
      render: (_, row) => row.kind === 'position' ? <PipelineTag status={row.status} /> : <Tag>汇总</Tag>,
    },
  ];

  const table = (
    <TableViewport>
      <Table<TableRow>
        className={styles.summaryTable}
        rowKey="key"
        size="small"
        columns={columns}
        dataSource={dataSource}
        pagination={false}
        scroll={{ x: 1460 }}
        rowClassName={(row) => row.kind === 'division' ? styles.divisionTableRow : styles.positionTableRow}
        locale={{ emptyText: '暂无岗位数据' }}
        summary={() => (
        <Table.Summary fixed>
          <Table.Summary.Row className={styles.totalRow}>
            <Table.Summary.Cell index={0}><strong>合计</strong></Table.Summary.Cell>
            <Table.Summary.Cell index={1}>—</Table.Summary.Cell>
            <Table.Summary.Cell index={2} align="center">—</Table.Summary.Cell>
            <Table.Summary.Cell index={3} align="center">{displayNumber(totals.total_headcount)}</Table.Summary.Cell>
            <Table.Summary.Cell index={4} align="center">{displayNumber(totals.total_resumes)}</Table.Summary.Cell>
            <Table.Summary.Cell index={5} align="center">{displayNumber(totals.first_interview)}</Table.Summary.Cell>
            <Table.Summary.Cell index={6} align="center">{displayNumber(totals.first_pass)}</Table.Summary.Cell>
            <Table.Summary.Cell index={7} align="center">{displayNumber(totals.second_pass)}</Table.Summary.Cell>
            <Table.Summary.Cell index={8} align="center">{displayNumber(totals.third_pass)}</Table.Summary.Cell>
            <Table.Summary.Cell index={9} align="center">{totals.interview_pass_rate == null ? '—' : `${totals.interview_pass_rate}%`}</Table.Summary.Cell>
            <Table.Summary.Cell index={10} align="center">{displayNumber(totals.offers)}</Table.Summary.Cell>
            <Table.Summary.Cell index={11} align="center">{displayNumber(totals.hired)}</Table.Summary.Cell>
            <Table.Summary.Cell index={12}>—</Table.Summary.Cell>
            <Table.Summary.Cell index={13} align="center"><Tag color="blue">全部</Tag></Table.Summary.Cell>
          </Table.Summary.Row>
        </Table.Summary>
        )}
      />
    </TableViewport>
  );

  const cards = (
    <section className={styles.summaryCardList} aria-label="全量岗位明细汇总">
      {sortedDivisions.map((division) => {
        const isExpanded = expanded.has(division.division);
        return (
          <article key={division.division} className={styles.divisionSummaryCard}>
            <div className={styles.divisionSummaryHeader}>
              <button
                type="button"
                className={styles.expandButton}
                aria-expanded={isExpanded}
                aria-label={`${isExpanded ? '收起' : '展开'}${division.division}`}
                onClick={() => toggleDivision(division.division)}
              >
                <span aria-hidden="true">{isExpanded ? '▼' : '▶'}</span>
                <span>{division.division}</span>
                <span className={styles.positionCount}>{division.positions.length} 个职位</span>
              </button>
              <span className={styles.divisionHrbps}>HRBP：{division.hrbps.join('、') || '—'}</span>
            </div>

            <div className={styles.summaryCardMetrics}>
              <SummaryMetric label="在招人数" value={division.total_headcount} />
              <SummaryMetric label="简历" value={division.total_resumes} />
              <SummaryMetric label="一面" value={division.first_interview} />
              <SummaryMetric label="一面通过" value={division.first_pass} />
              <SummaryMetric label="二面通过" value={division.second_pass} />
              <SummaryMetric label="三面通过" value={division.third_pass} />
              <SummaryMetric label="通过率" value={division.interview_pass_rate == null ? '—' : `${division.interview_pass_rate}%`} />
              <SummaryMetric label="Offer" value={division.offers} />
              <SummaryMetric label="入职" value={division.hired} />
            </div>

            {isExpanded && (
              <div className={styles.positionSummaryCards}>
                {division.positions.map((position) => {
                  const positionExpanded = expandedPositions.has(position.position_id);
                  const passRate = getPassRate(position.first_interview, position.third_pass);
                  return (
                    <article key={position.position_id} className={styles.positionSummaryCard}>
                      <div className={styles.positionSummaryHeader}>
                        <div>
                          <strong>{position.position || '未命名职位'}</strong>
                          <span>HRBP：{position.hrbp || '—'}</span>
                        </div>
                        <div className={styles.positionSummaryTags}>
                          <Tag color={priorityColors[position.priority]}>{position.priority}</Tag>
                          <PipelineTag status={position.status} />
                        </div>
                      </div>
                      <div className={styles.summaryCardMetrics}>
                        <SummaryMetric label="在招人数" value={position.headcount} />
                        <SummaryMetric label="简历" value={position.total_resumes} />
                        <SummaryMetric label="一面" value={position.first_interview} />
                        <SummaryMetric label="通过率" value={passRate == null ? '—' : `${passRate}%`} />
                        <SummaryMetric label="Offer" value={position.offers} />
                        <SummaryMetric label="入职" value={position.hired} />
                      </div>
                      <button
                        type="button"
                        className={styles.positionDetailsToggle}
                        aria-expanded={positionExpanded}
                        aria-label={`${positionExpanded ? '收起' : '展开'}${position.position || '未命名职位'}详情`}
                        onClick={() => togglePosition(position.position_id)}
                      >
                        {positionExpanded ? '收起详情' : '展开详情'}
                      </button>
                      {positionExpanded && (
                        <dl className={styles.positionDetailGrid}>
                          <div><dt>一面通过</dt><dd>{displayNumber(position.first_pass)}</dd></div>
                          <div><dt>二面通过</dt><dd>{displayNumber(position.second_pass)}</dd></div>
                          <div><dt>三面通过</dt><dd>{displayNumber(position.third_pass)}</dd></div>
                          <div><dt>AI 初筛</dt><dd>{displayNumber(position.ai_screened)}</dd></div>
                          <div className={styles.positionNotes}><dt>备注</dt><dd>{position.notes || '—'}</dd></div>
                        </dl>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </article>
        );
      })}

      <article className={`${styles.divisionSummaryCard} ${styles.totalSummaryCard}`} aria-label="合计">
        <div className={styles.divisionSummaryHeader}><strong>合计</strong><Tag color="blue">全部</Tag></div>
        <div className={styles.summaryCardMetrics}>
          <SummaryMetric label="在招人数" value={totals.total_headcount} />
          <SummaryMetric label="简历" value={totals.total_resumes} />
          <SummaryMetric label="一面" value={totals.first_interview} />
          <SummaryMetric label="一面通过" value={totals.first_pass} />
          <SummaryMetric label="二面通过" value={totals.second_pass} />
          <SummaryMetric label="三面通过" value={totals.third_pass} />
          <SummaryMetric label="通过率" value={totals.interview_pass_rate == null ? '—' : `${totals.interview_pass_rate}%`} />
          <SummaryMetric label="Offer" value={totals.offers} />
          <SummaryMetric label="入职" value={totals.hired} />
        </div>
      </article>
    </section>
  );

  return (
    <div ref={containerRef} data-responsive-mode={mode}>
      {mode === 'full' ? table : cards}
    </div>
  );
}
