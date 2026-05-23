import type { WorkspaceInfo } from './workspace-types';
import type { Agent, WorkAgentLifecycle } from '../types';
import { isReviewPipelineStuck } from './pipeline-state';
import { derivePipelineState, normalizeCanonicalState, type PipelineReviewStatus } from './issuePipelineState';

export type PipelinePhase =
  | 'QUEUED_FOR_PLAN'
  | 'PLANNING'
  | 'PLANNED_IDLE'
  | 'WORK_RUNNING'
  | 'INPUT'
  | 'REVIEW_RUNNING'
  | 'SHIP_RUNNING'
  | 'CHANGES_REQUESTED'
  | 'STUCK'
  | 'READY_TO_MERGE'
  | 'MERGED';

export type IssueActionKey =
  | 'plan'
  | 'autoPlan'
  | 'watchPlanning'
  | 'donePlanning'
  | 'startAgent'
  | 'startSkipPlanning'
  | 'swarm'
  | 'tell'
  | 'doneWork'
  | 'requestReview'
  | 'restartReview'
  | 'recoverReview'
  | 'stopAgent'
  | 'pause'
  | 'unpause'
  | 'untroubled'
  | 'recoverAgent'
  | 'resumeSession'
  | 'switchModel'
  | 'syncMain'
  | 'inspectBead'
  | 'reopen'
  | 'closeOut'
  | 'wipe'
  | 'destroyWorkspace'
  | 'open'
  | 'resetIssue'
  | 'viewPr'
  | 'cancel'
  | 'beads'
  | 'inference'
  | 'discussions'
  | 'transcripts'
  | 'upload'
  | 'syncDiscussions'
  | 'statusReview'
  | 'createWorkspace'
  | 'copySettings'
  | 'resetSession'
  | 'restartFromPlan'
  | 'restartAgent'
  | 'reviewTest';

export type IssueActionKind = 'safe' | 'dialog' | 'destructive';

export type IssueActionGroup =
  | 'planning'
  | 'work'
  | 'review'
  | 'agent'
  | 'workspace'
  | 'artifacts'
  | 'danger'
  | 'navigation'
  | 'preserved';

export interface IssueActionState {
  reviewStatus?: PipelineReviewStatus | null;
  agent?: Pick<Agent, 'status' | 'role' | 'agentPhase' | 'git' | 'paused' | 'troubled'> | null;
  lifecycle?: Pick<WorkAgentLifecycle, 'canResumeSession'> | null;
  workspace?: Pick<WorkspaceInfo, 'exists' | 'path' | 'mrUrl'> | null;
  hasPlan: boolean;
  hasBeads: boolean;
  hasInference?: boolean;
  hasTranscripts?: boolean;
  hasDiscussions?: boolean;
  issueCanonicalState?: string | null;
  isMerged?: boolean;
  hasPr?: boolean;
  prUrl?: string | null;
  selectedBeadId?: string | null;
  hasPendingInput?: boolean;
}

export interface IssueActionEntry {
  key: IssueActionKey;
  label: string;
  panVerb: string | null;
  endpoint: string | null;
  enabledWhen: (state: IssueActionState) => boolean;
  phasePrimary: PipelinePhase[];
  kind: IssueActionKind;
  group: IssueActionGroup;
}

