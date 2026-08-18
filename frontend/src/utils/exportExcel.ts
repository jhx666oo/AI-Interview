import * as XLSX from 'xlsx';

function arrayBufferToBase64(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value);
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, Math.min(index + chunkSize, bytes.length)));
  }
  return btoa(binary);
}

export function buildExcelBase64(
  rows: Record<string, unknown>[],
  sheetName = 'Sheet1',
  columnWidths?: number[],
): string {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const keys = Object.keys(rows[0] || {});
  const colWidths = keys.map((key) => {
    const maxLen = Math.max(key.length, ...rows.map((row) => String(row[key] ?? '').length));
    return { wch: Math.min(maxLen + 4, 40) };
  });
  ws['!cols'] = columnWidths?.length === keys.length
    ? columnWidths.map((wch) => ({ wch }))
    : colWidths;
  const output = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  return arrayBufferToBase64(output);
}

/**
 * 将数据导出为 Excel 文件并触发下载
 */
export function downloadExcel(rows: Record<string, unknown>[], filename: string, sheetName = 'Sheet1', columnWidths?: number[]) {
  const base64 = buildExcelBase64(rows, sheetName, columnWidths);
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const wbout = bytes.buffer;
  const blob = new Blob([wbout], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
