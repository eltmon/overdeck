import { useState, useRef, useEffect, useCallback } from 'react';
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
  Send,
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
  Cpu,
  FolderPlus,
  User,
  Tag,
  Calendar,
  FileText,
  ListTodo,
  RotateCcw,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { Agent, Issue } from '../types';
import { BeadsDialog } from './BeadsDialog';
import { useConfirm } from './DialogProvider';

interface ContainerStatus {
  running: boolean;
  uptime: string | null;
  status?: string; // 'running' | 'exited(N)' | 'created' | undefined (not found)
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
  reviewNotes?: string;
  testNotes?: string;
  updatedAt: string;
  readyForMerge: boolean;
  autoRequeueCount?: number;
  history?: StatusHistoryEntry[];
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

// Clipboard helper that works without HTTPS
function copyToClipboard(text: string): boolean {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text);
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

// Cost data types
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

// Cost formatting helpers
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
  if (fullModel.includes('sonnet-4-5') || fullModel.includes('sonnet-4.5')) return 'Sonnet 4.5';
  if (fullModel.includes('sonnet-4') || fullModel.includes('sonnet')) return 'Sonnet 4';
  if (fullModel.includes('haiku-4-5') || fullModel.includes('haiku-4.5')) return 'Haiku 4.5';
  if (fullModel.includes('haiku-3')) return 'Haiku 3';
  if (fullModel.includes('haiku')) return 'Haiku 4.5';
  return fullModel;
}

interface WorkspacePanelProps {
  agent?: Agent;
  issueId: string;
  issueUrl?: string;
  issue?: Issue;
  onClose: () => void;
}

async function fetchOutput(agentId: string): Promise<string> {
  const res = await fetch(`/api/agents/${agentId}/output?lines=200`);
  if (!res.ok) throw new Error('Failed to fetch output');
  const data = await res.json();
  return data.output || '';
}

async function fetchPrd(issueId: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/mission-control/planning/${issueId}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.prd || null;
  } catch {
    return null;
  }
}

