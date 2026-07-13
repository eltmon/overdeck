import { useMemo } from 'react';
import type { AgentSnapshot, SessionNode } from '@overdeck/contracts';
import { useDashboardStore } from '../../lib/store';
import {
  useActivityQuery,
  useIssueCostsQuery,
  useReviewStatusQuery,
  useShipLogQuery,
  useWorkspaceQuery,
  type ActivityResponse,
  type ActivitySection,
  type IssueCostData,
  type ReviewStatusData,
  type ShipLogData,
  type WorkspaceData,
} from '../CommandDeck/ZoneCOverviewTabs/queries';
import { deriveShip, isAgentRunning, readyForMerge } from './derivations';
import type {
  AgentRowModel,
  IssueActivityModel,
  IssueBeadsModel,
  IssueHeaderModel,
  IssueNarrativeModel,
  IssueOperatorModel,
  IssuePipelineModel,
  IssueResourcesModel,
  IssueShipModel,
  IssueVerificationModel,
  IssueViewModel,
  OperatorNeedsYou,
  VerificationGateModel,
} from './types';

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
    roundMetadata: section.roundMetadata,
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
    case 'work':
      return 'Work';
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
  if (agent?.paused || session.paused) return 'paused';
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

function buildAgentRow(
  session: SessionNode,
  agentsById: Record<string, AgentSnapshot>,
  costs?: IssueCostData,
): AgentRowModel {
  const agent = findAgentForSession(session, agentsById);
  return {
    sessionId: session.sessionId,
    type: session.type,
    label: deriveAgentLabel(session),
    icon: deriveIconKey(session),
    role: session.role,
    status: deriveAgentStatus(session, agent),
    active: isAgentRunning(session, agent),
    model: shortModel(session.model),
    harness: session.harness,
    cost: findCostForSession(session, costs),
    duration: session.duration ?? null,
    verdict: deriveVerdict(session),
    pendingInput: session.awaitingInput === true || hasPendingInput(agent),
  };
}

function derivePhase(reviewStatus: ReviewStatusData | undefined, sessions: SessionNode[]): string {
  if (reviewStatus?.mergeStatus === 'merged') return 'merged';
  if (reviewStatus?.mergeStatus === 'verifying') return 'verifying';
  if (readyForMerge(reviewStatus)) return 'ready';
  if (reviewStatus?.mergeStatus === 'queued' || reviewStatus?.mergeStatus === 'merging') return 'ship';
  if (reviewStatus?.testStatus === 'testing' || reviewStatus?.verificationStatus === 'running') return 'test';
  if (
    reviewStatus?.reviewStatus === 'reviewing' ||
    reviewStatus?.reviewStatus === 'passed' ||
    reviewStatus?.reviewStatus === 'failed' ||
    reviewStatus?.reviewStatus === 'blocked'
  ) {
    return 'review';
  }

  const runningType = sessions.find((s) => isAgentRunning(s, undefined))?.type;
  if (runningType === 'planning' || runningType === 'legacy') return 'plan';
  if (runningType) return 'work';

  return 'todo';
}

function deriveNowText(reviewStatus: ReviewStatusData | undefined, activeAgent?: AgentRowModel): string {
  if (reviewStatus?.mergeStatus === 'merged') return 'Merged — ready to close out';
  if (readyForMerge(reviewStatus)) return 'Review & tests passed — ready to merge';
  if (reviewStatus?.reviewStatus === 'blocked' || reviewStatus?.reviewStatus === 'failed') {
    return activeAgent?.type === 'work'
      ? 'Review blocked — work agent is fixing it'
      : 'Review blocked — awaiting the work agent';
  }
  if (reviewStatus?.testStatus === 'testing') return 'Tests running';
  if (reviewStatus?.verificationStatus === 'running') return 'Verification running';
  if (activeAgent) return `${activeAgent.label} agent is working`;
  return 'Idle — awaiting the pipeline';
}

function deriveNextAction(reviewStatus: ReviewStatusData | undefined): string {
  if (!reviewStatus) return 'start work';
  if (reviewStatus.mergeStatus === 'merged') return 'merged — close out';
  if (readyForMerge(reviewStatus)) return 'merge to main';
  if (reviewStatus.reviewStatus === 'blocked' || reviewStatus.reviewStatus === 'failed') return 'work agent fixes → re-review';
  if (reviewStatus.reviewStatus === 'reviewing') return 'review in progress';
  if (reviewStatus.testStatus === 'testing') return 'test in progress';
  if (reviewStatus.testStatus === 'failed' || reviewStatus.testStatus === 'dispatch_failed') return 'fix tests → re-run';
  if (reviewStatus.reviewStatus === 'passed' && reviewStatus.testStatus !== 'passed' && reviewStatus.testStatus !== 'skipped') {
    return 'dispatch test';
  }
  return 'awaiting pipeline';
}

