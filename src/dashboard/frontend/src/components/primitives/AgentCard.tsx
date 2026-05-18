import type { ReactNode } from 'react';

import { cn } from '../../lib/utils';
import PhaseGlyph, { type PhaseGlyphPhase } from './PhaseGlyph';

export type AgentCardMetaItem = {
  label: string;
  value: ReactNode;
  variant?: 'default' | 'cost' | 'warn';
};

export type AgentCardIssue = {
  projectMarkClassName?: string;
  id: string;
  title: string;
};

export type AgentCardFooterAction = {
  label: string;
  variant: 'primary' | 'danger';
  onClick: () => void;
};

export type AgentCardProps = {
  name: string;
  phase: PhaseGlyphPhase;
  verbBadge?: ReactNode;
  stuck?: boolean;
  issue?: AgentCardIssue;
  meta?: AgentCardMetaItem[];
  streamExcerpt?: string;
  footerActions?: AgentCardFooterAction[];
  onMenuClick?: () => void;
  className?: string;
};

const PHASE_ACCENT_CLASSES = {
  todo: 'before:bg-muted-foreground',
  plan: 'before:bg-signal-review',
  work: 'before:bg-info',
  review: 'before:bg-warning',
  ship: 'before:bg-signal-review',
  done: 'before:bg-success',
} satisfies Record<PhaseGlyphPhase, string>;

function MenuIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
      <circle cx="5" cy="12" r="1" />
    </svg>
  );
}

export default function AgentCard({
  name,
  phase,
  verbBadge,
  stuck = false,
  issue,
  meta = [],
  streamExcerpt,
  footerActions = [],
  onMenuClick,
  className,
}: AgentCardProps) {
  const accentClass = PHASE_ACCENT_CLASSES[phase];

  return (
    <div
      data-component="agent-card"
      data-phase={phase}
      data-stuck={stuck ? 'true' : undefined}
      className={cn(
        'relative flex flex-col gap-[12px] rounded-[var(--radius-2xl)] border border-border bg-card p-[14px] transition-colors duration-200',
        'before:absolute before:left-0 before:top-[14px] before:bottom-[14px] before:w-[3px] before:rounded-[1.5px]',
        accentClass,
        stuck && 'border-[color-mix(in_srgb,var(--destructive)_32%,transparent)]',
        className,
      )}
    >
      {/* H1 row: phase dot + name + verb badge + menu button */}
      <div className="flex items-center gap-[8px]">
        <PhaseGlyph phase={phase} />
        <span className="min-w-0 flex-1 truncate font-mono text-[13px] leading-none text-foreground">
          {name}
        </span>
        {verbBadge && <span className="shrink-0">{verbBadge}</span>}
        <button
          type="button"
          onClick={onMenuClick}
          className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-muted-foreground transition-colors duration-200 hover:bg-accent hover:text-foreground"
          aria-label="Agent options"
        >
          <MenuIcon className="h-[14px] w-[14px]" />
        </button>
      </div>

      {/* Issue panel */}
      {issue && (
        <div className="rounded-[var(--radius-md)] border border-border bg-[rgb(0_0_0_/20%)] px-[12px] py-[10px]">
          <div className="flex items-start gap-[8px]">
            <span
              className={cn(
                'mt-[2px] h-[14px] w-[14px] shrink-0 rounded-[3px] bg-muted',
                issue.projectMarkClassName,
              )}
            />
            <div className="min-w-0 flex-1">
              <span className="block text-[12px] leading-[1.4] text-foreground line-clamp-2">
                <span className="font-mono text-muted-foreground">{issue.id}</span>
                <span className="mx-[6px] text-muted-foreground/50">·</span>
                {issue.title}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Meta tri-column */}
      {meta.length > 0 && (
        <div
          className="grid gap-[8px]"
          style={{ gridTemplateColumns: `repeat(${Math.min(meta.length, 3)}, 1fr)` }}
        >
          {meta.map((item, index) => (
            <div key={index} className="flex flex-col gap-[2px]">
              <span className="text-[9px] font-medium uppercase leading-none tracking-[0.05em] text-muted-foreground">
                {item.label}
              </span>
              <span
                className={cn(
                  'font-mono text-[11px] leading-none text-foreground [font-variant-numeric:tabular-nums]',
                  item.variant === 'cost' && 'text-signal-cost-foreground',
                  item.variant === 'warn' && 'text-warning-foreground',
                )}
              >
                {item.value}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Stream excerpt */}
      {streamExcerpt && (
        <div className="relative overflow-hidden rounded-[var(--radius-md)] border border-border bg-[rgb(0_0_0_/28%)] px-[10px] py-[8px]">
          <pre className="max-h-[84px] overflow-hidden font-mono text-[10.5px] leading-[1.55] text-foreground">
            {streamExcerpt}
          </pre>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute bottom-0 left-0 right-0 h-[24px] bg-gradient-to-t from-card to-transparent"
          />
        </div>
      )}

      {/* Stuck banner */}
      {stuck && (
        <div className="flex items-center rounded-[var(--radius-md)] border px-[10px] py-[6px] text-[11px] text-[var(--destructive-foreground)]"
          style={{
            background: 'color-mix(in srgb, var(--destructive) 8%, transparent)',
            borderColor: 'color-mix(in srgb, var(--destructive) 32%, transparent)',
          }}
        >
          Agent is stuck and requires attention
        </div>
      )}

      {/* Footer actions */}
      {footerActions.length > 0 && (
        <div className="flex flex-wrap gap-[6px] border-t border-border pt-[8px]">
          {footerActions.map((action, index) => (
            <button
              key={index}
              type="button"
              onClick={action.onClick}
              className={cn(
                'rounded-[var(--radius-md)] px-[8px] py-[4px] text-[11px] leading-none transition-colors duration-200 hover:bg-accent',
                index === 0 && 'ml-auto',
                action.variant === 'primary' && 'text-[var(--info-foreground)]',
                action.variant === 'danger' && 'text-[var(--destructive-foreground)]',
              )}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
