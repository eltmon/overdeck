/**
 * The lane door core (.pan/drafts/pan-4223.md WI-3 step 4): one function behind
 * `POST /api/lanes` and `pan lane start` (FR-2).
 *
 * A lane is an ordinary conversation with four write-once launch facts (parent
 * link, run, key, role). The door resolves the parent and its effective
 * launcher (D5, D21), enforces the D8 role rules against the launcher, derives
 * the run (D4) and the iteration (D7), creates the lane's isolated working
 * directory under the lanes root (FR-3 to FR-5, D8), writes the brief once
 * (FR-9, D9), creates the row and starts the runtime with the lane contract.
 *
 * Launches for one project are serialized in-process (NFR-4) from the FR-6
 * liveness read through the row insert. A lane that is alive or still
 * `starting` (D10: not ended, no spawn error, created under 3 min ago)
 * occupies its (run, key, role) slot, so a launch during the first lane's
 * spawn window is refused too. All git and fs work is async (NFR-2).
 */
import { randomUUID } from 'node:crypto';
import { mkdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';

import { getHarnessBehavior, type PlacementRejection } from '@overdeck/contracts';

import { getEventStore } from '../../dashboard/server/event-store.js';
import { workerDir } from '../agents/worker/ids.js';
import { latestWorkerReport, type WorkerReport } from '../agents/worker/report.js';
import { assessCpuPressure, type CpuPressureVerdict } from '../cloister/cpu-pressure.js';
import { MODEL_ID_PATTERN } from '../model-validation.js';
import { conversationHarnessAlive } from '../overdeck/conversation-liveness.js';
import {
  generateConversationName,
  resolveAllowedHarness,
  SAFE_EFFORT_PATTERN,
  startConversationRuntime,
  stopConversationRuntime,
  type StartConversationRuntimeInput,
} from '../overdeck/conversation-runtime.js';
import {
  createConversation,
  getConversationById,
  getConversationByName,
  LANE_ROLES,
  markConversationEnded,
  resolveEffectiveLauncher,
  type LaneRole,
  type LegacyConversation,
} from '../overdeck/conversations.js';
import type { RuntimeName } from '../runtimes/types.js';
import { resolveLaneConfig, type LaneConfig } from './config.js';
import { laneContract, type LaneAnswering } from './contract.js';
import { distinctLaneCwds, laneIterations } from './iteration.js';
import { listAllLaneRows, type LaneRow } from './lane-rows.js';
import { pairBuilder, type PairingRow } from './pairing.js';
import {
  readRemoteLane,
  remoteLaneNameTaken,
  removeRemoteLane,
  reserveRemoteLane,
  writeCriticLink,
  writeRemoteLaneFacts,
  type RemoteLaneFacts,
  type RemoteLaneMirror,
} from './remote-lanes.js';
import { LaneLaunchError, type LaneLaunchRequest, type LaneLaunchResult, type LanePlacement, type OwnerLaneSpec } from './types.js';
import { addBranchWorktree, addDetachedWorktree, applySparse, fetchBase, laneDirName, removeWorktree } from './worktree.js';

export const RUN_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;
export const KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{0,39}$/;
/** opencode takes free-form effort names, as at the conversation door. */
const OPENCODE_EFFORT_PATTERN = /^[a-z][a-z0-9_-]*$/;

/** D20: a lane takes low, medium or high; opencode also takes its free-form variant names. */
export function isValidLaneEffort(effort: string, harness: RuntimeName): boolean {
  return (harness === 'opencode' ? OPENCODE_EFFORT_PATTERN : SAFE_EFFORT_PATTERN).test(effort);
}
/** D10 `starting`: a row not ended, created less than this long ago. */
export const STARTING_GRACE_MS = 3 * 60_000;
const REPLACE_POLL_MS = 1_000;
const REPLACE_WAIT_MS = 30_000;
/** D8: roles only a root conversation (by effective launcher) may launch. */
const ROOT_ONLY_ROLES: ReadonlySet<LaneRole> = new Set(['orchestrator', 'critic']);
const DETACHED_ROLES: ReadonlySet<LaneRole> = new Set(['critic', 'verifier', 'orchestrator']);

export interface LaneGit {
  fetchBase: typeof fetchBase;
  addBranchWorktree: typeof addBranchWorktree;
  addDetachedWorktree: typeof addDetachedWorktree;
  applySparse: typeof applySparse;
  /** Optional in test fakes; defaults to the real helper. */
  removeWorktree?: typeof removeWorktree;
}

/**
 * PAN-4638: the linked machine a lane runs on, resolved by `POST /api/lanes`.
 * Absent means this machine.
 */
export interface RemoteLaneTarget {
  environmentId: string;
  label: string;
  reason: string | null;
  isFly: boolean;
  rejections: PlacementRejection[];
  /** Posts the owner lane door; answers its status and JSON body. A throw means the owner was not reached. */
  launch: (spec: OwnerLaneSpec) => Promise<{ status: number; body: Record<string, unknown> }>;
  /** Stops a lane on this owner through its conversation stop door (D-4638-13). */
  stop: (name: string) => Promise<void>;
}

/** PAN-5006: Auto picked this machine; `resolveMachine` returns this instead of a `RemoteLaneTarget`. */
export interface LocalLanePlacement {
  self: true;
  label: string;
  reason: string;
  rejections: PlacementRejection[];
}

/** Test seams; production callers use the defaults. */
export interface LaneLaunchDeps {
  /** PAN-4638 FR-1: launch on this linked machine instead of here. */
  remote?: RemoteLaneTarget;
  /**
   * PAN-4638: resolves a machine (label, environment id or `auto`) for the
   * project; null or a `LocalLanePlacement` means this machine. Used for
   * `--machine`, for a `--reuse` whose newest lane ran elsewhere, and to stop
   * a live lane on another machine. A `LocalLanePlacement` also carries
   * Auto's reason (PAN-5006).
   */
  resolveMachine?: (machine: string, needs: readonly string[], projectKey: string) => Promise<RemoteLaneTarget | LocalLanePlacement | null>;
  git?: LaneGit;
  resolveConfig?: (project: string) => Promise<LaneConfig>;
  resolveHarness?: (requested: string | undefined, model: string) => Promise<RuntimeName>;
  isAlive?: (tmuxSession: string) => Promise<boolean>;
  /** The conversation stop door: stop the runtime, then mark the row ended. */
  stop?: (conv: LegacyConversation) => Promise<void>;
  start?: (input: StartConversationRuntimeInput) => Promise<void>;
  emitCreated?: (name: string) => void;
  latestReport?: (id: string) => Promise<WorkerReport | null>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  homeDir?: () => string;
  /** FR-3: lanes may not live under this directory. Default `/tmp`. */
  tmpRoot?: string;
  /** PAN-4311: the stateless CPU pressure check. Default `assessCpuPressure`. */
  cpuPressure?: () => Promise<CpuPressureVerdict>;
}

const remoteOf = (target: RemoteLaneTarget | LocalLanePlacement | null): RemoteLaneTarget | undefined =>
  target && !('self' in target) ? target : undefined;

const projectLocks = new Map<string, Promise<void>>();

export async function withProjectLock<T>(projectKey: string, fn: () => Promise<T>): Promise<T> {
  const previous = projectLocks.get(projectKey) ?? Promise.resolve();
  let release!: () => void;
  const held = new Promise<void>((resolveHeld) => { release = resolveHeld; });
  const chained = previous.then(() => held);
  projectLocks.set(projectKey, chained);
  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (projectLocks.get(projectKey) === chained) projectLocks.delete(projectKey);
  }
}

