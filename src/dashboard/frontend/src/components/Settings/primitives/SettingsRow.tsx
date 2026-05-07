import type { ReactNode } from 'react';
import { cn } from '../../../lib/utils';

export interface SettingsRowProps {
  label: string;
  description?: string;
  children: ReactNode;
  status?: ReactNode;
  vertical?: boolean;
  className?: string;
}

export function SettingsRow({
  label,
  description,
  children,
  status,
  vertical = false,
  className,
}: SettingsRowProps) {
  return (
    <div
      className={cn(
        'flex gap-4 px-4 py-3 rounded-lg border border-transparent hover:border-border hover:bg-card/50 transition-colors',
        vertical ? 'flex-col' : 'items-center justify-between',
        className
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-foreground text-sm font-medium">{label}</span>
          {status}
        </div>
        {description && (
          <p className="text-muted-foreground text-xs mt-0.5">{description}</p>
        )}
      </div>
      <div className={cn('flex items-center gap-2 shrink-0', vertical && 'w-full')}>
        {children}
      </div>
    </div>
  );
}
