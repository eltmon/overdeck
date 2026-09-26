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
import { mkdir, realpath, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';

import { getEventStore } from '../../dashboard/server/event-store.js';
import { workerDir } from '../agents/worker/ids.js';
import { latestWorkerReport, type WorkerReport } from '../agents/worker/report.js';
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
  listLaneConversations,
  markConversationEnded,
  resolveEffectiveLauncher,
  type LaneRole,
  type LegacyConversation,
} from '../overdeck/conversations.js';
import type { RuntimeName } from '../runtimes/types.js';
import { resolveLaneConfig, type LaneConfig } from './config.js';
import { laneContract } from './contract.js';
import { distinctLaneCwds } from './iteration.js';
import { LaneLaunchError, type LaneLaunchRequest, type LaneLaunchResult } from './types.js';
import { addBranchWorktree, addDetachedWorktree, applySparse, fetchBase, laneDirName } from './worktree.js';

const RUN_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;
const KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{0,39}$/;
/** opencode takes free-form effort names, as at the conversation door. */
const OPENCODE_EFFORT_PATTERN = /^[a-z][a-z0-9_-]*$/;
/** D10 `starting`: a row not ended, created less than this long ago. */
const STARTING_GRACE_MS = 3 * 60_000;
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
}

/** Test seams; production callers use the defaults. */
export interface LaneLaunchDeps {
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
}

const projectLocks = new Map<string, Promise<void>>();

async function withProjectLock<T>(projectKey: string, fn: () => Promise<T>): Promise<T> {
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
function laneDir(role: LaneRole, run: string, key: string, n: number): string {
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
  rows: LegacyConversation[],
  cwd: string,
  run: string,
  key: string,
  n: number,
  latestReport: (id: string) => Promise<WorkerReport | null>,
): Promise<string> {
  for (const row of rows.filter((candidate) => candidate.cwd === cwd).reverse()) {
    const branch = (await latestReport(`conv-${row.name}`))?.git?.branch;
    if (branch) return branch;
  }
  return conventionBranch(run, key, n);
}

function isWithin(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent.endsWith(sep) ? parent : `${parent}${sep}`);
}

async function realOrResolved(path: string): Promise<string> {
  return realpath(path).catch(() => resolve(path));
}

async function pathExists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false);
}

/** FR-3: under $HOME, not under /tmp, neither equal to nor containing the project checkout. Creates it when missing. */
async function prepareLanesRoot(lanesRoot: string, projectPath: string, home: string, tmpRoot: string): Promise<string> {
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
  if (!KEY_PATTERN.test(request.key)) throw new LaneLaunchError(400, `lane key ${request.key} must match ${KEY_PATTERN.source}`);
  if (request.run !== undefined && !RUN_PATTERN.test(request.run)) {
    throw new LaneLaunchError(400, `run key ${request.run} must match ${RUN_PATTERN.source}`);
  }
  if (!request.brief.trim()) throw new LaneLaunchError(400, 'a lane needs a brief: pass --brief <file> or --prompt <text>');
  if ((request.role === 'critic' || request.role === 'verifier') && !request.at) {
    throw new LaneLaunchError(400, `a ${request.role} lane needs --at <commit> to judge`);
  }
  if (request.branch !== undefined && request.role !== 'builder') throw new LaneLaunchError(400, '--branch applies to builder lanes only');
}

