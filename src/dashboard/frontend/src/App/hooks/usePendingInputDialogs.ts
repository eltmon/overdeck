import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ClaudeChannelPermissionBehavior } from '@overdeck/contracts';
import type { ConfirmationRequest } from '../../components/ConfirmationDialog';
import type { AskUserQuestionSubject } from '../../components/AskUserQuestionDialog';
import type { PlanApprovalSubject } from '../../components/PlanApprovalDialog';
import { useDashboardStore, selectAgentsWithPendingAskUserQuestion, selectAgentsWithPendingProposedPlan, selectChannelPermissionRequests } from '../../lib/store';
import { useAskUserQuestionUiStore } from '../../lib/askUserQuestionUiStore';
import { refreshDashboardState } from '../../lib/refresh-dashboard-state';
import { fetchWithTimeout } from '../../lib/apiFetch';
import type { Agent, Issue } from '../../types';
import {
  fetchConfirmations,
  respondToChannelPermission,
  respondToConfirmation,
} from '../api';

type ConvAskUserQuestionRow = {
  name: string;
  title?: string | null;
  issueId?: string | null;
  pendingAskUserQuestion?: AskUserQuestionSubject['pendingAskUserQuestion'];
  // PAN-1520 (FR-2) — pending ExitPlanMode plan payload for conversation rows.
  pendingProposedPlan?: PlanApprovalSubject['pendingProposedPlan'];
};

interface UsePendingInputDialogsArgs {
  agents: Agent[];
  issues: Issue[];
}

