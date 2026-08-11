import type { ReactNode } from 'react';

export interface TableViewportProps {
  children: ReactNode;
  className?: string;
  /**
   * Enables the scroll affordance for a responsive wide-table surface. It is
   * deliberately opt-in so ordinary modal tables and paginated tables keep
   * their existing layout.
   */
  showScrollHint?: boolean;
}

export function TableViewport({
  children,
  className = '',
  showScrollHint = false,
}: TableViewportProps) {
  return (
    <div
      className={[
        'table-viewport',
        showScrollHint && 'table-viewport--scroll-hint',
        className,
      ].filter(Boolean).join(' ')}
    >
      {children}
    </div>
  );
}
