/**
 * useZoneAActions — self-contained data layer for the Zone A action strip.
 *
 * Fetches workspace, review status, lifecycle, and planning state so the
 * renderer can call getZoneAActions() with a complete input shape.
 *
 * Mirrors the relevant queries from InspectorPanel so the action strip works
 * without being coupled to the inspector's broader data dependencies.
 */

import { useCallback, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Agent, Issue, WorkAgentLifecycle, StartAgentResponse } from '../../types';
import type { ReviewStatus, WorkspaceInfo } from '../inspector/types';
import { refreshDashboardState } from '../../lib/refresh-dashboard-state';
import { isCodexBlockedResponse, setPendingCodexSpawn } from '../../lib/pending-codex-spawn';

interface PlanningState {
  hasPlan: boolean;
  hasBeads: boolean;
  beadsCount: number;
  planningComplete: boolean;
}

export interface ZoneAActionsState {
  workspace?: WorkspaceInfo;
  reviewStatus?: ReviewStatus;
  reviewStatusLoading: boolean;
  lifecycle?: WorkAgentLifecycle;
  planningState?: PlanningState;
  agentLaunchState: 'starting' | 'resuming' | null;
  setAgentLaunchState: (s: 'starting' | 'resuming' | null) => void;
  // Mutations
  startAgentMutation: ReturnType<typeof useMutation<any, Error, any, any>>;
  reviewMutation: ReturnType<typeof useMutation<any, Error, any, any>>;
  cancelMutation: ReturnType<typeof useMutation<any, Error, any, any>>;
  resetSessionMutation: ReturnType<typeof useMutation<any, Error, any, any>>;
  reopenMutation: ReturnType<typeof useMutation<any, Error, any, any>>;
  createWorkspaceMutation: ReturnType<typeof useMutation<any, Error, any, any>>;
  copySettingsMutation: ReturnType<typeof useMutation<any, Error, any, any>>;
  syncMainMutation: ReturnType<typeof useMutation<any, Error, any, any>>;
  // Handlers (with confirmations baked in where appropriate)
  onStartAgent: (message?: string) => void;
  onReview: () => void;
  onCancel: () => void;
  onResetSession: () => void;
  onReopen: () => void;
  onCreateWorkspace: () => void;
  onCopySettings: () => void;
  onSyncMain: () => void;
  onDismissPending: () => void;
}