function resolveParent(ref: string): LegacyConversation | null {
  const trimmed = ref.trim();
  if (/^\d+$/.test(trimmed)) return getConversationById(Number(trimmed));
  return getConversationByName(trimmed)
    ?? (trimmed.startsWith('conv-') ? getConversationByName(trimmed.slice('conv-'.length)) : null);
}

/** D8 against the effective launcher (D21, FR-30). A root may launch any role. */
function checkLauncher(role: LaneRole, launcher: LegacyConversation): void {
  if (launcher.laneKey === null) return;
  const standing = `the effective launcher #${launcher.id} (${launcher.name}) is a ${launcher.laneRole} lane`;
  if (ROOT_ONLY_ROLES.has(role)) {
    throw new LaneLaunchError(400, `a ${role} lane may be launched only by a root conversation; ${standing}`);
  }
  if (launcher.laneRole !== 'orchestrator') {
    throw new LaneLaunchError(400, `only a root conversation or an orchestrator lane may launch lanes; ${standing}`);
  }
}

/** D4: a root names the run; an orchestrator lane's launches inherit its run. */
function resolveRun(requested: string | undefined, launcher: LegacyConversation): string {
  if (launcher.laneKey !== null) {
    const inherited = launcher.gauntletRun ?? '';
    if (requested !== undefined && requested !== inherited) {
      throw new LaneLaunchError(400, `--run ${requested} does not match run ${inherited} of orchestrator lane #${launcher.id}`);
    }
    return inherited;
  }
  if (!requested) throw new LaneLaunchError(400, '--run is required when the launcher is not an orchestrator lane');
  return requested;
}

