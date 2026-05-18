import type { ReactNode } from 'react';

import { cn } from '../../lib/utils';
import type { PhaseGlyphPhase } from './PhaseGlyph';

export type IssueCardPriority = 'urgent' | 'high' | 'medium' | 'low';

export type IssueCardProject = {
  name: ReactNode;
  markClassName?: string;
};

export type IssueCardAgent = {
  name?: ReactNode;
  sub?: ReactNode;
};

export type IssueCardBeads = {
  closed: number;
  total: number;
};

export type IssueCardProps = {
  issueId: string;
  phase: PhaseGlyphPhase;
  priority: IssueCardPriority;
  title: ReactNode;
  project?: IssueCardProject;
  labels?: ReactNode[];
  verbBadge?: ReactNode;
  agent?: IssueCardAgent;
  runtime?: ReactNode;
  assignee?: { name: string };
  beads?: IssueCardBeads;
  stuckCard?: boolean;
  mergeReadyCard?: boolean;
  onOpen?: (issueId: string) => void;
  className?: string;
};

const PRIORITY_BORDER_CLASSES = {
  urgent: 'before:bg-destructive',
  high: 'before:bg-warning',
  medium: 'before:bg-[rgb(255_255_255_/_22%)]',
  low: 'before:bg-transparent',
} satisfies Record<IssueCardPriority, string>;

const BEAD_PHASE_FILL_CLASSES = {
  todo: 'bg-muted-foreground',
  plan: 'bg-signal-review',
  work: 'bg-info',
  review: 'bg-warning',
  ship: 'bg-signal-review',
  done: 'bg-success',
} satisfies Record<PhaseGlyphPhase, string>;

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

export default function IssueCard({
  issueId,
  phase,
  priority,
  title,
  project,
  labels = [],
  verbBadge,
  agent,
  runtime,
  assignee,
  beads,
  stuckCard,
  mergeReadyCard,
  onOpen,
  className,
}: IssueCardProps) {
  const avatarName = assignee?.name ?? issueId;
  const avatarGradient = AVATAR_GRADIENT_CLASSES[hashString(avatarName) % AVATAR_GRADIENT_CLASSES.length];
  const hasAgent = Boolean(agent?.name);
  const beadPct = beads && beads.total > 0 ? Math.round((beads.closed / beads.total) * 100) : 0;

  const borderStyle: React.CSSProperties | undefined =
    stuckCard
      ? { borderColor: 'color-mix(in srgb, var(--destructive) 32%, transparent)' }
      : mergeReadyCard
        ? { borderColor: 'color-mix(in srgb, var(--success) 32%, transparent)' }
        : undefined;

  return (
    <button
      type="button"
      data-component="issue-card"
      data-issue-id={issueId}
      data-phase={phase}
      data-priority={priority}
      className={cn(
        'relative w-full rounded-[var(--radius-xl)] border border-border text-left transition-colors duration-200 hover:border-[rgb(255_255_255_/_14%)]',
        'p-[12px] pb-[10px]',
        'before:absolute before:bottom-[12px] before:left-[10px] before:top-[12px] before:w-[2px] before:rounded-[2px]',
        PRIORITY_BORDER_CLASSES[priority],
        className,
      )}
      style={{
        background: 'color-mix(in srgb, var(--background) 92%, white)',
        ...borderStyle,
      }}
      onClick={() => onOpen?.(issueId)}
    >
      {/* Row 1: project mark + ID + verb badge */}
      <span className="flex items-center gap-[6px]">
        {project && (
          <span className={cn('h-[8px] w-[8px] shrink-0 rounded-[2px] bg-muted', project.markClassName)} />
        )}
        <span className="shrink-0 font-mono text-[10px] leading-none tracking-[0.02em] text-muted-foreground">
          {issueId}
        </span>
        <span className="grow" />
        {verbBadge && <span className="shrink-0">{verbBadge}</span>}
      </span>

      {/* Title */}
      <span className="mt-[8px] block text-[13px] leading-[1.35] text-foreground line-clamp-2">
        {title}
      </span>

      {/* Labels */}
      {labels.length > 0 && (
        <span className="mt-[8px] flex flex-wrap items-center gap-[4px]">
          {labels.map((label, index) => (
            <span
              key={index}
              className="rounded-[var(--radius-sm)] border border-border bg-[rgb(255_255_255_/_5%)] px-[6px] py-[1px] text-[10px] font-medium leading-none text-muted-foreground"
            >
              {label}
            </span>
          ))}
        </span>
      )}

      {/* Bead progress */}
      {beads && beads.total > 0 && (
        <span className="mt-[10px] flex items-center gap-[8px]">
          <span className="shrink-0 font-mono text-[10px] leading-none text-muted-foreground">
            Beads {beads.closed}/{beads.total}
          </span>
          <span className="h-[3px] grow overflow-hidden rounded-[2px] bg-accent">
            <span
              className={cn('block h-full rounded-[2px]', BEAD_PHASE_FILL_CLASSES[phase])}
              style={{ width: `${beadPct}%` }}
            />
          </span>
        </span>
      )}

      {/* Foot */}
      <span className="mt-[8px] flex items-end gap-[8px] border-t border-border pt-[8px]">
        <span className="min-w-0 grow font-mono leading-none">
          <span
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
        {runtime && (
          <span className="shrink-0 font-mono text-[11px] leading-none text-muted-foreground [font-variant-numeric:tabular-nums]">
            {runtime}
          </span>
        )}
        <span
          className={cn(
            'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border border-border text-[8px] font-semibold leading-none text-white',
            avatarGradient,
          )}
        >
          {avatarInitials(avatarName)}
        </span>
      </span>
    </button>
  );
}
