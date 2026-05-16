import { useState, useCallback, useRef, useEffect } from 'react';
import { toast } from 'sonner';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { COMMAND_DECK_SURFACE_REGISTRY } from '../lib/commandDeckSurfaceRegistry';
import {
  X,
  Terminal,
  Copy,
  Check,
  ExternalLink,
  Globe,
  Loader2,
  AlertTriangle,
  DollarSign,
  User,
  Tag,
  FileText,
  RefreshCw,
  RotateCcw,
  Box,
  Play,
  GitMerge,
  GitPullRequest,
  VolumeX,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import { Agent, Issue, WorkAgentLifecycle, type StartAgentResponse } from '../types';
import type { ContainerStatus, ReviewStatus, SalvageableStashInfo, WorkspaceInfo } from './inspector/types';
import { formatRelativeTime, getFriendlyModelName, shouldForceReviewTrigger } from './inspector/utils';
import { useAlert } from './DialogProvider';
import { BeadsDialog } from './BeadsDialog';
import { VBriefDialog } from './vbrief/VBriefDialog';
import { PlanDialog } from './PlanDialog';
import { useConfirm } from './DialogProvider';
import { refreshDashboardState } from '../lib/refresh-dashboard-state';
import { isCodexBlockedResponse, setPendingCodexSpawn } from '../lib/pending-codex-spawn';
import { getPendingQuestionTitle, hasActualPendingQuestion, isPendingReviewStranded, isReviewPipelineStuck } from '../lib/pipeline-state';
import { RecoverButton } from './RecoverButton';
import { AgentInfoSection } from './inspector/AgentInfoSection';
import { ReviewPipelineSection } from './inspector/ReviewPipelineSection';
import { PanOpenInPicker } from './PanOpenInPicker';
import { ContainerSection } from './inspector/ContainerSection';
import { ActionsSection } from './inspector/ActionsSection';
import { PHASE_CHIP_COLORS, PHASE_LABELS, type PipelinePhase } from './inspector/TerminalTabs';
import { SwitchModelModal } from './SwitchModelModal';
import { useSwitchModel } from '../hooks/useSwitchModel';
import { SensitiveText } from './SensitiveText';
import type { Harness } from './shared/ModelPicker';
import { useActivityQuery, usePrQuery } from './CommandDeck/ZoneCOverviewTabs/queries';
import { getWorkSessionLabel, isAgentSessionAttachable } from '../lib/swarmSlots';
import { useTtsIssueMute } from '../hooks/useTtsIssueMute';

function formatCost(cost: number): string {
  if (cost >= 100) return `$${cost.toFixed(0)}`;
  if (cost >= 10) return `$${cost.toFixed(1)}`;
  if (cost >= 1) return `$${cost.toFixed(2)}`;
  if (cost > 0) return `$${cost.toFixed(3)}`;
  return '$0.00';
}

function formatTokens(tokens: number): string {
  if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(2)}M`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K`;
  return tokens.toString();
}

void COMMAND_DECK_SURFACE_REGISTRY;

export type { ReviewButtonState } from './inspector/utils';
export { getReviewButtonState } from './inspector/utils';

function copyToClipboard(text: string): boolean {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).catch(() => { /* ignore */ });
    return true;
  }
  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.style.position = 'fixed';
  textArea.style.left = '-999999px';
  textArea.style.top = '-999999px';
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  try {
    document.execCommand('copy');
    document.body.removeChild(textArea);
    return true;
  } catch {
    document.body.removeChild(textArea);
    return false;
  }
}

export interface InspectorPanelProps {
  agent?: Agent;
  workAgents?: Agent[];
  issueId: string;
  issueUrl?: string;
  issue?: Issue;
  /** Current pipeline phase — passed from parent (DetailPanelLayout) via usePipelinePhase */
  phase?: PipelinePhase | string;
  /** Review status — hoisted to DetailPanelLayout to avoid duplicate queries */
  reviewStatus?: ReviewStatus;
  /** Loading state for reviewStatus */
  reviewStatusLoading?: boolean;
  onClose: () => void;
  onOpenTerminal?: (sessionName?: string) => void;
  /** Open the terminal and select the active merge session (PAN-905) */
  onViewMergeLog?: () => void;
  /** When true, render without sidebar chrome (border-r, close btn) for embedded use */
  embedded?: boolean;
}

