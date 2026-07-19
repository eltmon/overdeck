import type { SessionNode } from '@overdeck/contracts';
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
  | 'tell'
  | 'doneWork'
  | 'requestReview'
  | 'restartReview'
  | 'recoverReview'
  | 'purgeReview'
  | 'stopAgent'
  | 'pause'
  | 'unpause'
  | 'untroubled'
  | 'recoverAgent'
  | 'resumeSession'
  | 'syncMain'
  | 'rebuildAndStart'
  | 'inspectTask'
  | 'reopen'
  | 'closeOut'
  | 'wipe'
  | 'destroyWorkspace'
  | 'open'
  | 'resetIssue'
  | 'resetToPlanned'
  | 'viewPr'
  | 'cancel'
  | 'tasks'
  | 'inference'
  | 'discussions'
  | 'transcripts'
  | 'upload'
  | 'syncDiscussions'
  | 'statusReview'
  | 'createWorkspace'
  | 'copySettings'
  | 'resetSession'
  | 'completeWorkReset'
  | 'restartFromPlan'
  | 'restartAgent';

export type IssueActionKind = 'safe' | 'dialog' | 'destructive';

export type IssueActionGroup =
  | 'planning'
  | 'work'
  | 'review'
  | 'agent'
  | 'workspace'
  | 'artifacts'
  | 'danger'
  | 'navigation';

export const GROUP_LABELS: Record<IssueActionGroup, string> = {
  planning: 'Planning',
  work: 'Work',
  review: 'Review & Test',
  agent: 'Agent',
  workspace: 'Workspace',
  artifacts: 'Artifacts',
  navigation: 'Navigation',
  danger: 'Danger',
};

export const GROUP_ORDER: IssueActionGroup[] = [
  'planning',
  'work',
  'review',
  'agent',
  'workspace',
  'artifacts',
  'navigation',
  'danger',
];

export interface IssueActionState {
  reviewStatus?: PipelineReviewStatus | null;
  agent?: Pick<Agent, 'status' | 'role' | 'agentPhase' | 'git' | 'paused' | 'troubled'> | null;
  lifecycle?: Pick<WorkAgentLifecycle, 'canResumeSession'> | null;
  workspace?: Pick<WorkspaceInfo, 'exists' | 'path' | 'mrUrl'> | null;
  hasPlan: boolean;
  hasTasks: boolean;
  hasInference?: boolean;
  hasTranscripts?: boolean;
  hasDiscussions?: boolean;
  issueCanonicalState?: string | null;
  isMerged?: boolean;
  hasPr?: boolean;
  prUrl?: string | null;
  selectedTaskId?: string | null;
  hasPendingInput?: boolean;
}

interface ActionEntryBase<Key extends string> {
  key: Key;
  label: string;
  description: string;
  kind: IssueActionKind;
}

export interface IssueActionEntry extends ActionEntryBase<IssueActionKey> {
  scope: 'issue';
  panVerb: string | null;
  endpoint: string | null;
  enabledWhen: (state: IssueActionState) => boolean;
  phasePrimary: PipelinePhase[];
  group: IssueActionGroup;
}

export type NonIssueActionScope = 'project' | 'container' | 'session-artifact' | 'agent-state' | 'session';
export type NonIssueActionOwnerSurface = 'ProjectNode' | 'ContainerNode' | 'FeatureItem' | 'ZoneBActionStrip';
export type NonIssueActionKey =
  | 'copyProjectName'
  | 'viewContainerLogs'
  | 'inspectContainer'
  | 'restartContainer'
  | 'stopContainer'
  | 'startContainer'
  | 'openStateDir'
  | 'viewJsonl'
  | 'deepWipe'
  | 'stopSession'
  | 'viewTerminal'
  | 'pauseSession'
  | 'resumeFocusedSession'
  | 'restartSession'
  | 'replaySession'
  | 'viewState'
  | 'viewFocusedXbrief'
  | 'copySessionId'
  | 'copyTmuxCommand'
  | 'exportSessionMetadata'
  | 'exportRoundHistory';

