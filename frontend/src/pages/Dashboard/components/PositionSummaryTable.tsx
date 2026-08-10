import { useEffect, useMemo, useState } from 'react';
import { Table, Tag, Tooltip, type TableColumnsType } from 'antd';
import { TableViewport } from '../../../components/Responsive';
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

export function PositionSummaryTable({
  divisions,
  totals,
}: {
  divisions: DivisionBoard[];
  totals: BoardTotals;
}) {
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

  return (
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
}
