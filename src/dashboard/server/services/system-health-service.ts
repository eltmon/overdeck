import { exec } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { cpus, freemem, loadavg, totalmem, homedir, platform } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { DashboardSnapshot } from '@panctl/contracts';

import { listRunningAgentsAsync, getAgentRuntimeStateAsync, type AgentState } from '../../../lib/agents.js';
import { resolveProjectFromIssue } from '../../../lib/projects.js';
import { listPaneValuesAsync } from '../../../lib/tmux.js';
import { DockerStatsCollector, type ContainerStats } from '../../../lib/docker-stats.js';
import { initEventStore } from '../event-store.js';

const execAsync = promisify(exec);
const DEFAULT_HEALTH_POLL_SECONDS = 15;
const DEFAULT_RESOURCE_CONFIG = {
  memoryWarnGb: 4,
  memoryBlockGb: 2,
  agentWarnCount: 8,
  agentBlockCount: 10,
};
const KB = 1024;
const GIB = 1024 ** 3;
const GLOBAL_CONFIG_PATH = join(homedir(), '.panopticon', 'config.yaml');

type SystemHealthSeverity = 'normal' | 'warning' | 'critical';

interface SystemHealthThresholds {
  memoryAvailableWarningBytes: number;
  memoryAvailableCriticalBytes: number;
  swapUsedWarningPercent: number;
  swapUsedCriticalPercent: number;
  cpuLoadWarningPerCore: number;
  cpuLoadCriticalPerCore: number;
  overcommitWarningPercent: number;
  overcommitCriticalPercent: number;
}

interface ProcMemorySnapshot {
  memTotal: number;
  memAvailable: number;
  memFree: number;
  swapTotal: number;
  swapFree: number;
  committedAs: number;
  commitLimit: number;
}

interface CpuSample {
  idle: number;
  total: number;
}

interface ProcessRow {
  pid: number;
  ppid: number;
  rssKb: number;
  command: string;
}

export interface HealthAgentProcess {
  id: string;
  issueId: string;
  kind: 'work' | 'planning' | 'specialist' | 'other';
  status: AgentState['status'];
  tmuxActive: boolean;
  memoryBytes: number;
  memoryGb: number;
  currentIssue?: string;
}

export interface HealthLeakedSpecialist {
  name: string;
  currentIssue: string;
  reason: string;
}

export interface HealthConsumer {
  id: string;
  label: string;
  type: 'agent' | 'specialist' | 'container';
  memoryBytes: number;
  memoryGb: number;
  cpuPercent?: number;
  issueId?: string;
  currentIssue?: string;
  leaked?: boolean;
  killTarget?: {
    kind: 'agent' | 'specialist' | 'container';
    agentId?: string;
    containerId?: string;
    projectKey?: string;
    issueId?: string;
    specialistType?: string;
  };
}

export interface SystemHealthSnapshot {
  severity: SystemHealthSeverity;
  updatedAt: string;
  summary: {
    cpuPercent: number;
    loadAverage1m: number;
    loadPerCore1m: number;
    totalMemoryBytes: number;
    usedMemoryBytes: number;
    availableMemoryBytes: number;
    memoryUsedPercent: number;
    swapTotalBytes: number;
    swapUsedBytes: number;
    swapUsedPercent: number;
    overcommitPercent: number;
    agentCount: number;
    workAgentCount: number;
    planningAgentCount: number;
    specialistSessionCount: number;
    leakedSpecialistCount: number;
    containerCount: number;
    containerMemoryBytes: number;
    panopticonMemoryBytes: number;
    panopticonMemoryPercent: number;
  };
  thresholds: SystemHealthThresholds;
  reasons: string[];
  agents: HealthAgentProcess[];
  leakedSpecialists: HealthLeakedSpecialist[];
  topConsumers: HealthConsumer[];
}