const always = () => true;
const hasAgent = (state: IssueActionState) => !!state.agent;
const hasWorkspace = (state: IssueActionState) => state.workspace?.exists === true;
const hasLiveAgent = (state: IssueActionState) => !!state.agent && !['stopped', 'failed', 'dead', 'error', 'stuck'].includes(state.agent.status);
const hasStoppedAgent = (state: IssueActionState) => !hasLiveAgent(state);
const hasResumableSession = (state: IssueActionState) => hasStoppedAgent(state) && state.lifecycle?.canResumeSession === true;
const hasSelectedBead = (state: IssueActionState) => !!state.selectedBeadId;
const isPaused = (state: IssueActionState) => state.agent?.paused === true;
const isTroubled = (state: IssueActionState) => state.agent?.troubled === true;
const canonicalState = (state: IssueActionState) => normalizeCanonicalState(state.issueCanonicalState);
const isTodo = (state: IssueActionState) => {
  const canonical = canonicalState(state);
  return canonical === 'todo' || canonical === 'backlog';
};
const isDoneOrCanceled = (state: IssueActionState) => {
  const canonical = canonicalState(state);
  return canonical === 'done' || canonical === 'canceled';
};
const isMerged = (state: IssueActionState) => state.isMerged === true || state.reviewStatus?.mergeStatus === 'merged';
const canPlan = (state: IssueActionState) => hasStoppedAgent(state) && !state.hasPlan && !isMerged(state) && !isDoneOrCanceled(state);
const canFinalizePlanning = (state: IssueActionState) => state.hasPlan && state.agent?.role === 'plan' && hasStoppedAgent(state) && !isMerged(state);
const canStartAgent = (state: IssueActionState) => hasStoppedAgent(state) && state.hasPlan && !isMerged(state) && !isDoneOrCanceled(state);
const canStartWithoutPlanning = (state: IssueActionState) => hasStoppedAgent(state) && !state.hasPlan && isTodo(state) && !isMerged(state);
const hasParallelizablePlan = (state: IssueActionState) => canStartAgent(state) && state.hasBeads;
const canRequestReview = (state: IssueActionState) => hasWorkspace(state) && hasStoppedAgent(state) && !state.reviewStatus && !isMerged(state) && !isDoneOrCanceled(state);
const canRestartReview = (state: IssueActionState) => {
  const review = state.reviewStatus;
  return review?.reviewStatus === 'reviewing' || review?.reviewStatus === 'blocked' || review?.reviewStatus === 'failed' || review?.testStatus === 'testing' || review?.testStatus === 'failed' || review?.testStatus === 'dispatch_failed' || review?.mergeStatus === 'merging' || review?.mergeStatus === 'failed';
};
const hasReviewFailure = (state: IssueActionState) => isReviewPipelineStuck(state.reviewStatus ?? null);
const canRecoverAgent = (state: IssueActionState) => state.agent?.status === 'stopped' || state.agent?.status === 'stuck' || state.agent?.status === 'failed' || state.agent?.status === 'dead' || state.agent?.status === 'error';
const hasPrTarget = (state: IssueActionState) => state.hasPr === true || !!state.prUrl || !!state.workspace?.mrUrl || state.reviewStatus?.readyForMerge === true;
const canCloseOut = (state: IssueActionState) => {
  const canonical = canonicalState(state);
  return canonical === 'verifying_on_main' || canonical === 'verifying' || isMerged(state);
};
const canCancelIssue = (state: IssueActionState) => {
  const canonical = canonicalState(state);
  return canonical !== 'verifying_on_main' && canonical !== 'verifying' && !isMerged(state) && !isDoneOrCanceled(state);
};

const phasePrimary = (key: IssueActionKey): PipelinePhase[] => PHASE_PRIMARY_ACTION_KEYS_BY_ACTION[key] ?? [];

const PHASE_PRIMARY_KEYS: Record<PipelinePhase, IssueActionKey[]> = {
  QUEUED_FOR_PLAN: ['plan', 'startAgent'],
  PLANNING: ['watchPlanning', 'donePlanning'],
  PLANNED_IDLE: ['startAgent'],
  WORK_RUNNING: ['tell', 'doneWork'],
  INPUT: ['open', 'tell'],
  REVIEW_RUNNING: ['tell', 'recoverAgent'],
  SHIP_RUNNING: ['tell', 'recoverAgent'],
  CHANGES_REQUESTED: ['open', 'requestReview'],
  STUCK: ['recoverAgent', 'tell'],
  READY_TO_MERGE: ['viewPr'],
  MERGED: ['closeOut'],
};

