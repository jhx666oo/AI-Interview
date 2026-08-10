import { useSyncExternalStore } from 'react';

export type LayoutMode = 'desktop' | 'compact' | 'mobile' | 'narrow';

export function getLayoutMode(width: number): LayoutMode {
  if (width >= 1200) return 'desktop';
  if (width >= 768) return 'compact';
  if (width >= 480) return 'mobile';
  return 'narrow';
}

const getWidth = () => (typeof window === 'undefined' ? 1440 : window.innerWidth);

const subscribe = (onStoreChange: () => void) => {
  window.addEventListener('resize', onStoreChange);
  return () => window.removeEventListener('resize', onStoreChange);
};

export function useViewportWidth(): number {
  return useSyncExternalStore(subscribe, getWidth, () => 1440);
}
