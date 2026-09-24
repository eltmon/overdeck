import { useMemo } from 'react';
import type { AgentSnapshot, SessionNode } from '@overdeck/contracts';
import { selectIssues, useBackendPanes, useDashboardStore, useDerivedIssueState } from '../../lib/store';
import {
  useActivityQuery,
  useIssueCostsQuery,
  useWorkspaceQuery,
  type ActivityResponse,
  type ActivitySection,
  type IssueCostData,
  type WorkspaceData,
} from '../CommandDeck/ZoneCOverviewTabs/queries';
import { deriveShip, isAgentRunning, isReadyToMerge, sortOperatorNeeds, stuckReason } from './derivations';
import type {
  AgentRowModel,
  IssueActivityModel,
  IssueHeaderModel,
  IssueNarrativeModel,
  IssueOperatorModel,
  IssuePipelineModel,
  IssueResourcesModel,
  IssueVerificationModel,
  IssueViewModel,
  OperatorNeedsYou,
  VerificationGateModel,
} from './types';
import type { BackendPane, DerivedIssueState, Issue } from '../../types';

const MODEL_PLACEHOLDERS = new Set(['', 'unknown', 'specialist', 'planning', 'idle', 'none']);

function shortModel(model: string | undefined): string {
  const v = (model ?? '').trim();
  if (MODEL_PLACEHOLDERS.has(v.toLowerCase())) return '';
  return v.replace(/^claude-/, '');
}

function formatCost(cost: number | undefined, tokenCount: number | undefined): string | undefined {
  if (cost === undefined || Number.isNaN(cost) || cost <= 0) return undefined;
  const tokens = tokenCount && tokenCount > 0
    ? ` · ${tokenCount >= 1_000_000 ? `${(tokenCount / 1_000_000).toFixed(1)}M` : `${Math.round(tokenCount / 1_000)}k`} tok`
    : '';
  return `$${cost.toFixed(2)}${tokens}`;
}

function normalizeSessionType(type: string): SessionNode['type'] {
  switch (type) {
    case 'planning':
    case 'work':
    case 'knowledge':
    case 'strike':
    case 'review':
    case 'reviewer':
    case 'test':
    case 'ship':
    case 'merge':
    case 'legacy':
      return type;
    default:
      return 'work';
  }
}

function normalizeAgentStatus(status: string): SessionNode['status'] {
  const s = status.toLowerCase();
  if (s === 'running' || s === 'active' || s === 'working' || s === 'thinking') return 'running';
  if (s === 'starting') return 'starting';
  if (s === 'error' || s === 'failed' || s === 'blocked' || s === 'dispatch_failed') return 'error';
  if (s === 'stopped' || s === 'completed') return 'stopped';
  return 'unknown';
}

function normalizePresence(status: string): SessionNode['presence'] {
  const s = status.toLowerCase();
  if (s === 'running' || s === 'active' || s === 'working' || s === 'thinking' || s === 'starting') return 'active';
  return 'ended';
}

function toSessionNode(section: ActivitySection): SessionNode {
  return {
    type: normalizeSessionType(section.type),
    sessionId: section.sessionId,
    tmuxSession: section.tmuxSession,
    model: section.model,
    startedAt: section.startedAt,
    duration: section.duration,
    status: normalizeAgentStatus(section.status),
    presence: normalizePresence(section.status),
    role: section.role,
    roundMetadata: section.roundMetadata ? {
      ...section.roundMetadata,
      history: section.roundMetadata.history.map((round) => ({
        ...round,
        durationSec: round.durationSec ?? undefined,
      })),
    } : undefined,
    awaitingInput: section.awaitingInput,
    awaitingInputPrompt: section.awaitingInputPrompt,
    awaitingInputReason: section.awaitingInputReason,
    pendingInputKinds: section.pendingInputKinds,
  };
}

function slotIndexFromSessionId(sessionId: string): number | null {
  const match = /^agent-[a-z]+-\d+-slot-(\d+)$/i.exec(sessionId);
  if (!match) return null;
  return Number(match[1]);
}

function deriveAgentLabel(session: SessionNode): string {
  const slotIndex = session.type === 'work' ? slotIndexFromSessionId(session.sessionId) : null;
  if (slotIndex !== null) return `Slot ${slotIndex}`;

  switch (session.type) {
    case 'ship':
    case 'merge':
      return 'Ship';
    case 'test':
      return 'Test';
    case 'review':
      return 'Review';
    case 'reviewer':
      return session.role ? session.role[0]!.toUpperCase() + session.role.slice(1) : 'Reviewer';
    case 'work': {
      // PAN-3920: registered workers (`pan worker run`) show as "Worker <n>".
      const worker = /-worker-(\d+)$/.exec(session.sessionId);
      return worker ? `Worker ${worker[1]}` : 'Work';
    }
    case 'knowledge':
      return 'Knowledge';
    case 'strike':
      return 'Strike';
    case 'planning':
      return 'Plan';
    case 'legacy':
      return 'Plan';
    default:
      return session.type;
  }
}