const PHASE_PRIMARY_ACTION_KEYS_BY_ACTION: Partial<Record<IssueActionKey, PipelinePhase[]>> = Object.fromEntries(
  Object.entries(PHASE_PRIMARY_KEYS).flatMap(([phase, keys]) => keys.map((key) => [key, phase]))
    .reduce<Map<IssueActionKey, PipelinePhase[]>>((acc, [key, phase]) => {
      const actionKey = key as IssueActionKey;
      const actionPhases = acc.get(actionKey) ?? [];
      actionPhases.push(phase as PipelinePhase);
      acc.set(actionKey, actionPhases);
      return acc;
    }, new Map())
) as Partial<Record<IssueActionKey, PipelinePhase[]>>;

export const ISSUE_ACTIONS: IssueActionEntry[] = [
  { key: 'plan', label: 'Plan', panVerb: 'plan', endpoint: '/api/issues/:id/start-planning', enabledWhen: canPlan, phasePrimary: phasePrimary('plan'), kind: 'dialog', group: 'planning' },
  { key: 'autoPlan', label: 'Auto-plan', panVerb: 'plan --auto', endpoint: '/api/issues/:id/plan', enabledWhen: canPlan, phasePrimary: [], kind: 'dialog', group: 'planning' },
  { key: 'watchPlanning', label: 'Watch planning', panVerb: null, endpoint: null, enabledWhen: (state) => deriveIssueActionPhase(state) === 'PLANNING', phasePrimary: phasePrimary('watchPlanning'), kind: 'dialog', group: 'planning' },
  { key: 'donePlanning', label: 'Done planning', panVerb: 'plan', endpoint: '/api/issues/:id/complete-planning', enabledWhen: canFinalizePlanning, phasePrimary: phasePrimary('donePlanning'), kind: 'safe', group: 'planning' },
  { key: 'startAgent', label: 'Start agent', panVerb: 'start', endpoint: '/api/agents', enabledWhen: canStartAgent, phasePrimary: phasePrimary('startAgent'), kind: 'dialog', group: 'work' },
  { key: 'startSkipPlanning', label: 'Start without planning', panVerb: 'start --auto', endpoint: '/api/agents', enabledWhen: canStartWithoutPlanning, phasePrimary: [], kind: 'dialog', group: 'work' },
  { key: 'swarm', label: 'Swarm', panVerb: 'swarm', endpoint: '/api/issues/:id/swarm', enabledWhen: hasParallelizablePlan, phasePrimary: [], kind: 'dialog', group: 'work' },
  { key: 'tell', label: 'Tell agent', panVerb: 'tell', endpoint: '/api/agents/:agentId/tell', enabledWhen: hasLiveAgent, phasePrimary: phasePrimary('tell'), kind: 'dialog', group: 'agent' },
  { key: 'doneWork', label: 'Done', panVerb: 'done', endpoint: '/api/issues/:id/done', enabledWhen: (state) => hasLiveAgent(state) && deriveIssueActionPhase(state) === 'WORK_RUNNING', phasePrimary: phasePrimary('doneWork'), kind: 'safe', group: 'work' },
  { key: 'requestReview', label: 'Request review', panVerb: 'review', endpoint: '/api/review/:id/trigger', enabledWhen: canRequestReview, phasePrimary: phasePrimary('requestReview'), kind: 'safe', group: 'review' },
  { key: 'restartReview', label: 'Restart review', panVerb: 'review --force', endpoint: '/api/review/:id/trigger?force=true', enabledWhen: canRestartReview, phasePrimary: [], kind: 'safe', group: 'review' },
  { key: 'recoverReview', label: 'Recover review', panVerb: 'review --recover', endpoint: '/api/review/:id/recover', enabledWhen: hasReviewFailure, phasePrimary: [], kind: 'safe', group: 'review' },
  { key: 'stopAgent', label: 'Stop agent', panVerb: 'stop', endpoint: '/api/agents/:agentId/stop', enabledWhen: hasLiveAgent, phasePrimary: [], kind: 'safe', group: 'agent' },
  { key: 'pause', label: 'Pause agent', panVerb: 'pause', endpoint: '/api/agents/:agentId/pause', enabledWhen: (state) => hasLiveAgent(state) && !isPaused(state), phasePrimary: [], kind: 'dialog', group: 'agent' },
  { key: 'unpause', label: 'Unpause agent', panVerb: 'unpause', endpoint: '/api/agents/:agentId/unpause', enabledWhen: isPaused, phasePrimary: [], kind: 'safe', group: 'agent' },
  { key: 'untroubled', label: 'Clear troubled gate', panVerb: 'untroubled', endpoint: '/api/agents/:agentId/untroubled', enabledWhen: isTroubled, phasePrimary: [], kind: 'safe', group: 'agent' },
  { key: 'recoverAgent', label: 'Recover agent', panVerb: 'recover', endpoint: '/api/agents/:agentId/recover', enabledWhen: canRecoverAgent, phasePrimary: phasePrimary('recoverAgent'), kind: 'safe', group: 'agent' },
  { key: 'resumeSession', label: 'Resume session', panVerb: 'resume', endpoint: '/api/agents/:agentId/resume', enabledWhen: hasResumableSession, phasePrimary: [], kind: 'dialog', group: 'agent' },
  { key: 'switchModel', label: 'Switch model', panVerb: null, endpoint: null, enabledWhen: hasLiveAgent, phasePrimary: [], kind: 'dialog', group: 'agent' },
  { key: 'syncMain', label: 'Sync main', panVerb: 'sync-main', endpoint: '/api/issues/:id/sync-main', enabledWhen: hasWorkspace, phasePrimary: [], kind: 'safe', group: 'workspace' },
  { key: 'inspectBead', label: 'Inspect bead', panVerb: 'inspect --bead', endpoint: '/api/issues/:id/beads/:beadId/inspect', enabledWhen: hasSelectedBead, phasePrimary: [], kind: 'dialog', group: 'review' },
  { key: 'reopen', label: 'Reopen', panVerb: 'reopen', endpoint: '/api/issues/:id/reopen', enabledWhen: isDoneOrCanceled, phasePrimary: [], kind: 'safe', group: 'danger' },
  { key: 'closeOut', label: 'Close out', panVerb: 'close', endpoint: '/api/issues/:id/close-out', enabledWhen: canCloseOut, phasePrimary: phasePrimary('closeOut'), kind: 'destructive', group: 'danger' },
  { key: 'wipe', label: 'Wipe', panVerb: 'wipe', endpoint: '/api/issues/:id/deep-wipe', enabledWhen: always, phasePrimary: [], kind: 'destructive', group: 'danger' },
  { key: 'destroyWorkspace', label: 'Destroy workspace', panVerb: 'destroy', endpoint: '/api/issues/:id/cleanup-workspace', enabledWhen: hasWorkspace, phasePrimary: [], kind: 'destructive', group: 'danger' },
  { key: 'open', label: 'Open', panVerb: 'open', endpoint: null, enabledWhen: hasWorkspace, phasePrimary: phasePrimary('open'), kind: 'safe', group: 'navigation' },
  { key: 'resetIssue', label: 'Reset issue', panVerb: 'reset', endpoint: '/api/issues/:id/reset', enabledWhen: always, phasePrimary: [], kind: 'destructive', group: 'danger' },
  { key: 'viewPr', label: 'View PR', panVerb: null, endpoint: null, enabledWhen: hasPrTarget, phasePrimary: phasePrimary('viewPr'), kind: 'safe', group: 'navigation' },
  { key: 'cancel', label: 'Cancel issue', panVerb: null, endpoint: '/api/issues/:id/cancel', enabledWhen: canCancelIssue, phasePrimary: [], kind: 'destructive', group: 'danger' },
  { key: 'beads', label: 'Beads', panVerb: null, endpoint: '/api/issues/:id/beads', enabledWhen: (state) => state.hasBeads || state.hasPlan, phasePrimary: [], kind: 'safe', group: 'artifacts' },
  { key: 'inference', label: 'Inference', panVerb: null, endpoint: null, enabledWhen: (state) => state.hasInference === true, phasePrimary: [], kind: 'safe', group: 'artifacts' },
  { key: 'discussions', label: 'Discussions', panVerb: null, endpoint: null, enabledWhen: (state) => state.hasDiscussions === true, phasePrimary: [], kind: 'safe', group: 'artifacts' },
  { key: 'transcripts', label: 'Transcripts', panVerb: null, endpoint: null, enabledWhen: (state) => state.hasTranscripts === true, phasePrimary: [], kind: 'safe', group: 'artifacts' },
  { key: 'upload', label: 'Upload transcript', panVerb: null, endpoint: null, enabledWhen: always, phasePrimary: [], kind: 'dialog', group: 'artifacts' },
  { key: 'syncDiscussions', label: 'Sync discussions', panVerb: null, endpoint: '/api/issues/:id/discussions/sync', enabledWhen: always, phasePrimary: [], kind: 'dialog', group: 'artifacts' },
  { key: 'statusReview', label: 'Status review', panVerb: null, endpoint: '/api/review/:id/status', enabledWhen: always, phasePrimary: [], kind: 'safe', group: 'artifacts' },
  { key: 'createWorkspace', label: 'Create workspace', panVerb: null, endpoint: '/api/workspaces', enabledWhen: (state) => !hasWorkspace(state), phasePrimary: [], kind: 'dialog', group: 'workspace' },
  { key: 'copySettings', label: 'Copy settings', panVerb: null, endpoint: '/api/issues/:id/copy-settings', enabledWhen: hasWorkspace, phasePrimary: [], kind: 'dialog', group: 'workspace' },
  { key: 'resetSession', label: 'Reset session', panVerb: null, endpoint: '/api/agents/:agentId/reset-session', enabledWhen: hasResumableSession, phasePrimary: [], kind: 'destructive', group: 'agent' },
  { key: 'restartFromPlan', label: 'Restart from plan', panVerb: 'restart --from-plan', endpoint: '/api/agents', enabledWhen: (state) => state.hasPlan && !isMerged(state), phasePrimary: [], kind: 'destructive', group: 'danger' },
  { key: 'restartAgent', label: 'Restart agent', panVerb: 'restart', endpoint: '/api/agents/:agentId/restart', enabledWhen: (state) => hasAgent(state) && !isMerged(state), phasePrimary: [], kind: 'destructive', group: 'agent' },
  { key: 'reviewTest', label: 'Review & test', panVerb: 'review', endpoint: '/api/review/:id/trigger', enabledWhen: hasWorkspace, phasePrimary: [], kind: 'dialog', group: 'preserved' },
];

