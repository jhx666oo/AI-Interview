import type { ReactNode } from 'react';

export interface TableViewportProps {
  children: ReactNode;
  className?: string;
}

export function TableViewport({ children, className = '' }: TableViewportProps) {
  return <div className={`table-viewport ${className}`}>{children}</div>;
}
