/**
 * One row of the Agents page Live view (PAN-4197 WI-5). The row carries one
 * colored signal (NFR-2): a 3px left rail, a glyph and the reason label, all
 * in the reason's state tone (--state-*). Everything else is foreground or
 * muted text, and Open stays neutral so blue keeps meaning "live".
 *
 * Line 1 names the work: the issue id and its title (the role only when it is
 * not `work`), or the conversation's label. Line 2 says why the row is here:
 * the reason, then what a live agent is doing now (its last output line,
 * streamed while the row is mounted) or what a waiting row waits on, then the
 * age, and `quiet <age>` in the stuck tone once a live agent has been silent
 * five minutes. Clicking selects (the preview pane shows it); Open, Enter or a
 * double-click goes to the agent's live pane or the conversation.
 */
import { useState } from 'react';

import type { DirectoryEntry } from '@overdeck/contracts';

import { useAgentOutputSubscription } from '../../../hooks/useAgentOutputSubscription';
import { formatRelativeTime } from '../../../lib/formatRelativeTime';
import { navigateToDecisionSubject } from '../../../lib/navigateToDecision';
import { usePanesStore } from '../../../lib/panesStore';
import { useDashboardStore } from '../../../lib/store';
import { cn } from '../../../lib/utils';
import { rowTitle } from '../directory/DirectoryList';
import { LANE_GLYPH, LIVE_QUIET_AFTER_MS, lastOutputLine, type LiveRow, type LiveTone } from './live-model';

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
export const LIVE_GLYPH: Record<LiveTone, string> = {
  live: '●',
  'needs-you': '◐',
  stuck: '✕',
  waiting: '○',
};

/** Geist has no ◐; a symbol-capable stack keeps every glyph full size. */
export const GLYPH_FONT = 'ui-sans-serif, "DejaVu Sans", "Segoe UI Symbol", "Apple Symbols", sans-serif';

/** PAN-4223: a lane's report badge, by the badge formula in the state tones. */
const LANE_REPORT_TONE: Record<'done' | 'blocked' | 'failed', string> = {
  done: 'badge-bg-state-done badge-border-state-done text-state-done',
  blocked: 'badge-bg-state-needs-you badge-border-state-needs-you text-state-needs-you',
  failed: 'badge-bg-state-stuck badge-border-state-stuck text-state-stuck',
};

/** Subagent lines shown under a row before `+N more`. Lane lines are never capped. */
export const LIVE_SUBAGENT_LINES = 3;

const EMPTY_LINES: readonly string[] = [];
const UNASSIGNED_PROJECT = 'unassigned';

export function liveRowDomId(entryId: string): string {
  return `agents-live-row-${entryId.replace(/[^A-Za-z0-9_-]/g, '_')}`;
}

/** Whether Open has somewhere to go: a conversation, or an agent with an issue. */
export function canOpenLiveEntry(entry: DirectoryEntry): boolean {
  return entry.kind === 'conversation' || (entry.kind !== 'subagent' && entry.issueId !== null);
}

/**
 * Open goes to the live thing itself: a conversation's page, or the agent's
 * session pane in its project's Command Deck (the same pane the rail tree
 * opens). An agent with no registered project falls back to its issue.
 */
