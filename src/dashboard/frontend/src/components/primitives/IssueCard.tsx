import { forwardRef, type ReactNode } from 'react';

import { cn } from '../../lib/utils';

export type IssueCardPriority = 0 | 1 | 2 | 3 | 4 | number;

export type IssueCardProps = {
  issueId: string;
  priority: IssueCardPriority;
  selected?: boolean;
  bulkSelected?: boolean;
  stuckCard?: boolean;
  mergeReadyCard?: boolean;
  runningCard?: boolean;
  unhealthyCard?: boolean;
  sessionLostCard?: boolean;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
  testId?: string;
};

const PRIORITY_ACCENT_CLASSES: Record<number, string> = {
  0: 'bg-border',
  1: 'bg-destructive',
  2: 'bg-warning',
  3: 'bg-muted-foreground',
  4: 'bg-border',
};

const IssueCard = forwardRef<HTMLDivElement, IssueCardProps>(function IssueCard({
  issueId,
  priority,
  selected = false,
  bulkSelected = false,
  stuckCard = false,
  mergeReadyCard = false,
  runningCard = false,
  unhealthyCard = false,
  sessionLostCard = false,
  onClick,
  children,
  className,
  testId,
}, ref) {
  const tone = unhealthyCard || stuckCard
    ? 'from-destructive/12 via-destructive/5 to-transparent'
    : mergeReadyCard
      ? 'from-warning/20 via-warning/6 to-transparent'
      : runningCard
        ? 'from-primary/16 via-primary/6 to-transparent'
        : 'from-surface-overlay/60 via-surface/40 to-transparent';
  const accent = unhealthyCard || stuckCard
    ? 'bg-destructive'
    : mergeReadyCard
      ? 'bg-warning'
      : runningCard
        ? 'bg-primary'
        : (PRIORITY_ACCENT_CLASSES[priority] || 'bg-muted-foreground');

  return (
    <div
      ref={ref}
      data-component="issue-card"
      data-issue-id={issueId}
      data-priority={priority}
      data-stuck-card={stuckCard ? 'true' : 'false'}
      data-merge-ready-card={mergeReadyCard ? 'true' : 'false'}
      data-testid={testId}
      onClick={onClick}
      className={cn(
        'group relative overflow-hidden rounded-2xl border cursor-pointer transition-all shadow-[0_6px_22px_rgba(0,0,0,0.08)] bg-[linear-gradient(145deg,var(--color-surface)_0%,rgba(255,255,255,0.03)_100%)]',
        sessionLostCard && 'border-warning/50',
        selected
          ? 'ring-2 ring-warning/70 shadow-[0_12px_30px_rgba(245,158,11,0.18)]'
          : unhealthyCard || stuckCard
            ? 'border-destructive/60 bg-destructive/[0.03] shadow-[0_10px_26px_rgba(239,68,68,0.14)]'
            : mergeReadyCard
              ? 'border-warning/60 bg-warning/[0.03] shadow-[0_10px_26px_rgba(245,158,11,0.14)]'
              : bulkSelected
                ? 'border-primary/50 bg-primary/[0.03] shadow-[0_6px_22px_rgba(0,0,0,0.08)]'
                : 'hover:-translate-y-0.5 border-border/70 hover:border-border hover:shadow-[0_12px_28px_rgba(0,0,0,0.12)]',
        className,
      )}
    >
      <div className={cn('pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-br', tone)} />
      <div className={cn('absolute inset-y-0 left-0 w-1.5', accent)} />
      {children}
    </div>
  );
});

export default IssueCard;
