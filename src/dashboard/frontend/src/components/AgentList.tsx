import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { useDashboardStore, selectSpecialistList } from '../lib/store';
import { Brain, Play, Square, Clock, AlertCircle, CheckCircle2, Activity, XCircle, Radio } from 'lucide-react';
import { type SpecialistAgent } from './SpecialistAgentCard';

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

interface AgentListProps {
  selectedAgent: string | null;
  onSelectAgent: (agentId: string | null) => void;
}

interface ProjectSpecialistStatus {
  projectKey: string;
  specialistType: 'merge-agent' | 'review-agent' | 'test-agent';
  registryKey?: string;
  issueId?: string;
  role?: string;
  metadata: {
    runCount: number;
    lastRunAt: string | null;
    lastRunStatus: 'passed' | 'failed' | 'blocked' | null;
    currentRun: string | null;
    currentActivity?: string | null;
    model?: string | null;
    writeScope?: 'full' | 'readonly-plus-output';
  };
  isRunning: boolean;
  tmuxSession: string;
}

async function fetchProjectSpecialists(): Promise<ProjectSpecialistStatus[]> {
  const res = await fetch('/api/specialists');
  if (!res.ok) throw new Error('Failed to fetch specialists');
  const data = await res.json();
  // PAN-377: Show all project specialists (running + completed), not just running
  return (data.projects ?? []).filter((p: ProjectSpecialistStatus) => p.isRunning || p.metadata?.currentRun || p.metadata?.lastRunAt);
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

function stalenessClass(timestamp: string | null): string {
  if (!timestamp) return 'text-muted-foreground';
  const ms = Date.now() - new Date(timestamp).getTime();
  if (ms < 2 * 60_000) return 'text-success';
  if (ms < 10 * 60_000) return 'text-warning';
  if (ms < 30 * 60_000) return 'text-orange-400';
  return 'text-destructive';
}

function LiveLastHeard({ timestamp, label }: { timestamp: string | null; label?: string }) {
  const [text, setText] = useState(() => (timestamp ? formatTimeAgo(timestamp) : 'Never'));
  const [cls, setCls] = useState(() => stalenessClass(timestamp));

  useEffect(() => {
    if (!timestamp) return;
    const update = () => {
      setText(formatTimeAgo(timestamp));
      setCls(stalenessClass(timestamp));
    };
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [timestamp]);

  return (
    <span className={cls} title={label ? `${label}: ${text}` : text}>
      {text}
    </span>
  );
}


export function AgentList({ selectedAgent, onSelectAgent }: AgentListProps) {
  const queryClient = useQueryClient();

  const specialistsFromStore = useDashboardStore(selectSpecialistList);
  const specialists = specialistsFromStore as unknown as SpecialistAgent[];

  const { data: runningProjectSpecialists } = useQuery({
    queryKey: ['project-specialists-running'],
    queryFn: fetchProjectSpecialists,
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

  // Check if any specialist is actually active (running tmux session)
  const anySpecialistActive = specialists?.some(s => s.isRunning) || false;
  const patrolRunning = cloisterStatus?.running || false;

  // Get recent activity (last 5)
  const recentActivity = (activity || []).slice(-5).reverse();

  return (
    <div className="space-y-4">
      {/* Cloister Deacon Section */}
      <div className="bg-card rounded-lg">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h2 className="font-semibold text-foreground flex items-center gap-2">
            <Clock className="w-5 h-5 text-primary" />
            Cloister Deacon
          </h2>
          <div className="flex items-center gap-2">
            <span className={`text-xs px-2 py-1 rounded ${
              anySpecialistActive
                ? 'badge-bg-success text-success'
                : 'bg-popover text-muted-foreground'
            }`}>
              {anySpecialistActive ? '● Specialists Active' : '○ Specialists Idle'}
            </span>
            {patrolRunning ? (
              <button
                onClick={() => stopCloisterMutation.mutate()}
                disabled={stopCloisterMutation.isPending}
                className="flex items-center gap-1 px-2 py-1 text-xs text-destructive hover:bg-popover rounded transition-colors disabled:opacity-50"
                title="Stop patrol loop"
              >
                <Square className="w-3 h-3" />
                Stop Patrol
              </button>
            ) : (
              <button
                onClick={() => startCloisterMutation.mutate()}
                disabled={startCloisterMutation.isPending}
                className="flex items-center gap-1 px-2 py-1 text-xs text-success hover:bg-popover rounded transition-colors disabled:opacity-50"
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
              <span className="text-muted-foreground">Patrol Status:</span>{' '}
              <span className={patrolRunning ? 'text-success' : 'text-muted-foreground'}>
                {patrolRunning ? '● Running' : '○ Stopped'}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Last Check:</span>{' '}
              <span className="text-foreground">
                {formatTimeAgo(cloisterStatus?.lastCheck || null)}
              </span>
            </div>
            {cloisterStatus?.summary && (
              <>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-success" />
                  <span className="text-foreground">{cloisterStatus.summary.active} active</span>
                </div>
                <div className="flex items-center gap-2">
                  {cloisterStatus.summary.stuck > 0 ? (
                    <AlertCircle className="w-4 h-4 text-destructive" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-muted-foreground" />
                  )}
                  <span className={cloisterStatus.summary.stuck > 0 ? 'text-destructive' : 'text-muted-foreground'}>
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
        <div className="bg-card rounded-lg">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="font-semibold text-foreground flex items-center gap-2">
              <Activity className="w-5 h-5 text-cyan-400" />
              Recent Activity
            </h2>
          </div>
          <div className="divide-y divide-gray-700">
            {recentActivity.map((entry) => (
              <div key={entry.id} className="px-4 py-2 flex items-center gap-3 text-sm">
                <span className="text-muted-foreground text-xs w-16">
                  {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                <span className={`px-1.5 py-0.5 rounded text-xs ${
                  entry.type === 'spawn' ? 'badge-bg-success text-success' :
                  entry.type === 'complete' ? 'badge-bg-primary text-primary' :
                  entry.type === 'error' ? 'badge-bg-destructive text-destructive' :
                  entry.type === 'deacon' ? 'badge-bg-secondary text-signal-review' :
                  'bg-popover text-foreground'
                }`}>
                  {entry.type}
                </span>
                <span className="text-foreground truncate flex-1">
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

      {/* Per-Project Specialists Section (PAN-378: replaced global specialist pool) */}
      {runningProjectSpecialists && runningProjectSpecialists.length > 0 && (
        <div className="bg-card rounded-lg">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="font-semibold text-foreground flex items-center gap-2">
              <Brain className="w-5 h-5 text-success" />
              Per-Project Specialists ({runningProjectSpecialists.length})
            </h2>
          </div>
          <div className="divide-y divide-gray-700">
            {runningProjectSpecialists.map((ps) => (
              <div
                key={ps.tmuxSession}
                onClick={() => onSelectAgent(ps.tmuxSession === selectedAgent ? null : ps.tmuxSession)}
                className={`p-4 cursor-pointer transition-colors flex items-center justify-between ${
                  ps.tmuxSession === selectedAgent ? 'bg-popover' : 'hover:bg-card'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <Brain className="w-5 h-5 text-success flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-foreground flex items-center gap-2 flex-wrap">
                      <span className="badge-bg-secondary text-signal-review px-1.5 py-0.5 rounded text-xs font-mono">
                        {ps.projectKey.toUpperCase()}
                      </span>
                      {ps.issueId && (
                        <span className="text-xs font-mono text-muted-foreground">{ps.issueId}</span>
                      )}
                      {ps.specialistType.replace('-', ' ').replace(/\b\w/g, c => c.toUpperCase())}
                      {ps.role && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-card text-muted-foreground font-mono">
                          :{ps.role}
                        </span>
                      )}
                      {ps.isRunning ? (
                        <span className="w-2 h-2 rounded-full bg-success animate-pulse flex-shrink-0" title="Running" />
                      ) : (
                        <span className="w-2 h-2 rounded-full bg-muted-foreground flex-shrink-0" title="Completed" />
                      )}
                    </div>
                    {ps.metadata?.currentActivity && ps.isRunning && (
                      <div className="text-xs text-muted-foreground mt-0.5 truncate" title={ps.metadata.currentActivity}>
                        {ps.metadata.currentActivity}
                      </div>
                    )}
                    <div className="text-xs text-muted-foreground font-mono mt-0.5 flex items-center gap-2">
                      {ps.metadata?.model && (
                        <span className="text-muted-foreground">{ps.metadata.model.split('/').pop()?.replace('claude-', '')}</span>
                      )}
                      {ps.metadata?.currentRun && (
                        <span>{ps.metadata.currentRun.split('-').slice(-1)[0] || ps.metadata.currentRun}</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <div className="text-right text-xs text-muted-foreground">
                    <div className={ps.isRunning ? 'text-success' : 'text-muted-foreground'}>
                      {ps.isRunning ? '● Running' : '○ Completed'}
                    </div>
                    {ps.metadata?.lastRunAt && (
                      <div className="flex items-center gap-1 justify-end">
                        <Radio className="w-3 h-3 text-muted-foreground" />
                        <LiveLastHeard timestamp={ps.metadata.lastRunAt} label="Last heard" />
                      </div>
                    )}
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      fetch(`/api/specialists/${ps.projectKey}/${ps.issueId}/${ps.specialistType}/kill`, { method: 'POST' })
                        .then(() => queryClient.invalidateQueries({ queryKey: ['project-specialists-running'] }));
                    }}
                    className="p-2 text-muted-foreground hover:text-destructive hover:bg-card rounded"
                    title={`Kill ${ps.specialistType} (${ps.projectKey}/${ps.issueId ?? 'unknown'})`}
                  >
                    <XCircle className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
