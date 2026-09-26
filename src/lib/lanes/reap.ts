/**
 * `pan lane reap` core (.pan/drafts/pan-4223.md WI-7, FR-20, FR-21, FR-23, D14).
 *
 * Reap stops a live lane through the conversation stop door, removes the
 * lane's directory, and archives its conversation unless `keep`. It never
 * kills a process and never discards work: processes still running in the
 * directory refuse the reap; a dirty tree refuses it unless `park`, which
 * writes the uncommitted work to a patch and verifies that patch before any
 * reset. `git worktree remove` runs without `--force`, and the branch is kept.
 * Every refusal returns before the archive, which runs last (D14). The brief,
 * reports and parked patches under `~/.overdeck/agents/conv-<name>/` survive.
 */
import { execFile } from 'node:child_process';
import { mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

import { workerDir } from '../agents/worker/ids.js';
import { pidsWithCwdUnder } from '../process-cwd.js';
import { archiveConversationByName, type ConversationArchiveDependencies } from '../overdeck/conversation-archive.js';
import { conversationHarnessAlive } from '../overdeck/conversation-liveness.js';
import { stopConversationRuntime } from '../overdeck/conversation-runtime.js';
import { getConversationByName, markConversationEnded, type LegacyConversation } from '../overdeck/conversations.js';
import { resolveLaneConfig, type LaneConfig } from './config.js';

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 60_000;
const STOP_POLL_MS = 1_000;
const STOP_WAIT_MS = 30_000;

export class LaneReapError extends Error {
  constructor(readonly status: 400 | 404 | 409 | 500, message: string) {
    super(message);
    this.name = 'LaneReapError';
  }
}

export interface LaneReapOptions {
  park?: boolean;
  keep?: boolean;
}

export interface LaneReapResult {
  removed: true;
  archived: boolean;
  parkedPatch: string | null;
  warnings: string[];
}

export interface LaneProcess {
  pid: string;
  command: string;
}

export interface LaneReapDeps {
  /** The archive route's dependencies (routes/conversations.ts). */
  archive: ConversationArchiveDependencies;
  archiveByName?: typeof archiveConversationByName;
  /** Runs git in `cwd` and returns raw stdout. */
  git?: (args: string[], cwd: string) => Promise<string>;
  isAlive?: (tmuxSession: string) => Promise<boolean>;
  /** The conversation stop door: stop the runtime, then mark the row ended. */
  stop?: (conv: LegacyConversation) => Promise<void>;
  processesUnder?: (dir: string) => Promise<LaneProcess[]>;
  resolveConfig?: (project: string) => Promise<LaneConfig>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

async function runGit(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, timeout: GIT_TIMEOUT_MS, maxBuffer: 256 * 1024 * 1024 });
  return stdout;
}

async function processesWithCwdUnder(dir: string): Promise<LaneProcess[]> {
  const processes: LaneProcess[] = [];
  for (const pid of await pidsWithCwdUnder(dir)) {
    const command = await readFile(`/proc/${pid}/cmdline`, 'utf8')
      .then((raw) => raw.split('\0').filter(Boolean).join(' '), () => '(unknown)');
    processes.push({ pid, command });
  }
  return processes;
}

function isStrictlyWithin(child: string, parent: string): boolean {
  return child !== parent && child.startsWith(parent.endsWith(sep) ? parent : `${parent}${sep}`);
}

async function pathExists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false);
}

function message(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).trim();
}

