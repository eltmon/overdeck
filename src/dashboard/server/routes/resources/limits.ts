export interface ContainerLimitInput {
  id: string;
  name: string;
  memoryUsage?: number;
  memoryLimit?: number;
  labels?: Record<string, string>;
}

export interface ContainerOomEvent {
  containerId?: string;
  containerName?: string;
  timestamp: string;
}

export type MemoryLimitLevel = 'normal' | 'amber' | 'red';

export interface ContainerLimitFields {
  memLimitBytes: number | null;
  memPercentOfLimit?: number;
  oomKills24h: number;
  composeFile?: string;
}

const OOM_WINDOW_MS = 24 * 60 * 60 * 1000;
let cachedOomEvents: ContainerOomEvent[] = [];

export function recordContainerOomEventsForTests(events: ContainerOomEvent[]): void {
  cachedOomEvents = events.map((event) => ({ ...event }));
}

export function resetContainerOomEventsForTests(): void {
  cachedOomEvents = [];
}

export function enrichContainersWithLimits<T extends ContainerLimitInput>(
  containers: T[],
  options: {
    oomEvents?: ContainerOomEvent[];
    nowMs?: number;
  } = {},
): Array<T & ContainerLimitFields> {
  const nowMs = options.nowMs ?? Date.now();
  const oomEvents = options.oomEvents ?? cachedOomEvents;

  return containers.map((container) => {
    const limitBytes = getLimitBytes(container.memoryLimit);
    const percent = limitBytes === null
      ? undefined
      : Math.round(((container.memoryUsage ?? 0) / limitBytes) * 100);

    return {
      ...container,
      memLimitBytes: limitBytes,
      ...(percent === undefined ? {} : { memPercentOfLimit: percent }),
      oomKills24h: countRecentOomEvents(container, oomEvents, nowMs),
      ...composeFileHint(container.labels),
    };
  });
}

export function getMemoryLimitLevel(percent: number | undefined): MemoryLimitLevel {
  if (percent === undefined) return 'normal';
  if (percent >= 95) return 'red';
  if (percent >= 85) return 'amber';
  return 'normal';
}

function getLimitBytes(memoryLimit: number | undefined): number | null {
  if (!memoryLimit || memoryLimit <= 0 || !Number.isFinite(memoryLimit)) return null;
  return memoryLimit;
}

function countRecentOomEvents(
  container: ContainerLimitInput,
  events: ContainerOomEvent[],
  nowMs: number,
): number {
  const cutoffMs = nowMs - OOM_WINDOW_MS;
  return events.filter((event) => {
    const eventMs = Date.parse(event.timestamp);
    if (!Number.isFinite(eventMs) || eventMs < cutoffMs || eventMs > nowMs) return false;
    if (event.containerId && container.id.startsWith(event.containerId)) return true;
    if (event.containerName && event.containerName === container.name) return true;
    return false;
  }).length;
}

function composeFileHint(labels: Record<string, string> | undefined): { composeFile?: string } {
  const composeFile = labels?.['com.docker.compose.project.config_files'];
  if (!composeFile) return {};
  return { composeFile: composeFile.split(',')[0]?.trim() };
}
