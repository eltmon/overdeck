import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Issue, Agent, LinearProject, STATUS_ORDER, STATUS_LABELS } from '../types';
import { ExternalLink, User, Tag, Play, Eye, MessageCircle, X, Loader2, Filter, FileText, Github, List, CheckCircle, DollarSign, Sparkles, RotateCcw } from 'lucide-react';
import { PlanDialog } from './PlanDialog';

// Cost data for an issue
interface IssueCost {
  issueId: string;
  totalCost: number;
  tokenCount: number;
  sessionCount: number;
  model?: string;
  durationMinutes?: number;
}

// Fetch costs for all issues
async function fetchIssueCosts(): Promise<Record<string, IssueCost>> {
  try {
    const res = await fetch('/api/costs/by-issue');
    if (!res.ok) return {};
    const data = await res.json();
    const costMap: Record<string, IssueCost> = {};
    for (const issue of data.issues || []) {
      costMap[issue.issueId.toLowerCase()] = issue;
    }
    return costMap;
  } catch {
    return {};
  }
}

// Format cost for display
function formatCost(cost: number): string {
  if (cost >= 100) {
    return `$${cost.toFixed(0)}`;
  } else if (cost >= 10) {
    return `$${cost.toFixed(1)}`;
  } else if (cost >= 1) {
    return `$${cost.toFixed(2)}`;
  } else if (cost > 0) {
    return `$${cost.toFixed(2)}`;
  }
  return '';
}

// Get cost badge color based on amount
function getCostColor(cost: number): string {
  if (cost >= 50) return 'bg-red-900/50 text-red-400';
  if (cost >= 20) return 'bg-orange-900/50 text-orange-400';
  if (cost >= 5) return 'bg-yellow-900/50 text-yellow-400';
  return 'bg-green-900/50 text-green-400';
}

async function fetchIssues(cycle: string = 'current', includeCompleted: boolean = false): Promise<Issue[]> {
  const params = new URLSearchParams();
  params.set('cycle', cycle);
  if (includeCompleted) params.set('includeCompleted', 'true');
  const res = await fetch(`/api/issues?${params}`);
  if (!res.ok) throw new Error('Failed to fetch issues');
  return res.json();
}

async function fetchAgents(): Promise<Agent[]> {
  const res = await fetch('/api/agents');
  if (!res.ok) throw new Error('Failed to fetch agents');
  return res.json();
}

function groupByStatus(issues: Issue[]): Record<string, Issue[]> {
  const grouped: Record<string, Issue[]> = {
    backlog: [],
    todo: [],
    planning: [],      // NEW: Planning column
    in_progress: [],
    in_review: [],
    done: [],
  };

  for (const issue of issues) {
    const status = STATUS_LABELS[issue.status] || 'backlog';
    // Handle 'canceled' by putting in done
    if (status === 'canceled') {
      grouped.done.push(issue);
    } else if (grouped[status]) {
      grouped[status].push(issue);
    } else {
      grouped.backlog.push(issue);
    }
  }

  return grouped;
}

const COLUMN_COLORS: Record<string, string> = {
  backlog: 'border-gray-600',
  todo: 'border-blue-600',
  planning: 'border-purple-600',   // NEW: Purple for planning
  in_progress: 'border-yellow-500',
  in_review: 'border-pink-500',
  done: 'border-green-500',
};

const COLUMN_TITLES: Record<string, string> = {
  backlog: 'Backlog',
  todo: 'To Do',
  planning: 'Planning',            // NEW: Planning column
  in_progress: 'In Progress',
  in_review: 'In Review',
  done: 'Done',
};

interface KanbanBoardProps {
  selectedIssue?: string | null;
  onSelectIssue?: (issueId: string | null) => void;
}

type CycleFilter = 'current' | 'all' | 'backlog';