function deriveIconKey(session: SessionNode): string {
  if (session.type === 'reviewer' && session.role) return `reviewer-${session.role}`;
  return session.type;
}

function deriveAgentStatus(session: SessionNode, agent?: AgentSnapshot): string {
  if (session.awaitingInput) return 'waiting';
  if (agent?.paused) return 'paused';
  if (isAgentRunning(session, agent)) return 'running';
  if (session.status === 'error' || agent?.status === 'error') return 'error';
  if (session.status === 'stopped' || session.status === 'unknown') return 'done';
  return session.status;
}

function deriveVerdict(session: SessionNode): AgentRowModel['verdict'] {
  if (session.type !== 'reviewer') return null;
  const { latestReviewResult, latestStatus } = session.roundMetadata ?? {};
  if (latestReviewResult === 'APPROVED') return 'approved';
  if (latestReviewResult === 'CHANGES_REQUESTED' || latestStatus === 'failed' || session.status === 'error') {
    return 'changes_requested';
  }
  return null;
}

function hasPendingInput(agent: AgentSnapshot | undefined): boolean {
  if (!agent) return false;
  return (
    agent.hasPendingQuestion === true ||
    (agent.pendingInputCount ?? 0) > 0 ||
    agent.pendingAskUserQuestion != null ||
    agent.pendingProposedPlan != null
  );
}

function findAgentForSession(
  session: SessionNode,
  agentsById: Record<string, AgentSnapshot>,
): AgentSnapshot | undefined {
  return Object.values(agentsById).find((agent) =>
    agent.sessionId === session.sessionId ||
    agent.id === session.sessionId ||
    (session.tmuxSession && agent.sessionId === session.tmuxSession) ||
    agent.id === session.tmuxSession,
  );
}

function findCostForSession(session: SessionNode, costs?: IssueCostData): string | undefined {
  if (!costs) return undefined;
  const hit = costs.sessions.find((entry) =>
    entry.sessionId === session.sessionId ||
    (entry.agentId && (entry.agentId === session.tmuxSession || entry.agentId === session.sessionId)),
  );
  return hit ? formatCost(hit.cost, hit.tokenCount) : undefined;
}

const PANE_ROLE_BY_SESSION_TYPE: Partial<Record<SessionNode['type'], BackendPane['role']>> = {
  planning: 'plan',
  legacy: 'plan',
  work: 'work',
  strike: 'strike',
  review: 'review',
  reviewer: 'review',
  test: 'test',
};

/** The backend owns harness and model — match this session's row to its pane. */
function findPaneForSession(session: SessionNode, panes: readonly BackendPane[]): BackendPane | undefined {
  const role = PANE_ROLE_BY_SESSION_TYPE[session.type];
  return panes.find((pane) => pane.id === session.sessionId || pane.terminalId === session.tmuxSession)
    ?? (role ? panes.find((pane) => pane.role === role) : undefined);
}

function buildAgentRow(
  session: SessionNode,
  agentsById: Record<string, AgentSnapshot>,
  costs?: IssueCostData,
  panes: readonly BackendPane[] = [],
): AgentRowModel {
  const agent = findAgentForSession(session, agentsById);
  const pane = findPaneForSession(session, panes);
  return {
    sessionId: session.sessionId,
    type: session.type,
    label: deriveAgentLabel(session),
    icon: deriveIconKey(session),
    role: session.role,
    status: deriveAgentStatus(session, agent),
    active: isAgentRunning(session, agent),
    model: shortModel(session.model || pane?.model),
    harness: session.harness ?? pane?.harness ?? agent?.runtime,
    startedAt: session.startedAt,
    cost: findCostForSession(session, costs),
    duration: session.duration ?? null,
    verdict: deriveVerdict(session),
    pendingInput: session.awaitingInput === true || hasPendingInput(agent),
  };
}

/** The issue's derived state is the phase; sessions only answer for an unplanned issue. */
function derivePhase(derived: DerivedIssueState | undefined, sessions: SessionNode[]): string {
  if (derived) return derived.state;

  const runningType = sessions.find((s) => isAgentRunning(s, undefined))?.type;
  if (runningType === 'planning' || runningType === 'legacy') return 'planned';
  if (runningType) return 'working';
  return 'backlog';
}

