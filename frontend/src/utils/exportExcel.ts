import * as XLSX from 'xlsx';

/**
 * 将数据导出为 Excel 文件并触发下载
 */
export function downloadExcel(rows: Record<string, unknown>[], filename: string, sheetName = 'Sheet1', columnWidths?: number[]) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  
  // 自动列宽
  const colWidths = Object.keys(rows[0] || {}).map((key) => {
    const maxLen = Math.max(
      key.length,
      ...rows.map((row) => String(row[key] ?? '').length),
    );
    return { wch: Math.min(maxLen + 4, 40) };
  });
  ws['!cols'] = columnWidths?.length === Object.keys(rows[0] || {}).length
    ? columnWidths.map((wch) => ({ wch }))
    : colWidths;

  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbout], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
