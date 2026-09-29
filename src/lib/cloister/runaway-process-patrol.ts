/**
 * Runaway-process patrol (PAN-4311 FR-9 to FR-12).
 *
 * Every 30 s, in the dashboard MAIN process (D1: /api/resources is built
 * there, and `isIdle` has runtime data only there), the patrol reads /proc for
 * every process in the Overdeck cgroups, keeps a 10-minute CPU ring per
 * process identity (pid + starttime), classifies runaway process groups with
 * `classifyRunaways`, and reports them in the activity feed: one `warn` when a
 * group first qualifies, one escalation when it passes 60 minutes, one `info`
 * when it exits.
 *
 * OBSERVE-ONLY. The stall-sweeper operator directive (2026-08-05) applies: this
 * patrol must never kill, pause, or message anything. The feed entry names the
 * `kill -TERM -<pgid>` command; the operator decides.
 *
 * Cost (NFR-2, NFR-3): async `fs/promises` reads only, no child processes.
 * One `stat` per pid per tick; `environ`, `cmdline` and `cwd` once per
 * identity. Linux only; a no-op elsewhere.
 */

import { readdir, readFile, readlink, stat } from 'node:fs/promises';
import { cpus, loadavg } from 'node:os';
import { join } from 'node:path';

import { emitActivityEntry, type EmitActivityOptions } from '../activity-logger.js';
import { getOverdeckHome } from '../paths.js';
import {
  classifyRunaways,
  type AttributedProcessFact,
  type RunawayContext,
  type RunawayGroup,
  type RunawayProcessFact,
  type RunawayReason,
} from './runaway-classify.js';
import type {
  AgentSessionProcess,
  HostProcessRecord,
} from '../../dashboard/server/routes/resources/host-processes.js';
import {
  createResourceSpikeSampler,
  type ResourceProcessGroup,
  type ResourceSpikeSampler,
} from '../../dashboard/server/routes/resources/spike-sampler.js';

export const RUNAWAY_PATROL_INTERVAL_MS = 30_000;
export const RUNAWAY_WINDOW_MS = 10 * 60_000;
export const RUNAWAY_ESCALATE_MS = 60 * 60_000;
const CLK_TCK = 100;
const PAGE_SIZE = 4096;
const CGROUP_ROOT = '/sys/fs/cgroup';
const OVERDECK_UNIT = /-herdr\.service$|^overdeck-tmux-server\.service$|^tmux-spawn-.*\.scope$/;
const MAX_CGROUP_DEPTH = 4;

export interface ProcStat {
  comm: string;
  ppid: number;
  pgid: number;
  /** utime + stime, in clock ticks. */
  cpuTicks: number;
  nice: number;
  starttime: number;
  rssPages: number;
}

export interface RunawayFeedDetails {
  category: 'resources';
  targetKind: 'runaway-process';
  targetId: string;
  pgid: number;
  reason: RunawayReason;
  count: number;
}

export type RunawayFeedEntry = Omit<EmitActivityOptions, 'details'> & { details: RunawayFeedDetails };

export interface RunawayPatrolDeps {
  listCgroupProcs(): Promise<Array<{ cgroup: string; pids: number[] }>>;
  readProcStat(pid: number): Promise<ProcStat | null>;
  readEnviron(pid: number): Promise<Record<string, string> | null>;
  readCmdline(pid: number): Promise<string | null>;
  readCwd(pid: number): Promise<string | null>;
  readUptimeSeconds(): Promise<number>;
  readAdmissionOwnerPid(): Promise<number | null>;
  isAgentIdle(agentId: string): boolean | Promise<boolean>;
  readHostCpu(): { cpuPercent: number; load1: number; cores: number };
  emit(entry: RunawayFeedEntry): void;
  /** PAN-4311 FR-12: fed once per tick with host CPU, load and the attributed process groups. */
  spikeSampler: ResourceSpikeSampler;
  now(): number;
  platform: NodeJS.Platform;
  dashboardPid: number;
}

export interface RunawaySnapshot {
  sampledAt: string;
  records: HostProcessRecord[];
  agentSessions: AgentSessionProcess[];
  coreServicePids: number[];
  processGroups: ResourceProcessGroup[];
  runaways: RunawayGroup[];
  cpuPercent: number;
  load1: number;
  cores: number;
}

