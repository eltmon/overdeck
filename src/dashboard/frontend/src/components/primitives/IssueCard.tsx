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
  const accent = unhealthyCard || stuckCard
    ? 'bg-destructive'
    : mergeReadyCard
      ? 'bg-success'
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
        'group relative overflow-hidden rounded-2xl border cursor-pointer issue-card-surface shadow-sm transition-all',
        sessionLostCard && 'border-warning/50',
        selected
          ? 'ring-2 ring-warning/70 shadow-lg'
          : unhealthyCard || stuckCard
            ? 'border-destructive/60 bg-destructive/10 shadow-md'
            : mergeReadyCard
              ? 'badge-border-success bg-success/10 shadow-md'
              : bulkSelected
                ? 'border-primary/50 bg-primary/10 shadow-sm'
                : 'hover:-translate-y-0.5 border-border/70 hover:border-border hover:shadow-md',
        className,
      )}
    >
      <div className={cn('absolute bottom-[12px] left-0 top-[12px] w-0.5 rounded-r-[2px]', accent)} />
      {children}
    </div>
  );
});

export default IssueCard;