/** D8 directory names. The orchestrator follows the builder rule for n ≥ 2 so every iteration gets a new directory (D7). */
export function laneDir(role: LaneRole, run: string, key: string, n: number): string {
  switch (role) {
    case 'builder': return n === 1 ? `${run}-${key}` : `${run}-${key}-i${n}`;
    case 'orchestrator': return n === 1 ? `${run}-${key}-orch` : `${run}-${key}-orch-i${n}`;
    case 'critic': return `${run}-${key}-critic-i${n}`;
    case 'verifier': return `${run}-${key}-verify-i${n}`;
    case 'play': return `${run}-${key}-play-i${n}`;
  }
}

function conventionBranch(run: string, key: string, n: number): string {
  return n === 1 ? `${run}/${key}` : `${run}/${key}-i${n}`;
}

/** D7: the branch of a builder iteration — the newest report's git.branch of a lane in its directory, else the convention. */
async function iterationBranch(
  rows: readonly LaneRow[],
  cwdKey: string,
  run: string,
  key: string,
  n: number,
  latestReport: (id: string) => Promise<WorkerReport | null>,
): Promise<string> {
  for (const row of rows.filter((candidate) => candidate.cwdKey === cwdKey).reverse()) {
    const branch = (await latestReport(`conv-${row.name}`))?.git?.branch;
    if (branch) return branch;
  }
  return conventionBranch(run, key, n);
}

export function isWithin(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent.endsWith(sep) ? parent : `${parent}${sep}`);
}

async function realOrResolved(path: string): Promise<string> {
  return realpath(path).catch(() => resolve(path));
}

export async function pathExists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false);
}

/** FR-3: under $HOME, not under /tmp, neither equal to nor containing the project checkout. Creates it when missing. */
export async function prepareLanesRoot(lanesRoot: string, projectPath: string, home: string, tmpRoot: string): Promise<string> {
  const homeReal = await realOrResolved(home);
  const tmpRoots = [resolve(tmpRoot), await realOrResolved(tmpRoot)];
  const projectReal = await realOrResolved(projectPath);
  const check = (root: string): void => {
    if (!isWithin(root, homeReal)) throw new LaneLaunchError(400, `lanes root ${root} must be under ${homeReal}`);
    if (tmpRoots.some((tmp) => isWithin(root, tmp))) throw new LaneLaunchError(400, `lanes root ${root} must not be under ${tmpRoot}`);
    if (isWithin(projectReal, root)) {
      throw new LaneLaunchError(400, `lanes root ${root} must not equal or contain the project checkout ${projectReal}`);
    }
  };
  check(resolve(lanesRoot));
  await mkdir(lanesRoot, { recursive: true });
  const real = await realpath(lanesRoot);
  check(real);
  return real;
}

function validateRequest(request: LaneLaunchRequest): void {
  if (!(LANE_ROLES as readonly string[]).includes(request.role)) {
    throw new LaneLaunchError(400, `unknown role ${String(request.role)}: expected one of ${LANE_ROLES.join(', ')}`);
  }
  if (request.run !== undefined && !RUN_PATTERN.test(request.run)) {
    throw new LaneLaunchError(400, `run key ${request.run} must match ${RUN_PATTERN.source}`);
  }
  if (!request.brief.trim()) throw new LaneLaunchError(400, 'a lane needs a brief: pass --brief <file> or --prompt <text>');
  if (request.branch !== undefined && request.role !== 'builder') throw new LaneLaunchError(400, '--branch applies to builder lanes only');
  // Refs reach git as positional arguments; a leading dash would parse as an option.
  for (const [flag, value] of [['--at', request.at], ['--from', request.from], ['--branch', request.branch]] as const) {
    if (value !== undefined && (value.startsWith('-') || value.trim() === '')) {
      throw new LaneLaunchError(400, `${flag} ${value} is not a git ref`);
    }
  }
}

/**
 * WI-19: resolves the lane key and, for a critic or verifier with `for`, the
 * judged builder row (the newest builder row of that key in the run) and the
 * default `--at` (the head of the newest done report of that builder
 * iteration). Nothing from the builder row but that SHA reaches the critic
 * (FR-38).
 */
