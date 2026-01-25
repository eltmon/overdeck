import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import {
  X,
  ExternalLink,
  Play,
  User,
  Tag,
  Calendar,
  Copy,
  Check,
  FolderPlus,
  Loader2,
  Folder,
  GitBranch,
  Globe,
  Terminal,
  Box,
  Database,
  Server,
  GitMerge,
  Bot,
  AlertTriangle,
  RefreshCw,
  DollarSign,
  Cpu,
} from 'lucide-react';

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

interface IssueCostData {
  issueId: string;
  totalCost: number;
  totalTokens: number;
  sessions: SessionCost[];
  byModel: Record<string, number>;
}

// Fetch cost data for an issue
async function fetchIssueCosts(issueId: string): Promise<IssueCostData> {
  const res = await fetch(`/api/issues/${issueId}/costs`);
  if (!res.ok) throw new Error('Failed to fetch costs');
  return res.json();
}

// Format cost for display
function formatCost(cost: number): string {
  if (cost >= 100) return `$${cost.toFixed(0)}`;
  if (cost >= 10) return `$${cost.toFixed(1)}`;
  if (cost >= 1) return `$${cost.toFixed(2)}`;
  if (cost > 0) return `$${cost.toFixed(3)}`;
  return '$0.00';
}

// Format token count
function formatTokens(tokens: number): string {
  if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(2)}M`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K`;
  return tokens.toString();
}

// Get friendly model name from full model ID
function getFriendlyModelName(fullModel: string): string {
  if (fullModel.includes('opus-4-5') || fullModel.includes('opus-4.5')) return 'Opus 4.5';
  if (fullModel.includes('opus-4-1')) return 'Opus 4.1';
  if (fullModel.includes('opus-4') || fullModel.includes('opus')) return 'Opus 4';
  if (fullModel.includes('sonnet-4-5') || fullModel.includes('sonnet-4.5')) return 'Sonnet 4.5';
  if (fullModel.includes('sonnet-4') || fullModel.includes('sonnet')) return 'Sonnet 4';
  if (fullModel.includes('haiku-4-5') || fullModel.includes('haiku-4.5')) return 'Haiku 4.5';
  if (fullModel.includes('haiku-3')) return 'Haiku 3';
  if (fullModel.includes('haiku')) return 'Haiku 4.5';
  return fullModel;  // Return as-is if unknown
}
import { Issue, GitStatus } from '../types';

interface ContainerStatus {
  running: boolean;
  uptime: string | null;
}

interface RepoGitStatus {
  frontend: GitStatus | null;
  api: GitStatus | null;
}

interface WorkspaceInfo {
  exists: boolean;
  corrupted?: boolean;
  message?: string;
  issueId: string;
  path?: string;
  frontendUrl?: string;
  apiUrl?: string;
  mrUrl?: string | null;
  hasAgent?: boolean;
  agentSessionId?: string | null;
  agentModel?: string;
  agentModelFull?: string;
  git?: GitStatus;
  repoGit?: RepoGitStatus;
  services?: { name: string; url?: string }[];
  containers?: Record<string, ContainerStatus> | null;
  hasDocker?: boolean;
  canContainerize?: boolean;
}

interface IssueDetailPanelProps {
  issue: Issue;
  onClose: () => void;
  onStartAgent?: () => void;
}

// Clipboard helper that works without HTTPS
function copyToClipboard(text: string): boolean {
  // Try modern API first
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text);
    return true;
  }

  // Fallback for non-secure contexts (like HTTP over network IP)
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

interface DiffAnalysis {
  modifiedFiles: string[];
  newFiles: string[];
  unchangedFiles: string[];
  comparedAgainst: string;
  error?: string;
}

interface CleanPreview {
  workspacePath: string;
  totalSize: string;
  fileCount: number;
  codeFiles: string[];
  configFiles: string[];
  otherFiles: string[];
  hasMore: boolean;
  backupPath: string;
  diffAnalysis?: DiffAnalysis;
}

