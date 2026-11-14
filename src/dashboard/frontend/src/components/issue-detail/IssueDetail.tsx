/**
 * PAN-2908 · C-DETAIL — the ONE issue-detail component.
 *
 * `IssueDetail` owns the issue-detail anatomy every shell shares: the paused
 * banner, the tab strip, the per-agent conversation switcher, the tab bodies,
 * and (page density) the status rail. Shells keep their frames (the drawer's
 * scrim/header, the cockpit's route chrome) and render this as the body.
 *
 * Densities:
 * - **drawer** (PAN-5244) — conversation first: the compact pipeline strip
 *   (phase buttons, checks chip, pickup strip) + paused banner + tab strip +
 *   a full-width tab body. The Conversation tab uses DrawerAgentSession's
 *   conversation-header layout; Details (`overview`) is IssueDrawerDetails;
 *   Skills is IssueSkillsTabPanel. This is exactly what IssueDrawer renders.
 * - **page** — tab strip + IssueDetailShell (phase rail + specialist strip)
 *   + tab bodies + a 360px status rail (the cockpit-route form). Adoption on
 *   `/command-deck/:project/:issue` is a product decision tracked in #2962.
 * - **rail** — compact inline expansion: shell + active conversation +
 *   one action strip. (Adoption in the deck tree's FeatureItem is tracked
 *   in #2962; the density is complete and tested here.)
 *
 * The cockpit's conversation access deliberately stays on its session-tree →
 * SessionPanel flow (test-enshrined); both surfaces share this component's
 * shell and the ConversationPanel transcript renderer.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

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
import { PausedBanner, PickupSection, ResourcesFacet, WorkspaceSection, openIssueOnTracker } from './IssueDetailSections';
import { IssueDrawerDetails } from './IssueDrawerDetails';
import { SpecialistStrip } from './SpecialistStrip';
import { agentsToReviewerSessions, deriveSpecialistChips } from './deriveSpecialists';
import { IssueSkillsSection, IssueSkillsTabPanel } from '../skills/SkillOverridesSections';
import { useIssueSkillOverrideCount } from '../skills/useIssueSkillOverrideCount';
import { IssuePipelineStrip } from '../issue-view/IssuePipelineStrip';
import { IssueChecksChip } from '../issue-view/IssueChecksChip';
import { PickupGateControls, pickupStageFor } from '../backlog/PickupGateControls';
import { ChangedFilesView } from '../Stage/cockpit/ChangedFilesView';
import { useDeftIssueSummary } from '../deft/queries';
import { ISSUE_DETAIL_TABS, entryClickValue, resolveIssueTab, type IssueTabValue } from './issueTabs';

export type IssueDetailDensity = 'drawer' | 'page' | 'rail';

export { ISSUE_DETAIL_TABS };

export type IssueDetailTabId = IssueTabValue;

const SESSION_TAB_IDS = new Set<string>(['session', 'conversation', 'terminal']);
/** PAN-5253: the legacy page return hides Skills, Discussion and Decisions. */
const PAGE_HIDDEN_TABS: ReadonlySet<string> = new Set(['skills', 'discussion', 'decisions']);

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
    <nav data-component="drawer-tabs" data-testid="drawer-tabs" className="border-b border-border bg-background px-[12px]" role="tablist" aria-label="Issue sections">
      <div className="flex min-w-0 items-center overflow-x-auto">
        {ISSUE_DETAIL_TABS.filter((entry) => !hiddenTabIds?.has(entry.id)).map((entry) => {
          const active = resolveIssueTab(tab)?.entry === entry.id;
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
              onClick={() => onSelectTab(entryClickValue(entry.id, tab))}
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

  // PAN-5244 Skills tab: a cache-only badge, and a tab that hides itself when
  // the panel reports the issue has no project.
  const skillsCount = useIssueSkillOverrideCount(issueId);
  // Keyed by issue id, so it resets by itself when the drawer switches issues.
  const [skillsUnavailableFor, setSkillsUnavailableFor] = useState<string | null>(null);
  const skillsUnavailable = skillsUnavailableFor === issueId;
  const markSkillsUnavailable = useCallback(() => setSkillsUnavailableFor(issueId), [issueId]);
  useEffect(() => {
    // FR-14: a hidden tab cannot stay selected (also covers a ?tab=skills deep link).
    if (density === 'drawer' && skillsUnavailable && tab === 'skills') onSelectTab('conversation');
  }, [density, skillsUnavailable, tab, onSelectTab]);

  const { isDeft } = useDeftIssueSummary(issueId);
  const hiddenTabIds = useMemo(() => {
    const hidden = new Set<string>();
    if (skillsUnavailable) hidden.add('skills');
    if (!isDeft) hidden.add('decisions');
    return hidden;
  }, [skillsUnavailable, isDeft]);

  // Drawer density: the reviewers row under the conversation header, only
  // while a review agent is selected (D-8).
  const activeAgent = agents.find((agent) => agent.id === effectiveAgentId) ?? null;
  const reviewersRow = density === 'drawer' && activeAgent?.role === 'review' ? (
    <div data-section="SpecialistStrip" className="shrink-0 border-b border-border px-[20px] py-[8px]">
      <SpecialistStrip
        specialists={deriveSpecialistChips(agentsToReviewerSessions(agents), derived)}
        activeId={/-review-([a-z]+)$/i.exec(effectiveAgentId ?? '')?.[1]?.toLowerCase() ?? null}
        onSelect={(chip) => {
          const agent = agents.find((candidate) => candidate.id.toLowerCase().endsWith(`-review-${chip.id.toLowerCase()}`));
          if (agent) openAgentConversation(agent.id);
        }}
      />
    </div>
  ) : null;

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
    drawerLayout = false,
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
      {...(drawerLayout ? { layout: 'conversation-header' as const, belowHeader: reviewersRow } : {})}
    /></div>
  );
  const conversationPane = sessionPane('conversation');

  // The five secondary tab bodies, shared by drawer and page density.
  const secondaryPanel =
    tab === 'tasks' ? (
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
    ) : null;

  const resolved = resolveIssueTab(tab);
  const entry = resolved?.entry ?? null;

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

  if (density === 'drawer') {
    const sessionTab = entry === 'session';
    return (
      <div data-component="issue-detail" data-density="drawer" className={cn('flex min-h-0 flex-1 flex-col', className)}>
        <div data-section="PhaseTimeline" className="shrink-0 pb-[8px] pl-[14px] pr-[16px]">
          <IssuePipelineStrip
            issueId={issueId}
            agents={agents}
            activeAgentId={sessionTab ? effectiveAgentId : null}
            onOpenAgentConversation={openAgentConversation}
          >
            <IssueChecksChip issueId={issueId} checks={derived?.pr?.checks} />
            <PickupGateControls issueId={issueId} variant="strip" stage={pickupStageFor(derived?.state)} onOpenIssueBrowser={openIssueOnTracker} />
          </IssuePipelineStrip>
        </div>
        <div data-section="DrawerPausedBanner"><PausedBanner agents={agents} /></div>
        {showTabs && (
          <div data-section="DrawerTabs">
            <IssueDetailTabs
              tab={tab}
              onSelectTab={onSelectTab}
              tasksBadge={tasksBadge}
              skillsBadge={skillsCount}
              hiddenTabIds={hiddenTabIds}
            />
          </div>
        )}
        <div className={cn('flex min-h-0 min-w-0 flex-1 flex-col', !sessionTab && 'overflow-auto px-[22px] py-[18px]')}>
          {sessionTab ? sessionPane(tab === 'terminal' ? 'terminal' : 'conversation', onSelectTab, true)
            : secondaryPanel ? secondaryPanel
            : tab === 'skills' && !skillsUnavailable ? <IssueSkillsTabPanel issueId={issueId} onUnavailable={markSkillsUnavailable} />
            : tab === 'overview' ? (
              <IssueDrawerDetails
                issueId={issueId}
                agents={agents}
                effectiveAgentId={effectiveAgentId}
                onOpenAgentConversation={openAgentConversation}
                onOpenTab={onSelectTab}
                skillsAvailable={!skillsUnavailable}
                skillsCount={skillsCount}
              />
            ) : <TabPlaceholder tab={tab} />}
        </div>
      </div>
    );
  }

  return (
    <div data-component="issue-detail" data-density={density} className={cn('flex min-h-0 flex-1 flex-col', className)}>
      <div data-section="DrawerPausedBanner"><PausedBanner agents={agents} /></div>
      {showTabs && (
        <div data-section="DrawerTabs"><IssueDetailTabs tab={tab} onSelectTab={onSelectTab} tasksBadge={tasksBadge} hiddenTabIds={PAGE_HIDDEN_TABS} /></div>
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
          ) : secondaryPanel ? (
            secondaryPanel
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
