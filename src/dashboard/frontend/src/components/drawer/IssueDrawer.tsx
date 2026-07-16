import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { ExternalLink } from 'lucide-react';
import { useDashboardStore } from '../../lib/store';
import { cn } from '../../lib/utils';
import { trackerIssueUrl } from '../../lib/issueLinks';
import { toast } from 'sonner';
import DrawerActionBar from './DrawerActionBar';
import { DrawerAgentSession, pickDefaultDrawerAgent } from './DrawerAgentSession';
import DrawerActivityRail from './DrawerActivityRail';
import DrawerArtifactsPanel from './DrawerArtifactsPanel';
import { TasksPanel } from '../TasksPanel';
import DrawerReviewSpecialists from './DrawerReviewSpecialists';
import DrawerTabs from './DrawerTabs';
import { VerificationGates } from '../issue-view/VerificationGates';
import { ActiveAgentPanel } from '../issue-view/ActiveAgentPanel';
import PhaseTimeline from './PhaseTimeline';
import { PickupGateControls } from '../backlog/PickupGateControls';
import { useDrawerData } from './useDrawerData';
import { DrawerActivityPanel, DrawerPlanPanel } from './DrawerSecondaryPanels';
import { PanOpenInPicker } from '../PanOpenInPicker';
import type { WorkspaceInfo } from '../../lib/workspace-types';
import { IssueView } from '../issue-view/IssueView';
import { UatEnvironmentPanel } from '../CommandDeck/UatEnvironmentPanel';

// PAN-2059: the backlog pickup controls (Plan → Release, AI objection, Ready /
// Park / Blocks-main, planning, pickup gate) on the issue overlay — the same
// shared component the cockpit and backlog drawer use.
function DrawerPickupSection({ issueId }: { issueId: string }) {
  return (
    <section data-testid="drawer-pickup-section" className="rounded-[var(--radius)] border border-border bg-card p-[14px]">
      <PickupGateControls
        issueId={issueId}
        onOpenIssueBrowser={(id) => {
          const href = trackerIssueUrl(id);
          if (href) window.open(href, '_blank', 'noopener,noreferrer');
        }}
      />
    </section>
  );
}

