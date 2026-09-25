/**
 * One row of the Agents page Live view (PAN-4197 WI-5). The row carries one
 * colored signal (NFR-2): a 3px left rail, a glyph and the reason label, all
 * in the reason's state tone (--state-*). Everything else is foreground or
 * muted text. Line 2 says what a live agent is doing now (its last output
 * line, how long ago, and `quiet <age>` past five minutes) or what a waiting
 * row waits on and since when. Clicking selects (the preview pane shows it);
 * Open, Enter or a double-click navigates to the agent's live pane.
 */
import type { DirectoryEntry } from '@overdeck/contracts';

import { formatRelativeTime } from '../../../lib/formatRelativeTime';
import { decisionSubjectPath, type DecisionSubjectTarget } from '../../../lib/navigateToDecision';
import { useDashboardStore } from '../../../lib/store';
import { cn } from '../../../lib/utils';
import { rowTitle } from '../directory/DirectoryList';
import { LIVE_QUIET_AFTER_MS, lastOutputLine, type LiveRow, type LiveTone } from './live-model';

const RAIL: Record<LiveTone, string> = {
  live: 'bg-state-live',
  'needs-you': 'bg-state-needs-you',
  stuck: 'bg-state-stuck',
  waiting: 'bg-state-waiting',
};

const TEXT: Record<LiveTone, string> = {
  live: 'text-state-live',
  'needs-you': 'text-state-needs-you',
  stuck: 'text-state-stuck',
  waiting: 'text-state-waiting',
};

/** D9 glyphs, one per tone; aria-hidden, the reason label carries the meaning. */
const GLYPH: Record<LiveTone, string> = {
  live: '●',
  'needs-you': '◐',
  stuck: '✕',
  waiting: '○',
};

/** Geist has no ◐; a symbol-capable stack keeps every glyph full size. */
const GLYPH_FONT = 'ui-sans-serif, "DejaVu Sans", "Segoe UI Symbol", "Apple Symbols", sans-serif';

const EMPTY_LINES: readonly string[] = [];

export function liveRowDomId(entryId: string): string {
  return `agents-live-row-${entryId.replace(/[^A-Za-z0-9_-]/g, '_')}`;
}

/** Where Open sends the operator: a conversation's page, else the agent's issue. */
export function liveOpenTarget(entry: DirectoryEntry): DecisionSubjectTarget {
  if (entry.kind === 'conversation') return { id: entry.id.replace(/^conv:/, ''), source: 'conversation' };
  return { id: entry.id, source: 'agent', issueId: entry.issueId ?? undefined };
}

function ageOf(iso: string | null, now: Date): string {
  return formatRelativeTime(iso, now).replace(/ ago$/, '');
}

function secondLine(row: LiveRow, output: string | null, now: Date): string[] {
  const { reason, since } = row;
  if (reason.section !== 'live') {
    return [reason.detail, since ? `since ${ageOf(since, now)}` : null].filter((part): part is string => Boolean(part));
  }
  const parts = [output, since ? formatRelativeTime(since, now) : null];
  const at = since ? Date.parse(since) : Number.NaN;
  if (Number.isFinite(at) && now.getTime() - at > LIVE_QUIET_AFTER_MS) parts.push(`quiet ${ageOf(since, now)}`);
  return parts.filter((part): part is string => Boolean(part));
}

interface LiveAgentRowProps {
  row: LiveRow;
  selected: boolean;
  now: Date;
  onSelect: (entryId: string) => void;
  onOpen: (entry: DirectoryEntry) => void;
}

export function LiveAgentRow({ row, selected, now, onSelect, onOpen }: LiveAgentRowProps) {
  const { entry, reason, children } = row;
  const lines = useDashboardStore((state) => state.agentOutputById[entry.id] ?? EMPTY_LINES);
  const output = reason.section === 'live' ? lastOutputLine(lines) : null;
  const title = rowTitle(entry);
  const canOpen = decisionSubjectPath(liveOpenTarget(entry)) !== null;
  const line2 = secondLine(row, output, now);

  return (
    <div
      id={liveRowDomId(entry.id)}
      role="row"
      aria-selected={selected}
      data-component="agents-live-row"
      data-entry-id={entry.id}
      data-reason={reason.kind}
      data-tone={reason.tone}
      onClick={() => onSelect(entry.id)}
      onDoubleClick={() => onOpen(entry)}
      className={cn(
        'relative flex cursor-pointer items-start gap-2 border-b border-border/60 py-2 pl-4 pr-3 hover:bg-accent',
        selected && 'bg-accent',
      )}
    >
      <span aria-hidden="true" className={cn('absolute inset-y-0 left-0 w-[3px]', RAIL[reason.tone])} />
      <span
        aria-hidden="true"
        className={cn('w-3 shrink-0 text-[11px] leading-[18px]', TEXT[reason.tone], reason.tone === 'live' && 'pulse')}
        style={{ fontFamily: GLYPH_FONT }}
      >
        {GLYPH[reason.tone]}
      </span>
      <div role="gridcell" className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <span
            className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground"
            title={title ? `${entry.label} · ${title}` : entry.label}
          >
            {entry.label}
            {title && <span className="font-normal text-muted-foreground"> · {title}</span>}
          </span>
          <span data-component="agents-live-reason" className={cn('shrink-0 text-[12px]', TEXT[reason.tone])}>
            {reason.label}
          </span>
        </div>
        {line2.length > 0 && (
          <div data-component="agents-live-line" className="mt-0.5 truncate font-mono-ui text-[11px] text-muted-foreground" title={line2.join(' · ')}>
            {line2.join(' · ')}
          </div>
        )}
        {children.map((child) => (
          <div
            key={child.id}
            data-component="agents-live-subagent"
            data-entry-id={child.id}
            className="mt-0.5 truncate font-mono-ui text-[11px] text-muted-foreground"
            title={child.label}
          >
            ↳ {child.label}
          </div>
        ))}
      </div>
      {canOpen && (
        <button
          type="button"
          data-testid="agents-live-open"
          onClick={(event) => {
            event.stopPropagation();
            onOpen(entry);
          }}
          className="shrink-0 text-[12px] text-primary hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          Open
        </button>
      )}
    </div>
  );
}