async function resolveCriticLink(
  request: LaneLaunchRequest,
  run: string,
  latestReport: (id: string) => Promise<WorkerReport | null>,
): Promise<{ key: string; criticOf: LaneRow | null; judgedAt: string | null }> {
  const judge = request.role === 'critic' || request.role === 'verifier';
  if (request.for !== undefined && !judge) throw new LaneLaunchError(400, '--for is for critic and verifier lanes');
  if (request.role === 'critic' && !request.for) throw new LaneLaunchError(400, 'a critic needs --for <builder key>');
  if (!request.for) {
    if (!request.key || !KEY_PATTERN.test(request.key)) {
      throw new LaneLaunchError(400, `lane key ${request.key ?? '(missing)'} must match ${KEY_PATTERN.source}`);
    }
    if (judge && !request.at) throw new LaneLaunchError(400, `a ${request.role} lane needs --at <commit> or --for <builder key>`);
    return { key: request.key, criticOf: null, judgedAt: null };
  }
  const builderKey = request.for;
  if (request.key !== undefined && request.key !== builderKey) {
    throw new LaneLaunchError(400, `a critic's --key is its builder's key (${builderKey})`);
  }
  if (!KEY_PATTERN.test(builderKey)) throw new LaneLaunchError(400, `lane key ${builderKey} must match ${KEY_PATTERN.source}`);
  const builders = await listAllLaneRows({ run, key: builderKey, role: 'builder' });
  const target = builders.at(-1);
  if (!target) throw new LaneLaunchError(400, `no builder lane ${builderKey} in run ${run}`);
  if (request.at) return { key: builderKey, criticOf: target, judgedAt: null };

  const iterations = laneIterations(builders);
  const iteration = iterations.get(target.name) ?? 1;
  let newest: WorkerReport | null = null;
  for (const row of builders.filter((candidate) => iterations.get(candidate.name) === iteration)) {
    const report = await latestReport(`conv-${row.name}`);
    if (report?.status === 'done' && report.git?.head && (!newest || Date.parse(report.at) > Date.parse(newest.at))) newest = report;
  }
  if (!newest?.git) throw new LaneLaunchError(400, `builder ${builderKey} i${iteration} has no done report; pass --at <sha>`);
  return { key: builderKey, criticOf: target, judgedAt: newest.git.head };
}

/** FR-38: the critic verdict builder iteration `iteration` answers, from the pairing module. */
async function answeredVerdict(
  run: string,
  key: string,
  iteration: number,
  nowMs: number,
  latestReport: (id: string) => Promise<WorkerReport | null>,
): Promise<LaneAnswering | null> {
  const rows = await listAllLaneRows({ run, key });
  const iterations = laneIterations(rows);
  const pairingRows: PairingRow[] = [];
  for (const row of rows) {
    const report = await latestReport(`conv-${row.name}`);
    const mirror = row.remote?.mirror;
    const active = row.local ? row.local.status === 'active' : row.archivedAt === null && mirror?.state !== 'gone';
    pairingRows.push({
      id: row.id,
      name: row.name,
      run,
      key,
      role: row.role,
      iteration: iterations.get(row.name) ?? 1,
      createdAt: row.createdAt,
      criticOfName: row.criticOfName,
      activity: active ? 'active' : 'stopped',
      report: report ? { status: report.status, ...(report.verdict ? { verdict: report.verdict } : {}) } : null,
    });
  }
  const provisional: PairingRow = {
    id: null, name: '', run, key, role: 'builder', iteration, createdAt: new Date(nowMs).toISOString(), criticOfName: null, activity: 'starting', report: null,
  };
  const answer = pairBuilder(provisional, [...pairingRows, provisional]).answering;
  return answer
    ? { criticId: answer.id, criticName: answer.name, role: answer.role, iteration: answer.iteration, verdict: answer.verdict, file: answer.file }
    : null;
}

export function gitFailure(error: unknown): LaneLaunchError {
  const message = error instanceof Error ? error.message : String(error);
  return new LaneLaunchError(400, `git worktree add failed: ${message.trim()}`);
}

/** Remote activities that hold a (run, key, role) slot. */
const REMOTE_LIVE_ACTIVITIES: ReadonlySet<string> = new Set(['working', 'idle', 'needs-you', 'starting']);
/** D-4638-2: how many times a remote launch retries after the owner answers `name-taken`. */
const NAME_TAKEN_RETRIES = 3;
const NAME_ATTEMPTS = 5;
const OWNER_STATUSES: ReadonlySet<number> = new Set([400, 403, 404, 409, 429, 503]);

/** FR-6 for a remote lane, judged from home's stand-in: no mirror yet within the starting grace, or a running mirror, or an unreachable owner. */
function remoteOccupies(
  remote: { facts: RemoteLaneFacts; mirror: RemoteLaneMirror | null },
  archivedAt: string | null,
  nowMs: number,
): boolean {
  if (archivedAt !== null) return false;
  const { mirror } = remote;
  if (mirror === null) return nowMs - Date.parse(remote.facts.createdAt) < STARTING_GRACE_MS;
  if (mirror.unreachableSince !== null) return true;
  return mirror.state === 'running' && REMOTE_LIVE_ACTIVITIES.has(mirror.activity);
}

function describeRow(row: LaneRow): string {
  return row.id === null ? `${row.name} on ${row.remote?.facts.label ?? 'another machine'}` : `conversation #${row.id} (${row.name})`;
}