let dockerStatsCollector: DockerStatsCollector | null = null;
let previousCpuSample: CpuSample | null = null;
let previousCpuSampleAt = 0;
let cachedHealth: SystemHealthSnapshot | null = null;
let cacheExpiresAt = 0;
let inflightRefresh: Promise<SystemHealthSnapshot> | null = null;
let previousSeverity: SystemHealthSeverity | null = null;
let candidateSeverity: SystemHealthSeverity | null = null;
let candidateCount = 0;
const HYSTERESIS_POLLS = 3;
let eventStorePromise: Promise<ReturnType<typeof initEventStore>> | null = null;
let cachedResourceConfig = DEFAULT_RESOURCE_CONFIG;
let cachedPollSeconds = DEFAULT_HEALTH_POLL_SECONDS;
let resourceConfigLoadedAt = 0;
let resourceConfigInflight: Promise<void> | null = null;

function getDockerStatsCollector(): DockerStatsCollector {
  if (!dockerStatsCollector) {
    dockerStatsCollector = new DockerStatsCollector();
    dockerStatsCollector.start().catch((err: unknown) => {
      console.error('[system-health] DockerStatsCollector.start() failed:', err);
    });
  }
  return dockerStatsCollector;
}

function bytesToGb(bytes: number): number {
  return Math.round((bytes / GIB) * 100) / 100;
}

function toPercent(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 1000) / 10;
}

function classifyAgentKind(agentId: string): HealthAgentProcess['kind'] {
  if (agentId.startsWith('agent-')) return 'work';
  if (agentId.startsWith('planning-')) return 'planning';
  if (agentId.startsWith('specialist-') || agentId.endsWith('-agent')) return 'specialist';
  return 'other';
}

