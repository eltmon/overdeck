/**
 * The Agents page Live view (PAN-4197 WI-5), the default at `/agents`: what is
 * running and progressing, what needs the operator, and what waits in the
 * pipeline — nothing finished. Data is the live scope of the agents directory
 * (`GET /api/agent-directory?scope=live`, polled every 5 s and refetched on
 * pane changes); each row's reason, section and tone come from live-model.ts
 * over real-time store facts, so activity text moves without waiting for a
 * poll.
 *
 * Two resizable panes (react-resizable-panels, layout saved under
 * `agents-live`): the sectioned list and a collapsible preview that shows the
 * selected agent's live transcript through DirectoryDetail. A click previews;
 * Open, Enter or a double-click navigates to the live pane (D10). The selected
 * entry lives in `?entry=` (replaceState).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { Group, Panel, Separator, useDefaultLayout, usePanelRef, type PanelSize } from 'react-resizable-panels';
import type { DirectoryEntry } from '@overdeck/contracts';

import { navigateToDecisionSubject } from '../../../lib/navigateToDecision';
import { useDashboardStore } from '../../../lib/store';
import { useSharedTick } from '../../../lib/useSharedTick';
import { DirectoryDetail } from '../directory/DirectoryDetail';
import { useAgentDirectory } from '../directory/useAgentDirectory';
import { guardedLayoutStorage } from '../panel-layout-storage';
import { LiveAgentRow, liveOpenTarget, liveRowDomId } from './LiveAgentRow';
import { buildLiveSections, type LiveFacts, type LiveRow } from './live-model';

export interface LiveCounts {
  live: number;
  needsYou: number;
  waiting: number;
}

export const LIVE_HISTORY_HREF = '/agents?view=history';

const SECTIONS = [
  { key: 'needsYou', id: 'needs-you', label: 'Needs you' },
  { key: 'live', id: 'live', label: 'Live' },
  { key: 'waiting', id: 'waiting', label: 'Waiting' },
] as const;

function readEntryParam(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('entry');
}

function writeEntryParam(entryId: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set('entry', entryId);
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

interface LiveAgentsViewProps {
  /** Section sizes for the page header's count line (FR-11). */
  onCountsChange?: (counts: LiveCounts) => void;
  /** Opens the History view; without it the History link navigates normally. */
  onShowHistory?: () => void;
}

