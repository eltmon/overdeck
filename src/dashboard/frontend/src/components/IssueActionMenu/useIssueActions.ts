import { useCallback, useMemo, useState } from 'react';
import type { OrderBook } from '@overdeck/contracts';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

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
import { dashboardMutationJsonHeaders } from '../../lib/wsTransport';
import { recoveryFromBody, useResumeRecovery } from '../../lib/resumeRecovery';
import { toastResumeOutcome } from '../../lib/resumeOutcome';
import { selectAgents, selectIssues, selectReviewStatus, useDashboardStore } from '../../lib/store';
import type { WorkspaceInfo } from '../../lib/workspace-types';
import { STATUS_LABELS, type Agent, type Issue, type WorkAgentLifecycle } from '../../types';

export type IssueActionDialogState = {
  key: IssueActionKey;
  action: IssueActionEntry;
} | null;

export type IssueActionSubmenuOption = {
  key: string;
  label: string;
  invoke: () => void;
};

export type IssueActionView = {
  action: IssueActionEntry;
  enabled: boolean;
  disabledReason?: string;
  isPending: boolean;
  invoke: () => void;
  submenu?: IssueActionSubmenuOption[];
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
  submitDialogAction: (action: IssueActionEntry, body?: Record<string, unknown>, selectedTaskId?: string | null) => void;
  createOrderBookForIssue: (name: string) => Promise<void>;
  isActionPending: (key: IssueActionKey) => boolean;
};

type PostActionInput = {
  action: IssueActionEntry;
  body?: Record<string, unknown>;
  selectedTaskId?: string | null;
};

type AlertFn = ReturnType<typeof useAlert>;

function activeAgentForIssue(agents: Agent[], issueId: string) {
  const issueAgents = agents.filter((agent) => agent.issueId?.toLowerCase() === issueId.toLowerCase());
  const live = issueAgents.find((agent) => !['stopped', 'failed', 'dead', 'error', 'stuck'].includes(agent.status));
  if (live) return live;
  // All stopped: prefer the canonical WORK agent (agent-<issue>) over whichever
  // stopped specialist happens to sort first — issueAgents[0] was routinely the
  // planning agent, so agent actions (resume/reset session) evaluated against
  // an agent that never has a resumable session (2026-07-14, MIN-865).
  const workAgentId = `agent-${issueId.toLowerCase()}`;
  return issueAgents.find((agent) => agent.id?.toLowerCase() === workAgentId) ?? issueAgents[0];
}

async function responseError(response: Response, fallback: string, preRead?: { text: string; parsed: unknown }) {
  const text = preRead?.text ?? (await response.text());
  if (!text) return fallback;
  const parsed = preRead ? (preRead.parsed as { error?: string; message?: string; hint?: string }) : (() => { try { return JSON.parse(text) as { error?: string; message?: string; hint?: string }; } catch { return null; } })();
  if (parsed) return parsed.error ?? parsed.message ?? parsed.hint ?? fallback;
  return text.length < 200 ? text : fallback;
}

function interpolateEndpoint(endpoint: string, issueId: string, agent: Agent | undefined, state: IssueActionState, selectedTaskId?: string | null) {
  return endpoint
    .replace(':id', encodeURIComponent(issueId))
    .replace(':agentId', encodeURIComponent(agent?.id ?? ''))
    .replace(':taskId', encodeURIComponent(selectedTaskId ?? state.selectedTaskId ?? ''));
}

const untroubledAction = ISSUE_ACTIONS.find((action) => action.key === 'untroubled');

const REVIEW_MODE_SUBMENU_OPTIONS = [
  { mode: 'full', label: 'Full — 4-reviewer convoy' },
  { mode: 'quick', label: 'Quick — single pass (default)' },
  { mode: 'none', label: 'None — skip AI review' },
] as const;