export function usePendingInputDialogs({ agents, issues }: UsePendingInputDialogsArgs) {
  const queryClient = useQueryClient();
  const channelPermissionRequests = useDashboardStore(selectChannelPermissionRequests);
  const agentsWithAskUserQuestion = useDashboardStore(selectAgentsWithPendingAskUserQuestion);
  const agentsWithProposedPlan = useDashboardStore(selectAgentsWithPendingProposedPlan);
  const resolvedPlanToolUseIds = useAskUserQuestionUiStore((s) => s.resolvedPlanToolUseIds);
  const dismissedPlanSubjectIds = useAskUserQuestionUiStore((s) => s.dismissedPlanSubjectIds);
  const markPlanResolved = useAskUserQuestionUiStore((s) => s.markPlanResolved);
  const unmarkPlanResolved = useAskUserQuestionUiStore((s) => s.unmarkPlanResolved);
  const markPlanDismissed = useAskUserQuestionUiStore((s) => s.markPlanDismissed);
  const undismissPlan = useAskUserQuestionUiStore((s) => s.undismissPlan);
  const reconcilePlanResolved = useAskUserQuestionUiStore((s) => s.reconcilePlanResolved);
  const reconcilePlanDismissed = useAskUserQuestionUiStore((s) => s.reconcilePlanDismissed);
  const [focusedPlanSubjectId, setFocusedPlanSubjectId] = useState<string | null>(null);
  const optimisticallyAnsweredAskUserQuestionIds = useAskUserQuestionUiStore((s) => s.answeredToolUseIds);
  const dismissedAskUserQuestionAgentIds = useAskUserQuestionUiStore((s) => s.dismissedSubjectIds);
  const markAskUserQuestionAnswered = useAskUserQuestionUiStore((s) => s.markAnswered);
  const unmarkAskUserQuestionAnswered = useAskUserQuestionUiStore((s) => s.unmarkAnswered);
  const markAskUserQuestionDismissed = useAskUserQuestionUiStore((s) => s.markDismissed);
  const undismissAskUserQuestion = useAskUserQuestionUiStore((s) => s.undismiss);
  const reconcileAnsweredAskUserQuestions = useAskUserQuestionUiStore((s) => s.reconcileAnswered);
  const reconcileDismissedAskUserQuestions = useAskUserQuestionUiStore((s) => s.reconcileDismissed);
  const askUserQuestionReopenId = useAskUserQuestionUiStore((s) => s.reopenId);
  const askUserQuestionReopenNonce = useAskUserQuestionUiStore((s) => s.reopenNonce);
  const requestAskUserQuestionReopen = useAskUserQuestionUiStore((s) => s.requestReopen);
  const [optimisticallyResolvedChannelPermissionRequestIds, setOptimisticallyResolvedChannelPermissionRequestIds] =
    useState<Set<string>>(new Set());
  const [focusedAskUserQuestionId, setFocusedAskUserQuestionId] = useState<string | null>(null);
  const [currentConfirmation, setCurrentConfirmation] = useState<ConfirmationRequest | null>(null);
  // Latest pending-input feed rows, readable from the reopen effect without
  // re-running it on every 4s poll (FR-5 routing needs the conv rows).
  const convAskUserQuestionRowsRef = useRef<ConvAskUserQuestionRow[]>([]);

  useEffect(() => {
    if (!askUserQuestionReopenId) return;
    // Bug 3 (TIN-1): a notification's Open/Answer can be clicked AFTER the asking
    // session stopped and its pending AUQ cleared (e.g. planning auto-completed).
    // Un-dismiss + focus so the dialog reopens if the question is still live; if
    // it's already resolved, tell the operator instead of silently no-opping.
    const agentEntry = useDashboardStore.getState().agentsById[askUserQuestionReopenId];
    // Only an agent subject (present in agentsById) can be confidently judged
    // resolved here; conversation subjects are tracked via a separate poll, so
    // never claim those are "no longer waiting".
    const knownAgent = agentEntry != null;
    // PAN-1520 (FR-5) — route by what is actually pending: a planning
    // notification must open the plan-approval dialog, not the AUQ modal.
    // AUQ wins when both are somehow pending (it blocks the plan answer anyway).
    const convRow = convAskUserQuestionRowsRef.current.find((c) => c.name === askUserQuestionReopenId);
    const hasAuq = agentEntry?.pendingAskUserQuestion != null || convRow?.pendingAskUserQuestion != null;
    const hasPlan = agentEntry?.pendingProposedPlan != null || convRow?.pendingProposedPlan != null;
    if (!hasAuq && hasPlan) {
      undismissPlan(askUserQuestionReopenId);
      setFocusedPlanSubjectId(askUserQuestionReopenId);
      return;
    }
    // PAN-2487 follow-up: "still pending" must consider EVERY pending-input kind,
    // not only AskUserQuestion payloads. A pane-detected wait (rateLimit,
    // sessionResume) has no AUQ payload, so the old check told the operator
    // "no longer waiting" while the agent was still modal-blocked — and the
    // needs-you entry (correctly) refused to clear.
    const stillPending =
      agentEntry?.pendingAskUserQuestion != null ||
      (agentEntry?.pendingInputKinds?.length ?? 0) > 0;
    undismissAskUserQuestion(askUserQuestionReopenId);
    setFocusedAskUserQuestionId(askUserQuestionReopenId);
    if (knownAgent && !stillPending) {
      toast.info('That question is no longer waiting', {
        description: 'The agent stopped or already received an answer.',
      });
    } else if (knownAgent && agentEntry?.pendingAskUserQuestion == null && (agentEntry?.pendingInputKinds?.length ?? 0) > 0) {
      toast.info('This agent is blocked on a terminal dialog', {
        description: 'Open its terminal to answer (e.g. a harness rate-limit or session-resume prompt) — it cannot be answered from here yet.',
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askUserQuestionReopenNonce]);

  const visibleChannelPermissionRequests = channelPermissionRequests.filter(
    (request) => !optimisticallyResolvedChannelPermissionRequestIds.has(request.requestId)
  );
  const currentChannelPermissionRequest = visibleChannelPermissionRequests[0] ?? null;
  const currentChannelPermissionIssueId = currentChannelPermissionRequest?.issueId
    ?? agents.find((agent) => agent.id === currentChannelPermissionRequest?.agentId)?.issueId;

  // PAN-1520 / PAN-1705: poll only the dedicated pending-input feed for
  // conversation AskUserQuestion rows.
  const { data: convAskUserQuestionRows = [] } = useQuery({
    queryKey: ['conv-ask-user-question'],
    queryFn: async ({ signal }): Promise<ConvAskUserQuestionRow[]> => {
      const res = await fetchWithTimeout('/api/conversations/pending-input', { signal });
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 4000,
    refetchIntervalInBackground: true,
  });
  convAskUserQuestionRowsRef.current = convAskUserQuestionRows;

  // PAN-1520 (FR-3) — plan-approval subjects across agents and conversations,
  // mirroring the AUQ subject assembly below.
  const planApprovalSubjects: Array<PlanApprovalSubject & { kind: 'agent' | 'conv'; askedAt: string }> = [
    ...agentsWithProposedPlan.map((a) => ({
      kind: 'agent' as const,
      id: a.id,
      issueId: a.issueId ?? null,
      kindLabel: 'Agent',
      title: a.issueId ? (issues.find((i) => i.id === a.issueId)?.title ?? null) : null,
      pendingProposedPlan: a.pendingProposedPlan,
      askedAt: a.pendingProposedPlan?.askedAt ?? '',
    })),
    ...convAskUserQuestionRows
      .filter((c) => c.pendingProposedPlan)
      .map((c) => ({
        kind: 'conv' as const,
        id: c.name,
        issueId: c.issueId ?? null,
        kindLabel: 'Conversation',
        title: c.title ?? null,
        pendingProposedPlan: c.pendingProposedPlan,
        askedAt: c.pendingProposedPlan?.askedAt ?? '',
      })),
  ];
  planApprovalSubjects.sort((a, b) => (a.askedAt === b.askedAt ? a.id.localeCompare(b.id) : a.askedAt.localeCompare(b.askedAt)));
  const visiblePlanApprovalSubjects = planApprovalSubjects.filter((s) => {
    const toolUseId = s.pendingProposedPlan?.toolUseId;
    if (!toolUseId) return false;
    if (resolvedPlanToolUseIds.has(toolUseId)) return false;
    if (dismissedPlanSubjectIds.has(s.id)) return false;
    return true;
  });
  const currentPlanApprovalSubject =
    (focusedPlanSubjectId
      ? visiblePlanApprovalSubjects.find((s) => s.id === focusedPlanSubjectId)
      : undefined) ??
    visiblePlanApprovalSubjects[0] ??
    null;

  const askUserQuestionSubjects: Array<AskUserQuestionSubject & { kind: 'agent' | 'conv'; askedAt: string }> = [
    ...agentsWithAskUserQuestion.map((a) => ({
      kind: 'agent' as const,
      id: a.id,
      issueId: a.issueId ?? null,
      kindLabel: 'Agent',
      title: a.issueId ? (issues.find((i) => i.id === a.issueId)?.title ?? null) : null,
      pendingAskUserQuestion: a.pendingAskUserQuestion,
      askedAt: a.pendingAskUserQuestion?.askedAt ?? '',
    })),
    ...convAskUserQuestionRows.map((c) => ({
      kind: 'conv' as const,
      id: c.name,
      issueId: c.issueId ?? null,
      kindLabel: 'Conversation',
      title: c.title ?? null,
      pendingAskUserQuestion: c.pendingAskUserQuestion,
      askedAt: c.pendingAskUserQuestion?.askedAt ?? '',
    })),
  ];
  askUserQuestionSubjects.sort((a, b) => (a.askedAt === b.askedAt ? a.id.localeCompare(b.id) : a.askedAt.localeCompare(b.askedAt)));
  const visibleAskUserQuestionSubjects = askUserQuestionSubjects.filter((s) => {
    const toolUseId = s.pendingAskUserQuestion?.toolUseId;
    if (!toolUseId) return false;
    if (optimisticallyAnsweredAskUserQuestionIds.has(toolUseId)) return false;
    if (dismissedAskUserQuestionAgentIds.has(s.id)) return false;
    return true;
  });
  const currentAskUserQuestionSubject =
    (focusedAskUserQuestionId
      ? visibleAskUserQuestionSubjects.find((s) => s.id === focusedAskUserQuestionId)
      : undefined) ??
    visibleAskUserQuestionSubjects[0] ??
    null;

  useEffect(() => {
    setOptimisticallyResolvedChannelPermissionRequestIds((prev) => {
      const next = new Set<string>();
      const visibleRequestIds = new Set(channelPermissionRequests.map((request) => request.requestId));
      for (const requestId of prev) {
        if (visibleRequestIds.has(requestId)) {
          next.add(requestId);
        }
      }
      if (next.size === prev.size && Array.from(next).every((requestId) => prev.has(requestId))) {
        return prev;
      }
      return next;
    });
  }, [channelPermissionRequests]);

  const { data: confirmations = [] } = useQuery({
    queryKey: ['confirmations'],
    queryFn: fetchConfirmations,
    refetchInterval: 10000,
  });

  useEffect(() => {
    if (confirmations.length > 0 && !currentConfirmation) {
      setCurrentConfirmation(confirmations[0]);
    }
  }, [confirmations, currentConfirmation]);

  // PAN-1520 — desktop-notification permission grant on first interaction.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') {
      const ask = (): void => {
        Notification.requestPermission().catch(() => { /* ignore */ });
        window.removeEventListener('pointerdown', ask);
      };
      window.addEventListener('pointerdown', ask, { once: true });
      return (): void => { window.removeEventListener('pointerdown', ask); };
    }
    return undefined;
  }, []);

  const notifiedPendingInputRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    // #1102 — clicking the toast or desktop notification re-opens the dialog
    // for that subject (focus + un-dismiss), not just focuses the window.
    const announce = (id: string, subjectId: string, title: string, body: string): void => {
      const key = id;
      if (notifiedPendingInputRef.current.has(key)) return;
      notifiedPendingInputRef.current.add(key);
      const reopen = (): void => requestAskUserQuestionReopen(subjectId);
      toast.info(title, {
        description: body,
        duration: 12000,
        action: { label: 'Answer', onClick: reopen },
      });
      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
        try {
          const n = new Notification(title, { body, tag: key });
          n.onclick = (): void => { window.focus(); reopen(); n.close(); };
        } catch { /* ignore */ }
      }
    };

    for (const a of agentsWithAskUserQuestion) {
      const toolUseId = a.pendingAskUserQuestion?.toolUseId;
      if (!toolUseId) continue;
      const body = a.pendingAskUserQuestion?.questions?.[0]?.question ?? 'AskUserQuestion is open.';
      const label = (a.issueId ? issues.find((i) => i.id === a.issueId)?.title : undefined) ?? a.issueId ?? a.id;
      announce(`agent::${a.id}::${toolUseId}`, a.id, `${label} is waiting on you`, body);
    }
    for (const c of convAskUserQuestionRows) {
      const toolUseId = c.pendingAskUserQuestion?.toolUseId;
      if (!toolUseId) continue;
      const body = c.pendingAskUserQuestion?.questions?.[0]?.question ?? 'AskUserQuestion is open.';
      const label = c.title ?? c.name;
      announce(`conv::${c.name}::${toolUseId}`, c.name, `"${label}" is waiting on you`, body);
    }

    // PAN-1520 (FR-5) — pending plans fire the same toast + desktop
    // notification; clicking re-opens the PLAN dialog (the reopen effect
    // routes by what's pending, so plan subjects land on PlanApprovalDialog).
    for (const p of agentsWithProposedPlan) {
      const toolUseId = p.pendingProposedPlan?.toolUseId;
      if (!toolUseId) continue;
      const label = (p.issueId ? issues.find((i) => i.id === p.issueId)?.title : undefined) ?? p.issueId ?? p.id;
      announce(`agent-plan::${p.id}::${toolUseId}`, p.id, `${label} has a plan awaiting approval`, 'Review and approve the plan to start implementation.');
    }
    for (const c of convAskUserQuestionRows) {
      const toolUseId = c.pendingProposedPlan?.toolUseId;
      if (!toolUseId) continue;
      const label = c.title ?? c.name;
      announce(`conv-plan::${c.name}::${toolUseId}`, c.name, `"${label}" has a plan awaiting approval`, 'Review and approve the plan to start implementation.');
    }

    const liveKeys = new Set<string>();
    for (const a of agentsWithAskUserQuestion) {
      const id = a.pendingAskUserQuestion?.toolUseId;
      if (id) liveKeys.add(`agent::${a.id}::${id}`);
    }
    for (const c of convAskUserQuestionRows) {
      const id = c.pendingAskUserQuestion?.toolUseId;
      if (id) liveKeys.add(`conv::${c.name}::${id}`);
      const planId = c.pendingProposedPlan?.toolUseId;
      if (planId) liveKeys.add(`conv-plan::${c.name}::${planId}`);
    }
    for (const p of agentsWithProposedPlan) {
      const id = p.pendingProposedPlan?.toolUseId;
      if (id) liveKeys.add(`agent-plan::${p.id}::${id}`);
    }
    for (const k of notifiedPendingInputRef.current) {
      if (!liveKeys.has(k)) notifiedPendingInputRef.current.delete(k);
    }
  }, [agentsWithAskUserQuestion, agentsWithProposedPlan, convAskUserQuestionRows, issues]);

  const askUserQuestionAnswerMutation = useMutation({
    mutationFn: async ({ kind, id, answers, questions }: {
      kind: 'agent' | 'conv';
      id: string;
      /** Friendly display label (issue/conversation title) for the toast. */
      label?: string;
      answers: string[];
      questions: AskUserQuestionSubject['pendingAskUserQuestion'] extends infer T
        ? T extends { questions: infer Q } ? Q : never : never;
    }) => {
      if (kind === 'agent') {
        // fetchWithTimeout everywhere in these mutations: a plain fetch that
        // never resolves (e.g. server restart mid-request) leaves isPending
        // stuck true and every dialog button disabled until a page refresh.
        const res = await fetchWithTimeout(`/api/agents/${encodeURIComponent(id)}/answer-question`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ answers }),
        });
        if (!res.ok) {
          let message = `Failed to deliver answer (${res.status})`;
          try { const body = await res.json() as { error?: string }; if (body?.error) message = body.error; } catch { /* ignore */ }
          throw new Error(message);
        }
        return res.json();
      }
      const lines: string[] = [];
      const qArr = (questions ?? []) as ReadonlyArray<{ question: string }>;
      for (let i = 0; i < answers.length && i < qArr.length; i++) {
        const q = qArr[i]?.question ?? `Question ${i + 1}`;
        lines.push(`Q: ${q}\nA: ${answers[i]}`);
      }
      const composed = `Operator answered the pending question${answers.length > 1 ? 's' : ''}:\n\n${lines.join('\n\n')}`;
      const res = await fetchWithTimeout(`/api/conversations/${encodeURIComponent(id)}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: composed }),
      });
      if (!res.ok) {
        let message = `Failed to deliver answer (${res.status})`;
        try { const body = await res.json() as { error?: string }; if (body?.error) message = body.error; } catch { /* ignore */ }
        throw new Error(message);
      }
      return res.json();
    },
    onMutate: (variables) => {
      const toolUseId = currentAskUserQuestionSubject?.pendingAskUserQuestion?.toolUseId;
      if (toolUseId) {
        markAskUserQuestionAnswered(toolUseId);
      }
      return { subjectId: variables.id, toolUseId };
    },
    onSuccess: (_data, variables) => {
      toast.success(`Answer delivered to ${variables.label?.trim() || variables.id}`);
    },
    onError: (error: Error, _variables, context) => {
      if (context?.toolUseId) {
        unmarkAskUserQuestionAnswered(context.toolUseId);
      }
      toast.error(`Failed to deliver answer: ${error.message}`);
    },
  });

  const codexApprovalMutation = useMutation({
    mutationFn: async ({ id, optionNumber }: {
      id: string;
      optionNumber: number;
      label?: string;
      toolUseId?: string;
    }) => {
      const res = await fetchWithTimeout(`/api/conversations/${encodeURIComponent(id)}/codex-approval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ optionNumber }),
      });
      if (!res.ok) {
        let message = `Failed to send approval (${res.status})`;
        try { const body = await res.json() as { error?: string }; if (body?.error) message = body.error; } catch { /* ignore */ }
        throw new Error(message);
      }
      return res.json();
    },
    onMutate: ({ toolUseId }) => {
      if (toolUseId) markAskUserQuestionAnswered(toolUseId);
      return { toolUseId };
    },
    onSuccess: (_data, variables) => {
      toast.success(`Approval sent to ${variables.label?.trim() || variables.id}`);
    },
    onError: (error: Error, _variables, context) => {
      if (context?.toolUseId) unmarkAskUserQuestionAnswered(context.toolUseId);
      toast.error(`Failed to send approval: ${error.message}`);
    },
  });

  const handleSubmitAskUserQuestion = useCallback((answers: string[]) => {
    if (!currentAskUserQuestionSubject) return;
    const subject = currentAskUserQuestionSubject;
    const toolUseId = subject.pendingAskUserQuestion?.toolUseId;
    if (toolUseId?.startsWith('codex-approval:')) {
      const match = /^\s*(\d+)/.exec(answers[0] ?? '');
      const optionNumber = match ? Number(match[1]) : NaN;
      if (!Number.isInteger(optionNumber)) {
        toast.error('Could not determine which option was selected');
        return;
      }
      codexApprovalMutation.mutate({
        id: subject.id,
        optionNumber,
        label: subject.title?.trim() || subject.id,
        toolUseId,
      });
      return;
    }
    askUserQuestionAnswerMutation.mutate({
      kind: (subject as AskUserQuestionSubject & { kind?: 'agent' | 'conv' }).kind ?? 'agent',
      id: subject.id,
      label: subject.title?.trim() || subject.id,
      answers,
      questions: subject.pendingAskUserQuestion?.questions as never,
    });
  }, [askUserQuestionAnswerMutation, codexApprovalMutation, currentAskUserQuestionSubject]);

  const handleDismissAskUserQuestion = useCallback(() => {
    if (!currentAskUserQuestionSubject) return;
    markAskUserQuestionDismissed(currentAskUserQuestionSubject.id);
  }, [currentAskUserQuestionSubject, markAskUserQuestionDismissed]);

  // PAN-1520 (FR-4) — deliver plan approve / request-changes. Agent subjects go
  // through the agent-scoped route; conversations through the existing one.
  const planActionMutation = useMutation({
    mutationFn: async ({ kind, id, action, feedback }: {
      kind: 'agent' | 'conv';
      id: string;
      label?: string;
      action: 'approve-manual' | 'reject-feedback';
      feedback?: string;
      toolUseId?: string;
    }) => {
      const url = kind === 'agent'
        ? `/api/agents/${encodeURIComponent(id)}/plan-action`
        : `/api/conversations/${encodeURIComponent(id)}/plan-action`;
      const res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, feedback }),
      });
      if (!res.ok) {
        let message = `Failed to deliver plan action (${res.status})`;
        try { const body = await res.json() as { error?: string }; if (body?.error) message = body.error; } catch { /* ignore */ }
        throw new Error(message);
      }
      return res.json();
    },
    onMutate: ({ toolUseId }) => {
      if (toolUseId) markPlanResolved(toolUseId);
      return { toolUseId };
    },
    onSuccess: (_data, variables) => {
      toast.success(
        variables.action === 'approve-manual'
          ? `Plan approved for ${variables.label?.trim() || variables.id}`
          : `Plan feedback sent to ${variables.label?.trim() || variables.id}`,
      );
    },
    onError: (error: Error, _variables, context) => {
      if (context?.toolUseId) unmarkPlanResolved(context.toolUseId);
      toast.error(`Plan action failed: ${error.message}`);
    },
  });

  const handleApprovePlan = useCallback(() => {
    if (!currentPlanApprovalSubject) return;
    const subject = currentPlanApprovalSubject;
    planActionMutation.mutate({
      kind: subject.kind,
      id: subject.id,
      label: subject.title?.trim() || subject.issueId || subject.id,
      action: 'approve-manual',
      toolUseId: subject.pendingProposedPlan?.toolUseId,
    });
  }, [currentPlanApprovalSubject, planActionMutation]);

  const handleRequestPlanChanges = useCallback((feedback: string) => {
    if (!currentPlanApprovalSubject) return;
    const subject = currentPlanApprovalSubject;
    planActionMutation.mutate({
      kind: subject.kind,
      id: subject.id,
      label: subject.title?.trim() || subject.issueId || subject.id,
      action: 'reject-feedback',
      feedback,
      toolUseId: subject.pendingProposedPlan?.toolUseId,
    });
  }, [currentPlanApprovalSubject, planActionMutation]);

  const handleDismissPlanApproval = useCallback(() => {
    if (!currentPlanApprovalSubject) return;
    markPlanDismissed(currentPlanApprovalSubject.id);
    setFocusedPlanSubjectId((prev) => (prev === currentPlanApprovalSubject.id ? null : prev));
  }, [currentPlanApprovalSubject, markPlanDismissed]);

  useEffect(() => {
    const liveAgentToolUseIds = agentsWithAskUserQuestion
      .map((a) => a.pendingAskUserQuestion?.toolUseId)
      .filter((id): id is string => typeof id === 'string');
    const liveConvToolUseIds = convAskUserQuestionRows
      .map((c) => c.pendingAskUserQuestion?.toolUseId)
      .filter((id): id is string => typeof id === 'string');
    const liveToolUseIds = new Set<string>([...liveAgentToolUseIds, ...liveConvToolUseIds]);
    reconcileAnsweredAskUserQuestions(liveToolUseIds);
    const liveSubjectIds = new Set<string>([
      ...agentsWithAskUserQuestion.map((a) => a.id),
      ...convAskUserQuestionRows.map((c) => c.name),
    ]);
    reconcileDismissedAskUserQuestions(liveSubjectIds);
    setFocusedAskUserQuestionId((prev) => (prev && liveSubjectIds.has(prev) ? prev : null));

    // PAN-1520 (FR-7) — plans resolved out-of-band (terminal approval writes a
    // matching tool_result; session stop clears the enrichment payload) drop
    // out of the live set, so the optimistic/dismissed marks are pruned and
    // the modal + needs-you entry clear without operator action.
    const livePlanToolUseIds = new Set<string>([
      ...agentsWithProposedPlan
        .map((a) => a.pendingProposedPlan?.toolUseId)
        .filter((id): id is string => typeof id === 'string'),
      ...convAskUserQuestionRows
        .map((c) => c.pendingProposedPlan?.toolUseId)
        .filter((id): id is string => typeof id === 'string'),
    ]);
    reconcilePlanResolved(livePlanToolUseIds);
    const livePlanSubjectIds = new Set<string>([
      ...agentsWithProposedPlan.map((a) => a.id),
      ...convAskUserQuestionRows.filter((c) => c.pendingProposedPlan).map((c) => c.name),
    ]);
    reconcilePlanDismissed(livePlanSubjectIds);
    setFocusedPlanSubjectId((prev) => (prev && livePlanSubjectIds.has(prev) ? prev : null));
  }, [agentsWithAskUserQuestion, agentsWithProposedPlan, convAskUserQuestionRows, reconcileAnsweredAskUserQuestions, reconcileDismissedAskUserQuestions, reconcilePlanResolved, reconcilePlanDismissed]);

  const channelPermissionResponseMutation = useMutation({
    mutationFn: ({
      agentId,
      requestId,
      behavior,
    }: {
      agentId: string;
      requestId: string;
      behavior: ClaudeChannelPermissionBehavior;
    }) => respondToChannelPermission(agentId, requestId, behavior),
    onMutate: async (variables) => {
      setOptimisticallyResolvedChannelPermissionRequestIds((prev) => {
        const next = new Set(prev);
        next.add(variables.requestId);
        return next;
      });
    },
    onSuccess: async (_data, variables) => {
      await refreshDashboardState(queryClient);
      toast.success(
        variables.behavior === 'allow'
          ? `Allowed ${variables.agentId} to continue`
          : `Denied permission request for ${variables.agentId}`,
      );
    },
    onError: (error: Error, variables) => {
      setOptimisticallyResolvedChannelPermissionRequestIds((prev) => {
        if (!prev.has(variables.requestId)) {
          return prev;
        }
        const next = new Set(prev);
        next.delete(variables.requestId);
        return next;
      });
      toast.error(`Permission response failed: ${error.message}`);
    },
  });

  const handleConfirm = useCallback(async () => {
    if (!currentConfirmation) return;
    try {
      await respondToConfirmation(currentConfirmation.id, true);
      setCurrentConfirmation(null);
    } catch (error) {
      console.error('Failed to confirm:', error);
    }
  }, [currentConfirmation]);

  const handleDeny = useCallback(async () => {
    if (!currentConfirmation) return;
    try {
      await respondToConfirmation(currentConfirmation.id, false);
      setCurrentConfirmation(null);
    } catch (error) {
      console.error('Failed to deny:', error);
    }
  }, [currentConfirmation]);

  const handleAllowChannelPermission = useCallback(() => {
    if (!currentChannelPermissionRequest) return;
    channelPermissionResponseMutation.mutate({
      agentId: currentChannelPermissionRequest.agentId,
      requestId: currentChannelPermissionRequest.requestId,
      behavior: 'allow',
    });
  }, [channelPermissionResponseMutation, currentChannelPermissionRequest]);

  const handleDenyChannelPermission = useCallback(() => {
    if (!currentChannelPermissionRequest) return;
    channelPermissionResponseMutation.mutate({
      agentId: currentChannelPermissionRequest.agentId,
      requestId: currentChannelPermissionRequest.requestId,
      behavior: 'deny',
    });
  }, [channelPermissionResponseMutation, currentChannelPermissionRequest]);

  const handleCloseConfirmation = useCallback(() => {
    setCurrentConfirmation(null);
  }, []);

  return {
    currentChannelPermissionRequest,
    currentChannelPermissionIssueId,
    isChannelPermissionSubmitting: channelPermissionResponseMutation.isPending,
    handleAllowChannelPermission,
    handleDenyChannelPermission,
    currentAskUserQuestionSubject,
    isAskUserQuestionSubmitting: askUserQuestionAnswerMutation.isPending || codexApprovalMutation.isPending,
    handleSubmitAskUserQuestion,
    handleDismissAskUserQuestion,
    currentPlanApprovalSubject,
    isPlanActionSubmitting: planActionMutation.isPending,
    handleApprovePlan,
    handleRequestPlanChanges,
    handleDismissPlanApproval,
    currentConfirmation,
    handleConfirm,
    handleDeny,
    handleCloseConfirmation,
  };
}
