/**
 * The Agents page shell (PAN-4197 WI-6). `/agents` opens the Live view — what
 * is running, what needs the operator, what waits in the pipeline — and
 * `/agents?view=history` opens the Agents Directory (History), where finished
 * agents live. `?view=directory` is the old name for History; any other
 * `view` value opens Live. The Grid, Table and Timeline views are gone (D2).
 *
 * The header shows the Live view's section counts and one link to the other
 * view, plus Start agent when the page can navigate to the issues board.
 */
import { useCallback, useEffect, useState, type MouseEvent } from 'react';

import Button from '../primitives/Button';
import TopBar from '../primitives/TopBar';
import { AgentsDirectory } from './directory/AgentsDirectory';
import { LiveAgentsView, type LiveCounts } from './live/LiveAgentsView';

type AgentsViewMode = 'live' | 'history';

function readViewMode(): AgentsViewMode {
  if (typeof window === 'undefined') return 'live';
  const view = new URLSearchParams(window.location.search).get('view');
  return view === 'history' || view === 'directory' ? 'history' : 'live';
}

function viewHref(view: AgentsViewMode): string {
  if (typeof window === 'undefined') return view === 'history' ? '/agents?view=history' : '/agents';
  const url = new URL(window.location.href);
  if (view === 'history') url.searchParams.set('view', 'history');
  else url.searchParams.delete('view');
  return `${url.pathname}${url.search}${url.hash}`;
}

function replaceViewUrl(view: AgentsViewMode): void {
  if (typeof window === 'undefined') return;
  window.history.replaceState(null, '', viewHref(view));
}

export function FleetAgentsView({ onNavigateToIssues }: { onNavigateToIssues?: () => void } = {}) {
  const [viewMode, setViewMode] = useState<AgentsViewMode>(readViewMode);
  const [counts, setCounts] = useState<LiveCounts | null>(null);

  useEffect(() => {
    const onPopState = () => setViewMode(readViewMode());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const showView = useCallback((view: AgentsViewMode) => {
    setViewMode(view);
    replaceViewUrl(view);
  }, []);
  const showHistory = useCallback(() => showView('history'), [showView]);

  const other: AgentsViewMode = viewMode === 'live' ? 'history' : 'live';
  const onSwitchClick = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    showView(other);
  };

  const meta = viewMode === 'live' && counts && (
    <span data-component="agents-meta" className="block truncate whitespace-nowrap">
      {counts.live} live · {counts.needsYou} need you · {counts.waiting} waiting
    </span>
  );

  return (
    <section data-component="fleet-agents-view" className="flex h-full w-full flex-col">
      <TopBar
        breadcrumb="Eltmon / Agents"
        meta={meta || undefined}
        actions={
          <div className="flex items-center gap-3">
            <a
              href={viewHref(other)}
              data-testid="agents-view-link"
              onClick={onSwitchClick}
              className="whitespace-nowrap text-[12px] text-primary hover:underline"
            >
              {other === 'history' ? 'History' : 'Live'}
            </a>
            {onNavigateToIssues && (
              <Button size="sm" variant="primary" className="shrink-0 whitespace-nowrap" onClick={onNavigateToIssues}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="mr-[6px]"><path d="M5 4 19 12 5 20Z" fill="currentColor" /></svg>
                Start agent
              </Button>
            )}
          </div>
        }
      />
      <div className="min-h-0 flex-1">
        {viewMode === 'live'
          ? <LiveAgentsView onCountsChange={setCounts} onShowHistory={showHistory} />
          : <AgentsDirectory />}
      </div>
    </section>
  );
}
