/**
 * PAN-5244 · the issue drawer's Details tab body (tab id `overview`).
 *
 * Left column: the pipeline as a table (one row per phase, with its agent and
 * outcome), the reviewers, and live activity. Right column: pickup controls,
 * verification gates, the workspace with its containers, the UAT environment,
 * the active agent card, and a link to the Skills tab.
 *
 * It must not import `drawer/DrawerAgentSession` or `IssueDetailShell`.
 */
import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { presenceForPaneState, type BackendPane } from '@overdeck/contracts';

import type { Agent } from '../../types';
import { cn } from '../../lib/utils';
import { PHASES, phaseLabel, type Phase, type PhaseStepState } from '../../lib/simple/phases';
import { isEndedAgent } from '../../lib/agentConversation';
import { useAgentSessionOutcome } from '../../lib/useSessionOutcome';
import { SESSION_ENDED_FALLBACK } from '../../lib/sessionOutcome';
import { useBackendPanes } from '../../lib/store';
import { useSharedTick } from '../../lib/useSharedTick';
import { useIssueData } from '../drawer/useDrawerData';
import { DrawerActivityRailView } from '../drawer/DrawerActivityRail';
import { VerificationGates } from '../issue-view/VerificationGates';
import { ActiveAgentPanel } from '../issue-view/ActiveAgentPanel';
import { usePipelineRail } from '../issue-view/IssuePipelineStrip';
import { UatEnvironmentPanel } from '../CommandDeck/UatEnvironmentPanel';
import { useIssueActions } from '../IssueActionMenu/useIssueActions';
import { useIssueCostsQuery, usePrQuery } from '../CommandDeck/ZoneCOverviewTabs/queries';
import { CostsTab } from '../CommandDeck/ZoneCOverviewTabs/CostsTab';
import { StatusNarrative } from '../Stage/cockpit/StatusNarrative';
import { LinkedConversations } from '../Stage/cockpit/LinkedConversations';
import { DeftSubagentRows } from '../deft/DeftSubagentRows';
import { DeftGatesPanel } from '../deft/DeftGatesPanel';
import { DeftReviewCyclePanel } from '../deft/DeftReviewCyclePanel';
import { DeftDeliveryChip } from '../deft/DeftBadges';
import { deriveShip } from '../issue-view/derivations';
import { ShipProgress } from '../issue-view/ShipProgress';
import { StackDrawer } from '../issue-view/StackDrawer';
import { ROLE_TO_PHASE, pickPhaseAgent } from './IssuePhaseRail';
import { agentsToReviewerSessions, deriveSpecialistChips } from './deriveSpecialists';
import { PickupSection, ResourcesFacet, WorkspaceSection, useDrawerWorkspace } from './IssueDetailSections';

export interface IssueDrawerDetailsProps {
  issueId: string;
  agents: Agent[];
  /** The agent the Conversation tab shows; drives the Active agent card. */
  effectiveAgentId: string | null;
  onOpenAgentConversation: (agentId: string) => void;
  onOpenTab: (tab: 'activity' | 'skills') => void;
  /** False once the Skills panel reported the issue has no project. */
  skillsAvailable: boolean;
  skillsCount: number | null;
}

const HEADING_CLASS = 'mb-[8px] text-[13px] font-semibold text-foreground';
const OPEN_BUTTON_CLASS = 'text-[12px] text-primary-ink hover:underline';

function noAgentOutcome(phase: Phase, state: PhaseStepState): string {
  if (phase === 'done') {
    if (state === 'done') return 'Closed out';
    if (state === 'current') return 'Merged. Close-out pending.';
    return 'Not started';
  }
  switch (state) {
    case 'done': return 'Finished';
    case 'current': return 'Next';
    case 'attention': return 'Needs a look';
    case 'pending': return 'Not started';
  }
}

function shortDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString([], { month: '2-digit', day: '2-digit' });
}

const shortModel = (model: string | null | undefined): string => (model ?? '').replace(/^claude-/, '');