function deriveHeader(
  issueId: string,
  title: string | undefined,
  branch: string | undefined,
  projectName: string | undefined,
  reviewStatus: ReviewStatusData | undefined,
  costs: IssueCostData | undefined,
  sessions: SessionNode[],
): IssueHeaderModel {
  const cost = costs?.resolvedTotalCost ?? costs?.totalCost ?? 0;
  return {
    issueId,
    title,
    branch,
    projectName,
    phase: derivePhase(reviewStatus, sessions),
    cost: cost > 0 ? `$${cost.toFixed(2)}` : undefined,
  };
}

function deriveNarrative(
  reviewStatus: ReviewStatusData | undefined,
  agents: AgentRowModel[],
): IssueNarrativeModel {
  const activeAgent = agents.find((a) => a.active);
  const recentEvents = (reviewStatus?.history ?? [])
    .slice()
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 3)
    .map((h) => ({ type: h.type, status: h.status, timestamp: h.timestamp }));

  return {
    now: deriveNowText(reviewStatus, activeAgent),
    nextAction: deriveNextAction(reviewStatus),
    recentEvents,
  };
}

function stepState(
  status: string | undefined,
  active: boolean,
): { status: string; active: boolean; done: boolean } {
  const s = status ?? 'pending';
  return { status: s, active, done: s === 'passed' || s === 'merged' || s === 'completed' };
}

function derivePipeline(
  reviewStatus: ReviewStatusData | undefined,
  sessions: SessionNode[],
): IssuePipelineModel {
  const merged = reviewStatus?.mergeStatus === 'merged';
  const hasPlanSession = sessions.some((s) => s.type === 'planning' || s.type === 'legacy');
  const hasWorkSession = sessions.some((s) => s.type === 'work' || s.type === 'strike');
  const hasReviewSession = sessions.some((s) => s.type === 'review' || s.type === 'reviewer');
  const hasTestSession = sessions.some((s) => s.type === 'test');

  const planActive = hasPlanSession && sessions.some((s) => (s.type === 'planning' || s.type === 'legacy') && isAgentRunning(s, undefined));
  const workActive = sessions.some((s) => (s.type === 'work' || s.type === 'strike') && isAgentRunning(s, undefined));
  const reviewActive = reviewStatus?.reviewStatus === 'reviewing' || sessions.some((s) => (s.type === 'review' || s.type === 'reviewer') && isAgentRunning(s, undefined));
  const testActive = reviewStatus?.testStatus === 'testing' || sessions.some((s) => s.type === 'test' && isAgentRunning(s, undefined));
  const shipActive = reviewStatus?.mergeStatus === 'queued' || reviewStatus?.mergeStatus === 'merging' || reviewStatus?.mergeStatus === 'verifying';

  return {
    plan: stepState(hasPlanSession ? 'passed' : 'pending', planActive),
    work: stepState(hasWorkSession ? 'passed' : 'pending', workActive),
    review: stepState(
      merged || reviewStatus?.reviewStatus === 'passed' || hasReviewSession ? 'passed' : 'pending',
      reviewActive,
    ),
    test: stepState(
      merged || reviewStatus?.testStatus === 'passed' || reviewStatus?.testStatus === 'skipped' || hasTestSession
        ? 'passed'
        : 'pending',
      testActive,
    ),
    ship: stepState(merged ? 'merged' : readyForMerge(reviewStatus) ? 'ready' : reviewStatus?.mergeStatus ?? 'pending', shipActive),
  };
}

function qualityGateStatus(
  gate: string,
  reviewStatus: ReviewStatusData | undefined,
): VerificationGateModel['status'] {
  const notes = reviewStatus?.verificationNotes ?? '';
  const failedMatch = notes.match(/Verification FAILED at (typecheck|lint|test)\b/i);
  const failedIdx = failedMatch ? ['typecheck', 'lint', 'test'].indexOf(failedMatch[1]!.toLowerCase()) : -1;
  const gateIdx = ['typecheck', 'lint', 'test'].indexOf(gate);

  if (reviewStatus?.verificationStatus === 'passed') return 'passed';
  if (reviewStatus?.verificationStatus === 'failed') {
    if (failedIdx < 0) return 'failed';
    if (gateIdx < failedIdx) return 'passed';
    if (gateIdx === failedIdx) return 'failed';
    return 'pending';
  }
  if (reviewStatus?.verificationStatus === 'running') return gateIdx === 0 ? 'running' : 'pending';
  if (reviewStatus?.verificationStatus === 'skipped') return 'skipped';
  return 'pending';
}