export interface RunawayPatrol {
  tick(): Promise<void>;
  snapshot(): RunawaySnapshot | null;
  reset(): void;
}

interface IdentityMeta {
  agentId: string | null;
  startedBy: string | null;
  cmdline: string;
  cwd: string | null;
}

interface WarnedGroup {
  /** The group as last classified a runaway, and when. */
  group: RunawayGroup;
  seenAtMs: number;
  identities: Set<string>;
  escalated: boolean;
}

// --- default /proc and cgroup readers --------------------------------------

/** Parse /proc/<pid>/stat. `comm` may contain spaces and parentheses. */
export function parseProcStat(content: string): ProcStat | null {
  const open = content.indexOf('(');
  const close = content.lastIndexOf(')');
  if (open < 0 || close < open) return null;
  // Field n (1-based, man proc) is fields[n - 3] after the comm.
  const fields = content.slice(close + 2).trim().split(/\s+/);
  const num = (n: number) => Number(fields[n - 3]);
  const parsed: ProcStat = {
    comm: content.slice(open + 1, close),
    ppid: num(4),
    pgid: num(5),
    cpuTicks: num(14) + num(15),
    nice: num(19),
    starttime: num(22),
    rssPages: num(24),
  };
  return Object.values(parsed).every((value) => typeof value === 'string' || Number.isFinite(value)) ? parsed : null;
}

function userAppSlice(): string {
  const uid = process.getuid?.() ?? 0;
  return join(CGROUP_ROOT, 'user.slice', `user-${uid}.slice`, `user@${uid}.service`, 'app.slice');
}

async function collectCgroupProcs(
  dir: string,
  depth: number,
  out: Array<{ cgroup: string; pids: number[] }>,
): Promise<void> {
  const procs = await readFile(join(dir, 'cgroup.procs'), 'utf-8').catch(() => '');
  const pids = procs.split('\n').map(Number).filter((pid) => Number.isInteger(pid) && pid > 0);
  if (pids.length > 0) out.push({ cgroup: dir.slice(CGROUP_ROOT.length), pids });
  if (depth >= MAX_CGROUP_DEPTH) return;
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  await Promise.all(entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => collectCgroupProcs(join(dir, entry.name), depth + 1, out)));
}

async function listOverdeckCgroupProcs(): Promise<Array<{ cgroup: string; pids: number[] }>> {
  const slice = userAppSlice();
  let units: string[];
  try {
    units = (await readdir(slice, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && OVERDECK_UNIT.test(entry.name))
      .map((entry) => entry.name);
  } catch {
    return listOwnProcs();
  }
  const out: Array<{ cgroup: string; pids: number[] }> = [];
  await Promise.all(units.map((unit) => collectCgroupProcs(join(slice, unit), 1, out)));
  return out;
}

/** Fallback without a readable cgroup tree: every /proc pid owned by this user. */
async function listOwnProcs(): Promise<Array<{ cgroup: string; pids: number[] }>> {
  const uid = process.getuid?.();
  const entries = await readdir('/proc').catch(() => [] as string[]);
  const pids = await Promise.all(entries
    .filter((name) => /^\d+$/.test(name))
    .map(async (name) => {
      const info = await stat(join('/proc', name)).catch(() => null);
      return info && (uid === undefined || info.uid === uid) ? Number(name) : null;
    }));
  return [{ cgroup: '', pids: pids.filter((pid): pid is number => pid !== null) }];
}

async function readProcStatFile(pid: number): Promise<ProcStat | null> {
  const content = await readFile(`/proc/${pid}/stat`, 'utf-8').catch(() => null);
  return content ? parseProcStat(content) : null;
}

async function readEnvironFile(pid: number): Promise<Record<string, string> | null> {
  const content = await readFile(`/proc/${pid}/environ`, 'utf-8').catch(() => null);
  if (content == null) return null;
  const env: Record<string, string> = {};
  for (const entry of content.split('\0')) {
    const eq = entry.indexOf('=');
    if (eq > 0) env[entry.slice(0, eq)] = entry.slice(eq + 1);
  }
  return env;
}

async function readCmdlineFile(pid: number): Promise<string | null> {
  const content = await readFile(`/proc/${pid}/cmdline`, 'utf-8').catch(() => null);
  return content == null ? null : content.split('\0').filter(Boolean).join(' ');
}

async function readUptime(): Promise<number> {
  return Number((await readFile('/proc/uptime', 'utf-8')).split(/\s+/)[0]);
}

async function readAdmissionOwner(): Promise<number | null> {
  try {
    const owner = JSON.parse(await readFile(
      join(getOverdeckHome(), 'verification-workers', 'admission', 'owner.json'),
      'utf-8',
    )) as { pid?: unknown };
    return typeof owner.pid === 'number' ? owner.pid : null;
  } catch {
    return null;
  }
}

let previousCpuTotals: { idle: number; total: number } | null = null;

function readHostCpu(): { cpuPercent: number; load1: number; cores: number } {
  const records = cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of records) {
    idle += cpu.times.idle;
    total += Object.values(cpu.times).reduce((sum, value) => sum + value, 0);
  }
  const previous = previousCpuTotals;
  previousCpuTotals = { idle, total };
  const totalDelta = previous ? total - previous.total : 0;
  const cpuPercent = totalDelta > 0 ? ((totalDelta - (idle - previous!.idle)) / totalDelta) * 100 : 0;
  return { cpuPercent, load1: loadavg()[0]!, cores: Math.max(1, records.length) };
}

