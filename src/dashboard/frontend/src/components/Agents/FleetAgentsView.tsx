/**
 * The Agents page shell (PAN-4197 WI-6). `/agents` opens the Live view — what
 * is running, what needs the operator, what waits in the pipeline — and
 * `/agents?view=history` opens the Agents Directory (History), where finished
 * agents live. `?view=directory` is the old name for History; any other
 * `view` value opens Live. The Grid, Table and Timeline views are gone (D2).
 *
 * The header shows the Live view's section counts in the state-glyph
 * vocabulary (zero counts dimmed; a nonzero "need you" is the loudest thing on
 * the bar and scrolls to its section), the preview toggle, one link to the
 * other view, and Start agent when the page can navigate to the issues board.
 */
import { useCallback, useEffect, useState, type MouseEvent } from 'react';
import { PanelRightClose, PanelRightOpen } from 'lucide-react';

import { cn } from '../../lib/utils';
import Button from '../primitives/Button';
import TopBar from '../primitives/TopBar';
import { AgentsDirectory } from './directory/AgentsDirectory';
import { GLYPH_FONT, LIVE_GLYPH } from './live/LiveAgentRow';
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

function scrollToSection(section: string): void {
  document.querySelector(`[data-component="agents-live-section"][data-section="${section}"]`)?.scrollIntoView({ block: 'start' });
}

/** `● 6 live  ◐ 1 need you  ○ 3 waiting`, each glyph in its state tone. */
function LiveCountLine({ counts }: { counts: LiveCounts }) {
  const part = (key: string, glyph: string, tone: string, count: number, label: string) => (
    <span
      data-meta-part={key}
      className={cn('inline-flex items-baseline gap-1', count === 0 && 'opacity-50')}
    >
      <span aria-hidden="true" className={count === 0 ? undefined : tone} style={{ fontFamily: GLYPH_FONT }}>{glyph}</span>
      <span className="tabular-nums">{count}</span> {label}
    </span>
  );
  return (
    <span data-component="agents-meta" className="flex items-baseline gap-3 whitespace-nowrap">
      {part('live', LIVE_GLYPH.live, 'text-state-live', counts.live, 'live')}
      {counts.needsYou > 0 ? (
        <button
          type="button"
          data-meta-part="needs-you"
          onClick={() => scrollToSection('needs-you')}
          className="inline-flex items-baseline gap-1 font-medium text-state-needs-you hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <span aria-hidden="true" style={{ fontFamily: GLYPH_FONT }}>{LIVE_GLYPH['needs-you']}</span>
          <span className="tabular-nums">{counts.needsYou}</span> need you
        </button>
      ) : part('needs-you', LIVE_GLYPH['needs-you'], 'text-state-needs-you', 0, 'need you')}
      {part('waiting', LIVE_GLYPH.waiting, 'text-state-waiting', counts.waiting, 'waiting')}
    </span>
  );
}

export function FleetAgentsView({ onNavigateToIssues }: { onNavigateToIssues?: () => void } = {}) {
  const [viewMode, setViewMode] = useState<AgentsViewMode>(readViewMode);
  const [counts, setCounts] = useState<LiveCounts | null>(null);
  const [previewHidden, setPreviewHidden] = useState(false);

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

  const meta = viewMode === 'live' && counts && <LiveCountLine counts={counts} />;
  const PreviewIcon = previewHidden ? PanelRightOpen : PanelRightClose;

  return (
    <section data-component="fleet-agents-view" className="flex h-full w-full flex-col">
      <TopBar
        breadcrumb="Eltmon / Agents"
        meta={meta || undefined}
        actions={
          <div className="flex items-center gap-3">
            {viewMode === 'live' && (
              <button
                type="button"
                data-testid="agents-live-preview-toggle"
                aria-label={previewHidden ? 'Show preview' : 'Hide preview'}
                aria-pressed={!previewHidden}
                title={previewHidden ? 'Show preview' : 'Hide preview'}
                onClick={() => setPreviewHidden((hidden) => !hidden)}
                className="rounded-[var(--radius-sm)] p-1 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <PreviewIcon aria-hidden="true" className="h-4 w-4" />
              </button>
            )}
            <a
              href={viewHref(other)}
              data-testid="agents-view-link"
              onClick={onSwitchClick}
              className="whitespace-nowrap text-[12px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              {other === 'history' ? 'History' : 'Live'}
            </a>
            {onNavigateToIssues && (
              <Button size="sm" variant="ghost" className="shrink-0 whitespace-nowrap" onClick={onNavigateToIssues}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="mr-[6px]"><path d="M5 4 19 12 5 20Z" fill="currentColor" /></svg>
                Start agent
              </Button>
            )}
          </div>
        }
      />
      <div className="min-h-0 flex-1">
        {viewMode === 'live'
          ? (
            <LiveAgentsView
              onCountsChange={setCounts}
              onShowHistory={showHistory}
              previewHidden={previewHidden}
              onPreviewHiddenChange={setPreviewHidden}
            />
          )
          : <AgentsDirectory />}
      </div>
    </section>
  );
}
