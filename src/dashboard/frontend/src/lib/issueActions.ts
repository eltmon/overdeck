import type { SessionNode } from '@overdeck/contracts';
import type { WorkspaceInfo } from './workspace-types';
import type { Agent, BackendPane, DerivedIssueState, WorkAgentLifecycle } from '../types';
import { derivePipelineState, normalizeCanonicalState } from './issuePipelineState';

export type PipelinePhase =
  | 'QUEUED_FOR_PLAN'
  | 'PLANNING'
  | 'PLANNED_IDLE'
  | 'WORK_RUNNING'
  | 'INPUT'
  | 'REVIEW_RUNNING'
  | 'CHANGES_REQUESTED'
  | 'STUCK'
  | 'READY_TO_MERGE'
  | 'MERGED';

export type IssueActionKey =
  | 'plan'
  | 'watchPlanning'
  | 'donePlanning'
  | 'startAgent'
  | 'tell'
  | 'doneWork'
  | 'requestReview'
  | 'restartReview'
  | 'stopAgent'
  | 'pause'
  | 'unpause'
  | 'recoverAgent'
  | 'resumeSession'
  | 'restartAgent'
  | 'syncMain'
  | 'rebuildAndStart'
  | 'merge'
  | 'reopen'
  | 'closeOut'
  | 'resetIssue'
  | 'destroyWorkspace'
  | 'cancel'
  | 'open'
  | 'viewPr'
  | 'addToOrderBook'
  | 'tasks'
  | 'createWorkspace';

export type IssueActionKind = 'safe' | 'dialog' | 'destructive';

export type IssueActionGroup =
  | 'communicate'
  | 'lifecycle'
  | 'inspect'
  | 'danger';

export const GROUP_LABELS: Record<IssueActionGroup, string> = {
  communicate: 'Communicate',
  lifecycle: 'Actions',
  inspect: 'Inspect',
  danger: 'Danger',
};

export const GROUP_ORDER: IssueActionGroup[] = [
  'communicate',
  'lifecycle',
  'inspect',
  'danger',
];

/**
 * PAN-4198 — where a registry entry is allowed to appear.
 *
 * `menu` entries are the ones every grouped menu surface lists. `contextual`
 * entries stay in the registry because a card or button invokes them by key
 * (NeedsYouSlot, AgentsLane, WorkspaceCard, the agent-scope strip), but no menu
 * lists them.
 */
export type IssueActionPlacement = 'menu' | 'contextual';