export interface NonIssueActionContext {
  projectName?: string;
  containerName?: string;
  containerStatus?: 'running' | 'stopped' | 'unhealthy' | 'restarting';
  sessionId?: string;
  issueId?: string;
  sessionType?: SessionNode['type'];
  sessionPresence?: string;
  tmuxSession?: string | null;
  hasJsonl?: boolean;
  roundCount?: number;
  onCopyProjectName?: (projectName: string) => void | Promise<void>;
  onViewContainerLogs?: (containerName: string) => void | Promise<void>;
  onInspectContainer?: (containerName: string) => void | Promise<void>;
  onRestartContainer?: (containerName: string) => void | Promise<void>;
  onStopContainer?: (containerName: string) => void | Promise<void>;
  onStartContainer?: (containerName: string) => void | Promise<void>;
  onOpenStateDir?: (sessionId: string) => void | Promise<void>;
  onViewJsonl?: (sessionId: string) => void | Promise<void>;
  onDeepWipe?: (issueId: string) => void | Promise<void>;
  onStopSession?: (sessionId: string) => void | Promise<void>;
  onViewTerminal?: (sessionId: string) => void | Promise<void>;
  onPauseSession?: (sessionId: string) => void | Promise<void>;
  onResumeSession?: (sessionId: string) => void | Promise<void>;
  onRestartSession?: (sessionId: string) => void | Promise<void>;
  onReplaySession?: (sessionId: string) => void | Promise<void>;
  onViewState?: (sessionId: string) => void | Promise<void>;
  onViewXbrief?: (issueId: string) => void | Promise<void>;
  onCopySessionId?: (sessionId: string) => void | Promise<void>;
  onCopyTmuxCommand?: (tmuxSession: string) => void | Promise<void>;
  onExportSessionMetadata?: (sessionId: string) => void | Promise<void>;
  onExportRoundHistory?: (sessionId: string) => void | Promise<void>;
}

export interface NonIssueActionConfirmSpec {
  title: string;
  message: (context: NonIssueActionContext) => string;
  confirmLabel: string;
  variant: 'default' | 'destructive';
}

export interface NonIssueActionEntry extends ActionEntryBase<NonIssueActionKey> {
  scope: NonIssueActionScope;
  ownerSurface: NonIssueActionOwnerSurface;
  enabledWhen: (context: NonIssueActionContext) => boolean;
  invoke: (context: NonIssueActionContext) => void | Promise<void>;
  confirm: NonIssueActionConfirmSpec | null;
}

export type ActionEntry = IssueActionEntry | NonIssueActionEntry;

const hasText = (value: string | null | undefined): value is string => !!value;
const invokeWithText = (
  value: string | null | undefined,
  invoke: ((value: string) => void | Promise<void>) | undefined,
): void | Promise<void> => {
  if (hasText(value) && invoke) return invoke(value);
};
const canStopSession = (context: NonIssueActionContext) =>
  hasText(context.sessionId)
  && !!context.onStopSession
  && ['active', 'idle', 'suspended'].includes(context.sessionPresence ?? '');

