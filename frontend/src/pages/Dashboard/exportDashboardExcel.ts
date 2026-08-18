import type { DashboardV3Board, DashboardV3Position } from './v3-types';
import { buildExcelBase64 } from '../../utils/exportExcel';

export const MIAODA_EXPORT_HEADERS = [
  '事业部',
  '岗位名称',
  '岗位类型',
  '城市',
  'HRBP',
  '招聘状态',
  '在招人数',
  '简历推送',
  '安排1面',
  '1面通过',
  '2面通过',
  '终面通过',
  '发放Offer',
  '入职数',
  '已耗时天数',
  '备注',
  '本周需完结',
] as const;

/** Column widths copied from the 2026-08-16 妙搭 workbook. */
export const MIAODA_EXPORT_COLUMN_WIDTHS = [18.83, 22.83, 14.83, 8.83, 16.83, 10.83, 8.83, 8.83, 8.83, 8.83, 8.83, 8.83, 8.83, 8.83, 10.83, 12.83, 8.83];

export type MiaodaExportRow = Record<(typeof MIAODA_EXPORT_HEADERS)[number], string | number>;

function exportPosition(position: DashboardV3Position): MiaodaExportRow {
  return {
    事业部: position.department || '未分配事业部',
    岗位名称: position.display_name || position.position_name,
    岗位类型: position.position_type || position.position_name,
    城市: position.city,
    HRBP: position.hrbps.join(' / '),
    招聘状态: position.status,
    在招人数: position.headcount,
    简历推送: position.resume_push,
    安排1面: position.first_scheduled,
    '1面通过': position.first_pass,
    '2面通过': position.second_pass,
    终面通过: position.final_pass,
    发放Offer: position.offers,
    入职数: position.hired,
    已耗时天数: position.elapsed_days,
    备注: position.notes,
    本周需完结: position.weekly_target,
  };
}

export function buildMiaodaExportRows(board: DashboardV3Board, positions?: DashboardV3Position[]): MiaodaExportRow[] {
  return (positions ?? [...board.positions, ...board.p2_positions]).map(exportPosition);
}

export function buildMiaodaWorkbookBase64(board: DashboardV3Board, positions?: DashboardV3Position[]): string {
  const rows = buildMiaodaExportRows(board, positions);
  return buildExcelBase64(rows, '招聘数据', MIAODA_EXPORT_COLUMN_WIDTHS);
}
