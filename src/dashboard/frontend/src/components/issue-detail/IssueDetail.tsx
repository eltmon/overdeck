/**
 * PAN-2908 · C-DETAIL — the ONE issue-detail component.
 *
 * `IssueDetail` owns the issue-detail anatomy every shell shares: the
 * pipeline strip, the banner slot, the tab strip, the per-agent conversation
 * switcher and the tab bodies. Shells keep their frames (the drawer's
 * scrim/header, the Stage tab's breadcrumb) and render this as the body.
 *
 * Densities:
 * - **drawer** and **page** (PAN-5244, PAN-5253, PAN-5246) — one
 *   composition in two shells: the compact pipeline strip (phase buttons,
 *   checks chip, pickup strip) + banner slot (needs-you or paused) + tab
 *   strip with views + a full-width tab body. The Conversation tab uses
 *   DrawerAgentSession's conversation-header layout; Details (`overview`) is
 *   IssueDrawerDetails; Skills is IssueSkillsTabPanel. The drawer
 *   (IssueDrawer) passes `drawer`; the Stage issue tab passes `page`. The
 *   shells own only routing and frame chrome (title row, scrim, close).
 * - **rail** — compact inline expansion: shell + active conversation +
 *   one action strip. (Adoption in the deck tree's FeatureItem is tracked
 *   in #2962; the density is complete and tested here.)
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import type { Agent } from '../../types';
import type { DerivedIssueState } from '../../types';
import { cn } from '../../lib/utils';
import { DrawerAgentSession, pickDefaultDrawerAgent } from '../drawer/DrawerAgentSession';
import { IssueActionMenu } from '../IssueActionMenu';
import { IssueDetailShell } from './IssueDetailShell';
import { openIssueOnTracker } from './IssueDetailSections';
import { IssueDrawerDetails } from './IssueDrawerDetails';
import { SpecialistStrip } from './SpecialistStrip';
import { agentsToReviewerSessions, deriveSpecialistChips } from './deriveSpecialists';
import { IssueSkillsTabPanel } from '../skills/SkillOverridesSections';
import { useIssueSkillOverrideCount } from '../skills/useIssueSkillOverrideCount';
import { IssuePipelineStrip } from '../issue-view/IssuePipelineStrip';
import { IssueChecksChip } from '../issue-view/IssueChecksChip';
import { PickupGateControls, pickupStageFor } from '../backlog/PickupGateControls';
import { useDeftIssueSummary } from '../deft/queries';
import { DeftDecisionsTab } from '../deft/DeftDecisionsTab';
import { IssueBannerSlot } from '../issue-view/IssueBannerSlot';
import { ISSUE_DETAIL_TABS, entryClickValue, resolveIssueTab, type IssueTabValue } from './issueTabs';
import {
  IssueActivityBody,
  IssueChangesBody,
  IssueDiscussionBody,
  IssuePlanBody,
  IssueTasksBody,
} from './IssueDetailTabBodies';

export type IssueDetailDensity = 'drawer' | 'page' | 'rail';

export { ISSUE_DETAIL_TABS };

export type IssueDetailTabId = IssueTabValue;

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
  /** Render the tab strip? Default true. Both shells show the strip; no
   *  shell passes `false` any more (PAN-5246). */
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
    if (skillsUnavailable && tab === 'skills') onSelectTab('conversation');
  }, [skillsUnavailable, tab, onSelectTab]);

  const { isDeft } = useDeftIssueSummary(issueId);
  const hiddenTabIds = useMemo(() => {
    const hidden = new Set<string>();
    if (skillsUnavailable) hidden.add('skills');
    if (!isDeft) hidden.add('decisions');
    return hidden;
  }, [skillsUnavailable, isDeft]);

  // Drawer and page density: the reviewers row under the conversation
  // header, only while a review agent is selected (D-8). Rail density never
  // renders the conversation-header layout, so it never shows this row.
  const activeAgent = agents.find((agent) => agent.id === effectiveAgentId) ?? null;
  const reviewersRow = activeAgent?.role === 'review' ? (
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

  const sessionTab = entry === 'session';
  return (
    <div data-component="issue-detail" data-density={density} data-tab={entry ?? undefined} data-view={resolved?.view ?? undefined} className={cn('flex min-h-0 flex-1 flex-col', className)}>
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
      <IssueBannerSlot issueId={issueId} agents={agents} onOpenAgentConversation={openAgentConversation} />
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
        {entry === 'session' ? sessionPane(resolved?.view === 'terminal' ? 'terminal' : 'conversation', onSelectTab, true)
          : entry === 'tasks' ? <IssueTasksBody issueId={issueId} />
          : entry === 'plan' ? <IssuePlanBody issueId={issueId} value={resolved!.value} onSelect={onSelectTab} />
          : entry === 'changes' ? <IssueChangesBody issueId={issueId} value={resolved!.value} onSelect={onSelectTab} />
          : entry === 'activity' ? <IssueActivityBody issueId={issueId} value={resolved!.value} onSelect={onSelectTab} />
          : entry === 'discussion' ? <IssueDiscussionBody issueId={issueId} />
          : entry === 'decisions' ? <DeftDecisionsTab issueId={issueId} />
          : entry === 'skills' && !skillsUnavailable ? <IssueSkillsTabPanel issueId={issueId} onUnavailable={markSkillsUnavailable} />
          : entry === 'overview' ? (
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
