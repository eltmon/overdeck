import { useQuery } from '@tanstack/react-query';
import { AgentHealth } from '../types';
import { Activity, AlertTriangle, CheckCircle, XCircle, Clock, Brain } from 'lucide-react';
import { TldrServiceStatus } from './TldrServiceStatus';

async function fetchHealth(): Promise<AgentHealth[]> {
  const res = await fetch('/api/health/agents');
  if (!res.ok) throw new Error('Failed to fetch health');
  return res.json();
}

interface ProjectSpecialistStatus {
  projectKey: string;
  specialistType: string;
  metadata: {
    runCount: number;
    lastRunAt: string | null;
    lastRunStatus: 'passed' | 'failed' | 'blocked' | null;
    currentRun: string | null;
  };
  isRunning: boolean;
  tmuxSession: string;
}

async function fetchProjectSpecialists(): Promise<ProjectSpecialistStatus[]> {
  const res = await fetch('/api/specialists/projects');
  if (!res.ok) throw new Error('Failed to fetch project specialists');
  return res.json();
}

const STATUS_CONFIG: Record<AgentHealth['status'], { icon: typeof CheckCircle; color: string; bg: string }> = {
  healthy: { icon: CheckCircle, color: 'text-success', bg: 'badge-bg-success' },
  warning: { icon: AlertTriangle, color: 'text-warning', bg: 'badge-bg-warning' },
  stuck: { icon: Clock, color: 'text-warning', bg: 'badge-bg-warning' },
  dead: { icon: XCircle, color: 'text-destructive', bg: 'badge-bg-destructive' },
};

const PROJECT_RUN_STATUS_CONFIG = {
  passed: { icon: CheckCircle, color: 'text-success' },
  failed: { icon: XCircle, color: 'text-destructive' },
  blocked: { icon: AlertTriangle, color: 'text-warning' },
} as const;