export async function launchLane(request: LaneLaunchRequest, deps: LaneLaunchDeps = {}): Promise<LaneLaunchResult> {
  const git = deps.git ?? { fetchBase, addBranchWorktree, addDetachedWorktree, applySparse };
  const isAlive = deps.isAlive ?? ((tmuxSession: string) => conversationHarnessAlive(tmuxSession));
  const stop = deps.stop ?? (async (conv: LegacyConversation) => {
    await stopConversationRuntime(conv, conv.name);
    markConversationEnded(conv.name);
  });
  const start = deps.start ?? startConversationRuntime;
  const emitCreated = deps.emitCreated ?? ((name: string) => {
    getEventStore().emitOnly({ type: 'conversation.created', timestamp: new Date().toISOString(), payload: { conversationName: name } });
  });
  const latestReport = deps.latestReport ?? latestWorkerReport;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  let remote = deps.remote;

  validateRequest(request);
  const { role } = request;
  // D-4638-8: a reuse continues on the newest lane's machine.
  if (request.machine !== undefined && request.reuse) {
    throw new LaneLaunchError(400, "--reuse continues on the newest lane's machine; drop --machine");
  }
  // 1-2. Parent (D5), effective launcher (D21) and its D8 standing, run (D4).
  const parent = resolveParent(request.parent);
  if (!parent) throw new LaneLaunchError(404, `parent conversation ${request.parent} not found`);
  const launcher = resolveEffectiveLauncher(parent.name) ?? parent;
  checkLauncher(role, launcher);
  const run = resolveRun(request.run, launcher);

  // The critic link (WI-19, FR-31, FR-32, D29): key, judged builder row and default --at.
  const { key, criticOf, judgedAt } = await resolveCriticLink(request, run, latestReport);
  const requestAt = request.at ?? judgedAt ?? undefined;

  // 3. Project and its lane config.
  const project = request.project ?? parent.projectKey;
  if (!project) throw new LaneLaunchError(400, `parent conversation ${parent.name} has no project: name --project`);

  // The machine (FR-1): --machine, or the machine of the newest lane a --reuse continues (D-4638-8).
  let placement: LanePlacement | null = null;
  if (!remote && request.machine !== undefined) {
    if (!deps.resolveMachine) throw new LaneLaunchError(400, '--machine needs the dashboard: launch through POST /api/lanes');
    const resolved = await deps.resolveMachine(request.machine, request.needs ?? [], project);
    remote = remoteOf(resolved);
    if (resolved && resolved.reason !== null) placement = { label: resolved.label, reason: resolved.reason, rejections: [...resolved.rejections] };
  }
  if (!remote && request.reuse && deps.resolveMachine) {
    const newestFacts = (await listAllLaneRows({ run, key, role })).at(-1)?.remote?.facts;
    if (newestFacts) remote = remoteOf(await deps.resolveMachine(newestFacts.environmentId, [], project));
  }
  // D-4638-9: an orchestrator lane on another machine would launch lanes listed only there.
  if (remote && role === 'orchestrator') throw new LaneLaunchError(400, "orchestrator lanes run on the orchestrator's machine");

  // PAN-4311 FR-14: a lane adds load the operator did not start by hand; hold
  // it while the host is CPU-saturated unless the caller forces it. A remote
  // lane is checked by its owner instead (D-4638-10).
  if (!request.force && !remote) {
    const cpu = await (deps.cpuPressure ?? assessCpuPressure)();
    if (cpu.saturated) {
      throw new LaneLaunchError(
        429,
        `cpu-saturated: ${cpu.signal} ${cpu.reading} is at or above ${cpu.threshold}; the host is CPU-saturated. Pass --force to launch anyway.`,
      );
    }
  }
  const config = await (deps.resolveConfig ?? resolveLaneConfig)(project);

  // 4. Lanes root (FR-3). A remote lane lives under the owner's lanes root.
  const lanesRoot = remote ? null : await prepareLanesRoot(config.lanesRoot, config.projectPath, (deps.homeDir ?? homedir)(), deps.tmpRoot ?? '/tmp');

  // 5. Model, harness, effort (FR-8, D20). No hardcoded model fallback.
  const roleConfig = config.roles[role] ?? {};
  const model = request.model?.trim() || roleConfig.model;
  if (!model) {
    throw new LaneLaunchError(400, `no model for role ${role}: pass --model or set projects.${config.projectKey}.gauntlet.roles.${role}.model`);
  }
  if (!MODEL_ID_PATTERN.test(model)) throw new LaneLaunchError(400, `invalid model ${model}`);
  let harness: RuntimeName;
  try {
    harness = await (deps.resolveHarness ?? resolveAllowedHarness)(request.harness?.trim() || roleConfig.harness || undefined, model);
  } catch (error) {
    throw new LaneLaunchError(400, error instanceof Error ? error.message : String(error));
  }
  const effort = request.effort?.trim() || roleConfig.effort;
  if (effort && !isValidLaneEffort(effort, harness)) {
    throw new LaneLaunchError(400, 'effort must be low, medium or high');
  }
  // FR-10: only harnesses that declare runsOnFlyMachine run on a Fly machine (#4296).
  if (remote?.isFly && !getHarnessBehavior(harness).capabilities.runsOnFlyMachine) {
    throw new LaneLaunchError(400, `${harness} does not run on Fly machines (#4296)`);
  }

  // 6. Serialize the rest per project (NFR-4).
  return withProjectLock(config.projectKey, async () => {
    const warnings: string[] = [];
    const occupies = async (row: LaneRow): Promise<boolean> => {
      if (row.remote) return remoteOccupies(row.remote, row.archivedAt, now());
      const local = row.local!;
      if (await isAlive(local.tmuxSession)) return true;
      return local.status === 'active' && local.archivedAt === null && local.spawnError === null
        && now() - Date.parse(local.createdAt) < STARTING_GRACE_MS;
    };
    const stillLive = async (row: LaneRow): Promise<boolean> => {
      if (!row.remote) return isAlive(row.local!.tmuxSession);
      const fresh = await readRemoteLane(row.name);
      return fresh ? remoteOccupies(fresh, fresh.archivedAt, now()) : false;
    };
    const stopRow = async (row: LaneRow): Promise<void> => {
      if (!row.remote) return stop(row.local!);
      const { facts } = row.remote;
      if (remote && facts.environmentId === remote.environmentId) return remote.stop(row.name);
      const owner = deps.resolveMachine ? remoteOf(await deps.resolveMachine(facts.environmentId, [], project)) ?? null : null;
      if (owner) return owner.stop(row.name);
      throw new LaneLaunchError(409, `lane ${run}/${key} ${role} is live on ${facts.label} as ${row.name}; stop it there first`);
    };

    // 7. Idempotency (FR-6, FR-2): one live lane per (run, key, role) across machines; --replace stops it first.
    const rows = await listAllLaneRows({ run, key, role });
    const live: LaneRow[] = [];
    for (const row of rows) if (await occupies(row)) live.push(row);
    if (live.length > 0 && !request.replace) {
      throw new LaneLaunchError(409, `lane ${run}/${key} ${role} is live as ${describeRow(live[0])}; pass --replace to stop it first`);
    }
    for (const row of live) await stopRow(row);
    for (let waited = 0; live.length > 0; waited += REPLACE_POLL_MS) {
      const stillAlive: LaneRow[] = [];
      for (const row of live) if (await stillLive(row)) stillAlive.push(row);
      if (stillAlive.length === 0) break;
      if (waited >= REPLACE_WAIT_MS) {
        throw new LaneLaunchError(409, `${describeRow(stillAlive[0])} did not stop within ${REPLACE_WAIT_MS / 1000} s`);
      }
      await sleep(REPLACE_POLL_MS);
    }

    // 8. Iteration and target directory (D7, D8, FR-7). Cwd keys tell machines apart (D-4638-5).
    const cwds = distinctLaneCwds(rows);
    const newest = rows.at(-1);
    let iteration: number;
    if (request.reuse) {
      if (!newest) throw new LaneLaunchError(409, `no earlier ${role} lane of ${run}/${key} to reuse`);
      const newestMachine = newest.remote?.facts.environmentId ?? null;
      if (newestMachine !== (remote?.environmentId ?? null)) {
        if (!remote && newest.remote) {
          throw new LaneLaunchError(400, `the newest ${role} lane of ${run}/${key} ran on ${newest.remote.facts.label}; --reuse continues there`);
        }
        throw new LaneLaunchError(409, "--reuse continues on the newest lane's machine");
      }
      iteration = cwds.indexOf(newest.cwdKey) + 1;
    } else {
      iteration = cwds.length + 1;
    }

    // 9. Branch, base and the judged commit (FR-4, FR-5).
    const at = role === 'orchestrator' ? (requestAt ?? config.baseRef) : (requestAt ?? null);
    let branch: string | null = null;
    if (role === 'builder') {
      branch = request.reuse
        ? await iterationBranch(rows, newest!.cwdKey, run, key, iteration, latestReport)
        : (request.branch ?? conventionBranch(run, key, iteration));
    }
    const base = role === 'builder' && !request.reuse
      ? request.from ?? (iteration === 1 ? config.baseRef : await iterationBranch(rows, cwds[iteration - 2], run, key, iteration - 1, latestReport))
      : null;
    // FR-38: a builder of iteration n ≥ 2 is told which verdict it answers.
    const answering = role === 'builder' && iteration >= 2 ? await answeredVerdict(run, key, iteration, now(), latestReport) : null;
    const briefHeader = `<!-- lane ${run}/${key} ${role} i${iteration}; parent ${parent.name}; source ${request.briefSource ?? 'inline'} -->`;
    const brief = request.brief.endsWith('\n') ? request.brief : `${request.brief}\n`;
    const title = request.title ?? `${run} ${key} · ${role}${iteration >= 2 ? ` i${iteration}` : ''}`;
    const writeBrief = async (name: string): Promise<string> => {
      const briefDir = workerDir(`conv-${name}`);
      await mkdir(briefDir, { recursive: true });
      const briefPath = join(briefDir, 'lane-brief.md');
      await writeFile(briefPath, `${briefHeader}\n\n${brief}`, { flag: 'wx' });
      return briefPath;
    };
    const identity = (id: number | null, name: string) => ({ id, name, gauntletRun: run, laneKey: key, laneRole: role });

    if (remote) {
      return launchOnOwner({
        remote, warnings, now,
        spec: (name) => ({
          name, run, key, role, iteration, brief, briefHeader, title, model, harness, effort: effort ?? null,
          branch, base, at, reuseCwd: request.reuse ? newest!.cwd : null, answering, force: request.force === true,
        }),
        facts: (name, cwd, ownerBranch, createdAt): RemoteLaneFacts => ({
          v: 1, name, environmentId: remote.environmentId, label: remote.label, run, key, role, iteration,
          parentName: parent.name, criticOfName: criticOf?.name ?? null, projectKey: config.projectKey,
          cwd, branch: ownerBranch, at, model, harness, effort: effort ?? null, title, createdAt,
        }),
        writeBrief,
        result: (name, cwd, ownerBranch, ownerWarnings) => ({
          conversation: identity(null, name), cwd, branch: ownerBranch, iteration, warnings: [...warnings, ...ownerWarnings],
          machine: { environmentId: remote.environmentId, label: remote.label, reason: remote.reason },
          placement,
        }),
      });
    }

    const target = request.reuse ? newest!.cwd : join(lanesRoot!, (() => {
      try {
        return laneDirName(laneDir(role, run, key, iteration));
      } catch (error) {
        throw new LaneLaunchError(400, error instanceof Error ? error.message : String(error));
      }
    })());
    if (request.reuse && !(await pathExists(target))) throw new LaneLaunchError(409, `${target} no longer exists; launch without --reuse`);
    for (const other of await listAllLaneRows({})) {
      if (other.cwdKey === target && (await occupies(other))) {
        throw new LaneLaunchError(409, `${describeRow(other)} is live in ${target}`);
      }
    }

    // A launch that fails after creating the directory removes it again, so the
    // next launch of the same lane is not refused as "exists" with nothing to reuse.
    let created: 'dir' | 'worktree' | null = null;
    const undoCreate = async (): Promise<void> => {
      if (created === 'dir') await rm(target, { recursive: true, force: true }).catch(() => undefined);
      if (created === 'worktree') {
        await (git.removeWorktree ?? removeWorktree)(config.projectPath, target).catch((error: unknown) => {
          warnings.push(`could not remove ${target} after a failed launch: ${error instanceof Error ? error.message : String(error)}`);
        });
      }
    };
    if (!request.reuse) {
      if (await pathExists(target)) throw new LaneLaunchError(409, `${target} exists; pass --reuse to continue in it`);
      if (role === 'play') {
        await mkdir(target, { recursive: true });
        created = 'dir';
      } else {
        const fetchWarning = await git.fetchBase(config.projectPath);
        if (fetchWarning) warnings.push(fetchWarning);
        try {
          if (role === 'builder' && branch && base) {
            await git.addBranchWorktree(config.projectPath, target, branch, base);
            created = 'worktree';
            if (config.sparseCheckout) await git.applySparse(target, config.sparseCheckout);
          } else if (DETACHED_ROLES.has(role) && at) {
            await git.addDetachedWorktree(config.projectPath, target, at);
            created = 'worktree';
          }
        } catch (error) {
          await undoCreate();
          throw gitFailure(error);
        }
      }
    }

    try {
      // 10-11. Name and write-once brief (FR-9, D9).
      // A name is free when no local row and no remote lane stand-in holds it (D-4638-2).
      const nameTaken = async (candidate: string): Promise<boolean> =>
        getConversationByName(candidate) !== null || (await remoteLaneNameTaken(candidate));
      let name = generateConversationName();
      for (let attempt = 0; attempt < NAME_ATTEMPTS && (await nameTaken(name)); attempt += 1) name = generateConversationName();
      if (await nameTaken(name)) throw new LaneLaunchError(500, `could not allocate a free conversation name in ${NAME_ATTEMPTS} attempts`);
      const tmuxSession = `conv-${name}`;
      const briefPath = await writeBrief(name);

      // 12. The row: manual title (FR-10), parent link = the launching row (FR-30).
      // A judged builder on another machine has no local row for the FK: its link is a sidecar (D-4638-7).
      const launchContext = { bareContext: role === 'play', skipClaudeMd: role === 'play' };
      const claudeSessionId = randomUUID();
      const conversation = createConversation({
        name,
        tmuxSession,
        cwd: target,
        claudeSessionId,
        title,
        titleSource: 'manual',
        model,
        effort,
        harness,
        projectKey: config.projectKey,
        ...launchContext,
        parentName: parent.name,
        lane: { run, key, role, ...(criticOf?.local ? { criticOfName: criticOf.name } : {}) },
      });
      if (criticOf && !criticOf.local) await writeCriticLink(name, criticOf.name);
      emitCreated(name);

      // 13. Start the runtime with the lane contract as the first message.
      const message = laneContract({ role, run, key, iteration, briefPath, cwd: target, branch, at, answering });
      void start({ conv: conversation, tmuxSession, cwd: target, claudeSessionId, model, effort, harness, launchContext, message })
        .catch((error: unknown) => {
          console.error(`[lanes] runtime start failed for ${name}:`, error instanceof Error ? error.message : String(error));
        });

      return { conversation: identity(conversation.id, name), cwd: target, branch, iteration, warnings, machine: null, placement };
    } catch (error) {
      await undoCreate();
      throw error;
    }
  });
}

