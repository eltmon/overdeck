/**
 * ResourcesPanel — unified grid view of all Overdeck-managed infrastructure.
 * Groups containers and agents by issue, type, or status.
 * Real-time data via Socket.io (resources:updated) with 5s polling fallback.
 */

import { useQuery } from '@tanstack/react-query';
import { useResourceStats } from '../hooks/useResourceStats';
import { MachineRoom } from './resources/MachineRoom';
import { ResourcesSnapshot } from '../types';

async function fetchResources(): Promise<ResourcesSnapshot> {
  const res = await fetch('/api/resources');
  if (!res.ok) throw new Error('Failed to fetch resources');
  return res.json();
}

interface ResourcesPanelProps {
  onNavigateToAgents: (agentId: string) => void;
}

export function ResourcesPanel({ onNavigateToAgents }: ResourcesPanelProps) {
  // Socket.io real-time updates + 5s polling fallback
  useResourceStats();

  const { data, isLoading, error, refetch } = useQuery<ResourcesSnapshot>({
    queryKey: ['resources'],
    queryFn: fetchResources,
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

  return (
    <MachineRoom
      snapshot={data ?? { containers: [], agents: [], updatedAt: new Date().toISOString() }}
      onNavigateToAgents={onNavigateToAgents}
      onRefresh={() => { void refetch(); }}
    />
  );
}
