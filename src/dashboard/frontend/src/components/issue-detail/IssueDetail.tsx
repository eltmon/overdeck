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
import { useEffect, useMemo, useState } from 'react';

import type { Agent } from '../../types';
import type { DerivedIssueState } from '../../types';
import { cn } from '../../lib/utils';
import { DrawerAgentSession, pickDefaultDrawerAgent } from '../drawer/DrawerAgentSession';
import DrawerActivityRail from '../drawer/DrawerActivityRail';
import DrawerArtifactsPanel from '../drawer/DrawerArtifactsPanel';
import { DrawerActivityPanel, DrawerPlanPanel } from '../drawer/DrawerSecondaryPanels';
import { TasksPanel } from '../TasksPanel';
import { VerificationGates } from '../issue-view/VerificationGates';
import { ActiveAgentPanel } from '../issue-view/ActiveAgentPanel';
import { IssueActionMenu } from '../IssueActionMenu';
import { UatEnvironmentPanel } from '../CommandDeck/UatEnvironmentPanel';
import { IssueDetailShell } from './IssueDetailShell';
import { PausedBanner, PickupSection, ResourcesFacet, WorkspaceSection } from './IssueDetailSections';
import { IssueSkillsSection } from '../skills/SkillOverridesSections';
import { ChangedFilesView } from '../Stage/cockpit/ChangedFilesView';

export type IssueDetailDensity = 'drawer' | 'page' | 'rail';

// PAN-5244: conversation first. Ids are stable (?tab= links); labels and order are not.
export const ISSUE_DETAIL_TABS = [
  { id: 'session', label: 'Conversation' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'plan', label: 'Plan map' },
  { id: 'files', label: 'Files' },
  { id: 'activity', label: 'Activity' },
  { id: 'artifacts', label: 'Artifacts' },
  { id: 'skills', label: 'Skills' },
  { id: 'overview', label: 'Details' },
] as const;

export type IssueDetailTabId =
  | (typeof ISSUE_DETAIL_TABS)[number]['id']
  | 'conversation'
  | 'terminal';

const SESSION_TAB_IDS = new Set<string>(['session', 'conversation', 'terminal']);
/** PAN-5244: tab ids no density shows yet (the Skills body lands with the drawer composition). */
const HIDDEN_SKILLS: ReadonlySet<string> = new Set(['skills']);