export async function clearTroubledGateForAgent(
  agentId: string,
  queryClient: QueryClient,
  alert: AlertFn,
): Promise<void> {
  if (!untroubledAction?.endpoint) {
    throw new Error('Clear troubled gate action is not registered');
  }

  const response = await fetch(untroubledAction.endpoint.replace(':agentId', encodeURIComponent(agentId)), {
    method: 'POST',
    credentials: 'include',
    headers: await dashboardMutationJsonHeaders(),
    body: '{}',
  });
  if (!response.ok) {
    const message = await responseError(response, `Failed to run ${untroubledAction.label}`);
    void alert({ message, variant: 'error' });
    throw new Error(message);
  }

  await refreshDashboardState(queryClient);
  void alert({ message: `Cleared troubled state for ${agentId}`, variant: 'success' });
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
    case 'wipe':
      return { deleteWorkspace: true };
    case 'cancel':
      return { wipeWorkspace: true };
    case 'completeWorkReset':
      return { spawn: false };
    case 'inspectTask':
      return { deep: false };
    case 'doneWork':
      return { message: `If implementation is complete, run: pan done ${issueId} -c "Implementation complete". If work remains, continue the current task.` };
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
    case 'rebuildAndStart':
      return 'Rebuild & start is available after planning when no agent is running and a workspace exists.';
    case 'tell':
    case 'stopAgent':
    case 'pause':
      return 'This action requires a running agent.';
    case 'resumeSession':
    case 'resetSession':
      return 'This action requires a stopped agent with a resumable session.';
    case 'completeWorkReset':
      return 'This action requires an existing work agent with a workspace.';
    case 'requestReview':
      return 'Review can be requested after workspace work is idle and not already in review.';
    case 'restartReview':
      return 'Re-run review is available while review, test, or merge work is active or failed.';
    case 'recoverReview':
      return 'Reset stalled review state is available only when the review pipeline is blocked or failed.';
    case 'inspectTask':
      return 'Select a task before requesting inspection.';
    case 'viewPr':
      return 'No pull request URL is available yet.';
    case 'addToOrderBook':
      return 'Available only for open issues that are not already in a non-complete order book.';
    case 'open':
      return 'Workspace does not exist';
    case 'syncMain':
    case 'copySettings':
    case 'destroyWorkspace':
      return 'This action requires an existing workspace.';
    case 'tasks':
      return 'No plan or tasks are available for this issue yet.';
    case 'inference':
      return 'No inference artifact is available for this issue.';
    case 'discussions':
      return 'No discussion artifact is available for this issue.';
    case 'transcripts':
      return 'No transcript artifact is available for this issue.';
    case 'closeOut':
      return 'Close out is available only after merge verification.';
    case 'merge':
      return 'Merge is available once review has approved and the PR is mergeable.';
    case 'upload':
      return 'Transcript upload is temporarily unavailable while its endpoint is rebuilt.';
    case 'reopen':
      return 'Reopen is available only for done or canceled issues.';
    case 'unpause':
      return 'This agent is not paused.';
    case 'untroubled':
      return 'This agent is not troubled.';
    default:
      return `${action.label} is unavailable in the current issue state.`;
  }
}

const dialogActionKeys = new Set<IssueActionKey>([
  'plan',
  'autoPlan',
  'startSkipPlanning',
  'tell',
  'inspectTask',
  'open',
  'upload',
]);