interface OwnerLaunchPlan {
  remote: RemoteLaneTarget;
  warnings: string[];
  now: () => number;
  spec: (name: string) => OwnerLaneSpec;
  facts: (name: string, cwd: string, branch: string | null, createdAt: string) => RemoteLaneFacts;
  writeBrief: (name: string) => Promise<string>;
  result: (name: string, cwd: string, branch: string | null, ownerWarnings: string[]) => LaneLaunchResult;
}

/** A name free in `conversations` and claimed in the stand-in store (D-4638-2). */
async function allocateRemoteName(): Promise<string> {
  for (let attempt = 0; attempt < NAME_ATTEMPTS; attempt += 1) {
    const name = generateConversationName();
    if (!getConversationByName(name) && (await reserveRemoteLane(name))) return name;
  }
  throw new LaneLaunchError(500, `could not allocate a free conversation name in ${NAME_ATTEMPTS} attempts`);
}

/**
 * D-4638-1/2/4: the remote path. Home claims the name in the stand-in store,
 * calls the owner, and on 201 writes the stand-in's write-once facts with the
 * owner's cwd (only the owner knows its lanes root) and keeps a copy of the
 * brief. A refusal or an unreached owner removes the claim again.
 */
async function launchOnOwner(plan: OwnerLaunchPlan): Promise<LaneLaunchResult> {
  const { remote } = plan;
  for (let retry = 0; ; retry += 1) {
    const name = await allocateRemoteName();
    let answer: { status: number; body: Record<string, unknown> };
    try {
      answer = await remote.launch(plan.spec(name));
    } catch (error) {
      await removeRemoteLane(name);
      throw error;
    }
    const { status, body } = answer;
    if (status === 201) {
      const cwd = typeof body['cwd'] === 'string' ? body['cwd'] : '';
      const branch = typeof body['branch'] === 'string' ? body['branch'] : null;
      const ownerWarnings = Array.isArray(body['warnings']) ? body['warnings'].filter((entry): entry is string => typeof entry === 'string') : [];
      await writeRemoteLaneFacts(plan.facts(name, cwd, branch, new Date(plan.now()).toISOString()));
      await plan.writeBrief(name).catch((error: unknown) => {
        plan.warnings.push(`could not keep a copy of the brief here: ${error instanceof Error ? error.message : String(error)}`);
      });
      return plan.result(name, cwd, branch, ownerWarnings);
    }
    await removeRemoteLane(name);
    const code = typeof body['code'] === 'string' ? body['code'] : undefined;
    if (code === 'name-taken' && retry < NAME_TAKEN_RETRIES) continue;
    const error = typeof body['error'] === 'string' ? body['error'] : `HTTP ${status}`;
    const mapped = (OWNER_STATUSES.has(status) ? status : 500) as LaneLaunchError['status'];
    // Owner refusals often name the machine already (`desk has no project …`).
    const named = error.startsWith(`${remote.label}:`) || error.startsWith(`${remote.label} `);
    throw new LaneLaunchError(mapped, named ? error : `${remote.label}: ${error}`, code);
  }
}
