/**
 * Pure runaway-process classifier (PAN-4311 FR-9, FR-10, D6, D7).
 *
 * Input: one fact per live process from the Overdeck cgroups, as the runaway
 * patrol read them from /proc. Output: the CPU-heavy process groups that match
 * one of four runaway shapes, plus the harness pid per agent and the core
 * service pids the patrol hands to /api/resources.
 *
 * A group is a runaway when its CPU sustained over the whole window is at
 * least half a core AND one leg holds:
 * - `orphaned`: age >= 10 min, no live harness ancestor, and its parent chain
 *   reaches pid 1 or the user manager (`systemd`);
 * - `detached-from-tool-shell`: a non-shell direct child of a harness pid,
 *   age >= 10 min (a tool call normally runs under a `bash -c` shell);
 * - `outlived-tool-call`: age > 15 min and its agent is idle or its harness
 *   is gone (the conv-2884 `git log -S | head` shape);
 * - `long-burn`: age >= 30 min, whatever its parentage.
 *
 * Never flagged: harness processes and their ancestors (pane shells), core
 * services (Herdr, tmux, the dashboard), Docker/containerd cgroups, quality
 * gates (group leader at nice 19, younger than the gate watchdog), and the
 * quality-gate admission owner with its descendants. Observe-only: nothing
 * here or in the patrol kills, pauses or messages anything.
 */

import {
  ACP_BEHAVIOR,
  CLAUDE_CODE_BEHAVIOR,
  CODEX_BEHAVIOR,
  KIMI_CODE_BEHAVIOR,
  MUSE_BEHAVIOR,
  OHMYPI_BEHAVIOR,
  OPENCODE_BEHAVIOR,
  PRIME_AGENT_BEHAVIOR,
} from '@overdeck/contracts';

export interface RunawayProcessFact {
  pid: number;
  ppid: number;
  pgid: number;
  comm: string;
  cmdline: string;
  ageMs: number;
  nice: number;
  cgroup: string;
  cwd: string | null;
  /** OVERDECK_CONVERSATION ?? OVERDECK_AGENT_ID from environ. */
  agentId: string | null;
  /** OVERDECK_AGENT_STARTED_BY from environ. */
  startedBy: string | null;
  /** /proc/<pid>/stat field 22: with pid, the process identity. */
  starttime: number;
  /** CPU over the full window, in cores; null until the window is filled. */
  sustainedCores: number | null;
  /** Last-interval CPU percent, for display. */
  cpuPercent: number;
  memoryBytes: number;
}

export interface RunawayContext {
  idleAgentIds: ReadonlySet<string>;
  admissionOwnerPid: number | null;
  dashboardPid: number;
  windowMs: number;
}

export type RunawayReason = 'orphaned' | 'detached-from-tool-shell' | 'outlived-tool-call' | 'long-burn';

export interface RunawayGroup {
  key: string;
  owner: string;
  agentId: string | null;
  pgid: number;
  leaderStarttime: number;
  count: number;
  pids: number[];
  command: string;
  ageMs: number;
  sustainedCores: number;
  cpuMinutes: number;
  reason: RunawayReason;
}

export interface RunawayClassification {
  runaways: RunawayGroup[];
  /** agentId → harness pid (D6). */
  harnessPids: Map<string, number>;
  coreServicePids: number[];
  /** Every process not excluded above, with its owner. */
  attributed: Array<RunawayProcessFact & { owner: string }>;
}

const MINUTE_MS = 60_000;
export const RUNAWAY_MIN_SUSTAINED_CORES = 0.5;
const ORPHAN_MIN_AGE_MS = 10 * MINUTE_MS;
const DETACHED_MIN_AGE_MS = 10 * MINUTE_MS;
const OUTLIVED_MIN_AGE_MS = 15 * MINUTE_MS;
const LONG_BURN_MIN_AGE_MS = 30 * MINUTE_MS;
/** GATE_TIMEOUT_MS + GATE_WATCHDOG_GRACE_MS (validation.ts): the gate watchdog kills a gate after this. */
const GATE_MAX_AGE_MS = 20.5 * MINUTE_MS;
const GATE_NICE = 19;
const COMMAND_MAX_CHARS = 120;

const SHELLS: ReadonlySet<string> = new Set(['bash', 'sh', 'dash', 'zsh', 'fish']);
const HARNESS_PROCESS_NAMES: ReadonlySet<string> = new Set([
  CLAUDE_CODE_BEHAVIOR, OHMYPI_BEHAVIOR, CODEX_BEHAVIOR, ACP_BEHAVIOR,
  KIMI_CODE_BEHAVIOR, OPENCODE_BEHAVIOR, MUSE_BEHAVIOR, PRIME_AGENT_BEHAVIOR,
].flatMap((behavior) => behavior.processNames));
const DOCKER_CGROUP = /docker|containerd/;
const UNIT_NAME = /([^/]+\.(?:service|scope))$/;
const WORKSPACE_ISSUE = /workspaces\/feature-([a-z]+-\d+)/i;

