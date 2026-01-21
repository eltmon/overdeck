import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  X,
  XCircle,
  GitBranch,
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
  MessageCircle,
} from 'lucide-react';
import { Agent } from '../types';
import { QuestionDialog, PendingQuestion } from './QuestionDialog';

interface ContainerStatus {
  running: boolean;
  uptime: string | null;
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

interface WorkspacePanelProps {
  agent: Agent;
  issueId: string;
  issueUrl?: string;
  onClose: () => void;
}

async function fetchOutput(agentId: string): Promise<string> {
  const res = await fetch(`/api/agents/${agentId}/output?lines=200`);
  if (!res.ok) throw new Error('Failed to fetch output');
  const data = await res.json();
  return data.output || '';
}

export function WorkspacePanel({ agent, issueId, issueUrl, onClose }: WorkspacePanelProps) {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState('');
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'logs' | 'status'>('logs');
  const terminalRef = useRef<HTMLPreElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const tmuxCommand = `tmux attach -t ${agent.id}`;

  const { data: output, refetch } = useQuery({
    queryKey: ['agent-output', agent.id],
    queryFn: () => fetchOutput(agent.id),
    refetchInterval: 1000, // Faster refresh for better tailing
  });

  // Fetch workspace info for container status
  const { data: workspace } = useQuery<WorkspaceInfo>({
    queryKey: ['workspace', issueId],
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${issueId}`);
      if (!res.ok) throw new Error('Failed to fetch workspace info');
      return res.json();
    },
    refetchInterval: 5000, // Check for container changes
  });

  // Poll for pending questions (AskUserQuestion interception - PAN-20)
  // DISABLED: Path mapping issues cause late/incorrect detection. Re-enable when fixed.
  const { data: pendingQuestionsData } = useQuery<{ pending: boolean; questions: PendingQuestion[] }>({
    queryKey: ['pending-questions', agent.id],
    queryFn: async () => {
      const res = await fetch(`/api/agents/${agent.id}/pending-questions`);
      if (!res.ok) throw new Error('Failed to fetch pending questions');
      return res.json();
    },
    refetchInterval: 3000,
    enabled: false, // DISABLED for now
  });

  const pendingQuestions = pendingQuestionsData?.questions || [];
  const [showQuestionDialog, setShowQuestionDialog] = useState(false);

  // Auto-show dialog when new questions arrive
  useEffect(() => {
    if (pendingQuestions.length > 0) {
      setShowQuestionDialog(true);
    }
  }, [pendingQuestions.length]);

  const answerMutation = useMutation({
    mutationFn: async (answers: string[]) => {
      const res = await fetch(`/api/agents/${agent.id}/answer-question`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to send answer');
      }
      return res.json();
    },
    onSuccess: () => {
      setShowQuestionDialog(false);
      // Invalidate to refresh questions state
      queryClient.invalidateQueries({ queryKey: ['pending-questions', agent.id] });
      // Refresh output to show response
      setTimeout(() => refetch(), 500);
    },
  });

  const handleAnswerQuestion = (answers: string[]) => {
    answerMutation.mutate(answers);
  };

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
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['workspace', issueId] });
      }, 5000);
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
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['workspace', issueId] });
      }, 3000);
    },
  });

  const approveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/workspaces/${issueId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to approve workspace');
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

  const handleCleanWorkspace = () => {
    if (confirm(`Clean and recreate corrupted workspace for ${issueId}?\n\nThis will:\n- Remove the corrupted workspace directory\n- Create a fresh workspace`)) {
      cleanMutation.mutate();
    }
  };

  const handleStartContainers = () => {
    startContainersMutation.mutate();
  };

  const handleContainerize = () => {
    containerizeMutation.mutate();
  };

  const handleApprove = () => {
    if (confirm(`Approve and clean up workspace for ${issueId}? This will:\n- Merge the feature branch\n- Update issue to Done\n- Remove the workspace\n- Delete the feature branch`)) {
      approveMutation.mutate();
    }
  };

  const handleClose = () => {
    if (confirm(`Close ${issueId} without merging? This will:\n- Close the issue (no merge)\n- Stop any running agent\n- Remove the workspace\n- Delete the feature branch`)) {
      closeMutation.mutate();
    }
  };

  const sendMutation = useMutation({
    mutationFn: async (msg: string) => {
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

  const handleKill = () => {
    if (confirm(`Kill agent ${agent.id}?`)) {
      killMutation.mutate();
    }
  };

  // Format duration
  const startedAt = new Date(agent.startedAt);
  const durationMs = Date.now() - startedAt.getTime();
  const durationMins = Math.floor(durationMs / 60000);
  const durationHours = Math.floor(durationMins / 60);
  const duration = durationHours > 0
    ? `${durationHours}h ${durationMins % 60}m`
    : `${durationMins}m`;

  return (
    <>
      {/* Question Dialog for AskUserQuestion interception (PAN-20) */}
      {showQuestionDialog && pendingQuestions.length > 0 && (
        <QuestionDialog
          questions={pendingQuestions}
          agentId={agent.id}
          onSubmit={handleAnswerQuestion}
          onDismiss={() => setShowQuestionDialog(false)}
          isSubmitting={answerMutation.isPending}
          error={answerMutation.error instanceof Error ? answerMutation.error.message : undefined}
        />
      )}

      <div className="flex h-full bg-gray-800 border-l border-gray-700">
        {/* Left sidebar - Workspace info */}
        <div className="w-64 border-r border-gray-700 flex flex-col overflow-y-auto">
          {/* Header */}
          <div className="px-3 py-2 border-b border-gray-700">
            <div className="flex items-center gap-2">
              {pendingQuestions.length > 0 ? (
                <>
                  <MessageCircle className="w-3.5 h-3.5 text-yellow-400 animate-pulse" />
                  <span className="text-xs text-yellow-400">Needs Input</span>
                </>
              ) : (
                <>
                  <div className="flex gap-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" style={{ animationDelay: '300ms' }} />
                  </div>
                  <span className="text-xs text-gray-400">Agent Running</span>
                </>
              )}
            </div>
            <h2 className="font-mono text-sm text-white font-medium mt-1">
              {agent.issueId}
            </h2>
        </div>

        {/* Agent info */}
        <div className="px-3 py-2 border-b border-gray-700 text-xs">
          <div className="text-gray-500 uppercase tracking-wider mb-2">Agent</div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-gray-400">Model</span>
              <span className="text-white">{agent.model}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-400">Runtime</span>
              <span className="text-white">{agent.runtime}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-400">Uptime</span>
              <span className="text-white">{duration}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-400">Session</span>
              <span className="text-white font-mono text-[10px]">{agent.id}</span>
            </div>
          </div>
        </div>

        {/* Git Status */}
        {agent.git && (
          <div className="px-3 py-2 border-b border-gray-700 text-xs">
            <div className="text-gray-500 uppercase tracking-wider mb-2">Git Status</div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-white">
                <GitBranch className="w-3 h-3" />
                <span className="font-mono">{agent.git.branch}</span>
              </div>
              {agent.git.uncommittedFiles > 0 && (
                <div className="text-yellow-400 text-[10px] ml-4">
                  {agent.git.uncommittedFiles} uncommitted files
                </div>
              )}
              <div className="text-gray-400 text-[10px] mt-1 truncate" title={agent.git.latestCommit}>
                {agent.git.latestCommit}
              </div>
            </div>
          </div>
        )}

        {/* Workspace path */}
        {agent.workspace && (
          <div className="px-3 py-2 border-b border-gray-700 text-xs">
            <div className="flex items-center gap-1.5 text-gray-400">
              <Folder className="w-3 h-3" />
              <span className="font-mono truncate text-[10px]" title={agent.workspace}>
                {agent.workspace}
              </span>
            </div>
          </div>
        )}

        {/* Links */}
        <div className="px-3 py-2 border-b border-gray-700 text-xs">
          <div className="text-gray-500 uppercase tracking-wider mb-2">Links</div>
          <div className="space-y-1.5">
            {issueUrl && (
              <a
                href={issueUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-blue-400 hover:text-blue-300"
              >
                <ExternalLink className="w-3 h-3" />
                <span>Linear Issue</span>
              </a>
            )}
          </div>
        </div>

        {/* Corrupted Workspace Warning */}
        {workspace?.corrupted && (
          <div className="px-3 py-2 border-b border-gray-700">
            <div className="flex items-center gap-2 text-yellow-500 mb-2">
              <AlertTriangle className="w-4 h-4" />
              <span className="text-xs font-medium">Workspace Corrupted</span>
            </div>
            <p className="text-xs text-gray-400 mb-2">
              {workspace.message || 'The workspace exists but is not a valid git worktree.'}
            </p>
            <button
              onClick={handleCleanWorkspace}
              disabled={cleanMutation.isPending}
              className="flex items-center gap-1 px-2 py-1 bg-yellow-600 hover:bg-yellow-500 disabled:bg-yellow-800 text-white text-xs rounded transition-colors w-full justify-center"
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
          <div className="px-3 py-2 border-b border-gray-700 text-xs">
            <div className="text-gray-500 uppercase tracking-wider mb-2">Services</div>
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

        {/* Container Controls - Start containers button when not running */}
        {workspace?.hasDocker && (!workspace.containers || !Object.values(workspace.containers).some(c => c.running)) && (
          <div className="px-3 py-2 border-b border-gray-700">
            <div className="flex items-center gap-2">
              <span className="text-xs text-yellow-500">Containers not running</span>
              <button
                onClick={handleStartContainers}
                disabled={startContainersMutation.isPending}
                className="flex items-center gap-1 px-2 py-1 bg-green-600 hover:bg-green-500 disabled:bg-green-800 text-white text-xs rounded transition-colors"
              >
                {startContainersMutation.isPending ? (
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
          <div className="px-3 py-2 border-b border-gray-700">
            <div className="text-gray-500 uppercase tracking-wider text-xs mb-2">Containers</div>
            {workspace.canContainerize ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">Git-only workspace</span>
                  <button
                    onClick={handleContainerize}
                    disabled={containerizeMutation.isPending}
                    className="flex items-center gap-1 px-2 py-1 bg-purple-600 hover:bg-purple-500 disabled:bg-purple-800 text-white text-xs rounded transition-colors"
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
              <div className="text-xs text-gray-400 bg-gray-800 px-2 py-2 rounded">
                <span className="text-gray-500">No Docker support.</span> This workspace doesn't have container infrastructure set up yet.
              </div>
            )}
          </div>
        )}

        {/* Container Status - show when containers exist */}
        {workspace?.containers && Object.keys(workspace.containers).length > 0 && (
          <div className="px-3 py-2 border-b border-gray-700 text-xs">
            <div className="text-gray-500 uppercase tracking-wider mb-2">Containers</div>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(workspace.containers).map(([name, status]) => {
                const isStarting = startContainersMutation.isPending && !status.running;
                return (
                  <span
                    key={name}
                    className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] ${
                      status.running
                        ? 'bg-green-900/30 text-green-400'
                        : isStarting
                        ? 'bg-yellow-900/30 text-yellow-400 animate-pulse'
                        : 'bg-gray-700 text-gray-500'
                    }`}
                  >
                    {isStarting ? (
                      <Loader2 className="w-2.5 h-2.5 animate-spin" />
                    ) : name === 'postgres' || name === 'redis' ? (
                      <Database className="w-2.5 h-2.5" />
                    ) : (
                      <Box className="w-2.5 h-2.5" />
                    )}
                    {name}
                    {status.running && status.uptime && (
                      <span className="text-gray-400 ml-1">{status.uptime}</span>
                    )}
                    {isStarting && (
                      <span className="text-yellow-500 ml-1">starting...</span>
                    )}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {/* Tmux attach command */}
        <div className="px-3 py-2 border-b border-gray-700 text-xs">
          <div className="text-gray-500 uppercase tracking-wider mb-2">Attach Command</div>
          <div className="flex items-center gap-2">
            <div className="flex-1 flex items-center gap-1.5 px-2 py-1.5 bg-gray-900 rounded font-mono text-[11px] text-gray-300 overflow-hidden">
              <Terminal className="w-3 h-3 shrink-0 text-blue-400" />
              <span className="truncate">{tmuxCommand}</span>
            </div>
            <button
              onClick={handleCopy}
              className={`p-1.5 rounded transition-colors ${
                copied
                  ? 'bg-green-900/30 text-green-400'
                  : 'bg-gray-700 hover:bg-gray-600 text-gray-400 hover:text-white'
              }`}
              title="Copy to clipboard"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* Actions */}
        <div className="px-3 py-2 border-b border-gray-700">
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-2">Actions</div>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={handleApprove}
              disabled={approveMutation.isPending}
              className="flex items-center gap-1 px-2 py-1 text-xs bg-green-900/30 text-green-400 rounded hover:bg-green-900/50 disabled:opacity-50"
            >
              {approveMutation.isPending ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <CheckCircle className="w-3 h-3" />
              )}
              Approve & Merge
            </button>
            <button
              onClick={handleKill}
              disabled={killMutation.isPending}
              className="flex items-center gap-1 px-2 py-1 text-xs bg-red-900/30 text-red-400 rounded hover:bg-red-900/50"
            >
              <Square className="w-3 h-3" />
              Stop Agent
            </button>
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
          </div>
          {approveMutation.isError && (
            <div className="text-xs text-red-400 bg-red-900/20 px-2 py-1 rounded mt-2">
              {approveMutation.error instanceof Error
                ? approveMutation.error.message
                : 'Failed to approve'}
            </div>
          )}
          {closeMutation.isError && (
            <div className="text-xs text-red-400 bg-red-900/20 px-2 py-1 rounded mt-2">
              {closeMutation.error instanceof Error
                ? closeMutation.error.message
                : 'Failed to close'}
            </div>
          )}
        </div>

