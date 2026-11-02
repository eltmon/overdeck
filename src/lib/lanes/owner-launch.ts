/**
 * The owner side of a remote lane (.pan/drafts/PAN-4638.md WI-2, FR-3, FR-9).
 *
 * Home validates a lane against every row of its run and sends the owner a
 * precomputed spec: name, iteration, branch, base, `at`, brief header and the
 * verdict a builder answers (D-4638-1). The owner reads no run rows. It only
 * does the local work: the lane's directory under its own lanes root, the
 * write-once brief, a lane row with lane facts and no parent (D-4638-3), the
 * starting machine's provenance stamp and the runtime with the lane contract.
 *
 * The owner keeps three checks of its own: the CPU check (D-4638-10), the
 * harness check (D-4638-11) and the commit a critic judges, which must have
 * reached the owner through `origin` (FR-9). It never vacates an existing
 * conversation name (D-4638-2). All git and fs work is async (NFR-2).
 */
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { getEventStore } from '../../dashboard/server/event-store.js';
import { workerDir } from '../agents/worker/ids.js';
import { assessCpuPressure } from '../cloister/cpu-pressure.js';
import { MODEL_ID_PATTERN } from '../model-validation.js';
import { conversationHarnessAlive } from '../overdeck/conversation-liveness.js';
import { markConversationStartedBy } from '../overdeck/conversation-provenance.js';
import { resolveAllowedHarness, startConversationRuntime } from '../overdeck/conversation-runtime.js';
import {
  createConversation,
  getConversationByName,
  LANE_ROLES,
  listLaneConversations,
  type LaneRole,
  type LegacyConversation,
} from '../overdeck/conversations.js';
import type { RuntimeName } from '../runtimes/types.js';
import { resolveLaneConfig } from './config.js';
import { laneContract } from './contract.js';
import {
  gitFailure,
  isValidLaneEffort,
  isWithin,
  KEY_PATTERN,
  laneDir,
  pathExists,
  prepareLanesRoot,
  RUN_PATTERN,
  STARTING_GRACE_MS,
  withProjectLock,
  type LaneGit,
  type LaneLaunchDeps,
} from './launch.js';
import { LaneLaunchError, type OwnerLaneResult, type OwnerLaneSpec } from './types.js';

export type { OwnerLaneResult, OwnerLaneSpec };
import { addBranchWorktree, addDetachedWorktree, applySparse, commitExists, fetchBase, laneDirName, removeWorktree } from './worktree.js';

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export interface OwnerLaneContext {
  /** The owner's own key for the repository, resolved from the git origin by the door. */
  projectKey: string;
  /** The environment id of the machine that asked for the lane. */
  startedBy: string;
}

export interface OwnerLaneGit extends LaneGit {
  /** Optional in test fakes; defaults to the real helper. */
  commitExists?: typeof commitExists;
}

/** Test seams; production callers use the defaults. */
export type OwnerLaneDeps = Pick<
  LaneLaunchDeps,
  'resolveConfig' | 'resolveHarness' | 'isAlive' | 'start' | 'emitCreated' | 'now' | 'homeDir' | 'tmpRoot' | 'cpuPressure'
> & { git?: OwnerLaneGit };

function validateSpec(spec: OwnerLaneSpec): void {
  if (!(LANE_ROLES as readonly string[]).includes(spec.role)) {
    throw new LaneLaunchError(400, `unknown role ${String(spec.role)}: expected one of ${LANE_ROLES.join(', ')}`);
  }
  if (spec.role === 'orchestrator') throw new LaneLaunchError(400, "orchestrator lanes run on the orchestrator's machine");
  if (!RUN_PATTERN.test(spec.run)) throw new LaneLaunchError(400, `run key ${spec.run} must match ${RUN_PATTERN.source}`);
  if (!KEY_PATTERN.test(spec.key)) throw new LaneLaunchError(400, `lane key ${spec.key} must match ${KEY_PATTERN.source}`);
  if (!NAME_PATTERN.test(spec.name)) throw new LaneLaunchError(400, `conversation name ${spec.name} must match ${NAME_PATTERN.source}`);
  if (!Number.isInteger(spec.iteration) || spec.iteration < 1) throw new LaneLaunchError(400, `iteration ${spec.iteration} must be a positive integer`);
  if (!spec.brief.trim()) throw new LaneLaunchError(400, 'a lane needs a brief');
  if (/[\r\n]/.test(spec.briefHeader)) throw new LaneLaunchError(400, 'the brief header is one line');
  if (!MODEL_ID_PATTERN.test(spec.model)) throw new LaneLaunchError(400, `invalid model ${spec.model}`);
  if (spec.role === 'builder' && !spec.branch) throw new LaneLaunchError(400, 'a builder lane needs a branch');
  if (spec.role !== 'builder' && (spec.branch !== null || spec.base !== null)) {
    throw new LaneLaunchError(400, 'branch and base apply to builder lanes only');
  }
  // Home resolves `at` for both judges (resolveCriticLink); without it the owner would create no directory.
  if ((spec.role === 'critic' || spec.role === 'verifier') && !spec.at && !spec.reuseCwd) {
    throw new LaneLaunchError(400, `a ${spec.role} lane needs the commit it judges`);
  }
  // Refs reach git as positional arguments; a leading dash would parse as an option.
  for (const [field, value] of [['at', spec.at], ['base', spec.base], ['branch', spec.branch]] as const) {
    if (value !== null && (value.startsWith('-') || value.trim() === '')) throw new LaneLaunchError(400, `${field} ${value} is not a git ref`);
  }
}

