import { describe, expect, it } from 'vitest';
import {
  DASHBOARD_V3_SOURCE_STORAGE_KEY,
  readDashboardV3Source,
  writeDashboardV3Source,
} from './sourcePersistence';

function memoryStorage(initial?: Record<string, string>) {
  const values = new Map(Object.entries(initial || {}));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe('dashboard v3 source persistence', () => {
  it('keeps static as the safe default for a new browser', () => {
    expect(readDashboardV3Source(memoryStorage())).toBe('static');
  });

  it('restores Feishu after a successful sync', () => {
    const storage = memoryStorage();
    writeDashboardV3Source('feishu', storage);
    expect(storage.getItem(DASHBOARD_V3_SOURCE_STORAGE_KEY)).toBe('feishu');
    expect(readDashboardV3Source(storage)).toBe('feishu');
  });

  it('ignores unknown stored values', () => {
    expect(readDashboardV3Source(memoryStorage({ [DASHBOARD_V3_SOURCE_STORAGE_KEY]: 'unknown' }))).toBe('static');
  });
});