function defaultDeps(): RunawayPatrolDeps {
  return {
    listCgroupProcs: listOverdeckCgroupProcs,
    readProcStat: readProcStatFile,
    readEnviron: readEnvironFile,
    readCmdline: readCmdlineFile,
    readCwd: (pid) => readlink(`/proc/${pid}/cwd`).catch(() => null),
    readUptimeSeconds: readUptime,
    readAdmissionOwnerPid: readAdmissionOwner,
    // Lazy: keep the liveness graph out of this module's static imports.
    isAgentIdle: async (agentId) => (await import('../agents/liveness.js')).isIdle(agentId),
    readHostCpu,
    emit: (entry) => emitActivityEntry(entry as unknown as EmitActivityOptions),
    spikeSampler: createResourceSpikeSampler(),
    now: Date.now,
    platform: process.platform,
    dashboardPid: process.pid,
  };
}

// --- the patrol ---------------------------------------------------------------

function ageMinutes(ageMs: number): number {
  return Math.round(ageMs / 60_000);
}

function feedEntry(group: RunawayGroup, level: 'warn' | 'info', message: string): RunawayFeedEntry {
  return {
    level,
    source: 'cloister',
    link: '/resources',
    message,
    details: {
      category: 'resources',
      targetKind: 'runaway-process',
      targetId: group.owner,
      pgid: group.pgid,
      reason: group.reason,
      count: group.count,
    },
    desktop: false,
  };
}

const ISSUE_OWNER = /^[A-Z]+-\d+$/;

/** Group the attributed processes by command and owner for the spike sampler. */
function processGroupsOf(attributed: readonly AttributedProcessFact[]): ResourceProcessGroup[] {
  const groups = new Map<string, ResourceProcessGroup>();
  for (const fact of attributed) {
    const id = `${fact.comm}:${fact.owner}`;
    const existing = groups.get(id);
    if (existing) {
      existing.cpuPercent += fact.cpuPercent;
      existing.count = (existing.count ?? 1) + 1;
      existing.pids!.push(fact.pid);
      continue;
    }
    groups.set(id, {
      label: fact.comm,
      cpuPercent: fact.cpuPercent,
      count: 1,
      ...(fact.ownerAgentId ? { agentId: fact.ownerAgentId } : {}),
      ...(ISSUE_OWNER.test(fact.owner) ? { issueId: fact.owner } : {}),
      command: fact.cmdline || fact.comm,
      pids: [fact.pid],
    });
  }
  return [...groups.values()];
}

