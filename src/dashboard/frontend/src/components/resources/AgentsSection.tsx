import type { Agent } from '../../types';

interface AgentsSectionProps {
  agents: Agent[];
  filter: string;
  onFocusRow: (id: string) => void;
  highlightedTarget?: string | null;
  onOpenTerminal?: (agent: Agent) => void;
  onPause?: (agent: Agent) => void;
}

export function AgentsSection({ agents, filter, highlightedTarget, onFocusRow, onOpenTerminal, onPause }: AgentsSectionProps) {
  const rows = agents.filter((agent) => matches(agent, filter));
  if (rows.length === 0) return null;

  return (
    <section className="mb-6" aria-label="Agents">
      <h2 className="mb-2 font-['DM_Mono'] text-xs uppercase text-muted-foreground">Agents · {rows.length}</h2>
      <div className="divide-y divide-border border border-border">
        {rows.map((agent) => {
          const stats = agent.resourceStats;
          const chip = stats?.statusChip;
          const subscriptionCovered = (stats?.burnUsdPerHour ?? 0) === 0 && (stats?.hypotheticalUsdPerHour ?? 0) > 0;
          return (
            <div
              key={agent.id}
              data-resource-target={`agent:${agent.id}`}
              className={`grid w-full grid-cols-[1fr_120px_120px_120px_120px_140px] items-center gap-3 bg-background px-4 py-3 text-sm hover:bg-muted/40 ${chip?.state === 'idle' ? 'opacity-60' : ''} ${highlightedTarget === `agent:${agent.id}` ? 'resource-row-highlight ring-2 ring-primary' : ''}`}
            >
              <button type="button" className="text-left focus:outline-none" onFocus={() => onFocusRow(`agent:${agent.id}`)}>
                <span className="block font-medium text-foreground">{agent.id}</span>
                <span className="block font-['DM_Mono'] text-xs text-muted-foreground">{agent.issueId ?? 'unassigned'} · {agent.role ?? 'agent'} · {agent.model}</span>
              </button>
              <span className="text-xs text-muted-foreground">
                {chip ? `${chip.state}${chip.state === 'idle' ? `-${chip.idleMinutes}m` : ''}${chip.fanOut ? ' · fan-out' : ''}` : agent.status}
              </span>
              <span className="font-['DM_Mono'] text-xs text-muted-foreground">{stats?.cpuPercent ?? 0}% CPU</span>
              <span className="font-['DM_Mono'] text-xs text-muted-foreground">{formatBytes(stats?.memoryBytes ?? 0)}</span>
              <span className="font-['DM_Mono'] text-xs text-muted-foreground" title={subscriptionCovered ? `Hypothetical ${formatUsd(stats?.hypotheticalUsdPerHour ?? 0)}/h` : undefined}>
                {formatUsd(stats?.burnUsdPerHour ?? 0)}/h · {formatUsd(stats?.totalUsd ?? agent.costSoFar ?? 0)}
              </span>
              <span className="flex justify-end gap-2">
                <button type="button" className="text-xs text-primary hover:underline" onClick={() => onOpenTerminal?.(agent)} onFocus={() => onFocusRow(`agent:${agent.id}`)}>Terminal</button>
                <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => onPause?.(agent)} onFocus={() => onFocusRow(`agent:${agent.id}`)}>Pause</button>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function matches(agent: Agent, filter: string) {
  const query = filter.trim().toLowerCase();
  if (!query) return true;
  return [agent.id, agent.issueId, agent.role, agent.model, agent.status]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(query));
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${bytes} B`;
}

function formatUsd(value: number) {
  return `$${value.toFixed(2)}`;
}
