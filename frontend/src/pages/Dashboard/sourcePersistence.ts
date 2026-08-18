import type { DashboardV3Source } from './api';

export const DASHBOARD_V3_SOURCE_STORAGE_KEY = 'dashboard-v3-source';

type SourceStorage = Pick<Storage, 'getItem' | 'setItem'>;

function browserStorage(): SourceStorage | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * Keep the last explicitly selected/synchronized data source across a reload.
 * Static remains the safe default for existing users who have not synchronized
 * the new Feishu-backed dashboard yet.
 */
export function readDashboardV3Source(storage: SourceStorage | undefined = browserStorage()): DashboardV3Source {
  try {
    const value = storage?.getItem(DASHBOARD_V3_SOURCE_STORAGE_KEY);
    return value === 'feishu' ? 'feishu' : 'static';
  } catch {
    return 'static';
  }
}

export function writeDashboardV3Source(
  source: DashboardV3Source,
  storage: SourceStorage | undefined = browserStorage(),
): void {
  try {
    storage?.setItem(DASHBOARD_V3_SOURCE_STORAGE_KEY, source);
  } catch {
    // Storage can be unavailable in private browsing or hardened environments.
  }
}