const artifactTabs: Partial<Record<IssueActionKey, string>> = {
  tasks: 'tasks',
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
      return `Reset ${issueId}?\n\nThis stops any running agent, deletes the workspace and feature branch, clears tasks and xBRIEF state, and moves the issue back to Todo.`;
    case 'resetToPlanned':
      return `Reset ${issueId} to planned?\n\nThis stops issue agents and clears task progress and claims, saved sessions, completion markers, pipeline verdicts, retries, and merge-queue state. It preserves the workspace, branch, commits, and finalized xBRIEF, returns the issue to open + planned, and does not start an agent.`;
    case 'cancel':
      return `Cancel ${issueId}?\n\nThis cancels the issue and wipes the workspace state for the abandoned run.`;
    case 'resetSession':
      return `Reset the saved session for ${issueId}?\n\nThe next start will create a fresh agent session.`;
    case 'restartFromPlan':
    case 'restartAgent':
      return `Restart work for ${issueId}?\n\nThis stops the current agent path and starts a replacement run from existing context.`;
    case 'completeWorkReset':
      return `Complete work reset for ${issueId}?\n\nThis will delete the work agent's state (sessions, activity, logs) but keep the workspace, xBRIEF, tasks, and commit history. The agent will not be re-spawned — click Start when you're ready.`;
    case 'purgeReview':
      return `Remove review sessions and reset ${issueId}?\n\nThis kills and removes ALL review agents for the issue — the review agent plus any leftover sub-reviewers — and resets the review/test/merge status. Agent state and tmux sessions are removed; transcripts and work are untouched. A fresh review can then run clean.`;
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
  const openRecovery = useResumeRecovery((s) => s.openRecovery);

  const issue = useMemo(() => issues.find((candidate) => candidate.identifier.toLowerCase() === issueId.toLowerCase()), [issueId, issues]);
  const agent = useMemo(() => activeAgentForIssue(agents, issueId), [agents, issueId]);

  // The WS-fed agents store carries no lifecycle, so agent?.lifecycle is
  // usually undefined here — which silently disabled resumeSession/resetSession
  // everywhere this hook powers (2026-07-14, MIN-865). For a stopped agent,
  // fall back to the endpoint purpose-built for this question.
  const stoppedAgentId = agent && ['stopped', 'failed', 'dead', 'error', 'stuck'].includes(agent.status) ? agent.id : null;
  const lifecycleFallback = useQuery({
    queryKey: ['agent-lifecycle', stoppedAgentId],
    queryFn: async () => {
      const res = await fetch(`/api/agents/${encodeURIComponent(stoppedAgentId ?? '')}/has-session`);
      if (!res.ok) throw new Error(`has-session failed: ${res.status}`);
      const data = await res.json() as { lifecycle?: WorkAgentLifecycle };
      return data.lifecycle ?? null;
    },
    enabled: !!stoppedAgentId && !agent?.lifecycle,
    staleTime: 15_000,
  });
  const lifecycle = agent?.lifecycle ?? lifecycleFallback.data ?? undefined;

  const orderBooksQuery = useQuery({
    queryKey: ['order-books'],
    queryFn: async () => {
      const response = await fetch('/api/orders');
      if (!response.ok) throw new Error(`orders failed: ${response.status}`);
      const payload = await response.json() as { books?: OrderBook[] };
      return payload.books ?? [];
    },
    staleTime: 15_000,
  });
  const activeOrderBooks = useMemo(
    () => (orderBooksQuery.data ?? []).filter((book) => book.status !== 'complete'),
    [orderBooksQuery.data],
  );
  const isInActiveOrderBook = useMemo(
    () => activeOrderBooks.some((book) => book.items.some((item) => item.issue.toLowerCase() === issueId.toLowerCase())),
    [activeOrderBooks, issueId],
  );

  const workspace = useMemo<WorkspaceInfo | undefined>(() => {
    if (!issue?.workspacePath) return undefined;
    return { exists: true, issueId, path: issue.workspacePath };
  }, [issue?.workspacePath, issueId]);

  const state: IssueActionState = useMemo(() => {
    const workspaceInfo = workspace ?? { exists: false, issueId, path: undefined };
    return {
      reviewStatus: reviewStatus ?? null,
      agent: agent ?? null,
      lifecycle: lifecycle ?? agent?.lifecycle ?? null,
      workspace: workspaceInfo,
      hasPlan: issue?.hasPlan ?? false,
      hasTasks: issue?.hasTasks ?? false,
      hasInference: false,
      hasTranscripts: false,
      hasDiscussions: false,
      issueCanonicalState: issue?.state ?? STATUS_LABELS[issue?.status ?? ''] ?? issue?.status ?? null,
      isMerged: reviewStatus?.mergeStatus === 'merged' || issue?.mergeStatus === 'merged',
      hasPr: Boolean(reviewStatus?.readyForMerge || reviewStatus?.prUrl),
      prUrl: reviewStatus?.prUrl ?? null,
      hasPendingInput: agent?.hasPendingQuestion === true,
      orderBooksLoaded: orderBooksQuery.isSuccess,
      isInActiveOrderBook,
    };
  }, [agent, isInActiveOrderBook, issue, issueId, lifecycle, orderBooksQuery.isSuccess, reviewStatus, workspace]);

  const phase = useMemo(() => deriveIssueActionPhase(state), [state]);

  const postActionMutation = useMutation({
    mutationFn: async ({ action, body, selectedTaskId }: PostActionInput) => {
      if (!action.endpoint) return { success: true };
      const payload = body ?? bodyForAction(action, issueId, issue);
      const response = await fetch(interpolateEndpoint(action.endpoint, issueId, agent, state, selectedTaskId), {
        method: 'POST',
        credentials: 'include',
        headers: await dashboardMutationJsonHeaders(),
        body: payload ? JSON.stringify(payload) : '{}',
      });
      if (!response.ok) {
        const text = await response.text();
        let parsed: unknown = null;
        try { parsed = JSON.parse(text); } catch { /* not JSON */ }
        // A 409 carrying a resumable lifecycle is a CHOICE, not an error —
        // surface the Resume / Start fresh dialog instead of a raw alert. The
        // retry payload lets a live-session recovery re-run THIS action after
        // the stop.
        const recovery = response.status === 409 ? recoveryFromBody(parsed) : null;
        if (recovery) {
          openRecovery({
            ...recovery,
            issueId,
            retry: { url: interpolateEndpoint(action.endpoint, issueId, agent, state, selectedTaskId), body: payload ?? {} },
          });
          return { success: false, recovery: true };
        }
        throw new Error(await responseError(response, `Failed to run ${action.label}`, { text, parsed }));
      }
      return response.json().catch(() => ({ success: true }));
    },
    onSuccess: async (_data, { action, body }) => {
      await refreshDashboardState(queryClient);
      if (action.key === 'requestReview') {
        const result = _data as { success?: boolean; error?: string; message?: string; hint?: string } | undefined;
        if (result?.success === false) {
          toast.error('Review request not accepted', {
            description: result.error ?? result.message ?? result.hint ?? `Review was not requested for ${issueId}`,
          });
          return;
        }
        const mode = (body as { reviewMode?: string } | undefined)?.reviewMode;
        toast.success(mode
          ? `${issueId}: review requested (${mode} mode)`
          : `${issueId}: review requested`);
      }
      if (action.key === 'unpause') {
        // The route resumes immediately when a session exists — no more
        // "deacon resumes it on the next patrol" wait.
        const resuming = (_data as { resumeTriggered?: boolean } | undefined)?.resumeTriggered === true;
        toast.success(resuming ? `${issueId} unpaused — resuming now` : `${issueId} unpaused`);
      }
      if (action.key === 'resumeSession' && agent?.id) {
        // PAN-2975: every resume affordance reports the actual outcome.
        toastResumeOutcome(agent.id);
      }
    },
    onError: (error: Error) => {
      alert({ message: error.message, variant: 'error' });
    },
    onSettled: () => setPendingKey(null),
  });

  const submitDialogAction = useCallback((action: IssueActionEntry, body?: Record<string, unknown>, selectedTaskId?: string | null) => {
    setPendingKey(action.key);
    postActionMutation.mutate({ action, body, selectedTaskId });
  }, [postActionMutation]);

  const addToOrderBookMutation = useMutation({
    mutationFn: async (bookId: string) => {
      const response = await fetch(`/api/orders/${encodeURIComponent(bookId)}/items`, {
        method: 'POST',
        credentials: 'include',
        headers: await dashboardMutationJsonHeaders(),
        body: JSON.stringify({ item: { issue: issueId, lane: 'A' } }),
      });
      if (!response.ok) throw new Error(await responseError(response, 'Failed to add issue to order book'));
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['order-books'] });
      toast.success(`${issueId} added to the order book`);
    },
    onError: (error: Error) => alert({ message: error.message, variant: 'error' }),
    onSettled: () => setPendingKey(null),
  });

  const addIssueToOrderBook = useCallback((bookId: string) => {
    setPendingKey('addToOrderBook');
    addToOrderBookMutation.mutate(bookId);
  }, [addToOrderBookMutation]);

  const createOrderBookForIssue = useCallback(async (name: string) => {
    setPendingKey('addToOrderBook');
    try {
      const createResponse = await fetch('/api/orders', {
        method: 'POST',
        credentials: 'include',
        headers: await dashboardMutationJsonHeaders(),
        body: JSON.stringify({ name }),
      });
      if (!createResponse.ok) throw new Error(await responseError(createResponse, 'Failed to create order book'));
      const created = await createResponse.json() as OrderBook;
      const addResponse = await fetch(`/api/orders/${encodeURIComponent(created.id)}/items`, {
        method: 'POST',
        credentials: 'include',
        headers: await dashboardMutationJsonHeaders(),
        body: JSON.stringify({ item: { issue: issueId, lane: 'A' } }),
      });
      if (!addResponse.ok) throw new Error(await responseError(addResponse, 'Failed to add issue to the new order book'));
      await queryClient.invalidateQueries({ queryKey: ['order-books'] });
      toast.success(`${issueId} added to ${created.name}`);
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      await alert({ message: error.message, variant: 'error' });
      throw error;
    } finally {
      setPendingKey(null);
    }
  }, [alert, issueId, queryClient]);

  const isActionPending = useCallback((key: IssueActionKey) => pendingKey === key && (postActionMutation.isPending || addToOrderBookMutation.isPending), [addToOrderBookMutation.isPending, pendingKey, postActionMutation.isPending]);

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

    // Merge is safe-kind but irreversible-ish: keep the old MergeButton's
    // confirm step (C-ACTIONS — same guard, one registry path).
    if (action.key === 'merge') {
      const confirmed = await confirm({
        title: 'Merge to main',
        message: `Merge ${issueId} into main?\n\nThe branch is approved and checks are green. This cannot be un-merged automatically.`,
        confirmLabel: 'Merge to main',
        variant: 'default',
      });
      if (!confirmed) return;
    }

    if (dialogActionKeys.has(action.key) || (!action.endpoint && action.kind === 'dialog') || action.key === 'open') {
      setActiveDialog({ key: action.key, action });
      return;
    }

    if (!action.endpoint) return;
    submitDialogAction(action);
  }, [confirm, issueId, openIssue, state, submitDialogAction]);

  const all = useMemo<IssueActionView[]>(() => ISSUE_ACTIONS.map((action) => {
    const enabled = action.enabledWhen(state);
    const invoke = () => { void runAction(action); };
    return {
      action,
      enabled,
      disabledReason: enabled ? undefined : disabledReasonForAction(action),
      isPending: isActionPending(action.key),
      invoke,
      submenu: action.key === 'addToOrderBook' && enabled
        ? [
            ...activeOrderBooks.map((book) => ({
              key: book.id,
              label: book.name,
              invoke: () => addIssueToOrderBook(book.id),
            })),
            { key: 'new', label: '+ New book…', invoke },
          ]
        : action.key === 'requestReview' && enabled
          ? REVIEW_MODE_SUBMENU_OPTIONS.map((option) => ({
              key: option.mode,
              label: option.label,
              invoke: () => submitDialogAction(action, { reviewMode: option.mode }),
            }))
          : undefined,
    };
  }), [activeOrderBooks, addIssueToOrderBook, isActionPending, runAction, state, submitDialogAction]);

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
    submitDialogAction,
    createOrderBookForIssue,
    isActionPending,
  };
}
