import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAlert, useConfirm } from '../DialogProvider';
import {
  ISSUE_ACTIONS,
  deriveIssueActionPhase,
  getPhasePrimaryActions,
  type IssueActionEntry,
  type IssueActionKey,
  type IssueActionState,
  type PipelinePhase,
} from '../../lib/issueActions';
import { refreshDashboardState } from '../../lib/refresh-dashboard-state';
import { selectAgents, selectIssues, selectReviewStatus, useDashboardStore } from '../../lib/store';
import type { WorkspaceInfo } from '../../lib/workspace-types';
import { STATUS_LABELS, type Agent, type Issue, type WorkAgentLifecycle } from '../../types';

type PlanningState = {
  hasPlan: boolean;
  hasBeads: boolean;
  beadsCount?: number;
  planningComplete?: boolean;
};

export type IssueActionDialogState = {
  key: IssueActionKey;
  action: IssueActionEntry;
} | null;

export type IssueActionView = {
  action: IssueActionEntry;
  enabled: boolean;
  disabledReason?: string;
  isPending: boolean;
  invoke: () => void;
};

export type IssueActionLayout = {
  all: IssueActionView[];
  primary: IssueActionView[];
  secondary: IssueActionView[];
  overflow: IssueActionView[];
};

export type UseIssueActionsResult = IssueActionLayout & {
  issue: Issue | undefined;
  agent: Agent | undefined;
  workspace: WorkspaceInfo | undefined;
  lifecycle: WorkAgentLifecycle | undefined;
  state: IssueActionState;
  phase: PipelinePhase;
  activeDialog: IssueActionDialogState;
  closeDialog: () => void;
};

type PostActionInput = {
  action: IssueActionEntry;
};

function activeAgentForIssue(agents: Agent[], issueId: string) {
  const issueAgents = agents.filter((agent) => agent.issueId?.toLowerCase() === issueId.toLowerCase());
  return issueAgents.find((agent) => !['stopped', 'failed', 'dead', 'error', 'stuck'].includes(agent.status)) ?? issueAgents[0];
}

async function responseError(response: Response, fallback: string) {
  const text = await response.text();
  if (!text) return fallback;
  try {
    const parsed = JSON.parse(text) as { error?: string; message?: string; hint?: string };
    return parsed.error ?? parsed.message ?? parsed.hint ?? fallback;
  } catch {
    return text.length < 200 ? text : fallback;
  }
}

function interpolateEndpoint(endpoint: string, issueId: string, agent: Agent | undefined, state: IssueActionState) {
  return endpoint
    .replace(':id', encodeURIComponent(issueId))
    .replace(':agentId', encodeURIComponent(agent?.id ?? ''))
    .replace(':beadId', encodeURIComponent(state.selectedBeadId ?? ''));
}

function bodyForAction(action: IssueActionEntry, issueId: string, issue: Issue | undefined) {
  switch (action.key) {
    case 'startAgent':
    case 'restartFromPlan':
      return { issueId, projectId: issue?.project?.id };
    case 'startSkipPlanning':
      return { issueId, projectId: issue?.project?.id, auto: true };
    case 'createWorkspace':
      return { issueId, projectId: issue?.project?.id };
    case 'resetIssue':
      return { deleteWorkspace: true };
    case 'cancel':
      return { wipeWorkspace: true };
    case 'inspectBead':
      return { deep: false };
    default:
      return undefined;
  }
}

function disabledReasonForAction(action: IssueActionEntry) {
  switch (action.key) {
    case 'plan':
    case 'autoPlan':
      return 'Planning is available only before a plan exists and before the issue is done.';
    case 'startAgent':
      return 'Start agent is available after planning when no agent is running.';
    case 'tell':
    case 'stopAgent':
    case 'pause':
    case 'switchModel':
      return 'This action requires a running agent.';
    case 'resumeSession':
    case 'resetSession':
      return 'This action requires a stopped agent with a resumable session.';
    case 'requestReview':
      return 'Review can be requested after workspace work is idle and not already in review.';
    case 'restartReview':
      return 'Restart review is available while review, test, or merge work is active or failed.';
    case 'recoverReview':
      return 'Recover review is available only when the review pipeline is blocked or failed.';
    case 'inspectBead':
      return 'Select a bead before requesting inspection.';
    case 'viewPr':
      return 'No pull request URL is available yet.';
    case 'open':
    case 'syncMain':
    case 'copySettings':
    case 'destroyWorkspace':
      return 'This action requires an existing workspace.';
    case 'beads':
      return 'No plan or beads are available for this issue yet.';
    case 'inference':
      return 'No inference artifact is available for this issue.';
    case 'discussions':
      return 'No discussion artifact is available for this issue.';
    case 'transcripts':
      return 'No transcript artifact is available for this issue.';
    case 'closeOut':
      return 'Close out is available only after merge verification.';
    case 'reopen':
      return 'Reopen is available only for done or canceled issues.';
    case 'unpause':
      return 'This agent is not paused.';
    case 'untroubled':
      return 'This agent is not troubled.';
    case 'swarm':
      return 'Swarm requires a planned issue with beads and no running agent.';
    default:
      return `${action.label} is unavailable in the current issue state.`;
  }
}