const ACTION_BY_KEY = new Map(ISSUE_ACTIONS.map((action) => [action.key, action]));

export function getEnabledActions(state: IssueActionState): IssueActionEntry[] {
  return ISSUE_ACTIONS.filter((action) => action.enabledWhen(state));
}

export function getPhasePrimaryActions(_state: IssueActionState, phase: PipelinePhase): IssueActionEntry[] {
  return PHASE_PRIMARY_KEYS[phase]
    .map((key) => ACTION_BY_KEY.get(key))
    .filter((action): action is IssueActionEntry => !!action);
}

export function deriveIssueActionPhase(state: IssueActionState): PipelinePhase {
  if (state.hasPendingInput) return 'INPUT';
  if (state.agent?.status === 'stuck' || state.agent?.status === 'failed' || state.agent?.status === 'error') return 'STUCK';
  if (hasReviewFailure(state)) return 'STUCK';

  switch (derivePipelineState(state)) {
    case 'planning_active':
      return 'PLANNING';
    case 'planning_done_awaiting_work':
      return 'PLANNED_IDLE';
    case 'in_progress_work_running':
      return 'WORK_RUNNING';
    case 'in_progress_work_idle':
      return 'PLANNED_IDLE';
    case 'in_review_reviewers_running':
    case 'testing_running':
      return 'REVIEW_RUNNING';
    case 'in_review_changes_requested':
      return 'CHANGES_REQUESTED';
    case 'ready_to_merge':
      return 'READY_TO_MERGE';
    case 'merging':
      return 'SHIP_RUNNING';
    case 'verifying':
    case 'merged':
    case 'done':
      return 'MERGED';
    default:
      return state.hasPlan ? 'PLANNED_IDLE' : 'QUEUED_FOR_PLAN';
  }
}