export interface IssueActionState {
  /** PAN-3917 — the derived issue state (FR-6). Replaces the six status fields. */
  derived?: DerivedIssueState | null;
  /** Backend panes in this issue's workspace. */
  panes?: readonly BackendPane[];
  agent?: Pick<Agent, 'status' | 'role' | 'agentPhase' | 'git' | 'paused'> | null;
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
  orderBooksLoaded?: boolean;
  isInActiveOrderBook?: boolean;
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
  placement: IssueActionPlacement;
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

const hasAgent = (state: IssueActionState) => !!state.agent;
const hasWorkspace = (state: IssueActionState) => state.workspace?.exists === true;
const hasLiveAgent = (state: IssueActionState) => !!state.agent && !['stopped', 'failed', 'dead', 'error', 'stuck'].includes(state.agent.status);
const hasStoppedAgent = (state: IssueActionState) => !hasLiveAgent(state);
const hasResumableSession = (state: IssueActionState) => hasStoppedAgent(state) && state.lifecycle?.canResumeSession === true;
const isPaused = (state: IssueActionState) => state.agent?.paused === true;
const canonicalState = (state: IssueActionState) => normalizeCanonicalState(state.issueCanonicalState);
const isDoneOrCanceled = (state: IssueActionState) => {
  const canonical = canonicalState(state);
  return canonical === 'done' || canonical === 'canceled';
};
const isMerged = (state: IssueActionState) => state.isMerged === true || state.derived?.state === 'merged';
const derivedState = (state: IssueActionState) => state.derived?.state;
const canPlan = (state: IssueActionState) => hasStoppedAgent(state) && !state.hasPlan && !isMerged(state) && !isDoneOrCanceled(state);
const canFinalizePlanning = (state: IssueActionState) => state.hasPlan && state.agent?.role === 'plan' && hasStoppedAgent(state) && !isMerged(state);
// Once review is running, approved, or merge-ready, the work agent's job is
// done — "Start agent" must not reappear (C-ACTIONS: contradictory verbs are
// never co-enabled). Review 'skipped' counts as approved here (PAN-1862).
const reviewSettledOrRunning = (state: IssueActionState) => {
  const derived = derivedState(state);
  return derived === 'in-review' || derived === 'changes-requested' || derived === 'ready' || derived === 'merged';
};
// PAN-4198: once the code is out for review or approved, restarting or resuming
// the work agent is not the next step — re-running review is. 'changes-requested'
// is deliberately absent: that is exactly when the agent goes back to work.
const reviewOrLater = (state: IssueActionState) => ['in-review', 'ready'].includes(derivedState(state) ?? '');
const canStartAgent = (state: IssueActionState) => hasStoppedAgent(state) && state.hasPlan && state.hasTasks && !isMerged(state) && !isDoneOrCanceled(state) && !reviewSettledOrRunning(state);
// Rebuild & start: the recovery path for the `stack-unhealthy` spawn block.
// Available wherever a normal start is viable AND a workspace exists (rebuild
// operates on the workspace's Docker stack). Mirrors `canStartAgent` so it is a
// drop-in alternative when `pan start`'s autonomous rebuild is on cooldown or
// exhausted (see src/lib/agents.ts SPAWN_STACK_REBUILD_*).
const canRebuildAndStart = (state: IssueActionState) => hasWorkspace(state) && canStartAgent(state);
// PAN-1517: `hasParallelizablePlan` removed alongside the `swarm` action entry —
// parallelism is now an in-context concern owned by the work agent (see
// roles/work.md "Parallel work via subagents"), not a separate spawn verb.
const canRequestReview = (state: IssueActionState) => hasWorkspace(state) && hasStoppedAgent(state) && !state.derived?.pr && !isMerged(state) && !isDoneOrCanceled(state) && derivedState(state) === 'working';
// PAN-3675: 'pending' is included — a failed dispatch strands the row at
// pending with no live reviewers (the PAN-3668 shape), and the server endpoint
// coalesces a redundant trigger while a healthy dispatch is still in flight,
// so the operator's force re-review is always safe to offer on a non-terminal
// review. The dispatch resumes the review agent's saved session when possible
// (PAN-1862); a fresh session only on harness/model change.
const canRestartReview = (state: IssueActionState) => {
  const derived = derivedState(state);
  return derived === 'in-review' || derived === 'changes-requested';
};
const hasReviewFailure = (state: IssueActionState) =>
  state.derived?.attention === 'stuck' || state.derived?.attention === 'api-error' || state.derived?.pr?.checks === 'red';
const canRecoverAgent = (state: IssueActionState) => state.agent?.status === 'stopped' || state.agent?.status === 'stuck' || state.agent?.status === 'failed' || state.agent?.status === 'dead' || state.agent?.status === 'error';
const hasPrTarget = (state: IssueActionState) => state.hasPr === true || !!state.prUrl || !!state.workspace?.mrUrl || !!state.derived?.pr?.url;
const canMerge = (state: IssueActionState) => derivedState(state) === 'ready' && !isMerged(state);
const canCloseOut = (state: IssueActionState) => isMerged(state);
const canCancelIssue = (state: IssueActionState) => !isMerged(state) && !isDoneOrCanceled(state);
// PAN-4198: resuming the saved session is a work-phase move only.
const canResumeWork = (state: IssueActionState) =>
  hasResumableSession(state) && !isMerged(state) && !isDoneOrCanceled(state) && !reviewOrLater(state);
// PAN-4198: one restart entry replaces restartFromPlan / completeWorkReset /
// resetSession. A planning agent is not restarted from here — Plan… owns that.
const canRestartAgent = (state: IssueActionState) =>
  hasAgent(state) && state.agent?.role !== 'plan' && !isMerged(state) && !isDoneOrCanceled(state) && !reviewOrLater(state);
// PAN-4198: merging main in needs a quiet branch, and it is meaningless while
// planning (no code yet) or after the work landed.
const canSyncMain = (state: IssueActionState) =>
  hasWorkspace(state) && hasStoppedAgent(state) && !isMerged(state) && !isDoneOrCanceled(state)
  && deriveIssueActionPhase(state) !== 'PLANNING';
// PAN-4198: there has to be something to reset — otherwise Reset to Todo is a
// no-op offered on every backlog row.
const canResetIssue = (state: IssueActionState) =>
  (hasWorkspace(state) || hasAgent(state) || state.hasPlan || hasPrTarget(state)) && !isMerged(state) && !isDoneOrCanceled(state);
// PAN-4198: matches the server rule. `cleanupWorkspaceForIssue`
// (src/lib/overdeck/workspace-hygiene.ts) returns 409 unless the tracker issue
// reads closed/done/completed, so a merged-but-open issue is closed out instead.
const canDestroyWorkspace = (state: IssueActionState) => hasWorkspace(state) && isDoneOrCanceled(state);
// PAN-4198: order books queue work that has not started yet.
const canAddToOrderBook = (state: IssueActionState) =>
  state.orderBooksLoaded === true && !state.isInActiveOrderBook && !isMerged(state) && !isDoneOrCanceled(state)
  && !hasLiveAgent(state) && ['backlog', 'parked', 'planned', undefined].includes(derivedState(state));

const phasePrimary = (key: IssueActionKey): PipelinePhase[] => PHASE_PRIMARY_ACTION_KEYS_BY_ACTION[key] ?? [];

const PHASE_PRIMARY_KEYS: Record<PipelinePhase, IssueActionKey[]> = {
  QUEUED_FOR_PLAN: ['plan', 'startAgent'],
  PLANNING: ['watchPlanning', 'donePlanning'],
  PLANNED_IDLE: ['startAgent'],
  WORK_RUNNING: ['tell', 'doneWork'],
  INPUT: ['tell'],
  REVIEW_RUNNING: ['viewPr', 'restartReview'],
  CHANGES_REQUESTED: ['resumeSession', 'restartAgent'],
  STUCK: ['restartAgent', 'tell'],
  READY_TO_MERGE: ['merge', 'viewPr'],
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
  { key: 'plan', label: 'Plan…', description: 'Open the planning dialog and choose whether the AI planner interviews you or plans on its own.', panVerb: 'plan', endpoint: '/api/issues/:id/start-planning', enabledWhen: canPlan, phasePrimary: phasePrimary('plan'), kind: 'dialog', group: 'lifecycle', placement: 'menu' },
  { key: 'watchPlanning', label: 'Open planning session', description: 'Open this issue’s live planning conversation so you can watch it or answer its questions.', panVerb: null, endpoint: null, enabledWhen: (state) => deriveIssueActionPhase(state) === 'PLANNING', phasePrimary: phasePrimary('watchPlanning'), kind: 'safe', group: 'lifecycle', placement: 'menu' },
  { key: 'donePlanning', label: 'Accept plan', description: 'Accept the finished plan so work can start.', panVerb: 'plan finalize', endpoint: '/api/issues/:id/complete-planning', enabledWhen: canFinalizePlanning, phasePrimary: phasePrimary('donePlanning'), kind: 'safe', group: 'lifecycle', placement: 'menu' },
  { key: 'startAgent', label: 'Start work', description: 'Start an AI agent that implements this issue from its plan.', panVerb: 'start', endpoint: '/api/agents', enabledWhen: canStartAgent, phasePrimary: phasePrimary('startAgent'), kind: 'dialog', group: 'lifecycle', placement: 'menu' },
  { key: 'tell', label: 'Message agent', description: 'Send the running agent a message: feedback, direction, or a question.', panVerb: 'tell', endpoint: '/api/agents/:agentId/tell', enabledWhen: hasLiveAgent, phasePrimary: phasePrimary('tell'), kind: 'dialog', group: 'communicate', placement: 'menu' },
  { key: 'doneWork', label: 'Finish work and start review', description: 'Tell the agent to wrap up; code review starts automatically after that.', panVerb: 'done', endpoint: '/api/agents/:agentId/tell', enabledWhen: (state) => hasLiveAgent(state) && deriveIssueActionPhase(state) === 'WORK_RUNNING', phasePrimary: phasePrimary('doneWork'), kind: 'safe', group: 'lifecycle', placement: 'menu' },
  { key: 'requestReview', label: 'Request review', description: 'Send the current code to AI review.', panVerb: 'review request', endpoint: '/api/review/:id/trigger', enabledWhen: canRequestReview, phasePrimary: phasePrimary('requestReview'), kind: 'safe', group: 'lifecycle', placement: 'menu' },
  { key: 'restartReview', label: 'Review again', description: 'Run the review again on the newest commit.', panVerb: 'review restart', endpoint: '/api/review/:id/trigger?force=true', enabledWhen: canRestartReview, phasePrimary: phasePrimary('restartReview'), kind: 'safe', group: 'lifecycle', placement: 'menu' },
  { key: 'stopAgent', label: 'Stop agent', description: 'Stop the running agent; its work, branch, and saved session are kept.', panVerb: 'kill', endpoint: '/api/agents/:agentId/stop', enabledWhen: hasLiveAgent, phasePrimary: phasePrimary('stopAgent'), kind: 'safe', group: 'lifecycle', placement: 'menu' },
  { key: 'pause', label: 'Pause agent', description: 'Pause the agent; you can let it continue at any time.', panVerb: 'pause', endpoint: '/api/agents/:agentId/pause', enabledWhen: (state) => hasLiveAgent(state) && !isPaused(state), phasePrimary: phasePrimary('pause'), kind: 'dialog', group: 'lifecycle', placement: 'contextual' },
  { key: 'unpause', label: 'Let agent continue', description: 'Let a paused agent continue its work.', panVerb: 'unpause', endpoint: '/api/agents/:agentId/unpause', enabledWhen: isPaused, phasePrimary: phasePrimary('unpause'), kind: 'safe', group: 'lifecycle', placement: 'menu' },
  { key: 'recoverAgent', label: 'Recover agent', description: 'Bring back an agent that stopped, crashed, or got stuck.', panVerb: 'recover', endpoint: '/api/agents/:agentId/recover', enabledWhen: canRecoverAgent, phasePrimary: phasePrimary('recoverAgent'), kind: 'safe', group: 'lifecycle', placement: 'contextual' },
  { key: 'resumeSession', label: 'Resume', description: 'Reopen the stopped agent’s saved session with its memory intact.', panVerb: 'resume', endpoint: '/api/agents/:agentId/resume', enabledWhen: canResumeWork, phasePrimary: phasePrimary('resumeSession'), kind: 'dialog', group: 'lifecycle', placement: 'menu' },
  { key: 'restartAgent', label: 'Restart agent…', description: 'Restart the agent, either keeping its memory or with a fresh session on the same branch.', panVerb: null, endpoint: '/api/agents/:agentId/restart', enabledWhen: canRestartAgent, phasePrimary: phasePrimary('restartAgent'), kind: 'dialog', group: 'lifecycle', placement: 'menu' },
  { key: 'syncMain', label: 'Update from main', description: 'Merge the latest main branch into this issue’s branch.', panVerb: 'sync-main', endpoint: '/api/issues/:id/sync-main', enabledWhen: canSyncMain, phasePrimary: phasePrimary('syncMain'), kind: 'safe', group: 'lifecycle', placement: 'menu' },
  { key: 'rebuildAndStart', label: 'Rebuild & start', description: 'Rebuild the dev containers, then start the agent.', panVerb: 'workspace rebuild && start', endpoint: '/api/workspaces/:id/rebuild-and-start', enabledWhen: canRebuildAndStart, phasePrimary: phasePrimary('rebuildAndStart'), kind: 'safe', group: 'lifecycle', placement: 'contextual' },
  { key: 'merge', label: 'Merge to main', description: 'Merge this issue’s approved branch into main; nothing merges without you.', panVerb: null, endpoint: '/api/issues/:id/merge', enabledWhen: canMerge, phasePrimary: phasePrimary('merge'), kind: 'safe', group: 'lifecycle', placement: 'menu' },
  { key: 'reopen', label: 'Reopen', description: 'Bring a closed or canceled issue back into the pipeline.', panVerb: 'reopen', endpoint: '/api/issues/:id/reopen', enabledWhen: isDoneOrCanceled, phasePrimary: phasePrimary('reopen'), kind: 'safe', group: 'lifecycle', placement: 'menu' },
  { key: 'closeOut', label: 'Close out', description: 'Finish a merged issue: archive its artifacts, tidy the workspace, and close the tracker issue.', panVerb: 'close', endpoint: '/api/issues/:id/close-out', enabledWhen: canCloseOut, phasePrimary: phasePrimary('closeOut'), kind: 'destructive', group: 'danger', placement: 'menu' },
  { key: 'resetIssue', label: 'Reset to Todo', description: 'Stop agents, close the PR, delete the workspace and feature branch, and move the issue back to Todo.', panVerb: null, endpoint: '/api/issues/:id/reset', enabledWhen: canResetIssue, phasePrimary: phasePrimary('resetIssue'), kind: 'destructive', group: 'danger', placement: 'menu' },
  { key: 'destroyWorkspace', label: 'Delete workspace', description: 'Delete this closed issue’s workspace folder and containers; the issue and its history stay.', panVerb: 'destroy', endpoint: '/api/issues/:id/cleanup-workspace', enabledWhen: canDestroyWorkspace, phasePrimary: phasePrimary('destroyWorkspace'), kind: 'destructive', group: 'danger', placement: 'menu' },
  { key: 'cancel', label: 'Cancel issue', description: 'Cancel this issue and clean up its unfinished run.', panVerb: null, endpoint: '/api/issues/:id/cancel', enabledWhen: canCancelIssue, phasePrimary: phasePrimary('cancel'), kind: 'destructive', group: 'danger', placement: 'menu' },
  { key: 'open', label: 'Open in editor', description: 'Open this issue’s workspace in your editor.', panVerb: 'open', endpoint: null, enabledWhen: hasWorkspace, phasePrimary: phasePrimary('open'), kind: 'safe', group: 'inspect', placement: 'menu' },
  { key: 'viewPr', label: 'Open pull request', description: 'Open the pull request in your browser.', panVerb: null, endpoint: null, enabledWhen: hasPrTarget, phasePrimary: phasePrimary('viewPr'), kind: 'safe', group: 'inspect', placement: 'menu' },
  { key: 'addToOrderBook', label: 'Add to order book', description: 'Queue this issue in an order book so the Flywheel can pick it up.', panVerb: null, endpoint: null, enabledWhen: canAddToOrderBook, phasePrimary: phasePrimary('addToOrderBook'), kind: 'dialog', group: 'lifecycle', placement: 'menu' },
  { key: 'tasks', label: 'Show plan and tasks', description: 'Open the plan’s task checklist.', panVerb: null, endpoint: '/api/issues/:id/tasks', enabledWhen: (state) => state.hasTasks || state.hasPlan, phasePrimary: phasePrimary('tasks'), kind: 'safe', group: 'inspect', placement: 'menu' },
  { key: 'createWorkspace', label: 'Create workspace', description: 'Create the isolated working copy (branch, folder, containers) for this issue.', panVerb: null, endpoint: '/api/workspaces', enabledWhen: (state) => !hasWorkspace(state), phasePrimary: phasePrimary('createWorkspace'), kind: 'dialog', group: 'lifecycle', placement: 'contextual' },
];

export const ISSUE_ACTIONS: IssueActionEntry[] = ISSUE_ACTION_DEFINITIONS.map((action) => ({
  ...action,
  scope: 'issue',
}));

const ACTION_BY_KEY = new Map(ISSUE_ACTIONS.map((action) => [action.key, action]));

export function getEnabledActions(state: IssueActionState): IssueActionEntry[] {
  return ISSUE_ACTIONS.filter((action) => action.enabledWhen(state));
}

/**
 * PAN-4198 — exactly what a grouped menu renders: the enabled, menu-placed
 * entries, in registry order. Contextual entries are invoked by key from their
 * own card and never listed here.
 */
export function getMenuActions(state: IssueActionState): IssueActionEntry[] {
  return ISSUE_ACTIONS.filter((action) => action.placement === 'menu' && action.enabledWhen(state));
}

export function getPhasePrimaryActions(_state: IssueActionState, phase: PipelinePhase): IssueActionEntry[] {
  return PHASE_PRIMARY_KEYS[phase]
    .map((key) => ACTION_BY_KEY.get(key))
    .filter((action): action is IssueActionEntry => !!action);
}

export function deriveIssueActionPhase(state: IssueActionState): PipelinePhase {
  if (state.hasPendingInput) return 'INPUT';
  if (state.derived?.attention === 'stuck' || state.derived?.attention === 'api-error') return 'STUCK';
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
    case 'in_review_approved':
      return 'REVIEW_RUNNING';
    case 'in_review_changes_requested':
      return 'CHANGES_REQUESTED';
    case 'ready_to_merge':
      return 'READY_TO_MERGE';
    case 'merged':
    case 'done':
      return 'MERGED';
    default:
      if (hasReviewFailure(state)) return 'STUCK';
      return state.hasPlan ? 'PLANNED_IDLE' : 'QUEUED_FOR_PLAN';
  }
}