function formatDuration(seconds: number | null): string | null {
  if (seconds === null) return null;
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/** The first pane for `phase`, preferring one that is still active (D-13). */
function pickPhasePane(panes: readonly BackendPane[], phase: Phase): BackendPane | undefined {
  const candidates = panes.filter((pane) => ROLE_TO_PHASE[pane.role] === phase && presenceForPaneState(pane.state) !== 'ended');
  return candidates.find((pane) => presenceForPaneState(pane.state) === 'active') ?? candidates[0];
}

function PipelineRow({ phase, state, agent, pane, now, cost, onOpenAgentConversation }: {
  phase: Phase;
  state: PhaseStepState;
  agent: Agent | undefined;
  pane: BackendPane | undefined;
  now: Date;
  cost: number;
  onOpenAgentConversation: (agentId: string) => void;
}) {
  // A hook, so each row is its own component.
  const outcome = useAgentSessionOutcome(agent ?? null);
  let outcomeText: string;
  if (!agent && !pane) {
    outcomeText = noAgentOutcome(phase, state);
  } else if (agent?.paused === true) {
    outcomeText = 'Paused';
  } else if (agent && !isEndedAgent(agent)) {
    const startedAt = Date.parse(agent.startedAt);
    const duration = Number.isFinite(startedAt) ? formatDuration(Math.max(0, Math.floor((now.getTime() - startedAt) / 1000))) : null;
    outcomeText = duration ? `Running now · ${duration}` : 'Running now';
  } else if (agent) {
    const started = shortDate(agent.startedAt);
    outcomeText = `${(outcome ?? SESSION_ENDED_FALLBACK).label}${started ? ` · started ${started}` : ''}`;
  } else {
    outcomeText = presenceForPaneState(pane!.state) === 'active' ? 'Running now' : 'Idle';
  }

  const model = agent?.model ?? pane?.model;
  const harness = agent?.harness ?? agent?.runtime ?? pane?.harness;
  const metaLine = agent || pane ? [shortModel(model), harness].filter(Boolean).join(' · ') : null;

  return (
    <tr data-phase={phase} className="border-t border-border">
      <td className="py-[7px] pr-[12px] font-medium">{phaseLabel(phase)}</td>
      <td className="py-[7px] pr-[12px]">
        {agent ? (
          <span className="font-mono-ui text-[12px] text-body-foreground">{agent.id}</span>
        ) : pane?.agentId ? (
          <span className="font-mono-ui text-[12px] text-body-foreground">{pane.agentId}</span>
        ) : pane ? (
          <span className="text-muted-foreground">backend pane</span>
        ) : (
          <span className="text-muted-foreground">none</span>
        )}
        {metaLine ? <span className="block text-[11.5px] text-muted-foreground">{metaLine}</span> : null}
      </td>
      <td className="py-[7px] pr-[12px] text-muted-foreground">{outcomeText}</td>
      <td data-testid={`drawer-details-cost-${phase}`} className="py-[7px] pr-[12px] text-right font-mono-ui text-[12px] tabular-nums text-signal-cost-foreground">
        {cost > 0 ? `$${cost.toFixed(2)}` : ''}
      </td>
      <td className="py-[7px] text-right">
        {agent ? (
          <button
            type="button"
            data-testid={`drawer-details-open-${phase}`}
            className={OPEN_BUTTON_CLASS}
            onClick={() => onOpenAgentConversation(agent.id)}
          >
            Open conversation
          </button>
        ) : null}
      </td>
    </tr>
  );
}

export function IssueDrawerDetails({
  issueId,
  agents,
  effectiveAgentId,
  onOpenAgentConversation,
  onOpenTab,
  skillsAvailable,
  skillsCount,
}: IssueDrawerDetailsProps) {
  const { rail, derived } = usePipelineRail(issueId);
  const { activityRail } = useIssueData(issueId);
  const { data: workspace } = useDrawerWorkspace(issueId);
  const panes = useBackendPanes(issueId);
  const now = useSharedTick();
  const chips = deriveSpecialistChips(agentsToReviewerSessions(agents), derived);
  const reviewStarted = chips.some((chip) => chip.status !== 'queued');
  const hasPlan = useIssueActions(issueId).state.hasPlan;
  const workRunning = agents.some((agent) => agent.role === 'work' && (agent.status === 'running' || agent.status === 'starting'));
  const [costsOpen, setCostsOpen] = useState(false);
  const costsData = useIssueCostsQuery(issueId).data;
  const sessions = costsData?.sessions ?? [];
  // An agent can own several cost rows (a restart or a session rollover): sum them.
  const costOf = (agentId: string) => sessions
    .filter((entry) => entry.agentId === agentId || entry.sessionId === agentId)
    .reduce((sum, entry) => sum + (entry.cost ?? 0), 0);
  const totalCost = costsData?.resolvedTotalCost ?? costsData?.totalCost ?? 0;
  const pr = usePrQuery(issueId).data?.pr ?? null;
  const mergeOid = typeof pr?.mergeCommit === 'string' ? pr.mergeCommit : pr?.mergeCommit?.oid;

  return (
    <div data-testid="drawer-tab-panel-overview" className="@container">
      <div
        data-testid="drawer-details-grid"
        className="grid grid-cols-1 gap-x-[36px] gap-y-[22px] @[900px]:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]"
      >
      <div className="min-w-0 space-y-[22px]">
        <section data-testid="drawer-details-status">
          <h3 className={HEADING_CLASS}>Status</h3>
          <StatusNarrative issueId={issueId} hasPlan={hasPlan} workRunning={workRunning} />
        </section>

        <section data-testid="drawer-details-pipeline">
          <h3 className={HEADING_CLASS}>Pipeline</h3>
          <table className="w-full border-collapse text-[13px]">
            <tbody>
              {PHASES.map((phase) => {
                const agent = pickPhaseAgent(agents, phase);
                return (
                  <PipelineRow
                    key={phase}
                    phase={phase}
                    state={rail[phase]}
                    agent={agent}
                    pane={pickPhasePane(panes, phase)}
                    now={now}
                    cost={agent ? costOf(agent.id) : 0}
                    onOpenAgentConversation={onOpenAgentConversation}
                  />
                );
              })}
            </tbody>
            {totalCost > 0 ? (
              <tfoot>
                <tr className="border-t border-border">
                  <td colSpan={3} className="py-[7px] pr-[12px] font-medium">Total</td>
                  <td
                    data-testid="drawer-details-cost-total"
                    title="Whole issue, including agents not listed above"
                    className="py-[7px] pr-[12px] text-right font-mono-ui text-[12px] tabular-nums text-signal-cost-foreground"
                  >
                    ${totalCost.toFixed(2)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            ) : null}
          </table>
          <DeftSubagentRows issueId={issueId} />
          <button
            type="button"
            data-testid="drawer-details-costs-toggle"
            aria-expanded={costsOpen}
            onClick={() => setCostsOpen((open) => !open)}
            className="mt-[8px] inline-flex items-center gap-[6px] text-[12px] text-primary-ink hover:underline"
          >
            <ChevronRight aria-hidden className={cn('h-3 w-3 transition-transform', costsOpen && 'rotate-90')} />
            Cost breakdown
          </button>
          {costsOpen ? <div data-testid="drawer-details-costs" className="mt-[8px]"><CostsTab issueId={issueId} /></div> : null}
        </section>

        <section data-section="DrawerReviewSpecialists" data-testid="drawer-details-review">
          <h3 className={HEADING_CLASS}>Review</h3>
          {!reviewStarted ? (
            <p className="text-[12px] text-muted-foreground">Review has not started.</p>
          ) : (
            chips.map((chip) => {
              const reviewer = agents.find((candidate) => candidate.id.toLowerCase().endsWith(`-review-${chip.id}`));
              return (
                <div
                  key={chip.id}
                  data-reviewer={chip.id}
                  data-status={chip.status}
                  className="flex items-center gap-[10px] border-t border-border py-[7px] text-[13px]"
                >
                  <span className="font-mono-ui text-[12px]">{chip.name}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{chip.lastLine}</span>
                  {reviewer ? (
                    <button
                      type="button"
                      data-testid={`drawer-details-open-reviewer-${chip.id}`}
                      className={OPEN_BUTTON_CLASS}
                      onClick={() => onOpenAgentConversation(reviewer.id)}
                    >
                      Open conversation
                    </button>
                  ) : null}
                </div>
              );
            })
          )}
        </section>

        <DeftGatesPanel issueId={issueId} />
        <DeftReviewCyclePanel issueId={issueId} />

        <section data-testid="drawer-details-ship">
          <h3 className={HEADING_CLASS}>Ship</h3>
          <ShipProgress ship={deriveShip(derived)} />
          {pr ? (
            <p data-testid="drawer-details-diff" className="mt-[6px] text-[12px] text-muted-foreground">
              <span className="text-success-foreground">+{pr.additions}</span> <span className="text-destructive-foreground">−{pr.deletions}</span> · {pr.changedFiles} file{pr.changedFiles === 1 ? '' : 's'}
              {mergeOid ? <> · merged as <span className="font-mono-ui text-foreground">{mergeOid}</span></> : null}
            </p>
          ) : null}
          <DeftDeliveryChip issueId={issueId} />
        </section>

        {derived?.pr?.url ? (
          <div data-testid="drawer-details-linked"><LinkedConversations prUrl={derived.pr.url} /></div>
        ) : null}

        <section data-section="DrawerActivityRail / DrawerActivityPanel" data-testid="drawer-details-activity">
          <h3 className={HEADING_CLASS}>Live activity</h3>
          <DrawerActivityRailView activityRail={activityRail} compact limit={8} />
          <button
            type="button"
            data-testid="drawer-details-all-activity"
            className="mt-[6px] text-[12px] text-primary-ink hover:underline"
            onClick={() => onOpenTab('activity')}
          >
            All activity
          </button>
        </section>
      </div>

      <div className="min-w-0 space-y-[22px]">
        <section>
          <h3 className={HEADING_CLASS}>Pickup controls</h3>
          <div data-section="DrawerPickupSection / PickupGateControls"><PickupSection issueId={issueId} /></div>
        </section>
        <div data-section="DrawerVerificationGates"><VerificationGates issueId={issueId} /></div>
        <div data-section="DrawerWorkspaceSection">
          <WorkspaceSection issueId={issueId} />
          <ResourcesFacet issueId={issueId} variant="inline" />
          {workspace?.exists !== true ? (
            <p data-testid="drawer-details-no-workspace" className="text-[12px] text-muted-foreground">
              No workspace yet. Overdeck creates it when the first agent starts.
            </p>
          ) : null}
          <StackDrawer issueId={issueId} branch={derived?.branch?.name ?? `feature/${issueId.toLowerCase()}`} />
        </div>
        <div data-section="UatEnvironmentPanel"><UatEnvironmentPanel issueId={issueId} /></div>
        <div data-section="DrawerActiveAgent"><ActiveAgentPanel agentId={effectiveAgentId ?? ''} density="console" /></div>
        {skillsAvailable ? (
          <button
            type="button"
            data-testid="drawer-details-skills-link"
            onClick={() => onOpenTab('skills')}
            className="list-row flex w-full items-center gap-[8px] border-y border-border py-[8px] text-left text-[13px] text-body-foreground"
          >
            <ChevronRight aria-hidden className="h-[14px] w-[14px] text-muted-foreground" />
            {skillsCount === null ? 'Skills for this issue' : `Skills: ${skillsCount} changed for this issue`}
          </button>
        ) : null}
      </div>
      </div>
    </div>
  );
}
