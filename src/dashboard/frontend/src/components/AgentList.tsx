import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Brain, Cpu, RotateCcw, Loader2, Play, Square, Clock, AlertCircle, CheckCircle2, Activity } from 'lucide-react';
import { SpecialistAgentCard, type SpecialistAgent, type IssueInfo } from './SpecialistAgentCard';
import { IssueAgentCard, type IssueAgent, type CloisterHealth } from './IssueAgentCard';

interface CloisterHealthResponse {
  agents: CloisterHealth[];
}

interface CloisterStatus {
  running: boolean;
  lastCheck: string | null;
  config: {
    startup: { auto_start: boolean };
    specialists: Record<string, { enabled: boolean; auto_wake: boolean }>;
  };
  summary: {
    active: number;
    stale: number;
    warning: number;
    stuck: number;
    total: number;
  };
}

interface ActivityEntry {
  id: string;
  timestamp: string;
  type: string;
  source: string;
  command?: string;
  issueId?: string;
  output?: string;
}

interface Issue {
  id: string;
  identifier: string;
  title: string;
}

interface AgentListProps {
  selectedAgent: string | null;
  onSelectAgent: (agentId: string | null) => void;
}

async function fetchAgents(): Promise<IssueAgent[]> {
  const res = await fetch('/api/agents');
  if (!res.ok) throw new Error('Failed to fetch agents');
  return res.json();
}

async function fetchSpecialists(): Promise<SpecialistAgent[]> {
  const res = await fetch('/api/specialists');
  if (!res.ok) throw new Error('Failed to fetch specialists');
  return res.json();
}

async function fetchCloisterHealth(): Promise<CloisterHealthResponse> {
  const res = await fetch('/api/cloister/agents/health');
  if (!res.ok) throw new Error('Failed to fetch Cloister health');
  return res.json();
}

async function fetchCloisterStatus(): Promise<CloisterStatus> {
  const res = await fetch('/api/cloister/status');
  if (!res.ok) throw new Error('Failed to fetch Cloister status');
  return res.json();
}

async function fetchActivity(): Promise<ActivityEntry[]> {
  const res = await fetch('/api/activity');
  if (!res.ok) return [];
  return res.json();
}

async function fetchIssues(): Promise<Issue[]> {
  const res = await fetch('/api/issues');
  if (!res.ok) return [];
  const data = await res.json();
  return data.issues || [];
}

async function startCloister(): Promise<void> {
  const res = await fetch('/api/cloister/start', { method: 'POST' });
  if (!res.ok) throw new Error('Failed to start Cloister');
}

async function stopCloister(): Promise<void> {
  const res = await fetch('/api/cloister/stop', { method: 'POST' });
  if (!res.ok) throw new Error('Failed to stop Cloister');
}

function formatTimeAgo(timestamp: string | null): string {
  if (!timestamp) return 'Never';
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);

  if (diffSecs < 60) return `${diffSecs}s ago`;
  if (diffMins < 60) return `${diffMins}m ago`;
  return `${Math.floor(diffMins / 60)}h ago`;
}

async function resetAllSpecialists(): Promise<void> {
  const res = await fetch('/api/specialists/reset-all', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to reset specialists');
  }
}

