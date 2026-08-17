import request from '../../utils/request';
import type { DashboardV3Board } from './v3-types';
import type { DashboardDataMode, DashboardSnapshotMeta, RecruitingBoard } from './types';

export async function fetchDashboardV3(
  mode: DashboardDataMode,
  snapshotDate?: string,
  responsiblePerson?: string,
): Promise<DashboardV3Board> {
  const params = mode === 'snapshot'
    ? { mode, snapshot_date: snapshotDate, ...(responsiblePerson ? { responsible_person: responsiblePerson } : {}) }
    : { mode, ...(responsiblePerson ? { responsible_person: responsiblePerson } : {}) };
  return request.get('/dashboard/recruiting-board-v3', { params }) as Promise<DashboardV3Board>;
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
