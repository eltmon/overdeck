/**
 * PAN-2908 · C-DETAIL — the specialist strip.
 *
 * When a phase runs a convoy (Review's four specialists today), the strip
 * lists every agent with its status, verdict, and last line — one click to
 * open THAT specialist's conversation. Presentational; the shell supplies
 * chips (see deriveSpecialists.ts) and the select handler.
 */
import { cn } from '../../lib/utils';

export type SpecialistStatus = 'running' | 'done' | 'queued' | 'failed';
export type SpecialistVerdict = 'APPROVED' | 'CHANGES_REQUESTED';

export interface SpecialistChip {
  /** Stable key, e.g. the role: 'security'. */
  id: string;
  /** Display name, e.g. 'review.security'. */
  name: string;
  status: SpecialistStatus;
  verdict?: SpecialistVerdict | null;
  /** One-line preview of the specialist's latest activity/verdict. */
  lastLine?: string;
  model?: string;
  /** True when this specialist has a conversation to open. */
  hasConversation?: boolean;
}

export interface SpecialistStripProps {
  specialists: SpecialistChip[];
  /** The chip whose conversation is currently open. */
  activeId?: string | null;
  onSelect?: (chip: SpecialistChip) => void;
  className?: string;
}

const DOT: Record<SpecialistStatus, string> = {
  running: 'bg-info animate-pulse',
  done: 'bg-success',
  queued: 'bg-muted-foreground/50',
  failed: 'bg-destructive',
};

const STATUS_LABEL: Record<SpecialistStatus, string> = {
  running: 'Running',
  done: 'Done',
  queued: 'Queued',
  failed: 'Failed',
};

export function SpecialistStrip({ specialists, activeId, onSelect, className }: SpecialistStripProps) {
  if (specialists.length === 0) return null;
  return (
    <div data-component="specialist-strip" className={cn('flex gap-1.5', className)}>
      {specialists.map((chip) => {
        const clickable = !!onSelect && chip.hasConversation !== false && chip.status !== 'queued';
        const verdictBadge = chip.verdict === 'APPROVED'
          ? <span className="rounded-sm border border-success/30 bg-success/10 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-success-foreground">Approved</span>
          : chip.verdict === 'CHANGES_REQUESTED'
            ? <span className="rounded-sm border border-destructive/30 bg-destructive/10 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-destructive-foreground">Changes</span>
            : <span className={cn(
                'rounded-sm border px-1.5 py-px text-[10px] font-medium uppercase tracking-wide',
                chip.status === 'running'
                  ? 'border-warning/30 bg-warning/10 text-warning-foreground'
                  : 'border-border text-muted-foreground',
              )}>{STATUS_LABEL[chip.status]}</span>;
        return (
          <button
            key={chip.id}
            type="button"
            data-specialist={chip.id}
            data-status={chip.status}
            disabled={!clickable}
            onClick={() => clickable && onSelect?.(chip)}
            className={cn(
              'grid min-w-0 flex-1 grid-cols-[auto_auto_1fr] items-center gap-x-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-left transition-colors',
              clickable && 'hover:border-foreground/15',
              activeId === chip.id && 'border-primary/45 bg-primary/5',
              !clickable && 'cursor-default opacity-80',
            )}
          >
            <span className={cn('h-2 w-2 rounded-full', DOT[chip.status])} />
            <span className="truncate font-mono text-[11px]">{chip.name}</span>
            <span className="justify-self-start">{verdictBadge}</span>
            {chip.lastLine && (
              <span className="col-span-full mt-0.5 truncate text-[10px] text-muted-foreground">{chip.lastLine}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