function resolveFiniteNumber(value: string | undefined, fallback: number): number {
  if (value == null || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function readGlobalResourceConfig(): Promise<void> {
  let next = DEFAULT_RESOURCE_CONFIG;
  try {
    await access(GLOBAL_CONFIG_PATH);
    const raw = await readFile(GLOBAL_CONFIG_PATH, 'utf-8');
    const memoryWarnMatch = raw.match(/^\s*memory_warn_gb:\s*(\d+(?:\.\d+)?)\s*$/m);
    const memoryBlockMatch = raw.match(/^\s*memory_block_gb:\s*(\d+(?:\.\d+)?)\s*$/m);
    const agentWarnMatch = raw.match(/^\s*agent_warn_count:\s*(\d+(?:\.\d+)?)\s*$/m);
    const agentBlockMatch = raw.match(/^\s*agent_block_count:\s*(\d+(?:\.\d+)?)\s*$/m);
    const pollSecondsMatch = raw.match(/^\s*poll_seconds:\s*(\d+(?:\.\d+)?)\s*$/m);

    next = {
      memoryWarnGb: resolveFiniteNumber(memoryWarnMatch?.[1], DEFAULT_RESOURCE_CONFIG.memoryWarnGb),
      memoryBlockGb: resolveFiniteNumber(memoryBlockMatch?.[1], DEFAULT_RESOURCE_CONFIG.memoryBlockGb),
      agentWarnCount: Math.max(1, Math.floor(resolveFiniteNumber(agentWarnMatch?.[1], DEFAULT_RESOURCE_CONFIG.agentWarnCount))),
      agentBlockCount: Math.max(1, Math.floor(resolveFiniteNumber(agentBlockMatch?.[1], DEFAULT_RESOURCE_CONFIG.agentBlockCount))),
    };
    cachedPollSeconds = Math.max(1, Math.floor(resolveFiniteNumber(process.env['PAN_HEALTH_POLL_SECONDS'], resolveFiniteNumber(pollSecondsMatch?.[1], DEFAULT_HEALTH_POLL_SECONDS))));
  } catch {
    cachedPollSeconds = Math.max(1, Math.floor(resolveFiniteNumber(process.env['PAN_HEALTH_POLL_SECONDS'], DEFAULT_HEALTH_POLL_SECONDS)));
  }

  cachedResourceConfig = {
    memoryWarnGb: resolveFiniteNumber(process.env['PAN_MEMORY_WARN_GB'], next.memoryWarnGb),
    memoryBlockGb: resolveFiniteNumber(process.env['PAN_MEMORY_BLOCK_GB'], next.memoryBlockGb),
    agentWarnCount: Math.max(1, Math.floor(resolveFiniteNumber(process.env['PAN_AGENT_WARN_COUNT'], next.agentWarnCount))),
    agentBlockCount: Math.max(1, Math.floor(resolveFiniteNumber(process.env['PAN_AGENT_BLOCK_COUNT'], next.agentBlockCount))),
  };
  resourceConfigLoadedAt = Date.now();
}

async function ensureResourceConfigLoaded(): Promise<void> {
  const ttl = Math.max(5_000, cachedPollSeconds * 1000);
  if (resourceConfigLoadedAt > 0 && Date.now() - resourceConfigLoadedAt < ttl) return;
  if (!resourceConfigInflight) {
    resourceConfigInflight = readGlobalResourceConfig().finally(() => {
      resourceConfigInflight = null;
    });
  }
  await resourceConfigInflight;
}

export function getResourceConfig() {
  return cachedResourceConfig;
}

function getHealthPollTtlMs(): number {
  return Math.max(1, cachedPollSeconds) * 1000;
}

function defaultThresholds(): SystemHealthThresholds {
  const resources = getResourceConfig();
  return {
    memoryAvailableWarningBytes: resources.memoryWarnGb * GIB,
    memoryAvailableCriticalBytes: resources.memoryBlockGb * GIB,
    swapUsedWarningPercent: Number(process.env['PAN_HEALTH_SWAP_WARN_PERCENT'] ?? 20),
    swapUsedCriticalPercent: Number(process.env['PAN_HEALTH_SWAP_CRITICAL_PERCENT'] ?? 50),
    cpuLoadWarningPerCore: Number(process.env['PAN_HEALTH_LOAD_WARN_PER_CORE'] ?? 1),
    cpuLoadCriticalPerCore: Number(process.env['PAN_HEALTH_LOAD_CRITICAL_PER_CORE'] ?? 1.5),
    overcommitWarningPercent: Number(process.env['PAN_HEALTH_OVERCOMMIT_WARN_PERCENT'] ?? 90),
    overcommitCriticalPercent: Number(process.env['PAN_HEALTH_OVERCOMMIT_CRITICAL_PERCENT'] ?? 100),
  };
}

async function readProcMemoryLinux(): Promise<ProcMemorySnapshot> {
  const content = await readFile('/proc/meminfo', 'utf-8');
  const values = new Map<string, number>();

  for (const line of content.split('\n')) {
    const match = line.match(/^(\w+):\s+(\d+)\s+kB$/);
    if (match) values.set(match[1] ?? '', Number(match[2] ?? '0') * KB);
  }

  return {
    memTotal: values.get('MemTotal') ?? 0,
    memAvailable: values.get('MemAvailable') ?? values.get('MemFree') ?? 0,
    memFree: values.get('MemFree') ?? 0,
    swapTotal: values.get('SwapTotal') ?? 0,
    swapFree: values.get('SwapFree') ?? 0,
    committedAs: values.get('Committed_AS') ?? 0,
    commitLimit: values.get('CommitLimit') ?? 0,
  };
}

async function readProcMemoryDarwin(): Promise<ProcMemorySnapshot> {
  const memTotal = totalmem();
  let memAvailable = freemem();
  let memFree = freemem();

  try {
    const { stdout } = await execAsync('vm_stat', { encoding: 'utf-8', timeout: 5_000 });
    const pageSizeMatch = stdout.match(/page size of (\d+) bytes/);
    const pageSize = pageSizeMatch ? Number(pageSizeMatch[1]) : 16384;

    const pages = new Map<string, number>();
    for (const line of stdout.split('\n')) {
      const m = line.match(/^(.+?):\s+(\d+)\./);
      if (m) pages.set(m[1]!.trim(), Number(m[2]));
    }

    const free = (pages.get('Pages free') ?? 0) * pageSize;
    const inactive = (pages.get('Pages inactive') ?? 0) * pageSize;
    const speculative = (pages.get('Pages speculative') ?? 0) * pageSize;
    memFree = free;
    memAvailable = free + inactive + speculative;
  } catch { /* fall back to os.freemem() values set above */ }

  let swapTotal = 0;
  let swapFree = 0;
  try {
    const { stdout } = await execAsync('sysctl -n vm.swapusage', { encoding: 'utf-8', timeout: 5_000 });
    const totalMatch = stdout.match(/total\s*=\s*([\d.]+)M/);
    const usedMatch = stdout.match(/used\s*=\s*([\d.]+)M/);
    if (totalMatch) swapTotal = parseFloat(totalMatch[1] ?? '0') * 1024 * KB;
    if (totalMatch && usedMatch) swapFree = swapTotal - parseFloat(usedMatch[1] ?? '0') * 1024 * KB;
  } catch { /* swap stats unavailable */ }

  return {
    memTotal,
    memAvailable,
    memFree,
    swapTotal,
    swapFree,
    committedAs: 0,
    commitLimit: 0,
  };
}

async function readProcMemory(): Promise<ProcMemorySnapshot> {
  return platform() === 'darwin' ? readProcMemoryDarwin() : readProcMemoryLinux();
}

async function readLoadAverage(): Promise<number> {
  if (platform() === 'darwin') {
    const load = loadavg()[0] ?? 0;
    return Number.isFinite(load) ? load : 0;
  }
  const content = await readFile('/proc/loadavg', 'utf-8');
  const load = Number((content.trim().split(/\s+/)[0] ?? '0').trim());
  return Number.isFinite(load) ? load : 0;
}

async function readCpuPercent(): Promise<number> {
  if (platform() === 'darwin') {
    const coreCount = Math.max(cpus().length, 1);
    const load = loadavg()[0] ?? 0;
    return Math.round(Math.min(load / coreCount, 1) * 1000) / 10;
  }

  const content = await readFile('/proc/stat', 'utf-8');
  const cpuLine = content.split('\n').find((line) => line.startsWith('cpu '));
  if (!cpuLine) return 0;

  const values = cpuLine.trim().split(/\s+/).slice(1).map((value) => Number(value));
  const idle = (values[3] ?? 0) + (values[4] ?? 0);
  const total = values.reduce((sum, value) => sum + value, 0);
  const current: CpuSample = { idle, total };
  const now = Date.now();

  if (!previousCpuSample || (previousCpuSampleAt > 0 && now - previousCpuSampleAt > getHealthPollTtlMs() * 2)) {
    previousCpuSample = current;
    previousCpuSampleAt = now;
    const coreCount = Math.max(cpus().length, 1);
    const fallback = Math.min((await readLoadAverage()) / coreCount, 1) * 100;
    return Math.round(fallback * 10) / 10;
  }

  const totalDelta = current.total - previousCpuSample.total;
  const idleDelta = current.idle - previousCpuSample.idle;
  previousCpuSample = current;
  previousCpuSampleAt = now;

  if (totalDelta <= 0) return 0;
  return Math.round(((totalDelta - idleDelta) / totalDelta) * 1000) / 10;
}

async function readProcessTable(): Promise<Map<number, ProcessRow>> {
  const { stdout } = await execAsync('ps -eo pid=,ppid=,rss=,args=', {
    encoding: 'utf-8',
    timeout: 10_000,
  });

  const rows = new Map<number, ProcessRow>();
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
    if (!match) continue;
    const pid = Number(match[1]);
    const ppid = Number(match[2]);
    const rssKb = Number(match[3]);
    const command = match[4] ?? '';
    if (!Number.isFinite(pid) || !Number.isFinite(ppid) || !Number.isFinite(rssKb)) continue;
    rows.set(pid, { pid, ppid, rssKb, command });
  }
  return rows;
}

function getDescendantPids(rootPid: number, processes: Map<number, ProcessRow>): Set<number> {
  const descendants = new Set<number>();
  const queue = [rootPid];

  while (queue.length > 0) {
    const pid = queue.shift();
    if (!pid || descendants.has(pid)) continue;
    descendants.add(pid);

    for (const process of processes.values()) {
      if (process.ppid === pid && !descendants.has(process.pid)) {
        queue.push(process.pid);
      }
    }
  }

  return descendants;
}

function sumProcessMemory(descendants: Set<number>, processes: Map<number, ProcessRow>): number {
  let totalRssKb = 0;
  for (const pid of descendants) {
    totalRssKb += processes.get(pid)?.rssKb ?? 0;
  }
  return totalRssKb * KB;
}

function buildLeakedSpecialists(
  snapshot: DashboardSnapshot | undefined,
  runningAgents: HealthAgentProcess[],
): HealthLeakedSpecialist[] {
  if (!snapshot) return [];

  const activeWorkIssues = new Set(
    runningAgents
      .filter((agent) => agent.kind === 'work' && agent.status !== 'stopped' && agent.tmuxActive)
      .map((agent) => agent.issueId.toUpperCase()),
  );

  return snapshot.specialists
    .filter((specialist) => specialist.isRunning && !!specialist.currentIssue)
    .filter((specialist) => !activeWorkIssues.has((specialist.currentIssue ?? '').toUpperCase()))
    .map((specialist) => ({
      name: specialist.name,
      currentIssue: specialist.currentIssue ?? '',
      reason: `Specialist is active for ${specialist.currentIssue} but no running work agent exists for that issue.`,
    }));
}

function evaluateSeverity(
  thresholds: SystemHealthThresholds,
  data: {
    availableMemoryBytes: number;
    swapUsedPercent: number;
    loadPerCore1m: number;
    overcommitPercent: number;
    leakedSpecialistCount: number;
  },
): { severity: SystemHealthSeverity; reasons: string[] } {
  const criticalReasons: string[] = [];
  const warningReasons: string[] = [];

  if (data.availableMemoryBytes < thresholds.memoryAvailableCriticalBytes) {
    criticalReasons.push(`Available RAM is low (${bytesToGb(data.availableMemoryBytes)} GB).`);
  } else if (data.availableMemoryBytes < thresholds.memoryAvailableWarningBytes) {
    warningReasons.push(`Available RAM is tight (${bytesToGb(data.availableMemoryBytes)} GB).`);
  }

  if (data.swapUsedPercent >= thresholds.swapUsedCriticalPercent) {
    criticalReasons.push(`Swap usage is high (${data.swapUsedPercent}%).`);
  } else if (data.swapUsedPercent >= thresholds.swapUsedWarningPercent) {
    warningReasons.push(`Swap usage is elevated (${data.swapUsedPercent}%).`);
  }

  if (data.loadPerCore1m >= thresholds.cpuLoadCriticalPerCore) {
    criticalReasons.push(`CPU load is high (${data.loadPerCore1m.toFixed(2)} per core).`);
  } else if (data.loadPerCore1m >= thresholds.cpuLoadWarningPerCore) {
    warningReasons.push(`CPU load is elevated (${data.loadPerCore1m.toFixed(2)} per core).`);
  }

  if (data.overcommitPercent >= thresholds.overcommitCriticalPercent) {
    criticalReasons.push(`Committed memory exceeds the safe limit (${data.overcommitPercent}%).`);
  } else if (data.overcommitPercent >= thresholds.overcommitWarningPercent) {
    warningReasons.push(`Committed memory is near the limit (${data.overcommitPercent}%).`);
  }

  if (data.leakedSpecialistCount > 0) {
    warningReasons.push(`${data.leakedSpecialistCount} leaked specialist session${data.leakedSpecialistCount === 1 ? '' : 's'} detected.`);
  }

  if (criticalReasons.length > 0) {
    return { severity: 'critical', reasons: criticalReasons.concat(warningReasons) };
  }
  if (warningReasons.length > 0) {
    return { severity: 'warning', reasons: warningReasons };
  }
  return { severity: 'normal', reasons: [] };
}

async function collectAgentProcesses(): Promise<HealthAgentProcess[]> {
  const agents = await listRunningAgentsAsync();
  const activeAgents = agents.filter((agent) => agent.status !== 'stopped');
  const processTable = await readProcessTable().catch(() => new Map<number, ProcessRow>());

  return Promise.all(
    activeAgents.map(async (agent) => {
      const runtimeState = await getAgentRuntimeStateAsync(agent.id).catch(() => null);
      const panePidValue = runtimeState?.panePid != null ? String(runtimeState.panePid) : (await listPaneValuesAsync(agent.id, '#{pane_pid}'))[0];
      const panePid = Number(panePidValue ?? '0');
      const descendants = Number.isFinite(panePid) && panePid > 0
        ? getDescendantPids(panePid, processTable)
        : new Set<number>();
      const memoryBytes = descendants.size > 0 ? sumProcessMemory(descendants, processTable) : 0;

      return {
        id: agent.id,
        issueId: agent.issueId,
        kind: classifyAgentKind(agent.id),
        status: agent.status,
        tmuxActive: agent.tmuxActive,
        memoryBytes,
        memoryGb: bytesToGb(memoryBytes),
        currentIssue: runtimeState?.currentIssue,
      } satisfies HealthAgentProcess;
    }),
  );
}

function buildTopConsumers(
  agents: HealthAgentProcess[],
  containers: ContainerStats[],
  leakedSpecialists: HealthLeakedSpecialist[],
): HealthConsumer[] {
  const leakedByName = new Map(leakedSpecialists.map((item) => [item.name, item]));

  const agentConsumers = agents.map((agent) => {
    const isSpecialist = agent.kind === 'specialist';
    const leaked = leakedByName.has(agent.id.replace(/^specialist-/, '')) || leakedByName.has(agent.id);
    const currentIssue = agent.currentIssue ?? agent.issueId;
    const resolved = currentIssue ? resolveProjectFromIssue(currentIssue) : null;
    const specialistType = isSpecialist
      ? agent.id.startsWith('specialist-')
        ? agent.id.replace(/^specialist-/, '')
        : agent.id
      : undefined;

    return {
      id: agent.id,
      label: agent.id,
      type: isSpecialist ? 'specialist' : 'agent',
      memoryBytes: agent.memoryBytes,
      memoryGb: agent.memoryGb,
      issueId: agent.issueId,
      currentIssue: agent.currentIssue,
      leaked,
      killTarget: isSpecialist
        ? {
            kind: 'specialist',
            projectKey: resolved?.projectKey,
            issueId: currentIssue,
            specialistType,
          }
        : {
            kind: 'agent',
            agentId: agent.id,
          },
    } satisfies HealthConsumer;
  });

  const containerConsumers = containers.map((container) => ({
    id: container.id,
    label: container.name,
    type: 'container',
    memoryBytes: container.memoryUsage,
    memoryGb: bytesToGb(container.memoryUsage),
    cpuPercent: container.cpuPercent,
    killTarget: {
      kind: 'container',
      containerId: container.id,
    },
  } satisfies HealthConsumer));

  return [...agentConsumers, ...containerConsumers]
    .sort((a, b) => b.memoryBytes - a.memoryBytes)
    .slice(0, 10);
}

async function refreshSystemHealth(snapshot?: DashboardSnapshot): Promise<SystemHealthSnapshot> {
  await ensureResourceConfigLoaded();
  const [memory, loadAverage1m, cpuPercent, agents, containers] = await Promise.all([
    readProcMemory(),
    readLoadAverage(),
    readCpuPercent(),
    collectAgentProcesses(),
    Promise.resolve(getDockerStatsCollector().getStats()),
  ]);

  const thresholds = defaultThresholds();
  const coreCount = Math.max(cpus().length, 1);
  const loadPerCore1m = Math.round((loadAverage1m / coreCount) * 100) / 100;
  const usedMemoryBytes = Math.max(memory.memTotal - memory.memAvailable, 0);
  const swapUsedBytes = Math.max(memory.swapTotal - memory.swapFree, 0);
  const overcommitPercent = toPercent(memory.committedAs, memory.memTotal);
  const leakedSpecialists = buildLeakedSpecialists(snapshot, agents);
  const evaluation = evaluateSeverity(thresholds, {
    availableMemoryBytes: memory.memAvailable,
    swapUsedPercent: toPercent(swapUsedBytes, memory.swapTotal),
    loadPerCore1m,
    overcommitPercent,
    leakedSpecialistCount: leakedSpecialists.length,
  });

  const containerMemoryBytes = containers.reduce((sum, container) => sum + container.memoryUsage, 0);
  const workAgentCount = agents.filter((agent) => agent.kind === 'work').length;
  const planningAgentCount = agents.filter((agent) => agent.kind === 'planning').length;
  const specialistSessionCount = agents.filter((agent) => agent.kind === 'specialist').length;
  const swapUsedPercent = toPercent(swapUsedBytes, memory.swapTotal);
  const panopticonMemoryBytes = agents.reduce((sum, agent) => sum + agent.memoryBytes, 0) + containerMemoryBytes;
  const panopticonMemoryPercent = toPercent(panopticonMemoryBytes, memory.memTotal);

  const sortedAgents = [...agents].sort((a, b) => b.memoryBytes - a.memoryBytes);

  // Hysteresis: require HYSTERESIS_POLLS consecutive polls at a new severity
  // before actually transitioning. Prevents flapping when metrics hover near thresholds.
  let effectiveSeverity: SystemHealthSeverity;
  if (previousSeverity == null) {
    effectiveSeverity = evaluation.severity;
  } else if (evaluation.severity === previousSeverity) {
    candidateSeverity = null;
    candidateCount = 0;
    effectiveSeverity = previousSeverity;
  } else if (evaluation.severity === candidateSeverity) {
    candidateCount++;
    effectiveSeverity = candidateCount >= HYSTERESIS_POLLS ? evaluation.severity : previousSeverity;
    if (effectiveSeverity !== previousSeverity) {
      candidateSeverity = null;
      candidateCount = 0;
    }
  } else {
    candidateSeverity = evaluation.severity;
    candidateCount = 1;
    effectiveSeverity = previousSeverity;
  }

  const result: SystemHealthSnapshot = {
    severity: effectiveSeverity,
    updatedAt: new Date().toISOString(),
    summary: {
      cpuPercent,
      loadAverage1m,
      loadPerCore1m,
      totalMemoryBytes: memory.memTotal,
      usedMemoryBytes,
      availableMemoryBytes: memory.memAvailable,
      memoryUsedPercent: toPercent(usedMemoryBytes, memory.memTotal),
      swapTotalBytes: memory.swapTotal,
      swapUsedBytes,
      swapUsedPercent,
      overcommitPercent,
      agentCount: agents.length,
      workAgentCount,
      planningAgentCount,
      specialistSessionCount,
      leakedSpecialistCount: leakedSpecialists.length,
      containerCount: containers.length,
      containerMemoryBytes,
      panopticonMemoryBytes,
      panopticonMemoryPercent,
    },
    thresholds,
    reasons: evaluation.reasons,
    agents: sortedAgents,
    leakedSpecialists,
    topConsumers: buildTopConsumers(sortedAgents, containers, leakedSpecialists),
  };

  if (previousSeverity && previousSeverity !== result.severity) {
    try {
      const store = eventStorePromise ??= initEventStore();
      await (await store).appendAsync({
        type: 'system.health_severity_changed',
        timestamp: result.updatedAt,
        payload: {
          previousSeverity,
          severity: result.severity,
          reasons: result.reasons,
          leakedSpecialistCount: leakedSpecialists.length,
        },
      } as never);
    } catch (err) {
      console.error('[system-health] Failed to append severity transition event:', err);
    }
  }

  previousSeverity = result.severity;
  cachedHealth = result;
  cacheExpiresAt = Date.now() + getHealthPollTtlMs();
  return result;
}

export async function getSystemHealthSnapshot(snapshot?: DashboardSnapshot): Promise<SystemHealthSnapshot> {
  if (cachedHealth && Date.now() < cacheExpiresAt) {
    return cachedHealth;
  }

  if (!inflightRefresh) {
    inflightRefresh = refreshSystemHealth(snapshot).finally(() => {
      inflightRefresh = null;
    });
  }

  return inflightRefresh;
}
