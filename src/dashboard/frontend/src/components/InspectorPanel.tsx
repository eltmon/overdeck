import { useState, useCallback, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  X,
  XCircle,
  GitBranch,
  GitMerge,
  Folder,
  Terminal,
  Copy,
  Check,
  ExternalLink,
  Square,
  RefreshCw,
  Box,
  Database,
  Globe,
  Play,
  Loader2,
  CheckCircle,
  AlertTriangle,
  Cloud,
  Monitor,
  DollarSign,
  FolderPlus,
  User,
  Tag,
  FileText,
  ListTodo,
  RotateCcw,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import { Agent, Issue } from '../types';
import { BeadsDialog } from './BeadsDialog';
import { useConfirm } from './DialogProvider';

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

interface StatusHistoryEntry {
  type: 'review' | 'test' | 'merge';
  status: string;
  timestamp: string;
  notes?: string;
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
  history?: StatusHistoryEntry[];
  // PAN-366: queue position info
  queuePosition?: number | null;
  activeSpecialist?: 'review' | 'test' | 'merge' | null;
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

function formatRelativeTime(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;
  if (diffMs < 0) return 'just now';
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function isStale(isoString: string, thresholdMinutes = 30): boolean {
  return Date.now() - new Date(isoString).getTime() > thresholdMinutes * 60 * 1000;
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

/**
 * Compute the label and disabled state for the Review & Test button (PAN-366).
 * Exported for unit testing.
 */
export interface ReviewButtonState {
  label: string;
  /** true when the button should be disabled (specialist active or queued) */
  disabled: boolean;
  /** true when the spinner should animate (actively processing) */
  spinning: boolean;
}

export function getReviewButtonState(
  reviewStatus: Pick<ReviewStatus, 'reviewStatus' | 'testStatus' | 'queuePosition' | 'activeSpecialist' | 'readyForMerge'> | undefined,
  mutationPending: boolean
): ReviewButtonState {
  const isActive = mutationPending
    || reviewStatus?.queuePosition === 0
    || reviewStatus?.reviewStatus === 'reviewing'
    || reviewStatus?.testStatus === 'testing';

  const isQueued = reviewStatus?.queuePosition != null
    && reviewStatus.queuePosition !== 0;

  if (isActive) {
    const label =
      reviewStatus?.activeSpecialist === 'test' || reviewStatus?.testStatus === 'testing'
        ? 'Testing...'
        : 'Reviewing...';
    return { label, disabled: true, spinning: true };
  }

  if (isQueued) {
    const pos = reviewStatus!.queuePosition!;
    let ordinal: string;
    if (pos === 1) {
      ordinal = '';  // "Queued" — no position needed for next-up
    } else {
      const mod100 = pos % 100;
      const mod10 = pos % 10;
      const suffix =
        (mod100 >= 11 && mod100 <= 13) ? 'th' :
        mod10 === 1 ? 'st' :
        mod10 === 2 ? 'nd' :
        mod10 === 3 ? 'rd' : 'th';
      ordinal = `${pos}${suffix}`;
    }
    const label = ordinal ? `Queued (${ordinal})` : 'Queued';
    return { label, disabled: true, spinning: false };
  }

  const label = reviewStatus?.readyForMerge ? 'Re-Review' : 'Review & Test';
  return { label, disabled: false, spinning: false };
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

function StatusHistory({ history }: { history: StatusHistoryEntry[] }) {
  const [expanded, setExpanded] = useState(false);
  const sorted = [...history].reverse();
  return (
    <div className="mt-2 border-t border-[#232f48]/30 pt-1.5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-[10px]"
        style={{ color: '#92a4c9' }}
      >
        <span>{expanded ? '▾' : '▸'}</span>
        <span>History ({history.length})</span>
      </button>
      {expanded && (
        <div className="mt-1 space-y-0.5">
          {sorted.map((entry, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[10px]">
              <span className="w-12 shrink-0" style={{ color: '#92a4c9' }}>{formatRelativeTime(entry.timestamp)}</span>
              <span className={
                entry.type === 'review' ? 'text-blue-400' :
                entry.type === 'test' ? 'text-purple-400' :
                'text-green-400'
              }>{entry.type}</span>
              <span className={
                entry.status === 'passed' ? 'text-green-400' :
                entry.status === 'failed' || entry.status === 'blocked' ? 'text-red-400' :
                ['reviewing', 'testing', 'merging'].includes(entry.status) ? 'text-yellow-400' :
                'text-gray-500'
              }>{entry.status}</span>
              {entry.notes && (
                <span className="truncate" style={{ color: '#92a4c9' }} title={entry.notes}>
                  — {entry.notes.slice(0, 60)}{entry.notes.length > 60 ? '...' : ''}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
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
  const containerMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerMenu) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerMenuRef.current && !containerMenuRef.current.contains(e.target as Node)) {
        setContainerMenu(null);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [containerMenu]);

  const tmuxCommand = agent ? `tmux attach -t ${agent.id}` : '';

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

  const handleContainerize = () => { containerizeMutation.mutate(); };
  const handleStartContainers = () => { startContainersMutation.mutate(); };

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

  const startedAt = agent ? new Date(agent.startedAt) : null;
  const durationMs = startedAt ? Date.now() - startedAt.getTime() : 0;
  const durationMins = Math.floor(durationMs / 60000);
  const durationHours = Math.floor(durationMins / 60);
  const duration = durationHours > 0 ? `${durationHours}h ${durationMins % 60}m` : `${durationMins}m`;

  const borderColor = '#232f48';
  const bgColor = '#161b26';
  const textSecondary = '#92a4c9';

  return (
    <>
      <div
        className="flex flex-col h-full overflow-y-auto"
        style={{ backgroundColor: bgColor, borderRight: `1px solid ${borderColor}` }}
        data-testid="workspace-sidebar"
      >
        {/* Header */}
        <div className="px-3 py-2.5 border-b flex items-center justify-between gap-2" style={{ borderColor }}>
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
                className="p-1 rounded transition-colors hover:bg-white/10"
                style={{ color: textSecondary }}
                title="Open terminal"
              >
                <Terminal className="w-3.5 h-3.5" />
              </button>
            )}
            <button onClick={onClose} title="Close inspector" className="p-1 rounded transition-colors hover:bg-white/10" style={{ color: textSecondary }}>
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Issue title */}
        {issue && (
          <div className="px-3 py-2 border-b" style={{ borderColor }}>
            <p className="text-xs text-white font-medium line-clamp-2" title={issue.title}>{issue.title}</p>
            <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
              <span
                className="px-1.5 py-0.5 rounded text-[10px]"
                style={{ backgroundColor: '#232f48', color: textSecondary }}
              >
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
                <span key={label} className="px-1.5 py-0.5 rounded text-[10px]" style={{ backgroundColor: '#232f48', color: textSecondary }}>
                  {label}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Assignee */}
        {issue?.assignee && (
          <div className="px-3 py-2 border-b flex items-center gap-2 text-xs" style={{ borderColor }}>
            <User className="w-3 h-3 shrink-0" style={{ color: textSecondary }} />
            <span className="text-white truncate">{issue.assignee.name}</span>
            {issue.assignee.email && (
              <span className="text-[10px] truncate" style={{ color: textSecondary }}>{issue.assignee.email}</span>
            )}
          </div>
        )}

        {/* Agent info */}
        {agent && (
          <div className="px-3 py-2 border-b text-xs" style={{ borderColor }}>
            <div className="uppercase tracking-wider text-[10px] mb-2 font-semibold" style={{ color: textSecondary }}>Agent</div>
            <div className="space-y-1.5">
              {[
                { label: 'Model', value: getFriendlyModelName(agent.model) },
                { label: 'Runtime', value: agent.runtime },
                { label: 'Uptime', value: duration },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between">
                  <span style={{ color: textSecondary }}>{label}</span>
                  <span className="text-white">{value}</span>
                </div>
              ))}
              <div className="flex items-center justify-between">
                <span style={{ color: textSecondary }}>Session</span>
                <span className="text-white font-mono text-[10px]">{agent.id}</span>
              </div>
            </div>
          </div>
        )}

        {/* Git Status */}
        {agent?.git && (
          <div className="px-3 py-2 border-b text-xs" style={{ borderColor }} data-testid="git-status">
            <div className="uppercase tracking-wider text-[10px] mb-2 font-semibold" style={{ color: textSecondary }}>Git Status</div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-white">
                <GitBranch className="w-3 h-3 shrink-0" style={{ color: textSecondary }} />
                <span className="font-mono flex-1 truncate">{agent.git.branch}</span>
                <button
                  onClick={handleSyncMain}
                  disabled={syncMainMutation.isPending}
                  title="Sync with main"
                  className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded transition-colors disabled:opacity-40"
                  style={{ backgroundColor: '#232f48', color: textSecondary }}
                >
                  {syncMainMutation.isPending ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <GitMerge className="w-2.5 h-2.5" />}
                  Sync
                </button>
              </div>
              {agent.git.uncommittedFiles > 0 && (
                <div className="text-yellow-400 text-[10px] ml-4">{agent.git.uncommittedFiles} uncommitted files</div>
              )}
              <div className="text-[10px] mt-1 truncate" style={{ color: textSecondary }} title={agent.git.latestCommit}>
                {agent.git.latestCommit}
              </div>
            </div>
          </div>
        )}

        {/* Workspace path */}
        {(agent?.workspace || (!agent && workspace?.exists && workspace.path)) && (
          <div className="px-3 py-2 border-b text-xs" style={{ borderColor }}>
            <div className="flex items-center gap-1.5" style={{ color: textSecondary }}>
              <Folder className="w-3 h-3 shrink-0" />
              <span className="font-mono truncate text-[10px]" title={agent?.workspace || workspace?.path}>
                {agent?.workspace || workspace?.path}
              </span>
            </div>
            {!agent && workspace?.location && (
              <span
                className="mt-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded"
                style={{ backgroundColor: workspace.location === 'remote' ? 'rgba(6,182,212,0.2)' : '#232f48', color: workspace.location === 'remote' ? '#22d3ee' : textSecondary }}
              >
                {workspace.location === 'remote' ? <Cloud className="w-3 h-3" /> : <Monitor className="w-3 h-3" />}
                {workspace.location}
              </span>
            )}
          </div>
        )}

        {/* Links */}
        <div className="px-3 py-2 border-b text-xs" style={{ borderColor }}>
          <div className="uppercase tracking-wider text-[10px] mb-2 font-semibold" style={{ color: textSecondary }}>Links</div>
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
          <div className="px-3 py-2 border-b text-xs" style={{ borderColor }}>
            <div className="flex items-center gap-1.5 mb-2">
              <DollarSign className="w-3 h-3" style={{ color: '#4ade80' }} />
              <span className="uppercase tracking-wider text-[10px] font-semibold" style={{ color: textSecondary }}>Cost</span>
              <span className="text-green-400 font-medium ml-auto">{formatCost(costData.totalCost)}</span>
            </div>
            {costData.totalTokens > 0 && (
              <div className="flex justify-between text-[10px]">
                <span style={{ color: textSecondary }}>Tokens</span>
                <span className="text-white">{formatTokens(costData.totalTokens)}</span>
              </div>
            )}
            {Object.keys(costData.byModel).length > 0 && (
              <div className="mt-1.5 space-y-0.5">
                {Object.entries(costData.byModel).sort(([, a], [, b]) => b.cost - a.cost).map(([model, info]) => (
                  <div key={model} className="flex justify-between text-[10px]">
                    <span className="truncate" style={{ color: textSecondary }} title={model}>{getFriendlyModelName(model)}</span>
                    <span className="text-white ml-2">{formatCost(info.cost)} ({formatTokens(info.tokens)})</span>
                  </div>
                ))}
              </div>
            )}
            {costData.byStage && Object.keys(costData.byStage).length > 0 && (
              <div className="mt-1.5 pt-1.5 border-t space-y-0.5" style={{ borderColor: '#232f48' }}>
                <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: textSecondary }}>By Stage</div>
                {Object.entries(costData.byStage).sort(([, a], [, b]) => b.cost - a.cost).map(([stage, info]) => (
                  <div key={stage} className="flex justify-between text-[10px]">
                    <span className="truncate" style={{ color: textSecondary }} title={stage}>{stage.charAt(0).toUpperCase() + stage.slice(1)}</span>
                    <span className="text-white ml-2">{formatCost(info.cost)} ({formatTokens(info.tokens)})</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Corrupted workspace warning */}
        {workspace?.corrupted && (
          <div className="px-3 py-2 border-b" style={{ borderColor }}>
            <div className="flex items-center gap-2 text-yellow-500 mb-2">
              <AlertTriangle className="w-4 h-4" />
              <span className="text-xs font-medium">Workspace Corrupted</span>
            </div>
            <p className="text-xs mb-2" style={{ color: textSecondary }}>{workspace.message || 'The workspace is not a valid git worktree.'}</p>
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
          <div className="px-3 py-2 border-b text-xs" style={{ borderColor }}>
            <div className="uppercase tracking-wider text-[10px] mb-2 font-semibold" style={{ color: textSecondary }}>Services</div>
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
          <div className="px-3 py-2 border-b" style={{ borderColor }}>
            <div className="flex items-center gap-2">
              <span className="text-xs text-yellow-500">{containersStarting ? 'Starting containers...' : 'Some containers stopped'}</span>
              <button
                onClick={handleStartContainers}
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
          <div className="px-3 py-2 border-b" style={{ borderColor }}>
            <div className="flex items-center gap-2">
              <span className="text-xs" style={{ color: textSecondary }}>Git-only workspace</span>
              <button
                onClick={handleContainerize}
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
          <div className="px-3 py-2 border-b text-xs" style={{ borderColor }}>
            <div className="uppercase tracking-wider text-[10px] mb-2 font-semibold" style={{ color: textSecondary }}>
              Containers
              <span className="font-normal ml-2" style={{ color: '#555f7a' }}>(right-click)</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(workspace.containers).map(([name, status]) => {
                const isStarting = (startContainersMutation.isPending || containersStarting) && !status.running && !status.status?.startsWith('exited');
                const isControlling = containerControlMutation.isPending && containerMenu?.containerName === name;
                const isFailed = status.status?.startsWith('exited') && !status.running;
                return (
                  <span
                    key={name}
                    onContextMenu={(e) => handleContainerContextMenu(e, name, status.running)}
                    className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] cursor-context-menu select-none ${
                      status.running ? 'bg-green-900/30 text-green-400' :
                      isFailed ? 'bg-red-900/30 text-red-400' :
                      isStarting || isControlling ? 'bg-yellow-900/30 text-yellow-400 animate-pulse' :
                      'text-gray-400'
                    }`}
                    style={!status.running && !isFailed && !isStarting && !isControlling ? { backgroundColor: '#232f48' } : undefined}
                    title="Right-click for options"
                  >
                    {isStarting || isControlling ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> :
                      name === 'postgres' || name === 'redis' ? <Database className="w-2.5 h-2.5" /> : <Box className="w-2.5 h-2.5" />}
                    {name}
                    {status.running && status.uptime && <span className="ml-1" style={{ color: textSecondary }}>{status.uptime}</span>}
                    {isFailed && <span className="text-red-500 ml-1">{status.status}</span>}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {/* Tmux attach command */}
        {agent && (
          <div className="px-3 py-2 border-b text-xs" style={{ borderColor }}>
            <div className="uppercase tracking-wider text-[10px] mb-2 font-semibold" style={{ color: textSecondary }}>Attach</div>
            <div className="flex items-center gap-2">
              <div
                className="flex-1 flex items-center gap-1.5 px-2 py-1.5 rounded font-mono text-[11px] text-white overflow-hidden"
                style={{ backgroundColor: '#0d1117' }}
              >
                <Terminal className="w-3 h-3 shrink-0 text-blue-400" />
                <span className="truncate">{tmuxCommand}</span>
              </div>
              <button
                onClick={handleCopy}
                className={`p-1.5 rounded transition-colors ${copied ? 'bg-green-900/30 text-green-400' : 'text-gray-500 hover:text-white'}`}
                style={!copied ? { backgroundColor: '#232f48' } : undefined}
                title="Copy to clipboard"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="px-3 py-2 border-b" style={{ borderColor }} data-testid="workspace-actions">
          <div className="text-xs uppercase tracking-wider mb-2 font-semibold" style={{ color: textSecondary }}>Actions</div>

          {/* Pending operation status */}
          {workspace?.pendingOperation?.type === 'approve' && workspace.pendingOperation.status === 'running' && (
            <div className="flex items-center gap-2 text-xs text-blue-400 bg-blue-900/20 px-2 py-1.5 rounded mb-2">
              <Loader2 className="w-3 h-3 animate-spin" /><span>Merging in progress...</span>
            </div>
          )}
          {workspace?.pendingOperation?.status === 'failed' && (
            <div className="text-xs text-red-400 bg-red-900/20 px-2 py-1.5 rounded mb-2">
              <div className="flex items-center justify-between">
                <span className="font-medium">Operation failed</span>
                <button onClick={() => dismissPendingMutation.mutate()} style={{ color: textSecondary }} className="hover:text-white">
                  <X className="w-3 h-3" />
                </button>
              </div>
              <div className="mt-1" style={{ color: textSecondary }}>{workspace.pendingOperation.error}</div>
            </div>
          )}

          {/* Review status */}
          {reviewStatus && (reviewStatus.reviewStatus !== 'pending' || reviewStatus.testStatus !== 'pending') && (
            <div className={`mb-2 p-2 rounded text-xs ${
              reviewStatus.updatedAt && isStale(reviewStatus.updatedAt) ? 'bg-amber-900/20 border border-amber-700/30' : ''
            }`} style={!isStale(reviewStatus.updatedAt ?? '') ? { backgroundColor: 'rgba(35,47,72,0.5)' } : {}}>
              {reviewStatus.updatedAt && isStale(reviewStatus.updatedAt) && (
                <div className="flex items-center gap-1 mb-1.5 text-amber-400 text-[10px]">
                  <AlertTriangle className="w-3 h-3" />
                  <span>Status may be stale ({formatRelativeTime(reviewStatus.updatedAt)})</span>
                </div>
              )}
              <div className="flex items-center gap-2 mb-1">
                <span style={{ color: textSecondary }}>Review:</span>
                <span className={
                  reviewStatus.reviewStatus === 'passed' ? 'text-green-400' :
                  reviewStatus.reviewStatus === 'blocked' || reviewStatus.reviewStatus === 'failed' ? 'text-red-400' :
                  reviewStatus.reviewStatus === 'reviewing' ? 'text-yellow-400' : 'text-gray-500'
                }>
                  {reviewStatus.reviewStatus === 'passed' ? '✓ Passed' :
                   reviewStatus.reviewStatus === 'blocked' ? '✗ Blocked' :
                   reviewStatus.reviewStatus === 'failed' ? '✗ Failed' :
                   reviewStatus.reviewStatus === 'reviewing' ? '⟳ Reviewing...' : 'Pending'}
                </span>
              </div>
              <div className="flex items-center gap-2 mb-1">
                <span style={{ color: textSecondary }}>Tests:</span>
                <span className={
                  reviewStatus.testStatus === 'passed' ? 'text-green-400' :
                  reviewStatus.testStatus === 'failed' ? 'text-red-400' :
                  reviewStatus.testStatus === 'testing' ? 'text-yellow-400' : 'text-gray-500'
                }>
                  {reviewStatus.testStatus === 'passed' ? '✓ Passed' :
                   reviewStatus.testStatus === 'failed' ? '✗ Failed' :
                   reviewStatus.testStatus === 'testing' ? '⟳ Testing...' :
                   reviewStatus.testStatus === 'skipped' ? '⊘ Skipped' : 'Pending'}
                </span>
              </div>
              {/* Verification status */}
              {reviewStatus.verificationStatus && reviewStatus.verificationStatus !== 'pending' && (
                <div className={`flex items-center gap-2 mb-1 ${
                  reviewStatus.verificationStatus === 'failed'
                    ? 'bg-red-900/20 rounded px-1 -mx-1'
                    : reviewStatus.verificationStatus === 'running'
                    ? 'bg-yellow-900/10 rounded px-1 -mx-1'
                    : ''
                }`}>
                  <span style={{ color: textSecondary }}>Verify:</span>
                  <span className={
                    reviewStatus.verificationStatus === 'passed' ? 'text-green-400' :
                    reviewStatus.verificationStatus === 'failed' ? 'text-red-400' :
                    reviewStatus.verificationStatus === 'skipped' ? 'text-gray-500' :
                    'text-yellow-400'
                  }>
                    {reviewStatus.verificationStatus === 'passed' ? '✓ Passed' :
                     reviewStatus.verificationStatus === 'failed' ? '✗ Failed' :
                     reviewStatus.verificationStatus === 'skipped' ? '⊘ Skipped' :
                     '⟳ Running...'}
                  </span>
                  {(reviewStatus.verificationCycleCount ?? 0) > 0 && (
                    <span className={`text-[10px] ${(reviewStatus.verificationCycleCount ?? 0) >= (reviewStatus.verificationMaxCycles ?? 3) ? 'text-red-400' : 'text-gray-500'}`}>
                      Attempt {reviewStatus.verificationCycleCount}/{reviewStatus.verificationMaxCycles ?? 3}
                    </span>
                  )}
                </div>
              )}
              {reviewStatus.verificationStatus === 'failed' && reviewStatus.verificationNotes && (
                <div className="text-[10px] text-red-300 mt-0.5 ml-2">{reviewStatus.verificationNotes}</div>
              )}
              {(reviewStatus.autoRequeueCount ?? 0) > 0 && (
                <div className="flex items-center gap-2 mt-1">
                  <span style={{ color: textSecondary }}>Cycles:</span>
                  <span className={(reviewStatus.autoRequeueCount ?? 0) >= 3 ? 'text-red-400 font-medium' : 'text-white'}>
                    {reviewStatus.autoRequeueCount}/3
                  </span>
                  {(reviewStatus.autoRequeueCount ?? 0) >= 3 && (
                    <span className="flex items-center gap-1 text-[10px] text-amber-400 bg-amber-900/20 px-1.5 py-0.5 rounded">
                      <AlertTriangle className="w-2.5 h-2.5" />Human review needed
                    </span>
                  )}
                </div>
              )}
              {reviewStatus.reviewNotes && <div className="mt-1 text-xs" style={{ color: textSecondary }}>{reviewStatus.reviewNotes}</div>}
              {reviewStatus.testNotes && <div className="mt-1 text-xs" style={{ color: textSecondary }}>{reviewStatus.testNotes}</div>}
              {reviewStatus.history && reviewStatus.history.length > 0 && <StatusHistory history={reviewStatus.history} />}
            </div>
          )}

          <div className="flex flex-wrap gap-1.5">
            {/* MERGE button */}
            {reviewStatus?.readyForMerge && reviewStatus?.mergeStatus !== 'merged' && (
              <button
                data-testid="merge-btn"
                onClick={handleMerge}
                disabled={mergeMutation.isPending || reviewStatus?.mergeStatus === 'merging'}
                className="flex items-center gap-1 px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-500 disabled:opacity-50 font-medium"
              >
                {(mergeMutation.isPending || reviewStatus?.mergeStatus === 'merging') ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
                {reviewStatus?.mergeStatus === 'merging' ? 'MERGING...' : 'MERGE'}
              </button>
            )}
            {reviewStatus?.mergeStatus === 'merged' && (
              <span className="flex items-center gap-1 px-2 py-1 text-xs bg-green-900/30 text-green-400 rounded font-medium">
                <CheckCircle className="w-3 h-3" />MERGED
              </span>
            )}

            {/* Review & Test */}
            {(() => {
              const btnState = getReviewButtonState(reviewStatus, reviewMutation.isPending);
              return (
                <button
                  data-testid="review-test-btn"
                  onClick={handleReview}
                  disabled={btnState.disabled}
                  className="flex items-center gap-1 px-2 py-1 text-xs rounded disabled:opacity-50 text-blue-400 hover:bg-blue-900/20"
                  style={{ backgroundColor: 'rgba(59,130,246,0.15)' }}
                >
                  {btnState.disabled
                    ? <Loader2 className={`w-3 h-3 ${btnState.spinning ? 'animate-spin' : 'opacity-50'}`} />
                    : <RefreshCw className="w-3 h-3" />}
                  {btnState.label}
                </button>
              );
            })()}

            {/* Stop Agent */}
            {agent && agent.status !== 'stopped' && (
              <button
                onClick={handleKill}
                disabled={killMutation.isPending}
                className="flex items-center gap-1 px-2 py-1 text-xs text-red-400 rounded hover:bg-red-900/20"
                style={{ backgroundColor: 'rgba(239,68,68,0.15)' }}
              >
                <Square className="w-3 h-3" />Stop
              </button>
            )}

            {/* Close Issue */}
            <button
              onClick={handleClose}
              disabled={closeMutation.isPending}
              className="flex items-center gap-1 px-2 py-1 text-xs text-orange-400 rounded hover:bg-orange-900/20 disabled:opacity-50"
              style={{ backgroundColor: 'rgba(249,115,22,0.15)' }}
            >
              {closeMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3" />}
              Close
            </button>

            {/* Reopen button */}
            {reviewStatus && (reviewStatus.reviewStatus === 'passed' || reviewStatus.reviewStatus === 'failed' || reviewStatus.reviewStatus === 'blocked' || reviewStatus.testStatus === 'passed' || reviewStatus.testStatus === 'failed' || reviewStatus.mergeStatus === 'merged') && (
              <button
                data-testid="reopen-btn"
                onClick={handleReopen}
                disabled={reopenMutation.isPending}
                className="flex items-center gap-1 px-2 py-1 text-xs bg-purple-900/30 text-purple-400 rounded hover:bg-purple-900/50 disabled:opacity-50"
              >
                {reopenMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                {reopenMutation.isPending ? 'Reopening...' : 'Reopen'}
              </button>
            )}

            {/* Reset Review Cycles */}
            {reviewStatus && (reviewStatus.reviewStatus !== 'pending' || reviewStatus.testStatus !== 'pending') && (
              <button
                onClick={handleResetReview}
                disabled={resetReviewMutation.isPending}
                className="flex items-center gap-1 px-2 py-1 text-xs bg-amber-900/30 text-amber-400 rounded hover:bg-amber-900/50 disabled:opacity-50"
              >
                {resetReviewMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                {resetReviewMutation.isPending ? 'Resetting...' : 'Reset Reviews'}
              </button>
            )}

            {/* Start Agent when no agent or stopped */}
            {(!agent || agent.status === 'stopped') && (
              <>
                <button
                  onClick={() => startAgentMutation.mutate()}
                  disabled={startAgentMutation.isPending || startAgentMutation.isSuccess}
                  className="flex items-center gap-1 px-2 py-1 text-xs text-white rounded hover:bg-blue-600 disabled:opacity-50 font-medium"
                  style={{ backgroundColor: '#2769ec' }}
                >
                  {startAgentMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : startAgentMutation.isSuccess ? <Check className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                  {startAgentMutation.isPending ? 'Starting...' : startAgentMutation.isSuccess ? 'Started!' : 'Start Agent'}
                </button>
                {!workspace?.exists && (
                  <button
                    onClick={() => createWorkspaceMutation.mutate()}
                    disabled={createWorkspaceMutation.isPending || createWorkspaceMutation.isSuccess}
                    className="flex items-center gap-1 px-2 py-1 text-xs text-white rounded disabled:opacity-50 border"
                    style={{ backgroundColor: '#232f48', borderColor: '#374151' }}
                  >
                    {(createWorkspaceMutation.isPending || createWorkspaceMutation.isSuccess) ? <Loader2 className="w-3 h-3 animate-spin" /> : <FolderPlus className="w-3 h-3" />}
                    {createWorkspaceMutation.isPending ? 'Creating...' : 'Create Workspace'}
                  </button>
                )}
              </>
            )}
          </div>

          {/* Error states */}
          {reviewMutation.isError && (
            <div className="text-xs text-red-400 bg-red-900/20 px-2 py-1 rounded mt-2">
              {reviewMutation.error instanceof Error ? reviewMutation.error.message : 'Failed to start review'}
            </div>
          )}
          {mergeMutation.isError && (
            <div className="text-xs text-red-400 bg-red-900/20 px-2 py-1 rounded mt-2">
              {mergeMutation.error instanceof Error ? mergeMutation.error.message : 'Failed to merge'}
            </div>
          )}
          {syncMainMutation.isError && (
            <div className="text-xs text-red-400 bg-red-900/20 px-2 py-1 rounded mt-2">
              {syncMainMutation.error instanceof Error ? syncMainMutation.error.message : 'Sync with main failed'}
            </div>
          )}
          {syncMainMutation.isSuccess && syncMainMutation.data && (
            <div className="text-xs text-green-400 bg-green-900/20 px-2 py-1 rounded mt-2">
              {syncMainMutation.data.alreadyUpToDate ? 'Already up to date with main' : `Synced ${syncMainMutation.data.commitCount ?? 0} commit(s) from main`}
            </div>
          )}
        </div>

        {/* Issue labels/tags for no-agent view */}
        {!agent && issue && issue.labels.length > 3 && (
          <div className="px-3 py-2 border-b text-xs" style={{ borderColor }}>
            <div className="flex flex-wrap gap-1">
              {issue.labels.map((label) => (
                <span key={label} className="px-2 py-0.5 rounded text-xs" style={{ backgroundColor: '#232f48', color: textSecondary }}>
                  <Tag className="w-3 h-3 inline mr-1" />{label}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="flex-1" />
      </div>

      {/* Container context menu */}
      {containerMenu && (
        <div
          ref={containerMenuRef}
          className="fixed z-50 border rounded shadow-lg py-1 min-w-[140px]"
          style={{ left: containerMenu.x, top: containerMenu.y, backgroundColor: '#161b26', borderColor: '#232f48' }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-1 text-xs border-b mb-1" style={{ color: textSecondary, borderColor: '#232f48' }}>
            {containerMenu.containerName}
          </div>
          {containerMenu.isRunning ? (
            <>
              <button onClick={() => containerControlMutation.mutate({ containerName: containerMenu.containerName, action: 'restart' })} disabled={containerControlMutation.isPending} className="w-full text-left px-3 py-1.5 text-xs text-white hover:bg-white/5 flex items-center gap-2 disabled:opacity-50">
                <RefreshCw className="w-3 h-3" />Restart
              </button>
              <button onClick={() => containerControlMutation.mutate({ containerName: containerMenu.containerName, action: 'stop' })} disabled={containerControlMutation.isPending} className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-white/5 flex items-center gap-2 disabled:opacity-50">
                <Square className="w-3 h-3" />Stop
              </button>
              {containerMenu.containerName === 'postgres' && (
                <>
                  <div className="border-t my-1" style={{ borderColor: '#232f48' }} />
                  <button
                    onClick={async () => {
                      if (await confirm({ title: 'Refresh Database', message: 'Drop and reload database from seed file?\n\nThis will:\n- Stop the API container\n- Drop the existing database\n- Reload from seed-cleaned.sql\n- Restart the API\n\nAll workspace data will be replaced.', variant: 'destructive', confirmLabel: 'Refresh DB' })) {
                        refreshDbMutation.mutate();
                        setContainerMenu(null);
                      }
                    }}
                    disabled={refreshDbMutation.isPending}
                    className="w-full text-left px-3 py-1.5 text-xs text-amber-400 hover:bg-white/5 flex items-center gap-2 disabled:opacity-50"
                  >
                    <Database className="w-3 h-3" />{refreshDbMutation.isPending ? 'Refreshing...' : 'Refresh DB'}
                  </button>
                </>
              )}
            </>
          ) : (
            <button onClick={() => containerControlMutation.mutate({ containerName: containerMenu.containerName, action: 'start' })} disabled={containerControlMutation.isPending} className="w-full text-left px-3 py-1.5 text-xs text-green-400 hover:bg-white/5 flex items-center gap-2 disabled:opacity-50">
              <Play className="w-3 h-3" />Start
            </button>
          )}
        </div>
      )}

      {/* Beads dialog */}
      {showBeads && <BeadsDialog issueId={issueId} isOpen={showBeads} onClose={() => setShowBeads(false)} />}

      {/* PRD Modal */}
      {showPrdModal && prdContent && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50" onClick={() => setShowPrdModal(false)}>
          <div className="border rounded-lg shadow-xl w-[700px] max-h-[80vh] flex flex-col" style={{ backgroundColor: '#161b26', borderColor: '#232f48' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: '#232f48' }}>
              <h2 className="text-sm font-medium text-white">PRD — {issueId.toUpperCase()}</h2>
              <button onClick={() => setShowPrdModal(false)} style={{ color: textSecondary }} className="hover:text-white">
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
