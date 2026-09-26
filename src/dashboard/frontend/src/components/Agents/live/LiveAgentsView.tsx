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
 * selected agent's live transcript through DirectoryDetail. The page header
 * owns the preview toggle (`previewHidden` / `onPreviewHiddenChange`); without
 * those props the view keeps the state itself. A click previews; Open, Enter
 * or a double-click goes to the live pane (D10). The selected entry lives in
 * `?entry=` (replaceState). Rows with nothing nameable to wait on sit in a
 * collapsed Idle footer that the header does not count.
 */
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { Group, Panel, Separator, useDefaultLayout, usePanelRef, type PanelSize } from 'react-resizable-panels';
import type { DirectoryEntry } from '@overdeck/contracts';

import { useDashboardStore } from '../../../lib/store';
import { useSharedTick } from '../../../lib/useSharedTick';
import { DirectoryDetail } from '../directory/DirectoryDetail';
import { useAgentDirectory } from '../directory/useAgentDirectory';
import { PANEL_SEPARATOR_CLASS, guardedLayoutStorage } from '../panel-layout-storage';
import { LiveAgentRow, liveRowDomId, openLiveEntry } from './LiveAgentRow';
import { buildLiveSections, type LiveFacts, type LiveRow } from './live-model';

export interface LiveCounts {
  live: number;
  needsYou: number;
  waiting: number;
  idle: number;
}

export const LIVE_HISTORY_HREF = '/agents?view=history';
const IDLE_EXPANDED_KEY = 'pan-agents-live-idle-expanded';

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

function readIdleExpanded(): boolean {
  try {
    return window.localStorage.getItem(IDLE_EXPANDED_KEY) === '1';
  } catch {
    return false;
  }
}

function writeIdleExpanded(expanded: boolean): void {
  try {
    window.localStorage.setItem(IDLE_EXPANDED_KEY, expanded ? '1' : '0');
  } catch {
    // The choice just resets to collapsed next time.
  }
}

interface LiveAgentsViewProps {
  /** Section sizes for the page header's count line (FR-11). */
  onCountsChange?: (counts: LiveCounts) => void;
  /** Opens the History view; without it the History link navigates normally. */
  onShowHistory?: () => void;
  /** Whether the preview pane is collapsed, when the page header owns the toggle. */
  previewHidden?: boolean;
  /** Reports collapse from a drag below the minimum or a saved layout. */
  onPreviewHiddenChange?: (hidden: boolean) => void;
}