export function LiveAgentsView({ onCountsChange, onShowHistory }: LiveAgentsViewProps) {
  const { data, isLoading, isError } = useAgentDirectory('live');
  const derivedByIssue = useDashboardStore((state) => state.derivedIssueStateByIssueId);
  const agentsById = useDashboardStore((state) => state.agentsById);
  const runtimeById = useDashboardStore((state) => state.agentRuntimeById);
  const now = useSharedTick();
  const [entryParam, setEntryParam] = useState<string | null>(readEntryParam);
  const [previewHidden, setPreviewHidden] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const previewRef = usePanelRef();
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: 'agents-live', storage: guardedLayoutStorage });

  const entries = useMemo(() => data?.entries ?? [], [data]);
  const entriesById = useMemo(() => new Map(entries.map((entry) => [entry.id, entry])), [entries]);
  const sections = useMemo(() => buildLiveSections(entries, (entry): LiveFacts => {
    const agent = agentsById[entry.id];
    const runtime = runtimeById?.[entry.id];
    return {
      derived: entry.issueId ? derivedByIssue[entry.issueId] : undefined,
      pendingInputKinds: agent?.pendingInputKinds,
      pendingQuestionPrompt: agent?.pendingQuestionPrompt ?? null,
      runtime: runtime ? { activity: runtime.activity, currentTool: runtime.currentTool, lastActivity: runtime.lastActivity } : undefined,
    };
  }, now), [entries, agentsById, runtimeById, derivedByIssue, now]);
  const rows = useMemo<LiveRow[]>(() => [...sections.needsYou, ...sections.live, ...sections.waiting], [sections]);

  const counts = useMemo<LiveCounts>(
    () => ({ live: sections.live.length, needsYou: sections.needsYou.length, waiting: sections.waiting.length }),
    [sections],
  );
  useEffect(() => {
    onCountsChange?.(counts);
  }, [counts, onCountsChange]);

  const selectedId = rows.some((row) => row.entry.id === entryParam) ? entryParam : rows[0]?.entry.id ?? null;
  const selectedEntry = selectedId ? entriesById.get(selectedId) ?? null : null;

  const select = useCallback((entryId: string) => {
    setEntryParam(entryId);
    writeEntryParam(entryId);
  }, []);

  const open = useCallback((entry: DirectoryEntry) => {
    navigateToDecisionSubject(liveOpenTarget(entry));
  }, []);

  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    const index = rows.findIndex((row) => row.entry.id === selectedId);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = rows[Math.min(rows.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)))];
      if (next) select(next.entry.id);
    } else if (event.key === 'Enter' && selectedEntry) {
      event.preventDefault();
      open(selectedEntry);
    }
  };

  const togglePreview = () => {
    const panel = previewRef.current;
    if (!panel) return;
    if (previewHidden) panel.expand();
    else panel.collapse();
    setPreviewHidden(!previewHidden);
  };

  // Dragging the preview below its minimum collapses it too; keep the button honest.
  const onPreviewResize = useCallback((size: PanelSize, _id: string | number | undefined, previous: PanelSize | undefined) => {
    if (previous === undefined) return;
    setPreviewHidden(size.asPercentage === 0);
  }, []);

  const onHistoryClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!onShowHistory) return;
    event.preventDefault();
    onShowHistory();
  };

  const empty = rows.length === 0;
  const status = isLoading ? 'Loading agents…' : isError ? 'The live agents could not be loaded.' : null;

  return (
    <div data-component="agents-live" className="flex h-full min-h-0 w-full flex-col">
      <div className="flex h-9 shrink-0 items-center justify-end border-b border-border px-3">
        <button
          type="button"
          data-testid="agents-live-preview-toggle"
          onClick={togglePreview}
          className="text-[12px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {previewHidden ? 'Show preview' : 'Hide preview'}
        </button>
      </div>
      <Group
        orientation="horizontal"
        defaultLayout={defaultLayout}
        onLayoutChanged={onLayoutChanged}
        id="agents-live"
        className="min-h-0 flex-1"
      >
        <Panel id="list" defaultSize="42%" minSize="28%" className="flex h-full min-w-0 flex-col overflow-hidden">
          <div
            ref={listRef}
            role="grid"
            aria-label="Live agents"
            aria-activedescendant={selectedId ? liveRowDomId(selectedId) : undefined}
            tabIndex={0}
            onKeyDown={onListKeyDown}
            className="min-h-0 flex-1 overflow-y-auto outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
          >
            {status && empty ? (
              <div className="px-4 py-8 text-center text-[12px] text-muted-foreground">{status}</div>
            ) : empty ? (
              <div data-component="agents-live-empty" className="px-4 py-8 text-center text-[12px] text-muted-foreground">
                Nothing is running or waiting. Finished work is in{' '}
                <a href={LIVE_HISTORY_HREF} onClick={onHistoryClick} className="text-primary hover:underline">History</a>.
              </div>
            ) : SECTIONS.map(({ key, id, label }) => {
              const sectionRows = sections[key];
              if (sectionRows.length === 0 && id !== 'live') return null;
              return (
                <div key={id} role="rowgroup" data-component="agents-live-section" data-section={id}>
                  <div role="row" className="sticky top-0 z-10 flex h-8 items-center gap-2 border-b border-border bg-card px-3">
                    <span role="rowheader" className="eyebrow text-foreground">{label}</span>
                    <span data-component="agents-live-count" className="font-mono-ui text-[11px] tabular-nums text-muted-foreground">
                      {sectionRows.length}
                    </span>
                  </div>
                  {sectionRows.length === 0 ? (
                    <div role="row" className="px-4 py-3 text-[12px] text-muted-foreground">
                      <span role="gridcell">Nothing running right now.</span>
                    </div>
                  ) : sectionRows.map((row) => (
                    <LiveAgentRow
                      key={row.entry.id}
                      row={row}
                      selected={row.entry.id === selectedId}
                      now={now}
                      onSelect={select}
                      onOpen={open}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        </Panel>
        <Separator className="w-px bg-border hover:bg-state-live" />
        <Panel
          id="preview"
          panelRef={previewRef}
          defaultSize="58%"
          minSize="25%"
          collapsible
          collapsedSize="0%"
          onResize={onPreviewResize}
          className="flex h-full min-w-0 flex-col overflow-hidden"
        >
          <div role="region" aria-label="Agent preview" className="min-h-0 flex-1 overflow-hidden">
            <DirectoryDetail entry={selectedEntry} entriesById={entriesById} onSelectEntry={select} />
          </div>
        </Panel>
      </Group>
    </div>
  );
}