export function KanbanBoard({ selectedIssue: externalSelectedIssue, onSelectIssue: externalOnSelectIssue }: KanbanBoardProps) {
  const queryClient = useQueryClient();
  const [internalSelectedIssue, setInternalSelectedIssue] = useState<string | null>(null);
  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(new Set()); // Empty = all projects
  const [planDialogIssue, setPlanDialogIssue] = useState<Issue | null>(null); // Lifted dialog state
  const [beadsDialogIssue, setBeadsDialogIssue] = useState<Issue | null>(null); // Beads viewer
  const [cycleFilter, setCycleFilter] = useState<CycleFilter>('current'); // Default to current cycle
  const [includeCompleted, setIncludeCompleted] = useState(false);

  // Use external state if provided, otherwise use internal state
  const selectedIssue = externalSelectedIssue !== undefined ? externalSelectedIssue : internalSelectedIssue;
  const onSelectIssue = externalOnSelectIssue || setInternalSelectedIssue;

  const { data: issues, isLoading: issuesLoading, error: issuesError } = useQuery({
    queryKey: ['issues', cycleFilter, includeCompleted],
    queryFn: () => fetchIssues(cycleFilter, includeCompleted),
  });

  const { data: agents = [] } = useQuery({
    queryKey: ['agents'],
    queryFn: fetchAgents,
    refetchInterval: 5000, // Refresh every 5 seconds
  });

  // Fetch costs for all issues
  const { data: issueCosts = {} } = useQuery({
    queryKey: ['issueCosts'],
    queryFn: fetchIssueCosts,
    refetchInterval: 30000, // Refresh every 30 seconds
    staleTime: 10000,
  });

  // Extract unique projects from issues
  const projects = useMemo(() => {
    if (!issues) return [];
    const projectMap = new Map<string, LinearProject>();
    for (const issue of issues) {
      if (issue.project && !projectMap.has(issue.project.id)) {
        projectMap.set(issue.project.id, issue.project);
      }
    }
    return Array.from(projectMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [issues]);

  // Filter issues by selected projects
  const filteredIssues = useMemo(() => {
    if (!issues) return [];
    if (selectedProjects.size === 0) return issues; // Show all if none selected
    return issues.filter(issue => issue.project && selectedProjects.has(issue.project.id));
  }, [issues, selectedProjects]);

  const toggleProject = (projectId: string) => {
    setSelectedProjects(prev => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  };

  if (issuesLoading) {
    return (
      <div className="space-y-4">
        {/* Skeleton filter bar */}
        <div className="flex items-center gap-2 animate-pulse">
          <div className="w-4 h-4 bg-gray-700 rounded" />
          <div className="w-16 h-4 bg-gray-700 rounded" />
          <div className="w-24 h-6 bg-gray-700 rounded" />
          <div className="w-20 h-6 bg-gray-700 rounded" />
          <div className="w-28 h-6 bg-gray-700 rounded" />
        </div>

        {/* Skeleton columns */}
        <div className="flex gap-4 overflow-x-auto pb-4">
          {STATUS_ORDER.map((status) => (
            <div key={status} className="flex-shrink-0 w-80">
              <div className={`border-t-4 ${COLUMN_COLORS[status]} bg-gray-800 rounded-lg`}>
                <div className="px-4 py-3 border-b border-gray-700">
                  <div className="flex items-center justify-between">
                    <div className="h-5 bg-gray-700 rounded w-24 animate-pulse" />
                    <div className="h-4 bg-gray-700 rounded w-6 animate-pulse" />
                  </div>
                </div>
                <div className="p-2 space-y-2">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="bg-gray-700 rounded-lg p-3 border-l-4 border-l-gray-600 animate-pulse">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-2 h-2 bg-gray-600 rounded-full" />
                        <div className="h-4 bg-gray-600 rounded w-16" />
                      </div>
                      <div className="h-4 bg-gray-600 rounded w-full mb-1" />
                      <div className="h-4 bg-gray-600 rounded w-3/4" />
                      <div className="flex gap-2 mt-3">
                        <div className="h-5 bg-gray-600 rounded w-16" />
                        <div className="h-5 bg-gray-600 rounded w-12" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (issuesError) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-red-400">Error loading issues: {(issuesError as Error).message}</div>
      </div>
    );
  }

  const grouped = groupByStatus(filteredIssues);

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex items-center gap-4 flex-wrap">
        {/* Cycle filter */}
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-gray-400" />
          <span className="text-sm text-gray-400">Cycle:</span>
          <div className="flex rounded-lg overflow-hidden border border-gray-600">
            {(['current', 'all', 'backlog'] as CycleFilter[]).map((cycle) => (
              <button
                key={cycle}
                onClick={() => setCycleFilter(cycle)}
                className={`px-3 py-1 text-xs transition-colors ${
                  cycleFilter === cycle
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
                }`}
              >
                {cycle === 'current' ? 'Current' : cycle === 'all' ? 'All' : 'Backlog'}
              </button>
            ))}
          </div>
        </div>

        {/* Include completed toggle */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={includeCompleted}
            onChange={(e) => setIncludeCompleted(e.target.checked)}
            className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-blue-600 focus:ring-blue-500 focus:ring-offset-gray-900"
          />
          <span className="text-sm text-gray-400">Include completed</span>
        </label>

        {/* Issue count */}
        <span className="text-sm text-gray-500">
          {issues?.length || 0} issues
        </span>

        {/* Project filter */}
        {projects.length > 1 && (
          <>
            <div className="w-px h-6 bg-gray-700" />
            <span className="text-sm text-gray-400">Projects:</span>
            {projects.map((project) => (
              <button
                key={project.id}
                onClick={() => toggleProject(project.id)}
                className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors ${
                  selectedProjects.size === 0 || selectedProjects.has(project.id)
                    ? 'bg-gray-700 text-white'
                    : 'bg-gray-800 text-gray-500 hover:text-gray-300'
                }`}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: project.color || '#6b7280' }}
                />
                {project.name}
              </button>
            ))}
            {selectedProjects.size > 0 && (
              <button
                onClick={() => setSelectedProjects(new Set())}
                className="text-xs text-gray-400 hover:text-white"
              >
                Clear
              </button>
            )}
          </>
        )}
      </div>

      {/* Kanban columns */}
      <div className="flex gap-4 overflow-x-auto pb-4">
      {STATUS_ORDER.map((status) => (
        <div key={status} className="flex-shrink-0 w-80">
          <div className={`border-t-4 ${COLUMN_COLORS[status]} bg-gray-800 rounded-lg`}>
            <div className="px-4 py-3 border-b border-gray-700">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-white">{COLUMN_TITLES[status]}</h3>
                <span className="text-sm text-gray-400">{grouped[status].length}</span>
              </div>
            </div>
            <div className="p-2 space-y-2 max-h-[calc(100vh-220px)] overflow-y-auto">
              {grouped[status].map((issue) => {
                const agent = agents.find(
                  (a) => a.issueId?.toLowerCase() === issue.identifier.toLowerCase()
                );
                return (
                  <IssueCard
                    key={issue.id}
                    issue={issue}
                    agent={agent}
                    cost={issueCosts[issue.identifier.toLowerCase()]}
                    isSelected={selectedIssue === issue.identifier}
                    onSelect={() => onSelectIssue(
                      selectedIssue === issue.identifier ? null : issue.identifier
                    )}
                    onPlan={() => setPlanDialogIssue(issue)}
                    onViewBeads={(i) => setBeadsDialogIssue(i)}
                  />
                );
              })}
              {grouped[status].length === 0 && (
                <div className="text-center text-gray-500 py-8 text-sm">
                  No issues
                </div>
              )}
            </div>
          </div>
        </div>
      ))}
      </div>

      {/* Plan Dialog - lifted to survive IssueCard re-renders */}
      {planDialogIssue && (
        <PlanDialog
          issue={planDialogIssue}
          isOpen={true}
          onClose={() => setPlanDialogIssue(null)}
          onComplete={() => {
            setPlanDialogIssue(null);
            queryClient.invalidateQueries({ queryKey: ['issues'] });
          }}
        />
      )}

      {/* Beads Dialog - view tasks created during planning */}
      {beadsDialogIssue && (
        <BeadsDialog
          issue={beadsDialogIssue}
          onClose={() => setBeadsDialogIssue(null)}
        />
      )}
    </div>
  );
}

// Simple Beads Dialog component
function BeadsDialog({ issue, onClose }: { issue: Issue; onClose: () => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['beads', issue.identifier],
    queryFn: async () => {
      const res = await fetch(`/api/issues/${issue.identifier}/beads`);
      if (!res.ok) throw new Error('Failed to fetch tasks');
      return res.json();
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[70vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
          <div className="flex items-center gap-2">
            <List className="w-5 h-5 text-green-400" />
            <h2 className="font-semibold text-white">Tasks: {issue.identifier}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {isLoading && (
            <div className="flex items-center justify-center py-8 text-gray-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              Loading tasks...
            </div>
          )}

          {error && (
            <div className="text-red-400 text-center py-8">
              Failed to load tasks
            </div>
          )}

          {data && data.tasks?.length === 0 && (
            <div className="text-gray-500 text-center py-8">
              No tasks created yet
            </div>
          )}

          {data && data.tasks?.length > 0 && (
            <div className="space-y-2">
              {data.tasks.map((task: any) => (
                <div
                  key={task.id}
                  className={`flex items-start gap-3 p-3 rounded-lg ${
                    task.status === 'closed' ? 'bg-green-900/20' :
                    task.status === 'in_progress' ? 'bg-blue-900/20' :
                    'bg-gray-700/50'
                  }`}
                >
                  <div className={`mt-0.5 ${
                    task.status === 'closed' ? 'text-green-400' :
                    task.status === 'in_progress' ? 'text-blue-400' :
                    'text-gray-400'
                  }`}>
                    {task.status === 'closed' ? (
                      <CheckCircle className="w-4 h-4" />
                    ) : task.status === 'in_progress' ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <div className="w-4 h-4 border-2 border-current rounded-full" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white">{task.title}</div>
                    <div className="text-xs text-gray-500 mt-1">
                      {task.id} · {task.status}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-gray-700 text-xs text-gray-500">
          {data?.count || 0} task{data?.count !== 1 ? 's' : ''} · Beads
        </div>
      </div>
    </div>
  );
}

interface IssueCardProps {
  issue: Issue;
  agent?: Agent;
  cost?: IssueCost;
  isSelected: boolean;
  onSelect: () => void;
  onPlan: () => void; // Lifted to parent to survive re-renders
  onViewBeads?: (issue: Issue) => void;
}

function IssueCard({ issue, agent, cost, isSelected, onSelect, onPlan, onViewBeads }: IssueCardProps) {
  const queryClient = useQueryClient();
  const isRunning = agent && agent.status !== 'dead';
  const [showAbortConfirm, setShowAbortConfirm] = useState(false);
  const [deleteWorkspace, setDeleteWorkspace] = useState(false);

  const priorityColors: Record<number, string> = {
    0: 'border-l-gray-500',
    1: 'border-l-red-500',
    2: 'border-l-orange-500',
    3: 'border-l-yellow-500',
    4: 'border-l-blue-500',
  };

  // Kill agent mutation
  const killMutation = useMutation({
    mutationFn: async (agentId: string) => {
      const res = await fetch(`/api/agents/${agentId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to kill agent');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
    },
  });

  // Send message mutation
  const [messageInput, setMessageInput] = useState('');
  const [showMessageInput, setShowMessageInput] = useState(false);

  const sendMessageMutation = useMutation({
    mutationFn: async ({ agentId, message }: { agentId: string; message: string }) => {
      const res = await fetch(`/api/agents/${agentId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });
      if (!res.ok) throw new Error('Failed to send message');
      return res.json();
    },
    onSuccess: () => {
      setMessageInput('');
      setShowMessageInput(false);
    },
  });

  const handleKill = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (agent && confirm(`Kill agent ${agent.id}?`)) {
      killMutation.mutate(agent.id);
    }
  };

  const handleWatch = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect();
  };

  const handleTell = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowMessageInput(!showMessageInput);
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (agent && messageInput.trim()) {
      sendMessageMutation.mutate({ agentId: agent.id, message: messageInput.trim() });
    }
  };

  const startAgentMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueId: issue.identifier }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to start agent');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      queryClient.invalidateQueries({ queryKey: ['issues'] });
    },
    onError: (err: Error) => {
      alert(`Failed to start agent: ${err.message}`);
    },
  });

  const handleStartAgent = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm(`Start agent for ${issue.identifier}?`)) {
      startAgentMutation.mutate();
    }
  };

  const handlePlan = (e: React.MouseEvent) => {
    e.stopPropagation();
    onPlan();
  };

  // Abort planning mutation
  const abortPlanningMutation = useMutation({
    mutationFn: async (options: { deleteWorkspace: boolean }) => {
      const res = await fetch(`/api/issues/${issue.identifier}/abort-planning`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deleteWorkspace: options.deleteWorkspace }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to abort planning');
      }
      return res.json();
    },
    onSuccess: () => {
      setShowAbortConfirm(false);
      setDeleteWorkspace(false);
      queryClient.invalidateQueries({ queryKey: ['issues'] });
    },
  });

  const handleAbortClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowAbortConfirm(true);
  };

  const handleAbortConfirm = (e: React.MouseEvent) => {
    e.stopPropagation();
    abortPlanningMutation.mutate({ deleteWorkspace });
  };

  const handleAbortCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowAbortConfirm(false);
    setDeleteWorkspace(false);
  };


  return (
    <div
      onClick={onSelect}
      className={`bg-gray-700 rounded-lg p-3 border-l-4 cursor-pointer transition-all ${priorityColors[issue.priority] || 'border-l-gray-500'} ${
        isSelected
          ? 'ring-2 ring-blue-500 bg-gray-650'
          : 'hover:bg-gray-650'
      } ${isRunning ? 'bg-blue-900/20' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {/* Project color indicator */}
            {issue.project && (
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: issue.project.color || '#6b7280' }}
                title={issue.project.name}
              />
            )}
            {isRunning && (
              <div className="flex gap-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" style={{ animationDelay: '300ms' }} />
              </div>
            )}
            <a
              href={issue.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-sm font-medium text-white hover:text-blue-400 flex items-center gap-1"
            >
              {issue.source === 'github' && (
                <span title="GitHub Issue">
                  <Github className="w-3 h-3 text-gray-400" />
                </span>
              )}
              <span className="text-gray-400">{issue.identifier}</span>
              <ExternalLink className="w-3 h-3 opacity-50" />
            </a>
            {agent && (
              <span className="text-xs text-blue-400">{agent.model}</span>
            )}
            {/* Cost badge */}
            {cost && cost.totalCost > 0 && (
              <span
                className={`ml-auto px-1.5 py-0.5 rounded text-xs font-medium ${getCostColor(cost.totalCost)}`}
                title={`${(cost.tokenCount / 1000000).toFixed(2)}M tokens${cost.model ? ` • ${cost.model.replace('claude-', '').replace(/-20[0-9]{6}$/, '')}` : ''}${cost.durationMinutes ? ` • ${Math.round(cost.durationMinutes)}min` : ''}`}
              >
                <DollarSign className="w-3 h-3 inline -mt-0.5" />
                {formatCost(cost.totalCost).slice(1)}
              </span>
            )}
          </div>
          <p className="text-sm text-gray-300 mt-1 line-clamp-2">{issue.title}</p>
        </div>
      </div>

      <div className="flex items-center gap-2 mt-2 flex-wrap">
        {issue.assignee && (
          <span className="inline-flex items-center gap-1 text-xs text-gray-400">
            <User className="w-3 h-3" />
            {issue.assignee.name.split(' ')[0]}
          </span>
        )}
        {issue.labels.slice(0, 2).map((label) => (
          <span
            key={label}
            className="inline-flex items-center gap-1 text-xs bg-gray-600 text-gray-300 px-2 py-0.5 rounded"
          >
            <Tag className="w-3 h-3" />
            {label}
          </span>
        ))}
      </div>

      {/* Action buttons for running agents */}
      {isRunning && (
        <div className={`flex items-center gap-3 mt-3 pt-3 border-t ${agent?.type === 'planning' ? 'border-purple-600/50' : 'border-gray-600'}`}>
          <button
            onClick={agent?.type === 'planning' ? handlePlan : handleWatch}
            className={`flex items-center gap-1 text-xs transition-colors ${
              agent?.type === 'planning'
                ? 'text-purple-400 hover:text-purple-300'
                : isSelected ? 'text-blue-400' : 'text-gray-400 hover:text-white'
            }`}
          >
            {agent?.type === 'planning' ? <Sparkles className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            {agent?.type === 'planning' ? 'Continue Planning' : 'Watch'}
          </button>
          <button
            onClick={handleTell}
            className={`flex items-center gap-1 text-xs transition-colors ${
              showMessageInput ? 'text-blue-400' : 'text-gray-400 hover:text-white'
            }`}
          >
            <MessageCircle className="w-3.5 h-3.5" />
            Tell
          </button>
          <button
            onClick={handleKill}
            disabled={killMutation.isPending}
            className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300 transition-colors ml-auto"
          >
            {killMutation.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <X className="w-3.5 h-3.5" />
            )}
            Kill
          </button>
        </div>
      )}

      {/* Message input for Tell */}
      {showMessageInput && agent && (
        <form onSubmit={handleSendMessage} className="mt-2" onClick={(e) => e.stopPropagation()}>
          <div className="flex gap-2">
            <input
              type="text"
              value={messageInput}
              onChange={(e) => setMessageInput(e.target.value)}
              placeholder="Type a message..."
              className="flex-1 bg-gray-800 text-white text-sm px-3 py-1.5 rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
              autoFocus
            />
            <button
              type="submit"
              disabled={!messageInput.trim() || sendMessageMutation.isPending}
              className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {sendMessageMutation.isPending ? '...' : 'Send'}
            </button>
          </div>
        </form>
      )}

      {/* Start/Plan buttons for backlog/todo items without running agent */}
      {!isRunning && (STATUS_LABELS[issue.status] === 'backlog' || STATUS_LABELS[issue.status] === 'todo') && (
        <div className="flex items-center gap-3 mt-3 pt-3 border-t border-gray-600">
          <button
            onClick={handlePlan}
            className="flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300 transition-colors"
          >
            <FileText className="w-3.5 h-3.5" />
            Plan
          </button>
          <button
            onClick={handleStartAgent}
            disabled={startAgentMutation.isPending}
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-400 transition-colors disabled:opacity-50"
            title="Plan first recommended"
          >
            {startAgentMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            {startAgentMutation.isPending ? 'Starting...' : 'Start Agent'}
          </button>
        </div>
      )}

      {/* Planning items: Continue planning or start execution */}
      {!isRunning && STATUS_LABELS[issue.status] === 'planning' && (
        <div className="flex items-center gap-3 mt-3 pt-3 border-t border-purple-600/50 flex-wrap">
          <button
            onClick={handlePlan}
            className="flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300 transition-colors"
          >
            <FileText className="w-3.5 h-3.5" />
            Resume Planning
          </button>
          <button
            onClick={() => onViewBeads && onViewBeads(issue)}
            className="flex items-center gap-1 text-xs text-green-400 hover:text-green-300 transition-colors"
            title="View tasks created during planning"
          >
            <List className="w-3.5 h-3.5" />
            Tasks
          </button>
          <button
            onClick={handleStartAgent}
            className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
          >
            <Play className="w-3.5 h-3.5" />
            Start Agent
          </button>
          <button
            onClick={handleAbortClick}
            disabled={abortPlanningMutation.isPending}
            className="flex items-center gap-1 text-xs text-orange-400 hover:text-orange-300 transition-colors disabled:opacity-50"
            title="Return to Todo"
          >
            <X className="w-3.5 h-3.5" />
            {abortPlanningMutation.isPending ? 'Aborting...' : 'Abort'}
          </button>
        </div>
      )}

      {/* Abort confirmation panel */}
      {showAbortConfirm && (
        <div className="mt-3 pt-3 border-t border-orange-600/50 bg-orange-950/30 -mx-3 -mb-3 px-3 pb-3 rounded-b-lg">
          <p className="text-xs text-orange-300 mb-2">Abort planning and return to Todo?</p>
          <label className="flex items-center gap-2 text-xs text-gray-400 mb-3 cursor-pointer">
            <input
              type="checkbox"
              checked={deleteWorkspace}
              onChange={(e) => setDeleteWorkspace(e.target.checked)}
              onClick={(e) => e.stopPropagation()}
              className="rounded border-gray-600 bg-gray-700 text-orange-500 focus:ring-orange-500"
            />
            Also delete workspace (git worktree)
          </label>
          <div className="flex gap-2">
            <button
              onClick={handleAbortCancel}
              className="px-2 py-1 text-xs text-gray-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleAbortConfirm}
              disabled={abortPlanningMutation.isPending}
              className="px-2 py-1 text-xs bg-orange-600 hover:bg-orange-500 text-white rounded transition-colors disabled:opacity-50"
            >
              {abortPlanningMutation.isPending ? 'Aborting...' : 'Confirm Abort'}
            </button>
          </div>
        </div>
      )}

      {/* In Progress items without running agent */}
      {!isRunning && STATUS_LABELS[issue.status] === 'in_progress' && (
        <div className="flex items-center gap-3 mt-3 pt-3 border-t border-gray-600">
          <button
            onClick={handlePlan}
            className="flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300 transition-colors"
          >
            <FileText className="w-3.5 h-3.5" />
            Re-plan
          </button>
          <button
            onClick={handleStartAgent}
            className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
          >
            <Play className="w-3.5 h-3.5" />
            Resume Agent
          </button>
        </div>
      )}

      {/* Done/In Review items - Reopen option */}
      {!isRunning && (STATUS_LABELS[issue.status] === 'done' || STATUS_LABELS[issue.status] === 'in_review') && (
        <ReopenSection issue={issue} />
      )}

    </div>
  );
}

// Reopen section for Done/In Review items
function ReopenSection({ issue }: { issue: Issue }) {
  const queryClient = useQueryClient();

  const reopenMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/issues/${issue.identifier}/reopen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to reopen issue');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issues'] });
    },
  });

  const handleReopen = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm(`Reopen ${issue.identifier} and start planning?`)) {
      reopenMutation.mutate();
    }
  };

  return (
    <div className="flex items-center gap-3 mt-3 pt-3 border-t border-green-600/30">
      <button
        onClick={handleReopen}
        disabled={reopenMutation.isPending}
        className="flex items-center gap-1 text-xs text-orange-400 hover:text-orange-300 transition-colors disabled:opacity-50"
      >
        {reopenMutation.isPending ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <RotateCcw className="w-3.5 h-3.5" />
        )}
        {reopenMutation.isPending ? 'Reopening...' : 'Reopen'}
      </button>
      {reopenMutation.isError && (
        <span className="text-xs text-red-400">{(reopenMutation.error as Error).message}</span>
      )}
    </div>
  );
}
