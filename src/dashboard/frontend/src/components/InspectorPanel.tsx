import { useState, useCallback } from 'react';
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
  ListTodo,
  RefreshCw,
  Box,
  Play,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import { Agent, Issue } from '../types';
import { BeadsDialog } from './BeadsDialog';
import { useConfirm } from './DialogProvider';
import { AgentInfoSection } from './inspector/AgentInfoSection';
import { ContainerSection } from './inspector/ContainerSection';
import { ActionsSection } from './inspector/ActionsSection';

interface ContainerStatus {
  running: boolean;
  uptime: string | null;
  status?: string;
}

interface PendingOperation {
  type: 'approve' | 'close' | 'containerize' | 'start' | 'review' | 'merge';
  issueId: string;
  startedAt: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  error?: string;
}

interface ReviewStatus {
  issueId: string;
  reviewStatus: 'pending' | 'reviewing' | 'passed' | 'failed' | 'blocked';
  testStatus: 'pending' | 'testing' | 'passed' | 'failed' | 'skipped';
  mergeStatus?: 'pending' | 'merging' | 'merged' | 'failed';
  verificationStatus?: 'pending' | 'running' | 'passed' | 'failed' | 'skipped';
  verificationNotes?: string;
  verificationCycleCount?: number;
  verificationMaxCycles?: number;
  reviewNotes?: string;
  testNotes?: string;
  updatedAt: string;
  readyForMerge: boolean;
  autoRequeueCount?: number;
  history?: Array<{ type: 'review' | 'test' | 'merge'; status: string; timestamp: string; notes?: string }>;
}

interface WorkspaceInfo {
  exists: boolean;
  corrupted?: boolean;
  message?: string;
  issueId: string;
  path?: string;
  frontendUrl?: string;
  apiUrl?: string;
  containers?: Record<string, ContainerStatus> | null;
  hasDocker?: boolean;
  canContainerize?: boolean;
  pendingOperation?: PendingOperation | null;
  location?: 'local' | 'remote';
}

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

function getFriendlyModelName(fullModel: string): string {
  if (fullModel.includes('opus-4-6') || fullModel.includes('opus-4.6')) return 'Opus 4.6';
  if (fullModel.includes('opus-4-5') || fullModel.includes('opus-4.5')) return 'Opus 4.5';
  if (fullModel.includes('opus-4-1')) return 'Opus 4.1';
  if (fullModel.includes('opus-4') || fullModel.includes('opus')) return 'Opus 4';
  if (fullModel.includes('sonnet-4-6') || fullModel.includes('sonnet-4.6')) return 'Sonnet 4.6';
  if (fullModel.includes('sonnet-4-5') || fullModel.includes('sonnet-4.5')) return 'Sonnet 4.5';
  if (fullModel.includes('sonnet-4') || fullModel.includes('sonnet')) return 'Sonnet 4';
  if (fullModel.includes('haiku-4-5') || fullModel.includes('haiku-4.5')) return 'Haiku 4.5';
  if (fullModel.includes('haiku-3')) return 'Haiku 3';
  if (fullModel.includes('haiku')) return 'Haiku 4.5';
  return fullModel;
}

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
  onClose: () => void;
  onOpenTerminal?: () => void;
}