export const PROJECT_TREE_CONTEXT_ACTIONS: NonIssueActionEntry[] = [
  {
    key: 'copyProjectName',
    label: 'Copy project name',
    description: 'Copy the project name to the clipboard.',
    scope: 'project',
    ownerSurface: 'ProjectNode',
    enabledWhen: (context) => hasText(context.projectName) && !!context.onCopyProjectName,
    invoke: (context) => invokeWithText(context.projectName, context.onCopyProjectName),
    kind: 'safe',
    confirm: null,
  },
  {
    key: 'viewContainerLogs',
    label: 'View Logs',
    description: 'Open the selected container logs.',
    scope: 'container',
    ownerSurface: 'ContainerNode',
    enabledWhen: (context) => hasText(context.containerName) && !!context.onViewContainerLogs,
    invoke: (context) => invokeWithText(context.containerName, context.onViewContainerLogs),
    kind: 'safe',
    confirm: null,
  },
  {
    key: 'inspectContainer',
    label: 'Inspect',
    description: 'Inspect the selected container.',
    scope: 'container',
    ownerSurface: 'ContainerNode',
    enabledWhen: (context) => hasText(context.containerName) && !!context.onInspectContainer,
    invoke: (context) => invokeWithText(context.containerName, context.onInspectContainer),
    kind: 'safe',
    confirm: null,
  },
  {
    key: 'restartContainer',
    label: 'Restart',
    description: 'Restart the running container.',
    scope: 'container',
    ownerSurface: 'ContainerNode',
    enabledWhen: (context) => context.containerStatus === 'running' && hasText(context.containerName) && !!context.onRestartContainer,
    invoke: (context) => invokeWithText(context.containerName, context.onRestartContainer),
    kind: 'safe',
    confirm: null,
  },
  {
    key: 'stopContainer',
    label: 'Stop',
    description: 'Stop the running container.',
    scope: 'container',
    ownerSurface: 'ContainerNode',
    enabledWhen: (context) => context.containerStatus === 'running' && hasText(context.containerName) && !!context.onStopContainer,
    invoke: (context) => invokeWithText(context.containerName, context.onStopContainer),
    kind: 'safe',
    confirm: null,
  },
  {
    key: 'startContainer',
    label: 'Start',
    description: 'Start the stopped container.',
    scope: 'container',
    ownerSurface: 'ContainerNode',
    enabledWhen: (context) => context.containerStatus === 'stopped' && hasText(context.containerName) && !!context.onStartContainer,
    invoke: (context) => invokeWithText(context.containerName, context.onStartContainer),
    kind: 'safe',
    confirm: null,
  },
  {
    key: 'openStateDir',
    label: 'Open State Dir',
    description: 'Open the selected session state directory.',
    scope: 'session-artifact',
    ownerSurface: 'FeatureItem',
    enabledWhen: (context) => hasText(context.sessionId) && !!context.onOpenStateDir,
    invoke: (context) => invokeWithText(context.sessionId, context.onOpenStateDir),
    kind: 'safe',
    confirm: null,
  },
  {
    key: 'viewJsonl',
    label: 'View JSONL',
    description: 'Open the selected session JSONL transcript.',
    scope: 'session-artifact',
    ownerSurface: 'FeatureItem',
    enabledWhen: (context) => hasText(context.sessionId) && context.hasJsonl === true && !!context.onViewJsonl,
    invoke: (context) => invokeWithText(context.sessionId, context.onViewJsonl),
    kind: 'safe',
    confirm: null,
  },
  {
    key: 'deepWipe',
    label: 'Deep Wipe',
    description: 'Destroy the issue workspace, agent state, and git branches.',
    scope: 'agent-state',
    ownerSurface: 'FeatureItem',
    enabledWhen: (context) => hasText(context.issueId) && !!context.onDeepWipe,
    invoke: (context) => invokeWithText(context.issueId, context.onDeepWipe),
    kind: 'destructive',
    confirm: {
      title: 'Deep Wipe',
      message: (context) => `Deep wipe will destroy all data for ${context.issueId ?? 'this issue'} including workspace, state, and git branches. This cannot be undone.`,
      confirmLabel: 'Deep Wipe',
      variant: 'destructive',
    },
  },
];

