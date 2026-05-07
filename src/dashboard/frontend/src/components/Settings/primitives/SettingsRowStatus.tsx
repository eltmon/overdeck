import { cn } from '../../../lib/utils';

export type StatusVariant = 'success' | 'warning' | 'error' | 'neutral';

export interface SettingsRowStatusProps {
  variant: StatusVariant;
  label: string;
}

const variantStyles: Record<StatusVariant, string> = {
  success: 'bg-success/15 text-success border-success/25',
  warning: 'bg-warning/15 text-warning border-warning/25',
  error: 'bg-destructive/15 text-destructive border-destructive/25',
  neutral: 'bg-muted text-muted-foreground border-border',
};

export function SettingsRowStatus({ variant, label }: SettingsRowStatusProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border',
        variantStyles[variant]
      )}
    >
      {label}
    </span>
  );
}
