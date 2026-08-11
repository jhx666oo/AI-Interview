import { useEffect, useState, type RefObject } from 'react';

export type ResponsiveMode = 'full' | 'compact' | 'narrow';

export function getResponsiveMode(width: number): ResponsiveMode {
  if (width >= 1180) return 'full';
  if (width >= 760) return 'compact';
  return 'narrow';
}

export function useResponsiveMode(
  ref: RefObject<HTMLElement | null>,
  testWidth?: number,
): ResponsiveMode {
  const [mode, setMode] = useState<ResponsiveMode>(() =>
    testWidth === undefined ? 'full' : getResponsiveMode(testWidth),
  );

  useEffect(() => {
    if (testWidth !== undefined) {
      setMode(getResponsiveMode(testWidth));
      return;
    }

    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return;

    const updateMode = () => setMode(getResponsiveMode(element.clientWidth));
    const observer = new ResizeObserver(updateMode);

    updateMode();
    observer.observe(element);

    return () => observer.disconnect();
  }, [ref, testWidth]);

  return mode;
}
