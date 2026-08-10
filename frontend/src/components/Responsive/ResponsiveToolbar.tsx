import type { ReactNode } from 'react';

export interface ResponsiveToolbarProps {
  children: ReactNode;
  actions?: ReactNode;
}

export function ResponsiveToolbar({ children, actions }: ResponsiveToolbarProps) {
  return (
    <div className="responsive-toolbar">
      <div className="responsive-toolbar__fields">{children}</div>
      {actions ? <div className="responsive-toolbar__actions">{actions}</div> : null}
    </div>
  );
}