export function InspectorPanel({ agent, workAgents = [], issueId, issueUrl, issue, phase, reviewStatus: reviewStatusProp, reviewStatusLoading: reviewStatusLoadingProp, onClose, onOpenTerminal, onViewMergeLog, embedded }: InspectorPanelProps) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const showAlert = useAlert();
  const [copied, setCopied] = useState(false);
  const [showPrdModal, setShowPrdModal] = useState(false);
  const [showBeads, setShowBeads] = useState(false);
  const [showVBrief, setShowVBrief] = useState(false);
  const [workspaceCreating, setWorkspaceCreating] = useState(false);
  const [containersStarting, setContainersStarting] = useState(false);
  const [containersStartedAt, setContainersStartedAt] = useState(0);
  const [agentLaunchState, setAgentLaunchState] = useState<'starting' | 'resuming' | null>(null);
  const [agentLaunchHarness, setAgentLaunchHarness] = useState<Harness>('claude-code');
  const [showSwitchModel, setShowSwitchModel] = useState(false);
  const [planDialogIssue, setPlanDialogIssue] = useState<Issue | null>(null);
  const [containerMenu, setContainerMenu] = useState<{
    x: number; y: number; containerName: string; isRunning: boolean;
  } | null>(null);

  const tmuxCommand = agent ? `tmux attach -t ${agent.id}` : '';
  const ttsMute = useTtsIssueMute(issueId);
  const awaitingInput = hasActualPendingQuestion(agent);
  const awaitingInputTitle = getPendingQuestionTitle(agent);
  const awaitingInputPrompt = agent?.pendingQuestionPrompt?.trim();

  // Check lifecycle state for stopped agents (drives Start vs Resume vs Reset semantics)
  const { data: agentLifecycle } = useQuery<WorkAgentLifecycle | undefined>({
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

  const startedAt = agent ? new Date(agent.startedAt) : null;
  const durationMs = startedAt ? Date.now() - startedAt.getTime() : 0;
  const durationMins = Math.floor(durationMs / 60000);
  const durationHours = Math.floor(durationMins / 60);
  const duration = durationHours > 0 ? `${durationHours}h ${durationMins % 60}m` : `${durationMins}m`;

  const acknowledgeGuardrailWarnings = useCallback(async (data: StartAgentResponse | undefined) => {
    const warnings = data?.guardrails?.warnings ?? [];
    if (warnings.length === 0) return false;
    if (!data?.requiresAcknowledgement) return true;
    return confirm({
      title: 'Start agent with warnings?',
      message: warnings.map((warning) => `• ${warning.message}`).join('\n'),
      variant: 'destructive',
      confirmLabel: 'Start anyway',
    });
  }, [confirm]);

  const { data: workspace } = useQuery<WorkspaceInfo & { salvageableStashes?: SalvageableStashInfo[] }>({
    queryKey: ['workspace', issueId],
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${issueId}`);
      if (!res.ok) throw new Error('Failed to fetch workspace info');
      const data = await res.json();
      if (data.exists && workspaceCreating) setWorkspaceCreating(false);
      if (containersStarting && data.containers) {
        const statuses = Object.values(data.containers as Record<string, ContainerStatus>);
        const allRunning = statuses.every(c => c.running);
        const elapsed = Date.now() - containersStartedAt;
        const gracePeriodPassed = elapsed > 20000;
        const anyFailed = statuses.some(c => c.status?.startsWith('exited'));
        if (allRunning || (gracePeriodPassed && anyFailed)) setContainersStarting(false);
      }
      return data;
    },
    refetchInterval: (workspaceCreating || containersStarting || !!agentLaunchState) ? 5000 : 30000,
  });

  // Self-contained review status query (shares cache key with DetailPanelLayout).
  // Always fetch — the parent-provided reviewStatusProp comes from the read-model
  // snapshot (ReviewStatusSnapshot), which intentionally omits `history` to keep
  // the snapshot small. The /api/review/:id/status endpoint returns the full
  // ReviewStatus including history, which the "Previous attempts" timeline needs.
  const { data: fetchedReviewStatus, isLoading: fetchedReviewStatusLoading } = useQuery<ReviewStatus>({
    queryKey: ['review-status', issueId],
    queryFn: async () => {
      const res = await fetch(`/api/review/${issueId}/status`);
      if (!res.ok) throw new Error('Failed to fetch review status');
      return res.json();
    },
    refetchInterval: 15000,
    enabled: !!issueId,
  });

  // Prefer the fetched object — it is a DB-fresh superset of the snapshot prop
  // (includes `history`). Fall back to the prop for the instant-render window
  // before the fetch resolves.
  const reviewStatus = fetchedReviewStatus ?? reviewStatusProp;
  const reviewStatusLoading = reviewStatusLoadingProp ?? fetchedReviewStatusLoading ?? false;
  const pendingReviewStranded = isPendingReviewStranded(reviewStatus);
  const pendingReviewStrandedSince = pendingReviewStranded
    ? (reviewStatus?.reviewSpawnedAt ?? reviewStatus?.updatedAt)
    : undefined;
  const pendingReviewStrandedAge = pendingReviewStrandedSince
    ? formatRelativeTime(pendingReviewStrandedSince)
    : 'over an hour ago';

  useEffect(() => {
    if (!agentLaunchState) return;
    if (agent && agent.status !== 'stopped') {
      setAgentLaunchState(null);
      return;
    }
    if (agent?.status === 'stopped' && agentLifecycle && !agentLifecycle.canResumeSession && !agentLifecycle.isOrphaned) {
      setAgentLaunchState(null);
    }
  }, [agent, agentLifecycle, agentLaunchState]);

  const { data: prdContent } = useQuery({
    queryKey: ['prd', issueId],
    queryFn: async () => {
      try {
        const res = await fetch(`/api/command-deck/planning/${issueId}`);
        if (!res.ok) return null;
        const data = await res.json();
        return data.prd || null;
      } catch {
        return null;
      }
    },
    staleTime: 60000,
  });

  // Activity query — shared cache with CommandDeck overview
  const { data: activityData } = useActivityQuery(issueId);
  const sections = activityData?.sections ?? [];
  const sessionCount = sections.length;
  const lastActivity = (() => {
    let latest = 0;
    for (const s of sections) {
      const t = Date.parse(s.startedAt);
      if (!Number.isNaN(t) && t > latest) latest = t;
    }
    if (!latest) return null;
    const ageMs = Date.now() - latest;
    if (ageMs < 60_000) return `last activity ${Math.round(ageMs / 1000)}s ago`;
    if (ageMs < 3_600_000) return `last activity ${Math.round(ageMs / 60_000)}m ago`;
    return `last activity ${Math.round(ageMs / 3_600_000)}h ago`;
  })();

  const swarmWorkAgents = workAgents.length > 1 ? workAgents : [];

  // Reviewer summary data
  const reviewerSections = sections.filter((s) => s.type === 'reviewer');

  // PR query — shared cache with CommandDeck overview
  const { data: prData } = usePrQuery(issueId);
  const pr = prData?.pr;

  const startAgentMutation = useMutation({
    mutationFn: async (message?: string) => {
      const shouldResume = !!(agent && agent.status === 'stopped' && agentLifecycle?.canResumeSession);
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

      const requestBody = { issueId, projectId: issue?.project?.id, message: message || undefined, harness: agentLaunchHarness };
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
    onSuccess: async (data) => {
      void queryClient.invalidateQueries({ queryKey: ['agents'] });
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ['agents'] }), 2000);
      if (data.guardrails?.warnings?.length) {
        toast.success('Agent started after acknowledging system health warnings.', { duration: 6000 });
      }
    },
    onError: (err: Error) => {
      setAgentLaunchState(null);
      // Agent already running — store snapshot is stale, just refresh
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
      setWorkspaceCreating(true);
      queryClient.invalidateQueries({ queryKey: ['workspace', issueId] });
    },
  });

  const startContainersMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/issues/${issueId}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to start containers');
      }
      return res.json();
    },
    onSuccess: () => {
      setContainersStarting(true);
      setContainersStartedAt(Date.now());
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ['workspace', issueId] }), 5000);
      setTimeout(() => setContainersStarting(false), 90000);
    },
  });

  const containerControlMutation = useMutation({
    mutationFn: async ({ containerName, action }: { containerName: string; action: 'start' | 'stop' | 'restart' }) => {
      const res = await fetch(`/api/workspaces/${issueId}/containers/${containerName}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `Failed to ${action} container`);
      }
      return res.json();
    },
    onSuccess: () => {
      setContainerMenu(null);
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ['workspace', issueId] }), 2000);
    },
  });

  const containerizeMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/workspaces/${issueId}/containerize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to containerize workspace');
      }
      return res.json();
    },
    onSuccess: () => {
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ['workspace', issueId] }), 3000);
    },
  });

  const forceReviewRef = useRef(false);
  const reviewMutation = useMutation({
    mutationFn: async () => {
      const url = forceReviewRef.current
        ? `/api/review/${issueId}/trigger?force=true`
        : `/api/review/${issueId}/trigger`;
      forceReviewRef.current = false;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to start review');
      }
      if (data.success === false) {
        throw new Error(data.message || 'Review was not started');
      }
      return data;
    },
    onSuccess: async (data: any) => {
      if (data?.alreadyPassed) {
        showAlert({
          message: data.message || `Review already passed for ${issueId}`,
          variant: 'info',
        });
      }
      queryClient.invalidateQueries({ queryKey: ['workspace', issueId] });
      await refreshDashboardState(queryClient);
    },
    onError: (err: Error) => {
      toast.error(err.message, { duration: 8000 });
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
      onClose();
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

  const { switchMutation, isPending: isSwitchPending } = useSwitchModel(agent?.id, issueId);

  const dismissPendingMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/review/${issueId}/pending`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to dismiss');
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workspace', issueId] }),
  });

  const cleanMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/workspaces/${issueId}/clean`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to clean workspace');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace', issueId] });
      queryClient.invalidateQueries({ queryKey: ['agents'] });
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

  const refreshDbMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/workspaces/${issueId}/refresh-db`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to refresh database');
      }
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workspace', issueId] }),
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

  const recoverStashMutation = useMutation({
    mutationFn: async (stashRef: string) => {
      const res = await fetch(`/api/workspaces/${issueId}/stashes/${encodeURIComponent(stashRef)}/recover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to recover stash');
      return data as { branchName: string };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['workspace-stashes', issueId] });
      toast.success(`Created ${data.branchName}`);
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to recover stash');
    },
  });

  const dismissStashMutation = useMutation({
    mutationFn: async (stashRef: string) => {
      const res = await fetch(`/api/workspaces/${issueId}/stashes/${encodeURIComponent(stashRef)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to dismiss stash');
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-stashes', issueId] });
      toast.success('Stash dismissed');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to dismiss stash');
    },
  });

  const handleCopy = useCallback(() => {
    copyToClipboard(tmuxCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [tmuxCommand]);

  const handleSyncMain = async () => {
    if (await confirm({
      title: 'Sync Main',
      message: `Sync main into ${issueId}?\n\nThis will:\n- Auto-commit any uncommitted changes\n- Fetch and merge the latest main into the feature branch`,
      confirmLabel: 'Sync',
    })) {
      syncMainMutation.mutate();
    }
  };

  const handleReview = async () => {
    const strandedPendingReview = isPendingReviewStranded(reviewStatus);
    const forceReview = shouldForceReviewTrigger(reviewStatus);
    const title = strandedPendingReview ? 'Re-request Review' : forceReview ? 'Re-run Review' : 'Start Review';
    const message = strandedPendingReview
      ? `Pending review for ${issueId} appears stranded (${pendingReviewStrandedAge}). Re-request the review now?`
      : forceReview
        ? `Re-run review & test pipeline for ${issueId}?`
        : `Start review & test pipeline for ${issueId}?`;
    const confirmLabel = strandedPendingReview ? 'Re-request Review' : forceReview ? 'Re-run' : 'Start Review';
    if (await confirm({ title, message, confirmLabel })) {
      forceReviewRef.current = forceReview;
      reviewMutation.mutate();
    }
  };

  const handleCancel = async () => {
    if (await confirm({
      title: 'Cancel Issue',
      message: `Cancel ${issueId}?\n\nThis will:\n- Stop any running agent\n- Close any open PR for the issue\n- Remove the workspace\n- Delete the feature branch\n- Remove beads for this issue\n- Move the issue to Canceled`,
      variant: 'destructive',
      confirmLabel: 'Cancel Issue',
    })) {
      cancelMutation.mutate();
    }
  };

  const handleReopen = async () => {
    if (await confirm({
      title: 'Reopen Issue',
      message: `Reopen ${issueId} for re-work?\n\nThis will:\n- Move the issue to "In Progress"\n- Reset review/test/merge status to pending\n- Remove any queued specialist tasks\n- Append a "Reopened" entry to the continue file`,
      confirmLabel: 'Reopen',
    })) {
      reopenMutation.mutate(undefined);
    }
  };

  const handleCleanWorkspace = async () => {
    if (await confirm({
      title: 'Clean Workspace',
      message: `Clean and recreate corrupted workspace for ${issueId}?\n\nThis will:\n- Remove the corrupted workspace directory\n- Create a fresh workspace`,
      variant: 'destructive',
      confirmLabel: 'Clean & Recreate',
    })) {
      cleanMutation.mutate();
    }
  };

  const handleContainerContextMenu = (e: React.MouseEvent, containerName: string, isRunning: boolean) => {
    e.preventDefault();
    setContainerMenu({ x: e.clientX, y: e.clientY, containerName, isRunning });
  };

  const handleRecoverStash = async (stashRef: string) => {
    recoverStashMutation.mutate(stashRef);
  };

  const handleDismissStash = async (stashRef: string) => {
    if (await confirm({
      title: 'Dismiss Stash',
      message: 'Are you sure? This stash will be dropped permanently',
      variant: 'destructive',
      confirmLabel: 'Dismiss',
    })) {
      dismissStashMutation.mutate(stashRef);
    }
  };

  return (
    <div className="contents" data-testid={`inspector-panel-${issueId}`}>
      <div
        className={`flex flex-col h-full overflow-y-auto bg-card border-border ${embedded ? '' : 'border-r'}`}
        data-testid="workspace-sidebar"
      >
        {/* Header */}
        <div className="px-3 py-2.5 border-b border-border flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {agent ? (
              <div className="flex gap-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" style={{ animationDelay: '300ms' }} />
              </div>
            ) : (
              <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground shrink-0" />
            )}
            <span className="font-mono text-sm font-semibold text-foreground truncate">{issueId.toUpperCase()}</span>
            {phase && PHASE_LABELS[phase] && (() => {
              const colors = PHASE_CHIP_COLORS[phase] ?? { bg: '#1e2d47', text: '#92a4c9' };
              return (
                <span
                  className="text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0"
                  style={{ backgroundColor: colors.bg, color: colors.text }}
                >
                  {PHASE_LABELS[phase]}
                </span>
              );
            })()}
          </div>
          {!embedded && (
            <div className="flex items-center gap-1 shrink-0">
              {onOpenTerminal && agent && (
                <button
                  onClick={() => onOpenTerminal()}
                  className="p-1 rounded transition-colors hover:bg-popover text-muted-foreground"
                  title="Open terminal"
                  data-testid={`inspector-open-terminal-${issueId}`}
                >
                  <Terminal className="w-3.5 h-3.5" />
                </button>
              )}
              <button onClick={onClose} title="Close inspector" className="p-1 rounded transition-colors hover:bg-popover text-muted-foreground" data-testid="inspector-close">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Issue title */}
        {issue && (
          <div className="px-3 py-2 border-b border-border">
            <p className="text-xs text-foreground font-medium line-clamp-2" title={issue.title}>{issue.title}</p>
            <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
              <span className="px-1.5 py-0.5 rounded text-[10px] bg-card text-muted-foreground">
                {issue.status}
              </span>
              {issue.priority > 0 && (
                <span className={`text-[10px] ${
                  issue.priority === 1 ? 'text-destructive' :
                  issue.priority === 2 ? 'text-warning' :
                  issue.priority === 3 ? 'text-warning' : 'text-primary'
                }`}>
                  {issue.priority === 1 ? 'Urgent' : issue.priority === 2 ? 'High' : issue.priority === 3 ? 'Medium' : 'Low'}
                </span>
              )}
              {issue.labels.slice(0, 2).map((label) => (
                <span key={label} className="px-1.5 py-0.5 rounded text-[10px] bg-card text-muted-foreground">
                  {label}
                </span>
              ))}
            </div>
            <button
              type="button"
              onClick={() => ttsMute.toggle()}
              disabled={ttsMute.loading || ttsMute.pending}
              className={`mt-2 flex w-full items-center justify-between gap-2 rounded-lg border px-2 py-1.5 text-xs transition-colors disabled:opacity-50 ${
                ttsMute.muted
                  ? 'border-warning/50 bg-warning/10 text-warning hover:bg-warning/15'
                  : 'border-border bg-card text-muted-foreground hover:text-foreground hover:bg-popover'
              }`}
              aria-pressed={ttsMute.muted}
              data-testid={`inspector-tts-mute-${issueId}`}
            >
              <span>{ttsMute.muted ? 'Unmute TTS for this issue' : 'Mute TTS for this issue'}</span>
              <VolumeX className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Assignee */}
        {issue?.assignee && (
          <div className="px-3 py-2 border-b border-border flex items-center gap-2 text-xs">
            <User className="w-3 h-3 shrink-0 text-muted-foreground" />
            <span className="text-foreground truncate">{issue.assignee.name}</span>
            {issue.assignee.email && (
              <SensitiveText value={issue.assignee.email} className="text-[10px] truncate text-muted-foreground" />
            )}
          </div>
        )}

        {/* Pipeline stuck banner */}
        {reviewStatus && isReviewPipelineStuck(reviewStatus) && (
          <div className="px-3 py-2 border-b border-border bg-warning/10">
            <div className="flex items-center gap-2 mb-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-warning shrink-0" />
              <span className="text-xs font-medium text-warning">Pipeline Stuck</span>
            </div>
            <p className="text-[10px] text-muted-foreground mb-2">
              Review/test/merge pipeline is stuck and needs recovery.
            </p>
            <RecoverButton issueId={issueId} reviewStatus={reviewStatus} variant="inspector" />
          </div>
        )}

        {/* PAN-1034: pending review stranded beyond 2x reviewer timeout. */}
        {pendingReviewStranded && (
          <div className="px-3 py-2 border-b border-border bg-amber-500/10">
            <div className="flex items-center gap-2 mb-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-300 shrink-0" />
              <span className="text-xs font-medium text-amber-200">Pending Review Stranded</span>
            </div>
            <p className="text-[10px] text-muted-foreground mb-2">
              Pending review started {pendingReviewStrandedAge} and no reviewer is queued or active. Re-request review to restart the pipeline.
            </p>
            <button
              onClick={handleReview}
              disabled={reviewMutation.isPending}
              className="flex items-center justify-center gap-1 px-2 py-1 rounded text-xs bg-amber-500/20 text-amber-100 hover:bg-amber-500/30 border border-amber-500/40 disabled:opacity-50 w-full"
              data-testid="stranded-review-request-btn"
            >
              {reviewMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              Re-request Review
            </button>
          </div>
        )}

        {/* Merged status banner for issues without workspaces */}
        {!agent && !workspace?.exists && issue?.labels?.some(l => l.toLowerCase() === 'merged') && (
          <div className="px-3 py-3 border-b border-border">
            <div className="flex items-center gap-2 mb-2">
              <GitMerge className="w-4 h-4 text-success" />
              <span className="text-xs font-medium text-success">Merged to Main</span>
            </div>
            <p className="text-[10px] text-muted-foreground">
              This issue was completed and merged outside of Panopticon's workspace pipeline.
              No workspace, agent, or pipeline state is available.
            </p>
            {workspace?.costs && workspace.costs.totalCost > 0 && (
              <div className="mt-2 flex items-center gap-2 text-[10px]">
                <DollarSign className="w-3 h-3 text-success" />
                <span className="text-muted-foreground">Total cost:</span>
                <span className="text-success font-medium">{formatCost(workspace.costs.totalCost)}</span>
              </div>
            )}
          </div>
        )}

        {/* Not merged, no workspace, no agent — show status */}
        {!agent && !workspace?.exists && !issue?.labels?.some(l => l.toLowerCase() === 'merged') && issue && (
          <div className="px-3 py-3 border-b border-border">
            <div className="text-[10px] text-muted-foreground">
              No workspace created yet. Use <strong>Plan</strong> to create a workspace and plan this issue,
              or <strong>Create Workspace</strong> below.
            </div>
          </div>
        )}

        {/* Awaiting input banner */}
        {agent && awaitingInput && (
          <div className="px-3 py-2 border-b border-warning/40 bg-warning/10" data-testid={`inspector-input-${issueId}`}>
            <div className="flex items-center gap-2 mb-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-warning shrink-0" />
              <span className="text-xs font-bold uppercase tracking-wide text-warning">Awaiting Input</span>
            </div>
            <p className="text-[10px] text-muted-foreground mb-2" title={awaitingInputTitle}>
              {awaitingInputTitle}
            </p>
            {awaitingInputPrompt && (
              <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded border border-warning/30 bg-card/80 p-2 text-[10px] leading-4 text-foreground">
                {awaitingInputPrompt}
              </pre>
            )}
            {onOpenTerminal && (
              <button
                onClick={() => onOpenTerminal(agent.id)}
                className="mt-2 inline-flex items-center gap-1.5 rounded border border-warning/40 bg-warning/15 px-2 py-1 text-[10px] font-medium text-warning hover:bg-warning/25"
                title="Open terminal to answer this prompt"
              >
                <Terminal className="w-3 h-3" />
                Attach terminal
              </button>
            )}
          </div>
        )}

        {/* Agent info, git status, workspace path */}
        {agent && (
          <AgentInfoSection
            agent={agent}
            duration={duration}
            workspace={workspace}
            syncMainPending={syncMainMutation.isPending}
            onSyncMain={handleSyncMain}
          />
        )}

        {/* Workspace path (no-agent) */}
        {!agent && workspace?.exists && workspace.path && (
          <div className="px-3 py-2 border-b border-border text-xs">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <span className="font-mono truncate text-[10px] flex-1" title={workspace.path}>
                {workspace.path}
              </span>
              <a
                href={`vscode://file/${workspace.path}`}
                className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded bg-card text-primary hover:text-primary/80 border border-border"
                title="Open in VS Code"
              >
                <ExternalLink className="w-2.5 h-2.5" />
                VS Code
              </a>
              <PanOpenInPicker cwd={workspace.path} />
            </div>
          </div>
        )}

        {/* Activity summary */}
        {(sessionCount > 0 || lastActivity) && (
          <div className="px-3 py-2 border-b border-border text-xs">
            <div className="uppercase tracking-wider text-[10px] mb-1.5 font-semibold text-muted-foreground">Activity</div>
            <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
              {sessionCount > 0 && (
                <span>{sessionCount} session{sessionCount === 1 ? '' : 's'}</span>
              )}
              {lastActivity && <span>{lastActivity}</span>}
            </div>
          </div>
        )}

        {swarmWorkAgents.length > 1 && (
          <div className="px-3 py-2 border-b border-border text-xs">
            <div className="uppercase tracking-wider text-[10px] mb-1.5 font-semibold text-muted-foreground">Swarm Slots</div>
            <div className="flex flex-wrap gap-1.5">
              {swarmWorkAgents.map((workAgent, index) => {
                const attachable = isAgentSessionAttachable(workAgent);
                return (
                  <span
                    key={workAgent.id}
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] ${
                      attachable
                        ? 'badge-bg-primary text-primary-foreground'
                        : 'border border-border/70 bg-card text-muted-foreground'
                    }`}
                    title={workAgent.id}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${attachable ? 'bg-primary-foreground/90' : 'bg-muted-foreground'}`}
                    />
                    {getWorkSessionLabel(workAgent, index)}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {/* Reviewer summary */}
        {reviewerSections.length > 0 && (
          <div className="px-3 py-2 border-b border-border text-xs">
            <div className="uppercase tracking-wider text-[10px] mb-1.5 font-semibold text-muted-foreground">Reviewer Summary</div>
            <div className="grid grid-cols-5 gap-1">
              {(['correctness', 'security', 'performance', 'requirements', 'synthesis'] as const).map((role) => {
                const sec = reviewerSections.find((s) => s.role === role);
                const meta = sec?.roundMetadata;
                const latest = meta?.history?.find((r) => r.round === meta.latestRound);
                const isRunning = sec?.status === 'running' || sec?.status === 'active';
                let color = 'bg-muted-foreground';
                let label = '—';
                if (isRunning) { color = 'bg-primary'; label = `R${(meta?.latestRound ?? 0) + 1}`; }
                else if (latest) {
                  const status = latest.status?.toLowerCase();
                  if (status === 'passed' || status === 'approved') { color = 'bg-success'; label = `R${latest.round}`; }
                  else if (status === 'failed' || status === 'blocked') { color = 'bg-destructive'; label = `R${latest.round}`; }
                  else { color = 'bg-warning'; label = `R${latest.round}`; }
                }
                return (
                  <div key={role} className="flex flex-col items-center gap-0.5">
                    <span className="text-[9px] text-muted-foreground capitalize truncate w-full text-center">{role.slice(0, 3)}</span>
                    <span className={`inline-block w-2 h-2 rounded-full ${color}`} title={`${role}: ${label}`} />
                    <span className="text-[9px] text-muted-foreground">{label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Review pipeline (Tests row + verification cycle counter, parity with command deck) */}
        {reviewStatus && (
          <div className="px-3 py-2 border-b border-border">
            <ReviewPipelineSection
              reviewStatus={reviewStatus}
              issueId={issueId}
              onViewLog={onViewMergeLog}
            />
          </div>
        )}

        {/* PR link / status */}
        {pr && (
          <div className="px-3 py-2 border-b border-border text-xs">
            <div className="uppercase tracking-wider text-[10px] mb-1.5 font-semibold text-muted-foreground">Pull Request</div>
            <div className="flex items-center gap-1.5">
              <GitPullRequest className="w-3 h-3 text-primary" />
              <a href={pr.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary/80 truncate text-[10px] font-medium">
                #{pr.number} {pr.title}
              </a>
              <span className={`text-[10px] px-1 py-0.5 rounded ml-auto ${
                pr.state === 'OPEN' ? 'bg-success/20 text-success' :
                pr.state === 'MERGED' ? 'bg-primary/20 text-primary' :
                'bg-muted-foreground/20 text-muted-foreground'
              }`}>
                {pr.state?.toLowerCase()}
              </span>
            </div>
            {(pr.additions !== undefined || pr.deletions !== undefined || pr.changedFiles !== undefined) && (
              <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                {pr.additions !== undefined && pr.deletions !== undefined && (
                  <span>+{pr.additions} -{pr.deletions}</span>
                )}
                {pr.changedFiles !== undefined && (
                  <span>{pr.changedFiles} file{pr.changedFiles === 1 ? '' : 's'}</span>
                )}
                {pr.reviewDecision && (
                  <span className="capitalize">{pr.reviewDecision.replace(/_/g, ' ')}</span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Links */}
        <div className="px-3 py-2 border-b border-border text-xs">
          <div className="uppercase tracking-wider text-[10px] mb-2 font-semibold text-muted-foreground">Links</div>
          <div className="space-y-1.5">
            {issueUrl && (
              <a href={issueUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-primary hover:text-primary/80">
                <ExternalLink className="w-3 h-3" />
                <span>{issueId.toUpperCase().startsWith('PAN-') ? 'GitHub Issue' : 'Linear Issue'}</span>
              </a>
            )}
            {prdContent && (
              <button onClick={() => setShowPrdModal(true)} className="flex items-center gap-1.5 text-primary hover:text-primary/80">
                <FileText className="w-3 h-3" />
                <span>PRD</span>
              </button>
            )}
          </div>
        </div>

        {/* Cost summary */}
        {workspace?.costs && workspace.costs.totalCost > 0 && (
          <div className="px-3 py-2 border-b border-border text-xs">
            <div className="flex items-center gap-1.5 mb-2">
              <DollarSign className="w-3 h-3 text-success" />
              <span className="uppercase tracking-wider text-[10px] font-semibold text-muted-foreground">Cost</span>
              <span className="text-success font-medium ml-auto">{formatCost(workspace.costs.totalCost)}</span>
            </div>
            {workspace.costs.totalTokens > 0 && (
              <div className="space-y-0.5">
                <div className="flex justify-between text-[10px]">
                  <span className="text-muted-foreground">Input tokens</span>
                  <span className="text-foreground">{formatTokens(workspace.costs.inputTokens ?? 0)}</span>
                </div>
                <div className="flex justify-between text-[10px]">
                  <span className="text-muted-foreground">Output tokens</span>
                  <span className="text-foreground">{formatTokens(workspace.costs.outputTokens ?? 0)}</span>
                </div>
              </div>
            )}
            {Object.keys(workspace.costs.byModel).length > 0 && (
              <div className="mt-1.5 space-y-0.5">
                {Object.entries(workspace.costs.byModel).sort(([, a], [, b]) => b.cost - a.cost).map(([model, info]) => (
                  <div key={model} className="flex justify-between text-[10px]">
                    <span className="truncate text-muted-foreground" title={model}>{getFriendlyModelName(model)}</span>
                    <span className="text-foreground ml-2">{formatCost(info.cost)} ({formatTokens(info.tokens)})</span>
                  </div>
                ))}
              </div>
            )}
            {workspace.costs.byStage && Object.keys(workspace.costs.byStage).length > 0 && (
              <div className="mt-1.5 pt-1.5 border-t border-border space-y-0.5">
                <div className="text-[10px] uppercase tracking-wider mb-1 text-muted-foreground">By Stage</div>
                {Object.entries(workspace.costs.byStage).sort(([, a], [, b]) => b.cost - a.cost).map(([stage, info]) => (
                  <div key={stage} className="flex justify-between text-[10px]">
                    <span className="truncate text-muted-foreground" title={stage}>{stage.charAt(0).toUpperCase() + stage.slice(1)}</span>
                    <span className="text-foreground ml-2">{formatCost(info.cost)} ({formatTokens(info.tokens)})</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Corrupted workspace warning */}
        {workspace?.corrupted && (
          <div className="px-3 py-2 border-b border-border">
            <div className="flex items-center gap-2 text-warning mb-2">
              <AlertTriangle className="w-4 h-4" />
              <span className="text-xs font-medium">Workspace Corrupted</span>
            </div>
            <p className="text-xs mb-2 text-muted-foreground">{workspace.message || 'The workspace is not a valid git worktree.'}</p>
            <button
              onClick={handleCleanWorkspace}
              disabled={cleanMutation.isPending}
              className="flex items-center gap-1 px-2 py-1 bg-warning hover:bg-warning/90 disabled:opacity-50 text-warning-foreground text-xs rounded w-full justify-center"
            >
              {cleanMutation.isPending ? <><Loader2 className="w-3 h-3 animate-spin" />Cleaning...</> : <><RefreshCw className="w-3 h-3" />Clean &amp; Recreate</>}
            </button>
          </div>
        )}

        {/* Service URLs */}
        {(workspace?.frontendUrl || workspace?.apiUrl) && (
          <div className="px-3 py-2 border-b border-border text-xs">
            <div className="uppercase tracking-wider text-[10px] mb-2 font-semibold text-muted-foreground">Services</div>
            <div className="space-y-1.5">
              {workspace.frontendUrl && (
                <a href={workspace.frontendUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-primary hover:text-primary/80">
                  <Globe className="w-3 h-3" /><span>Frontend</span>
                </a>
              )}
              {workspace.apiUrl && (
                <a href={workspace.apiUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-primary hover:text-primary/80">
                  <Globe className="w-3 h-3" /><span>API</span>
                </a>
              )}
            </div>
          </div>
        )}

        {/* Start containers button */}
        {workspace?.hasDocker && workspace.containers && (Object.keys(workspace.containers).length === 0 || Object.values(workspace.containers).some(c => !c.running)) && (
          <div className="px-3 py-2 border-b border-border">
            <div className="flex items-center gap-2">
              <span className="text-xs text-warning">{containersStarting ? 'Starting containers...' : Object.keys(workspace.containers).length === 0 ? 'Containers not started' : 'Some containers stopped'}</span>
              <button
                onClick={() => startContainersMutation.mutate()}
                disabled={startContainersMutation.isPending || containersStarting}
                className="flex items-center gap-1 px-2 py-1 bg-success hover:bg-success/90 disabled:opacity-50 text-success-foreground text-xs rounded"
              >
                {(startContainersMutation.isPending || containersStarting) ? <><Loader2 className="w-3 h-3 animate-spin" />Starting...</> : <><Play className="w-3 h-3" />Start Containers</>}
              </button>
            </div>
          </div>
        )}

        {/* Git-only workspace / containerize */}
        {workspace?.exists && !workspace.hasDocker && workspace.canContainerize && !workspace.hasAgent && (
          <div className="px-3 py-2 border-b border-border">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Git-only workspace</span>
              <button
                onClick={() => containerizeMutation.mutate()}
                disabled={containerizeMutation.isPending}
                className="flex items-center gap-1 px-2 py-1 bg-signal-review hover:bg-signal-review/90 disabled:opacity-50 text-signal-review-foreground text-xs rounded"
              >
                {containerizeMutation.isPending ? <><Loader2 className="w-3 h-3 animate-spin" />Setting up...</> : <><Box className="w-3 h-3" />Containerize</>}
              </button>
            </div>
          </div>
        )}

        {/* Container status pills */}
        {workspace?.containers && Object.keys(workspace.containers).length > 0 && (
          <ContainerSection
            containers={workspace.containers}
            startPending={startContainersMutation.isPending}
            containersStarting={containersStarting}
            containerControlPending={containerControlMutation.isPending}
            controllingContainer={containerMenu?.containerName}
            containerMenu={containerMenu}
            onContainerContextMenu={handleContainerContextMenu}
            onSetContainerMenu={setContainerMenu}
            onContainerControl={(name, action) => containerControlMutation.mutate({ containerName: name, action })}
            onRefreshDb={() => refreshDbMutation.mutate()}
            refreshDbPending={refreshDbMutation.isPending}
            confirm={confirm}
          />
        )}

        {/* Tmux attach command */}
        {agent && (
          <div className="px-3 py-2 border-b border-border text-xs">
            <div className="uppercase tracking-wider text-[10px] mb-2 font-semibold text-muted-foreground">Attach</div>
            <div className="flex items-center gap-2">
              <div className="flex-1 flex items-center gap-1.5 px-2 py-1.5 rounded font-mono text-[11px] text-foreground overflow-hidden bg-card">
                <Terminal className="w-3 h-3 shrink-0 text-primary" />
                <span className="truncate">{tmuxCommand}</span>
              </div>
              <button
                onClick={handleCopy}
                className={`p-1.5 rounded transition-colors ${copied ? 'badge-bg-success text-success' : 'bg-card text-muted-foreground hover:text-foreground'}`}
                title="Copy to clipboard"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
        )}

        {workspace?.salvageableStashes && workspace.salvageableStashes.length > 0 && (
          <div className="px-3 py-2 border-b border-border text-xs">
            <div className="uppercase tracking-wider text-[10px] mb-2 font-semibold text-muted-foreground">Salvageable Stashes</div>
            <div className="space-y-2">
              {workspace.salvageableStashes.map((stash) => (
                <div key={stash.ref} className="rounded border border-border px-2 py-2 bg-card/40">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium text-foreground truncate">{stash.shortDescription}</div>
                      <div className="text-muted-foreground font-mono text-[10px] truncate">{stash.ref}</div>
                      {stash.createdAt && (
                        <div className="text-muted-foreground text-[10px]">{new Date(stash.createdAt).toLocaleString()}</div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => handleRecoverStash(stash.ref)}
                        disabled={recoverStashMutation.isPending}
                        className="flex items-center gap-1 px-2 py-1 text-xs rounded text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-50"
                      >
                        {recoverStashMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                        Recover
                      </button>
                      <button
                        onClick={() => handleDismissStash(stash.ref)}
                        disabled={dismissStashMutation.isPending}
                        className="flex items-center gap-1 px-2 py-1 text-xs rounded text-destructive hover:bg-destructive/10 disabled:opacity-50"
                      >
                        {dismissStashMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
                        Dismiss
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <ActionsSection
          agent={agent}
          issueId={issueId}
          reviewStatus={reviewStatus}
          reviewStatusLoading={reviewStatusLoading}
          workspace={workspace}
          hasPlan={workspace?.planningState?.hasPlan ?? false}
          hasBeads={workspace?.planningState?.hasBeads ?? false}
          beadsCount={workspace?.planningState?.beadsCount ?? 0}
          reviewMutation={reviewMutation}
          cancelMutation={cancelMutation}
          startAgentMutation={startAgentMutation}
          createWorkspaceMutation={createWorkspaceMutation}
          syncMainMutation={syncMainMutation}
          copySettingsMutation={copySettingsMutation}
          resetSessionMutation={resetSessionMutation}
          reopenMutation={reopenMutation}
          onReview={handleReview}
          onKillSuccess={onClose}
          onCancel={handleCancel}
          onResetSession={() => resetSessionMutation.mutate()}
          onDismissPending={() => dismissPendingMutation.mutate()}
          onStartAgent={(message?: string) => startAgentMutation.mutate(message)}
          onCreateWorkspace={() => createWorkspaceMutation.mutate()}
          onCopySettings={() => copySettingsMutation.mutate()}
          onReopen={handleReopen}
          onViewBeads={() => setShowBeads(true)}
          onViewVBrief={() => setShowVBrief(true)}
          onViewLog={onViewMergeLog}
          onSwitchModel={() => setShowSwitchModel(true)}
          lifecycle={agentLifecycle}
          agentLaunchState={agentLaunchState}
          launchHarness={agentLaunchHarness}
          onLaunchHarnessChange={setAgentLaunchHarness}
          isFeature={issue?.artifactType?.includes('PortfolioItem') ?? false}
          issueStatus={issue?.status}
          onPlan={() => setPlanDialogIssue(issue ?? null)}
        />

        {/* Issue labels/tags for no-agent view */}
        {!agent && issue && issue.labels.length > 3 && (
          <div className="px-3 py-2 border-b border-border text-xs">
            <div className="flex flex-wrap gap-1">
              {issue.labels.map((label) => (
                <span key={label} className="px-2 py-0.5 rounded text-xs bg-card text-muted-foreground">
                  <Tag className="w-3 h-3 inline mr-1" />{label}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="flex-1" />
      </div>

      {/* Switch Model modal */}
      {showSwitchModel && agent && (
        <SwitchModelModal
          currentModel={agent.model}
          currentHarness={agent.harness ?? (agent.runtime === 'pi' ? 'pi' : 'claude-code')}
          agentId={agent.id}
          issueId={issueId}
          agentStatus={agent.status}
          hasResumableSession={agentLifecycle?.canResumeSession ?? false}
          onClose={() => setShowSwitchModel(false)}
          onSwitch={(model, message, harness) => {
            switchMutation.mutate({ model, message, harness }, {
              onSuccess: () => {
                setShowSwitchModel(false);
                toast.success(`Agent restarted on ${model}`);
              },
              onError: (err) => {
                toast.error(err.message, { duration: 8000 });
              },
            });
          }}
          isPending={isSwitchPending}
        />
      )}

      {/* Plan dialog */}
      {planDialogIssue && (
        <PlanDialog
          issue={planDialogIssue}
          isOpen={true}
          onClose={() => setPlanDialogIssue(null)}
          onComplete={async () => {
            setPlanDialogIssue(null);
            await refreshDashboardState(queryClient);
          }}
        />
      )}

      {/* Beads dialog */}
      {showBeads && <BeadsDialog issueId={issueId} isOpen={showBeads} onClose={() => setShowBeads(false)} />}

      {/* vBRIEF dialog */}
      {showVBrief && <VBriefDialog issueId={issueId} onClose={() => setShowVBrief(false)} />}

      {/* PRD Modal */}
      {showPrdModal && prdContent && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50" onClick={() => setShowPrdModal(false)}>
          <div className="border border-border rounded-lg shadow-xl w-[700px] max-h-[80vh] flex flex-col bg-card" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h2 className="text-sm font-medium text-foreground">PRD — {issueId.toUpperCase()}</h2>
              <button onClick={() => setShowPrdModal(false)} className="text-muted-foreground hover:text-foreground">
                <X size={18} />
              </button>
            </div>
            <div className="overflow-y-auto px-4 py-3 text-xs prose prose-invert prose-sm max-w-none">
              <ReactMarkdown rehypePlugins={[rehypeSanitize]}>{prdContent}</ReactMarkdown>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
