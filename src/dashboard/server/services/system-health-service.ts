import { exec } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { cpus, freemem, loadavg, totalmem, platform } from 'node:os';
import { promisify } from 'node:util';

import type { DashboardSnapshot, HealthReason, HealthState } from '@overdeck/contracts';

import { Effect } from 'effect';
import { layer as nodeServicesLayer } from '@effect/platform-node/NodeServices';

import { listRunningAgents, getAgentRuntimeState, type AgentState } from '../../../lib/agents.js';
import { resolveProjectFromIssueSync } from '../../../lib/projects.js';
import { isSmeeConfiguredSync, isSmeeProcessRunningSync } from '../../../lib/smee.js';
import { listPaneValues } from '../../../lib/tmux.js';
import { DockerStatsCollector, type ContainerStats } from '../../../lib/docker-stats.js';
import { getBuildInfo } from '../../../lib/deploy/build-info.js';
import {
  SYSTEM_HEALTH_DEFAULTS,
  resolveSystemHealthConfig,
  type EffectiveSystemHealthConfig,
  type SystemHealthThresholds,
} from '../../../lib/system-health/config.js';
import {
  createSystemHealthSampler,
  type AssessmentFreshness,
  type RawHealthAssessment,
  type SystemHealthSampler,
} from '../../../lib/system-health/sampler.js';
import {
  computeBuildStaleness,
  type BuildStaleness,
} from '../../../lib/deploy/staleness.js';
import { initEventStore } from '../event-store.js';
import { getDashboardIdentity } from '../identity.js';

const execAsync = promisify(exec);
const KB = 1024;
const GIB = 1024 ** 3;

type SystemHealthSeverity = 'normal' | 'warning' | 'critical';

