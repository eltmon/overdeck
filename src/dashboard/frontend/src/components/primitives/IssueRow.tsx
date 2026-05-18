import type { ReactNode } from 'react';

import { cn } from '../../lib/utils';
import PhaseGlyph, { type PhaseGlyphPhase } from './PhaseGlyph';

export type IssueRowVariant = 'pipeline' | 'command-deck';
export type IssueRowPriority = 'urgent' | 'high' | 'medium' | 'low';

export type IssueRowProject = {
  name: ReactNode;
  markClassName?: string;
};

export type IssueRowAgent = {
  name?: ReactNode;
  sub?: ReactNode;
};

export type IssueRowLedger = {
  runtime?: ReactNode;
  cost?: ReactNode;
};

export type IssueRowAssignee = {
  name: string;
};

export type IssueRowProps = {
  issueId: string;
  phase: PhaseGlyphPhase;
  priority: IssueRowPriority;
  title: ReactNode;
  project?: IssueRowProject;
  labels?: ReactNode[];
  verbBadge?: ReactNode;
  agent?: IssueRowAgent;
  ledger?: IssueRowLedger;
  assignee?: IssueRowAssignee;
  variant?: IssueRowVariant;
  onOpen?: (issueId: string) => void;
  className?: string;
};

const GRID_TEMPLATES = {
  pipeline: '14px 78px 14px 1fr 220px 84px 30px',
  'command-deck': '14px 78px 14px 1fr 220px 84px 26px',
} satisfies Record<IssueRowVariant, string>;

const ROW_CLASSES = {
  pipeline: 'gap-[14px] py-[10px] pl-[18px] pr-[22px]',
  'command-deck': 'gap-[12px] py-[9px] pl-[18px] pr-[22px]',
} satisfies Record<IssueRowVariant, string>;

const PRIORITY_BORDER_CLASSES = {
  urgent: 'before:bg-destructive',
  high: 'before:bg-warning',
  medium: 'before:bg-[rgb(255_255_255_/_22%)]',
  low: 'before:bg-transparent',
} satisfies Record<IssueRowPriority, string>;

const AVATAR_GRADIENT_CLASSES = [
  'bg-[linear-gradient(135deg,#8b5cf6,#06b6d4)]',
  'bg-[linear-gradient(135deg,#f59e0b,#ef4444)]',
  'bg-[linear-gradient(135deg,#10b981,#06b6d4)]',
  'bg-[linear-gradient(135deg,#3b82f6,#8b5cf6)]',
  'bg-[linear-gradient(135deg,#ef4444,#f59e0b)]',
] as const;

function hashString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function avatarInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const source = parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : name.slice(0, 2);
  return source.toUpperCase();
}

export default function IssueRow({
  issueId,
  phase,
  priority,
  title,
  project,
  labels = [],
  verbBadge,
  agent,
  ledger,
  assignee,
  variant = 'pipeline',
  onOpen,
  className,
}: IssueRowProps) {
  const avatarName = assignee?.name ?? issueId;
  const avatarGradient = AVATAR_GRADIENT_CLASSES[hashString(avatarName) % AVATAR_GRADIENT_CLASSES.length];
  const hasLedger = Boolean(ledger?.runtime || ledger?.cost);
  const hasAgent = Boolean(agent?.name);

  return (
    <button
      type="button"
      data-component="issue-row"
      data-issue-id={issueId}
      data-phase={phase}
      data-priority={priority}
      data-variant={variant}
      className={cn(
        'relative grid w-full items-center border-b border-border text-left transition-colors duration-200 last:border-b-0 hover:bg-accent before:absolute before:bottom-[8px] before:left-[10px] before:top-[8px] before:w-[2px] before:rounded-[2px]',
        ROW_CLASSES[variant],
        PRIORITY_BORDER_CLASSES[priority],
        className,
      )}
      style={{ gridTemplateColumns: GRID_TEMPLATES[variant] }}
      onClick={() => onOpen?.(issueId)}
    >
      <span aria-hidden="true" />
      <span className="truncate font-mono text-[11px] leading-none tracking-[0.02em] text-muted-foreground">
        {issueId}
      </span>
      <PhaseGlyph phase={phase} />
      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-[8px]">
          <span className="truncate text-[13px] leading-none text-foreground">{title}</span>
          {verbBadge && <span className="shrink-0">{verbBadge}</span>}
        </span>
        <span className="mt-[7px] flex min-w-0 flex-wrap items-center gap-[6px] text-[11px] leading-none text-muted-foreground">
          {project && (
            <span className="inline-flex min-w-0 items-center gap-[6px]">
              <span className={cn('h-[14px] w-[14px] shrink-0 rounded-[3px] bg-muted', project.markClassName)} />
              <span className="truncate">{project.name}</span>
            </span>
          )}
          {project && labels.length > 0 && (
            <span className="h-[3px] w-[3px] rounded-full bg-muted-foreground/50" />
          )}
          {labels.map((label, index) => (
            <span
              key={index}
              className="rounded-[var(--radius-sm)] border border-border bg-muted px-[6px] py-[1px] text-[10px] font-medium leading-none text-muted-foreground"
            >
              {label}
            </span>
          ))}
        </span>
      </span>
      <span className="min-w-0 font-mono leading-none">
        <span
          data-component="issue-row-agent-name"
          className={cn(
            'block truncate text-[11px]',
            hasAgent ? 'text-foreground' : 'font-sans italic text-muted-foreground',
          )}
        >
          {agent?.name ?? 'Unassigned'}
        </span>
        <span className="mt-[3px] block truncate text-[10px] text-muted-foreground">
          {agent?.sub ?? '—'}
        </span>
      </span>
      <span
        data-component="issue-row-ledger"
        className={cn(
          'min-w-0 text-right font-mono leading-none [font-variant-numeric:tabular-nums]',
          !hasLedger && 'opacity-55',
        )}
      >
        <span className="block truncate text-[11px] text-muted-foreground">{ledger?.runtime ?? '—'}</span>
        <span className="mt-[2px] block truncate text-[10px] text-signal-cost-foreground">{ledger?.cost ?? '—'}</span>
      </span>
      <span
        data-component="issue-row-avatar"
        className={cn(
          'flex h-[22px] w-[22px] items-center justify-center rounded-full border border-border text-[9px] font-semibold leading-none text-white',
          avatarGradient,
        )}
      >
        {avatarInitials(avatarName)}
      </span>
    </button>
  );
}
