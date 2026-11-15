/**
 * useContainerStats — Docker container stats for the deck's issues (PAN-5293
 * §6.1, F-D4, moved from CommandDeck/index.tsx). Polls `/api/resources` every
 * 5 s, and only while some issue reports containers.
 */

import { useEffect, useState } from 'react';
import type { ProjectData } from '../../CommandDeck/projectsData';

export interface ContainerStats {
  id: string;
  name: string;
  cpuPercent: number;
  memoryUsage: number;
  memoryLimit: number;
  memoryPercent: number;
  networkIn: number;
  networkOut: number;
  status: 'running' | 'stopped' | 'unhealthy' | 'restarting';
}

export function useContainerStats(projectsWithSessions: readonly ProjectData[]): Record<string, ContainerStats> {
  const [containerStats, setContainerStats] = useState<Record<string, ContainerStats>>({});

  // Poll container stats every 5s when issues have containers
  useEffect(() => {
    const hasContainers = projectsWithSessions.some((p) =>
      p.features.some((f) => (f.resourceDetails?.dockerContainerCount ?? 0) > 0),
    );
    if (!hasContainers) return;

    const fetchStats = async () => {
      try {
        const res = await fetch('/api/resources');
        if (!res.ok) return;
        const data = (await res.json()) as { containers: ContainerStats[] };
        const byName: Record<string, ContainerStats> = {};
        for (const c of data.containers) {
          byName[c.name] = c;
        }
        setContainerStats(byName);
      } catch {
        // ignore
      }
    };

    fetchStats();
    const interval = setInterval(fetchStats, 5000);
    return () => clearInterval(interval);
  }, [projectsWithSessions]);

  return containerStats;
}
