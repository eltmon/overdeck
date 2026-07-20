/**
 * PAN-2908 · C-DETAIL — the ONE issue-detail component.
 *
 * `IssueDetail` owns the issue-detail anatomy every shell shares: the paused
 * banner, the tab strip, the phase rail + specialist strip (as the per-agent
 * conversation switcher via IssueDetailShell), the tab bodies, and the status
 * rail. Shells keep their frames (the drawer's scrim/header, the cockpit's
 * route chrome) and render this as the body.
 *
 * Densities:
 * - **drawer** — the full composition: tab strip + shell + tab bodies +
 *   320px status rail. This is exactly what IssueDrawer renders.
 * - **page** — the same composition at full route width with a wider
 *   360px status rail (the cockpit-route form). Adoption on
 *   `/command-deck/:project/:issue` is a product decision tracked in #2962.
 * - **rail** — compact inline expansion: shell + active conversation +
 *   one action strip. (Adoption in the deck tree's FeatureItem is tracked
 *   in #2962; the density is complete and tested here.)
 *
 * The cockpit's conversation access deliberately stays on its session-tree →
 * SessionPanel flow (test-enshrined); both surfaces share this component's
 * shell and the ConversationPanel transcript renderer.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import type { Agent } from '../../types';
import type { ReviewStatusSnapshot } from '@overdeck/contracts';
import { cn } from '../../lib/utils';
import { trackerIssueUrl } from '../../lib/issueLinks';
import { DrawerAgentSession, pickDefaultDrawerAgent } from '../drawer/DrawerAgentSession';
import DrawerActivityRail from '../drawer/DrawerActivityRail';
import DrawerArtifactsPanel from '../drawer/DrawerArtifactsPanel';
import { DrawerActivityPanel, DrawerPlanPanel } from '../drawer/DrawerSecondaryPanels';
import { TasksPanel } from '../TasksPanel';
import { VerificationGates } from '../issue-view/VerificationGates';
import { ActiveAgentPanel } from '../issue-view/ActiveAgentPanel';
import { PickupGateControls } from '../backlog/PickupGateControls';
import { IssueActionMenu } from '../IssueActionMenu';
import { UatEnvironmentPanel } from '../CommandDeck/UatEnvironmentPanel';
import { PanOpenInPicker } from '../PanOpenInPicker';
import type { WorkspaceInfo } from '../../lib/workspace-types';
import { IssueDetailShell } from './IssueDetailShell';
import { ChangedFilesView } from '../Stage/cockpit/ChangedFilesView';

export type IssueDetailDensity = 'drawer' | 'page' | 'rail';

export const ISSUE_DETAIL_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'plan', label: 'Plan map' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'conversation', label: 'Conversation' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'activity', label: 'Activity' },
  { id: 'files', label: 'Files' },
  { id: 'artifacts', label: 'Artifacts' },
] as const;

export type IssueDetailTabId = (typeof ISSUE_DETAIL_TABS)[number]['id'];

export interface IssueDetailProps {
  issueId: string;
  density: IssueDetailDensity;
  agents: Agent[];
  reviewStatus?: ReviewStatusSnapshot | undefined;
  /** Controlled tab (the drawer's store owns it). */
  tab: string;
  onSelectTab: (tab: IssueDetailTabId) => void;
  /** "3/13" badge on the Tasks tab. */
  tasksBadge?: string | undefined;
  className?: string;
}

