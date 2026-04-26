/**
 * ResourcesPanel — unified grid view of all Panopticon-managed infrastructure.
 * Groups containers and agents by issue, type, or status.
 * Real-time data via Socket.io (resources:updated) with 5s polling fallback.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useResourceStats } from '../hooks/useResourceStats';
import { ContainerCard, AgentCard } from './ResourceCard';
import { ContainerDetailPanel } from './ContainerDetailPanel';
import { ContainerStats, ContainerHistory, Agent, ResourceGroupBy, ResourcesSnapshot } from '../types';

interface ResourceGroup {
  key: string;
  label: string;
  containers: ContainerStats[];
  agents: Agent[];
}

async function fetchResources(): Promise<ResourcesSnapshot> {
  const res = await fetch('/api/resources');
  if (!res.ok) throw new Error('Failed to fetch resources');
  return res.json();
}

async function fetchContainerHistory(containerId: string): Promise<ContainerHistory> {
  const res = await fetch(`/api/resources/${containerId}/history`);
  if (!res.ok) throw new Error('Failed to fetch history');
  return res.json();
}

type ContainerFilter = 'all' | 'running';

function groupResources(
  containers: ContainerStats[],
  agents: Agent[],
  groupBy: ResourceGroupBy
): ResourceGroup[] {
  if (groupBy === 'issue') {
    const groups = new Map<string, ResourceGroup>();

    for (const c of containers) {
      // Derive issue key from container name pattern: feature-<issue>-* or <issue>-*
      const issueMatch = c.name.match(/(?:feature[_-])?([A-Z]+-\d+)/i);
      const key = issueMatch ? issueMatch[1].toUpperCase() : '__ungrouped__';
      const label = issueMatch ? issueMatch[1].toUpperCase() : 'Ungrouped';
      if (!groups.has(key)) groups.set(key, { key, label, containers: [], agents: [] });
      groups.get(key)!.containers.push(c);
    }

    for (const a of agents) {
      const key = a.issueId ?? '__ungrouped__';
      const label = a.issueId ?? 'Ungrouped';
      if (!groups.has(key)) groups.set(key, { key, label, containers: [], agents: [] });
      groups.get(key)!.agents.push(a);
    }

    return Array.from(groups.values()).sort((a, b) => a.label.localeCompare(b.label));
  }

  if (groupBy === 'type') {
    const containerGroup: ResourceGroup = { key: 'containers', label: 'Containers', containers, agents: [] };
    const agentGroup: ResourceGroup = { key: 'agents', label: 'Agents', containers: [], agents };
    return [containerGroup, agentGroup].filter(g => g.containers.length + g.agents.length > 0);
  }

  // groupBy === 'status'
  const statusGroups = new Map<string, ResourceGroup>();
  for (const c of containers) {
    if (!statusGroups.has(c.status)) {
      statusGroups.set(c.status, { key: c.status, label: c.status.charAt(0).toUpperCase() + c.status.slice(1), containers: [], agents: [] });
    }
    statusGroups.get(c.status)!.containers.push(c);
  }
  for (const a of agents) {
    if (!statusGroups.has(a.status)) {
      statusGroups.set(a.status, { key: a.status, label: a.status.charAt(0).toUpperCase() + a.status.slice(1), containers: [], agents: [] });
    }
    statusGroups.get(a.status)!.agents.push(a);
  }
  return Array.from(statusGroups.values());
}

interface ResourcesPanelProps {
  onNavigateToAgents: (agentId: string) => void;
}

export function ResourcesPanel({ onNavigateToAgents }: ResourcesPanelProps) {
  const [groupBy, setGroupBy] = useState<ResourceGroupBy>('issue');
  const [filter, setFilter] = useState<ContainerFilter>('all');
  const [selectedContainer, setSelectedContainer] = useState<ContainerStats | null>(null);

  // Socket.io real-time updates + 5s polling fallback
  useResourceStats();

  const { data, isLoading, error } = useQuery<ResourcesSnapshot>({
    queryKey: ['resources'],
    queryFn: fetchResources,
    refetchInterval: 30000,
  });

  const { data: selectedHistory } = useQuery<ContainerHistory>({
    queryKey: ['container-history', selectedContainer?.id],
    queryFn: () => fetchContainerHistory(selectedContainer!.id),
    enabled: !!selectedContainer,
    refetchInterval: 30000,
  });

  if (isLoading) {
    return (
      <div className="p-6 text-muted-foreground text-sm">Loading resources…</div>
    );
  }

  if (error) {
    return (
      <div className="p-6 text-destructive text-sm">Failed to load resources: {(error as Error).message}</div>
    );
  }

  const containers = data?.containers ?? [];
  const agents = data?.agents ?? [];

  const filteredContainers = filter === 'running'
    ? containers.filter(c => c.status === 'running')
    : containers;

  const groups = groupResources(filteredContainers, agents, groupBy);
  const total = filteredContainers.length + agents.length;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-border shrink-0">
        <h2 className="text-sm font-semibold text-foreground">Resources</h2>
        <span className="text-xs text-muted-foreground">{total} items</span>

        <div className="flex items-center gap-1 ml-4">
          <span className="text-xs text-muted-foreground mr-1">Group by:</span>
          {(['issue', 'type', 'status'] as ResourceGroupBy[]).map(g => (
            <button
              key={g}
              onClick={() => setGroupBy(g)}
              className={`px-2 py-0.5 rounded text-xs transition-colors ${
                groupBy === g
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-popover'
              }`}
            >
              {g.charAt(0).toUpperCase() + g.slice(1)}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          {(['all', 'running'] as ContainerFilter[]).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2 py-0.5 rounded text-xs transition-colors ${
                filter === f
                  ? 'bg-popover text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-popover'
              }`}
            >
              {f === 'all' ? 'All' : 'Running only'}
            </button>
          ))}
        </div>

        {data?.updatedAt && (
          <span className="ml-auto text-xs text-muted-foreground">
            Updated {new Date(data.updatedAt).toLocaleTimeString()}
          </span>
        )}
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-auto p-6">
        {total === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
            <div className="text-4xl mb-3">📦</div>
            <div className="text-sm">No containers or agents found</div>
            <div className="text-xs mt-1">Docker may not be running or no workspaces are active</div>
          </div>
        ) : (
          <div className="space-y-6">
            {groups.map(group => (
              <div key={group.key}>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                  {group.label}
                  <span className="ml-2 font-normal text-muted-foreground/60">
                    ({group.containers.length + group.agents.length})
                  </span>
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                  {group.containers.map(container => (
                    <ContainerCard
                      key={container.id}
                      container={container}
                      history={data?.containers ? undefined : undefined}
                      onClick={setSelectedContainer}
                    />
                  ))}
                  {group.agents.map(agent => (
                    <AgentCard
                      key={agent.id}
                      agent={agent}
                      onNavigate={onNavigateToAgents}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Container detail slide-out */}
      {selectedContainer && (
        <ContainerDetailPanel
          container={selectedContainer}
          history={selectedHistory ?? { timestamps: [], cpuPercent: [], memoryPercent: [] }}
          onClose={() => setSelectedContainer(null)}
        />
      )}
    </div>
  );
}
