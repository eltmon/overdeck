import {
  AgentHealthSnapshot as AgentHealthSnapshotSchema,
  type AgentHealthSnapshot,
  type AgentHealthStatus,
  type HealthState,
} from '@overdeck/contracts';
import { useQuery } from '@tanstack/react-query';
import { Effect, Schema } from 'effect';
import {
  Activity,
  AlertTriangle,
  Brain,
  CheckCircle,
  CircleHelp,
  Clock,
  Cpu,
  Hourglass,
  MemoryStick,
  Skull,
  XCircle,
  type LucideIcon,
} from 'lucide-react';

import { useSystemHealth } from '../hooks/useSystemHealth';
import { DeaconStatus } from './CommandDeck/DeaconStatus';
import { TldrServiceStatus } from './TldrServiceStatus';

async function fetchHealth(): Promise<AgentHealthSnapshot[]> {
  const res = await fetch('/api/health/agents');
  if (!res.ok) throw new Error('Failed to fetch health');
  const payload: unknown = await res.json();
  return Effect.runPromise(
    Schema.decodeUnknownEffect(Schema.Array(AgentHealthSnapshotSchema))(payload),
  );
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

interface StatusConfig {
  icon: LucideIcon;
  color: string;
  bg: string;
  label: string;
}

const STATUS_CONFIG = {
  healthy: { icon: CheckCircle, color: 'text-success', bg: 'badge-bg-success', label: 'Healthy' },
  idle: { icon: Clock, color: 'text-muted-foreground', bg: 'bg-card', label: 'Idle' },
  waiting: { icon: Hourglass, color: 'text-info', bg: 'badge-bg-info', label: 'Waiting' },
  warning: { icon: AlertTriangle, color: 'text-warning', bg: 'badge-bg-warning', label: 'Warning' },
  stalled: { icon: Clock, color: 'text-warning', bg: 'badge-bg-warning', label: 'Stalled' },
  wedged: { icon: Skull, color: 'text-destructive', bg: 'badge-bg-destructive', label: 'Wedged' },
  dead: { icon: XCircle, color: 'text-destructive', bg: 'badge-bg-destructive', label: 'Dead' },
  unavailable: { icon: CircleHelp, color: 'text-muted-foreground', bg: 'bg-muted', label: 'Unavailable' },
} satisfies Record<AgentHealthStatus, StatusConfig>;

const STATUS_ORDER = [
  'healthy',
  'idle',
  'waiting',
  'warning',
  'stalled',
  'wedged',
  'dead',
  'unavailable',
] as const satisfies readonly AgentHealthStatus[];

const PROJECT_RUN_STATUS_CONFIG = {
  passed: { icon: CheckCircle, color: 'text-success' },
  failed: { icon: XCircle, color: 'text-destructive' },
  blocked: { icon: AlertTriangle, color: 'text-warning' },
} as const;

function acceptedStatus(status: string): AgentHealthStatus {
  return Object.hasOwn(STATUS_CONFIG, status)
    ? status as AgentHealthStatus
    : 'unavailable';
}

function formatBytes(bytes: number | null): string {
  if (bytes == null) return 'Unavailable';
  const gib = bytes / (1024 ** 3);
  return `${Number.isInteger(gib) ? gib.toFixed(0) : gib.toFixed(1)} GB`;
}

function hostStateLabel(state: HealthState | undefined): string {
  switch (state) {
    case 'measuring':
      return 'Measuring';
    case 'healthy':
      return 'Healthy';
    case 'warning':
      return 'Warning';
    case 'critical':
      return 'Critical';
    case 'unavailable':
    case undefined:
      return 'Unavailable';
  }
}

function lifecycleLabel(agent: AgentHealthSnapshot): string | null {
  switch (agent.lifecycle) {
    case 'warm':
      return 'Warm · reusable';
    case 'orphaned':
      return 'Orphaned · reclaimable';
    case 'active':
      return 'Active session';
    case 'unknown':
    case undefined:
      return null;
  }
}

function AgentCard({ agent }: { agent: AgentHealthSnapshot }) {
  const status = acceptedStatus(agent.status);
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;
  const lifecycle = lifecycleLabel(agent);
  const ephemeralMatch = agent.id.match(
    /^specialist-(.+)-([A-Z]+-\d+)-(merge-agent|review-agent|test-agent)$/,
  );

  return (
    <div className={`${config.bg} rounded-lg p-4 border border-border`}>
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
            {agent.id}
          </div>
          <div
            className={`flex items-center gap-1 text-sm ${config.color} mt-1`}
            aria-label={`${agent.id} status: ${config.label}`}
          >
            <Icon aria-hidden="true" className="w-4 h-4" />
            <span>{config.label}</span>
          </div>
          {lifecycle && (
            <div className="mt-1 text-xs text-muted-foreground">{lifecycle}</div>
          )}
        </div>
      </div>

      {agent.reasons.length > 0 && (
        <div className="mt-2 text-sm text-muted-foreground italic">
          {agent.reasons.map((reason) => reason.message).join(' ')}
        </div>
      )}

      <div className="mt-4 space-y-2 text-sm">
        {agent.lastActivityAt && (
          <div className="flex justify-between text-muted-foreground">
            <span>Last activity:</span>
            <span>{new Date(agent.lastActivityAt).toLocaleTimeString()}</span>
          </div>
        )}
        {agent.consecutiveFailures != null && (
          <div className="flex justify-between text-muted-foreground">
            <span>Failures:</span>
            <span className={agent.consecutiveFailures > 0 ? 'text-warning' : ''}>
              {agent.consecutiveFailures}
            </span>
          </div>
        )}
        {agent.killCount != null && (
          <div className="flex justify-between text-muted-foreground">
            <span>Kill count:</span>
            <span className={agent.killCount > 0 ? 'text-destructive' : ''}>
              {agent.killCount}
            </span>
          </div>
        )}
        {agent.contextPercent != null && (
          <div className="flex justify-between text-muted-foreground">
            <span className="flex items-center gap-1">
              <Brain className="w-3.5 h-3.5" />
              Context:
            </span>
            <span className={
              agent.contextPercent >= 80 ? 'text-destructive'
                : agent.contextPercent >= 60 ? 'text-warning'
                  : 'text-success'
            }>
              {agent.contextPercent}%
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export function HealthDashboard() {
  const {
    data: systemHealth,
    isLoading: isHealthLoading,
    error: healthError,
  } = useSystemHealth();
  const {
    data: health,
    isLoading: isAgentHealthLoading,
    error: agentHealthError,
  } = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    refetchInterval: 5000,
  });
  const { data: projectSpecialists } = useQuery({
    queryKey: ['project-specialists'],
    queryFn: fetchProjectSpecialists,
    refetchInterval: 5000,
  });

  const agents = health ?? [];
  const counts = agents.reduce<Record<AgentHealthStatus, number>>(
    (acc, agent) => {
      acc[acceptedStatus(agent.status)] += 1;
      return acc;
    },
    {
      healthy: 0,
      idle: 0,
      waiting: 0,
      warning: 0,
      stalled: 0,
      wedged: 0,
      dead: 0,
      unavailable: 0,
    },
  );
  const reclaimable = agents.filter((agent) => agent.lifecycle === 'orphaned');
  const hostMetrics = systemHealth?.host.metrics;

  return (
    <div className="space-y-6">
      <section aria-labelledby="host-health-title" className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 id="host-health-title" className="font-medium text-foreground">Host health</h2>
            <div className="text-sm text-muted-foreground">
              {isHealthLoading ? 'Measuring' : hostStateLabel(systemHealth?.host.state)}
            </div>
          </div>
          <div className="flex gap-5 text-sm">
            <div className="flex items-center gap-2">
              <Cpu aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
              <span>{hostMetrics?.cpuPercent == null ? 'CPU unavailable' : `${hostMetrics.cpuPercent.toFixed(1)}% CPU`}</span>
            </div>
            <div className="flex items-center gap-2">
              <MemoryStick aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
              <span>
                {hostMetrics?.availableMemoryBytes == null
                  ? 'Memory unavailable'
                  : `${formatBytes(hostMetrics.availableMemoryBytes)} available`}
              </span>
            </div>
          </div>
        </div>
        {healthError && (
          <div className="mt-2 text-sm text-muted-foreground">System health is unavailable.</div>
        )}
      </section>

      <DeaconStatus />
      <TldrServiceStatus />

      <section aria-labelledby="agent-health-title" className="space-y-4">
        <h2 id="agent-health-title" className="text-sm font-semibold text-muted-foreground uppercase">
          Agent health
        </h2>

        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-4">
          {STATUS_ORDER.map((status) => {
            const config = STATUS_CONFIG[status];
            const Icon = config.icon;
            return (
              <div
                key={status}
                className={`${config.bg} rounded-lg p-4 border border-border`}
                aria-label={`${config.label} agents: ${counts[status]}`}
              >
                <div className="flex items-center gap-3">
                  <Icon aria-hidden="true" className={`w-8 h-8 ${config.color}`} />
                  <div>
                    <div className="text-2xl font-bold text-foreground">{counts[status]}</div>
                    <div className="text-sm text-muted-foreground">{config.label}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {isAgentHealthLoading ? (
          <div className="bg-card rounded-lg p-8 text-center text-muted-foreground">
            Loading agent health…
          </div>
        ) : agentHealthError ? (
          <div className="bg-card rounded-lg p-8 text-center text-muted-foreground">
            Agent health is unavailable.
          </div>
        ) : agents.length === 0 ? (
          <div className="bg-card rounded-lg p-8 text-center">
            <Activity className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium text-muted-foreground">No agents to monitor</h3>
            <p className="text-sm text-muted-foreground mt-2">
              Host and service health remain available while no agent sessions are registered.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {agents.map((agent) => <AgentCard key={agent.id} agent={agent} />)}
          </div>
        )}
      </section>

      {reclaimable.length > 0 && (
        <section aria-labelledby="reclaimable-sessions-title" className="space-y-3">
          <h2 id="reclaimable-sessions-title" className="text-sm font-semibold text-muted-foreground uppercase">
            Reclaimable sessions
          </h2>
          <div className="rounded-lg border border-warning/40 bg-warning/10 p-4">
            {reclaimable.map((agent) => (
              <div key={agent.id} className="text-sm text-foreground">{agent.id}</div>
            ))}
          </div>
        </section>
      )}

      {projectSpecialists && projectSpecialists.length > 0 && (
        <section>
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
                    {StatusIcon && statusConfig && (
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
        </section>
      )}
    </div>
  );
}
