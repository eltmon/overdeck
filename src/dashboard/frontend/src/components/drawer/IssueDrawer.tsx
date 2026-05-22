import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { COMMAND_DECK_SURFACE_REGISTRY } from '../../lib/commandDeckSurfaceRegistry';
import { useDashboardStore } from '../../lib/store';
import { cn } from '../../lib/utils';
import DrawerActionBar from './DrawerActionBar';
import DrawerActiveAgent from './DrawerActiveAgent';
import { DrawerAgentSession, pickDefaultDrawerAgent } from './DrawerAgentSession';
import DrawerActivityRail from './DrawerActivityRail';
import DrawerBeadsList from './DrawerBeadsList';
import DrawerReviewSpecialists from './DrawerReviewSpecialists';
import DrawerTabs from './DrawerTabs';
import DrawerVerificationGates from './DrawerVerificationGates';
import PhaseTimeline from './PhaseTimeline';
import { useDrawerData, type DrawerActivityPhase } from './useDrawerData';
import { VBriefViewer } from '../vbrief/VBriefViewer';
import type { VBriefDocument } from '../vbrief/types';

const ACTIVITY_PHASE_DOT_CLASSES = {
  work: 'bg-primary',
  review: 'bg-signal-review',
  ship: 'bg-warning',
  done: 'bg-success',
  info: 'bg-info',
} satisfies Record<DrawerActivityPhase, string>;

function formatActivityWhen(value: string) {
  if (!value) return 'just now';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function DrawerActivityPanel() {
  const { activityFull } = useDrawerData();
  return (
    <div data-testid="drawer-tab-panel-activity">
      {activityFull.length === 0 ? (
        <div className="rounded-[12px] border border-dashed border-border px-[12px] py-[18px] text-center text-[12px] text-muted-foreground">
          No activity yet.
        </div>
      ) : (
        <div className="space-y-[12px]">
          {activityFull.map((item) => (
            <div key={item.id} className="grid grid-cols-[14px_1fr] gap-[10px]" data-phase={item.phase}>
              <span
                aria-hidden="true"
                className={cn('mt-[4px] h-[8px] w-[8px] rounded-full', ACTIVITY_PHASE_DOT_CLASSES[item.phase])}
              />
              <div className="min-w-0">
                <div className="text-[12px] leading-[18px] text-foreground">{item.message}</div>
                <div className="mt-[2px] font-mono text-[10px] leading-none text-muted-foreground">{formatActivityWhen(item.when)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DrawerPlanPanel({ issueId }: { issueId: string }) {
  const { data, isLoading, isError } = useQuery<VBriefDocument | null>({
    queryKey: ['drawer-vbrief-plan', issueId],
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${issueId}/plan`);
      if (!res.ok) return null;
      return res.json() as Promise<VBriefDocument>;
    },
    retry: false,
  });

  return (
    <div data-testid="drawer-tab-panel-plan">
      {isLoading ? (
        <div className="text-[12px] text-muted-foreground">Loading plan…</div>
      ) : isError ? (
        <div className="text-[12px] text-muted-foreground">Failed to load plan</div>
      ) : (
        <VBriefViewer doc={data ?? null} />
      )}
    </div>
  );
}

void COMMAND_DECK_SURFACE_REGISTRY;

function tabLabel(tab: string) {
  return tab.replace(/-/g, ' ').replace(/\b\w/g, (match) => match.toUpperCase());
}

function DrawerTabPlaceholder({ tab }: { tab: string }) {
  return (
    <div data-testid={`drawer-tab-panel-${tab}`} className="rounded-[var(--radius)] border border-dashed border-border bg-card/60 p-[18px]">
      <div className="mb-[8px] text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        {tabLabel(tab)}
      </div>
      <p className="text-[13px] leading-6 text-muted-foreground">
        This drawer section will appear here as data streams in.
      </p>
    </div>
  );
}

export function IssueDrawer() {
  const drawer = useDashboardStore((state) => state.drawer);
  const closeIssue = useDashboardStore((state) => state.closeIssue);
  const syncDrawerFromUrl = useDashboardStore((state) => state.syncDrawerFromUrl);
  const { issue, agents } = useDrawerData();

  // Selected agent for the Conversation/Terminal tabs. Owned here so the choice
  // survives a Conversation ⇄ Terminal tab switch; falls back to the default
  // pick whenever the selection is cleared or no longer matches an agent.
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const effectiveAgentId = useMemo(() => {
    if (selectedAgentId && agents.some((agent) => agent.id === selectedAgentId)) {
      return selectedAgentId;
    }
    return pickDefaultDrawerAgent(agents)?.id ?? null;
  }, [selectedAgentId, agents]);

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
        <header className="flex h-[52px] items-center gap-[12px] border-b border-border px-[22px]">
          <div className="min-w-0 flex-1">
            <div className="truncate font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
              {drawer.issueId}
            </div>
            <h2 className="truncate font-display text-[22px] font-semibold leading-none tracking-[-0.01em] text-foreground">
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
        <DrawerTabs />
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_320px]">
          <div
            className={cn(
              'flex min-w-0 flex-col',
              drawer.tab === 'conversation' || drawer.tab === 'terminal'
                ? 'min-h-0 p-[14px]'
                : 'overflow-auto px-[22px] py-[18px]',
            )}
          >
            {drawer.tab === 'overview' ? (
              <div data-testid="drawer-tab-panel-overview" className="space-y-[14px]">
                <PhaseTimeline />
                <DrawerActiveAgent />
                <DrawerVerificationGates />
                <DrawerBeadsList />
                <DrawerReviewSpecialists />
              </div>
            ) : drawer.tab === 'beads' ? (
              <div data-testid="drawer-tab-panel-beads">
                <DrawerBeadsList />
              </div>
            ) : drawer.tab === 'plan' && drawer.issueId ? (
              <DrawerPlanPanel issueId={drawer.issueId} />
            ) : drawer.tab === 'activity' ? (
              <DrawerActivityPanel />
            ) : drawer.tab === 'conversation' ? (
              <DrawerAgentSession
                view="conversation"
                agents={agents}
                agentId={effectiveAgentId}
                onSelectAgent={setSelectedAgentId}
              />
            ) : drawer.tab === 'terminal' ? (
              <DrawerAgentSession
                view="terminal"
                agents={agents}
                agentId={effectiveAgentId}
                onSelectAgent={setSelectedAgentId}
              />
            ) : (
              <DrawerTabPlaceholder tab={drawer.tab} />
            )}
          </div>
          <DrawerActivityRail />
        </div>
        <DrawerActionBar />
      </aside>
    </div>
  );
}
