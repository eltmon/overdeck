import { memo, type CSSProperties, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';

import { cn } from '../../lib/utils';
import VerbBadge, { type VerbBadgeProps } from './VerbBadge';

export type AgentCardRole = 'plan' | 'work' | 'review' | 'test' | 'ship' | 'flywheel';

export type AgentCardIssue = {
  id: string;
  title: ReactNode;
  project?: ReactNode;
  projectMarkClassName?: string;
};

export type AgentCardMeta = {
  label: ReactNode;
  value: ReactNode;
};

export type AgentCardProps = {
  id: string;
  name: ReactNode;
  role: AgentCardRole;
  issue?: AgentCardIssue;
  meta: [AgentCardMeta, AgentCardMeta, AgentCardMeta];
  streamLines?: string[];
  verbBadge: VerbBadgeProps;
  stuck?: boolean;
  stuckMessage?: ReactNode;
  onOpenIssue?: () => void;
  onStop?: () => void;
  className?: string;
};

const ROLE_ACCENTS = {
  plan: 'var(--signal-review)',
  work: 'var(--info)',
  review: 'var(--warning)',
  test: 'var(--success)',
  ship: 'var(--signal-cost)',
  flywheel: 'var(--primary)',
} satisfies Record<AgentCardRole, string>;

function AgentCard({
  id,
  name,
  role,
  issue,
  meta,
  streamLines = [],
  verbBadge,
  stuck = false,
  stuckMessage,
  onOpenIssue,
  onStop,
  className,
}: AgentCardProps) {
  const style = {
    '--agent-card-accent': ROLE_ACCENTS[role],
  } as CSSProperties;

  return (
    <article
      data-component="agent-card"
      data-agent-id={id}
      data-role={role}
      data-stuck={stuck ? 'true' : 'false'}
      className={cn(
        'relative overflow-hidden rounded-[18px] border border-border bg-card p-[16px] shadow-sm transition-colors before:absolute before:bottom-[16px] before:left-0 before:top-[16px] before:w-[3px] before:rounded-r-[3px] before:bg-[var(--agent-card-accent)] hover:border-primary/50',
        stuck && 'border-destructive/70 shadow-[0_0_0_1px_rgb(239_68_68_/_22%)]',
        className,
      )}
      style={style}
    >
      <div className="flex items-start justify-between gap-[12px] pl-[10px]">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-[8px]">
            <h3 className="truncate text-[13px] font-semibold leading-none text-foreground">{name}</h3>
            <VerbBadge {...verbBadge} />
          </div>
          <p className="mt-[6px] truncate font-mono text-[10px] leading-none text-muted-foreground">{id}</p>
        </div>
        <button
          type="button"
          aria-label={`Open ${id} menu`}
          className="rounded-[var(--radius-sm)] border border-border bg-muted p-[5px] text-muted-foreground transition-colors hover:text-foreground"
          onClick={(event) => event.stopPropagation()}
        >
          <MoreHorizontal className="h-[14px] w-[14px]" />
        </button>
      </div>

      {issue && (
        <div className="mt-[14px] rounded-[14px] border border-border bg-muted/40 p-[12px]">
          <div className="flex min-w-0 items-center gap-[7px] text-[10px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
            <span className={cn('h-[14px] w-[14px] shrink-0 rounded-[3px] bg-primary/70', issue.projectMarkClassName)} />
            <span className="truncate">{issue.project ?? 'Unassigned project'}</span>
            <span className="font-mono text-[10px] text-foreground">{issue.id}</span>
          </div>
          <div
            className="mt-[8px] overflow-hidden text-[13px] leading-[18px] text-foreground"
            style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}
          >
            {issue.title}
          </div>
        </div>
      )}

      <div className="mt-[14px] grid grid-cols-3 gap-[10px] pl-[10px]">
        {meta.map((item, index) => (
          <div key={index} className="min-w-0">
            <div className="text-[9px] font-medium uppercase tracking-[0.06em] text-muted-foreground">{item.label}</div>
            <div className="mt-[5px] truncate font-mono text-[11px] leading-none text-foreground">{item.value}</div>
          </div>
        ))}
      </div>

      <div className="relative mt-[14px] max-h-[84px] overflow-hidden rounded-[12px] border border-border bg-background/80 px-[12px] py-[10px] font-mono text-[10px] leading-[16px] text-muted-foreground after:pointer-events-none after:absolute after:bottom-0 after:left-0 after:h-[24px] after:w-full after:bg-gradient-to-b after:from-transparent after:to-card">
        {streamLines.length > 0 ? (
          streamLines.map((line, index) => <div key={index} className="truncate">{line}</div>)
        ) : (
          <div className="italic">No recent output</div>
        )}
      </div>

      {stuck && stuckMessage && (
        <div className="mt-[12px] rounded-[12px] border border-destructive/40 bg-destructive/10 px-[12px] py-[9px] text-[11px] text-destructive-foreground">
          {stuckMessage}
        </div>
      )}

      <div className="mt-[14px] flex items-center justify-end gap-[12px] text-[11px] font-medium">
        {issue && onOpenIssue && (
          <button type="button" className="text-info-foreground hover:underline" onClick={onOpenIssue}>
            Open issue
          </button>
        )}
        {onStop && (
          <button type="button" className="text-destructive-foreground hover:underline" onClick={onStop}>
            Stop
          </button>
        )}
      </div>
    </article>
  );
}

export default memo(AgentCard);