export const ZONE_B_SESSION_ACTIONS: NonIssueActionEntry[] = [
  {
    key: 'stopSession',
    label: 'Stop',
    description: 'Stop session',
    scope: 'session',
    ownerSurface: 'ZoneBActionStrip',
    enabledWhen: canStopSession,
    invoke: (context) => invokeWithText(context.sessionId, context.onStopSession),
    kind: 'destructive',
    confirm: {
      title: 'Stop Session',
      message: (context) => `Stop session ${context.sessionId ?? ''}?`,
      confirmLabel: 'Stop',
      variant: 'destructive',
    },
  },
  {
    key: 'viewTerminal',
    label: 'Terminal',
    description: 'View terminal',
    scope: 'session',
    ownerSurface: 'ZoneBActionStrip',
    enabledWhen: (context) => hasText(context.sessionId) && hasText(context.tmuxSession) && !!context.onViewTerminal,
    invoke: (context) => invokeWithText(context.sessionId, context.onViewTerminal),
    kind: 'safe',
    confirm: null,
  },
  {
    key: 'pauseSession',
    label: 'Pause',
    description: 'Pause session',
    scope: 'session',
    ownerSurface: 'ZoneBActionStrip',
    enabledWhen: (context) => context.sessionPresence === 'active' && hasText(context.sessionId) && !!context.onPauseSession,
    invoke: (context) => invokeWithText(context.sessionId, context.onPauseSession),
    kind: 'safe',
    confirm: null,
  },
  {
    key: 'resumeFocusedSession',
    label: 'Resume',
    description: 'Resume session',
    scope: 'session',
    ownerSurface: 'ZoneBActionStrip',
    enabledWhen: (context) => context.sessionPresence === 'suspended' && hasText(context.sessionId) && !!context.onResumeSession,
    invoke: (context) => invokeWithText(context.sessionId, context.onResumeSession),
    kind: 'safe',
    confirm: null,
  },
  {
    key: 'restartSession',
    label: 'Restart',
    description: 'Stop the focused session and start a new work agent.',
    scope: 'session',
    ownerSurface: 'ZoneBActionStrip',
    enabledWhen: (context) => context.sessionType === 'work' && hasText(context.sessionId) && !!context.onRestartSession,
    invoke: (context) => invokeWithText(context.sessionId, context.onRestartSession),
    kind: 'dialog',
    confirm: {
      title: 'Restart Agent',
      message: (context) => `Stop ${context.sessionId ?? ''} and start a new work agent?`,
      confirmLabel: 'Restart',
      variant: 'destructive',
    },
  },
  {
    key: 'replaySession',
    label: 'Replay',
    description: 'Replay the focused session in the terminal.',
    scope: 'session',
    ownerSurface: 'ZoneBActionStrip',
    enabledWhen: (context) => hasText(context.sessionId) && !!context.onReplaySession,
    invoke: (context) => invokeWithText(context.sessionId, context.onReplaySession),
    kind: 'safe',
    confirm: null,
  },
  {
    key: 'openStateDir',
    label: 'Open State Dir',
    description: 'Copy the focused session state directory path.',
    scope: 'session',
    ownerSurface: 'ZoneBActionStrip',
    enabledWhen: (context) => hasText(context.sessionId) && !!context.onOpenStateDir,
    invoke: (context) => invokeWithText(context.sessionId, context.onOpenStateDir),
    kind: 'safe',
    confirm: null,
  },
  {
    key: 'viewState',
    label: 'View State.md',
    description: 'Copy the focused session state directory path.',
    scope: 'session',
    ownerSurface: 'ZoneBActionStrip',
    enabledWhen: (context) => hasText(context.sessionId) && !!context.onViewState,
    invoke: (context) => invokeWithText(context.sessionId, context.onViewState),
    kind: 'safe',
    confirm: null,
  },
  {
    key: 'viewFocusedXbrief',
    label: 'View xBRIEF',
    description: 'Copy the focused issue xBRIEF path.',
    scope: 'session',
    ownerSurface: 'ZoneBActionStrip',
    enabledWhen: (context) => hasText(context.issueId) && !!context.onViewXbrief,
    invoke: (context) => invokeWithText(context.issueId, context.onViewXbrief),
    kind: 'safe',
    confirm: null,
  },
  {
    key: 'copySessionId',
    label: 'Copy Session ID',
    description: 'Copy the focused session ID to the clipboard.',
    scope: 'session',
    ownerSurface: 'ZoneBActionStrip',
    enabledWhen: (context) => hasText(context.sessionId) && !!context.onCopySessionId,
    invoke: (context) => invokeWithText(context.sessionId, context.onCopySessionId),
    kind: 'safe',
    confirm: null,
  },
  {
    key: 'copyTmuxCommand',
    label: 'Copy tmux command',
    description: 'Copy the command for attaching to the focused tmux session.',
    scope: 'session',
    ownerSurface: 'ZoneBActionStrip',
    enabledWhen: (context) => hasText(context.tmuxSession) && !!context.onCopyTmuxCommand,
    invoke: (context) => invokeWithText(context.tmuxSession, context.onCopyTmuxCommand),
    kind: 'safe',
    confirm: null,
  },
  {
    key: 'viewJsonl',
    label: 'View JSONL',
    description: 'Open the focused session JSONL transcript.',
    scope: 'session',
    ownerSurface: 'ZoneBActionStrip',
    enabledWhen: (context) => context.hasJsonl === true && hasText(context.sessionId) && !!context.onViewJsonl,
    invoke: (context) => invokeWithText(context.sessionId, context.onViewJsonl),
    kind: 'safe',
    confirm: null,
  },
  {
    key: 'exportSessionMetadata',
    label: 'Export session metadata',
    description: 'Download the focused session metadata as JSON.',
    scope: 'session',
    ownerSurface: 'ZoneBActionStrip',
    enabledWhen: (context) => hasText(context.sessionId) && !!context.onExportSessionMetadata,
    invoke: (context) => invokeWithText(context.sessionId, context.onExportSessionMetadata),
    kind: 'safe',
    confirm: null,
  },
  {
    key: 'exportRoundHistory',
    label: 'Export round history JSON',
    description: 'Download the focused session round history as JSON.',
    scope: 'session',
    ownerSurface: 'ZoneBActionStrip',
    enabledWhen: (context) => (context.roundCount ?? 0) > 0 && hasText(context.sessionId) && !!context.onExportRoundHistory,
    invoke: (context) => invokeWithText(context.sessionId, context.onExportRoundHistory),
    kind: 'safe',
    confirm: null,
  },
  {
    key: 'deepWipe',
    label: 'Deep Wipe',
    description: 'Destroy the issue workspace, agent state, and git branches.',
    scope: 'session',
    ownerSurface: 'ZoneBActionStrip',
    enabledWhen: (context) => hasText(context.issueId) && !!context.onDeepWipe,
    invoke: (context) => invokeWithText(context.issueId, context.onDeepWipe),
    kind: 'destructive',
    confirm: {
      title: 'Deep Wipe',
      message: (context) => `Deep wipe will destroy all data for ${context.issueId ?? 'this issue'} including workspace, state, and git branches. This cannot be undone.`,
      confirmLabel: 'Deep Wipe',
      variant: 'destructive',
    },
  },
];