export function HealthDashboard() {
  const { data: health, isLoading, error } = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    refetchInterval: 5000,
  });

  const { data: projectSpecialists } = useQuery({
    queryKey: ['project-specialists'],
    queryFn: fetchProjectSpecialists,
    refetchInterval: 5000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">Loading health data...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-destructive">Error: {(error as Error).message}</div>
      </div>
    );
  }

  if (!health || health.length === 0) {
    return (
      <div className="bg-card rounded-lg p-8 text-center">
        <Activity className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
        <h3 className="text-lg font-medium text-muted-foreground">No agents to monitor</h3>
        <p className="text-sm text-muted-foreground mt-2">
          Health data will appear here when agents are running
        </p>
      </div>
    );
  }

  // Summary counts
  const counts = health.reduce(
    (acc, h) => {
      acc[h.status] = (acc[h.status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  return (
    <div className="space-y-6">
      {/* TLDR Service Status */}
      <TldrServiceStatus />

      {/* Summary */}
      <div className="grid grid-cols-4 gap-4">
        {(['healthy', 'warning', 'stuck', 'dead'] as const).map((status) => {
          const config = STATUS_CONFIG[status];
          const Icon = config.icon;
          return (
            <div
              key={status}
              className={`${config.bg} rounded-lg p-4 border border-border`}
            >
              <div className="flex items-center gap-3">
                <Icon className={`w-8 h-8 ${config.color}`} />
                <div>
                  <div className="text-2xl font-bold text-foreground">{counts[status] || 0}</div>
                  <div className="text-sm text-muted-foreground capitalize">{status}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Per-Project Specialist Health */}
      {projectSpecialists && projectSpecialists.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase mb-3 flex items-center gap-2">
            <Brain className="w-4 h-4 text-signal-review" />
            Per-Project Specialists
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {projectSpecialists.map((ps) => {
              const statusConfig = ps.metadata.lastRunStatus
                ? PROJECT_RUN_STATUS_CONFIG[ps.metadata.lastRunStatus]
                : null;
              const StatusIcon = statusConfig?.icon;
              return (
                <div
                  key={`${ps.projectKey}/${ps.specialistType}`}
                  className={`rounded-lg p-4 border border-border ${
                    ps.isRunning ? 'badge-bg-success' : 'bg-card'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-medium text-foreground flex items-center gap-2">
                        <span className="badge-bg-secondary text-signal-review px-1.5 py-0.5 rounded text-xs font-mono">
                          {ps.projectKey.toUpperCase()}
                        </span>
                        {ps.specialistType}
                      </div>
                      <div className={`flex items-center gap-1 text-sm mt-1 ${ps.isRunning ? 'text-success' : 'text-muted-foreground'}`}>
                        {ps.isRunning ? (
                          <><span className="w-2 h-2 rounded-full bg-success animate-pulse" /> Running</>
                        ) : (
                          <><Clock className="w-3.5 h-3.5" /> Idle</>
                        )}
                      </div>
                    </div>
                    {StatusIcon && (
                      <StatusIcon className={`w-5 h-5 ${statusConfig.color}`} />
                    )}
                  </div>
                  <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                    <div className="flex justify-between">
                      <span>Run count:</span>
                      <span>{ps.metadata.runCount}</span>
                    </div>
                    {ps.metadata.lastRunStatus && (
                      <div className="flex justify-between">
                        <span>Last result:</span>
                        <span className={statusConfig?.color}>{ps.metadata.lastRunStatus}</span>
                      </div>
                    )}
                    {ps.metadata.lastRunAt && (
                      <div className="flex justify-between">
                        <span>Last run:</span>
                        <span>{new Date(ps.metadata.lastRunAt).toLocaleTimeString()}</span>
                      </div>
                    )}
                    {ps.isRunning && (
                      <div className="flex justify-between">
                        <span>Session:</span>
                        <span className="font-mono truncate max-w-[120px]">{ps.tmuxSession}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Agent cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {health.map((agent) => {
          const config = STATUS_CONFIG[agent.status];
          const Icon = config.icon;
          // Parse issue-scoped specialist session name: specialist-{projectKey}-{issueId}-{type}
          const ephemeralMatch = agent.agentId.match(/^specialist-(.+)-([A-Z]+-\d+)-(merge-agent|review-agent|test-agent)$/);
          return (
            <div
              key={agent.agentId}
              className={`${config.bg} rounded-lg p-4 border border-border`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-medium text-foreground flex items-center gap-2 flex-wrap">
                    {ephemeralMatch && (
                      <>
                        <span className="badge-bg-secondary text-signal-review px-1.5 py-0.5 rounded text-xs font-mono">
                          {ephemeralMatch[1].toUpperCase()}
                        </span>
                        <span className="badge-bg-secondary text-primary px-1.5 py-0.5 rounded text-xs font-mono">
                          {ephemeralMatch[2]}
                        </span>
                      </>
                    )}
                    {agent.agentId}
                  </div>
                  <div className={`flex items-center gap-1 text-sm ${config.color} mt-1`}>
                    <Icon className="w-4 h-4" />
                    <span className="capitalize">{agent.status}</span>
                  </div>
                </div>
              </div>

              {agent.reason && (
                <div className="mt-2 text-sm text-muted-foreground italic">
                  {agent.reason}
                </div>
              )}

              <div className="mt-4 space-y-2 text-sm">
                {agent.lastPing && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Last ping:</span>
                    <span>{new Date(agent.lastPing).toLocaleTimeString()}</span>
                  </div>
                )}
                <div className="flex justify-between text-muted-foreground">
                  <span>Failures:</span>
                  <span className={agent.consecutiveFailures > 0 ? 'text-warning' : ''}>
                    {agent.consecutiveFailures}
                  </span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Kill count:</span>
                  <span className={agent.killCount > 0 ? 'text-destructive' : ''}>
                    {agent.killCount}
                  </span>
                </div>
                {agent.contextPercent != null && (
                  <div className="flex justify-between text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Brain className="w-3.5 h-3.5" />
                      Context:
                    </span>
                    <span className={
                      agent.contextPercent >= 80 ? 'text-destructive' :
                      agent.contextPercent >= 60 ? 'text-warning' :
                      'text-success'
                    }>
                      {agent.contextPercent}%
                    </span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