const dialogActionKeys = new Set<IssueActionKey>([
  'plan',
  'autoPlan',
  'startSkipPlanning',
  'swarm',
  'tell',
  'pause',
  'resumeSession',
  'switchModel',
  'inspectBead',
  'open',
  'upload',
  'syncDiscussions',
  'createWorkspace',
  'copySettings',
  'reviewTest',
]);

const artifactTabs: Partial<Record<IssueActionKey, string>> = {
  beads: 'beads',
  inference: 'inference',
  discussions: 'discussions',
  transcripts: 'conversation',
  statusReview: 'overview',
};

function destructiveMessage(action: IssueActionEntry, issueId: string) {
  switch (action.key) {
    case 'closeOut':
      return `Close out ${issueId}?\n\nThis final cleanup archives workspace artifacts, cleans up agent state and workspace resources, and closes the tracker issue.`;
    case 'wipe':
      return `Wipe ${issueId}?\n\nThis is destructive and removes workspace and agent state for the issue.`;
    case 'destroyWorkspace':
      return `Destroy the workspace for ${issueId}?\n\nThis removes workspace resources but leaves the issue record intact.`;
    case 'resetIssue':
      return `Reset ${issueId}?\n\nThis stops any running agent, deletes the workspace and feature branch, clears beads and vBRIEF state, and moves the issue back to Todo.`;
    case 'cancel':
      return `Cancel ${issueId}?\n\nThis cancels the issue and wipes the workspace state for the abandoned run.`;
    case 'resetSession':
      return `Reset the saved session for ${issueId}?\n\nThe next start will create a fresh agent session.`;
    case 'restartFromPlan':
    case 'restartAgent':
      return `Restart work for ${issueId}?\n\nThis stops the current agent path and starts a replacement run from existing context.`;
    default:
      return `${action.label} for ${issueId}?`;
  }
}