export function useZoneAActions(
  issueId: string,
  agent: Agent | undefined,
  issue: Issue | undefined,
): ZoneAActionsState {
  const queryClient = useQueryClient();
  const [agentLaunchState, setAgentLaunchState] = useState<'starting' | 'resuming' | null>(null);

  const { data: lifecycle } = useQuery<WorkAgentLifecycle | undefined>({
    queryKey: ['agent-session', agent?.id],
    queryFn: async () => {
      const res = await fetch(`/api/agents/${agent!.id}/has-session`);
      if (!res.ok) return undefined;
      const data = await res.json();
      return data.lifecycle as WorkAgentLifecycle | undefined;
    },
    enabled: !!agent && agent.status === 'stopped',
    staleTime: 10000,
  });

  const { data: workspace } = useQuery<WorkspaceInfo>({
    queryKey: ['workspace', issueId],
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${issueId}`);
      if (!res.ok) throw new Error('Failed to fetch workspace info');
      return res.json();
    },
    refetchInterval: 30000,
  });

  const { data: reviewStatus, isLoading: reviewStatusLoading } = useQuery<ReviewStatus>({
    queryKey: ['review-status', issueId],
    queryFn: async () => {
      const res = await fetch(`/api/review/${issueId}/status`);
      if (!res.ok) throw new Error('Failed to fetch review status');
      return res.json();
    },
    refetchInterval: 15000,
  });

  const { data: planningState } = useQuery<PlanningState>({
    queryKey: ['planning-state', issueId],
    queryFn: async () => {
      const res = await fetch(`/api/issues/${issueId}/planning-state`);
      if (!res.ok) throw new Error('Failed to fetch planning state');
      return res.json() as Promise<PlanningState>;
    },
    enabled: !!issueId,
    refetchInterval: 30000,
    staleTime: 15000,
  });

  const acknowledgeGuardrailWarnings = useCallback(async (data: StartAgentResponse | undefined) => {
    const warnings = data?.guardrails?.warnings ?? [];
    if (warnings.length === 0) return false;
    if (!data?.requiresAcknowledgement) return true;
    return window.confirm(warnings.map((warning) => `• ${warning.message}`).join('\n'));
  }, []);

  const startAgentMutation = useMutation({
    mutationFn: async (message?: string) => {
      const shouldResume = !!(agent && agent.status === 'stopped' && lifecycle?.canResumeSession);
      setAgentLaunchState(shouldResume ? 'resuming' : 'starting');

      if (shouldResume) {
        const res = await fetch(`/api/agents/${agent.id}/resume`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: message || undefined }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Failed to resume session');
        }
        return res.json();
      }

      const requestBody = { issueId, projectId: issue?.project?.id, message: message || undefined };
      let lastRequestBody: Record<string, unknown> = requestBody;
      let res = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lastRequestBody),
      });
      let data = await res.json().catch(() => ({})) as StartAgentResponse;
      if (res.status === 409 && data.requiresAcknowledgement) {
        const confirmed = await acknowledgeGuardrailWarnings(data);
        if (!confirmed) throw new Error('Agent start canceled');
        lastRequestBody = { ...requestBody, guardrailAcknowledged: true };
        res = await fetch('/api/agents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(lastRequestBody),
        });
        data = await res.json().catch(() => ({})) as StartAgentResponse;
      }
      if (!res.ok) {
        if (isCodexBlockedResponse(res, data)) {
          setPendingCodexSpawn(lastRequestBody);
          throw new Error(data.hint || data.error || 'Codex authentication expired — re-authenticate to continue');
        }
        throw new Error(data.error || data.hint || 'Failed to start agent');
      }
      return data;
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['agents'] });
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ['agents'] }), 2000);
      if (data.guardrails?.warnings?.length) {
        toast.success('Agent started after acknowledging system health warnings.', { duration: 6000 });
      }
    },
    onError: (err: Error) => {
      setAgentLaunchState(null);
      if (err.message.includes('runtime=active') || err.message.includes('status=running')) {
        setTimeout(() => queryClient.invalidateQueries({ queryKey: ['agents'] }), 500);
        return;
      }
      toast.error(err.message, { duration: 8000 });
    },
  });

  const createWorkspaceMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueId, projectId: issue?.project?.id }),
      });
      if (!res.ok) throw new Error('Failed to create workspace');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace', issueId] });
    },
  });

  const reviewMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/review/${issueId}/trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start review');
      if (data.success === false) throw new Error(data.message || 'Review was not started');
      return data;
    },
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ['workspace', issueId] });
      await refreshDashboardState(queryClient);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/issues/${issueId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wipeWorkspace: true }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to cancel issue');
      }
      return res.json();
    },
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ['workspace', issueId] });
      await refreshDashboardState(queryClient);
    },
  });

  const resetSessionMutation = useMutation({
    mutationFn: async () => {
      if (!agent) throw new Error('No agent to reset session for');
      const res = await fetch(`/api/agents/${agent.id}/reset-session`, { method: 'POST' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to reset session');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      toast.success('Session reset — next start will create a fresh session');
    },
    onError: (err: Error) => {
      toast.error(err.message, { duration: 8000 });
    },
  });

  const reopenMutation = useMutation({
    mutationFn: async (reason?: string) => {
      const res = await fetch(`/api/issues/${issueId}/reopen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to reopen issue');
      }
      return res.json();
    },
    onSuccess: async (data: any) => {
      toast.success(data?.message ?? `${issueId} reopened — ready for new agent run`);
      queryClient.invalidateQueries({ queryKey: ['workspace', issueId] });
      await refreshDashboardState(queryClient);
    },
    onError: (err: Error) => {
      toast.error(err.message, { duration: 8000 });
    },
  });

  const syncMainMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/issues/${issueId}/sync-main`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Sync failed');
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace', issueId] });
      queryClient.invalidateQueries({ queryKey: ['agents'] });
    },
  });

  const copySettingsMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/issues/${issueId}/copy-settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to copy settings');
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace', issueId] });
      toast.success('Panopticon settings copied into workspace');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to copy settings');
    },
  });

  const dismissPendingMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/review/${issueId}/pending`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to dismiss');
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workspace', issueId] }),
  });

  return {
    workspace,
    reviewStatus,
    reviewStatusLoading,
    lifecycle,
    planningState,
    agentLaunchState,
    setAgentLaunchState,
    startAgentMutation,
    reviewMutation,
    cancelMutation,
    resetSessionMutation,
    reopenMutation,
    createWorkspaceMutation,
    copySettingsMutation,
    syncMainMutation,
    onStartAgent: (message?: string) => startAgentMutation.mutate(message),
    onReview: () => reviewMutation.mutate(),
    onCancel: () => cancelMutation.mutate(),
    onResetSession: () => resetSessionMutation.mutate(),
    onReopen: () => reopenMutation.mutate(undefined),
    onCreateWorkspace: () => createWorkspaceMutation.mutate(),
    onCopySettings: () => copySettingsMutation.mutate(),
    onSyncMain: () => syncMainMutation.mutate(),
    onDismissPending: () => dismissPendingMutation.mutate(),
  };
}