export async function reapLane(name: string, options: LaneReapOptions, deps: LaneReapDeps): Promise<LaneReapResult> {
  const git = deps.git ?? runGit;
  const isAlive = deps.isAlive ?? ((tmuxSession: string) => conversationHarnessAlive(tmuxSession));
  const stop = deps.stop ?? (async (conv: LegacyConversation) => {
    await stopConversationRuntime(conv, conv.name);
    markConversationEnded(conv.name);
  });
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const now = deps.now ?? (() => new Date());
  const warnings: string[] = [];

  // 1. The lane row.
  const lane = getConversationByName(name.startsWith('conv-') ? name.slice('conv-'.length) : name);
  if (!lane?.laneKey || !lane.laneRole) throw new LaneReapError(404, `${name} is not a lane`);

  // 2. Stop a live harness through the stop door.
  if (await isAlive(lane.tmuxSession)) {
    await stop(lane);
    for (let waited = 0; await isAlive(lane.tmuxSession); waited += STOP_POLL_MS) {
      if (waited >= STOP_WAIT_MS) {
        throw new LaneReapError(409, `stop did not take for lane ${lane.name}; close the pane from the terminal backend`);
      }
      await sleep(STOP_POLL_MS);
    }
  }

  // 3. The directory must be under the project's lanes root.
  if (!lane.projectKey) throw new LaneReapError(400, `lane ${lane.name} has no project, so its lanes root is unknown`);
  const config = await (deps.resolveConfig ?? resolveLaneConfig)(lane.projectKey);
  const lanesRoot = await realpath(config.lanesRoot).catch(() => resolve(config.lanesRoot));
  const exists = await pathExists(lane.cwd);
  const cwd = exists ? await realpath(lane.cwd) : resolve(lane.cwd);
  if (!isStrictlyWithin(cwd, lanesRoot)) {
    throw new LaneReapError(400, `lane directory ${cwd} is not under the lanes root ${lanesRoot}; nothing was touched`);
  }

  let parkedPatch: string | null = null;
  if (!exists) {
    warnings.push(`lane directory ${cwd} is already gone`);
  } else {
    // 4. Never kill: processes still in the directory refuse the reap.
    const processes = await (deps.processesUnder ?? processesWithCwdUnder)(cwd);
    if (processes.length > 0) {
      const list = processes.map((proc) => `${proc.pid} ${proc.command}`).join('; ');
      throw new LaneReapError(409, `these processes still run in the lane directory; stop them through whatever started them. Overdeck does not kill them: ${list}`);
    }

    if (lane.laneRole === 'play') {
      // 7 (play). A plain directory: remove it only when it holds no git repository.
      if (await pathExists(join(cwd, '.git'))) throw new LaneReapError(400, `play directory ${cwd} contains .git; remove it by hand`);
      await rm(cwd, { recursive: true });
    } else {
      // 5. A dirty tree needs park; the verified patch is the backup.
      if ((await git(['status', '--porcelain'], cwd)).trim()) {
        if (!options.park) throw new LaneReapError(409, `lane directory ${cwd} is dirty; pass --park`);
        await git(['add', '-A'], cwd);
        const patch = await git(['diff', '--cached', '--binary', 'HEAD'], cwd);
        const dir = workerDir(`conv-${lane.name}`);
        await mkdir(dir, { recursive: true });
        parkedPatch = join(dir, `parked-${now().toISOString().replace(/[:.]/g, '-')}.patch`);
        await writeFile(parkedPatch, patch, { flag: 'wx' });
        try {
          if (!patch.trim()) throw new Error('the patch is empty');
          await git(['apply', '--cached', '--check', '--reverse', parkedPatch], cwd);
        } catch (error) {
          throw new LaneReapError(500, `the parked patch ${parkedPatch} did not verify, so nothing was discarded: ${message(error)}`);
        }
        await git(['reset', '--hard', 'HEAD'], cwd);
        await git(['clean', '-fd'], cwd);
      }

      // 6. Unpushed commits stay on the kept branch; say so.
      const branch = (await git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)).trim();
      if (branch !== 'HEAD') {
        const ahead = await git(['rev-list', '--count', '@{u}..HEAD'], cwd).then((count) => Number(count.trim()), () => null);
        if (ahead === null) warnings.push(`branch ${branch} has no upstream; its commits stay on the local branch`);
        else if (ahead > 0) warnings.push(`branch ${branch} has ${ahead} commit(s) not on its upstream; the branch is kept`);
      }

      // 7. Remove the worktree, never with --force, then prune.
      try {
        await git(['worktree', 'remove', cwd], config.projectPath);
      } catch (error) {
        throw new LaneReapError(409, `git worktree remove ${cwd} failed: ${message(error)}`);
      }
    }
  }
  if (lane.laneRole !== 'play') await git(['worktree', 'prune'], config.projectPath).catch(() => '');

  // 8. Archive last, unless keep (D14).
  if (options.keep) return { removed: true, archived: false, parkedPatch, warnings };
  let archived = false;
  let failure = '';
  try {
    const answer = await (deps.archiveByName ?? archiveConversationByName)(lane.name, deps.archive);
    const status = answer.status ?? 200;
    const error = (answer.body as { error?: unknown } | null)?.error;
    archived = status === 200 || (status === 400 && typeof error === 'string' && error.includes('already archived'));
    failure = typeof error === 'string' ? error : `status ${status}`;
  } catch (error) {
    failure = message(error);
  }
  if (!archived) warnings.push(`reaped, but archiving failed: ${failure}; archive conv ${lane.id} from the Command Deck`);
  return { removed: true, archived, parkedPatch, warnings };
}
