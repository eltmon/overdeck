import { useEffect } from 'react';

import { ExternalLink } from 'lucide-react';
import { useDashboardStore } from '../../lib/store';
import { trackerIssueUrl } from '../../lib/issueLinks';
import DrawerActionBar from './DrawerActionBar';
import { IssueDetail, type IssueDetailTabId } from '../issue-detail/IssueDetail';
import { useDrawerData } from './useDrawerData';
import { IssueView } from '../issue-view/IssueView';

function taskBadge(tasks: ReturnType<typeof useDrawerData>['tasks']) {
  if (tasks.length === 0) return '0/0';
  const done = tasks.filter((task) => task.status === 'done').length;
  return `${done}/${tasks.length}`;
}

/**
 * The drawer frame: scrim + slide-over + header + the shared action bar.
 * The anatomy (tabs, phase rail, specialist strip, panes, status rail) is
 * `<IssueDetail density="drawer">` — the ONE issue-detail component (PAN-2908
 * C-DETAIL); this file owns only routing and frame chrome.
 */
export function IssueDrawer() {
  const drawer = useDashboardStore((state) => state.drawer);
  const closeIssue = useDashboardStore((state) => state.closeIssue);
  const setDrawerTab = useDashboardStore((state) => state.setDrawerTab);
  const syncDrawerFromUrl = useDashboardStore((state) => state.syncDrawerFromUrl);
  const { issue, agents, reviewStatus, tasks } = useDrawerData();

  useEffect(() => {
    syncDrawerFromUrl();
  }, [syncDrawerFromUrl]);

  useEffect(() => {
    if (!drawer.issueId) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeIssue();
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
        <header data-section="Header bar" className="flex h-[52px] items-center gap-[12px] border-b border-border px-[22px]">
          <div className="min-w-0 flex-1">
            <div className="truncate font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
              {drawer.issueId}
            </div>
            <h2 className="truncate font-display text-[22px] font-semibold leading-none tracking-[-0.01em] text-foreground">
              {issue?.title ?? 'Issue details'}
            </h2>
          </div>
          {(() => {
            // PAN-1610: one-click jump to the full issue on its tracker.
            const href = trackerIssueUrl(drawer.issueId ?? '', issue?.url);
            return href ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                title={`Open ${drawer.issueId} on its tracker`}
                className="inline-flex items-center gap-[6px] rounded-[var(--radius-sm)] border border-border px-[10px] py-[6px] text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <ExternalLink className="h-[14px] w-[14px]" />
                Issue
              </a>
            ) : null;
          })()}
          <button
            type="button"
            aria-label="Close issue drawer"
            className="rounded-[var(--radius-sm)] border border-border px-[10px] py-[6px] text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={closeIssue}
          >
            ×
          </button>
        </header>
        <IssueDetail
          issueId={drawer.issueId}
          density="drawer"
          agents={agents}
          reviewStatus={reviewStatus}
          tab={drawer.tab}
          onSelectTab={(tab: IssueDetailTabId) => setDrawerTab(tab)}
          tasksBadge={taskBadge(tasks)}
        />
        <div data-section="DrawerActionBar"><DrawerActionBar /></div>
        </IssueView>
      </aside>
    </div>
  );
}
