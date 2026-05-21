/**
 * DockerStatsCollector — polls `docker stats` every 5 seconds and maintains
 * a rolling 5-minute history (60 samples) per container.
 */

import { Effect, Schedule, Duration, Stream } from 'effect';
import { ChildProcess } from 'effect/unstable/process';
import { ChildProcessSpawner } from 'effect/unstable/process/ChildProcessSpawner';

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

// Run a docker subcommand and return its stdout as a string.
// Returns "" on any failure (docker unavailable, timeout, non-zero exit).
function runDockerForOutput(
  args: readonly string[],
  timeoutMs = 10000,
): Effect.Effect<string, never, ChildProcessSpawner> {
  return Effect.gen(function* () {
    const handle = yield* ChildProcess.make('docker', [...args], { stderr: 'ignore' });
    const chunks: Uint8Array[] = [];
    yield* Stream.runForEach(
      handle.stdout,
      (chunk) => Effect.sync(() => { chunks.push(chunk); }),
    );
    yield* handle.exitCode;
    return Buffer.concat(chunks).toString('utf-8');
  }).pipe(
    Effect.scoped,
    Effect.timeout(Duration.millis(timeoutMs)),
    Effect.catch(() => Effect.succeed('')),
  );
}

export class DockerStatsCollector {
  private history = new Map<string, ContainerHistory>();
  private current = new Map<string, ContainerStats>();
  private containerStatuses = new Map<string, string>(); // name → status string

  private collect(): Effect.Effect<void, never, ChildProcessSpawner> {
    const self = this;
    return Effect.gen(function* () {
      const [statsOut, psOut] = yield* Effect.all([
        runDockerForOutput(['stats', '--no-stream', '--format', '{{json .}}'], 10000),
        runDockerForOutput(['ps', '-a', '--format', '{{json .}}'], 5000),
      ], { concurrency: 2 });

      const lifecycleContainers: DockerContainerLifecycle[] = [];
      self.containerStatuses.clear();
      for (const line of psOut.trim().split('\n')) {
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
          self.containerStatuses.set(name, container.status.toLowerCase());
        } catch {
          // Skip malformed JSON lines.
        }
      }
      recordDockerContainerLifecycleSnapshot(lifecycleContainers);

      const now = Date.now();
      for (const line of statsOut.trim().split('\n')) {
        if (!line.trim()) continue;
        try {
          const raw: DockerStatsRaw = JSON.parse(line);
          const mem = parseMemUsage(raw.MemUsage);
          const net = parseNetIO(raw.NetIO);
          const cpu = parsePercent(raw.CPUPerc);
          const memPct = parsePercent(raw.MemPerc);

          const psStatus = self.containerStatuses.get(raw.Name) ?? '';
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
          self.current.set(raw.ID, stats);

          let hist = self.history.get(raw.ID);
          if (!hist) {
            hist = { timestamps: [], cpuPercent: [], memoryPercent: [] };
            self.history.set(raw.ID, hist);
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
    });
  }

  start(intervalMs = 5000): Effect.Effect<void, never, ChildProcessSpawner> {
    const self = this;
    return Effect.gen(function* () {
      yield* self.collect();
      yield* Effect.forkDetach(
        Effect.repeat(self.collect(), Schedule.fixed(Duration.millis(intervalMs))),
      );
    });
  }

  stop(): void {
    // No-op: polling fiber lifecycle is managed by the caller's Effect runtime.
  }

  getStats(): ContainerStats[] {
    return Array.from(this.current.values());
  }

  getHistory(containerId: string): ContainerHistory {
    return this.history.get(containerId) ?? { timestamps: [], cpuPercent: [], memoryPercent: [] };
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

export function getDockerNetworks(): Effect.Effect<DockerNetwork[], never, ChildProcessSpawner> {
  return Effect.gen(function* () {
    const stdout = yield* runDockerForOutput(['network', 'ls', '--format', '{{json .}}'], 5000);
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
  });
}

export function getDockerVolumes(): Effect.Effect<DockerVolume[], never, ChildProcessSpawner> {
  return Effect.gen(function* () {
    const stdout = yield* runDockerForOutput(['volume', 'ls', '--format', '{{json .}}'], 5000);
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
  });
}