function gitFailure(error: unknown): LaneLaunchError {
  const message = error instanceof Error ? error.message : String(error);
  return new LaneLaunchError(400, `git worktree add failed: ${message.trim()}`);
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

  validateRequest(request);
  const { role, key } = request;

  // 1-2. Parent (D5), effective launcher (D21) and its D8 standing, run (D4).
  const parent = resolveParent(request.parent);
  if (!parent) throw new LaneLaunchError(404, `parent conversation ${request.parent} not found`);
  const launcher = resolveEffectiveLauncher(parent.name) ?? parent;
  checkLauncher(role, launcher);
  const run = resolveRun(request.run, launcher);

  // 3. Project and its lane config.
  const project = request.project ?? parent.projectKey;
  if (!project) throw new LaneLaunchError(400, `parent conversation ${parent.name} has no project: name --project`);
  const config = await (deps.resolveConfig ?? resolveLaneConfig)(project);

  // 4. Lanes root (FR-3).
  const lanesRoot = await prepareLanesRoot(config.lanesRoot, config.projectPath, (deps.homeDir ?? homedir)(), deps.tmpRoot ?? '/tmp');

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
  if (effort && !(harness === 'opencode' ? OPENCODE_EFFORT_PATTERN : SAFE_EFFORT_PATTERN).test(effort)) {
    throw new LaneLaunchError(400, 'effort must be low, medium or high');
  }

  // 6. Serialize the rest per project (NFR-4).
  return withProjectLock(config.projectKey, async () => {
    const warnings: string[] = [];
    const occupies = async (row: LegacyConversation): Promise<boolean> => {
      if (await isAlive(row.tmuxSession)) return true;
      return row.status === 'active' && row.archivedAt === null && row.spawnError === null
        && now() - Date.parse(row.createdAt) < STARTING_GRACE_MS;
    };

    // 7. Idempotency (FR-6): one live lane per (run, key, role); --replace stops it first.
    const rows = listLaneConversations({ run, key, role });
    const live: LegacyConversation[] = [];
    for (const row of rows) if (await occupies(row)) live.push(row);
    if (live.length > 0 && !request.replace) {
      const [first] = live;
      throw new LaneLaunchError(409, `lane ${run}/${key} ${role} is live as conversation #${first.id} (${first.name}); pass --replace to stop it first`);
    }
    for (const row of live) await stop(row);
    for (let waited = 0; live.length > 0; waited += REPLACE_POLL_MS) {
      const stillAlive: LegacyConversation[] = [];
      for (const row of live) if (await isAlive(row.tmuxSession)) stillAlive.push(row);
      if (stillAlive.length === 0) break;
      if (waited >= REPLACE_WAIT_MS) {
        throw new LaneLaunchError(409, `conversation #${stillAlive[0].id} (${stillAlive[0].name}) did not stop within ${REPLACE_WAIT_MS / 1000} s`);
      }
      await sleep(REPLACE_POLL_MS);
    }

    // 8. Iteration and target directory (D7, D8, FR-7).
    const cwds = distinctLaneCwds(rows);
    let iteration: number;
    let target: string;
    if (request.reuse) {
      const newest = rows.at(-1);
      if (!newest) throw new LaneLaunchError(409, `no earlier ${role} lane of ${run}/${key} to reuse`);
      target = newest.cwd;
      if (!(await pathExists(target))) throw new LaneLaunchError(409, `${target} no longer exists; launch without --reuse`);
      iteration = cwds.indexOf(target) + 1;
    } else {
      iteration = cwds.length + 1;
      let dirName: string;
      try {
        dirName = laneDirName(laneDir(role, run, key, iteration));
      } catch (error) {
        throw new LaneLaunchError(400, error instanceof Error ? error.message : String(error));
      }
      target = join(lanesRoot, dirName);
    }
    for (const other of listLaneConversations({})) {
      if (other.cwd === target && (await occupies(other))) {
        throw new LaneLaunchError(409, `conversation #${other.id} (${other.name}) is live in ${target}`);
      }
    }

    // 9. Working directory (FR-4, FR-5).
    let branch: string | null = null;
    const at = role === 'orchestrator' ? (request.at ?? config.baseRef) : (request.at ?? null);
    if (role === 'builder') {
      branch = request.reuse
        ? await iterationBranch(rows, target, run, key, iteration, latestReport)
        : (request.branch ?? conventionBranch(run, key, iteration));
    }
    if (!request.reuse) {
      if (await pathExists(target)) throw new LaneLaunchError(409, `${target} exists; pass --reuse to continue in it`);
      if (role === 'play') {
        await mkdir(target, { recursive: true });
      } else {
        const fetchWarning = await git.fetchBase(config.projectPath);
        if (fetchWarning) warnings.push(fetchWarning);
        try {
          if (role === 'builder' && branch) {
            const base = request.from ?? (iteration === 1
              ? config.baseRef
              : await iterationBranch(rows, cwds[iteration - 2], run, key, iteration - 1, latestReport));
            await git.addBranchWorktree(config.projectPath, target, branch, base);
            if (config.sparseCheckout) await git.applySparse(target, config.sparseCheckout);
          } else if (DETACHED_ROLES.has(role) && at) {
            await git.addDetachedWorktree(config.projectPath, target, at);
          }
        } catch (error) {
          throw gitFailure(error);
        }
      }
    }

    // 10-11. Name and write-once brief (FR-9, D9).
    let name = generateConversationName();
    for (let attempt = 0; attempt < 5 && getConversationByName(name); attempt += 1) name = generateConversationName();
    const tmuxSession = `conv-${name}`;
    const briefDir = workerDir(tmuxSession);
    await mkdir(briefDir, { recursive: true });
    const briefPath = join(briefDir, 'lane-brief.md');
    const header = `<!-- lane ${run}/${key} ${role} i${iteration}; parent ${parent.name}; source ${request.briefSource ?? 'inline'} -->`;
    const brief = request.brief.endsWith('\n') ? request.brief : `${request.brief}\n`;
    await writeFile(briefPath, `${header}\n\n${brief}`, { flag: 'wx' });

    // 12. The row: manual title (FR-10), parent link = the launching row (FR-30).
    const launchContext = { bareContext: role === 'play', skipClaudeMd: role === 'play' };
    const claudeSessionId = randomUUID();
    const conversation = createConversation({
      name,
      tmuxSession,
      cwd: target,
      claudeSessionId,
      title: request.title ?? `${run} ${key} · ${role}${iteration >= 2 ? ` i${iteration}` : ''}`,
      titleSource: 'manual',
      model,
      effort,
      harness,
      projectKey: config.projectKey,
      ...launchContext,
      parentName: parent.name,
      lane: { run, key, role },
    });
    emitCreated(name);

    // 13. Start the runtime with the lane contract as the first message.
    const message = laneContract({ role, run, key, iteration, briefPath, cwd: target, branch, at, answering: null });
    void start({ conv: conversation, tmuxSession, cwd: target, claudeSessionId, model, effort, harness, launchContext, message })
      .catch((error: unknown) => {
        console.error(`[lanes] runtime start failed for ${name}:`, error instanceof Error ? error.message : String(error));
      });

    return { conversation, cwd: target, branch, iteration, warnings };
  });
}
