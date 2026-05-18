/**
 * DockerStatsCollector — polls `docker stats` every 5 seconds and maintains
 * a rolling 5-minute history (60 samples) per container.
 *
 * Uses execAsync (non-blocking) per CLAUDE.md — never execSync.
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface ContainerStats {
  id: string;
  name: string;
  cpuPercent: number;
  memoryUsage: number;    // bytes
  memoryLimit: number;    // bytes
  memoryPercent: number;
  networkIn: number;      // bytes
  networkOut: number;     // bytes
  status: 'running' | 'stopped' | 'unhealthy' | 'restarting';
}

export interface DockerContainerLifecycle {
  id: string;
  name: string;
  status: string;
  state?: string;
  createdAt?: string;
}

export interface ContainerHistory {
  timestamps: number[];   // unix ms
  cpuPercent: number[];
  memoryPercent: number[];
}

interface DockerStatsRaw {
  ID: string;
  Name: string;
  CPUPerc: string;   // "1.23%"
  MemUsage: string;  // "100MiB / 2GiB"
  MemPerc: string;   // "4.88%"
  NetIO: string;     // "1.23kB / 456B"
}

interface DockerPsRaw {
  ID?: string;
  Names?: string;
  Name?: string;
  Status?: string;
  State?: string;
  CreatedAt?: string;
}

const HISTORY_MAX = 60; // 5 min at 5s intervals
let cachedContainerLifecycleSnapshot: DockerContainerLifecycle[] = [];
let cachedContainerLifecycleObservedAt: string | null = null;

export function getCachedDockerContainerLifecycleSnapshot(): DockerContainerLifecycle[] {
  return cachedContainerLifecycleSnapshot.map(container => ({ ...container }));
}

export function getCachedDockerContainerLifecycleObservedAt(): string | null {
  return cachedContainerLifecycleObservedAt;
}

export function resetCachedDockerContainerLifecycleSnapshotForTests(): void {
  cachedContainerLifecycleSnapshot = [];
  cachedContainerLifecycleObservedAt = null;
}

export function recordDockerContainerLifecycleSnapshot(
  containers: DockerContainerLifecycle[],
  observedAt = new Date().toISOString(),
): void {
  cachedContainerLifecycleSnapshot = containers.map(container => ({ ...container }));
  cachedContainerLifecycleObservedAt = observedAt;
}

function parsePercent(s: string): number {
  return parseFloat(s.replace('%', '')) || 0;
}

const BYTE_UNITS: Record<string, number> = {
  B: 1,
  kB: 1e3, KB: 1e3,
  MB: 1e6,
  GB: 1e9,
  MiB: 1024 ** 2,
  GiB: 1024 ** 3,
  TiB: 1024 ** 4,
};

function parseBytes(s: string): number {
  const m = s.trim().match(/^([\d.]+)\s*([a-zA-Z]+)?$/);
  if (!m) return 0;
  return parseFloat(m[1]) * (BYTE_UNITS[m[2] ?? 'B'] ?? 1);
}

function parseMemUsage(s: string): { usage: number; limit: number } {
  const [a, b] = s.split('/').map(p => p.trim());
  return { usage: parseBytes(a ?? '0'), limit: parseBytes(b ?? '0') };
}

function parseNetIO(s: string): { in: number; out: number } {
  const [a, b] = s.split('/').map(p => p.trim());
  return { in: parseBytes(a ?? '0'), out: parseBytes(b ?? '0') };
}

export class DockerStatsCollector {
  private history = new Map<string, ContainerHistory>();
  private current = new Map<string, ContainerStats>();
  private containerStatuses = new Map<string, string>(); // name → status string
  private timer: ReturnType<typeof setInterval> | null = null;

  async start(intervalMs = 5000): Promise<void> {
    await this.collect();
    this.timer = setInterval(() => {
      this.collect().catch((err) => {
        console.error('[docker-stats] Collection error:', err.message);
      });
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getStats(): ContainerStats[] {
    return Array.from(this.current.values());
  }

  getHistory(containerId: string): ContainerHistory {
    return this.history.get(containerId) ?? { timestamps: [], cpuPercent: [], memoryPercent: [] };
  }

  private async collect(): Promise<void> {
    try {
      // Fetch running container stats and all container statuses in parallel
      const [statsResult, psResult] = await Promise.all([
        execAsync(`docker stats --no-stream --format '{{json .}}' 2>/dev/null`, {
          encoding: 'utf-8',
          timeout: 10000,
        }).catch(() => ({ stdout: '', stderr: '' })),
        execAsync(`docker ps -a --format '{{json .}}' 2>/dev/null`, {
          encoding: 'utf-8',
          timeout: 5000,
        }).catch(() => ({ stdout: '', stderr: '' })),
      ]);

      const lifecycleContainers: DockerContainerLifecycle[] = [];
      this.containerStatuses.clear();
      for (const line of psResult.stdout.trim().split('\n')) {
        if (!line.trim()) continue;
        try {
          const raw = JSON.parse(line) as DockerPsRaw;
          const name = raw.Names ?? raw.Name;
          if (!raw.ID || !name) continue;
          const container: DockerContainerLifecycle = {
            id: raw.ID,
            name,
            status: raw.Status ?? '',
            state: raw.State,
            createdAt: raw.CreatedAt,
          };
          lifecycleContainers.push(container);
          this.containerStatuses.set(name, container.status.toLowerCase());
        } catch {
          // Skip malformed JSON lines.
        }
      }
      recordDockerContainerLifecycleSnapshot(lifecycleContainers);

      const now = Date.now();
      for (const line of statsResult.stdout.trim().split('\n')) {
        if (!line.trim()) continue;
        try {
          const raw: DockerStatsRaw = JSON.parse(line);
          const mem = parseMemUsage(raw.MemUsage);
          const net = parseNetIO(raw.NetIO);
          const cpu = parsePercent(raw.CPUPerc);
          const memPct = parsePercent(raw.MemPerc);

          const psStatus = this.containerStatuses.get(raw.Name) ?? '';
          let status: ContainerStats['status'] = 'running';
          if (psStatus.includes('unhealthy')) status = 'unhealthy';
          else if (psStatus.includes('restarting')) status = 'restarting';
          else if (!psStatus.startsWith('up')) status = 'stopped';

          const stats: ContainerStats = {
            id: raw.ID,
            name: raw.Name,
            cpuPercent: cpu,
            memoryUsage: mem.usage,
            memoryLimit: mem.limit,
            memoryPercent: memPct,
            networkIn: net.in,
            networkOut: net.out,
            status,
          };
          this.current.set(raw.ID, stats);

          let hist = this.history.get(raw.ID);
          if (!hist) {
            hist = { timestamps: [], cpuPercent: [], memoryPercent: [] };
            this.history.set(raw.ID, hist);
          }
          hist.timestamps.push(now);
          hist.cpuPercent.push(cpu);
          hist.memoryPercent.push(memPct);

          if (hist.timestamps.length > HISTORY_MAX) {
            hist.timestamps = hist.timestamps.slice(-HISTORY_MAX);
            hist.cpuPercent = hist.cpuPercent.slice(-HISTORY_MAX);
            hist.memoryPercent = hist.memoryPercent.slice(-HISTORY_MAX);
          }
        } catch {
          // Skip malformed JSON lines
        }
      }
    } catch {
      // Docker not available — skip silently
    }
  }
}

export interface DockerNetwork {
  id: string;
  name: string;
  driver: string;
  scope: string;
}

export interface DockerVolume {
  name: string;
  driver: string;
  mountpoint: string;
}

/**
 * List Docker networks via `docker network ls`.
 * Returns empty array if Docker is not available.
 */