export function createRunawayPatrol(overrides: Partial<RunawayPatrolDeps> = {}): RunawayPatrol {
  const deps: RunawayPatrolDeps = { ...defaultDeps(), ...overrides };
  const rings = new Map<string, Array<{ atMs: number; cpuTicks: number }>>();
  const meta = new Map<string, IdentityMeta>();
  const warned = new Map<string, WarnedGroup>();
  let latest: RunawaySnapshot | null = null;

  async function metaFor(pid: number, identity: string): Promise<IdentityMeta | null> {
    const cached = meta.get(identity);
    if (cached) return cached;
    const [environ, cmdline, cwd] = await Promise.all([deps.readEnviron(pid), deps.readCmdline(pid), deps.readCwd(pid)]);
    if (cmdline == null) return null; // vanished between reads
    const read: IdentityMeta = {
      agentId: environ?.['OVERDECK_CONVERSATION'] ?? environ?.['OVERDECK_AGENT_ID'] ?? null,
      startedBy: environ?.['OVERDECK_AGENT_STARTED_BY'] ?? null,
      cmdline,
      cwd,
    };
    meta.set(identity, read);
    return read;
  }

  async function readFacts(nowMs: number): Promise<RunawayProcessFact[]> {
    const [cgroups, uptimeSeconds] = await Promise.all([deps.listCgroupProcs(), deps.readUptimeSeconds()]);
    const seen = new Set<string>();
    const facts = await Promise.all(cgroups.flatMap(({ cgroup, pids }) => pids.map(async (pid) => {
      const procStat = await deps.readProcStat(pid);
      if (!procStat) return null; // vanished: skipped silently
      const identity = `${pid}:${procStat.starttime}`;
      const identityMeta = await metaFor(pid, identity);
      if (!identityMeta) return null;
      seen.add(identity);

      const ring = rings.get(identity) ?? [];
      ring.push({ atMs: nowMs, cpuTicks: procStat.cpuTicks });
      const cutoff = nowMs - RUNAWAY_WINDOW_MS - RUNAWAY_PATROL_INTERVAL_MS;
      while (ring.length > 0 && ring[0]!.atMs < cutoff) ring.shift();
      rings.set(identity, ring);

      const oldest = ring[0]!;
      const previous = ring.length > 1 ? ring[ring.length - 2]! : null;
      const cores = (from: { atMs: number; cpuTicks: number }) => {
        const seconds = (nowMs - from.atMs) / 1000;
        return seconds > 0 ? (procStat.cpuTicks - from.cpuTicks) / CLK_TCK / seconds : 0;
      };
      const fact: RunawayProcessFact = {
        pid,
        ppid: procStat.ppid,
        pgid: procStat.pgid,
        comm: procStat.comm,
        cmdline: identityMeta.cmdline,
        ageMs: Math.max(0, (uptimeSeconds - procStat.starttime / CLK_TCK) * 1000),
        nice: procStat.nice,
        cgroup,
        cwd: identityMeta.cwd,
        agentId: identityMeta.agentId,
        startedBy: identityMeta.startedBy,
        starttime: procStat.starttime,
        sustainedCores: nowMs - oldest.atMs >= RUNAWAY_WINDOW_MS ? cores(oldest) : null,
        cpuPercent: previous ? cores(previous) * 100 : 0,
        memoryBytes: procStat.rssPages * PAGE_SIZE,
      };
      return fact;
    })));

    for (const identity of rings.keys()) {
      if (!seen.has(identity)) {
        rings.delete(identity);
        meta.delete(identity);
      }
    }
    return facts.filter((fact): fact is RunawayProcessFact => fact !== null);
  }

  /**
   * Two passes so `isIdle` runs only for agents that could matter: first
   * assume every agent idle (the most a group can qualify), then ask only the
   * agents behind an `outlived-tool-call` candidate.
   */
  async function classify(facts: RunawayProcessFact[]) {
    const base: RunawayContext = {
      idleAgentIds: new Set(),
      admissionOwnerPid: await deps.readAdmissionOwnerPid(),
      dashboardPid: deps.dashboardPid,
      windowMs: RUNAWAY_WINDOW_MS,
    };
    const everyAgent = new Set(facts.map((fact) => fact.agentId).filter((id): id is string => id !== null));
    const candidates = classifyRunaways(facts, { ...base, idleAgentIds: everyAgent }).runaways
      .filter((group) => group.reason === 'outlived-tool-call' && group.agentId)
      .map((group) => group.agentId!);
    const idle = new Set<string>();
    for (const agentId of new Set(candidates)) {
      if (await deps.isAgentIdle(agentId)) idle.add(agentId);
    }
    return classifyRunaways(facts, { ...base, idleAgentIds: idle });
  }

  function report(runaways: RunawayGroup[], facts: RunawayProcessFact[], nowMs: number): void {
    const live = new Set(facts.map((fact) => `${fact.pid}:${fact.starttime}`));
    const identitiesOf = (group: RunawayGroup) => new Set(facts
      .filter((fact) => group.pids.includes(fact.pid))
      .map((fact) => `${fact.pid}:${fact.starttime}`));

    for (const group of runaways) {
      const existing = warned.get(group.key);
      if (existing) {
        existing.group = group;
        existing.seenAtMs = nowMs;
        existing.identities = identitiesOf(group);
        continue;
      }
      warned.set(group.key, { group, seenAtMs: nowMs, identities: identitiesOf(group), escalated: false });
      deps.emit(feedEntry(group, 'warn',
        `${group.command} (${group.owner}) has burned ${group.cpuMinutes} CPU-min over ${ageMinutes(group.ageMs)} min `
        + `[${group.reason}]. pgid ${group.pgid}. Stop: kill -TERM -${group.pgid}`));
    }

    for (const [key, entry] of warned) {
      const { group } = entry;
      const alive = [...entry.identities].some((identity) => live.has(identity));
      const ageMs = group.ageMs + (nowMs - entry.seenAtMs);
      if (!alive) {
        warned.delete(key);
        deps.emit(feedEntry(group, 'info',
          `${group.command} (${group.owner}) exited after about ${ageMinutes(ageMs)} min. pgid ${group.pgid}.`));
        continue;
      }
      if (!entry.escalated && ageMs >= RUNAWAY_ESCALATE_MS) {
        entry.escalated = true;
        deps.emit(feedEntry(group, 'warn',
          `${group.command} (${group.owner}) is still running after ${ageMinutes(ageMs)} min [${group.reason}]. `
          + `pgid ${group.pgid}. Stop: kill -TERM -${group.pgid}`));
      }
    }
  }

  return {
    async tick() {
      if (deps.platform !== 'linux') return;
      const nowMs = deps.now();
      const facts = await readFacts(nowMs);
      const classification = await classify(facts);
      report(classification.runaways, facts, nowMs);
      const host = deps.readHostCpu();
      latest = {
        sampledAt: new Date(nowMs).toISOString(),
        records: facts.map((fact) => ({
          pid: fact.pid,
          ppid: fact.ppid,
          command: fact.cmdline || fact.comm,
          cpuPercent: fact.cpuPercent,
          memoryBytes: fact.memoryBytes,
          cgroup: fact.cgroup,
        })),
        agentSessions: [...classification.harnessPids].map(([agentId, rootPid]) => ({ agentId, rootPid })),
        coreServicePids: classification.coreServicePids,
        processGroups: processGroupsOf(classification.attributed),
        runaways: classification.runaways,
        cpuPercent: host.cpuPercent,
        load1: host.load1,
        cores: host.cores,
      };
      deps.spikeSampler.sample({
        cpuPercent: latest.cpuPercent,
        load1: latest.load1,
        cores: latest.cores,
        processGroups: latest.processGroups,
      });
    },
    snapshot: () => latest,
    reset() {
      rings.clear();
      meta.clear();
      warned.clear();
      latest = null;
    },
  };
}