export interface IssueDetailProps {
  issueId: string;
  density: IssueDetailDensity;
  agents: Agent[];
  derived?: DerivedIssueState | undefined;
  /** Controlled tab (the drawer's store owns it). */
  tab: string;
  onSelectTab: (tab: IssueDetailTabId) => void;
  /** Agent to select in the Conversation/Terminal panes (the drawer's `?agent=` deep link). */
  focusAgentId?: string | undefined;
  /** "3/13" badge on the Tasks tab. */
  tasksBadge?: string | undefined;
  /** Conversation pane height in px (rail density). Default 420. */
  conversationHeight?: number | undefined;
  /** Render the tab strip? Default true. The cockpit's own nav drives the
   *  binding tabs, so it mounts the body without a second strip. */
  showTabs?: boolean | undefined;
  className?: string;
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

/** Tab count chip: a squared mono chip, never a pill. */
const TAB_COUNT_CHIP_CLASS = 'ml-[6px] rounded-[4px] border border-border px-[4px] font-mono-ui text-[10.5px] leading-[15px] text-muted-foreground';

function IssueDetailTabs({ tab, onSelectTab, tasksBadge, skillsBadge, hiddenTabIds }: {
  tab: string;
  onSelectTab: (tab: IssueDetailTabId) => void;
  tasksBadge?: string | undefined;
  /** Count of skill overrides for this issue; the chip shows only above zero. */
  skillsBadge?: number | null | undefined;
  /** Tab ids this density does not show. */
  hiddenTabIds?: ReadonlySet<string> | undefined;
}) {
  return (
    <nav data-component="drawer-tabs" data-testid="drawer-tabs" className="border-b border-border bg-background px-[12px]" role="tablist" aria-label="Issue drawer sections">
      <div className="flex min-w-0 items-center overflow-x-auto">
        {ISSUE_DETAIL_TABS.filter((entry) => !hiddenTabIds?.has(entry.id)).map((entry) => {
          const active = entry.id === 'session' ? SESSION_TAB_IDS.has(tab) : tab === entry.id;
          return (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`drawer-tab-${entry.id}`}
              className={cn(
                'relative flex shrink-0 items-center h-[34px] px-[10px] text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground',
                active && 'text-foreground',
              )}
              onClick={() => onSelectTab(
                entry.id === 'session'
                  ? tab === 'terminal' ? 'terminal' : 'conversation'
                  : entry.id,
              )}
            >
              {entry.label}
              {entry.id === 'tasks' ? (
                <span data-testid="drawer-tab-tasks-count" className={TAB_COUNT_CHIP_CLASS}>
                  {tasksBadge ?? '0/0'}
                </span>
              ) : null}
              {entry.id === 'skills' && typeof skillsBadge === 'number' && skillsBadge > 0 ? (
                <span data-testid="drawer-tab-skills-count" title="Skills changed for this issue" className={TAB_COUNT_CHIP_CLASS}>
                  {skillsBadge}
                </span>
              ) : null}
              {active ? <span data-testid="drawer-tab-active-underline" className="absolute bottom-0 left-[10px] right-[10px] h-[2px] bg-primary" /> : null}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export function IssueDetail({ issueId, density, agents, derived, tab, onSelectTab, focusAgentId, tasksBadge, conversationHeight = 420, showTabs = true, className }: IssueDetailProps) {
  // Selected agent for the Conversation/Terminal panes. Owned here so the
  // choice survives a Conversation ⇄ Terminal switch; falls back to the
  // default pick whenever the selection is cleared or no longer matches.
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(focusAgentId ?? null);
  useEffect(() => {
    if (focusAgentId) setSelectedAgentId(focusAgentId);
  }, [focusAgentId]);
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
      derived={derived}
      activeAgentId={tab === 'conversation' || tab === 'session' ? effectiveAgentId : null}
      onOpenAgentConversation={openAgentConversation}
    />
  );

  const sessionPane = (
    view: 'conversation' | 'terminal',
    onChangeView?: (view: 'conversation' | 'terminal') => void,
  ) => (
    // The wrapper must be a constrained flex column (min-h-0 + flex-1): as a
    // plain block div its min-height:auto content floor blew out the grid
    // cell, so MessagesTimeline's overflow-y:auto never engaged and the
    // drawer conversation could not scroll (clipped by the drawer aside).
    <div data-section="DrawerAgentSession" className="flex min-h-0 flex-1 flex-col"><DrawerAgentSession
      view={view}
      agents={agents}
      agentId={effectiveAgentId}
      onSelectAgent={setSelectedAgentId}
      onChangeView={onChangeView}
      issueId={issueId}
    /></div>
  );
  const conversationPane = sessionPane('conversation');

  if (density === 'rail') {
    // Compact inline expansion: rail + active conversation + one action strip.
    return (
      <div data-component="issue-detail" data-density="rail" className={className}>
        <div data-section="PhaseTimeline">{shell}</div>
        <div className="mt-2 min-h-0 overflow-hidden" style={{ height: conversationHeight }}>{conversationPane}</div>
        <div className="mt-2" data-section="IssueDetailActionStrip">
          <IssueActionMenu issueId={issueId} mode="primary-strip" className="flex items-center gap-1" />
        </div>
      </div>
    );
  }

  return (
    <div data-component="issue-detail" data-density={density} className={cn('flex min-h-0 flex-1 flex-col', className)}>
      <div data-section="DrawerPausedBanner"><PausedBanner agents={agents} /></div>
      {showTabs && (
        <div data-section="DrawerTabs"><IssueDetailTabs tab={tab} onSelectTab={onSelectTab} tasksBadge={tasksBadge} hiddenTabIds={HIDDEN_SKILLS} /></div>
      )}
      {/* PAN-2908 C-DETAIL: the ONE issue-detail anatomy (rail + strip as the
          per-agent conversation switcher), shared with the cockpit. */}
      <div data-section="PhaseTimeline" className="px-[22px] pt-[10px]">
        {shell}
      </div>
      <div className={cn('grid min-h-0 flex-1', density === 'page' ? 'grid-cols-[minmax(0,1fr)_360px]' : 'grid-cols-[minmax(0,1fr)_320px]')}>
        <div
          className={cn(
            'flex min-w-0 flex-col',
            SESSION_TAB_IDS.has(tab)
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
              <IssueSkillsSection issueId={issueId} />
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
          ) : SESSION_TAB_IDS.has(tab) ? (
            sessionPane(tab === 'terminal' ? 'terminal' : 'conversation', onSelectTab)
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