/** FR-3 on the owner: run the lane home asked for, under the owner's own project and lanes root. */
export async function launchOwnedLane(spec: OwnerLaneSpec, context: OwnerLaneContext, deps: OwnerLaneDeps = {}): Promise<OwnerLaneResult> {
  const git: OwnerLaneGit = deps.git ?? { fetchBase, addBranchWorktree, addDetachedWorktree, applySparse, commitExists };
  const hasCommit = git.commitExists ?? commitExists;
  const isAlive = deps.isAlive ?? ((tmuxSession: string) => conversationHarnessAlive(tmuxSession));
  const start = deps.start ?? startConversationRuntime;
  const emitCreated = deps.emitCreated ?? ((name: string) => {
    getEventStore().emitOnly({ type: 'conversation.created', timestamp: new Date().toISOString(), payload: { conversationName: name } });
  });
  const now = deps.now ?? Date.now;

  validateSpec(spec);
  const { name, run, key, role, iteration } = spec;

  // D-4638-10: the CPU check runs where the lane runs.
  if (!spec.force) {
    const cpu = await (deps.cpuPressure ?? assessCpuPressure)();
    if (cpu.saturated) {
      throw new LaneLaunchError(
        429,
        `cpu-saturated: ${cpu.signal} ${cpu.reading} is at or above ${cpu.threshold}; the host is CPU-saturated. Pass --force to launch anyway.`,
      );
    }
  }

  // D-4638-11: home resolved the harness; the owner checks it is allowed here.
  let harness: RuntimeName;
  try {
    harness = await (deps.resolveHarness ?? resolveAllowedHarness)(spec.harness, spec.model);
  } catch (error) {
    throw new LaneLaunchError(400, error instanceof Error ? error.message : String(error));
  }
  const effort = spec.effort?.trim() || undefined;
  if (effort && !isValidLaneEffort(effort, harness)) {
    throw new LaneLaunchError(400, 'effort must be low, medium or high');
  }

  const config = await (deps.resolveConfig ?? resolveLaneConfig)(context.projectKey);
  const lanesRoot = await prepareLanesRoot(config.lanesRoot, config.projectPath, (deps.homeDir ?? homedir)(), deps.tmpRoot ?? '/tmp');

  return withProjectLock(config.projectKey, async () => {
    const warnings: string[] = [];
    const occupies = async (row: LegacyConversation): Promise<boolean> => {
      if (await isAlive(row.tmuxSession)) return true;
      return row.status === 'active' && row.archivedAt === null && row.spawnError === null
        && now() - Date.parse(row.createdAt) < STARTING_GRACE_MS;
    };

    // D-4638-2: the owner never vacates a name home allocated.
    if (getConversationByName(name)) throw new LaneLaunchError(409, `name-taken: conversation ${name} exists`, 'name-taken');

    // Target directory.
    let target: string;
    if (spec.reuseCwd !== null) {
      target = resolve(spec.reuseCwd);
      if (!isWithin(target, lanesRoot) || target === lanesRoot) throw new LaneLaunchError(400, `${target} is not inside the lanes root ${lanesRoot}`);
      if (!(await pathExists(target))) throw new LaneLaunchError(409, `${target} no longer exists; launch without --reuse`);
    } else {
      let dirName: string;
      try {
        dirName = laneDirName(laneDir(role, run, key, iteration));
      } catch (error) {
        throw new LaneLaunchError(400, error instanceof Error ? error.message : String(error));
      }
      target = join(lanesRoot, dirName);
      if (await pathExists(target)) throw new LaneLaunchError(409, `${target} exists; pass --reuse to continue in it`);
    }
    for (const other of listLaneConversations({})) {
      if (other.cwd === target && (await occupies(other))) {
        throw new LaneLaunchError(409, `conversation #${other.id} (${other.name}) is live in ${target}`);
      }
    }

    // Working directory (FR-9: a judged commit reaches the owner through origin).
    let created: 'dir' | 'worktree' | null = null;
    const undoCreate = async (): Promise<void> => {
      if (created === 'dir') await rm(target, { recursive: true, force: true }).catch(() => undefined);
      if (created === 'worktree') {
        await (git.removeWorktree ?? removeWorktree)(config.projectPath, target).catch((error: unknown) => {
          warnings.push(`could not remove ${target} after a failed launch: ${error instanceof Error ? error.message : String(error)}`);
        });
      }
    };
    if (spec.reuseCwd === null) {
      if (role === 'play') {
        await mkdir(target, { recursive: true });
        created = 'dir';
      } else {
        const fetchWarning = await git.fetchBase(config.projectPath);
        if (fetchWarning) warnings.push(fetchWarning);
        if (role === 'builder' && spec.branch) {
          const wanted = spec.base ?? config.baseRef;
          let base = wanted;
          if (!(await hasCommit(config.projectPath, base))) {
            base = `origin/${wanted}`;
            if (!(await hasCommit(config.projectPath, base))) throw new LaneLaunchError(400, `base ${wanted} is not on origin`);
          }
          try {
            await git.addBranchWorktree(config.projectPath, target, spec.branch, base);
            created = 'worktree';
            if (config.sparseCheckout) await git.applySparse(target, config.sparseCheckout);
          } catch (error) {
            await undoCreate();
            throw gitFailure(error);
          }
        } else if (spec.at) {
          if (!(await hasCommit(config.projectPath, spec.at))) {
            const fetchNote = fetchWarning ? ` (${fetchWarning})` : '';
            throw new LaneLaunchError(
              400,
              `commit ${spec.at} is not on origin; the builder must push before a critic on another machine judges it${fetchNote}`,
            );
          }
          try {
            await git.addDetachedWorktree(config.projectPath, target, spec.at);
            created = 'worktree';
          } catch (error) {
            await undoCreate();
            throw gitFailure(error);
          }
        }
      }
    }

    try {
      // Write-once brief (FR-9 of PAN-4223, D9).
      const tmuxSession = `conv-${name}`;
      const briefDir = workerDir(tmuxSession);
      await mkdir(briefDir, { recursive: true });
      const briefPath = join(briefDir, 'lane-brief.md');
      const brief = spec.brief.endsWith('\n') ? spec.brief : `${spec.brief}\n`;
      await writeFile(briefPath, `${spec.briefHeader}\n\n${brief}`, { flag: 'wx' });

      // The row: lane facts, no parent (D-4638-3), the asking machine's provenance.
      const launchContext = { bareContext: role === 'play', skipClaudeMd: role === 'play' };
      const claudeSessionId = randomUUID();
      let conversation: LegacyConversation;
      try {
        conversation = createConversation({
          name,
          tmuxSession,
          cwd: target,
          claudeSessionId,
          title: spec.title,
          titleSource: 'manual',
          model: spec.model,
          effort,
          harness,
          projectKey: config.projectKey,
          ...launchContext,
          lane: { run, key, role },
          remoteLaunch: true,
          refuseExistingName: true,
        });
      } catch (error) {
        if (getConversationByName(name)) throw new LaneLaunchError(409, `name-taken: conversation ${name} exists`, 'name-taken');
        throw error;
      }
      markConversationStartedBy(name, context.startedBy);
      emitCreated(name);

      const branch = role === 'builder' ? spec.branch : null;
      const message = laneContract({ role, run, key, iteration, briefPath, cwd: target, branch, at: spec.at, answering: spec.answering });
      void start({ conv: conversation, tmuxSession, cwd: target, claudeSessionId, model: spec.model, effort, harness, launchContext, message })
        .catch((error: unknown) => {
          console.error(`[lanes] runtime start failed for ${name}:`, error instanceof Error ? error.message : String(error));
        });

      return { name, cwd: target, branch, warnings };
    } catch (error) {
      await undoCreate();
      throw error;
    }
  });
}
