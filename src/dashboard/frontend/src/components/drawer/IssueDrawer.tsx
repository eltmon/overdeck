import { useEffect } from 'react';

import { useDashboardStore } from '../../lib/store';
import DrawerActionBar from './DrawerActionBar';
import DrawerActiveAgent from './DrawerActiveAgent';
import DrawerActivityRail from './DrawerActivityRail';
import DrawerBeadsList from './DrawerBeadsList';
import DrawerReviewSpecialists from './DrawerReviewSpecialists';
import DrawerVerificationGates from './DrawerVerificationGates';
import PhaseTimeline from './PhaseTimeline';
import { useDrawerData } from './useDrawerData';

export function IssueDrawer() {
  const drawer = useDashboardStore((state) => state.drawer);
  const closeIssue = useDashboardStore((state) => state.closeIssue);
  const syncDrawerFromUrl = useDashboardStore((state) => state.syncDrawerFromUrl);
  const { issue } = useDrawerData();

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
    if (!drawer.issueId || window.location.hash !== '#active-agent') return;

    const frame = window.requestAnimationFrame(() => {
      document.getElementById('active-agent')?.scrollIntoView({ block: 'start' });
    });
    return () => window.cancelAnimationFrame(frame);
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
        <header className="flex h-[52px] items-center gap-[12px] border-b border-border px-[22px]">
          <div className="min-w-0 flex-1">
            <div className="truncate font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
              {drawer.issueId}
            </div>
            <h2 className="truncate text-[18px] font-semibold leading-none text-foreground">
              {issue?.title ?? 'Issue details'}
            </h2>
          </div>
          <button
            type="button"
            aria-label="Close issue drawer"
            className="rounded-[var(--radius-sm)] border border-border px-[10px] py-[6px] text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={closeIssue}
          >
            ×
          </button>
        </header>
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 overflow-auto px-[22px] py-[18px]">
            <div className="space-y-[14px]">
              <div className="rounded-[var(--radius)] border border-border bg-card p-[18px]">
                <div className="mb-[8px] text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  {drawer.tab}
                </div>
                <p className="text-[13px] leading-6 text-muted-foreground">
                  Issue details will appear here as data streams in.
                </p>
              </div>
              <PhaseTimeline />
              <DrawerActiveAgent />
              <DrawerVerificationGates />
              <DrawerBeadsList />
              <DrawerReviewSpecialists />
            </div>
          </div>
          <DrawerActivityRail />
        </div>
        <DrawerActionBar />
      </aside>
    </div>
  );
}