export function IssueDetailPanel({ issue, onClose, onStartAgent }: IssueDetailPanelProps) {
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  const [copiedPath, setCopiedPath] = useState(false);
  const [showCleanDialog, setShowCleanDialog] = useState(false);
  const [createBackup, setCreateBackup] = useState(true);

  // Fetch workspace info
  const { data: workspace, isLoading: workspaceLoading } = useQuery<WorkspaceInfo>({
    queryKey: ['workspace', issue.identifier],
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${issue.identifier}`);
      if (!res.ok) throw new Error('Failed to fetch workspace info');
      return res.json();
    },
    refetchInterval: 5000, // Check for workspace changes
  });

  // Fetch cost data
  const { data: costData } = useQuery<IssueCostData>({
    queryKey: ['issueCosts', issue.identifier],
    queryFn: () => fetchIssueCosts(issue.identifier),
    refetchInterval: 30000,
    staleTime: 10000,
  });

  const handleCopyIdentifier = () => {
    copyToClipboard(issue.identifier);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyPath = () => {
    if (workspace?.path) {
      copyToClipboard(`cd ${workspace.path}`);
      setCopiedPath(true);
      setTimeout(() => setCopiedPath(false), 2000);
    }
  };

  const startAgentMutation = useMutation({
    mutationKey: ['startAgent', issue.identifier], // Reset state when issue changes
    mutationFn: async () => {
      const res = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueId: issue.identifier, projectId: issue.project?.id }),
      });
      if (!res.ok) throw new Error('Failed to start agent');
      return res.json();
    },
    onSuccess: () => {
      // Refresh agents list after a short delay to allow tmux session to start
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['agents'] });
      }, 2000);
      onStartAgent?.();
    },
  });

  const createWorkspaceMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueId: issue.identifier, projectId: issue.project?.id }),
      });
      if (!res.ok) throw new Error('Failed to create workspace');
      return res.json();
    },
    onSuccess: () => {
      // Refresh workspace info
      queryClient.invalidateQueries({ queryKey: ['workspace', issue.identifier] });
    },
  });

  const containerizeMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/workspaces/${issue.identifier}/containerize`, {
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
      // Refresh workspace info after a delay to allow script to complete
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['workspace', issue.identifier] });
      }, 3000);
    },
  });

  const startContainersMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/workspaces/${issue.identifier}/start`, {
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
      // Refresh workspace info after a delay to allow containers to start
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['workspace', issue.identifier] });
      }, 5000);
    },
  });

  // Fetch clean preview when dialog is shown
  const { data: cleanPreview, isLoading: cleanPreviewLoading } = useQuery<CleanPreview>({
    queryKey: ['workspace-clean-preview', issue.identifier],
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${issue.identifier}/clean/preview`);
      if (!res.ok) throw new Error('Failed to fetch preview');
      return res.json();
    },
    enabled: showCleanDialog && workspace?.corrupted === true,
  });

  const cleanWorkspaceMutation = useMutation({
    mutationFn: async (options: { createBackup: boolean }) => {
      const res = await fetch(`/api/workspaces/${issue.identifier}/clean`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ createBackup: options.createBackup }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to clean workspace');
      }
      return res.json();
    },
    onSuccess: (data) => {
      setShowCleanDialog(false);
      queryClient.invalidateQueries({ queryKey: ['workspace', issue.identifier] });
      if (data.backupPath) {
        alert(`Workspace backed up to:\n${data.backupPath}\n\nYou can restore files from there after the new workspace is created.`);
      }
    },
  });

  const handleStartAgent = () => {
    startAgentMutation.mutate();
  };

  const handleCreateWorkspace = () => {
    createWorkspaceMutation.mutate();
  };

  const handleContainerize = () => {
    containerizeMutation.mutate();
  };

  const handleStartContainers = () => {
    startContainersMutation.mutate();
  };

  const handleCleanWorkspace = () => {
    setShowCleanDialog(true);
  };

  const handleConfirmClean = () => {
    cleanWorkspaceMutation.mutate({ createBackup });
  };

  const priorityLabels: Record<number, { label: string; color: string }> = {
    0: { label: 'No priority', color: 'text-gray-400' },
    1: { label: 'Urgent', color: 'text-red-400' },
    2: { label: 'High', color: 'text-orange-400' },
    3: { label: 'Medium', color: 'text-yellow-400' },
    4: { label: 'Low', color: 'text-blue-400' },
  };

  const priority = priorityLabels[issue.priority] || priorityLabels[0];

  return (
    <div className="flex flex-col h-full bg-gray-800 border-l border-gray-700">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopyIdentifier}
            className={`font-mono text-sm font-medium transition-colors ${
              copied ? 'text-green-400' : 'text-white hover:text-blue-400'
            }`}
            title="Click to copy"
          >
            {issue.identifier}
            {copied ? (
              <Check className="w-3 h-3 inline ml-1" />
            ) : (
              <Copy className="w-3 h-3 inline ml-1 opacity-50" />
            )}
          </button>
          <a
            href={issue.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-gray-400 hover:text-blue-400"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-white p-1">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {/* Title */}
        <h2 className="text-lg font-medium text-white mb-4">{issue.title}</h2>

        {/* Status & Priority */}
        <div className="flex items-center gap-3 mb-4">
          <span className="px-2 py-1 bg-gray-700 text-white text-xs rounded">
            {issue.status}
          </span>
          <span className={`text-xs ${priority.color}`}>{priority.label}</span>
        </div>

        {/* Meta info */}
        <div className="space-y-3 mb-6">
          {issue.assignee && (
            <div className="flex items-center gap-2 text-sm">
              <User className="w-4 h-4 text-gray-400" />
              <span className="text-gray-300">{issue.assignee.name}</span>
              <span className="text-gray-500 text-xs">{issue.assignee.email}</span>
            </div>
          )}

          {issue.labels.length > 0 && (
            <div className="flex items-center gap-2 text-sm flex-wrap">
              <Tag className="w-4 h-4 text-gray-400 shrink-0" />
              {issue.labels.map((label) => (
                <span
                  key={label}
                  className="px-2 py-0.5 bg-gray-700 text-gray-300 text-xs rounded"
                >
                  {label}
                </span>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2 text-sm text-gray-400">
            <Calendar className="w-4 h-4" />
            <span>Updated {new Date(issue.updatedAt).toLocaleDateString()}</span>
          </div>
        </div>

        {/* Description */}
        {issue.description && (
          <div className="mb-6">
            <h3 className="text-sm font-medium text-gray-400 mb-2">Description</h3>
            <div className="text-sm text-gray-300 bg-gray-900 rounded p-3 max-h-64 overflow-y-auto prose prose-sm prose-invert prose-p:my-2 prose-headings:my-2 prose-ul:my-1 prose-li:my-0">
              <ReactMarkdown>{issue.description}</ReactMarkdown>
            </div>
          </div>
        )}

        {/* Cost Summary */}
        {costData && (costData.totalCost > 0 || costData.sessions.length > 0) && (
          <div className="mb-6">
            <h3 className="text-sm font-medium text-gray-400 mb-2 flex items-center gap-2">
              <DollarSign className="w-4 h-4" />
              Cost Summary
            </h3>
            <div className="bg-gray-900 rounded p-3 space-y-3">
              {/* Total cost */}
              <div className="flex items-center justify-between">
                <span className="text-gray-400">Total Cost</span>
                <span className="text-xl font-semibold text-green-400">
                  {formatCost(costData.totalCost)}
                </span>
              </div>

              {/* Token count */}
              {costData.totalTokens > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500 flex items-center gap-1">
                    <Cpu className="w-3 h-3" />
                    Total Tokens
                  </span>
                  <span className="text-gray-300">{formatTokens(costData.totalTokens)}</span>
                </div>
              )}

              {/* By Model breakdown */}
              {Object.keys(costData.byModel).length > 0 && (
                <div className="border-t border-gray-700 pt-2">
                  <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">By Model</p>
                  <div className="space-y-1">
                    {Object.entries(costData.byModel)
                      .sort(([, a], [, b]) => b - a)
                      .map(([model, cost]) => (
                        <div key={model} className="flex items-center justify-between text-sm">
                          <span
                            className="text-gray-400 truncate"
                            title={model}
                          >
                            {getFriendlyModelName(model)}
                          </span>
                          <span className="text-gray-300">{formatCost(cost)}</span>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* Sessions */}
              {costData.sessions.length > 0 && (
                <div className="border-t border-gray-700 pt-2">
                  <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">
                    Sessions ({costData.sessions.length})
                  </p>
                  <div className="space-y-2 max-h-32 overflow-y-auto">
                    {costData.sessions.map((session) => (
                      <div
                        key={session.id}
                        className="flex items-center justify-between text-xs bg-gray-800 rounded px-2 py-1"
                      >
                        <div className="flex items-center gap-2 truncate">
                          <span className="px-1.5 py-0.5 bg-gray-700 rounded text-gray-400">
                            {session.type}
                          </span>
                          <span className="text-gray-500 truncate">{session.model}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {session.tokenCount && (
                            <span className="text-gray-500">{formatTokens(session.tokenCount)}</span>
                          )}
                          {session.cost ? (
                            <span className="text-green-400">{formatCost(session.cost)}</span>
                          ) : (
                            <span className="text-gray-600">-</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Loading skeleton while fetching workspace info */}
        {workspaceLoading && (
          <div className="bg-gray-700/30 border border-gray-600/50 rounded-lg p-4 mb-4 animate-pulse">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 bg-gray-600 rounded-full shrink-0" />
              <div className="flex-1 space-y-3">
                <div className="h-4 bg-gray-600 rounded w-32" />
                <div className="h-3 bg-gray-600 rounded w-full" />
                <div className="h-3 bg-gray-600 rounded w-3/4" />
                <div className="flex gap-2 mt-3">
                  <div className="h-6 bg-gray-600 rounded w-20" />
                  <div className="h-6 bg-gray-600 rounded w-16" />
                  <div className="h-6 bg-gray-600 rounded w-24" />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Corrupted Workspace Warning */}
        {!workspaceLoading && workspace?.exists && workspace?.corrupted && (
          <div className="bg-yellow-900/20 border border-yellow-700/50 rounded-lg p-4 mb-4">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 bg-yellow-900/50 rounded-full flex items-center justify-center shrink-0">
                <AlertTriangle className="w-4 h-4 text-yellow-400" />
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-medium text-yellow-400">Workspace Corrupted</h4>
                <p className="text-sm text-gray-400 mt-1">
                  {workspace.message || 'The workspace exists but is not a valid git worktree.'}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  Path: <code className="bg-gray-800 px-1 rounded">{workspace.path}</code>
                </p>
                <button
                  onClick={handleCleanWorkspace}
                  disabled={cleanWorkspaceMutation.isPending}
                  className="mt-3 flex items-center gap-2 px-3 py-1.5 bg-yellow-600 hover:bg-yellow-500 disabled:bg-yellow-800 text-white text-sm rounded transition-colors"
                >
                  {cleanWorkspaceMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Cleaning...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-4 h-4" />
                      Clean &amp; Recreate
                    </>
                  )}
                </button>
                {cleanWorkspaceMutation.isError && (
                  <div className="text-xs text-red-400 bg-red-900/20 px-2 py-1 rounded mt-2">
                    {cleanWorkspaceMutation.error instanceof Error
                      ? cleanWorkspaceMutation.error.message
                      : 'Failed to clean workspace'}
                  </div>
                )}
                {cleanWorkspaceMutation.isSuccess && (
                  <div className="text-xs text-green-400 bg-green-900/20 px-2 py-1 rounded mt-2">
                    Workspace cleaned! Recreating...
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Workspace Info - Show when workspace exists and is not corrupted */}
        {!workspaceLoading && workspace?.exists && !workspace?.corrupted && (
          <div className="bg-green-900/20 border border-green-700/50 rounded-lg p-4 mb-4">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 bg-green-900/50 rounded-full flex items-center justify-center shrink-0">
                <Folder className="w-4 h-4 text-green-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h4 className="text-sm font-medium text-green-400">Workspace Ready</h4>
                  {!workspace.hasDocker && (
                    <span className="px-2 py-0.5 bg-gray-700 text-gray-400 text-xs rounded">
                      Git only
                    </span>
                  )}
                  {workspace.hasDocker && (
                    <span className="px-2 py-0.5 bg-purple-900/50 text-purple-400 text-xs rounded">
                      Containerized
                    </span>
                  )}
                  {workspace.hasAgent && (
                    <span
                      className="flex items-center gap-1 px-2 py-0.5 bg-blue-900/50 text-blue-400 text-xs rounded"
                      title={workspace.agentModelFull || workspace.agentModel || 'Unknown model'}
                    >
                      <Bot className="w-3 h-3" />
                      {workspace.agentModel || 'Agent'}
                    </span>
                  )}
                </div>

                {/* Path with copy button */}
                <div className="flex items-center gap-2 mt-2">
                  <code className="text-xs text-gray-300 bg-gray-800 px-2 py-1 rounded truncate flex-1">
                    {workspace.path}
                  </code>
                  <button
                    onClick={handleCopyPath}
                    className="text-gray-400 hover:text-white p-1"
                    title="Copy cd command"
                  >
                    {copiedPath ? <Check className="w-4 h-4 text-green-400" /> : <Terminal className="w-4 h-4" />}
                  </button>
                </div>

                {/* Service URLs - only show if containers are running */}
                {workspace.containers && Object.values(workspace.containers).some(c => c.running) && (
                  <div className="mt-3 space-y-1">
                    <p className="text-xs text-gray-500 uppercase tracking-wider">Services</p>
                    {workspace.frontendUrl && workspace.containers?.frontend?.running && (
                      <a
                        href={workspace.frontendUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300"
                      >
                        <Globe className="w-3 h-3" />
                        Frontend: {workspace.frontendUrl}
                      </a>
                    )}
                    {workspace.apiUrl && workspace.containers?.api?.running && (
                      <a
                        href={workspace.apiUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300"
                      >
                        <Server className="w-3 h-3" />
                        API: {workspace.apiUrl}
                      </a>
                    )}
                  </div>
                )}

                {/* MR URL - always show if available */}
                {workspace.mrUrl && (
                  <div className="mt-3">
                    <a
                      href={workspace.mrUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-sm text-purple-400 hover:text-purple-300"
                    >
                      <GitMerge className="w-3 h-3" />
                      Merge Request
                    </a>
                  </div>
                )}

                {/* Start containers button when ANY container is stopped */}
                {workspace.hasDocker && workspace.containers && Object.values(workspace.containers).some(c => !c.running) && (
                  <div className="mt-3 space-y-2">
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-yellow-500">Some containers stopped.</span>
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
                      <div className="text-xs text-red-400 bg-red-900/20 px-2 py-1 rounded">
                        {startContainersMutation.error instanceof Error
                          ? startContainersMutation.error.message
                          : 'Failed to start containers'}
                      </div>
                    )}
                  </div>
                )}

                {/* Git-only workspace info with containerize option */}
                {!workspace.hasDocker && (
                  <div className="mt-3">
                    {workspace.canContainerize ? (
                      <div className="space-y-2">
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-gray-500">Git-only workspace.</span>
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
                      <div className="text-xs text-gray-500">
                        This is a git-only workspace (no containers).
                      </div>
                    )}
                  </div>
                )}

                {/* Container status */}
                {workspace.containers && (
                  <div className="mt-3">
                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Containers</p>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(workspace.containers).map(([name, status]) => {
                        const isStarting = startContainersMutation.isPending && !status.running;
                        return (
                          <span
                            key={name}
                            className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs ${
                              status.running
                                ? 'bg-green-900/30 text-green-400'
                                : isStarting
                                ? 'bg-yellow-900/30 text-yellow-400 animate-pulse'
                                : 'bg-gray-700 text-gray-500'
                            }`}
                          >
                            {isStarting ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : name === 'postgres' || name === 'redis' ? (
                              <Database className="w-3 h-3" />
                            ) : (
                              <Box className="w-3 h-3" />
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

                {/* Git status for sub-repos */}
                {workspace.repoGit && (workspace.repoGit.frontend || workspace.repoGit.api) && (
                  <div className="mt-3 space-y-2">
                    <p className="text-xs text-gray-500 uppercase tracking-wider">Git Status</p>
                    {workspace.repoGit.frontend && (
                      <div className="text-xs">
                        <span className="text-gray-400">Frontend:</span>
                        <span className="flex items-center gap-2 mt-0.5">
                          <GitBranch className="w-3 h-3 text-gray-500" />
                          <span className="text-gray-300">{workspace.repoGit.frontend.branch}</span>
                          {workspace.repoGit.frontend.uncommittedFiles > 0 && (
                            <span className="text-yellow-400">
                              {workspace.repoGit.frontend.uncommittedFiles} uncommitted
                            </span>
                          )}
                        </span>
                      </div>
                    )}
                    {workspace.repoGit.api && (
                      <div className="text-xs">
                        <span className="text-gray-400">API:</span>
                        <span className="flex items-center gap-2 mt-0.5">
                          <GitBranch className="w-3 h-3 text-gray-500" />
                          <span className="text-gray-300">{workspace.repoGit.api.branch}</span>
                          {workspace.repoGit.api.uncommittedFiles > 0 && (
                            <span className="text-yellow-400">
                              {workspace.repoGit.api.uncommittedFiles} uncommitted
                            </span>
                          )}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* Fallback to main git status if no sub-repos */}
                {workspace.git && !workspace.repoGit?.frontend && !workspace.repoGit?.api && (
                  <div className="flex items-center gap-3 mt-3 text-xs">
                    <span className="flex items-center gap-1 text-gray-400">
                      <GitBranch className="w-3 h-3" />
                      {workspace.git.branch}
                    </span>
                    {workspace.git.uncommittedFiles > 0 && (
                      <span className="text-yellow-400">
                        {workspace.git.uncommittedFiles} uncommitted
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* No Agent Warning - Only show when no workspace */}
        {!workspace?.exists && !workspaceLoading && (
          <div className="bg-yellow-900/20 border border-yellow-700/50 rounded-lg p-4 mb-4">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 bg-yellow-900/50 rounded-full flex items-center justify-center shrink-0">
                <Play className="w-4 h-4 text-yellow-400" />
              </div>
              <div>
                <h4 className="text-sm font-medium text-yellow-400">No Workspace</h4>
                <p className="text-xs text-gray-400 mt-1">
                  Create a workspace or start an agent to begin work.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Action Buttons - Only show when workspace data is loaded */}
        {workspaceLoading && (
          <div className="space-y-3 animate-pulse">
            <div className="h-12 bg-gray-600 rounded-lg w-full" />
            <div className="h-12 bg-gray-700 rounded-lg w-full" />
          </div>
        )}

        {!workspaceLoading && (
        <div className="space-y-3">
          {/* Start Agent Button */}
          <button
            onClick={handleStartAgent}
            disabled={startAgentMutation.isPending || startAgentMutation.isSuccess}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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

          {/* Create Workspace Button - Only show when no workspace */}
          {!workspace?.exists && (
            <button
              onClick={handleCreateWorkspace}
              disabled={createWorkspaceMutation.isPending || createWorkspaceMutation.isSuccess}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors border border-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {createWorkspaceMutation.isPending ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span className="font-medium">Creating...</span>
                </>
              ) : createWorkspaceMutation.isSuccess ? (
                <>
                  <Check className="w-5 h-5" />
                  <span className="font-medium">Workspace Created!</span>
                </>
              ) : (
                <>
                  <FolderPlus className="w-5 h-5" />
                  <span className="font-medium">Create Workspace Only</span>
                </>
              )}
            </button>
          )}

          {/* Error messages */}
          {startAgentMutation.isError && (
            <p className="text-red-400 text-xs">Failed to start agent. Check server logs.</p>
          )}
          {createWorkspaceMutation.isError && (
            <p className="text-red-400 text-xs">Failed to create workspace. Check server logs.</p>
          )}
        </div>
        )}

        {!workspaceLoading && (
        <div className="text-xs text-gray-500 mt-3 space-y-1">
          <p>
            <strong>Start Agent:</strong> {workspace?.exists ? 'Starts autonomous agent in existing workspace' : 'Creates workspace + starts autonomous agent'}
          </p>
          {!workspace?.exists && (
            <p>
              <strong>Create Workspace:</strong> Creates git worktree for manual work
            </p>
          )}
        </div>
        )}
      </div>

      {/* Clean Workspace Dialog */}
      {showCleanDialog && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-lg max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
              <h3 className="text-lg font-medium text-white flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-yellow-500" />
                Clean Corrupted Workspace
              </h3>
              <button
                onClick={() => setShowCleanDialog(false)}
                className="text-gray-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto flex-1">
              {cleanPreviewLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                  <span className="ml-2 text-gray-400">Scanning workspace...</span>
                </div>
              ) : cleanPreview ? (
                <div className="space-y-4">
                  {/* Diff Analysis - Most Important Info */}
                  {cleanPreview.diffAnalysis && !cleanPreview.diffAnalysis.error && (
                    <div className="space-y-3">
                      <p className="text-xs text-gray-500">
                        Compared against: <code className="bg-gray-900 px-1 rounded">{cleanPreview.diffAnalysis.comparedAgainst}</code>
                      </p>

                      {/* Modified files - these are the ones you'd lose */}
                      {cleanPreview.diffAnalysis.modifiedFiles.length > 0 && (
                        <div className="bg-red-900/30 border border-red-700/50 rounded p-3">
                          <h4 className="text-sm font-medium text-red-400 flex items-center gap-2">
                            <span className="w-2 h-2 bg-red-500 rounded-full"></span>
                            {cleanPreview.diffAnalysis.modifiedFiles.length} Modified Files (WILL BE LOST)
                          </h4>
                          <p className="text-xs text-gray-400 mt-1 mb-2">
                            These files have changes that differ from <code>{cleanPreview.diffAnalysis.comparedAgainst}</code>
                          </p>
                          <div className="bg-gray-900 rounded p-2 max-h-32 overflow-y-auto">
                            <ul className="text-xs text-red-300 font-mono space-y-0.5">
                              {cleanPreview.diffAnalysis.modifiedFiles.slice(0, 20).map((f, i) => (
                                <li key={i} className="truncate">• {f}</li>
                              ))}
                              {cleanPreview.diffAnalysis.modifiedFiles.length > 20 && (
                                <li className="text-gray-500">...and {cleanPreview.diffAnalysis.modifiedFiles.length - 20} more</li>
                              )}
                            </ul>
                          </div>
                        </div>
                      )}

                      {/* New files - also would be lost */}
                      {cleanPreview.diffAnalysis.newFiles.length > 0 && (
                        <div className="bg-orange-900/30 border border-orange-700/50 rounded p-3">
                          <h4 className="text-sm font-medium text-orange-400 flex items-center gap-2">
                            <span className="w-2 h-2 bg-orange-500 rounded-full"></span>
                            {cleanPreview.diffAnalysis.newFiles.length} New Files (WILL BE LOST)
                          </h4>
                          <p className="text-xs text-gray-400 mt-1 mb-2">
                            These files don't exist in <code>{cleanPreview.diffAnalysis.comparedAgainst}</code>
                          </p>
                          <div className="bg-gray-900 rounded p-2 max-h-24 overflow-y-auto">
                            <ul className="text-xs text-orange-300 font-mono space-y-0.5">
                              {cleanPreview.diffAnalysis.newFiles.slice(0, 15).map((f, i) => (
                                <li key={i} className="truncate">+ {f}</li>
                              ))}
                              {cleanPreview.diffAnalysis.newFiles.length > 15 && (
                                <li className="text-gray-500">...and {cleanPreview.diffAnalysis.newFiles.length - 15} more</li>
                              )}
                            </ul>
                          </div>
                        </div>
                      )}

                      {/* Unchanged files - safe */}
                      {cleanPreview.diffAnalysis.unchangedFiles.length > 0 && (
                        <div className="bg-green-900/30 border border-green-700/50 rounded p-3">
                          <h4 className="text-sm font-medium text-green-400 flex items-center gap-2">
                            <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                            {cleanPreview.diffAnalysis.unchangedFiles.length} Unchanged Files (safe to delete)
                          </h4>
                          <p className="text-xs text-gray-400 mt-1">
                            These files are identical to <code>{cleanPreview.diffAnalysis.comparedAgainst}</code> and will be recreated.
                          </p>
                        </div>
                      )}

                      {/* Summary */}
                      {cleanPreview.diffAnalysis.modifiedFiles.length === 0 && cleanPreview.diffAnalysis.newFiles.length === 0 && (
                        <div className="bg-green-900/30 border border-green-700/50 rounded p-3">
                          <p className="text-green-400 text-sm font-medium">✓ No unique changes detected</p>
                          <p className="text-xs text-gray-400 mt-1">
                            All analyzed files match <code>{cleanPreview.diffAnalysis.comparedAgainst}</code>. Safe to clean without backup.
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Diff error */}
                  {cleanPreview.diffAnalysis?.error && (
                    <div className="bg-yellow-900/30 border border-yellow-700/50 rounded p-3">
                      <p className="text-yellow-400 text-sm font-medium">⚠️ Could not analyze changes</p>
                      <p className="text-xs text-gray-400 mt-1">{cleanPreview.diffAnalysis.error}</p>
                      <p className="text-xs text-gray-500 mt-1">Recommend creating a backup to be safe.</p>
                    </div>
                  )}

                  {/* Workspace stats */}
                  <div className="bg-gray-900/50 border border-gray-700 rounded p-3">
                    <p className="text-gray-400 text-xs">
                      <strong>Path:</strong> <code className="bg-gray-800 px-1 rounded">{cleanPreview.workspacePath}</code>
                    </p>
                    <p className="text-gray-400 text-xs mt-1">
                      <strong>Size:</strong> {cleanPreview.totalSize} • {cleanPreview.fileCount} files analyzed
                    </p>
                  </div>

                  {/* Backup option */}
                  <div className="border-t border-gray-700 pt-4">
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={createBackup}
                        onChange={(e) => setCreateBackup(e.target.checked)}
                        className="mt-1 w-4 h-4 rounded border-gray-600 bg-gray-700 text-blue-500 focus:ring-blue-500"
                      />
                      <div>
                        <span className="text-white text-sm font-medium">Create backup before cleaning</span>
                        <p className="text-xs text-gray-400 mt-0.5">
                          Files will be copied to: <code className="bg-gray-900 px-1 rounded">.backup-feature-{issue.identifier.toLowerCase()}-*</code>
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          You can manually restore files from the backup after the new workspace is created.
                        </p>
                      </div>
                    </label>
                  </div>

                  {/* Info about corrupted workspaces */}
                  <details className="group">
                    <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-400">
                      What causes corrupted workspaces?
                    </summary>
                    <div className="mt-2 bg-blue-900/30 border border-blue-700/50 rounded p-3">
                      <ul className="text-xs text-gray-400 space-y-1 list-disc list-inside">
                        <li>Interrupted <code>pan workspace create</code> command</li>
                        <li>Manual deletion of the <code>.git</code> file</li>
                        <li>Disk space issues during workspace creation</li>
                        <li>Git worktree pruning from the main repository</li>
                      </ul>
                    </div>
                  </details>
                </div>
              ) : (
                <p className="text-gray-400">Failed to load preview</p>
              )}
            </div>

            <div className="px-4 py-3 border-t border-gray-700 flex justify-end gap-3">
              <button
                onClick={() => setShowCleanDialog(false)}
                className="px-4 py-2 text-gray-400 hover:text-white text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmClean}
                disabled={cleanWorkspaceMutation.isPending || cleanPreviewLoading}
                className="px-4 py-2 bg-yellow-600 hover:bg-yellow-500 disabled:bg-yellow-800 text-white text-sm rounded flex items-center gap-2"
              >
                {cleanWorkspaceMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {createBackup ? 'Backing up & Cleaning...' : 'Cleaning...'}
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4" />
                    {createBackup ? 'Backup & Recreate' : 'Delete & Recreate'}
                  </>
                )}
              </button>
            </div>

            {cleanWorkspaceMutation.isError && (
              <div className="px-4 py-2 bg-red-900/30 border-t border-red-700">
                <p className="text-red-400 text-sm">
                  {cleanWorkspaceMutation.error instanceof Error
                    ? cleanWorkspaceMutation.error.message
                    : 'Failed to clean workspace'}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