export interface ProcMemorySnapshot {
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

export interface AgentAdmissionCandidate {
  role?: string;
  status: AgentState['status'];
  startedAt?: string;
  tmuxActive: boolean;
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

export interface SmeeRelayHealth {
  configured: boolean;
  running: boolean;
  status: 'not_configured' | 'running' | 'stopped' | 'unknown';
  message: string;
}

interface CollectedSystemHealthSnapshot {
  severity: SystemHealthSeverity;
  updatedAt: string;
  admission: {
    admittedWorkAgentCount: number;
  };
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
    overdeckMemoryBytes: number;
    overdeckMemoryPercent: number;
  };
  thresholds: SystemHealthThresholds;
  reasons: string[];
  agents: HealthAgentProcess[];
  leakedSpecialists: HealthLeakedSpecialist[];
  topConsumers: HealthConsumer[];
  smeeRelay: SmeeRelayHealth;
  deployStaleness: BuildStaleness | null;
}

export interface SystemHealthSnapshot extends CollectedSystemHealthSnapshot {
  state: HealthState;
  structuredReasons: HealthReason[];
  freshness: AssessmentFreshness;
  transitionVersion: number;
}

let dockerStatsCollector: DockerStatsCollector | null = null;
let previousCpuSample: CpuSample | null = null;
let previousCpuSampleAt = 0;
let latestDashboardSnapshot: DashboardSnapshot | undefined;
let systemHealthSampler: SystemHealthSampler<CollectedSystemHealthSnapshot> | null = null;
let eventStorePromise: ReturnType<typeof initEventStore> | null = null;
let cachedSystemHealthConfig: EffectiveSystemHealthConfig | null = null;
let resourceConfigLoadedAt = 0;
let resourceConfigInflight: Promise<void> | null = null;
let cachedDeployStaleness: BuildStaleness | null = null;
let hasCachedDeployStaleness = false;
let deployStalenessCacheExpiresAt = 0;
let deployStalenessInflight: Promise<BuildStaleness | null> | null = null;
let computeBuildStalenessFn = computeBuildStaleness;
const DEPLOY_STALENESS_TTL_MS = 60_000;

export async function getDeployStaleness(): Promise<BuildStaleness | null> {
  if (hasCachedDeployStaleness && Date.now() < deployStalenessCacheExpiresAt) {
    return cachedDeployStaleness;
  }

  if (!deployStalenessInflight) {
    deployStalenessInflight = computeBuildStalenessFn({
      repoRoot: getDashboardIdentity().repoRoot,
      buildCommit: getBuildInfo().buildCommit,
    }).catch(() => null).then((result) => {
      cachedDeployStaleness = result;
      hasCachedDeployStaleness = true;
      deployStalenessCacheExpiresAt = Date.now() + DEPLOY_STALENESS_TTL_MS;
      return result;
    }).finally(() => {
      deployStalenessInflight = null;
    });
  }

  return deployStalenessInflight;
}

export function _resetDeployStalenessForTests(
  compute: typeof computeBuildStaleness = computeBuildStaleness,
): void {
  cachedDeployStaleness = null;
  hasCachedDeployStaleness = false;
  deployStalenessCacheExpiresAt = 0;
  deployStalenessInflight = null;
  computeBuildStalenessFn = compute;
}

function getDockerStatsCollector(): DockerStatsCollector {
  if (!dockerStatsCollector) {
    dockerStatsCollector = new DockerStatsCollector();
    Effect.runFork(
      dockerStatsCollector.start().pipe(Effect.provide(nodeServicesLayer)),
    );
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

const AGENT_STARTUP_GRACE_MS = 5 * 60 * 1000;

export function countAdmittedWorkAgents(
  agents: readonly AgentAdmissionCandidate[],
  nowMs = Date.now(),
): number {
  return agents.filter((agent) => {
    if (agent.role !== 'work') return false;
    if (agent.status !== 'running' && agent.status !== 'starting') return false;
    if (agent.tmuxActive) return true;
    if (agent.status !== 'starting' || !agent.startedAt) return false;

    const startedAtMs = Date.parse(agent.startedAt);
    const ageMs = nowMs - startedAtMs;
    return Number.isFinite(startedAtMs)
      && ageMs >= 0
      && ageMs < AGENT_STARTUP_GRACE_MS;
  }).length;
}

export function classifyAgentKind(
  agentId: string,
  role?: string,
): HealthAgentProcess['kind'] {
  // Legacy prefixes (older agents may still exist on disk)
  if (agentId.startsWith('planning-')) return 'planning';
  if (agentId.startsWith('specialist-')) return 'specialist';
  // Modern naming — every agent starts with `agent-`. Disambiguate by role:
  // role='work' (or unset for legacy state files) → work agent or swarm slot
  // role='review'/'review-*'/'test'/'ship' → specialist
  // PAN-1257: without this, every specialist gets misclassified as work and
  // inflates workAgentCount, hitting agentBlockCount cap and blocking swarms.
  if (agentId.startsWith('agent-')) {
    if (role === 'work' || role === undefined) return 'work';
    return 'specialist';
  }
  if (agentId.endsWith('-agent')) return 'specialist';
  return 'other';
}

export async function readGlobalResourceConfig(): Promise<void> {
  cachedSystemHealthConfig = resolveSystemHealthConfig();
  resourceConfigLoadedAt = Date.now();
}

async function ensureResourceConfigLoaded(): Promise<void> {
  const pollSeconds = cachedSystemHealthConfig?.pollSeconds ?? SYSTEM_HEALTH_DEFAULTS.pollSeconds;
  const ttl = Math.max(5_000, pollSeconds * 1000);
  if (resourceConfigLoadedAt > 0 && Date.now() - resourceConfigLoadedAt < ttl) return;
  if (!resourceConfigInflight) {
    resourceConfigInflight = readGlobalResourceConfig().finally(() => {
      resourceConfigInflight = null;
    });
  }
  await resourceConfigInflight;
}

export function getResourceConfig() {
  cachedSystemHealthConfig ??= resolveSystemHealthConfig();
  return cachedSystemHealthConfig.resources;
}

function getHealthPollTtlMs(): number {
  return Math.max(
    1,
    cachedSystemHealthConfig?.pollSeconds ?? SYSTEM_HEALTH_DEFAULTS.pollSeconds,
  ) * 1000;
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

export async function readProcMemory(): Promise<ProcMemorySnapshot> {
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

  type SpecialistSnapshot = { isRunning?: boolean; currentIssue?: string | null; name?: string };
  return (snapshot.specialists as readonly SpecialistSnapshot[])
    .filter((specialist) => specialist.isRunning && !!specialist.currentIssue)
    .filter((specialist) => !activeWorkIssues.has((specialist.currentIssue ?? '').toUpperCase()))
    .map((specialist) => ({
      name: specialist.name ?? '',
      currentIssue: specialist.currentIssue ?? '',
      reason: `Specialist is active for ${specialist.currentIssue} but no running work agent exists for that issue.`,
    }));
}

export function evaluateSeverity(
  thresholds: SystemHealthThresholds,
  data: {
    availableMemoryBytes: number;
    swapUsedPercent: number;
    loadPerCore1m: number;
    overcommitPercent: number;
    leakedSpecialistCount: number;
    smeeRelay: SmeeRelayHealth;
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

  if (data.smeeRelay.configured && !data.smeeRelay.running) {
    warningReasons.push('smee-client webhook relay is configured but not running.');
  }

  if (criticalReasons.length > 0) {
    return { severity: 'critical', reasons: criticalReasons.concat(warningReasons) };
  }
  if (warningReasons.length > 0) {
    return { severity: 'warning', reasons: warningReasons };
  }
  return { severity: 'normal', reasons: [] };
}

function collectSmeeRelayHealth(): SmeeRelayHealth {
  try {
    if (!isSmeeConfiguredSync()) {
      return {
        configured: false,
        running: false,
        status: 'not_configured',
        message: 'Not configured',
      };
    }

    const running = isSmeeProcessRunningSync();
    return running
      ? {
          configured: true,
          running: true,
          status: 'running',
          message: 'Running',
        }
      : {
          configured: true,
          running: false,
          status: 'stopped',
          message: 'Configured but not running',
        };
  } catch (err) {
    return {
      configured: false,
      running: false,
      status: 'unknown',
      message: err instanceof Error ? err.message : 'Status check failed',
    };
  }
}

async function collectAgentProcesses(): Promise<{
  agents: HealthAgentProcess[];
  admittedWorkAgentCount: number;
}> {
  const registeredAgents = await Effect.runPromise(listRunningAgents());
  const admittedWorkAgentCount = countAdmittedWorkAgents(registeredAgents, Date.now());
  const activeAgents = registeredAgents.filter((agent) => agent.status !== 'stopped');
  const processTable = await readProcessTable().catch(() => new Map<number, ProcessRow>());

  const agents = await Promise.all(
    activeAgents.map(async (agent) => {
      const runtimeState = await Effect.runPromise(getAgentRuntimeState(agent.id)).catch(() => null);
      // PAN-977 round-12 high-2: panePid cache field was removed from
      // AgentRuntimeState; always query tmux for the current pane PID.
      const panePidValue = (await Effect.runPromise(listPaneValues(agent.id, '#{pane_pid}')))[0];
      const panePid = Number(panePidValue ?? '0');
      const descendants = Number.isFinite(panePid) && panePid > 0
        ? getDescendantPids(panePid, processTable)
        : new Set<number>();
      const memoryBytes = descendants.size > 0 ? sumProcessMemory(descendants, processTable) : 0;

      return {
        id: agent.id,
        issueId: agent.issueId,
        kind: classifyAgentKind(agent.id, agent.role),
        status: agent.status,
        tmuxActive: agent.tmuxActive,
        memoryBytes,
        memoryGb: bytesToGb(memoryBytes),
        currentIssue: runtimeState?.currentIssue,
      } satisfies HealthAgentProcess;
    }),
  );

  return { agents, admittedWorkAgentCount };
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
    const resolved = currentIssue ? resolveProjectFromIssueSync(currentIssue) : null;
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

function legacySeverityToState(severity: SystemHealthSeverity): HealthState {
  return severity === 'normal' ? 'healthy' : severity;
}

function stateToLegacySeverity(state: HealthState): SystemHealthSeverity {
  return state === 'critical' ? 'critical' : state === 'warning' ? 'warning' : 'normal';
}

function structuredLegacyReasons(
  severity: SystemHealthSeverity,
  reasons: string[],
): HealthReason[] {
  return reasons.map((message, index) => ({
    code: `legacy.system_health.${severity}.${index + 1}`,
    domain: 'host',
    severity: severity === 'normal' ? 'info' : severity,
    message,
  }));
}

function createMeasuringSnapshot(): CollectedSystemHealthSnapshot {
  cachedSystemHealthConfig ??= resolveSystemHealthConfig();
  const totalMemoryBytes = totalmem();
  const availableMemoryBytes = freemem();
  const usedMemoryBytes = Math.max(totalMemoryBytes - availableMemoryBytes, 0);

  return {
    severity: 'normal',
    updatedAt: new Date().toISOString(),
    admission: {
      admittedWorkAgentCount: 0,
    },
    summary: {
      cpuPercent: 0,
      loadAverage1m: 0,
      loadPerCore1m: 0,
      totalMemoryBytes,
      usedMemoryBytes,
      availableMemoryBytes,
      memoryUsedPercent: toPercent(usedMemoryBytes, totalMemoryBytes),
      swapTotalBytes: 0,
      swapUsedBytes: 0,
      swapUsedPercent: 0,
      overcommitPercent: 0,
      agentCount: 0,
      workAgentCount: 0,
      planningAgentCount: 0,
      specialistSessionCount: 0,
      leakedSpecialistCount: 0,
      containerCount: 0,
      containerMemoryBytes: 0,
      overdeckMemoryBytes: 0,
      overdeckMemoryPercent: 0,
    },
    thresholds: cachedSystemHealthConfig.thresholds,
    reasons: [],
    agents: [],
    leakedSpecialists: [],
    topConsumers: [],
    smeeRelay: collectSmeeRelayHealth(),
    deployStaleness: null,
  };
}

async function collectSystemHealth(): Promise<CollectedSystemHealthSnapshot> {
  await ensureResourceConfigLoaded();
  const [memory, loadAverage1m, cpuPercent, agentProcesses, containers] = await Promise.all([
    readProcMemory(),
    readLoadAverage(),
    readCpuPercent(),
    collectAgentProcesses(),
    Promise.resolve(getDockerStatsCollector().getStats()),
  ]);

  const agents = agentProcesses.agents;
  const thresholds = cachedSystemHealthConfig!.thresholds;
  const smeeRelay = collectSmeeRelayHealth();
  const coreCount = Math.max(cpus().length, 1);
  const loadPerCore1m = Math.round((loadAverage1m / coreCount) * 100) / 100;
  const usedMemoryBytes = Math.max(memory.memTotal - memory.memAvailable, 0);
  const swapUsedBytes = Math.max(memory.swapTotal - memory.swapFree, 0);
  const overcommitPercent = toPercent(memory.committedAs, memory.memTotal);
  const leakedSpecialists = buildLeakedSpecialists(latestDashboardSnapshot, agents);
  const evaluation = evaluateSeverity(thresholds, {
    availableMemoryBytes: memory.memAvailable,
    swapUsedPercent: toPercent(swapUsedBytes, memory.swapTotal),
    loadPerCore1m,
    overcommitPercent,
    leakedSpecialistCount: leakedSpecialists.length,
    smeeRelay,
  });

  const containerMemoryBytes = containers.reduce((sum, container) => sum + container.memoryUsage, 0);
  const workAgentCount = agents.filter((agent) => agent.kind === 'work').length;
  const planningAgentCount = agents.filter((agent) => agent.kind === 'planning').length;
  const specialistSessionCount = agents.filter((agent) => agent.kind === 'specialist').length;
  const swapUsedPercent = toPercent(swapUsedBytes, memory.swapTotal);
  const overdeckMemoryBytes = agents.reduce((sum, agent) => sum + agent.memoryBytes, 0) + containerMemoryBytes;
  const overdeckMemoryPercent = toPercent(overdeckMemoryBytes, memory.memTotal);
  const sortedAgents = [...agents].sort((a, b) => b.memoryBytes - a.memoryBytes);

  return {
    severity: evaluation.severity,
    updatedAt: new Date().toISOString(),
    admission: {
      admittedWorkAgentCount: agentProcesses.admittedWorkAgentCount,
    },
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
      overdeckMemoryBytes,
      overdeckMemoryPercent,
    },
    thresholds,
    reasons: evaluation.reasons,
    agents: sortedAgents,
    leakedSpecialists,
    topConsumers: buildTopConsumers(sortedAgents, containers, leakedSpecialists),
    smeeRelay,
    deployStaleness: await getDeployStaleness(),
  };
}

async function collectRawSystemHealth(): Promise<RawHealthAssessment<CollectedSystemHealthSnapshot>> {
  const snapshot = await collectSystemHealth();
  return {
    status: 'valid',
    assessment: {
      state: legacySeverityToState(snapshot.severity),
      reasons: structuredLegacyReasons(snapshot.severity, snapshot.reasons),
      metrics: snapshot,
      sampledAt: snapshot.updatedAt,
    },
  };
}

async function publishSystemHealthTransition(
  transition: {
    version: number;
    previousState: HealthState;
    state: HealthState;
    reasonCodes: string[];
    acceptedAt: string;
  },
): Promise<void> {
  const accepted = systemHealthSampler?.getSnapshot();
  try {
    const store = eventStorePromise ??= initEventStore();
    await (await store).appendAsync({
      type: 'system.health_severity_changed',
      timestamp: transition.acceptedAt,
      payload: {
        version: 2,
        transitionVersion: transition.version,
        previousSeverity: stateToLegacySeverity(transition.previousState),
        severity: stateToLegacySeverity(transition.state),
        previousState: transition.previousState,
        state: transition.state,
        reasons: transition.reasonCodes,
        reasonCodes: transition.reasonCodes,
        leakedSpecialistCount: accepted?.metrics.leakedSpecialists.length ?? 0,
      },
    } as never);
  } catch (err) {
    console.error('[system-health] Failed to append accepted transition event:', err);
  }
}

function getSystemHealthSampler(): SystemHealthSampler<CollectedSystemHealthSnapshot> {
  if (!systemHealthSampler) {
    const config = cachedSystemHealthConfig ?? resolveSystemHealthConfig();
    cachedSystemHealthConfig = config;
    systemHealthSampler = createSystemHealthSampler({
      collect: collectRawSystemHealth,
      measuringMetrics: createMeasuringSnapshot,
      pollIntervalMs: config.pollSeconds * 1000,
      onTransition: publishSystemHealthTransition,
    });
  }
  return systemHealthSampler;
}

export async function getSystemHealthSnapshot(snapshot?: DashboardSnapshot): Promise<SystemHealthSnapshot> {
  latestDashboardSnapshot = snapshot ?? latestDashboardSnapshot;
  const accepted = getSystemHealthSampler().getSnapshot();
  return {
    ...accepted.metrics,
    state: accepted.state,
    structuredReasons: accepted.reasons,
    freshness: accepted.freshness,
    transitionVersion: accepted.transitionVersion,
  };
}