function StatusHistory({ history }: { history: StatusHistoryEntry[] }) {
  const [expanded, setExpanded] = useState(false);
  // Show most recent first
  const sorted = [...history].reverse();
  return (
    <div className="mt-2 border-t border-border/30 pt-1.5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-[10px] text-content-muted hover:text-content-subtle"
      >
        <span>{expanded ? '▾' : '▸'}</span>
        <span>History ({history.length})</span>
      </button>
      {expanded && (
        <div className="mt-1 space-y-0.5">
          {sorted.map((entry, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[10px]">
              <span className="text-content-muted w-12 shrink-0">{formatRelativeTime(entry.timestamp)}</span>
              <span className={
                entry.type === 'review' ? 'text-blue-400' :
                entry.type === 'test' ? 'text-purple-400' :
                'text-green-400'
              }>{entry.type}</span>
              <span className={
                entry.status === 'passed' ? 'text-green-400' :
                entry.status === 'failed' || entry.status === 'blocked' ? 'text-red-400' :
                ['reviewing', 'testing', 'merging'].includes(entry.status) ? 'text-yellow-400' :
                'text-content-muted'
              }>{entry.status}</span>
              {entry.notes && (
                <span className="text-content-muted truncate" title={entry.notes}>
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

export function WorkspacePanel({ agent, issueId, issueUrl, issue, onClose }: WorkspacePanelProps) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [message, setMessage] = useState('');
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'logs' | 'status'>('logs');
  const terminalRef = useRef<HTMLPreElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const tmuxCommand = agent ? `tmux attach -t ${agent.id}` : '';
  const [showPrdModal, setShowPrdModal] = useState(false);
  const [showBeads, setShowBeads] = useState(false);

  const { data: output, refetch } = useQuery({
    queryKey: ['agent-output', agent?.id],
    queryFn: () => fetchOutput(agent!.id),
    refetchInterval: agent?.status === 'stopped' ? false : 1000,
    enabled: !!agent,
  });

  // Track workspace creation and container starting in-flight states
  const [workspaceCreating, setWorkspaceCreating] = useState(false);
  const [containersStarting, setContainersStarting] = useState(false);
  const [containersStartedAt, setContainersStartedAt] = useState(0);

  // Fetch workspace info for container status
  const { data: workspace } = useQuery<WorkspaceInfo>({
    queryKey: ['workspace', issueId],
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${issueId}`);
      if (!res.ok) throw new Error('Failed to fetch workspace info');
      const data = await res.json();
      // Clear creating state once workspace exists
      if (data.exists && workspaceCreating) setWorkspaceCreating(false);
      // Clear starting state once containers have settled (all running, or some failed after grace period)
      if (containersStarting && data.containers) {
        const statuses = Object.values(data.containers as Record<string, ContainerStatus>);
        const allRunning = statuses.every(c => c.running);
        const elapsed = Date.now() - containersStartedAt;
        const gracePeriodPassed = elapsed > 20000; // 20s grace period for containers to restart
        const anyFailed = statuses.some(c => c.status?.startsWith('exited'));
        if (allRunning || (gracePeriodPassed && anyFailed)) setContainersStarting(false);
      }
      return data;
    },
    refetchInterval: (workspaceCreating || containersStarting) ? 2000 : 5000, // Poll faster during transitions
  });

  // Fetch review status
  const { data: reviewStatus } = useQuery<ReviewStatus>({
    queryKey: ['review-status', issueId],
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${issueId}/review-status`);
      if (!res.ok) throw new Error('Failed to fetch review status');
      return res.json();
    },
    refetchInterval: 30000, // Safety net — real-time updates come via Socket.io pipeline:status
  });

  // Fetch PRD content
  const { data: prdContent } = useQuery({
    queryKey: ['prd', issueId],
    queryFn: () => fetchPrd(issueId),
    staleTime: 60000,
  });

  // Fetch cost data
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

  // Start agent (when no agent exists)
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
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['agents'] });
      }, 2000);
    },
  });

  // Create workspace (when no workspace exists)
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
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['workspace', issueId] });
      }, 5000);
      // Safety timeout: clear starting state after 90s even if containers haven't settled
      setTimeout(() => setContainersStarting(false), 90000);
    },
  });

  // Container context menu state
  const [containerMenu, setContainerMenu] = useState<{
    x: number;
    y: number;
    containerName: string;
    isRunning: boolean;
  } | null>(null);

  // Close context menu on click outside
  useEffect(() => {
    const handleClick = () => setContainerMenu(null);
    if (containerMenu) {
      document.addEventListener('click', handleClick);
      return () => document.removeEventListener('click', handleClick);
    }
  }, [containerMenu]);

  // Container control mutation
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
      // Refresh container status after a short delay
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['workspace', issueId] });
      }, 2000);
    },
  });

  const handleContainerContextMenu = (e: React.MouseEvent, containerName: string, isRunning: boolean) => {
    e.preventDefault();
    setContainerMenu({
      x: e.clientX,
      y: e.clientY,
      containerName,
      isRunning,
    });
  };

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
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['workspace', issueId] });
      }, 3000);
    },
  });

  // Start review pipeline (review-agent → test-agent)
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

  // Merge (only after review+test pass)
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

  // Dismiss pending operation error state
  const dismissPendingMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/workspaces/${issueId}/pending`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        throw new Error('Failed to dismiss');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace', issueId] });
    },
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
      if (!res.ok) {
        throw new Error(data.error || 'Sync failed');
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace', issueId] });
      queryClient.invalidateQueries({ queryKey: ['agents'] });
    },
  });

  const handleSyncMain = async () => {
    if (await confirm({ title: 'Sync Main', message: `Sync main into ${issueId}?\n\nThis will:\n- Auto-commit any uncommitted changes\n- Fetch and merge the latest main into the feature branch\n- Use the merge agent to resolve any conflicts`, confirmLabel: 'Sync' })) {
      syncMainMutation.mutate();
    }
  };

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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace', issueId] });
    },
  });
  const handleCleanWorkspace = async () => {
    if (await confirm({ title: 'Clean Workspace', message: `Clean and recreate corrupted workspace for ${issueId}?\n\nThis will:\n- Remove the corrupted workspace directory\n- Create a fresh workspace`, variant: 'destructive', confirmLabel: 'Clean & Recreate' })) {
      cleanMutation.mutate();
    }
  };

  const handleStartContainers = () => {
    startContainersMutation.mutate();
  };

  const handleContainerize = () => {
    containerizeMutation.mutate();
  };

  const handleReview = async () => {
    const isReReview = reviewStatus?.readyForMerge || reviewStatus?.reviewStatus === 'passed' || reviewStatus?.testStatus === 'passed';
    const msg = isReReview
      ? `Re-run review & test pipeline for ${issueId}?\n\nThis will reset the current status and:\n- Run strict code review (review-agent)\n- Run tests (test-agent)\n\nMERGE button will appear when both pass.`
      : `Start review & test pipeline for ${issueId}?\n\nThis will:\n- Run strict code review (review-agent)\n- Run tests (test-agent)\n\nMERGE button will appear when both pass.`;
    if (await confirm({ title: isReReview ? 'Re-run Review' : 'Start Review', message: msg, confirmLabel: isReReview ? 'Re-run' : 'Start Review' })) {
      reviewMutation.mutate();
    }
  };

  const handleMerge = async () => {
    if (await confirm({ title: 'Merge to Main', message: `Merge ${issueId} to main?\n\nReview and tests have passed. This will:\n- Merge the feature branch to main\n- Run final verification tests\n- Clean up workspace`, confirmLabel: 'Merge' })) {
      mergeMutation.mutate();
    }
  };

  const handleClose = async () => {
    if (await confirm({ title: 'Close Without Merging', message: `Close ${issueId} without merging? This will:\n- Close the issue (no merge)\n- Stop any running agent\n- Remove the workspace\n(Feature branch is preserved for history)`, variant: 'destructive', confirmLabel: 'Close' })) {
      closeMutation.mutate();
    }
  };

  const handleReopen = () => {
    const reason = prompt(
      `Reopen ${issueId} for re-work?\n\nThis will:\n- Move the issue to "In Progress"\n- Reset review/test/merge status to pending\n- Remove any queued specialist tasks\n- Append a "Reopened" section to STATE.md\n\nOptional: enter a reason (or leave blank):`,
      ''
    );
    // prompt returns null if cancelled
    if (reason === null) return;
    reopenMutation.mutate(reason || undefined);
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

  const sendMutation = useMutation({
    mutationFn: async (msg: string) => {
      if (!agent) throw new Error('No agent');
      const res = await fetch(`/api/agents/${agent.id}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg }),
      });
      if (!res.ok) throw new Error('Failed to send');
    },
    onSuccess: () => {
      setMessage('');
      setTimeout(() => refetch(), 500);
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

  const handleCopy = useCallback(() => {
    copyToClipboard(tmuxCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [tmuxCommand]);

  // Auto-scroll to bottom when new output arrives
  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'auto' });
    }
  }, [output, autoScroll]);

  // Detect if user scrolled up (disable auto-scroll)
  const handleScroll = useCallback(() => {
    if (terminalRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = terminalRef.current;
      // If scrolled near bottom (within 50px), enable auto-scroll
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 50;
      setAutoScroll(isNearBottom);
    }
  }, []);

  const handleSend = () => {
    if (message.trim()) {
      sendMutation.mutate(message.trim());
    }
  };

  const handleKill = async () => {
    if (agent && await confirm({ title: 'Kill Agent', message: `Kill agent ${agent.id}?`, variant: 'destructive', confirmLabel: 'Kill' })) {
      killMutation.mutate();
    }
  };

  // Format duration
  const startedAt = agent ? new Date(agent.startedAt) : null;
  const durationMs = startedAt ? Date.now() - startedAt.getTime() : 0;
  const durationMins = Math.floor(durationMs / 60000);
  const durationHours = Math.floor(durationMins / 60);
  const duration = durationHours > 0
    ? `${durationHours}h ${durationMins % 60}m`
    : `${durationMins}m`;

  return (
    <>
      <div className="flex h-full bg-surface-raised border-l border-divider" data-testid="workspace-panel">
        {/* Left sidebar - Workspace info */}
        <div className="w-64 border-r border-divider flex flex-col overflow-y-auto" data-testid="workspace-sidebar">
          {/* Header */}
          <div className="px-3 py-2 border-b border-divider">
            {agent ? (
              <div className="flex items-center gap-2">
                <div className="flex gap-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" style={{ animationDelay: '300ms' }} />
                </div>
                <span className="text-xs text-content-subtle">
                  {agent.status === 'stopped' ? 'Agent Stopped' : 'Agent Running'}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-content-muted" />
                <span className="text-xs text-content-subtle">No Agent</span>
              </div>
            )}
            <h2 className="font-mono text-sm text-content font-medium mt-1">
              {issueId.toUpperCase()}
            </h2>
            {issue && (
              <p className="text-xs text-content-subtle mt-1 line-clamp-2" title={issue.title}>
                {issue.title}
              </p>
            )}
        </div>

        {/* Issue metadata */}
        {issue && (
          <div className="px-3 py-2 border-b border-divider text-xs">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="px-1.5 py-0.5 bg-surface-overlay text-content rounded text-[10px]">
                {issue.status}
              </span>
              {issue.priority > 0 && (
                <span className={`text-[10px] ${
                  issue.priority === 1 ? 'text-red-400' :
                  issue.priority === 2 ? 'text-orange-400' :
                  issue.priority === 3 ? 'text-yellow-400' :
                  'text-blue-400'
                }`}>
                  {issue.priority === 1 ? 'Urgent' :
                   issue.priority === 2 ? 'High' :
                   issue.priority === 3 ? 'Medium' : 'Low'}
                </span>
              )}
              {issue.labels.slice(0, 3).map((label) => (
                <span key={label} className="px-1.5 py-0.5 bg-surface-overlay text-content-muted rounded text-[10px]">
                  {label}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Agent info - only when agent exists */}
        {agent && (
          <div className="px-3 py-2 border-b border-divider text-xs">
            <div className="text-content-muted uppercase tracking-wider mb-2">Agent</div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-content-subtle">Model</span>
                <span className="text-content">{getFriendlyModelName(agent.model)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-content-subtle">Runtime</span>
                <span className="text-content">{agent.runtime}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-content-subtle">Uptime</span>
                <span className="text-content">{duration}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-content-subtle">Session</span>
                <span className="text-content font-mono text-[10px]">{agent.id}</span>
              </div>
            </div>
          </div>
        )}

        {/* Git Status */}
        {agent?.git && (
          <div className="px-3 py-2 border-b border-divider text-xs" data-testid="git-status">
            <div className="text-content-muted uppercase tracking-wider mb-2">Git Status</div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-content">
                <GitBranch className="w-3 h-3" />
                <span className="font-mono flex-1">{agent.git.branch}</span>
                <button
                  onClick={handleSyncMain}
                  disabled={syncMainMutation.isPending}
                  title={agent.git.uncommittedFiles > 0 ? 'Will auto-commit changes before syncing' : 'Sync with main'}
                  className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] bg-surface-overlay/50 text-content-subtle rounded hover:bg-surface-overlay hover:text-content disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {syncMainMutation.isPending ? (
                    <Loader2 className="w-2.5 h-2.5 animate-spin" />
                  ) : (
                    <GitMerge className="w-2.5 h-2.5" />
                  )}
                  Sync
                </button>
              </div>
              {agent.git.uncommittedFiles > 0 && (
                <div className="text-yellow-400 text-[10px] ml-4">
                  {agent.git.uncommittedFiles} uncommitted files
                </div>
              )}
              <div className="text-content-subtle text-[10px] mt-1 truncate" title={agent.git.latestCommit}>
                {agent.git.latestCommit}
              </div>
            </div>
          </div>
        )}

        {/* Workspace path */}
        {agent?.workspace && (
          <div className="px-3 py-2 border-b border-divider text-xs">
            <div className="flex items-center gap-1.5 text-content-subtle">
              <Folder className="w-3 h-3" />
              <span className="font-mono truncate text-[10px]" title={agent.workspace}>
                {agent.workspace}
              </span>
            </div>
          </div>
        )}

        {/* Workspace path from API - when no agent but workspace exists */}
        {!agent && workspace?.exists && workspace.path && (
          <div className="px-3 py-2 border-b border-divider text-xs">
            <div className="text-content-muted uppercase tracking-wider mb-2">Workspace</div>
            <div className="flex items-center gap-1.5 text-content-subtle">
              <Folder className="w-3 h-3" />
              <span className="font-mono truncate text-[10px]" title={workspace.path}>
                {workspace.path}
              </span>
            </div>
            {workspace.location && (
              <span
                className={`mt-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded ${
                  workspace.location === 'remote'
                    ? 'bg-cyan-900/50 text-cyan-400'
                    : 'bg-surface-overlay text-content-subtle'
                }`}
              >
                {workspace.location === 'remote' ? <Cloud className="w-3 h-3" /> : <Monitor className="w-3 h-3" />}
                {workspace.location}
              </span>
            )}
          </div>
        )}

        {/* Links */}
        <div className="px-3 py-2 border-b border-divider text-xs">
          <div className="text-content-muted uppercase tracking-wider mb-2">Links</div>
          <div className="space-y-1.5">
            {issueUrl && (
              <a
                href={issueUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-blue-400 hover:text-blue-300"
              >
                <ExternalLink className="w-3 h-3" />
                <span>{issueId.toUpperCase().startsWith('PAN-') ? 'GitHub Issue' : 'Linear Issue'}</span>
              </a>
            )}
            {prdContent && (
              <button
                onClick={() => setShowPrdModal(true)}
                className="flex items-center gap-1.5 text-blue-400 hover:text-blue-300"
              >
                <FileText className="w-3 h-3" />
                <span>PRD</span>
              </button>
            )}
            <button
              onClick={() => setShowBeads(true)}
              className="flex items-center gap-1.5 text-blue-400 hover:text-blue-300"
            >
              <ListTodo className="w-3 h-3" />
              <span>Beads Tasks</span>
            </button>
          </div>
        </div>

        {/* Cost Summary */}
        {costData && (costData.totalCost > 0 || (costData.sessions?.length ?? 0) > 0) && (
          <div className="px-3 py-2 border-b border-divider text-xs">
            <div className="text-content-muted uppercase tracking-wider mb-2">Cost</div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-content-subtle">Total</span>
                <span className="text-green-400 font-medium">{formatCost(costData.totalCost)}</span>
              </div>
              {costData.totalTokens > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-content-subtle">Tokens</span>
                  <span className="text-content">{formatTokens(costData.totalTokens)}</span>
                </div>
              )}
              {Object.keys(costData.byModel).length > 0 && (
                <div className="border-t border-divider pt-1.5 mt-1.5">
                  {Object.entries(costData.byModel)
                    .sort(([, a], [, b]) => b.cost - a.cost)
                    .map(([model, info]) => (
                      <div key={model} className="flex items-center justify-between text-[10px]">
                        <span className="text-content-subtle truncate" title={model}>
                          {getFriendlyModelName(model)}
                        </span>
                        <span className="text-content-body">{formatCost(info.cost)}</span>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Corrupted Workspace Warning */}
        {workspace?.corrupted && (
          <div className="px-3 py-2 border-b border-divider">
            <div className="flex items-center gap-2 text-yellow-500 mb-2">
              <AlertTriangle className="w-4 h-4" />
              <span className="text-xs font-medium">Workspace Corrupted</span>
              {/* Location badge - local vs remote */}
              {workspace.location && (
                <span
                  className={`flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded ${
                    workspace.location === 'remote'
                      ? 'bg-cyan-900/50 text-cyan-400'
                      : 'bg-surface-overlay text-content-subtle'
                  }`}
                  title={workspace.location === 'remote' ? 'Running on remote VM (exe.dev)' : 'Running locally'}
                >
                  {workspace.location === 'remote' ? (
                    <Cloud className="w-3 h-3" />
                  ) : (
                    <Monitor className="w-3 h-3" />
                  )}
                  {workspace.location}
                </span>
              )}
            </div>
            <p className="text-xs text-content-subtle mb-2">
              {workspace.message || 'The workspace exists but is not a valid git worktree.'}
            </p>
            <button
              onClick={handleCleanWorkspace}
              disabled={cleanMutation.isPending}
              className="flex items-center gap-1 px-2 py-1 bg-yellow-600 hover:bg-yellow-500 disabled:bg-yellow-800 text-content text-xs rounded transition-colors w-full justify-center"
            >
              {cleanMutation.isPending ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Cleaning...
                </>
              ) : (
                <>
                  <RefreshCw className="w-3 h-3" />
                  Clean &amp; Recreate
                </>
              )}
            </button>
            {cleanMutation.isError && (
              <div className="text-xs text-red-400 bg-red-900/20 px-2 py-1 rounded mt-2">
                {cleanMutation.error instanceof Error
                  ? cleanMutation.error.message
                  : 'Failed to clean workspace'}
              </div>
            )}
            {cleanMutation.isSuccess && (
              <div className="text-xs text-green-400 bg-green-900/20 px-2 py-1 rounded mt-2">
                Workspace cleaned! Recreating...
              </div>
            )}
          </div>
        )}

        {/* Service URLs */}
        {workspace?.hasDocker && (workspace?.frontendUrl || workspace?.apiUrl) && (
          <div className="px-3 py-2 border-b border-divider text-xs">
            <div className="text-content-muted uppercase tracking-wider mb-2">Services</div>
            <div className="space-y-1.5">
              {workspace.frontendUrl && (
                <a
                  href={workspace.frontendUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-blue-400 hover:text-blue-300"
                >
                  <Globe className="w-3 h-3" />
                  <span>Frontend</span>
                </a>
              )}
              {workspace.apiUrl && (
                <a
                  href={workspace.apiUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-blue-400 hover:text-blue-300"
                >
                  <Globe className="w-3 h-3" />
                  <span>API</span>
                </a>
              )}
            </div>
          </div>
        )}

        {/* Container Controls - Start containers button when ANY container is stopped */}
        {workspace?.hasDocker && workspace.containers && Object.values(workspace.containers).some(c => !c.running) && (
          <div className="px-3 py-2 border-b border-divider">
            <div className="flex items-center gap-2">
              <span className="text-xs text-yellow-500">
                {containersStarting ? 'Starting containers...' : 'Some containers stopped'}
              </span>
              <button
                onClick={handleStartContainers}
                disabled={startContainersMutation.isPending || containersStarting}
                className="flex items-center gap-1 px-2 py-1 bg-green-600 hover:bg-green-500 disabled:bg-green-800 text-content text-xs rounded transition-colors"
              >
                {(startContainersMutation.isPending || containersStarting) ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Starting...
                  </>
                ) : (
                  <>
                    <Play className="w-3 h-3" />
                    Start Containers
                  </>
                )}
              </button>
            </div>
            {startContainersMutation.isError && (
              <div className="text-xs text-red-400 bg-red-900/20 px-2 py-1 rounded mt-2">
                {startContainersMutation.error instanceof Error
                  ? startContainersMutation.error.message
                  : 'Failed to start containers'}
              </div>
            )}
          </div>
        )}

        {/* Git-only workspace - offer containerize option or show status */}
        {workspace?.exists && !workspace.hasDocker && (
          <div className="px-3 py-2 border-b border-divider">
            <div className="text-content-muted uppercase tracking-wider text-xs mb-2">Containers</div>
            {workspace.canContainerize ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-content-muted">Git-only workspace</span>
                  <button
                    onClick={handleContainerize}
                    disabled={containerizeMutation.isPending}
                    className="flex items-center gap-1 px-2 py-1 bg-purple-600 hover:bg-purple-500 disabled:bg-purple-800 text-content text-xs rounded transition-colors"
                  >
                    {containerizeMutation.isPending ? (
                      <>
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Setting up...
                      </>
                    ) : (
                      <>
                        <Box className="w-3 h-3" />
                        Containerize
                      </>
                    )}
                  </button>
                </div>
                {containerizeMutation.isError && (
                  <div className="text-xs text-red-400 bg-red-900/20 px-2 py-1 rounded">
                    {containerizeMutation.error instanceof Error
                      ? containerizeMutation.error.message
                      : 'Failed to containerize workspace'}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-xs text-content-subtle bg-surface-raised px-2 py-2 rounded">
                <span className="text-content-muted">No Docker support.</span> This workspace doesn't have container infrastructure set up yet.
              </div>
            )}
          </div>
        )}

        {/* Container Status - show when containers exist */}
        {workspace?.containers && Object.keys(workspace.containers).length > 0 && (
          <div className="px-3 py-2 border-b border-divider text-xs">
            <div className="text-content-muted uppercase tracking-wider mb-2">
              Containers
              <span className="text-gray-600 font-normal ml-2">(right-click for options)</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(workspace.containers).map(([name, status]) => {
                const isStarting = (startContainersMutation.isPending || containersStarting) && !status.running;
                const isControlling = containerControlMutation.isPending && containerMenu?.containerName === name;
                const isFailed = status.status?.startsWith('exited') && !status.running;
                return (
                  <span
                    key={name}
                    onContextMenu={(e) => handleContainerContextMenu(e, name, status.running)}
                    className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] cursor-context-menu select-none ${
                      status.running
                        ? 'bg-green-900/30 text-green-400 hover:bg-green-900/50'
                        : isFailed
                        ? 'bg-red-900/30 text-red-400 hover:bg-red-900/50'
                        : isStarting || isControlling
                        ? 'bg-yellow-900/30 text-yellow-400 animate-pulse'
                        : 'bg-surface-overlay text-content-muted hover:bg-surface-emphasis'
                    }`}
                    title={isFailed ? `Container ${status.status} — right-click for options` : 'Right-click for start/stop/restart options'}
                  >
                    {isStarting || isControlling ? (
                      <Loader2 className="w-2.5 h-2.5 animate-spin" />
                    ) : name === 'postgres' || name === 'redis' ? (
                      <Database className="w-2.5 h-2.5" />
                    ) : (
                      <Box className="w-2.5 h-2.5" />
                    )}
                    {name}
                    {status.running && status.uptime && (
                      <span className="text-content-subtle ml-1">{status.uptime}</span>
                    )}
                    {isFailed && (
                      <span className="text-red-500 ml-1">{status.status}</span>
                    )}
                    {(isStarting || isControlling) && (
                      <span className="text-yellow-500 ml-1">...</span>
                    )}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {/* Tmux attach command - only with agent */}
        {agent && (
          <div className="px-3 py-2 border-b border-divider text-xs">
            <div className="text-content-muted uppercase tracking-wider mb-2">Attach Command</div>
            <div className="flex items-center gap-2">
              <div className="flex-1 flex items-center gap-1.5 px-2 py-1.5 bg-surface rounded font-mono text-[11px] text-content-body overflow-hidden">
                <Terminal className="w-3 h-3 shrink-0 text-blue-400" />
                <span className="truncate">{tmuxCommand}</span>
              </div>
              <button
                onClick={handleCopy}
                className={`p-1.5 rounded transition-colors ${
                  copied
                    ? 'bg-green-900/30 text-green-400'
                    : 'bg-surface-overlay hover:bg-surface-emphasis text-content-subtle hover:text-content'
                }`}
                title="Copy to clipboard"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="px-3 py-2 border-b border-divider" data-testid="workspace-actions">
          <div className="text-xs text-content-muted uppercase tracking-wider mb-2">Actions</div>
          {/* Server-side pending operation status */}
          {workspace?.pendingOperation?.type === 'approve' && workspace.pendingOperation.status === 'running' && (
            <div className="flex items-center gap-2 text-xs text-blue-400 bg-blue-900/20 px-2 py-1.5 rounded mb-2">
              <Loader2 className="w-3 h-3 animate-spin" />
              <span>Merging in progress... (survives tab switches)</span>
            </div>
          )}
          {workspace?.pendingOperation?.status === 'failed' && (
            <div className="text-xs text-red-400 bg-red-900/20 px-2 py-1.5 rounded mb-2">
              <div className="flex items-center justify-between">
                <span className="font-medium">Operation failed</span>
                <button
                  onClick={() => dismissPendingMutation.mutate()}
                  className="text-content-subtle hover:text-content"
                  title="Dismiss"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
              <div className="mt-1 text-content-subtle whitespace-pre-wrap">
                {workspace.pendingOperation.error}
              </div>
            </div>
          )}
          {/* Review Status Display */}
          {reviewStatus && (reviewStatus.reviewStatus !== 'pending' || reviewStatus.testStatus !== 'pending') && (
            <div className={`mb-2 p-2 rounded text-xs ${
              reviewStatus.updatedAt && isStale(reviewStatus.updatedAt)
                ? 'bg-amber-900/20 border border-amber-700/30'
                : 'bg-surface/50'
            }`}>
              {reviewStatus.updatedAt && isStale(reviewStatus.updatedAt) && (
                <div className="flex items-center gap-1 mb-1.5 text-amber-400 text-[10px]">
                  <AlertTriangle className="w-3 h-3" />
                  <span>Status may be stale ({formatRelativeTime(reviewStatus.updatedAt)})</span>
                </div>
              )}
              <div className="flex items-center gap-2 mb-1">
                <span className="text-content-subtle">Review:</span>
                <span className={
                  reviewStatus.reviewStatus === 'passed' ? 'text-green-400' :
                  reviewStatus.reviewStatus === 'blocked' || reviewStatus.reviewStatus === 'failed' ? 'text-red-400' :
                  reviewStatus.reviewStatus === 'reviewing' ? 'text-yellow-400' :
                  'text-content-muted'
                }>
                  {reviewStatus.reviewStatus === 'passed' ? '✓ Passed' :
                   reviewStatus.reviewStatus === 'blocked' ? '✗ Blocked' :
                   reviewStatus.reviewStatus === 'failed' ? '✗ Failed' :
                   reviewStatus.reviewStatus === 'reviewing' ? '⟳ Reviewing...' :
                   'Pending'}
                </span>
                {reviewStatus.updatedAt && reviewStatus.reviewStatus !== 'pending' && !isStale(reviewStatus.updatedAt) && (
                  <span className="text-content-muted text-[10px]">{formatRelativeTime(reviewStatus.updatedAt)}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-content-subtle">Tests:</span>
                <span className={
                  reviewStatus.testStatus === 'passed' ? 'text-green-400' :
                  reviewStatus.testStatus === 'failed' ? 'text-red-400' :
                  reviewStatus.testStatus === 'testing' ? 'text-yellow-400' :
                  'text-content-muted'
                }>
                  {reviewStatus.testStatus === 'passed' ? '✓ Passed' :
                   reviewStatus.testStatus === 'failed' ? '✗ Failed' :
                   reviewStatus.testStatus === 'testing' ? '⟳ Testing...' :
                   reviewStatus.testStatus === 'skipped' ? '⊘ Skipped' :
                   'Pending'}
                </span>
                {reviewStatus.updatedAt && reviewStatus.testStatus !== 'pending' && !isStale(reviewStatus.updatedAt) && (
                  <span className="text-content-muted text-[10px]">{formatRelativeTime(reviewStatus.updatedAt)}</span>
                )}
              </div>
              {/* Review cycle count */}
              {(reviewStatus.autoRequeueCount ?? 0) > 0 && (
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-content-subtle">Review cycles:</span>
                  <span className={(reviewStatus.autoRequeueCount ?? 0) >= 3 ? 'text-red-400 font-medium' : 'text-content-body'}>
                    {reviewStatus.autoRequeueCount}/3
                  </span>
                  {(reviewStatus.autoRequeueCount ?? 0) >= 3 && (
                    <span className="flex items-center gap-1 text-[10px] text-amber-400 bg-amber-900/20 px-1.5 py-0.5 rounded">
                      <AlertTriangle className="w-2.5 h-2.5" />
                      Human intervention needed
                    </span>
                  )}
                </div>
              )}
              {reviewStatus.reviewNotes && (
                <div className="mt-1 text-content-subtle text-xs">{reviewStatus.reviewNotes}</div>
              )}
              {reviewStatus.testNotes && (
                <div className="mt-1 text-content-subtle text-xs">{reviewStatus.testNotes}</div>
              )}
              {/* Status History */}
              {reviewStatus.history && reviewStatus.history.length > 0 && (
                <StatusHistory history={reviewStatus.history} />
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-1.5">
            {/* MERGE button - only shows when review+test passed AND not already merged */}
            {reviewStatus?.readyForMerge && reviewStatus?.mergeStatus !== 'merged' && (
              <button
                data-testid="merge-btn"
                onClick={handleMerge}
                disabled={mergeMutation.isPending || reviewStatus?.mergeStatus === 'merging'}
                className="flex items-center gap-1 px-2 py-1 text-xs bg-green-600 text-content rounded hover:bg-green-500 disabled:opacity-50 font-medium"
              >
                {(mergeMutation.isPending || reviewStatus?.mergeStatus === 'merging') ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <CheckCircle className="w-3 h-3" />
                )}
                {reviewStatus?.mergeStatus === 'merging' ? 'MERGING...' : 'MERGE'}
              </button>
            )}
            {/* Show merged badge when already merged */}
            {reviewStatus?.mergeStatus === 'merged' && (
              <span className="flex items-center gap-1 px-2 py-1 text-xs bg-green-900/30 text-green-400 rounded font-medium">
                <CheckCircle className="w-3 h-3" />
                MERGED
              </span>
            )}

            {/* Sync with Main button */}
            <button
              data-testid="sync-with-main-btn"
              onClick={handleSyncMain}
              disabled={syncMainMutation.isPending}
              title={(agent?.git?.uncommittedFiles ?? 0) > 0 ? 'Will auto-commit changes before syncing with main' : 'Sync latest main into this workspace'}
              className="flex items-center gap-1 px-2 py-1 text-xs bg-surface-overlay/50 text-content-subtle rounded hover:bg-surface-overlay hover:text-content disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {syncMainMutation.isPending ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <GitMerge className="w-3 h-3" />
              )}
              {syncMainMutation.isPending ? 'Syncing...' : 'Sync with Main'}
            </button>

            {/* Review & Test button - available anytime to (re-)run the cycle */}
            <button
              data-testid="review-test-btn"
              onClick={handleReview}
              disabled={reviewMutation.isPending || reviewStatus?.reviewStatus === 'reviewing' || reviewStatus?.testStatus === 'testing'}
              className={`flex items-center gap-1 px-2 py-1 text-xs rounded disabled:opacity-50 ${
                reviewStatus?.readyForMerge
                  ? 'bg-surface-overlay/50 text-content-body hover:bg-surface-overlay'
                  : 'bg-blue-900/30 text-blue-400 hover:bg-blue-900/50'
              }`}
            >
              {(reviewMutation.isPending || reviewStatus?.reviewStatus === 'reviewing' || reviewStatus?.testStatus === 'testing') ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <RefreshCw className="w-3 h-3" />
              )}
              {reviewStatus?.readyForMerge ? 'Re-Review' : 'Review & Test'}
            </button>

            {agent && agent.status !== 'stopped' && (
              <button
                onClick={handleKill}
                disabled={killMutation.isPending}
                className="flex items-center gap-1 px-2 py-1 text-xs bg-red-900/30 text-red-400 rounded hover:bg-red-900/50"
              >
                <Square className="w-3 h-3" />
                Stop Agent
              </button>
            )}
            <button
              onClick={handleClose}
              disabled={closeMutation.isPending}
              className="flex items-center gap-1 px-2 py-1 text-xs bg-orange-900/30 text-orange-400 rounded hover:bg-orange-900/50 disabled:opacity-50"
            >
              {closeMutation.isPending ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <XCircle className="w-3 h-3" />
              )}
              Close (No Merge)
            </button>

            {/* Reopen button - available when any specialist cycle has run (passed, failed, or merged) */}
            {reviewStatus && (reviewStatus.reviewStatus === 'passed' || reviewStatus.reviewStatus === 'failed' || reviewStatus.reviewStatus === 'blocked' || reviewStatus.testStatus === 'passed' || reviewStatus.testStatus === 'failed' || reviewStatus.mergeStatus === 'merged') && (
              <button
                data-testid="reopen-btn"
                onClick={handleReopen}
                disabled={reopenMutation.isPending}
                className="flex items-center gap-1 px-2 py-1 text-xs bg-purple-900/30 text-purple-400 rounded hover:bg-purple-900/50 disabled:opacity-50"
              >
                {reopenMutation.isPending ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <RefreshCw className="w-3 h-3" />
                )}
                {reopenMutation.isPending ? 'Reopening...' : 'Reopen'}
              </button>
            )}

            {/* Reset Review Cycles - available when any specialist has run */}
            {reviewStatus && (
              reviewStatus.reviewStatus !== 'pending' ||
              reviewStatus.testStatus !== 'pending'
            ) && (
              <button
                onClick={handleResetReview}
                disabled={resetReviewMutation.isPending}
                className="flex items-center gap-1 px-2 py-1 text-xs bg-amber-900/30 text-amber-400 rounded hover:bg-amber-900/50 disabled:opacity-50"
              >
                {resetReviewMutation.isPending ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <RotateCcw className="w-3 h-3" />
                )}
                {resetReviewMutation.isPending ? 'Resetting...' : 'Reset Reviews'}
              </button>
            )}

            {/* Start Agent / Create Workspace - when no agent or agent is stopped */}
            {(!agent || agent.status === 'stopped') && (
              <>
                <button
                  onClick={() => startAgentMutation.mutate()}
                  disabled={startAgentMutation.isPending || startAgentMutation.isSuccess}
                  className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-600 text-content rounded hover:bg-blue-500 disabled:opacity-50 font-medium"
                >
                  {startAgentMutation.isPending ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : startAgentMutation.isSuccess ? (
                    <Check className="w-3 h-3" />
                  ) : (
                    <Play className="w-3 h-3" />
                  )}
                  {startAgentMutation.isPending ? 'Starting...' : startAgentMutation.isSuccess ? 'Started!' : 'Start Agent'}
                </button>
                {!workspace?.exists && (
                  <button
                    onClick={() => createWorkspaceMutation.mutate()}
                    disabled={createWorkspaceMutation.isPending || createWorkspaceMutation.isSuccess}
                    className="flex items-center gap-1 px-2 py-1 text-xs bg-surface-overlay text-content rounded hover:bg-surface-emphasis disabled:opacity-50 border border-divider-strong"
                  >
                    {(createWorkspaceMutation.isPending || createWorkspaceMutation.isSuccess) ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <FolderPlus className="w-3 h-3" />
                    )}
                    {createWorkspaceMutation.isPending ? 'Creating...' : createWorkspaceMutation.isSuccess ? 'Setting up...' : 'Create Workspace'}
                  </button>
                )}
              </>
            )}
          </div>
          {reviewMutation.isError && (
            <div className="text-xs text-red-400 bg-red-900/20 px-2 py-1 rounded mt-2">
              {reviewMutation.error instanceof Error
                ? reviewMutation.error.message
                : 'Failed to start review'}
            </div>
          )}
          {mergeMutation.isError && (
            <div className="text-xs text-red-400 bg-red-900/20 px-2 py-1 rounded mt-2">
              {mergeMutation.error instanceof Error
                ? mergeMutation.error.message
                : 'Failed to merge'}
            </div>
          )}
          {closeMutation.isError && (
            <div className="text-xs text-red-400 bg-red-900/20 px-2 py-1 rounded mt-2">
              {closeMutation.error instanceof Error
                ? closeMutation.error.message
                : 'Failed to close'}
            </div>
          )}
          {syncMainMutation.isError && (
            <div className="text-xs text-red-400 bg-red-900/20 px-2 py-1 rounded mt-2">
              {syncMainMutation.error instanceof Error
                ? syncMainMutation.error.message
                : 'Sync with main failed'}
            </div>
          )}
          {syncMainMutation.isSuccess && syncMainMutation.data && (
            <div className="text-xs text-green-400 bg-green-900/20 px-2 py-1 rounded mt-2">
              {syncMainMutation.data.alreadyUpToDate
                ? 'Already up to date with main'
                : `Synced ${syncMainMutation.data.commitCount ?? 0} commit(s) from main`}
            </div>
          )}
        </div>

        {/* Spacer */}
        <div className="flex-1" />
      </div>

      {/* Right side - Content */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
        {agent ? (
          <>
            {/* Tabs header - with agent */}
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-divider">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setActiveTab('logs')}
                  className={`px-2 py-1 text-xs rounded transition-colors ${
                    activeTab === 'logs'
                      ? 'bg-surface-overlay text-content'
                      : 'text-content-subtle hover:text-content'
                  }`}
                >
                  Logs
                </button>
                <button
                  onClick={() => setActiveTab('status')}
                  className={`px-2 py-1 text-xs rounded transition-colors ${
                    activeTab === 'status'
                      ? 'bg-surface-overlay text-content'
                      : 'text-content-subtle hover:text-content'
                  }`}
                >
                  Status
                </button>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => refetch()}
                  className="p-1 text-content-subtle hover:text-content"
                  title="Refresh"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
                <button onClick={onClose} className="p-1 text-content-subtle hover:text-content">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Agent content */}
            {activeTab === 'logs' ? (
              <>
                <pre
                  ref={terminalRef}
                  onScroll={handleScroll}
                  className="flex-1 min-h-0 overflow-auto p-3 bg-surface text-content font-mono text-xs leading-relaxed m-0 whitespace-pre"
                >
                  {output || (agent.status === 'stopped' ? 'No saved output available.' : 'Connecting to agent...')}
                  <div ref={bottomRef} />
                </pre>

                {/* Input — hidden for stopped agents */}
                {agent.status !== 'stopped' && (
                  <div className="p-2 border-t border-divider bg-surface-raised">
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                        placeholder="Send message to agent..."
                        className="flex-1 px-3 py-2 bg-surface-overlay border border-divider-strong rounded text-sm text-content placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                      <button
                        onClick={handleSend}
                        disabled={!message.trim() || sendMutation.isPending}
                        className="px-3 py-2 bg-blue-600 text-content rounded text-sm font-medium hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                      >
                        <Send className="w-4 h-4" />
                        Send
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="flex-1 min-h-0 overflow-y-auto p-4 bg-surface">
                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-medium text-content mb-2">Agent Summary</h3>
                    <div className="text-xs text-content-body space-y-1">
                      <p><strong>Issue:</strong> {agent.issueId}</p>
                      <p><strong>Session:</strong> <span className="font-mono text-[10px]">{agent.id}</span></p>
                      <p><strong>Model:</strong> {getFriendlyModelName(agent.model)}</p>
                      <p><strong>Runtime:</strong> {agent.runtime}</p>
                      <p><strong>Started:</strong> {startedAt?.toLocaleString()}</p>
                      <p><strong>Uptime:</strong> {duration}</p>
                    </div>
                  </div>

                  {agent.workspace && (
                    <div>
                      <h3 className="text-sm font-medium text-content mb-2">Workspace</h3>
                      <div className="text-xs text-content-body space-y-1">
                        <p className="font-mono text-[10px] break-all">{agent.workspace}</p>
                      </div>
                    </div>
                  )}

                  {agent.git && (
                    <div>
                      <h3 className="text-sm font-medium text-content mb-2">Git Status</h3>
                      <div className="text-xs text-content-body space-y-1">
                        <p><strong>Branch:</strong> <span className="font-mono">{agent.git.branch}</span></p>
                        <p><strong>Uncommitted:</strong> {agent.git.uncommittedFiles} files</p>
                        <p><strong>Latest:</strong> {agent.git.latestCommit}</p>
                      </div>
                    </div>
                  )}

                  <div>
                    <h3 className="text-sm font-medium text-content mb-2">Health</h3>
                    <div className="text-xs text-content-body space-y-1">
                      <p><strong>Status:</strong> <span className="text-green-400">{agent.status}</span></p>
                      <p><strong>Consecutive Failures:</strong> {agent.consecutiveFailures}</p>
                      <p><strong>Total Restarts:</strong> {agent.killCount}</p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            {/* Header bar - no agent view */}
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-divider">
              <span className="text-xs text-content-subtle">Issue Details</span>
              <button onClick={onClose} className="p-1 text-content-subtle hover:text-content">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* No-agent content: issue details */}
            <div className="flex-1 min-h-0 overflow-y-auto p-4 bg-surface">
              {/* Title */}
              {issue && (
                <h2 className="text-lg font-medium text-content mb-4">{issue.title}</h2>
              )}

              {/* Meta info */}
              {issue && (
                <div className="space-y-3 mb-6">
                  {issue.assignee && (
                    <div className="flex items-center gap-2 text-sm">
                      <User className="w-4 h-4 text-content-subtle" />
                      <span className="text-content-body">{issue.assignee.name}</span>
                      {issue.assignee.email && (
                        <span className="text-content-muted text-xs">{issue.assignee.email}</span>
                      )}
                    </div>
                  )}

                  {issue.labels.length > 0 && (
                    <div className="flex items-center gap-2 text-sm flex-wrap">
                      <Tag className="w-4 h-4 text-content-subtle shrink-0" />
                      {issue.labels.map((label) => (
                        <span
                          key={label}
                          className="px-2 py-0.5 bg-surface-overlay text-content-body text-xs rounded"
                        >
                          {label}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center gap-2 text-sm text-content-subtle">
                    <Calendar className="w-4 h-4" />
                    <span>Updated {new Date(issue.updatedAt).toLocaleDateString()}</span>
                  </div>
                </div>
              )}

              {/* Description */}
              {issue?.description && (
                <div className="mb-6">
                  <h3 className="text-sm font-medium text-content-subtle mb-2">Description</h3>
                  <div className="text-sm text-content-body bg-surface-raised rounded p-3 max-h-64 overflow-y-auto prose prose-sm prose-invert prose-p:my-2 prose-headings:my-2 prose-ul:my-1 prose-li:my-0">
                    <ReactMarkdown>{issue.description}</ReactMarkdown>
                  </div>
                </div>
              )}

              {/* Cost Summary - full version in main content */}
              {costData && (costData.totalCost > 0 || (costData.sessions?.length ?? 0) > 0) && (
                <div className="mb-6">
                  <h3 className="text-sm font-medium text-content-subtle mb-2 flex items-center gap-2">
                    <DollarSign className="w-4 h-4" />
                    Cost Summary
                  </h3>
                  <div className="bg-surface-raised rounded p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-content-subtle">Total Cost</span>
                      <span className="text-xl font-semibold text-green-400">
                        {formatCost(costData.totalCost)}
                      </span>
                    </div>
                    {costData.totalTokens > 0 && (
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-content-muted flex items-center gap-1">
                          <Cpu className="w-3 h-3" />
                          Total Tokens
                        </span>
                        <span className="text-content-body">{formatTokens(costData.totalTokens)}</span>
                      </div>
                    )}
                    {Object.keys(costData.byModel).length > 0 && (
                      <div className="border-t border-divider pt-2">
                        <p className="text-xs text-content-muted uppercase tracking-wider mb-2">By Model</p>
                        <div className="space-y-1">
                          {Object.entries(costData.byModel)
                            .sort(([, a], [, b]) => b.cost - a.cost)
                            .map(([model, modelInfo]) => (
                              <div key={model} className="flex items-center justify-between text-sm">
                                <span className="text-content-subtle truncate" title={model}>
                                  {getFriendlyModelName(model)}
                                </span>
                                <div className="text-right">
                                  <span className="text-content-body">{formatCost(modelInfo.cost)}</span>
                                  <span className="text-content-muted text-xs ml-1">({formatTokens(modelInfo.tokens)})</span>
                                </div>
                              </div>
                            ))}
                        </div>
                      </div>
                    )}
                    {costData.byStage && Object.keys(costData.byStage).length > 0 && (
                      <div className="border-t border-divider pt-2">
                        <p className="text-xs text-content-muted uppercase tracking-wider mb-2">By Stage</p>
                        <div className="space-y-1">
                          {Object.entries(costData.byStage)
                            .sort(([, a], [, b]) => b.cost - a.cost)
                            .map(([stage, stageInfo]) => (
                              <div key={stage} className="flex items-center justify-between text-sm">
                                <span className="text-content-subtle truncate" title={stage}>
                                  {stage.charAt(0).toUpperCase() + stage.slice(1)}
                                </span>
                                <div className="text-right">
                                  <span className="text-content-body">{formatCost(stageInfo.cost)}</span>
                                  <span className="text-content-muted text-xs ml-1">({formatTokens(stageInfo.tokens)})</span>
                                </div>
                              </div>
                            ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Start Agent - prominent button */}
              <div className="space-y-3 mt-6">
                <button
                  onClick={() => startAgentMutation.mutate()}
                  disabled={startAgentMutation.isPending || startAgentMutation.isSuccess}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-content rounded-lg hover:bg-blue-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {startAgentMutation.isPending ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span className="font-medium">Starting...</span>
                    </>
                  ) : startAgentMutation.isSuccess ? (
                    <>
                      <Check className="w-5 h-5" />
                      <span className="font-medium">Agent Started!</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-5 h-5" />
                      <span className="font-medium">{workspace?.exists ? 'Start Agent in Workspace' : 'Start Agent'}</span>
                    </>
                  )}
                </button>

                {!workspace?.exists && (
                  <button
                    onClick={() => createWorkspaceMutation.mutate()}
                    disabled={createWorkspaceMutation.isPending || createWorkspaceMutation.isSuccess}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-surface-overlay text-content rounded-lg hover:bg-surface-emphasis transition-colors border border-divider-strong disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {(createWorkspaceMutation.isPending || createWorkspaceMutation.isSuccess) ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        <span className="font-medium">
                          {createWorkspaceMutation.isPending ? 'Creating workspace...' : 'Setting up git worktree & skills...'}
                        </span>
                      </>
                    ) : (
                      <>
                        <FolderPlus className="w-5 h-5" />
                        <span className="font-medium">Create Workspace Only</span>
                      </>
                    )}
                  </button>
                )}

                {startAgentMutation.isError && (
                  <p className="text-red-400 text-xs">Failed to start agent. Check server logs.</p>
                )}
                {createWorkspaceMutation.isError && (
                  <p className="text-red-400 text-xs">Failed to create workspace. Check server logs.</p>
                )}
              </div>

              <div className="text-xs text-content-muted mt-3 space-y-1">
                <p>
                  <strong>Start Agent:</strong> {workspace?.exists ? 'Starts autonomous agent in existing workspace' : 'Creates workspace + starts autonomous agent'}
                </p>
                {!workspace?.exists && (
                  <p>
                    <strong>Create Workspace:</strong> Creates git worktree for manual work
                  </p>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>

    {/* Container Context Menu */}
    {containerMenu && (
      <div
        className="fixed z-50 bg-surface-raised border border-divider-strong rounded shadow-lg py-1 min-w-[140px]"
        style={{ left: containerMenu.x, top: containerMenu.y }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-3 py-1 text-xs text-content-subtle border-b border-divider mb-1">
          {containerMenu.containerName}
        </div>
        {containerMenu.isRunning ? (
          <>
            <button
              onClick={() => containerControlMutation.mutate({ containerName: containerMenu.containerName, action: 'restart' })}
              disabled={containerControlMutation.isPending}
              className="w-full text-left px-3 py-1.5 text-xs text-content hover:bg-surface-overlay flex items-center gap-2 disabled:opacity-50"
            >
              <RefreshCw className="w-3 h-3" />
              Restart
            </button>
            <button
              onClick={() => containerControlMutation.mutate({ containerName: containerMenu.containerName, action: 'stop' })}
              disabled={containerControlMutation.isPending}
              className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-surface-overlay flex items-center gap-2 disabled:opacity-50"
            >
              <Square className="w-3 h-3" />
              Stop
            </button>
            {containerMenu.containerName === 'postgres' && (
              <>
                <div className="border-t border-divider my-1" />
                <button
                  onClick={async () => {
                    if (await confirm({ title: 'Refresh Database', message: 'Drop and reload database from seed file?\n\nThis will:\n- Stop the API container\n- Drop the existing database\n- Reload from seed-cleaned.sql\n- Restart the API\n\nAll workspace data will be replaced.', variant: 'destructive', confirmLabel: 'Refresh DB' })) {
                      refreshDbMutation.mutate();
                      setContainerMenu(null);
                    }
                  }}
                  disabled={refreshDbMutation.isPending}
                  className="w-full text-left px-3 py-1.5 text-xs text-amber-400 hover:bg-surface-overlay flex items-center gap-2 disabled:opacity-50"
                >
                  <Database className="w-3 h-3" />
                  {refreshDbMutation.isPending ? 'Refreshing DB...' : 'Refresh DB'}
                </button>
              </>
            )}
          </>
        ) : (
          <button
            onClick={() => containerControlMutation.mutate({ containerName: containerMenu.containerName, action: 'start' })}
            disabled={containerControlMutation.isPending}
            className="w-full text-left px-3 py-1.5 text-xs text-green-400 hover:bg-surface-overlay flex items-center gap-2 disabled:opacity-50"
          >
            <Play className="w-3 h-3" />
            Start
          </button>
        )}
        {containerControlMutation.isError && (
          <div className="px-3 py-1 text-xs text-red-400 border-t border-divider mt-1">
            {containerControlMutation.error instanceof Error
              ? containerControlMutation.error.message
              : 'Action failed'}
          </div>
        )}
      </div>
    )}
    {/* Beads Dialog */}
    {showBeads && (
      <BeadsDialog issueId={issueId} isOpen={showBeads} onClose={() => setShowBeads(false)} />
    )}
    {/* PRD Modal */}
    {showPrdModal && prdContent && (
      <div
        className="fixed inset-0 bg-black/80 flex items-center justify-center z-50"
        onClick={() => setShowPrdModal(false)}
      >
        <div
          className="border border-divider rounded-lg shadow-xl w-[700px] max-h-[80vh] flex flex-col"
          style={{ backgroundColor: '#1a1d23' }}
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-divider">
            <h2 className="text-sm font-medium text-content">PRD — {issueId.toUpperCase()}</h2>
            <button
              onClick={() => setShowPrdModal(false)}
              className="text-content-muted hover:text-content"
            >
              <X size={18} />
            </button>
          </div>
          <div className="overflow-y-auto px-4 py-3 text-xs prose prose-invert prose-sm max-w-none">
            <ReactMarkdown>{prdContent}</ReactMarkdown>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
