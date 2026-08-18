import request from '../../utils/request';
import type { DashboardV3Board } from './v3-types';
import type { DashboardDataMode, DashboardSnapshotMeta, RecruitingBoard } from './types';
import type { DashboardExcelArchive } from './excelArchive';

export type DashboardV3Source = 'static' | 'feishu';

export async function fetchDashboardV3(
  mode: DashboardDataMode,
  snapshotDate?: string,
  responsiblePerson?: string,
  source: DashboardV3Source = 'static',
): Promise<DashboardV3Board> {
  const params = mode === 'snapshot'
    ? { mode, snapshot_date: snapshotDate, source, ...(responsiblePerson ? { responsible_person: responsiblePerson } : {}) }
    : { mode, source, ...(responsiblePerson ? { responsible_person: responsiblePerson } : {}) };
  return request.get('/dashboard/recruiting-board-v3', { params }) as Promise<DashboardV3Board>;
}

export async function syncDashboardV3(): Promise<DashboardV3Board> {
  return request.post('/dashboard/recruiting-board-v3/sync', {}) as Promise<DashboardV3Board>;
}

export async function fetchDashboardLegacy(
  mode: DashboardDataMode,
  snapshotDate?: string,
  responsiblePerson?: string,
): Promise<RecruitingBoard> {
  const params = mode === 'snapshot'
    ? { mode, snapshot_date: snapshotDate, ...(responsiblePerson ? { responsible_person: responsiblePerson } : {}) }
    : { mode, ...(responsiblePerson ? { responsible_person: responsiblePerson } : {}) };
  return request.get('/dashboard/recruiting-board', { params }) as Promise<RecruitingBoard>;
}

export async function createDashboardV3Snapshot(): Promise<DashboardSnapshotMeta> {
  return request.post('/dashboard/snapshots-v3', {}) as Promise<DashboardSnapshotMeta>;
}

export async function listDashboardExcelArchives(): Promise<DashboardExcelArchive[]> {
  const result = await request.get('/dashboard/excel-archives') as { archives?: DashboardExcelArchive[] };
  return result.archives || [];
}

export async function createDashboardExcelArchive(payload: { snapshotDate: string; fileName: string; contentBase64: string; fileType?: string }): Promise<DashboardExcelArchive> {
  return request.post('/dashboard/excel-archives', {
    snapshot_date: payload.snapshotDate,
    file_type: payload.fileType || 'dashboard',
    file_name: payload.fileName,
    content_base64: payload.contentBase64,
  }) as Promise<DashboardExcelArchive>;
}

export async function downloadDashboardExcelArchive(id: string): Promise<Blob> {
  return request.get(`/dashboard/excel-archives/${encodeURIComponent(id)}/download`, { responseType: 'blob' }) as Promise<Blob>;
}
