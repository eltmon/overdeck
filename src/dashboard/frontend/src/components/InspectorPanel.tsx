import { useState, useCallback, useRef, useEffect } from 'react';
import { toast } from 'sonner';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
  Box,
  Play,
  GitMerge,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import { Agent, Issue, WorkAgentLifecycle } from '../types';
import type { ContainerStatus, ReviewStatus, WorkspaceInfo } from './inspector/types';
import { getFriendlyModelName, shouldForceReviewTrigger } from './inspector/utils';
import { useAlert } from './DialogProvider';
import { BeadsDialog } from './BeadsDialog';
import { VBriefDialog } from './vbrief/VBriefDialog';
import { useConfirm } from './DialogProvider';
import { refreshDashboardState } from '../lib/refresh-dashboard-state';
import { AgentInfoSection } from './inspector/AgentInfoSection';
import { ContainerSection } from './inspector/ContainerSection';
import { ActionsSection } from './inspector/ActionsSection';
import { PHASE_CHIP_COLORS, PHASE_LABELS, type PipelinePhase } from './inspector/TerminalTabs';

interface SessionCost {
  id: string;
  startedAt: string;
  endedAt: string | null;
  type: string;
  model: string;
  cost?: number;
  tokenCount?: number;
}

interface ModelCostInfo {
  cost: number;
  tokens: number;
}

interface StageCostInfo {
  cost: number;
  tokens: number;
}

interface IssueCostData {
  issueId: string;
  totalCost: number;
  totalTokens: number;
  inputTokens?: number;
  outputTokens?: number;
  sessions: SessionCost[];
  byModel: Record<string, ModelCostInfo>;
  byStage?: Record<string, StageCostInfo>;
}

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
  onOpenTerminal?: () => void;
  /** When true, render without sidebar chrome (border-r, close btn) for embedded use */
  embedded?: boolean;
}