export function useIssueActions(issueId: string): UseIssueActionsResult {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const alert = useAlert();
  const issues = useDashboardStore(selectIssues) as Issue[];
  const agents = useDashboardStore(selectAgents) as Agent[];
  const reviewStatus = useDashboardStore(selectReviewStatus(issueId));
  const openIssue = useDashboardStore((state) => state.openIssue);
  const [activeDialog, setActiveDialog] = useState<IssueActionDialogState>(null);
  const [pendingKey, setPendingKey] = useState<IssueActionKey | null>(null);

  const issue = useMemo(() => issues.find((candidate) => candidate.identifier.toLowerCase() === issueId.toLowerCase()), [issueId, issues]);
  const agent = useMemo(() => activeAgentForIssue(agents, issueId), [agents, issueId]);

  const { data: lifecycle } = useQuery<WorkAgentLifecycle | undefined>({
    queryKey: ['agent-session', agent?.id],
    queryFn: async () => {
      const response = await fetch(`/api/agents/${agent!.id}/has-session`);
      if (!response.ok) return undefined;
      const data = await response.json() as { lifecycle?: WorkAgentLifecycle };
      return data.lifecycle;
    },
    enabled: !!agent && agent.status === 'stopped',
    staleTime: 10000,
  });

  const { data: workspace } = useQuery<WorkspaceInfo | undefined>({
    queryKey: ['workspace', issueId],
    queryFn: async () => {
      const response = await fetch(`/api/workspaces/${issueId}`);
      if (!response.ok) return { exists: !!issue?.workspacePath, issueId, path: issue?.workspacePath };
      return response.json() as Promise<WorkspaceInfo>;
    },
    enabled: !!issueId,
    refetchInterval: 30000,
  });

  const { data: planningState } = useQuery<PlanningState | undefined>({
    queryKey: ['planning-state', issueId],
    queryFn: async () => {
      const response = await fetch(`/api/issues/${issueId}/planning-state`);
      if (!response.ok) return undefined;
      return response.json() as Promise<PlanningState>;
    },
    enabled: !!issueId,
    staleTime: 15000,
    refetchInterval: 30000,
  });

  const state: IssueActionState = useMemo(() => {
    const workspaceInfo = workspace ?? { exists: !!issue?.workspacePath, issueId, path: issue?.workspacePath };
    return {
      reviewStatus: reviewStatus ?? null,
      agent: agent ?? null,
      lifecycle: lifecycle ?? agent?.lifecycle ?? null,
      workspace: workspaceInfo,
      hasPlan: planningState?.hasPlan ?? issue?.hasPlan ?? false,
      hasBeads: planningState?.hasBeads ?? issue?.hasBeads ?? false,
      hasInference: Boolean((workspace as WorkspaceInfo & { hasInference?: boolean } | undefined)?.hasInference),
      hasTranscripts: Boolean((workspace as WorkspaceInfo & { hasTranscripts?: boolean } | undefined)?.hasTranscripts),
      hasDiscussions: Boolean((workspace as WorkspaceInfo & { hasDiscussions?: boolean } | undefined)?.hasDiscussions),
      issueCanonicalState: issue?.state ?? STATUS_LABELS[issue?.status ?? ''] ?? issue?.status ?? null,
      isMerged: reviewStatus?.mergeStatus === 'merged' || issue?.mergeStatus === 'merged',
      hasPr: Boolean(reviewStatus?.readyForMerge || reviewStatus?.prUrl || workspace?.mrUrl),
      prUrl: reviewStatus?.prUrl ?? workspace?.mrUrl ?? null,
      hasPendingInput: agent?.hasPendingQuestion === true,
    };
  }, [agent, issue, issueId, lifecycle, planningState, reviewStatus, workspace]);

  const phase = useMemo(() => deriveIssueActionPhase(state), [state]);

  const postActionMutation = useMutation({
    mutationFn: async ({ action }: PostActionInput) => {
      if (!action.endpoint) return { success: true };
      const response = await fetch(interpolateEndpoint(action.endpoint, issueId, agent, state), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: bodyForAction(action, issueId, issue) ? JSON.stringify(bodyForAction(action, issueId, issue)) : undefined,
      });
      if (!response.ok) throw new Error(await responseError(response, `Failed to run ${action.label}`));
      return response.json().catch(() => ({ success: true }));
    },
    onSuccess: async () => {
      await refreshDashboardState(queryClient);
      queryClient.invalidateQueries({ queryKey: ['workspace', issueId] });
      queryClient.invalidateQueries({ queryKey: ['planning-state', issueId] });
    },
    onError: (error: Error) => {
      alert({ message: error.message, variant: 'error' });
    },
    onSettled: () => setPendingKey(null),
  });

  const runAction = useCallback(async (action: IssueActionEntry) => {
    if (!action.enabledWhen(state)) return;

    if (action.key === 'viewPr') {
      const url = state.prUrl ?? state.workspace?.mrUrl;
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }

    const artifactTab = artifactTabs[action.key];
    if (artifactTab) {
      openIssue(issueId, artifactTab);
      return;
    }

    if (action.kind === 'destructive') {
      const confirmed = await confirm({
        title: action.label,
        message: destructiveMessage(action, issueId),
        confirmLabel: action.label,
        variant: 'destructive',
        requiredText: action.label,
      });
      if (!confirmed) return;
    }

    if (dialogActionKeys.has(action.key) || (!action.endpoint && action.kind === 'dialog') || action.key === 'open') {
      setActiveDialog({ key: action.key, action });
      return;
    }

    if (!action.endpoint) return;
    setPendingKey(action.key);
    postActionMutation.mutate({ action });
  }, [confirm, issueId, openIssue, postActionMutation, state]);

  const all = useMemo<IssueActionView[]>(() => ISSUE_ACTIONS.map((action) => {
    const enabled = action.enabledWhen(state);
    return {
      action,
      enabled,
      disabledReason: enabled ? undefined : disabledReasonForAction(action),
      isPending: pendingKey === action.key && postActionMutation.isPending,
      invoke: () => { void runAction(action); },
    };
  }), [pendingKey, postActionMutation.isPending, runAction, state]);

  const layout = useMemo<IssueActionLayout>(() => {
    const byKey = new Map(all.map((view) => [view.action.key, view]));
    const primary = getPhasePrimaryActions(state, phase)
      .map((action) => byKey.get(action.key))
      .filter((view): view is IssueActionView => !!view);
    const primaryKeys = new Set(primary.map((view) => view.action.key));
    const rest = all.filter((view) => !primaryKeys.has(view.action.key));
    const secondary = rest.filter((view) => view.enabled && view.action.kind !== 'destructive' && view.action.group !== 'danger').slice(0, 4);
    const secondaryKeys = new Set(secondary.map((view) => view.action.key));
    const overflow = rest.filter((view) => !secondaryKeys.has(view.action.key));
    return { all, primary, secondary, overflow };
  }, [all, phase, state]);

  return {
    ...layout,
    issue,
    agent,
    workspace,
    lifecycle,
    state,
    phase,
    activeDialog,
    closeDialog: () => setActiveDialog(null),
  };
}
