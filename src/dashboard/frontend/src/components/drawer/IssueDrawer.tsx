import { useEffect } from 'react';

import { ExternalLink, X } from 'lucide-react';
import { useDashboardStore } from '../../lib/store';
import { trackerIssueUrl } from '../../lib/issueLinks';
import DrawerActionBar from './DrawerActionBar';
import { IssueDetail, type IssueDetailTabId } from '../issue-detail/IssueDetail';
import { useDrawerData } from './useDrawerData';
import { IssueView } from '../issue-view/IssueView';
import { IssueHeaderTitle } from '../issue-view/IssueHeaderTitle';
import { IssueCostChip, IssueStateBadge } from '../issue-view/IssueHeaderFacts';

function taskBadge(tasks: ReturnType<typeof useDrawerData>['tasks']) {
  if (tasks.length === 0) return '0/0';
  const done = tasks.filter((task) => task.status === 'done').length;
  return `${done}/${tasks.length}`;
}

/**
 * The drawer frame: scrim + slide-over + one-row header with the shared
 * action strip (PAN-5244). The anatomy (pipeline strip, tabs, panes) is
 * `<IssueDetail density="drawer">` — the ONE issue-detail component (PAN-2908
 * C-DETAIL); this file owns only routing and frame chrome.
 */
export function IssueDrawer() {
  const drawer = useDashboardStore((state) => state.drawer);
  const closeIssue = useDashboardStore((state) => state.closeIssue);
  const setDrawerTab = useDashboardStore((state) => state.setDrawerTab);
  const syncDrawerFromUrl = useDashboardStore((state) => state.syncDrawerFromUrl);
  const { issue, issueStatus, agents, derived, tasks } = useDrawerData();

  useEffect(() => {
    syncDrawerFromUrl();
  }, [syncDrawerFromUrl]);

  useEffect(() => {
    if (!drawer.issueId) return;

    const onKeyDown = (event: KeyboardEvent) => {
      // PAN-5244: a popover inside the drawer that handles Escape calls
      // preventDefault(); that Escape closes the popover, not the drawer.
      if (event.key === 'Escape' && !event.defaultPrevented) closeIssue();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeIssue, drawer.issueId]);

  useEffect(() => {
    if (!drawer.issueId) return;

    let rafId: number | null = null;
    let attempts = 0;
    const maxAttempts = 30;

    const tryScroll = () => {
      if (window.location.hash !== '#active-agent') return;
      const el = document.getElementById('active-agent');
      if (el) {
        el.scrollIntoView({ block: 'start' });
        return;
      }
      attempts++;
      if (attempts < maxAttempts) {
        rafId = window.requestAnimationFrame(tryScroll);
      }
    };

    const scrollToActive = () => {
      if (rafId) {
        window.cancelAnimationFrame(rafId);
        rafId = null;
      }
      attempts = 0;
      tryScroll();
    };

    scrollToActive();
    window.addEventListener('hashchange', scrollToActive);
    return () => {
      window.removeEventListener('hashchange', scrollToActive);
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [drawer.issueId]);

  if (!drawer.issueId) return null;

  return (
    <div
      data-component="issue-drawer"
      data-testid="issue-drawer-scrim"
      className="fixed inset-0 z-[100] flex justify-end bg-black/20 backdrop-blur-[2px]"
      onClick={closeIssue}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={issue ? `Issue ${issue.identifier}` : `Issue ${drawer.issueId}`}
        data-testid="issue-drawer"
        className="flex h-screen w-[min(980px,calc(100vw-48px))] max-w-[calc(100vw-48px)] origin-right scale-100 flex-col overflow-hidden border-l border-border bg-background opacity-100 shadow-[-24px_0_64px_rgb(0_0_0_/_40%)] animate-[issue-drawer-slide-in_200ms_ease-in-out]"
        onClick={(event) => event.stopPropagation()}
      >
        <IssueView issueId={drawer.issueId} density="console" className="contents">
        {/* No z-* class on the header or the strip: a z-index would make each
            its own stacking context, and an open popover's click-away overlay
            must cover the whole drawer, header included. */}
        <header data-section="Header bar" className="flex h-[46px] shrink-0 items-center gap-[10px] pl-[20px] pr-[16px]">
          <span className="shrink-0 font-mono-ui text-[12px] text-muted-foreground">{drawer.issueId}</span>
          <h2 title={issue?.title ?? undefined} className="min-w-0 flex-initial truncate font-display text-[15px] font-semibold leading-[1.3] tracking-[-0.012em] text-foreground">
            <IssueHeaderTitle issueId={drawer.issueId} title={issue?.title ?? null} status={issueStatus} />
          </h2>
          <IssueStateBadge issueId={drawer.issueId} agents={agents} trackerStatus={issue?.status} />
          <span className="flex-1" />
          <IssueCostChip issueId={drawer.issueId} />
          <div data-section="DrawerActionBar"><DrawerActionBar /></div>
          {(() => {
            // PAN-1610: one-click jump to the full issue on its tracker.
            const href = trackerIssueUrl(drawer.issueId ?? '', issue?.url ?? drawer.trackerUrl);
            return href ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                title={`Open ${drawer.issueId} on its tracker`}
                className="inline-flex h-[26px] shrink-0 items-center gap-[6px] rounded-[var(--radius)] border border-border px-[9px] text-[12px] font-medium text-body-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <ExternalLink className="h-[14px] w-[14px]" />
                Issue
              </a>
            ) : null;
          })()}
          <button
            type="button"
            aria-label="Close issue drawer"
            className="inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[var(--radius)] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={closeIssue}
          >
            <X aria-hidden className="h-[14px] w-[14px]" />
          </button>
        </header>
        <IssueDetail
          issueId={drawer.issueId}
          density="drawer"
          agents={agents}
          derived={derived}
          tab={drawer.tab}
          focusAgentId={drawer.agentId}
          onSelectTab={(tab: IssueDetailTabId) => setDrawerTab(tab)}
          tasksBadge={taskBadge(tasks)}
        />
        </IssueView>
      </aside>
    </div>
  );
}