export function InspectorPanel({ agent, issueId, issueUrl, issue, onClose, onOpenTerminal }: InspectorPanelProps) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [copied, setCopied] = useState(false);
  const [showPrdModal, setShowPrdModal] = useState(false);
  const [showBeads, setShowBeads] = useState(false);
  const [workspaceCreating, setWorkspaceCreating] = useState(false);
  const [containersStarting, setContainersStarting] = useState(false);
  const [containersStartedAt, setContainersStartedAt] = useState(0);
  const [containerMenu, setContainerMenu] = useState<{
    x: number; y: number; containerName: string; isRunning: boolean;
  } | null>(null);

  const tmuxCommand = agent ? `tmux attach -t ${agent.id}` : '';

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
    refetchInterval: (workspaceCreating || containersStarting) ? 2000 : 5000,
  });

  const { data: reviewStatus } = useQuery<ReviewStatus>({
    queryKey: ['review-status', issueId],
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${issueId}/review-status`);
      if (!res.ok) throw new Error('Failed to fetch review status');
      return res.json();
    },
    refetchInterval: 3000,
  });

  const { data: prdContent } = useQuery({
    queryKey: ['prd', issueId],
    queryFn: async () => {
      try {
        const res = await fetch(`/api/mission-control/planning/${issueId}`);
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

  const startAgentMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueId, projectId: issue?.project?.id }),
      });
      if (!res.ok) throw new Error('Failed to start agent');
      return res.json();
    },
    onSuccess: () => {
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ['agents'] }), 2000);
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
      const res = await fetch(`/api/workspaces/${issueId}/start`, {
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

  const reviewMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/workspaces/${issueId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to start review');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace', issueId] });
      queryClient.invalidateQueries({ queryKey: ['review-status', issueId] });
    },
  });

  const mergeMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/workspaces/${issueId}/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to merge');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace', issueId] });
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      queryClient.invalidateQueries({ queryKey: ['issues'] });
      queryClient.invalidateQueries({ queryKey: ['review-status', issueId] });
      onClose();
    },
  });

  const closeMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/issues/${issueId}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Closed manually' }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to close issue');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace', issueId] });
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      queryClient.invalidateQueries({ queryKey: ['issues'] });
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace', issueId] });
      queryClient.invalidateQueries({ queryKey: ['review-status', issueId] });
      queryClient.invalidateQueries({ queryKey: ['issues'] });
    },
  });

  const resetReviewMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/workspaces/${issueId}/reset-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to reset review cycles');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace', issueId] });
      queryClient.invalidateQueries({ queryKey: ['review-status', issueId] });
      queryClient.invalidateQueries({ queryKey: ['issues'] });
    },
  });

  const dismissPendingMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/workspaces/${issueId}/pending`, { method: 'DELETE' });
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
      const res = await fetch(`/api/workspaces/${issueId}/sync-main`, {
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

  const killMutation = useMutation({
    mutationFn: async () => {
      if (!agent) throw new Error('No agent');
      const res = await fetch(`/api/agents/${agent.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to kill');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      onClose();
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
    const isReReview = reviewStatus?.readyForMerge || reviewStatus?.reviewStatus === 'passed' || reviewStatus?.testStatus === 'passed';
    const message = isReReview
      ? `Re-run review & test pipeline for ${issueId}?`
      : `Start review & test pipeline for ${issueId}?`;
    if (await confirm({ title: isReReview ? 'Re-run Review' : 'Start Review', message, confirmLabel: isReReview ? 'Re-run' : 'Start Review' })) {
      reviewMutation.mutate();
    }
  };

  const handleMerge = async () => {
    if (await confirm({
      title: 'Merge to Main',
      message: `Merge ${issueId} to main?\n\nReview and tests have passed. This will:\n- Merge the feature branch to main\n- Run final verification tests\n- Clean up workspace`,
      confirmLabel: 'Merge',
    })) {
      mergeMutation.mutate();
    }
  };

  const handleClose = async () => {
    if (await confirm({
      title: 'Close Without Merging',
      message: `Close ${issueId} without merging? This will:\n- Close the issue (no merge)\n- Stop any running agent\n- Remove the workspace\n(Feature branch is preserved for history)`,
      variant: 'destructive',
      confirmLabel: 'Close',
    })) {
      closeMutation.mutate();
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

  const handleResetReview = async () => {
    if (await confirm({
      title: 'Reset Review Cycles',
      message: `Reset all review/test/merge cycles for ${issueId}?\n\nThis will:\n- Clear review, test, and merge status\n- Reset the circuit breaker counter\n- Remove queued specialist tasks\n\nThe agent can then request review when ready.\nTracker status will NOT change.`,
      confirmLabel: 'Reset Cycles',
    })) {
      resetReviewMutation.mutate();
    }
  };

  const handleKill = async () => {
    if (agent && await confirm({ title: 'Kill Agent', message: `Kill agent ${agent.id}?`, variant: 'destructive', confirmLabel: 'Kill' })) {
      killMutation.mutate();
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
        className="flex flex-col h-full overflow-y-auto bg-pan-panel-left border-r border-pan-border"
        data-testid="workspace-sidebar"
      >
        {/* Header */}
        <div className="px-3 py-2.5 border-b border-pan-border flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {agent ? (
              <div className="flex gap-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" style={{ animationDelay: '300ms' }} />
              </div>
            ) : (
              <span className="w-1.5 h-1.5 rounded-full bg-gray-600 shrink-0" />
            )}
            <span className="font-mono text-sm font-semibold text-white truncate">{issueId.toUpperCase()}</span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {onOpenTerminal && agent && (
              <button
                onClick={onOpenTerminal}
                className="p-1 rounded transition-colors hover:bg-white/10 text-pan-text-secondary"
                title="Open terminal"
              >
                <Terminal className="w-3.5 h-3.5" />
              </button>
            )}
            <button onClick={onClose} title="Close inspector" className="p-1 rounded transition-colors hover:bg-white/10 text-pan-text-secondary">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Issue title */}
        {issue && (
          <div className="px-3 py-2 border-b border-pan-border">
            <p className="text-xs text-white font-medium line-clamp-2" title={issue.title}>{issue.title}</p>
            <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
              <span className="px-1.5 py-0.5 rounded text-[10px] bg-pan-border text-pan-text-secondary">
                {issue.status}
              </span>
              {issue.priority > 0 && (
                <span className={`text-[10px] ${
                  issue.priority === 1 ? 'text-red-400' :
                  issue.priority === 2 ? 'text-orange-400' :
                  issue.priority === 3 ? 'text-yellow-400' : 'text-blue-400'
                }`}>
                  {issue.priority === 1 ? 'Urgent' : issue.priority === 2 ? 'High' : issue.priority === 3 ? 'Medium' : 'Low'}
                </span>
              )}
              {issue.labels.slice(0, 2).map((label) => (
                <span key={label} className="px-1.5 py-0.5 rounded text-[10px] bg-pan-border text-pan-text-secondary">
                  {label}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Assignee */}
        {issue?.assignee && (
          <div className="px-3 py-2 border-b border-pan-border flex items-center gap-2 text-xs">
            <User className="w-3 h-3 shrink-0 text-pan-text-secondary" />
            <span className="text-white truncate">{issue.assignee.name}</span>
            {issue.assignee.email && (
              <span className="text-[10px] truncate text-pan-text-secondary">{issue.assignee.email}</span>
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
          <div className="px-3 py-2 border-b border-pan-border text-xs">
            <div className="flex items-center gap-1.5 text-pan-text-secondary">
              <span className="font-mono truncate text-[10px]" title={workspace.path}>
                {workspace.path}
              </span>
            </div>
          </div>
        )}

        {/* Links */}
        <div className="px-3 py-2 border-b border-pan-border text-xs">
          <div className="uppercase tracking-wider text-[10px] mb-2 font-semibold text-pan-text-secondary">Links</div>
          <div className="space-y-1.5">
            {issueUrl && (
              <a href={issueUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-blue-400 hover:text-blue-300">
                <ExternalLink className="w-3 h-3" />
                <span>{issueId.toUpperCase().startsWith('PAN-') ? 'GitHub Issue' : 'Linear Issue'}</span>
              </a>
            )}
            {prdContent && (
              <button onClick={() => setShowPrdModal(true)} className="flex items-center gap-1.5 text-blue-400 hover:text-blue-300">
                <FileText className="w-3 h-3" />
                <span>PRD</span>
              </button>
            )}
            <button onClick={() => setShowBeads(true)} className="flex items-center gap-1.5 text-blue-400 hover:text-blue-300">
              <ListTodo className="w-3 h-3" />
              <span>Beads Tasks</span>
            </button>
          </div>
        </div>

        {/* Cost summary */}
        {costData && costData.totalCost > 0 && (
          <div className="px-3 py-2 border-b border-pan-border text-xs">
            <div className="flex items-center gap-1.5 mb-2">
              <DollarSign className="w-3 h-3 text-green-400" />
              <span className="uppercase tracking-wider text-[10px] font-semibold text-pan-text-secondary">Cost</span>
              <span className="text-green-400 font-medium ml-auto">{formatCost(costData.totalCost)}</span>
            </div>
            {costData.totalTokens > 0 && (
              <div className="flex justify-between text-[10px]">
                <span className="text-pan-text-secondary">Tokens</span>
                <span className="text-white">{formatTokens(costData.totalTokens)}</span>
              </div>
            )}
            {Object.keys(costData.byModel).length > 0 && (
              <div className="mt-1.5 space-y-0.5">
                {Object.entries(costData.byModel).sort(([, a], [, b]) => b.cost - a.cost).map(([model, info]) => (
                  <div key={model} className="flex justify-between text-[10px]">
                    <span className="truncate text-pan-text-secondary" title={model}>{getFriendlyModelName(model)}</span>
                    <span className="text-white ml-2">{formatCost(info.cost)} ({formatTokens(info.tokens)})</span>
                  </div>
                ))}
              </div>
            )}
            {costData.byStage && Object.keys(costData.byStage).length > 0 && (
              <div className="mt-1.5 pt-1.5 border-t border-pan-border space-y-0.5">
                <div className="text-[10px] uppercase tracking-wider mb-1 text-pan-text-secondary">By Stage</div>
                {Object.entries(costData.byStage).sort(([, a], [, b]) => b.cost - a.cost).map(([stage, info]) => (
                  <div key={stage} className="flex justify-between text-[10px]">
                    <span className="truncate text-pan-text-secondary" title={stage}>{stage.charAt(0).toUpperCase() + stage.slice(1)}</span>
                    <span className="text-white ml-2">{formatCost(info.cost)} ({formatTokens(info.tokens)})</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Corrupted workspace warning */}
        {workspace?.corrupted && (
          <div className="px-3 py-2 border-b border-pan-border">
            <div className="flex items-center gap-2 text-yellow-500 mb-2">
              <AlertTriangle className="w-4 h-4" />
              <span className="text-xs font-medium">Workspace Corrupted</span>
            </div>
            <p className="text-xs mb-2 text-pan-text-secondary">{workspace.message || 'The workspace is not a valid git worktree.'}</p>
            <button
              onClick={handleCleanWorkspace}
              disabled={cleanMutation.isPending}
              className="flex items-center gap-1 px-2 py-1 bg-yellow-600 hover:bg-yellow-500 disabled:bg-yellow-800 text-white text-xs rounded w-full justify-center"
            >
              {cleanMutation.isPending ? <><Loader2 className="w-3 h-3 animate-spin" />Cleaning...</> : <><RefreshCw className="w-3 h-3" />Clean &amp; Recreate</>}
            </button>
          </div>
        )}

        {/* Service URLs */}
        {workspace?.hasDocker && (workspace?.frontendUrl || workspace?.apiUrl) && (
          <div className="px-3 py-2 border-b border-pan-border text-xs">
            <div className="uppercase tracking-wider text-[10px] mb-2 font-semibold text-pan-text-secondary">Services</div>
            <div className="space-y-1.5">
              {workspace.frontendUrl && (
                <a href={workspace.frontendUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-blue-400 hover:text-blue-300">
                  <Globe className="w-3 h-3" /><span>Frontend</span>
                </a>
              )}
              {workspace.apiUrl && (
                <a href={workspace.apiUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-blue-400 hover:text-blue-300">
                  <Globe className="w-3 h-3" /><span>API</span>
                </a>
              )}
            </div>
          </div>
        )}

        {/* Start containers button */}
        {workspace?.hasDocker && workspace.containers && Object.values(workspace.containers).some(c => !c.running) && (
          <div className="px-3 py-2 border-b border-pan-border">
            <div className="flex items-center gap-2">
              <span className="text-xs text-yellow-500">{containersStarting ? 'Starting containers...' : 'Some containers stopped'}</span>
              <button
                onClick={() => startContainersMutation.mutate()}
                disabled={startContainersMutation.isPending || containersStarting}
                className="flex items-center gap-1 px-2 py-1 bg-green-600 hover:bg-green-500 disabled:bg-green-800 text-white text-xs rounded"
              >
                {(startContainersMutation.isPending || containersStarting) ? <><Loader2 className="w-3 h-3 animate-spin" />Starting...</> : <><Play className="w-3 h-3" />Start Containers</>}
              </button>
            </div>
          </div>
        )}

        {/* Git-only workspace / containerize */}
        {workspace?.exists && !workspace.hasDocker && workspace.canContainerize && (
          <div className="px-3 py-2 border-b border-pan-border">
            <div className="flex items-center gap-2">
              <span className="text-xs text-pan-text-secondary">Git-only workspace</span>
              <button
                onClick={() => containerizeMutation.mutate()}
                disabled={containerizeMutation.isPending}
                className="flex items-center gap-1 px-2 py-1 bg-purple-600 hover:bg-purple-500 disabled:bg-purple-800 text-white text-xs rounded"
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
          <div className="px-3 py-2 border-b border-pan-border text-xs">
            <div className="uppercase tracking-wider text-[10px] mb-2 font-semibold text-pan-text-secondary">Attach</div>
            <div className="flex items-center gap-2">
              <div className="flex-1 flex items-center gap-1.5 px-2 py-1.5 rounded font-mono text-[11px] text-white overflow-hidden bg-pan-panel-right">
                <Terminal className="w-3 h-3 shrink-0 text-blue-400" />
                <span className="truncate">{tmuxCommand}</span>
              </div>
              <button
                onClick={handleCopy}
                className={`p-1.5 rounded transition-colors ${copied ? 'bg-green-900/30 text-green-400' : 'bg-pan-border text-gray-500 hover:text-white'}`}
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
          reviewStatus={reviewStatus}
          workspace={workspace}
          mergeMutation={mergeMutation}
          reviewMutation={reviewMutation}
          killMutation={killMutation}
          closeMutation={closeMutation}
          reopenMutation={reopenMutation}
          resetReviewMutation={resetReviewMutation}
          startAgentMutation={startAgentMutation}
          createWorkspaceMutation={createWorkspaceMutation}
          syncMainMutation={syncMainMutation}
          onMerge={handleMerge}
          onReview={handleReview}
          onKill={handleKill}
          onClose={handleClose}
          onReopen={handleReopen}
          onResetReview={handleResetReview}
          onDismissPending={() => dismissPendingMutation.mutate()}
          onStartAgent={() => startAgentMutation.mutate()}
          onCreateWorkspace={() => createWorkspaceMutation.mutate()}
        />

        {/* Issue labels/tags for no-agent view */}
        {!agent && issue && issue.labels.length > 3 && (
          <div className="px-3 py-2 border-b border-pan-border text-xs">
            <div className="flex flex-wrap gap-1">
              {issue.labels.map((label) => (
                <span key={label} className="px-2 py-0.5 rounded text-xs bg-pan-border text-pan-text-secondary">
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

      {/* PRD Modal */}
      {showPrdModal && prdContent && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50" onClick={() => setShowPrdModal(false)}>
          <div className="border border-pan-border rounded-lg shadow-xl w-[700px] max-h-[80vh] flex flex-col bg-pan-panel-left" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-pan-border">
              <h2 className="text-sm font-medium text-white">PRD — {issueId.toUpperCase()}</h2>
              <button onClick={() => setShowPrdModal(false)} className="text-pan-text-secondary hover:text-white">
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