        {/* Spacer */}
        <div className="flex-1" />
      </div>

      {/* Right side - Logs */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
        {/* Tabs header */}
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-700">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setActiveTab('logs')}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                activeTab === 'logs'
                  ? 'bg-gray-700 text-white'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Logs
            </button>
            <button
              onClick={() => setActiveTab('status')}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                activeTab === 'status'
                  ? 'bg-gray-700 text-white'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Status
            </button>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => refetch()}
              className="p-1 text-gray-400 hover:text-white"
              title="Refresh"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-white">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Content */}
        {activeTab === 'logs' ? (
          <>
            <pre
              ref={terminalRef}
              onScroll={handleScroll}
              className="flex-1 min-h-0 overflow-auto p-3 bg-gray-900 text-gray-200 font-mono text-xs leading-relaxed m-0 whitespace-pre"
            >
              {output || 'Connecting to agent...'}
              <div ref={bottomRef} />
            </pre>

            {/* Pending question banner */}
            {pendingQuestions.length > 0 && !showQuestionDialog && (
              <div className="p-2 border-t border-yellow-600 bg-yellow-900/30">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-yellow-400 text-sm">
                    <MessageCircle className="w-4 h-4" />
                    <span>Agent is waiting for your input</span>
                  </div>
                  <button
                    onClick={() => setShowQuestionDialog(true)}
                    className="px-3 py-1 bg-yellow-600 hover:bg-yellow-500 text-white text-sm rounded transition-colors"
                  >
                    Answer
                  </button>
                </div>
              </div>
            )}

            {/* Input */}
            <div className="p-2 border-t border-gray-700 bg-gray-800">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                  placeholder="Send message to agent..."
                  className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded text-sm text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <button
                  onClick={handleSend}
                  disabled={!message.trim() || sendMutation.isPending}
                  className="px-3 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  <Send className="w-4 h-4" />
                  Send
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto p-4 bg-gray-900">
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium text-white mb-2">Agent Summary</h3>
                <div className="text-xs text-gray-300 space-y-1">
                  <p><strong>Issue:</strong> {agent.issueId}</p>
                  <p><strong>Session:</strong> <span className="font-mono text-[10px]">{agent.id}</span></p>
                  <p><strong>Model:</strong> {agent.model}</p>
                  <p><strong>Runtime:</strong> {agent.runtime}</p>
                  <p><strong>Started:</strong> {startedAt.toLocaleString()}</p>
                  <p><strong>Uptime:</strong> {duration}</p>
                </div>
              </div>

              {agent.workspace && (
                <div>
                  <h3 className="text-sm font-medium text-white mb-2">Workspace</h3>
                  <div className="text-xs text-gray-300 space-y-1">
                    <p className="font-mono text-[10px] break-all">{agent.workspace}</p>
                  </div>
                </div>
              )}

              {agent.git && (
                <div>
                  <h3 className="text-sm font-medium text-white mb-2">Git Status</h3>
                  <div className="text-xs text-gray-300 space-y-1">
                    <p><strong>Branch:</strong> <span className="font-mono">{agent.git.branch}</span></p>
                    <p><strong>Uncommitted:</strong> {agent.git.uncommittedFiles} files</p>
                    <p><strong>Latest:</strong> {agent.git.latestCommit}</p>
                  </div>
                </div>
              )}

              <div>
                <h3 className="text-sm font-medium text-white mb-2">Health</h3>
                <div className="text-xs text-gray-300 space-y-1">
                  <p><strong>Status:</strong> <span className="text-green-400">{agent.status}</span></p>
                  <p><strong>Consecutive Failures:</strong> {agent.consecutiveFailures}</p>
                  <p><strong>Total Restarts:</strong> {agent.killCount}</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
    </>
  );
}
