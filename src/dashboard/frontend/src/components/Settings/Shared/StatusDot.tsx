import { cn } from '../../../lib/utils';

export interface StatusDotProps {
  status: 'connected' | 'disconnected' | 'testing';
  className?: string;
}

export function StatusDot({ status, className }: StatusDotProps) {
  const colorStyles = {
    connected: 'bg-[#10b981]',
    disconnected: 'bg-slate-600',
    testing: 'bg-[#fbbf24] animate-pulse',
  };

  return <span className={cn('inline-block size-1.5 rounded-full', colorStyles[status], className)} />;
}
