export interface DashboardExcelArchive {
  id: string;
  snapshot_date: string;
  file_type?: string;
  file_name: string;
  file_size: number;
  generated_at: string;
}

export interface DashboardExcelArchiveGroup {
  date: string;
  files: DashboardExcelArchive[];
  totalSize: number;
}

export function formatExcelArchiveBytes(bytes: number): string {
  if (bytes <= 0) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function buildExcelArchiveGroups(files: DashboardExcelArchive[]): DashboardExcelArchiveGroup[] {
  const grouped = new Map<string, DashboardExcelArchive[]>();
  files.forEach((file) => grouped.set(file.snapshot_date, [...(grouped.get(file.snapshot_date) || []), file]));
  return [...grouped.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([date, rows]) => ({
      date,
      files: [...rows].sort((left, right) => left.file_name.localeCompare(right.file_name)),
      totalSize: rows.reduce((sum, file) => sum + file.file_size, 0),
    }));
}