const always = () => true;
const hasAgent = (state: IssueActionState) => !!state.agent;
const hasWorkspace = (state: IssueActionState) => state.workspace?.exists === true;
const hasLiveAgent = (state: IssueActionState) => !!state.agent && !['stopped', 'failed', 'dead', 'error', 'stuck'].includes(state.agent.status);
const hasStoppedAgent = (state: IssueActionState) => !hasLiveAgent(state);
const hasResumableSession = (state: IssueActionState) => hasStoppedAgent(state) && state.lifecycle?.canResumeSession === true;
const canInspectTask = (state: IssueActionState) => state.hasTasks || !!state.selectedTaskId;
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
const canStartAgent = (state: IssueActionState) => hasStoppedAgent(state) && state.hasPlan && state.hasTasks && !isMerged(state) && !isDoneOrCanceled(state);
// Rebuild & start: the recovery path for the `stack-unhealthy` spawn block.
// Available wherever a normal start is viable AND a workspace exists (rebuild
// operates on the workspace's Docker stack). Mirrors `canStartAgent` so it is a
// drop-in alternative when `pan start`'s autonomous rebuild is on cooldown or
// exhausted (see src/lib/agents.ts SPAWN_STACK_REBUILD_*).
const canRebuildAndStart = (state: IssueActionState) => hasWorkspace(state) && canStartAgent(state);
const canStartWithoutPlanning = (state: IssueActionState) => hasStoppedAgent(state) && !state.hasPlan && isTodo(state) && !isMerged(state);
// PAN-1517: `hasParallelizablePlan` removed alongside the `swarm` action entry —
// parallelism is now an in-context concern owned by the work agent (see
// roles/work.md "Parallel work via subagents"), not a separate spawn verb.
const canRequestReview = (state: IssueActionState) => hasWorkspace(state) && hasStoppedAgent(state) && !state.reviewStatus && !isMerged(state) && !isDoneOrCanceled(state);
const canRestartReview = (state: IssueActionState) => {
  const review = state.reviewStatus;
  return review?.reviewStatus === 'reviewing' || review?.reviewStatus === 'blocked' || review?.reviewStatus === 'failed' || review?.testStatus === 'testing' || review?.testStatus === 'failed' || review?.testStatus === 'dispatch_failed' || review?.mergeStatus === 'merging' || review?.mergeStatus === 'failed';
};
const hasReviewFailure = (state: IssueActionState) => isReviewPipelineStuck(state.reviewStatus ?? null);
// Complete review reset is available whenever review is in a restartable/stuck/failed
// state — the "something's wrong with review, nuke all of it" gate. The stale-ghost case
// (clean-looking review but leftover convoy sub-reviewers) is surfaced separately by the
// Issues-view stale warning, which carries its own purge button.
const canPurgeReview = (state: IssueActionState) => canRestartReview(state) || hasReviewFailure(state);
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