function deriveNowText(derived: DerivedIssueState | undefined, activeAgent?: AgentRowModel): string {
  switch (derived?.state) {
    case 'merged': return 'Merged — ready to close out';
    case 'closed': return 'Closed';
    case 'ready': return 'Approved and green — ready to merge';
    case 'changes-requested':
      return activeAgent?.type === 'work'
        ? 'Changes requested — work agent is fixing it'
        : 'Changes requested — awaiting the work agent';
    case 'in-review': return 'In review';
    case 'parked': return 'Parked';
    default:
      if (activeAgent) return `${activeAgent.label} agent is working`;
      return 'Idle — awaiting the pipeline';
  }
}

function deriveNextAction(derived: DerivedIssueState | undefined): string {
  switch (derived?.state) {
    case 'merged': return 'merged — close out';
    case 'closed': return 'closed';
    case 'ready': return 'merge to main';
    case 'changes-requested': return 'work agent fixes → re-review';
    case 'in-review': return derived.pr?.checks === 'red' ? 'fix the red checks' : 'review in progress';
    case 'working': return 'work in progress';
    case 'planned': return 'start work';
    default: return 'start work';
  }
}

function deriveHeader(
  issueId: string,
  title: string | undefined,
  branch: string | undefined,
  projectName: string | undefined,
  derived: DerivedIssueState | undefined,
  costs: IssueCostData | undefined,
  sessions: SessionNode[],
): IssueHeaderModel {
  const cost = costs?.resolvedTotalCost ?? costs?.totalCost ?? 0;
  return {
    issueId,
    title,
    branch: branch ?? derived?.branch?.name,
    projectName,
    phase: derivePhase(derived, sessions),
    cost: cost > 0 ? `$${cost.toFixed(2)}` : undefined,
    prNumber: derived?.pr?.number,
    prUrl: derived?.pr?.url,
  };
}

function deriveNarrative(
  derived: DerivedIssueState | undefined,
  agents: AgentRowModel[],
): IssueNarrativeModel {
  const activeAgent = agents.find((a) => a.active);
  // PAN-3917: there is no stored status history to replay. The activity feed
  // (transcripts) is the record of what happened.
  return {
    now: deriveNowText(derived, activeAgent),
    nextAction: deriveNextAction(derived),
    recentEvents: [],
  };
}

function stepState(
  status: string | undefined,
  active: boolean,
): { status: string; active: boolean; done: boolean } {
  const s = status ?? 'pending';
  return { status: s, active, done: s === 'passed' || s === 'skipped' || s === 'merged' || s === 'completed' };
}

const REVIEWED_STATES = new Set(['in-review', 'changes-requested', 'ready', 'merged', 'closed']);

function derivePipeline(
  derived: DerivedIssueState | undefined,
  sessions: SessionNode[],
): IssuePipelineModel {
  const merged = derived?.state === 'merged';
  const hasPlanSession = sessions.some((s) => s.type === 'planning' || s.type === 'legacy');
  const hasWorkSession = sessions.some((s) => s.type === 'work' || s.type === 'strike');
  const planActive = hasPlanSession && sessions.some((s) => (s.type === 'planning' || s.type === 'legacy') && isAgentRunning(s, undefined));
  const workActive = sessions.some((s) => (s.type === 'work' || s.type === 'strike') && isAgentRunning(s, undefined));
  const reviewSessionActive = sessions.some((s) => (s.type === 'review' || s.type === 'reviewer') && isAgentRunning(s, undefined));
  const reviewed = derived ? REVIEWED_STATES.has(derived.state) : false;
  const checks = derived?.pr?.checks;

  return {
    plan: stepState(hasPlanSession || (derived && derived.state !== 'backlog') ? 'passed' : 'pending', planActive),
    work: stepState(hasWorkSession ? 'passed' : 'pending', workActive),
    review: stepState(
      merged ? 'passed' : derived?.state === 'changes-requested' ? 'failed' : reviewed ? 'passed' : 'pending',
      reviewSessionActive,
    ),
    // The PR's check runs are the test gate — nothing stores a test status.
    test: stepState(
      checks === 'green' ? 'passed' : checks === 'red' ? 'failed' : 'pending',
      checks === 'pending',
    ),
    ship: stepState(merged ? 'merged' : isReadyToMerge(derived) ? 'ready' : 'pending', false),
  };
}

/**
 * PAN-3917 (FR-8): verification is the PR's check runs. There is one gate and
 * the forge owns it — nothing about checks is stored, and there is no cycle counter.
 */
function deriveVerification(derived: DerivedIssueState | undefined): IssueVerificationModel {
  const checks = derived?.pr?.checks;
  const status: VerificationGateModel['status'] =
    checks === 'green' ? 'passed' : checks === 'red' ? 'failed' : checks === 'pending' ? 'running' : 'pending';

  return {
    status: status === 'passed' ? 'passed' : status === 'failed' ? 'failed' : 'pending',
    gates: [{ id: 'checks', label: 'checks', status }],
  };
}

function deriveActivity(activity: ActivityResponse | undefined): IssueActivityModel {
  return {
    sections: activity?.sections ?? [],
    totalCost: activity?.totalCost ?? 0,
    aggregateCost: activity?.aggregateCost ?? null,
  };
}

