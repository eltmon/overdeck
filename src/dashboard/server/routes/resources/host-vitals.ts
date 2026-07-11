import { freemem, loadavg, totalmem } from 'node:os';

export interface HostVitalsContainer {
  id?: string;
  status?: string;
  labels?: Record<string, string>;
}

export interface HostVitalsAgent {
  id: string;
  lastActivity?: string;
  hasLiveTmuxSession?: boolean;
}

export interface HostVitalsAgentFleet {
  burnUsdPerHour?: number;
  hypotheticalUsdPerHour?: number;
  totalUsd?: number;
}

export interface HostVitalsOptions {
  nowMs?: number;
  cpuPercent?: number;
  load?: [number, number, number];
  containers?: HostVitalsContainer[];
  dockerStale?: boolean;
  agents?: HostVitalsAgent[];
  agentFleet?: HostVitalsAgentFleet;
  mem?: {
    usedBytes: number;
    availableBytes: number;
    swapUsedBytes: number;
    swapTotalBytes: number;
  };
  disk?: {
    usedBytes: number;
    freeBytes: number;
    reclaimableBytes?: number;
  };
  networkCount?: number;
  networkPoolTotal?: number;
}

export interface HostVitalsSnapshot {
  stale: boolean;
  cpu: {
    percent: number;
    load: [number, number, number];
    spark: number[];
  };
  mem: {
    usedBytes: number;
    availableBytes: number;
    swapUsedBytes: number;
    swapTotalBytes: number;
  };
  disk: {
    usedBytes: number;
    freeBytes: number;
    reclaimableBytes: number;
  };
  docker: {
    containers: number;
    running: number;
    stacks: number;
    networks: number;
    networkPool: {
      used: number;
      total: number;
    };
    stale: boolean;
  };
  agents: {
    sessions: number;
    active: number;
    idleOver15m: number;
    burnUsdPerHour: number;
    hypotheticalUsdPerHour: number;
    totalUsd: number;
  };
}

interface DockerCounts {
  containers: number;
  running: number;
  stacks: number;
  networks: number;
  networkPool: {
    used: number;
    total: number;
  };
}

const CPU_SPARK_MAX = 30;
let cpuSpark: number[] = [];
let cachedDockerCounts: DockerCounts = {
  containers: 0,
  running: 0,
  stacks: 0,
  networks: 0,
  networkPool: { used: 0, total: 31 },
};

export function resetHostVitalsForTests(): void {
  cpuSpark = [];
  cachedDockerCounts = {
    containers: 0,
    running: 0,
    stacks: 0,
    networks: 0,
    networkPool: { used: 0, total: 31 },
  };
}

export function buildHostVitalsSnapshot(options: HostVitalsOptions = {}): HostVitalsSnapshot {
  const cpuPercent = roundOneDecimal(options.cpuPercent ?? 0);
  cpuSpark.push(cpuPercent);
  cpuSpark = cpuSpark.slice(-CPU_SPARK_MAX);

  const dockerCounts = options.dockerStale
    ? cachedDockerCounts
    : computeDockerCounts(options.containers ?? [], options.networkCount ?? 0, options.networkPoolTotal ?? 31);
  if (!options.dockerStale) cachedDockerCounts = dockerCounts;

  const memory = options.mem ?? getDefaultMemoryVitals();
  const disk = options.disk ?? { usedBytes: 0, freeBytes: 0, reclaimableBytes: 0 };
  const agentCounts = computeAgentCounts(options.agents ?? [], options.agentFleet ?? {}, options.nowMs ?? Date.now());

  return {
    stale: options.dockerStale === true,
    cpu: {
      percent: cpuPercent,
      load: options.load ?? normalizeLoad(loadavg()),
      spark: [...cpuSpark],
    },
    mem: memory,
    disk: {
      usedBytes: disk.usedBytes,
      freeBytes: disk.freeBytes,
      reclaimableBytes: disk.reclaimableBytes ?? 0,
    },
    docker: {
      ...dockerCounts,
      stale: options.dockerStale === true,
    },
    agents: agentCounts,
  };
}

function computeDockerCounts(
  containers: HostVitalsContainer[],
  networkCount: number,
  networkPoolTotal: number,
): DockerCounts {
  const stacks = new Set<string>();
  for (const container of containers) {
    const project = container.labels?.['com.docker.compose.project'];
    if (project) stacks.add(project);
  }

  return {
    containers: containers.length,
    running: containers.filter((container) => container.status === 'running').length,
    stacks: stacks.size,
    networks: networkCount,
    networkPool: {
      used: networkCount,
      total: networkPoolTotal,
    },
  };
}

function computeAgentCounts(
  agents: HostVitalsAgent[],
  fleet: HostVitalsAgentFleet,
  nowMs: number,
): HostVitalsSnapshot['agents'] {
  return {
    sessions: agents.length,
    active: agents.filter((agent) => agent.hasLiveTmuxSession).length,
    idleOver15m: agents.filter((agent) => {
      const lastActivityMs = Date.parse(agent.lastActivity ?? '');
      return Number.isFinite(lastActivityMs) && nowMs - lastActivityMs > 15 * 60 * 1000;
    }).length,
    burnUsdPerHour: fleet.burnUsdPerHour ?? 0,
    hypotheticalUsdPerHour: fleet.hypotheticalUsdPerHour ?? 0,
    totalUsd: fleet.totalUsd ?? 0,
  };
}

function getDefaultMemoryVitals(): HostVitalsSnapshot['mem'] {
  const total = totalmem();
  const available = freemem();
  return {
    usedBytes: Math.max(0, total - available),
    availableBytes: available,
    swapUsedBytes: 0,
    swapTotalBytes: 0,
  };
}

function normalizeLoad(load: number[]): [number, number, number] {
  return [
    roundOneDecimal(load[0] ?? 0),
    roundOneDecimal(load[1] ?? 0),
    roundOneDecimal(load[2] ?? 0),
  ];
}

function roundOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}