export function openLiveEntry(entry: DirectoryEntry): void {
  if (entry.kind === 'conversation') {
    navigateToDecisionSubject({ id: entry.id.replace(/^conv:/, ''), source: 'conversation' });
    return;
  }
  if (!entry.issueId) return;
  if (entry.projectKey === UNASSIGNED_PROJECT) {
    navigateToDecisionSubject({ id: entry.id, source: 'agent', issueId: entry.issueId });
    return;
  }
  const panes = usePanesStore.getState();
  panes.ensureHome(entry.projectKey);
  const existing = (panes.panesByWorkspace[entry.projectKey] ?? [])
    .find((pane) => pane.paneType === 'agent' && pane.agentId === entry.id);
  if (existing) panes.setActivePane(entry.projectKey, existing.paneId);
  else {
    const role = entry.role ?? 'agent';
    panes.addPane(entry.projectKey, {
      paneType: 'agent',
      label: role.charAt(0).toUpperCase() + role.slice(1),
      agentId: entry.id,
      issueId: entry.issueId,
    });
  }
  const path = `/command-deck/${encodeURIComponent(entry.projectKey)}`;
  if (window.location.pathname !== path) window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function ageOf(iso: string | null, now: Date): string {
  return formatRelativeTime(iso, now).replace(/ ago$/, '');
}

function isQuiet(row: LiveRow, now: Date): boolean {
  if (row.reason.section !== 'live' || !row.since) return false;
  const at = Date.parse(row.since);
  return Number.isFinite(at) && now.getTime() - at > LIVE_QUIET_AFTER_MS;
}

/** Line 1: the issue id and title for an issue's agent, else the entry's label. */
function RowName({ entry }: { entry: DirectoryEntry }) {
  const title = rowTitle(entry);
  if (entry.kind === 'agent' && entry.issueId) {
    const role = entry.role && entry.role !== 'work' ? entry.role : null;
    return (
      <span className="min-w-0 flex-1 truncate text-[13px]" title={[entry.issueId, title, role].filter(Boolean).join(' · ')}>
        <span className="font-mono-ui text-[12px] font-medium text-foreground">{entry.issueId}</span>
        {title && <span className="text-muted-foreground"> {title}</span>}
        {role && <span className="text-[11px] text-muted-foreground"> · {role}</span>}
      </span>
    );
  }
  return (
    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground" title={entry.label}>
      {entry.label}
      {entry.continuesFrom !== undefined && (
        <a
          href={`/conv/${entry.continuesFrom}`}
          data-component="agents-live-continues"
          onClick={(event) => event.stopPropagation()}
          className="ml-2 text-[11px] font-normal text-muted-foreground hover:text-foreground hover:underline"
        >
          continues ← #{entry.continuesFrom}
        </a>
      )}
    </span>
  );
}

/** One lane child line: `↳ <glyph> <key> i<n> · <state> [REPORT]` (PAN-4223 FR-19). */
function LaneLine({ lane: child }: { lane: DirectoryEntry }) {
  const lane = child.lane!;
  return (
    <div
      data-component="agents-live-lane"
      data-entry-id={child.id}
      className="mt-0.5 flex min-w-0 items-baseline gap-1.5 font-mono-ui text-[11px] text-muted-foreground"
      title={child.label}
    >
      <span aria-hidden="true">↳</span>
      <span className="min-w-0 truncate">{`${LANE_GLYPH[lane.role] ?? '?'} ${lane.key} i${lane.iteration} · ${child.state}`}</span>
      {lane.reportStatus && (
        <span className={cn('shrink-0 border px-1 text-[9px] leading-[14px] tracking-wide', LANE_REPORT_TONE[lane.reportStatus])}>
          {lane.reportStatus.toUpperCase()}
        </span>
      )}
    </div>
  );
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
  const live = reason.section === 'live';
  useAgentOutputSubscription(entry.id, live && entry.kind === 'agent' && entry.location === 'local');
  const lines = useDashboardStore((state) => state.agentOutputById[entry.id] ?? EMPTY_LINES);
  const activity = live ? lastOutputLine(lines) : reason.detail;
  const age = row.since ? ageOf(row.since, now) : '';
  const quiet = isQuiet(row, now);
  const subagents = children.filter((child) => !child.lane);
  const lanes = children.filter((child) => child.lane);
  const [lanesOpen, setLanesOpen] = useState(true);
  const hiddenChildren = Math.max(0, subagents.length - LIVE_SUBAGENT_LINES);

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
        'group relative flex cursor-pointer items-start gap-2 border-b border-border/60 py-2 pl-4 pr-3 hover:bg-accent',
        selected && 'bg-accent',
      )}
    >
      <span aria-hidden="true" className={cn('absolute inset-y-0 left-0 w-[3px]', RAIL[reason.tone])} />
      <span
        aria-hidden="true"
        className={cn('w-3 shrink-0 text-[11px] leading-[18px]', TEXT[reason.tone], reason.tone === 'live' && 'pulse')}
        style={{ fontFamily: GLYPH_FONT }}
      >
        {LIVE_GLYPH[reason.tone]}
      </span>
      <div role="gridcell" className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <RowName entry={entry} />
          {canOpenLiveEntry(entry) && (
            <button
              type="button"
              data-testid="agents-live-open"
              onClick={(event) => {
                event.stopPropagation();
                onOpen(entry);
              }}
              className={cn(
                'shrink-0 text-[12px] text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100',
                'focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                selected && 'opacity-100',
              )}
            >
              Open
            </button>
          )}
        </div>
        <div data-component="agents-live-line" className="mt-0.5 flex min-w-0 items-baseline gap-1.5 text-[11px] text-muted-foreground">
          <span data-component="agents-live-reason" className={cn('shrink-0 text-[12px]', TEXT[reason.tone])}>
            {reason.label}
          </span>
          {activity && (
            <span data-component="agents-live-activity" className="min-w-0 truncate font-mono-ui" title={activity}>
              · {activity}
            </span>
          )}
          <span className="ml-auto flex shrink-0 items-baseline gap-1.5 pl-2 font-mono-ui tabular-nums" title={row.since ?? undefined}>
            {age && <span data-component="agents-live-age">{age}</span>}
            {quiet && <span data-component="agents-live-quiet" className="text-state-stuck">quiet {age}</span>}
          </span>
        </div>
        {subagents.slice(0, LIVE_SUBAGENT_LINES).map((child) => {
          const working = child.state === 'working';
          return (
            <div
              key={child.id}
              data-component="agents-live-subagent"
              data-entry-id={child.id}
              className="mt-0.5 flex min-w-0 items-baseline gap-1.5 font-mono-ui text-[11px] text-muted-foreground"
              title={child.label}
            >
              <span aria-hidden="true">↳</span>
              <span aria-hidden="true" className={working ? 'text-state-live' : undefined} style={{ fontFamily: GLYPH_FONT }}>
                {working ? LIVE_GLYPH.live : LIVE_GLYPH.waiting}
              </span>
              <span className="min-w-0 truncate">{child.label}</span>
            </div>
          );
        })}
        {hiddenChildren > 0 && (
          <div data-component="agents-live-subagent-more" className="mt-0.5 font-mono-ui text-[11px] text-muted-foreground">
            ↳ +{hiddenChildren} more
          </div>
        )}
        {lanes.length > 0 && (
          <button
            type="button"
            data-component="agents-live-lanes-toggle"
            aria-expanded={lanesOpen}
            onClick={(event) => {
              event.stopPropagation();
              setLanesOpen((open) => !open);
            }}
            className="mt-0.5 block font-mono-ui text-[11px] text-muted-foreground hover:text-foreground"
          >
            {`${lanesOpen ? '▾' : '▸'} ${lanes.length} ${lanes.length === 1 ? 'lane' : 'lanes'}`}
          </button>
        )}
        {lanesOpen && lanes.map((child) => <LaneLine key={child.id} lane={child} />)}
      </div>
    </div>
  );
}