function PickupSection({ issueId }: { issueId: string }) {
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

function useDrawerWorkspace(issueId: string) {
  return useQuery<WorkspaceInfo | null>({
    queryKey: ['drawer-workspace', issueId],
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${issueId}`);
      if (!res.ok) return null;
      return res.json() as Promise<WorkspaceInfo>;
    },
    retry: false,
  });
}

function WorkspaceSection({ issueId }: { issueId: string }) {
  const { data: workspace } = useDrawerWorkspace(issueId);

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

/** PAN-2908 C-DETAIL: the resources status facet for the always-visible right
 *  rail — workspace containers at a glance (names + health dots), same query
 *  as the Overview's Workspace section (shared cache, one fetch). */
function ResourcesFacet({ issueId }: { issueId: string }) {
  const { data: workspace } = useDrawerWorkspace(issueId);
  const containers = Object.entries(workspace?.containers ?? {});
  if (!workspace?.exists) return null;

  return (
    <div data-section="DrawerResourcesFacet" className="shrink-0 border-l border-border bg-card/70 px-[14px] py-[10px]">
      <div className="mb-[6px] text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Resources</div>
      {containers.length > 0 ? (
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {containers.map(([name, container]) => (
            <span
              key={name}
              className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
              title={`${name}: ${container.status ?? (container.running ? 'running' : 'stopped')}${container.uptime ? ` · up ${container.uptime}` : ''}`}
            >
              <span
                data-testid={`drawer-resource-dot-${name}`}
                className={cn(
                  'h-[7px] w-[7px] rounded-full',
                  container.running
                    ? container.health === 'unhealthy'
                      ? 'bg-destructive'
                      : 'bg-success'
                    : 'bg-muted-foreground/40',
                )}
              />
              <span className="font-mono">{name}</span>
            </span>
          ))}
        </div>
      ) : (
        <div className="text-[11px] text-muted-foreground">Workspace on disk — no containers running.</div>
      )}
    </div>
  );
}

function tabLabel(tab: string) {
  return tab.replace(/-/g, ' ').replace(/\b\w/g, (match) => match.toUpperCase());
}

function TabPlaceholder({ tab }: { tab: string }) {
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

/** PAN-1779: a pause gate must be unmissable — amber banner with the full
 * reason and a one-click Unpause. Amber = a human must act (style guide). */
function PausedBanner({ agents }: { agents: ReadonlyArray<{ id: string; paused?: boolean; pausedReason?: string }> }) {
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

function IssueDetailTabs({ tab, onSelectTab, tasksBadge }: {
  tab: string;
  onSelectTab: (tab: IssueDetailTabId) => void;
  tasksBadge?: string | undefined;
}) {
  return (
    <nav data-component="drawer-tabs" data-testid="drawer-tabs" className="border-b border-border bg-background/95 px-[14px]" role="tablist" aria-label="Issue drawer sections">
      <div className="flex min-w-0 items-center overflow-x-auto">
        {ISSUE_DETAIL_TABS.map((entry) => {
          const active = tab === entry.id;
          return (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`drawer-tab-${entry.id}`}
              className={cn(
                'relative flex shrink-0 items-center px-[14px] py-[10px] text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground',
                active && 'text-foreground',
              )}
              onClick={() => onSelectTab(entry.id)}
            >
              {entry.label}
              {entry.id === 'tasks' ? (
                <span data-testid="drawer-tab-tasks-count" className="ml-[6px] rounded-full bg-primary/15 px-[5px] py-[1px] font-mono text-[10px] leading-none text-primary">
                  {tasksBadge ?? '0/0'}
                </span>
              ) : null}
              {active ? <span data-testid="drawer-tab-active-underline" className="absolute bottom-0 left-[14px] right-[14px] h-[2px] bg-primary" /> : null}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export function IssueDetail({ issueId, density, agents, reviewStatus, tab, onSelectTab, tasksBadge, className }: IssueDetailProps) {
  // Selected agent for the Conversation/Terminal panes. Owned here so the
  // choice survives a Conversation ⇄ Terminal switch; falls back to the
  // default pick whenever the selection is cleared or no longer matches.
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const effectiveAgentId = useMemo(() => {
    if (selectedAgentId && agents.some((agent) => agent.id === selectedAgentId)) {
      return selectedAgentId;
    }
    return pickDefaultDrawerAgent(agents)?.id ?? null;
  }, [selectedAgentId, agents]);

  // C-DETAIL: the phase rail and specialist strip double as the per-agent
  // conversation switcher — click a phase/specialist, talk to it.
  const openAgentConversation = (agentId: string) => {
    setSelectedAgentId(agentId);
    onSelectTab('conversation');
  };

  const shell = (
    <IssueDetailShell
      issueId={issueId}
      agents={agents}
      reviewStatus={reviewStatus}
      activeAgentId={tab === 'conversation' ? effectiveAgentId : null}
      onOpenAgentConversation={openAgentConversation}
    />
  );

  const conversationPane = (
    <div data-section="DrawerAgentSession"><DrawerAgentSession
      view="conversation"
      agents={agents}
      agentId={effectiveAgentId}
      onSelectAgent={setSelectedAgentId}
      issueId={issueId}
    /></div>
  );

  if (density === 'rail') {
    // Compact inline expansion: rail + active conversation + one action strip.
    return (
      <div data-component="issue-detail" data-density="rail" className={className}>
        <div data-section="PhaseTimeline">{shell}</div>
        <div className="mt-2 h-[420px] min-h-0 overflow-hidden">{conversationPane}</div>
        <div className="mt-2" data-section="IssueDetailActionStrip">
          <IssueActionMenu issueId={issueId} mode="primary-strip" className="flex items-center gap-1" />
        </div>
      </div>
    );
  }

  return (
    <div data-component="issue-detail" data-density={density} className={cn('flex min-h-0 flex-1 flex-col', className)}>
      <div data-section="DrawerPausedBanner"><PausedBanner agents={agents} /></div>
      <div data-section="DrawerTabs"><IssueDetailTabs tab={tab} onSelectTab={onSelectTab} tasksBadge={tasksBadge} /></div>
      {/* PAN-2908 C-DETAIL: the ONE issue-detail anatomy (rail + strip as the
          per-agent conversation switcher), shared with the cockpit. */}
      <div data-section="PhaseTimeline" className="px-[22px] pt-[10px]">
        {shell}
      </div>
      <div className={cn('grid min-h-0 flex-1', density === 'page' ? 'grid-cols-[minmax(0,1fr)_360px]' : 'grid-cols-[minmax(0,1fr)_320px]')}>
        <div
          className={cn(
            'flex min-w-0 flex-col',
            tab === 'conversation' || tab === 'terminal'
              ? 'min-h-0 p-[14px]'
              : 'overflow-auto px-[22px] py-[18px]',
          )}
        >
          {tab === 'overview' ? (
            <div data-testid="drawer-tab-panel-overview" className="space-y-[14px]">
              <div data-section="DrawerPickupSection / PickupGateControls"><PickupSection issueId={issueId} /></div>
              <div data-section="DrawerWorkspaceSection"><WorkspaceSection issueId={issueId} /></div>
              <div data-section="UatEnvironmentPanel"><UatEnvironmentPanel issueId={issueId} /></div>
              <div data-section="DrawerActiveAgent"><ActiveAgentPanel agentId={effectiveAgentId ?? ''} density="console" /></div>
              <div data-section="DrawerTasksList"><TasksPanel issueId={issueId} /></div>
            </div>
          ) : tab === 'tasks' ? (
            <div data-testid="drawer-tab-panel-tasks" data-section="DrawerTasksList">
              <TasksPanel issueId={issueId} />
            </div>
          ) : tab === 'plan' ? (
            <div data-section="DrawerPlanPanel / XBriefViewer"><DrawerPlanPanel issueId={issueId} /></div>
          ) : tab === 'activity' ? (
            <div data-section="DrawerActivityRail / DrawerActivityPanel"><DrawerActivityPanel /></div>
          ) : tab === 'artifacts' ? (
            <div data-section="DrawerArtifactsPanel"><DrawerArtifactsPanel issueId={issueId} /></div>
          ) : tab === 'files' ? (
            // C-DETAIL binding tab set: Files is the changed-files tree + diff
            // (same component as the cockpit's Code tab), not a placeholder.
            <div data-testid="drawer-tab-panel-files" data-section="ChangedFilesView">
              <ChangedFilesView issueId={issueId} />
            </div>
          ) : tab === 'conversation' ? (
            conversationPane
          ) : tab === 'terminal' ? (
            <div data-section="DrawerAgentSession"><DrawerAgentSession
              view="terminal"
              agents={agents}
              agentId={effectiveAgentId}
              onSelectAgent={setSelectedAgentId}
              issueId={issueId}
            /></div>
          ) : (
            <TabPlaceholder tab={tab} />
          )}
        </div>
        <div data-section="DrawerActivityRail / DrawerActivityPanel" className="flex min-h-0 flex-col">
          {/* PAN-2908 C-DETAIL: status facets live in the always-visible right
              rail (gates above live activity) — consulted while steering,
              never a tab away. */}
          <div data-section="DrawerVerificationGates" className="shrink-0 border-l border-border bg-card/70 p-[10px]">
            <VerificationGates issueId={issueId} />
          </div>
          <ResourcesFacet issueId={issueId} />
          <div className="min-h-0 flex-1">
            <DrawerActivityRail />
          </div>
        </div>
      </div>
    </div>
  );
}
