export interface RefreshVersion {
  capture(): number;
  invalidate(): number;
  isCurrent(version: number): boolean;
}

export function createRefreshVersion(): RefreshVersion {
  let current = 0;
  return {
    capture: () => current,
    invalidate: () => ++current,
    isCurrent: (version) => version === current,
  };
}