export async function getDockerNetworks(): Promise<DockerNetwork[]> {
  try {
    const { stdout } = await execAsync(
      `docker network ls --format '{{json .}}' 2>/dev/null`,
      { encoding: 'utf-8', timeout: 5000 }
    );
    const networks: DockerNetwork[] = [];
    for (const line of stdout.trim().split('\n')) {
      if (!line.trim()) continue;
      try {
        const raw = JSON.parse(line);
        networks.push({
          id: raw.ID ?? '',
          name: raw.Name ?? '',
          driver: raw.Driver ?? '',
          scope: raw.Scope ?? '',
        });
      } catch {
        // Skip malformed lines
      }
    }
    return networks;
  } catch {
    return [];
  }
}

/**
 * List Docker volumes via `docker volume ls`.
 * Returns empty array if Docker is not available.
 */
export async function getDockerVolumes(): Promise<DockerVolume[]> {
  try {
    const { stdout } = await execAsync(
      `docker volume ls --format '{{json .}}' 2>/dev/null`,
      { encoding: 'utf-8', timeout: 5000 }
    );
    const volumes: DockerVolume[] = [];
    for (const line of stdout.trim().split('\n')) {
      if (!line.trim()) continue;
      try {
        const raw = JSON.parse(line);
        volumes.push({
          name: raw.Name ?? '',
          driver: raw.Driver ?? '',
          mountpoint: raw.Mountpoint ?? '',
        });
      } catch {
        // Skip malformed lines
      }
    }
    return volumes;
  } catch {
    return [];
  }
}