function deriveResources(workspace: WorkspaceData | undefined): IssueResourcesModel {
  return {
    exists: workspace?.exists ?? false,
    workspace,
  };
}

function deriveOperator(
  sessions: SessionNode[],
  agentsById: Record<string, AgentSnapshot>,
  derived: DerivedIssueState | undefined,
  issue?: Issue,
): IssueOperatorModel {
  const items: OperatorNeedsYou[] = [];

  for (const session of sessions) {
    const agent = findAgentForSession(session, agentsById);
    if (session.awaitingInput || hasPendingInput(agent)) {
      items.push({
        kind: 'awaiting_input',
        sessionId: session.sessionId,
        prompt: session.awaitingInputPrompt ?? agent?.pendingQuestionPrompt ?? agent?.pendingAskUserQuestion?.questions[0]?.question,
        reason: session.awaitingInputReason ?? agent?.pendingQuestionReason,
      });
    }
    if (agent?.paused) {
      items.push({
        kind: 'paused',
        sessionId: session.sessionId,
        reason: agent?.pausedReason,
      });
    }
  }

  if (derived?.attention === 'stuck' || derived?.attention === 'api-error') {
    items.push({ kind: 'stuck', reason: stuckReason(derived) });
  }
  if (derived?.pr && (derived.pr.checks === 'red' || derived.pr.mergeable === false)) {
    items.push({ kind: 'blocker', reason: stuckReason(derived) });
  }

  const labels = new Set((issue?.labels ?? []).map((label) => label.toLowerCase()));
  const needsRelease = issue?.hasPlan === true && labels.has('ready') && !labels.has('released') &&
    !labels.has('parked') && !labels.has('vetoed') && !labels.has('objection');
  if (needsRelease) {
    items.push({ kind: 'pickup_gate', reason: 'The plan is ready, but work cannot be picked up until an operator releases it.' });
  }

  if (isReadyToMerge(derived)) {
    items.push({ kind: 'ready_for_merge' });
  }

  const work = sessions.find((s) => s.type === 'work' || s.type === 'strike');
  if (
    work &&
    !isAgentRunning(work, findAgentForSession(work, agentsById)) &&
    derived?.state !== 'merged'
  ) {
    items.push({ kind: 'stopped', sessionId: work.sessionId });
  }

  const needsYouItems = sortOperatorNeeds(items);
  return { needsYou: needsYouItems[0] ?? null, needsYouItems };
}

export function buildIssueViewModel(
  issueId: string,
  title: string | undefined,
  branch: string | undefined,
  projectName: string | undefined,
  derived: DerivedIssueState | undefined,
  costs: IssueCostData | undefined,
  workspace: WorkspaceData | undefined,
  activity: ActivityResponse | undefined,
  agentsById: Record<string, AgentSnapshot>,
  issue?: Issue,
  panes: readonly BackendPane[] = [],
): IssueViewModel {
  const sessions = (activity?.sections ?? []).map(toSessionNode);
  const agents = sessions.map((session) => buildAgentRow(session, agentsById, costs, panes));

  return {
    header: deriveHeader(issueId, title, branch, projectName, derived, costs, sessions),
    narrative: deriveNarrative(derived, agents),
    pipeline: derivePipeline(derived, sessions),
    agents,
    verification: deriveVerification(derived),
    ship: deriveShip(derived),
    activity: deriveActivity(activity),
    resources: deriveResources(workspace),
    operator: deriveOperator(sessions, agentsById, derived, issue),
  };
}

export function useIssueView(
  issueId: string,
  options?: {
    title?: string;
    branch?: string;
    projectName?: string;
  },
): IssueViewModel {
  const derived = useDerivedIssueState(issueId);
  const panes = useBackendPanes(issueId);
  const costs = useIssueCostsQuery(issueId);
  const workspace = useWorkspaceQuery(issueId);
  const activity = useActivityQuery(issueId);
  const agentsById = useDashboardStore((s) => s.agentsById);
  const issues = (useDashboardStore(selectIssues) as Issue[] | undefined) ?? [];
  const issue = useMemo(
    () => issues.find((candidate) => candidate.identifier.toLowerCase() === issueId.toLowerCase()),
    [issueId, issues],
  );

  return useMemo(
    () =>
      buildIssueViewModel(
        issueId,
        options?.title,
        options?.branch,
        options?.projectName,
        derived,
        costs.data,
        workspace.data,
        activity.data,
        agentsById,
        issue,
        panes,
      ),
    [
      issueId,
      options?.title,
      options?.branch,
      options?.projectName,
      derived,
      costs.data,
      workspace.data,
      activity.data,
      agentsById,
      issue,
      panes,
    ],
  );
}
