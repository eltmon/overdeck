import { Effect } from 'effect';
import { layer as nodeServicesLayer } from '@effect/platform-node/NodeServices';

import { DockerStatsCollector } from '../../../../lib/docker-stats.js';

let dockerStatsCollector: DockerStatsCollector | null = null;
let currentDockerStatsReader: (() => unknown[]) | null = null;

export function getDockerStatsCollector(): DockerStatsCollector {
  if (!dockerStatsCollector) {
    dockerStatsCollector = new DockerStatsCollector();
    Effect.runFork(
      dockerStatsCollector.start().pipe(Effect.provide(nodeServicesLayer)),
    );
  }
  return dockerStatsCollector;
}

export function getCurrentDockerStats(): unknown[] {
  if (currentDockerStatsReader) return currentDockerStatsReader();
  return dockerStatsCollector ? dockerStatsCollector.getStats() : [];
}

export function setCurrentDockerStatsReaderForTests(reader: () => unknown[]): void {
  currentDockerStatsReader = reader;
}

export function resetCurrentDockerStatsReaderForTests(): void {
  currentDockerStatsReader = null;
}

export function getContainerHistory(containerId: string): unknown {
  return dockerStatsCollector
    ? dockerStatsCollector.getHistory(containerId)
    : { timestamps: [], cpuPercent: [], memoryPercent: [] };
}

export function formatUptime(startedAt: string): string {
  const ms = Date.now() - new Date(startedAt).getTime();
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