export function LiveAgentsView({ onCountsChange, onShowHistory, previewHidden: previewHiddenProp, onPreviewHiddenChange }: LiveAgentsViewProps) {
  const { data, isLoading, isError } = useAgentDirectory('live');
  const derivedByIssue = useDashboardStore((state) => state.derivedIssueStateByIssueId);
  const agentsById = useDashboardStore((state) => state.agentsById);
  const runtimeById = useDashboardStore((state) => state.agentRuntimeById);
  const now = useSharedTick();
  const [entryParam, setEntryParam] = useState<string | null>(readEntryParam);
  const [ownPreviewHidden, setOwnPreviewHidden] = useState(false);
  const [idleExpanded, setIdleExpanded] = useState(readIdleExpanded);
  const previewHidden = previewHiddenProp ?? ownPreviewHidden;
  const previewRef = usePanelRef();
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: 'agents-live', storage: guardedLayoutStorage });

  const entries = useMemo(() => data?.entries ?? [], [data]);
  const entriesById = useMemo(() => new Map(entries.map((entry) => [entry.id, entry])), [entries]);
  const sections = useMemo(() => buildLiveSections(entries, (entry): LiveFacts => {
    const agent = agentsById[entry.id];
    const runtime = runtimeById?.[entry.runtimeId ?? entry.id];
    return {
      derived: entry.issueId ? derivedByIssue[entry.issueId] : undefined,
      pendingInputKinds: agent?.pendingInputKinds,
      pendingQuestionPrompt: agent?.pendingQuestionPrompt ?? null,
      runtime: runtime
        ? {
            activity: runtime.activity,
            currentTool: runtime.currentTool,
            currentToolDescription: runtime.currentToolDescription,
            lastActivity: runtime.lastActivity,
          }
        : undefined,
    };
  }, now), [entries, agentsById, runtimeById, derivedByIssue, now]);
  const rows = useMemo<LiveRow[]>(
    () => [...sections.needsYou, ...sections.live, ...sections.waiting, ...(idleExpanded ? sections.idle : [])],
    [sections, idleExpanded],
  );

  const counts = useMemo<LiveCounts>(() => ({
    live: sections.live.length,
    needsYou: sections.needsYou.length,
    waiting: sections.waiting.length,
    idle: sections.idle.length,
  }), [sections]);
  useEffect(() => {
    onCountsChange?.(counts);
  }, [counts, onCountsChange]);

  const selectedRow = rows.find((row) => row.entry.id === entryParam) ?? rows[0] ?? null;
  const selectedId = selectedRow?.entry.id ?? null;
  // The preview header dates a live row the way the row does: from the runtime
  // snapshot, not the state file's stale lastActivity.
  const previewEntry = useMemo<DirectoryEntry | null>(() => {
    if (!selectedRow) return null;
    const { entry, reason, since } = selectedRow;
    return reason.section === 'live' && since ? { ...entry, lastActivityAt: since } : entry;
  }, [selectedRow]);

  const select = useCallback((entryId: string) => {
    setEntryParam(entryId);
    writeEntryParam(entryId);
  }, []);

  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    const index = rows.findIndex((row) => row.entry.id === selectedId);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = rows[Math.min(rows.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)))];
      if (next) select(next.entry.id);
    } else if (event.key === 'Enter' && selectedRow) {
      event.preventDefault();
      openLiveEntry(selectedRow.entry);
    }
  };

  // Follow the requested state: the header's toggle, or this view's own.
  useEffect(() => {
    const panel = previewRef.current;
    if (!panel) return;
    if (previewHidden && !panel.isCollapsed()) panel.collapse();
    else if (!previewHidden && panel.isCollapsed()) panel.expand();
  }, [previewHidden, previewRef]);

  // Dragging the preview below its minimum collapses it too, and a saved
  // layout can open it collapsed; keep the toggle honest in both cases.
  const onPreviewResize = useCallback((size: PanelSize) => {
    const hidden = size.asPercentage === 0;
    setOwnPreviewHidden(hidden);
    onPreviewHiddenChange?.(hidden);
  }, [onPreviewHiddenChange]);

  const toggleIdle = () => {
    setIdleExpanded((expanded) => {
      writeIdleExpanded(!expanded);
      return !expanded;
    });
  };

  const onHistoryClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!onShowHistory) return;
    event.preventDefault();
    onShowHistory();
  };

  const historyLink = (
    <a href={LIVE_HISTORY_HREF} onClick={onHistoryClick} className="text-muted-foreground underline underline-offset-2 hover:text-foreground">History</a>
  );
  const renderRows = (sectionRows: readonly LiveRow[]) => sectionRows.map((row) => (
    <LiveAgentRow
      key={row.entry.id}
      row={row}
      selected={row.entry.id === selectedId}
      now={now}
      onSelect={select}
      onOpen={openLiveEntry}
    />
  ));

  const status = isLoading ? 'Loading agents…' : isError ? 'The live agents could not be loaded.' : null;
  const showEmpty = rows.length === 0;

  const idleFooter = sections.idle.length > 0 && (
    <div role="rowgroup" data-component="agents-live-section" data-section="idle">
      <div role="row" className="flex h-8 items-center gap-1.5 border-b border-border px-3 text-[12px] text-muted-foreground">
        <span role="rowheader" className="contents">
          <button
            type="button"
            data-testid="agents-live-idle-toggle"
            aria-expanded={idleExpanded}
            onClick={toggleIdle}
            className="hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <span aria-hidden="true">{idleExpanded ? '▾' : '▸'}</span>{' '}
            <span className="font-mono-ui tabular-nums">{sections.idle.length}</span> idle {sections.idle.length === 1 ? 'session' : 'sessions'}
          </button>
          <span aria-hidden="true">·</span>
          {historyLink}
        </span>
      </div>
      {idleExpanded && renderRows(sections.idle)}
    </div>
  );

  if (showEmpty) {
    return (
      <div data-component="agents-live" className="flex h-full min-h-0 w-full flex-col overflow-y-auto">
        {status ? (
          <div className="px-4 py-8 text-center text-[12px] text-muted-foreground">{status}</div>
        ) : (
          <div data-component="agents-live-empty" className="px-4 py-8 text-center text-[12px] text-muted-foreground">
            Nothing is running or waiting. Finished work is in {historyLink}.
          </div>
        )}
        {idleFooter}
      </div>
    );
  }

  return (
    <div data-component="agents-live" className="flex h-full min-h-0 w-full flex-col">
      <Group
        orientation="horizontal"
        defaultLayout={defaultLayout}
        onLayoutChanged={onLayoutChanged}
        id="agents-live"
        className="min-h-0 flex-1"
      >
        <Panel id="list" defaultSize="42%" minSize="360px" className="flex h-full min-w-0 flex-col overflow-hidden">
          <div
            role="grid"
            aria-label="Live agents"
            aria-activedescendant={selectedId ? liveRowDomId(selectedId) : undefined}
            tabIndex={0}
            onKeyDown={onListKeyDown}
            className="min-h-0 flex-1 overflow-y-auto outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
          >
            {SECTIONS.map(({ key, id, label }) => {
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
                  ) : renderRows(sectionRows)}
                </div>
              );
            })}
            {idleFooter}
          </div>
        </Panel>
        <Separator className={PANEL_SEPARATOR_CLASS} />
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
            <DirectoryDetail entry={previewEntry} entriesById={entriesById} onSelectEntry={select} />
          </div>
        </Panel>
      </Group>
    </div>
  );
}