export function AgentList({ selectedAgent, onSelectAgent }: AgentListProps) {
  const queryClient = useQueryClient();
  const { data: agents, isLoading: agentsLoading, error: agentsError } = useQuery({
    queryKey: ['agents'],
    queryFn: fetchAgents,
    refetchInterval: 3000,
  });

  const { data: specialists, isLoading: specialistsLoading } = useQuery({
    queryKey: ['specialists'],
    queryFn: fetchSpecialists,
    refetchInterval: 5000,
  });

  const { data: cloisterHealth } = useQuery({
    queryKey: ['cloister-health'],
    queryFn: fetchCloisterHealth,
    refetchInterval: 5000,
  });

  const { data: cloisterStatus } = useQuery({
    queryKey: ['cloister-status'],
    queryFn: fetchCloisterStatus,
    refetchInterval: 5000,
  });

  const { data: activity } = useQuery({
    queryKey: ['activity'],
    queryFn: fetchActivity,
    refetchInterval: 5000,
  });

  const { data: issues } = useQuery({
    queryKey: ['issues'],
    queryFn: fetchIssues,
    refetchInterval: 30000, // Less frequent - issues don't change often
  });

  const startCloisterMutation = useMutation({
    mutationFn: startCloister,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cloister-status'] });
    },
  });

  const stopCloisterMutation = useMutation({
    mutationFn: stopCloister,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cloister-status'] });
    },
  });

  const resetAllMutation = useMutation({
    mutationFn: resetAllSpecialists,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['specialists'] });
      queryClient.invalidateQueries({ queryKey: ['agents'] });
    },
    onError: (error: Error) => {
      alert(`Failed to reset specialists: ${error.message}`);
    },
  });

  const handleResetAll = () => {
    if (confirm('Reset ALL specialist agents?\n\nThis will kill any running specialists and clear their session files.')) {
      resetAllMutation.mutate();
    }
  };

  // Helper to get issue info from currentIssue ID
  const getIssueInfo = (issueId?: string): IssueInfo | undefined => {
    if (!issueId || !issues) return undefined;
    const issue = issues.find(i => i.identifier.toLowerCase() === issueId.toLowerCase());
    if (!issue) return undefined;
    return { id: issue.id, identifier: issue.identifier, title: issue.title };
  };

  // Check if any specialist is actually active (running tmux session)
  const anySpecialistActive = specialists?.some(s => s.isRunning) || false;
  const patrolRunning = cloisterStatus?.running || false;

  // Get recent activity (last 5)
  const recentActivity = (activity || []).slice(-5).reverse();

  if (agentsLoading || specialistsLoading) {
    return (
      <div className="bg-gray-800 rounded-lg p-6">
        <div className="text-gray-400">Loading agents...</div>
      </div>
    );
  }

  if (agentsError) {
    return (
      <div className="bg-gray-800 rounded-lg p-6">
        <div className="text-red-400">Error: {(agentsError as Error).message}</div>
      </div>
    );
  }

  const runningAgents = agents?.filter((a) => a.status !== 'dead') || [];
  const enabledSpecialists = specialists?.filter((s) => s.enabled) || [];

  return (
    <div className="space-y-4">
      {/* Cloister Deacon Section */}
      <div className="bg-gray-800 rounded-lg">
        <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
          <h2 className="font-semibold text-white flex items-center gap-2">
            <Clock className="w-5 h-5 text-blue-400" />
            Cloister Deacon
          </h2>
          <div className="flex items-center gap-2">
            <span className={`text-xs px-2 py-1 rounded ${
              anySpecialistActive
                ? 'bg-green-900/50 text-green-400'
                : 'bg-gray-700 text-gray-400'
            }`}>
              {anySpecialistActive ? '● Specialists Active' : '○ Specialists Idle'}
            </span>
            {patrolRunning ? (
              <button
                onClick={() => stopCloisterMutation.mutate()}
                disabled={stopCloisterMutation.isPending}
                className="flex items-center gap-1 px-2 py-1 text-xs text-red-400 hover:bg-gray-700 rounded transition-colors disabled:opacity-50"
                title="Stop patrol loop"
              >
                <Square className="w-3 h-3" />
                Stop Patrol
              </button>
            ) : (
              <button
                onClick={() => startCloisterMutation.mutate()}
                disabled={startCloisterMutation.isPending}
                className="flex items-center gap-1 px-2 py-1 text-xs text-green-400 hover:bg-gray-700 rounded transition-colors disabled:opacity-50"
                title="Start patrol loop (health monitoring)"
              >
                <Play className="w-3 h-3" />
                Start Patrol
              </button>
            )}
          </div>
        </div>
        <div className="p-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-gray-400">Patrol Status:</span>{' '}
              <span className={patrolRunning ? 'text-green-400' : 'text-gray-500'}>
                {patrolRunning ? '● Running' : '○ Stopped'}
              </span>
            </div>
            <div>
              <span className="text-gray-400">Last Check:</span>{' '}
              <span className="text-gray-300">
                {formatTimeAgo(cloisterStatus?.lastCheck || null)}
              </span>
            </div>
            {cloisterStatus?.summary && (
              <>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-400" />
                  <span className="text-gray-300">{cloisterStatus.summary.active} active</span>
                </div>
                <div className="flex items-center gap-2">
                  {cloisterStatus.summary.stuck > 0 ? (
                    <AlertCircle className="w-4 h-4 text-red-400" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-gray-500" />
                  )}
                  <span className={cloisterStatus.summary.stuck > 0 ? 'text-red-400' : 'text-gray-400'}>
                    {cloisterStatus.summary.stuck} stuck
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Recent Activity Section */}
      {recentActivity.length > 0 && (
        <div className="bg-gray-800 rounded-lg">
          <div className="px-4 py-3 border-b border-gray-700">
            <h2 className="font-semibold text-white flex items-center gap-2">
              <Activity className="w-5 h-5 text-cyan-400" />
              Recent Activity
            </h2>
          </div>
          <div className="divide-y divide-gray-700">
            {recentActivity.map((entry) => (
              <div key={entry.id} className="px-4 py-2 flex items-center gap-3 text-sm">
                <span className="text-gray-500 text-xs w-16">
                  {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                <span className={`px-1.5 py-0.5 rounded text-xs ${
                  entry.type === 'spawn' ? 'bg-green-900/50 text-green-400' :
                  entry.type === 'complete' ? 'bg-blue-900/50 text-blue-400' :
                  entry.type === 'error' ? 'bg-red-900/50 text-red-400' :
                  entry.type === 'deacon' ? 'bg-purple-900/50 text-purple-400' :
                  'bg-gray-700 text-gray-300'
                }`}>
                  {entry.type}
                </span>
                <span className="text-gray-300 truncate flex-1">
                  {entry.type === 'deacon' ? entry.command : entry.source}
                  {entry.issueId && entry.type !== 'deacon' && (
                    <span className="text-cyan-400 ml-1">({entry.issueId})</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Specialist Agents Section */}
      <div className="bg-gray-800 rounded-lg">
        <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
          <h2 className="font-semibold text-white flex items-center gap-2">
            <Brain className="w-5 h-5 text-purple-400" />
            Specialist Agents ({enabledSpecialists.length})
          </h2>
          <button
            onClick={handleResetAll}
            disabled={resetAllMutation.isPending}
            className="flex items-center gap-1.5 px-2 py-1 text-xs text-gray-400 hover:text-yellow-400 hover:bg-gray-700 rounded transition-colors disabled:opacity-50"
            title="Reset all specialists (kill & clear sessions)"
          >
            {resetAllMutation.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RotateCcw className="w-3.5 h-3.5" />
            )}
            Reset All
          </button>
        </div>

        <div className="divide-y divide-gray-700">
          {enabledSpecialists.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              No specialist agents configured.
            </div>
          ) : (
            enabledSpecialists.map((specialist) => (
              <SpecialistAgentCard
                key={specialist.name}
                specialist={specialist}
                issueInfo={getIssueInfo(specialist.currentIssue)}
                onSelect={() =>
                  onSelectAgent(
                    specialist.tmuxSession === selectedAgent ? null : specialist.tmuxSession
                  )
                }
                isSelected={specialist.tmuxSession === selectedAgent}
              />
            ))
          )}
        </div>
      </div>

      {/* Issue Agents Section */}
      <div className="bg-gray-800 rounded-lg">
        <div className="px-4 py-3 border-b border-gray-700">
          <h2 className="font-semibold text-white flex items-center gap-2">
            <Cpu className="w-5 h-5" />
            Issue Agents ({runningAgents.length})
          </h2>
        </div>

        <div className="divide-y divide-gray-700">
          {runningAgents.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              No agents running. Use{' '}
              <code className="bg-gray-700 px-2 py-1 rounded">/work-issue</code> to spawn one.
            </div>
          ) : (
            runningAgents.map((agent) => {
              const health = cloisterHealth?.agents.find((h) => h.agentId === agent.id);

              return (
                <IssueAgentCard
                  key={agent.id}
                  agent={agent}
                  health={health}
                  onSelect={() => onSelectAgent(agent.id === selectedAgent ? null : agent.id)}
                  isSelected={agent.id === selectedAgent}
                />
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
