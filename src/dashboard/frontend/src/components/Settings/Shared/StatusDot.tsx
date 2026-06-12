import { cn } from '../../../lib/utils';

export interface StatusDotProps {
  status: 'connected' | 'disconnected' | 'testing';
  className?: string;
}

export function StatusDot({ status, className }: StatusDotProps) {
  const colorStyles = {
    connected: 'bg-success', // connection liveness is a verified outcome
    disconnected: 'bg-muted-foreground',
    testing: 'bg-info animate-pulse', // v1.2: machine activity = blue

  };

  return <span className={cn('inline-block size-1.5 rounded-full', colorStyles[status], className)} />;
}