export function InspectorPanel({ agent, issueId, issueUrl, issue, phase, reviewStatus: reviewStatusProp, reviewStatusLoading: reviewStatusLoadingProp, onClose, onOpenTerminal, embedded }: InspectorPanelProps) {
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
  const [containerMenu, setContainerMenu] = useState<{
    x: number; y: number; containerName: string; isRunning: boolean;
  } | null>(null);

  const tmuxCommand = agent ? `tmux attach -t ${agent.id}` : '';

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

  const { data: workspace } = useQuery<WorkspaceInfo>({
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

  // Self-contained review status query (shares cache key with DetailPanelLayout)
  const { data: fetchedReviewStatus, isLoading: fetchedReviewStatusLoading } = useQuery<ReviewStatus>({
    queryKey: ['review-status', issueId],
    queryFn: async () => {
      const res = await fetch(`/api/review/${issueId}/status`);
      if (!res.ok) throw new Error('Failed to fetch review status');
      return res.json();
    },
    refetchInterval: 15000,
    enabled: !reviewStatusProp, // only fetch if parent didn't provide it
  });

  const reviewStatus = reviewStatusProp ?? fetchedReviewStatus;
  const reviewStatusLoading = reviewStatusLoadingProp ?? fetchedReviewStatusLoading ?? false;

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

  const { data: costData } = useQuery<IssueCostData>({
    queryKey: ['issueCosts', issueId],
    queryFn: async () => {
      const res = await fetch(`/api/issues/${issueId}/costs`);
      if (!res.ok) throw new Error('Failed to fetch costs');
      return res.json();
    },
    refetchInterval: 30000,
    staleTime: 10000,
  });

  const { data: planningState } = useQuery({
    queryKey: ['planning-state', issueId],
    queryFn: async () => {
      const res = await fetch(`/api/issues/${issueId}/planning-state`);
      if (!res.ok) throw new Error('Failed to fetch planning state');
      return res.json() as Promise<{ hasPlan: boolean; hasBeads: boolean; beadsCount: number; planningComplete: boolean }>;
    },
    enabled: !!issueId,
    refetchInterval: 30000,
    staleTime: 15000,
  });

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

      const res = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueId, projectId: issue?.project?.id, message: message || undefined }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to start agent');
      }
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['agents'] });
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ['agents'] }), 2000);
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
    const forceReview = shouldForceReviewTrigger(reviewStatus);
    const message = forceReview
      ? `Re-run review & test pipeline for ${issueId}?`
      : `Start review & test pipeline for ${issueId}?`;
    if (await confirm({ title: forceReview ? 'Re-run Review' : 'Start Review', message, confirmLabel: forceReview ? 'Re-run' : 'Start Review' })) {
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
      message: `Reopen ${issueId} for re-work?\n\nThis will:\n- Move the issue to "In Progress"\n- Reset review/test/merge status to pending\n- Remove any queued specialist tasks\n- Append a "Reopened" section to STATE.md`,
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

  return (
    <>
      <div
        className={`flex flex-col h-full overflow-y-auto bg-surface-raised border-divider ${embedded ? '' : 'border-r'}`}
        data-testid="workspace-sidebar"
      >
        {/* Header */}
        <div className="px-3 py-2.5 border-b border-divider flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {agent ? (
              <div className="flex gap-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" style={{ animationDelay: '300ms' }} />
              </div>
            ) : (
              <span className="w-1.5 h-1.5 rounded-full bg-content-muted shrink-0" />
            )}
            <span className="font-mono text-sm font-semibold text-content truncate">{issueId.toUpperCase()}</span>
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
                  onClick={onOpenTerminal}
                  className="p-1 rounded transition-colors hover:bg-surface-overlay text-content-subtle"
                  title="Open terminal"
                >
                  <Terminal className="w-3.5 h-3.5" />
                </button>
              )}
              <button onClick={onClose} title="Close inspector" className="p-1 rounded transition-colors hover:bg-surface-overlay text-content-subtle">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Issue title */}
        {issue && (
          <div className="px-3 py-2 border-b border-divider">
            <p className="text-xs text-content font-medium line-clamp-2" title={issue.title}>{issue.title}</p>
            <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
              <span className="px-1.5 py-0.5 rounded text-[10px] bg-surface-emphasis text-content-subtle">
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
                <span key={label} className="px-1.5 py-0.5 rounded text-[10px] bg-surface-emphasis text-content-subtle">
                  {label}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Assignee */}
        {issue?.assignee && (
          <div className="px-3 py-2 border-b border-divider flex items-center gap-2 text-xs">
            <User className="w-3 h-3 shrink-0 text-content-subtle" />
            <span className="text-content truncate">{issue.assignee.name}</span>
            {issue.assignee.email && (
              <span className="text-[10px] truncate text-content-subtle">{issue.assignee.email}</span>
            )}
          </div>
        )}

        {/* Merged status banner for issues without workspaces */}
        {!agent && !workspace?.exists && issue?.labels?.some(l => l.toLowerCase() === 'merged') && (
          <div className="px-3 py-3 border-b border-divider">
            <div className="flex items-center gap-2 mb-2">
              <GitMerge className="w-4 h-4 text-success" />
              <span className="text-xs font-medium text-success">Merged to Main</span>
            </div>
            <p className="text-[10px] text-content-subtle">
              This issue was completed and merged outside of Panopticon's workspace pipeline.
              No workspace, agent, or pipeline state is available.
            </p>
            {costData && costData.totalCost > 0 && (
              <div className="mt-2 flex items-center gap-2 text-[10px]">
                <DollarSign className="w-3 h-3 text-success" />
                <span className="text-content-subtle">Total cost:</span>
                <span className="text-success font-medium">{formatCost(costData.totalCost)}</span>
              </div>
            )}
          </div>
        )}

        {/* Not merged, no workspace, no agent — show status */}
        {!agent && !workspace?.exists && !issue?.labels?.some(l => l.toLowerCase() === 'merged') && issue && (
          <div className="px-3 py-3 border-b border-divider">
            <div className="text-[10px] text-content-subtle">
              No workspace created yet. Use <strong>Plan</strong> to create a workspace and plan this issue,
              or <strong>Create Workspace</strong> below.
            </div>
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
          <div className="px-3 py-2 border-b border-divider text-xs">
            <div className="flex items-center gap-1.5 text-content-subtle">
              <span className="font-mono truncate text-[10px]" title={workspace.path}>
                {workspace.path}
              </span>
            </div>
          </div>
        )}

        {/* Links */}
        <div className="px-3 py-2 border-b border-divider text-xs">
          <div className="uppercase tracking-wider text-[10px] mb-2 font-semibold text-content-subtle">Links</div>
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
        {costData && costData.totalCost > 0 && (
          <div className="px-3 py-2 border-b border-divider text-xs">
            <div className="flex items-center gap-1.5 mb-2">
              <DollarSign className="w-3 h-3 text-success" />
              <span className="uppercase tracking-wider text-[10px] font-semibold text-content-subtle">Cost</span>
              <span className="text-success font-medium ml-auto">{formatCost(costData.totalCost)}</span>
            </div>
            {costData.totalTokens > 0 && (
              <div className="space-y-0.5">
                <div className="flex justify-between text-[10px]">
                  <span className="text-content-subtle">Input tokens</span>
                  <span className="text-content">{formatTokens(costData.inputTokens ?? 0)}</span>
                </div>
                <div className="flex justify-between text-[10px]">
                  <span className="text-content-subtle">Output tokens</span>
                  <span className="text-content">{formatTokens(costData.outputTokens ?? 0)}</span>
                </div>
              </div>
            )}
            {Object.keys(costData.byModel).length > 0 && (
              <div className="mt-1.5 space-y-0.5">
                {Object.entries(costData.byModel).sort(([, a], [, b]) => b.cost - a.cost).map(([model, info]) => (
                  <div key={model} className="flex justify-between text-[10px]">
                    <span className="truncate text-content-subtle" title={model}>{getFriendlyModelName(model)}</span>
                    <span className="text-content ml-2">{formatCost(info.cost)} ({formatTokens(info.tokens)})</span>
                  </div>
                ))}
              </div>
            )}
            {costData.byStage && Object.keys(costData.byStage).length > 0 && (
              <div className="mt-1.5 pt-1.5 border-t border-divider space-y-0.5">
                <div className="text-[10px] uppercase tracking-wider mb-1 text-content-subtle">By Stage</div>
                {Object.entries(costData.byStage).sort(([, a], [, b]) => b.cost - a.cost).map(([stage, info]) => (
                  <div key={stage} className="flex justify-between text-[10px]">
                    <span className="truncate text-content-subtle" title={stage}>{stage.charAt(0).toUpperCase() + stage.slice(1)}</span>
                    <span className="text-content ml-2">{formatCost(info.cost)} ({formatTokens(info.tokens)})</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Corrupted workspace warning */}
        {workspace?.corrupted && (
          <div className="px-3 py-2 border-b border-divider">
            <div className="flex items-center gap-2 text-warning mb-2">
              <AlertTriangle className="w-4 h-4" />
              <span className="text-xs font-medium">Workspace Corrupted</span>
            </div>
            <p className="text-xs mb-2 text-content-subtle">{workspace.message || 'The workspace is not a valid git worktree.'}</p>
            <button
              onClick={handleCleanWorkspace}
              disabled={cleanMutation.isPending}
              className="flex items-center gap-1 px-2 py-1 bg-warning hover:bg-warning/90 disabled:opacity-50 text-white text-xs rounded w-full justify-center"
            >
              {cleanMutation.isPending ? <><Loader2 className="w-3 h-3 animate-spin" />Cleaning...</> : <><RefreshCw className="w-3 h-3" />Clean &amp; Recreate</>}
            </button>
          </div>
        )}

        {/* Service URLs */}
        {workspace?.hasDocker && (workspace?.frontendUrl || workspace?.apiUrl) && (
          <div className="px-3 py-2 border-b border-divider text-xs">
            <div className="uppercase tracking-wider text-[10px] mb-2 font-semibold text-content-subtle">Services</div>
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
          <div className="px-3 py-2 border-b border-divider">
            <div className="flex items-center gap-2">
              <span className="text-xs text-warning">{containersStarting ? 'Starting containers...' : Object.keys(workspace.containers).length === 0 ? 'Containers not started' : 'Some containers stopped'}</span>
              <button
                onClick={() => startContainersMutation.mutate()}
                disabled={startContainersMutation.isPending || containersStarting}
                className="flex items-center gap-1 px-2 py-1 bg-success hover:bg-success/90 disabled:opacity-50 text-white text-xs rounded"
              >
                {(startContainersMutation.isPending || containersStarting) ? <><Loader2 className="w-3 h-3 animate-spin" />Starting...</> : <><Play className="w-3 h-3" />Start Containers</>}
              </button>
            </div>
          </div>
        )}

        {/* Git-only workspace / containerize */}
        {workspace?.exists && !workspace.hasDocker && workspace.canContainerize && (
          <div className="px-3 py-2 border-b border-divider">
            <div className="flex items-center gap-2">
              <span className="text-xs text-content-subtle">Git-only workspace</span>
              <button
                onClick={() => containerizeMutation.mutate()}
                disabled={containerizeMutation.isPending}
                className="flex items-center gap-1 px-2 py-1 bg-signal-review hover:bg-signal-review/90 disabled:opacity-50 text-white text-xs rounded"
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
          <div className="px-3 py-2 border-b border-divider text-xs">
            <div className="uppercase tracking-wider text-[10px] mb-2 font-semibold text-content-subtle">Attach</div>
            <div className="flex items-center gap-2">
              <div className="flex-1 flex items-center gap-1.5 px-2 py-1.5 rounded font-mono text-[11px] text-content overflow-hidden bg-surface">
                <Terminal className="w-3 h-3 shrink-0 text-primary" />
                <span className="truncate">{tmuxCommand}</span>
              </div>
              <button
                onClick={handleCopy}
                className={`p-1.5 rounded transition-colors ${copied ? 'badge-bg-success text-success' : 'bg-surface-emphasis text-content-subtle hover:text-content'}`}
                title="Copy to clipboard"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
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
          hasPlan={planningState?.hasPlan ?? false}
          beadsCount={planningState?.beadsCount ?? 0}
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
          lifecycle={agentLifecycle}
          agentLaunchState={agentLaunchState}
        />

        {/* Issue labels/tags for no-agent view */}
        {!agent && issue && issue.labels.length > 3 && (
          <div className="px-3 py-2 border-b border-divider text-xs">
            <div className="flex flex-wrap gap-1">
              {issue.labels.map((label) => (
                <span key={label} className="px-2 py-0.5 rounded text-xs bg-surface-emphasis text-content-subtle">
                  <Tag className="w-3 h-3 inline mr-1" />{label}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="flex-1" />
      </div>

      {/* Beads dialog */}
      {showBeads && <BeadsDialog issueId={issueId} isOpen={showBeads} onClose={() => setShowBeads(false)} />}

      {/* vBRIEF dialog */}
      {showVBrief && <VBriefDialog issueId={issueId} onClose={() => setShowVBrief(false)} />}

      {/* PRD Modal */}
      {showPrdModal && prdContent && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50" onClick={() => setShowPrdModal(false)}>
          <div className="border border-divider rounded-lg shadow-xl w-[700px] max-h-[80vh] flex flex-col bg-surface-raised" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-divider">
              <h2 className="text-sm font-medium text-content">PRD — {issueId.toUpperCase()}</h2>
              <button onClick={() => setShowPrdModal(false)} className="text-content-subtle hover:text-content">
                <X size={18} />
              </button>
            </div>
            <div className="overflow-y-auto px-4 py-3 text-xs prose prose-invert prose-sm max-w-none">
              <ReactMarkdown rehypePlugins={[rehypeSanitize]}>{prdContent}</ReactMarkdown>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