// --- the dashboard's one patrol ----------------------------------------------

let defaultPatrol: RunawayPatrol | null = null;
let patrolTimer: ReturnType<typeof setInterval> | null = null;
let tickInFlight = false;

async function runDefaultTick(): Promise<void> {
  if (!defaultPatrol || tickInFlight) return;
  tickInFlight = true;
  try {
    await defaultPatrol.tick();
  } catch (error) {
    console.warn('[runaway-patrol] tick failed:', error instanceof Error ? error.message : error);
  } finally {
    tickInFlight = false;
  }
}

/** Start the dashboard's runaway patrol (main process only). A no-op off Linux. */
export function startRunawayPatrol(): void {
  if (process.platform !== 'linux' || patrolTimer) return;
  defaultPatrol = createRunawayPatrol();
  void runDefaultTick();
  patrolTimer = setInterval(() => { void runDefaultTick(); }, RUNAWAY_PATROL_INTERVAL_MS);
  patrolTimer.unref?.();
}

export function stopRunawayPatrol(): void {
  if (patrolTimer) clearInterval(patrolTimer);
  patrolTimer = null;
  defaultPatrol = null;
}

/** The latest sample, or null before the first tick (or off Linux). */
export function getRunawaySnapshot(): RunawaySnapshot | null {
  return defaultPatrol?.snapshot() ?? null;
}