const ISSUE_ACTION_DEFINITIONS: Omit<IssueActionEntry, 'scope'>[] = [
  { key: 'plan', label: 'Plan', description: 'Have an AI planner interview you and write the implementation plan for this issue.', panVerb: 'plan', endpoint: '/api/issues/:id/start-planning', enabledWhen: canPlan, phasePrimary: phasePrimary('plan'), kind: 'dialog', group: 'planning' },
  { key: 'autoPlan', label: 'Auto-plan', description: 'Write the plan automatically, no questions asked. Good for well-understood work.', panVerb: 'plan --auto', endpoint: '/api/issues/:id/plan', enabledWhen: canPlan, phasePrimary: [], kind: 'dialog', group: 'planning' },
  { key: 'watchPlanning', label: 'Watch planning', description: 'Open the live planning session to watch or steer it.', panVerb: null, endpoint: null, enabledWhen: (state) => deriveIssueActionPhase(state) === 'PLANNING', phasePrimary: phasePrimary('watchPlanning'), kind: 'dialog', group: 'planning' },
  { key: 'donePlanning', label: 'Done planning', description: 'Accept the finished plan so work can start.', panVerb: 'plan finalize', endpoint: '/api/issues/:id/complete-planning', enabledWhen: canFinalizePlanning, phasePrimary: phasePrimary('donePlanning'), kind: 'safe', group: 'planning' },
  { key: 'startAgent', label: 'Start agent', description: 'Start an AI agent implementing this issue from its plan.', panVerb: 'start', endpoint: '/api/agents', enabledWhen: canStartAgent, phasePrimary: phasePrimary('startAgent'), kind: 'dialog', group: 'work' },
  { key: 'startSkipPlanning', label: 'Start without planning', description: 'Skip planning: generate a minimal plan from the issue text and start immediately.', panVerb: 'start --auto', endpoint: '/api/agents', enabledWhen: canStartWithoutPlanning, phasePrimary: [], kind: 'dialog', group: 'work' },
  { key: 'tell', label: 'Tell agent', description: 'Send the running agent a message — feedback, direction, a question.', panVerb: 'tell', endpoint: '/api/agents/:agentId/tell', enabledWhen: hasLiveAgent, phasePrimary: phasePrimary('tell'), kind: 'dialog', group: 'agent' },
  { key: 'doneWork', label: 'Done — mark work complete & start review', description: 'Tell the agent to wrap up; code review starts automatically.', panVerb: 'done', endpoint: '/api/agents/:agentId/tell', enabledWhen: (state) => hasLiveAgent(state) && deriveIssueActionPhase(state) === 'WORK_RUNNING', phasePrimary: phasePrimary('doneWork'), kind: 'safe', group: 'work' },
  { key: 'requestReview', label: 'Request review', description: 'Send the current code out for AI review.', panVerb: 'review request', endpoint: '/api/review/:id/trigger', enabledWhen: canRequestReview, phasePrimary: phasePrimary('requestReview'), kind: 'safe', group: 'review' },
  { key: 'restartReview', label: 'Re-run review on latest commit', description: 'Review again from the newest commit (e.g. after pushing fixes).', panVerb: 'review restart', endpoint: '/api/review/:id/trigger?force=true', enabledWhen: canRestartReview, phasePrimary: [], kind: 'safe', group: 'review' },
  { key: 'recoverReview', label: 'Reset stalled review state', description: 'Un-wedge a review that stopped moving; nothing is deleted.', panVerb: 'review reset', endpoint: '/api/review/:id/reset', enabledWhen: hasReviewFailure, phasePrimary: [], kind: 'safe', group: 'review' },
  { key: 'purgeReview', label: 'Remove review sessions & reset', description: 'Kill every reviewer session and clear review state — the "review is haunted" fix.', panVerb: null, endpoint: '/api/review/:id/purge', enabledWhen: canPurgeReview, phasePrimary: [], kind: 'destructive', group: 'review' },
  { key: 'stopAgent', label: 'Stop agent', description: 'Stop the running agent. Its work, branch, and session are kept.', panVerb: 'kill', endpoint: '/api/agents/:agentId/stop', enabledWhen: hasLiveAgent, phasePrimary: [], kind: 'safe', group: 'agent' },
  { key: 'pause', label: 'Pause agent', description: 'Pause the agent (optionally with a reason). Resume anytime.', panVerb: 'pause', endpoint: '/api/agents/:agentId/pause', enabledWhen: (state) => hasLiveAgent(state) && !isPaused(state), phasePrimary: [], kind: 'dialog', group: 'agent' },
  { key: 'unpause', label: 'Unpause agent', description: 'Let a paused agent continue.', panVerb: 'unpause', endpoint: '/api/agents/:agentId/unpause', enabledWhen: isPaused, phasePrimary: [], kind: 'safe', group: 'agent' },
  { key: 'untroubled', label: 'Clear troubled gate', description: 'Clear the "kept failing, gave up" flag after you\'ve fixed the underlying cause.', panVerb: 'untroubled', endpoint: '/api/agents/:agentId/untroubled', enabledWhen: isTroubled, phasePrimary: [], kind: 'safe', group: 'agent' },
  { key: 'recoverAgent', label: 'Recover agent', description: 'Bring back an agent that stopped, crashed, or got stuck.', panVerb: 'recover', endpoint: '/api/agents/:agentId/recover', enabledWhen: canRecoverAgent, phasePrimary: phasePrimary('recoverAgent'), kind: 'safe', group: 'agent' },
  { key: 'resumeSession', label: 'Resume session', description: 'Reopen the stopped agent\'s saved session with its memory intact.', panVerb: 'resume', endpoint: '/api/agents/:agentId/resume', enabledWhen: hasResumableSession, phasePrimary: [], kind: 'dialog', group: 'agent' },
  { key: 'syncMain', label: 'Sync main', description: 'Pull the latest main branch into this issue\'s branch.', panVerb: 'sync-main', endpoint: '/api/issues/:id/sync-main', enabledWhen: hasWorkspace, phasePrimary: [], kind: 'safe', group: 'workspace' },
  { key: 'rebuildAndStart', label: 'Rebuild & start', description: 'Rebuild the dev containers, then start the agent — the fix for "stack unhealthy".', panVerb: 'workspace rebuild && start', endpoint: '/api/workspaces/:id/rebuild-and-start', enabledWhen: canRebuildAndStart, phasePrimary: [], kind: 'safe', group: 'workspace' },
  { key: 'inspectTask', label: 'Inspect task', description: 'Have an inspector verify one plan task against the actual diff.', panVerb: 'inspect --task', endpoint: '/api/issues/:id/tasks/:taskId/inspect', enabledWhen: canInspectTask, phasePrimary: [], kind: 'dialog', group: 'review' },
  { key: 'reopen', label: 'Reopen', description: 'Bring a closed or canceled issue back into the pipeline.', panVerb: 'reopen', endpoint: '/api/issues/:id/reopen', enabledWhen: isDoneOrCanceled, phasePrimary: [], kind: 'safe', group: 'danger' },
  { key: 'closeOut', label: 'Close out', description: 'The final ceremony: archive artifacts, tidy the workspace, close the tracker issue.', panVerb: 'close', endpoint: '/api/issues/:id/close-out', enabledWhen: canCloseOut, phasePrimary: phasePrimary('closeOut'), kind: 'destructive', group: 'danger' },
  { key: 'wipe', label: 'Wipe', description: 'Erase this issue\'s agent state and workspace. Cannot be undone.', panVerb: 'wipe', endpoint: '/api/issues/:id/deep-wipe', enabledWhen: always, phasePrimary: [], kind: 'destructive', group: 'danger' },
  { key: 'destroyWorkspace', label: 'Destroy workspace', description: 'Delete the workspace folder and containers. The issue itself survives.', panVerb: 'destroy', endpoint: '/api/issues/:id/cleanup-workspace', enabledWhen: hasWorkspace, phasePrimary: [], kind: 'destructive', group: 'danger' },
  { key: 'open', label: 'Open', description: 'Open this issue\'s workspace in your editor.', panVerb: 'open', endpoint: null, enabledWhen: hasWorkspace, phasePrimary: phasePrimary('open'), kind: 'safe', group: 'navigation' },
  { key: 'resetIssue', label: 'Reset issue', description: 'Back to square one: stop agents, delete workspace and branch, return the issue to Todo.', panVerb: null, endpoint: '/api/issues/:id/reset', enabledWhen: always, phasePrimary: [], kind: 'destructive', group: 'danger' },
  { key: 'resetToPlanned', label: 'Reset to planned', description: 'Throw away progress but keep the workspace, branch, and plan — start implementation over.', panVerb: 'reset-to-planned', endpoint: '/api/issues/:id/reset-to-planned', enabledWhen: hasWorkspace, phasePrimary: [], kind: 'destructive', group: 'work' },
  { key: 'viewPr', label: 'View PR', description: 'Open the pull request in your browser.', panVerb: null, endpoint: null, enabledWhen: hasPrTarget, phasePrimary: phasePrimary('viewPr'), kind: 'safe', group: 'navigation' },
  { key: 'cancel', label: 'Cancel issue', description: 'Cancel this issue and clean up its abandoned run.', panVerb: null, endpoint: '/api/issues/:id/cancel', enabledWhen: canCancelIssue, phasePrimary: [], kind: 'destructive', group: 'danger' },
  { key: 'tasks', label: 'Tasks', description: 'Open the plan\'s task checklist.', panVerb: null, endpoint: '/api/issues/:id/tasks', enabledWhen: (state) => state.hasTasks || state.hasPlan, phasePrimary: [], kind: 'safe', group: 'artifacts' },
  { key: 'inference', label: 'Inference', description: 'Open the AI-inference artifact for this issue.', panVerb: null, endpoint: null, enabledWhen: (state) => state.hasInference === true, phasePrimary: [], kind: 'safe', group: 'artifacts' },
  { key: 'discussions', label: 'Discussions', description: 'Open recorded design discussions.', panVerb: null, endpoint: null, enabledWhen: (state) => state.hasDiscussions === true, phasePrimary: [], kind: 'safe', group: 'artifacts' },
  { key: 'transcripts', label: 'Transcripts', description: 'Open saved agent session transcripts.', panVerb: null, endpoint: null, enabledWhen: (state) => state.hasTranscripts === true, phasePrimary: [], kind: 'safe', group: 'artifacts' },
  { key: 'upload', label: 'Upload transcript', description: 'Attach an outside transcript to this issue.', panVerb: null, endpoint: null, enabledWhen: always, phasePrimary: [], kind: 'dialog', group: 'artifacts' },
  { key: 'syncDiscussions', label: 'Sync discussions', description: 'Refresh discussion data from the tracker.', panVerb: null, endpoint: '/api/issues/:id/discussions/sync', enabledWhen: always, phasePrimary: [], kind: 'dialog', group: 'artifacts' },
  { key: 'statusReview', label: 'Status review', description: 'Open the pipeline status overview for this issue.', panVerb: null, endpoint: '/api/review/:id/status', enabledWhen: always, phasePrimary: [], kind: 'safe', group: 'artifacts' },
  { key: 'createWorkspace', label: 'Create workspace', description: 'Create the isolated working copy (branch + folder + containers) for this issue.', panVerb: null, endpoint: '/api/workspaces', enabledWhen: (state) => !hasWorkspace(state), phasePrimary: [], kind: 'dialog', group: 'workspace' },
  { key: 'copySettings', label: 'Copy settings', description: 'Copy your editor/tooling settings into this issue\'s workspace.', panVerb: null, endpoint: '/api/issues/:id/copy-settings', enabledWhen: hasWorkspace, phasePrimary: [], kind: 'dialog', group: 'workspace' },
  { key: 'resetSession', label: 'Reset session', description: 'Discard the saved session memory. The next start begins fresh.', panVerb: null, endpoint: '/api/agents/:agentId/reset-session', enabledWhen: hasResumableSession, phasePrimary: [], kind: 'destructive', group: 'agent' },
  { key: 'completeWorkReset', label: 'Complete work reset', description: 'Delete agent state but keep the workspace, plan, and tasks — a fresh brain, same desk.', panVerb: null, endpoint: '/api/agents/:agentId/restart-fresh', enabledWhen: (state) => hasAgent(state) && !isMerged(state), phasePrimary: [], kind: 'destructive', group: 'danger' },
  { key: 'restartFromPlan', label: 'Restart from plan', description: 'Start a brand-new run from the existing plan.', panVerb: null, endpoint: '/api/agents', enabledWhen: (state) => state.hasPlan && !isMerged(state), phasePrimary: [], kind: 'destructive', group: 'danger' },
  { key: 'restartAgent', label: 'Restart agent', description: 'Stop the agent and start a replacement that keeps the issue context.', panVerb: null, endpoint: '/api/agents/:agentId/restart', enabledWhen: (state) => hasAgent(state) && !isMerged(state), phasePrimary: [], kind: 'destructive', group: 'agent' },
];

export const ISSUE_ACTIONS: IssueActionEntry[] = ISSUE_ACTION_DEFINITIONS.map((action) => ({
  ...action,
  scope: 'issue',
}));

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
    case 'testing_failures':
    case 'verification_failing':
      return 'STUCK';
    case 'ready_to_merge':
      return 'READY_TO_MERGE';
    case 'merging':
      return 'SHIP_RUNNING';
    case 'verifying':
    case 'merged':
    case 'done':
      return 'MERGED';
    default:
      if (hasReviewFailure(state)) return 'STUCK';
      return state.hasPlan ? 'PLANNED_IDLE' : 'QUEUED_FOR_PLAN';
  }
}
