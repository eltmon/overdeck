import type { ReactNode } from 'react';
import { cn } from '../../../lib/utils';

export interface SettingsCardSectionProps {
  children: ReactNode;
  className?: string;
}

export function SettingsCardSection({ children, className }: SettingsCardSectionProps) {
  return (
    <div className={cn('bg-card border border-border rounded-lg p-4', className)}>
      {children}
    </div>
  );
}