function deriveVerification(reviewStatus: ReviewStatusData | undefined): IssueVerificationModel {
  const cycle = reviewStatus?.verificationCycleCount
    ? `cycle ${reviewStatus.verificationCycleCount}${reviewStatus.verificationMaxCycles ? `/${reviewStatus.verificationMaxCycles}` : ''}`
    : undefined;

  const gates: VerificationGateModel[] = [
    { id: 'typecheck', label: 'typecheck', status: qualityGateStatus('typecheck', reviewStatus) },
    { id: 'lint', label: 'lint', status: qualityGateStatus('lint', reviewStatus) },
    { id: 'test', label: 'test', status: qualityGateStatus('test', reviewStatus) },
  ];

  return {
    status: reviewStatus?.verificationStatus ?? 'pending',
    cycle,
    gates,
  };
}

function toShipLogModel(data: ShipLogData | undefined): import('./types').ShipLogModel | null {
  if (!data?.log) return null;
  return {
    startedAt: data.log.startedAt,
    updatedAt: data.log.updatedAt,
    step: data.log.step,
    lines: data.log.lines,
  };
}

function deriveBeads(): IssueBeadsModel {
  // Placeholder: WI-4b will wire the real beads panel via the canonical beads resolver.
  return { total: 0, completed: 0, percent: 0 };
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
  reviewStatus: ReviewStatusData | undefined,
): IssueOperatorModel {
  if (readyForMerge(reviewStatus)) {
    return { needsYou: { kind: 'ready_for_merge' } };
  }

  for (const session of sessions) {
    const agent = findAgentForSession(session, agentsById);
    if (session.troubled || agent?.troubled) {
      const needsYou: OperatorNeedsYou = {
        kind: 'troubled',
        sessionId: session.sessionId,
        reason: session.troubledReason ?? agent?.troubledReason,
      };
      return { needsYou };
    }
    if (session.paused || agent?.paused) {
      const needsYou: OperatorNeedsYou = {
        kind: 'paused',
        sessionId: session.sessionId,
        reason: session.pausedReason ?? agent?.pausedReason,
      };
      return { needsYou };
    }
  }

  const work = sessions.find((s) => s.type === 'work' || s.type === 'strike');
  if (
    work &&
    !isAgentRunning(work, findAgentForSession(work, agentsById)) &&
    reviewStatus?.mergeStatus !== 'merged' &&
    !readyForMerge(reviewStatus)
  ) {
    return { needsYou: { kind: 'stopped', sessionId: work.sessionId } };
  }

  return { needsYou: null };
}

export function buildIssueViewModel(
  issueId: string,
  title: string | undefined,
  branch: string | undefined,
  projectName: string | undefined,
  reviewStatus: ReviewStatusData | undefined,
  costs: IssueCostData | undefined,
  workspace: WorkspaceData | undefined,
  activity: ActivityResponse | undefined,
  agentsById: Record<string, AgentSnapshot>,
  shipLog?: ShipLogData | undefined,
): IssueViewModel {
  const sessions = (activity?.sections ?? []).map(toSessionNode);
  const agents = sessions.map((session) => buildAgentRow(session, agentsById, costs));

  return {
    header: deriveHeader(issueId, title, branch, projectName, reviewStatus, costs, sessions),
    narrative: deriveNarrative(reviewStatus, agents),
    pipeline: derivePipeline(reviewStatus, sessions),
    agents,
    verification: deriveVerification(reviewStatus),
    ship: deriveShip(reviewStatus, toShipLogModel(shipLog)),
    beads: deriveBeads(),
    activity: deriveActivity(activity),
    resources: deriveResources(workspace),
    operator: deriveOperator(sessions, agentsById, reviewStatus),
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
  const review = useReviewStatusQuery(issueId);
  const costs = useIssueCostsQuery(issueId);
  const workspace = useWorkspaceQuery(issueId);
  const activity = useActivityQuery(issueId);
  const shipLog = useShipLogQuery(issueId);
  const agentsById = useDashboardStore((s) => s.agentsById);

  return useMemo(
    () =>
      buildIssueViewModel(
        issueId,
        options?.title,
        options?.branch,
        options?.projectName,
        review.data,
        costs.data,
        workspace.data,
        activity.data,
        agentsById,
        shipLog.data,
      ),
    [
      issueId,
      options?.title,
      options?.branch,
      options?.projectName,
      review.data,
      costs.data,
      workspace.data,
      activity.data,
      agentsById,
      shipLog.data,
    ],
  );
}