function DrawerWorkspaceSection({ issueId }: { issueId: string }) {
  const { data: workspace } = useQuery<WorkspaceInfo | null>({
    queryKey: ['drawer-workspace', issueId],
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${issueId}`);
      if (!res.ok) return null;
      return res.json() as Promise<WorkspaceInfo>;
    },
    retry: false,
  });

  if (!workspace?.exists || !workspace.path) return null;

  return (
    <section data-testid="drawer-workspace-section" className="rounded-[var(--radius)] border border-border bg-card p-[14px]">
      <div className="mb-[8px] text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Workspace</div>
      <div className="flex items-center justify-between gap-[12px]">
        <div className="min-w-0 truncate font-mono text-[11px] leading-[18px] text-muted-foreground" title={workspace.path}>
          {workspace.path}
        </div>
        <div className="shrink-0">
          <PanOpenInPicker openInCwd={workspace.path} />
        </div>
      </div>
    </section>
  );
}

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
        <div data-section="DrawerPausedBanner"><DrawerPausedBanner agents={agents} /></div>
        <div data-section="DrawerTabs"><DrawerTabs /></div>
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
                <div data-section="PhaseTimeline"><PhaseTimeline /></div>
                <div data-section="DrawerPickupSection / PickupGateControls"><DrawerPickupSection issueId={drawer.issueId} /></div>
                <div data-section="DrawerWorkspaceSection"><DrawerWorkspaceSection issueId={drawer.issueId} /></div>
                <div data-section="UatEnvironmentPanel"><UatEnvironmentPanel issueId={drawer.issueId} /></div>
                <div data-section="DrawerActiveAgent"><ActiveAgentPanel agentId={effectiveAgentId ?? ''} density="console" /></div>
                <div data-section="DrawerVerificationGates"><VerificationGates issueId={drawer.issueId} /></div>
                <div data-section="DrawerTasksList"><TasksPanel issueId={drawer.issueId} /></div>
                <div data-section="DrawerReviewSpecialists"><DrawerReviewSpecialists /></div>
              </div>
            ) : drawer.tab === 'tasks' ? (
              <div data-testid="drawer-tab-panel-tasks" data-section="DrawerTasksList">
                <TasksPanel issueId={drawer.issueId} />
              </div>
            ) : drawer.tab === 'plan' && drawer.issueId ? (
              <div data-section="DrawerPlanPanel / VBriefViewer"><DrawerPlanPanel issueId={drawer.issueId} /></div>
            ) : drawer.tab === 'activity' ? (
              <div data-section="DrawerActivityRail / DrawerActivityPanel"><DrawerActivityPanel /></div>
            ) : drawer.tab === 'artifacts' ? (
              <div data-section="DrawerArtifactsPanel"><DrawerArtifactsPanel issueId={drawer.issueId} /></div>
            ) : drawer.tab === 'conversation' ? (
              <div data-section="DrawerAgentSession"><DrawerAgentSession
                view="conversation"
                agents={agents}
                agentId={effectiveAgentId}
                onSelectAgent={setSelectedAgentId}
              /></div>
            ) : drawer.tab === 'terminal' ? (
              <div data-section="DrawerAgentSession"><DrawerAgentSession
                view="terminal"
                agents={agents}
                agentId={effectiveAgentId}
                onSelectAgent={setSelectedAgentId}
              /></div>
            ) : (
              <DrawerTabPlaceholder tab={drawer.tab} />
            )}
          </div>
          <div data-section="DrawerActivityRail / DrawerActivityPanel"><DrawerActivityRail /></div>
        </div>
        <div data-section="DrawerActionBar"><DrawerActionBar /></div>
        </IssueView>
      </aside>
    </div>
  );
}


/** PAN-1779: a pause gate must be unmissable on the issue slideout — amber
 * banner with the full reason (who paused it and the unpause condition) and a
 * one-click Unpause. Amber = a human must act (style guide v1.2). */
function DrawerPausedBanner({ agents }: { agents: ReadonlyArray<{ id: string; paused?: boolean; pausedReason?: string }> }) {
  const paused = agents.filter((agent) => agent.paused === true);
  if (paused.length === 0) return null;

  const unpause = async (agentId: string) => {
    try {
      const res = await fetch(`/api/agents/${agentId}/unpause`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) throw new Error(data.error || 'Failed to unpause agent');
      toast.success(`${agentId} unpaused — deacon resumes it on the next patrol`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to unpause agent');
    }
  };

  return (
    <div data-testid="drawer-paused-banner" className="space-y-[6px] border-b border-border px-[22px] py-[10px]">
      {paused.map((agent) => (
        <div
          key={agent.id}
          className="flex items-center gap-[10px] rounded-[var(--radius-sm)] border px-[12px] py-[8px] badge-border-warning badge-bg-warning"
        >
          <span className="text-[14px] leading-none text-warning-foreground">⏸</span>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium text-warning-foreground">
              <span className="font-mono">{agent.id}</span> is paused
            </div>
            {agent.pausedReason && (
              <div className="truncate text-[12px] text-warning-foreground/75" title={agent.pausedReason}>
                {agent.pausedReason}
              </div>
            )}
          </div>
          <button
            type="button"
            data-testid={`drawer-unpause-${agent.id}`}
            onClick={() => void unpause(agent.id)}
            className="inline-flex shrink-0 items-center gap-[4px] rounded-[var(--radius-sm)] border px-[10px] py-[5px] text-[12px] font-medium badge-border-warning text-warning-foreground transition-colors hover:bg-warning/20"
          >
            ▶ Unpause
          </button>
        </div>
      ))}
    </div>
  );
}
