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
import { ChevronRight } from 'lucide-react';

import type { Agent } from '../../types';
import { PHASES, phaseLabel, type Phase, type PhaseStepState } from '../../lib/simple/phases';
import { isEndedAgent } from '../../lib/agentConversation';
import { useAgentSessionOutcome } from '../../lib/useSessionOutcome';
import { SESSION_ENDED_FALLBACK } from '../../lib/sessionOutcome';
import { useIssueData } from '../drawer/useDrawerData';
import { DrawerActivityRailView } from '../drawer/DrawerActivityRail';
import { VerificationGates } from '../issue-view/VerificationGates';
import { ActiveAgentPanel } from '../issue-view/ActiveAgentPanel';
import { usePipelineRail } from '../issue-view/IssuePipelineStrip';
import { UatEnvironmentPanel } from '../CommandDeck/UatEnvironmentPanel';
import { pickPhaseAgent } from './IssuePhaseRail';
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

function PipelineRow({ phase, state, agent, onOpenAgentConversation }: {
  phase: Phase;
  state: PhaseStepState;
  agent: Agent | undefined;
  onOpenAgentConversation: (agentId: string) => void;
}) {
  // A hook, so each row is its own component.
  const outcome = useAgentSessionOutcome(agent ?? null);
  let outcomeText: string;
  if (!agent) {
    outcomeText = noAgentOutcome(phase, state);
  } else if (agent.paused === true) {
    outcomeText = 'Paused';
  } else if (!isEndedAgent(agent)) {
    outcomeText = 'Running now';
  } else {
    const started = shortDate(agent.startedAt);
    outcomeText = `${(outcome ?? SESSION_ENDED_FALLBACK).label}${started ? ` · started ${started}` : ''}`;
  }
  return (
    <tr data-phase={phase} className="border-t border-border">
      <td className="py-[7px] pr-[12px] font-medium">{phaseLabel(phase)}</td>
      <td className="py-[7px] pr-[12px]">
        {agent
          ? <span className="font-mono-ui text-[12px] text-body-foreground">{agent.id}</span>
          : <span className="text-muted-foreground">none</span>}
      </td>
      <td className="py-[7px] pr-[12px] text-muted-foreground">{outcomeText}</td>
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
  const chips = deriveSpecialistChips(agentsToReviewerSessions(agents), derived);
  const reviewStarted = chips.some((chip) => chip.status !== 'queued');

  return (
    <div
      data-testid="drawer-tab-panel-overview"
      className="grid grid-cols-1 gap-x-[36px] gap-y-[22px] min-[900px]:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]"
    >
      <div className="min-w-0 space-y-[22px]">
        <section data-testid="drawer-details-pipeline">
          <h3 className={HEADING_CLASS}>Pipeline</h3>
          <table className="w-full border-collapse text-[13px]">
            <tbody>
              {PHASES.map((phase) => (
                <PipelineRow
                  key={phase}
                  phase={phase}
                  state={rail[phase]}
                  agent={pickPhaseAgent(agents, phase)}
                  onOpenAgentConversation={onOpenAgentConversation}
                />
              ))}
            </tbody>
          </table>
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
  );
}
