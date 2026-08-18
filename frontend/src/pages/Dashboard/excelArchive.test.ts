import { describe, expect, it } from 'vitest';
import { buildExcelArchiveGroups, formatExcelArchiveBytes, type DashboardExcelArchive } from './excelArchive';

describe('dashboard Excel archive helpers', () => {
  it('groups archived workbooks by snapshot date like Miaoda', () => {
    const files: DashboardExcelArchive[] = [
      { id: 'b', snapshot_date: '2026-08-16', file_name: 'b.xlsx', file_size: 2048, generated_at: '2026-08-16T10:00:00Z' },
      { id: 'a', snapshot_date: '2026-08-16', file_name: 'a.xlsx', file_size: 1024, generated_at: '2026-08-16T09:00:00Z' },
      { id: 'c', snapshot_date: '2026-08-15', file_name: 'c.xlsx', file_size: 512, generated_at: '2026-08-15T09:00:00Z' },
    ];
    const groups = buildExcelArchiveGroups(files);
    expect(groups.map((group) => group.date)).toEqual(['2026-08-16', '2026-08-15']);
    expect(groups[0].files.map((file) => file.id)).toEqual(['a', 'b']);
    expect(groups[0].totalSize).toBe(3072);
  });

  it('formats archive sizes for the history dialog', () => {
    expect(formatExcelArchiveBytes(0)).toBe('-');
    expect(formatExcelArchiveBytes(1024)).toBe('1.0 KB');
    expect(formatExcelArchiveBytes(1024 * 1024)).toBe('1.00 MB');
  });
});
