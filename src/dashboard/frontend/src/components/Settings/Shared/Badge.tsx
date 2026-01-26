import { cn } from '../../../lib/utils';

export interface BadgeProps {
  variant: 'preset' | 'override';
  children: React.ReactNode;
  className?: string;
}

export function Badge({ variant, children, className }: BadgeProps) {
  const variantStyles = {
    preset: 'bg-[#3b82f6]/20 text-[#3b82f6]',
    override: 'bg-[#fbbf24]/20 text-[#fbbf24]',
  };

  return (
    <span className={cn('text-xs font-semibold px-2 py-1 rounded uppercase tracking-wider', variantStyles[variant], className)}>
      {children}
    </span>
  );
}