function isHarnessProcess(fact: RunawayProcessFact): boolean {
  if (HARNESS_PROCESS_NAMES.has(fact.comm) || fact.comm.startsWith('muse-bin-')) return true;
  return fact.comm === 'node' && fact.cmdline.includes('codex-app-server-host');
}

function isCoreService(fact: RunawayProcessFact, dashboardPid: number): boolean {
  return fact.comm === 'herdr' || fact.comm.startsWith('tmux') || fact.pid === dashboardPid;
}

/** Ancestors of a pid within the facts, nearest first. Stops at a cycle or a missing parent. */
function ancestors(pid: number, byPid: ReadonlyMap<number, RunawayProcessFact>): RunawayProcessFact[] {
  const chain: RunawayProcessFact[] = [];
  const seen = new Set<number>([pid]);
  let current = byPid.get(pid);
  while (current && !seen.has(current.ppid)) {
    seen.add(current.ppid);
    const parent = byPid.get(current.ppid);
    if (!parent) break;
    chain.push(parent);
    current = parent;
  }
  return chain;
}

/**
 * D6: per agent, the harness process closest to the pane root — a harness
 * process carrying the agent's id whose ancestors carry no harness process of
 * the same agent. Ties go to the lowest pid.
 */
export function resolveHarnessPids(facts: readonly RunawayProcessFact[]): Map<string, number> {
  const byPid = new Map(facts.map((fact) => [fact.pid, fact]));
  const harnessPids = new Map<string, number>();
  for (const fact of facts) {
    if (!fact.agentId || !isHarnessProcess(fact)) continue;
    const agentId = fact.agentId;
    const nested = ancestors(fact.pid, byPid).some((ancestor) => ancestor.agentId === agentId && isHarnessProcess(ancestor));
    if (nested) continue;
    const existing = harnessPids.get(agentId);
    if (existing === undefined || fact.pid < existing) harnessPids.set(agentId, fact.pid);
  }
  return harnessPids;
}

function resolveOwner(
  fact: RunawayProcessFact,
  byPid: ReadonlyMap<number, RunawayProcessFact>,
): { owner: string; agentId: string | null } {
  const agentId = fact.agentId ?? ancestors(fact.pid, byPid).find((ancestor) => ancestor.agentId)?.agentId ?? null;
  if (agentId) return { owner: agentId, agentId };
  const unit = fact.cgroup.match(UNIT_NAME)?.[1];
  if (unit) return { owner: unit, agentId: null };
  const issue = fact.cwd?.match(WORKSPACE_ISSUE)?.[1];
  if (issue) return { owner: issue.toUpperCase(), agentId: null };
  return { owner: 'host', agentId: null };
}

type Chain = 'attached' | 'orphaned' | 'harness-gone';

/**
 * Walk the parent chain: through a harness pid → attached; to a core service
 * (a shell left under Herdr or tmux, its harness gone) → harness-gone; to
 * pid 1, the user manager (`systemd`) or out of the Overdeck cgroups →
 * orphaned.
 */
function classifyChain(
  fact: RunawayProcessFact,
  byPid: ReadonlyMap<number, RunawayProcessFact>,
  harnessPidSet: ReadonlySet<number>,
  coreServicePids: ReadonlySet<number>,
): Chain {
  const seen = new Set<number>([fact.pid]);
  let ppid = fact.ppid;
  while (!seen.has(ppid)) {
    if (harnessPidSet.has(ppid)) return 'attached';
    if (coreServicePids.has(ppid)) return 'harness-gone';
    if (ppid <= 1) return 'orphaned';
    const parent = byPid.get(ppid);
    // Reparenting only goes to init or a subreaper, so a parent outside the
    // enumerated Overdeck cgroups is the user manager.
    if (!parent || parent.comm === 'systemd') return 'orphaned';
    seen.add(ppid);
    ppid = parent.ppid;
  }
  return 'harness-gone';
}

function truncateCommand(command: string): string {
  return command.length > COMMAND_MAX_CHARS ? `${command.slice(0, COMMAND_MAX_CHARS - 1)}…` : command;
}

function excludedPids(
  facts: readonly RunawayProcessFact[],
  byPid: ReadonlyMap<number, RunawayProcessFact>,
  harnessPids: ReadonlyMap<string, number>,
  coreServicePids: ReadonlySet<number>,
  context: RunawayContext,
): Set<number> {
  const excluded = new Set<number>(coreServicePids);
  for (const harnessPid of harnessPids.values()) {
    excluded.add(harnessPid);
    for (const ancestor of ancestors(harnessPid, byPid)) excluded.add(ancestor.pid);
  }
  const gateGroups = new Set<number>();
  for (const fact of facts) {
    if (fact.pid === fact.pgid && fact.nice >= GATE_NICE && fact.ageMs < GATE_MAX_AGE_MS) gateGroups.add(fact.pgid);
  }
  for (const fact of facts) {
    if (DOCKER_CGROUP.test(fact.cgroup) || gateGroups.has(fact.pgid)) excluded.add(fact.pid);
    if (context.admissionOwnerPid != null && (
      fact.pid === context.admissionOwnerPid
      || ancestors(fact.pid, byPid).some((ancestor) => ancestor.pid === context.admissionOwnerPid)
    )) {
      excluded.add(fact.pid);
    }
  }
  return excluded;
}

