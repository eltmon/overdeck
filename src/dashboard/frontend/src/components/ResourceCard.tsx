/**
 * ResourceCard — displays a container or agent resource card with
 * CPU/memory bars and sparkline history.
 */

import { ContainerStats, ContainerHistory, Agent } from '../types';
import { ResourceBar } from './ResourceBar';
import { Sparkline } from './Sparkline';

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)}GiB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)}MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)}KiB`;
  return `${bytes}B`;
}

interface ContainerCardProps {
  container: ContainerStats;
  history?: ContainerHistory;
  onClick: (container: ContainerStats) => void;
}

interface AgentCardProps {
  agent: Agent;
  onNavigate: (agentId: string) => void;
}

const STATUS_DOT: Record<ContainerStats['status'], string> = {
  running: 'bg-success',
  stopped: 'bg-destructive',
  unhealthy: 'bg-warning',
  restarting: 'bg-warning',
};

const STATUS_LABEL: Record<ContainerStats['status'], string> = {
  running: 'running',
  stopped: 'stopped',
  unhealthy: 'unhealthy',
  restarting: 'restarting',
};

const AGENT_STATUS_DOT: Record<Agent['status'], string> = {
  healthy: 'bg-success',
  warning: 'bg-warning',
  stuck: 'bg-warning',
  dead: 'bg-destructive',
  stopped: 'bg-popover',
  starting: 'bg-signal-review',
  running: 'bg-primary',
  failed: 'bg-destructive',
};

export function ContainerCard({ container, history, onClick }: ContainerCardProps) {
  const sparklineColor =
    container.cpuPercent >= 85 ? 'rgba(239,68,68,0.8)' :
    container.cpuPercent >= 60 ? 'rgba(234,179,8,0.8)' :
    'rgba(59,130,246,0.8)';

  return (
    <button
      onClick={() => onClick(container)}
      className="w-full text-left bg-card border border-border rounded-lg p-3 hover:border-primary/50 hover:bg-popover transition-colors"
    >
      <div className="flex items-center gap-2 mb-2">
        <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[container.status]}`} />
        <span className="text-xs font-medium text-foreground truncate flex-1" title={container.name}>
          {container.name}
        </span>
        <span className="text-xs text-muted-foreground shrink-0">{STATUS_LABEL[container.status]}</span>
      </div>

      <div className="flex gap-2 items-end">
        <div className="flex-1 space-y-1.5">
          <ResourceBar value={container.cpuPercent} label="CPU" />
          <ResourceBar value={container.memoryPercent} label="MEM" />
          {container.memoryLimit > 0 && (
            <div className="text-xs text-muted-foreground">
              {formatBytes(container.memoryUsage)} / {formatBytes(container.memoryLimit)}
            </div>
          )}
        </div>
        {history && history.cpuPercent.length > 1 && (
          <div className="shrink-0">
            <Sparkline data={history.cpuPercent} color={sparklineColor} height={36} />
          </div>
        )}
      </div>
    </button>
  );
}

export function AgentCard({ agent, onNavigate }: AgentCardProps) {
  return (
    <button
      onClick={() => onNavigate(agent.id)}
      className="w-full text-left bg-card border border-border rounded-lg p-3 hover:border-primary/50 hover:bg-popover transition-colors"
    >
      <div className="flex items-center gap-2 mb-2">
        <span className={`w-2 h-2 rounded-full shrink-0 ${AGENT_STATUS_DOT[agent.status]}`} />
        <span className="text-xs font-medium text-foreground truncate flex-1" title={agent.issueId ?? agent.id}>
          {agent.issueId ?? agent.id}
        </span>
        <span className="text-xs text-muted-foreground shrink-0">{agent.status}</span>
      </div>
      <div className="text-xs text-muted-foreground space-y-0.5">
        <div className="flex justify-between">
          <span>Model</span>
          <span className="text-foreground">{agent.model}</span>
        </div>
        <div className="flex justify-between">
          <span>Runtime</span>
          <span className="text-foreground">{agent.runtime}</span>
        </div>
        {agent.consecutiveFailures > 0 && (
          <div className="flex justify-between text-warning">
            <span>Failures</span>
            <span>{agent.consecutiveFailures}</span>
          </div>
        )}
      </div>
      <div className="mt-1.5 text-xs text-primary">Click to view in Agents →</div>
    </button>
  );
}