function runawayReason(
  representative: RunawayProcessFact,
  agentId: string | null,
  byPid: ReadonlyMap<number, RunawayProcessFact>,
  harnessPids: ReadonlyMap<string, number>,
  harnessPidSet: ReadonlySet<number>,
  coreServicePids: ReadonlySet<number>,
  context: RunawayContext,
): RunawayReason | null {
  const age = representative.ageMs;
  const chain = classifyChain(representative, byPid, harnessPidSet, coreServicePids);
  if (chain === 'orphaned' && age >= ORPHAN_MIN_AGE_MS) return 'orphaned';
  if (
    harnessPidSet.has(representative.ppid)
    && !SHELLS.has(representative.comm)
    && age >= DETACHED_MIN_AGE_MS
  ) {
    return 'detached-from-tool-shell';
  }
  const harnessGone = chain !== 'attached' || (agentId != null && !harnessPids.has(agentId));
  const idle = agentId != null && context.idleAgentIds.has(agentId);
  if (age > OUTLIVED_MIN_AGE_MS && (idle || harnessGone)) return 'outlived-tool-call';
  if (age >= LONG_BURN_MIN_AGE_MS) return 'long-burn';
  return null;
}

/** D7: the oldest member represents the group; ties go to the lowest pid. */
function representativeOf(members: readonly RunawayProcessFact[]): RunawayProcessFact {
  return members.reduce((best, fact) =>
    fact.ageMs > best.ageMs || (fact.ageMs === best.ageMs && fact.pid < best.pid) ? fact : best);
}

export function classifyRunaways(
  facts: readonly RunawayProcessFact[],
  context: RunawayContext,
): RunawayClassification {
  const byPid = new Map(facts.map((fact) => [fact.pid, fact]));
  const harnessPids = resolveHarnessPids(facts);
  const harnessPidSet = new Set(harnessPids.values());
  const coreServicePids = new Set(
    facts.filter((fact) => isCoreService(fact, context.dashboardPid)).map((fact) => fact.pid),
  );
  coreServicePids.add(context.dashboardPid);
  const excluded = excludedPids(facts, byPid, harnessPids, coreServicePids, context);

  const attributed: Array<RunawayProcessFact & { owner: string }> = [];
  const groups = new Map<number, Array<RunawayProcessFact & { owner: string; resolvedAgentId: string | null }>>();
  for (const fact of facts) {
    if (excluded.has(fact.pid)) continue;
    const { owner, agentId } = resolveOwner(fact, byPid);
    attributed.push({ ...fact, owner });
    const members = groups.get(fact.pgid) ?? [];
    members.push({ ...fact, owner, resolvedAgentId: agentId });
    groups.set(fact.pgid, members);
  }

  const runaways: RunawayGroup[] = [];
  for (const [pgid, members] of groups) {
    const sustained = members.filter((member) => member.sustainedCores != null);
    if (sustained.length === 0) continue;
    const sustainedCores = sustained.reduce((sum, member) => sum + member.sustainedCores!, 0);
    if (sustainedCores < RUNAWAY_MIN_SUSTAINED_CORES) continue;
    const representative = representativeOf(members) as (typeof members)[number];
    const reason = runawayReason(
      representative,
      representative.resolvedAgentId,
      byPid,
      harnessPids,
      harnessPidSet,
      coreServicePids,
      context,
    );
    if (!reason) continue;
    const leaderStarttime = byPid.get(pgid)?.starttime ?? representative.starttime;
    runaways.push({
      key: `${representative.owner}:${pgid}:${leaderStarttime}`,
      owner: representative.owner,
      agentId: representative.resolvedAgentId,
      pgid,
      leaderStarttime,
      count: members.length,
      pids: members.map((member) => member.pid).sort((a, b) => a - b),
      command: truncateCommand(representative.cmdline || representative.comm),
      ageMs: representative.ageMs,
      sustainedCores,
      cpuMinutes: Math.round((sustainedCores * context.windowMs / MINUTE_MS) * 10) / 10,
      reason,
    });
  }

  return {
    runaways: runaways.sort((a, b) => b.sustainedCores - a.sustainedCores),
    harnessPids,
    coreServicePids: [...coreServicePids].sort((a, b) => a - b),
    attributed,
  };
}
