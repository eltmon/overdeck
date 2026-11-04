/**
 * PAN-4961: measured disk cost of one new workspace, for disk-floor admission.
 *
 * A workspace costs disk twice: the host phase (git worktree plus package
 * install) and the stack phase (the Docker volume the `init` service fills).
 * This module measures both from what is already on the machine — the
 * project's tracked blob sizes, the unshared bytes of the newest finished
 * sibling's node_modules, and `docker system df -v` for sibling stacks — and
 * memoizes the result per project, because the Docker listing takes ~10 s.
 *
 * No shell anywhere: git and docker run through execFile argument vectors,
 * and node_modules is summed with a Node walk that counts only files with one
 * link (bun hardlinks from its cache, so `du` overstates by gigabytes).
 */
import { execFile } from 'node:child_process';
import type { Dirent } from 'node:fs';
import { lstat, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { isWorkspaceSetupIncomplete } from '../workspace-manager/setup-marker.js';
import { composeProjectNameForWorkspace } from './stack-health.js';

const execFileAsync = promisify(execFile);

const GIB = 1024 ** 3;

export const SEED_HOST_DISK_COST_BYTES = 0.5 * GIB;
export const SEED_STACK_DISK_COST_BYTES = 2 * GIB;
export const DISK_COST_MEMO_TTL_MS = 6 * 60 * 60 * 1000;

const EXEC_TIMEOUT_MS = 60_000;
const EXEC_MAX_BUFFER = 64 * 1024 * 1024;
const MAX_LSTAT_IN_FLIGHT = 64;

export interface WorkspaceDiskCost {
  hostBytes: number;
  /** 0 when the project has no workspace.docker.compose_template. */
  stackBytes: number;
  hostSource: 'measured' | 'seed';
  stackSource: 'measured' | 'machine' | 'seed' | 'none';
}

export interface DiskCostDeps {
  /** Run a command with an argument vector (no shell); resolve its stdout. */
  exec?: (command: string, args: string[], cwd?: string) => Promise<string>;
  /** Bytes of files under `dir` that have exactly one link. */
  unsharedBytes?: (dir: string) => Promise<number>;
  now?: () => number;
}

/**
 * Structural input: both `ProjectConfig` types (src/lib/workspace-config.ts,
 * used by createWorkspace; src/lib/projects.ts, returned by getProjectSync)
 * satisfy it.
 */
export interface DiskCostProject {
  path: string;
  workspace?: {
    type?: string;
    workspaces_dir?: string;
    progressive?: boolean;
    always_include?: string[];
    repos?: Array<{ name: string; path: string; link_type?: 'worktree' | 'symlink' }>;
    docker?: { compose_template?: string };
  };
}

async function defaultExec(command: string, args: string[], cwd?: string): Promise<string> {
  const { stdout } = await execFileAsync(command, args, {
    cwd,
    encoding: 'utf8',
    timeout: EXEC_TIMEOUT_MS,
    maxBuffer: EXEC_MAX_BUFFER,
  });
  return stdout;
}

const DOCKER_SIZE_UNITS: Record<string, number> = {
  B: 1,
  kB: 1e3,
  KB: 1e3,
  MB: 1e6,
  GB: 1e9,
  TB: 1e12,
};

/** Parse a `docker system df` size ('1.938GB') into bytes; NaN when unparsable. */
export function parseDockerSize(size: string): number {
  const match = /^\s*([0-9]+(?:\.[0-9]+)?)\s*([a-zA-Z]+)\s*$/.exec(size);
  if (!match) return Number.NaN;
  const unit = DOCKER_SIZE_UNITS[match[2]];
  if (unit === undefined) return Number.NaN;
  return Math.round(Number(match[1]) * unit);
}

function isMeasurable(bytes: number): boolean {
  return Number.isFinite(bytes) && bytes >= 0;
}

/**
 * Sum `blocks * 512` of regular files under `root` whose link count is 1,
 * never following symlinks, with at most MAX_LSTAT_IN_FLIGHT fs calls in
 * flight. Entries that vanish or cannot be read count as 0; a missing root is 0.
 */
export async function sumUnsharedBytes(root: string): Promise<number> {
  type Task = { kind: 'dir' | 'file'; path: string };
  const queue: Task[] = [{ kind: 'dir', path: root }];
  let active = 0;
  let total = 0;

  const run = async (task: Task): Promise<void> => {
    if (task.kind === 'file') {
      const info = await lstat(task.path);
      if (info.nlink === 1) total += info.blocks * 512;
      return;
    }
    const entries: Dirent[] = await readdir(task.path, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(task.path, entry.name);
      if (entry.isDirectory()) queue.push({ kind: 'dir', path });
      else if (entry.isFile()) queue.push({ kind: 'file', path });
    }
  };

  await new Promise<void>((resolve) => {
    const pump = (): void => {
      if (queue.length === 0 && active === 0) {
        resolve();
        return;
      }
      while (active < MAX_LSTAT_IN_FLIGHT && queue.length > 0) {
        const task = queue.pop() as Task;
        active += 1;
        run(task).catch(() => {}).finally(() => {
          active -= 1;
          pump();
        });
      }
    };
    pump();
  });
  return total;
}

function workspacesDirOf(project: DiskCostProject): string {
  return join(project.path, project.workspace?.workspaces_dir ?? 'workspaces');
}

/** Finished `feature-*` workspaces (no setup-incomplete marker), newest first. */
async function listFinishedSiblings(project: DiskCostProject): Promise<Array<{ path: string; folder: string }>> {
  const dir = workspacesDirOf(project);
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const siblings: Array<{ path: string; folder: string; mtimeMs: number }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('feature-')) continue;
    const path = join(dir, entry.name);
    if (isWorkspaceSetupIncomplete(path)) continue;
    try {
      siblings.push({ path, folder: entry.name, mtimeMs: (await stat(path)).mtimeMs });
    } catch {
      // vanished between listing and stat
    }
  }
  return siblings.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function trackedRepoPaths(project: DiskCostProject): string[] {
  const workspace = project.workspace;
  if (workspace?.type !== 'polyrepo' || !workspace.repos?.length) return [project.path];
  const include = workspace.progressive ? new Set(workspace.always_include ?? []) : null;
  return workspace.repos
    .filter((repo) => repo.link_type !== 'symlink')
    .filter((repo) => include === null || include.has(repo.name))
    .map((repo) => join(project.path, repo.path));
}

/** Sum of blob sizes (column 4 of `git ls-tree -r -l HEAD`), skipping submodules. */
async function trackedBytes(repoPath: string, exec: NonNullable<DiskCostDeps['exec']>): Promise<number> {
  const stdout = await exec('git', ['-C', repoPath, 'ls-tree', '-r', '-l', 'HEAD']);
  let total = 0;
  for (const line of stdout.split('\n')) {
    const meta = line.split('\t')[0];
    if (!meta) continue;
    const size = meta.trim().split(/\s+/)[3];
    if (size === undefined || size === '-') continue;
    const bytes = Number(size);
    if (!isMeasurable(bytes)) throw new Error(`unparsable ls-tree size '${size}' in ${repoPath}`);
    total += bytes;
  }
  return total;
}

async function measureHostBytes(
  project: DiskCostProject,
  siblings: Array<{ path: string }>,
  exec: NonNullable<DiskCostDeps['exec']>,
  unsharedBytes: NonNullable<DiskCostDeps['unsharedBytes']>,
): Promise<number> {
  let tracked = 0;
  for (const repoPath of trackedRepoPaths(project)) {
    tracked += await trackedBytes(repoPath, exec);
  }

  let nodeModulesDir = join(project.path, 'node_modules');
  for (const sibling of siblings) {
    const candidate = join(sibling.path, 'node_modules');
    if (await stat(candidate).then((info) => info.isDirectory(), () => false)) {
      nodeModulesDir = candidate;
      break;
    }
  }
  const unshared = await unsharedBytes(nodeModulesDir);
  if (!isMeasurable(unshared)) throw new Error(`unmeasurable node_modules bytes in ${nodeModulesDir}`);
  return tracked + unshared;
}

interface DockerDf {
  Volumes?: Array<{ Name?: string; Size?: string }>;
  Images?: Array<{ Repository?: string; UniqueSize?: string }>;
}

function sumStack(df: DockerDf, composeProject: string): number {
  let total = 0;
  for (const volume of df.Volumes ?? []) {
    if (!volume.Name?.startsWith(`${composeProject}_`)) continue;
    total += parseDockerSize(volume.Size ?? '');
  }
  for (const image of df.Images ?? []) {
    if (!image.Repository?.startsWith(`${composeProject}-`)) continue;
    total += parseDockerSize(image.UniqueSize ?? '');
  }
  return total;
}

/** Largest per-compose-project volume total on the host (project = text before the first '_'). */
function largestVolumeGroup(df: DockerDf): number {
  const groups = new Map<string, number>();
  for (const volume of df.Volumes ?? []) {
    const name = volume.Name ?? '';
    const separator = name.indexOf('_');
    if (separator <= 0) continue;
    const group = name.slice(0, separator);
    groups.set(group, (groups.get(group) ?? 0) + parseDockerSize(volume.Size ?? ''));
  }
  let largest = 0;
  for (const bytes of groups.values()) {
    if (isMeasurable(bytes) && bytes > largest) largest = bytes;
  }
  return largest;
}

async function measureStack(
  siblings: Array<{ path: string; folder: string }>,
  exec: NonNullable<DiskCostDeps['exec']>,
): Promise<{ stackBytes: number; stackSource: 'measured' | 'machine' }> {
  const df = JSON.parse(await exec('docker', ['system', 'df', '-v', '--format', '{{json .}}'])) as DockerDf;

  let largestSibling = 0;
  for (const sibling of siblings) {
    let composeProject: string;
    try {
      composeProject = composeProjectNameForWorkspace(sibling.path, sibling.folder.slice('feature-'.length));
    } catch {
      continue;
    }
    const bytes = sumStack(df, composeProject);
    if (isMeasurable(bytes) && bytes > largestSibling) largestSibling = bytes;
  }
  if (largestSibling > 0) return { stackBytes: largestSibling, stackSource: 'measured' };
  return { stackBytes: Math.max(largestVolumeGroup(df), SEED_STACK_DISK_COST_BYTES), stackSource: 'machine' };
}

function warnSeed(component: string, project: DiskCostProject, error: unknown, seedBytes: number): void {
  const reason = error instanceof Error ? error.message : String(error);
  console.warn(`[disk-cost] ${component} unmeasured for ${project.path}: ${reason}; using seed ${(seedBytes / GIB).toFixed(1)} GiB`);
}

async function measureWorkspaceDiskCost(project: DiskCostProject, deps: DiskCostDeps): Promise<WorkspaceDiskCost> {
  const exec = deps.exec ?? defaultExec;
  const unsharedBytes = deps.unsharedBytes ?? sumUnsharedBytes;
  const siblings = await listFinishedSiblings(project);

  let hostBytes: number;
  let hostSource: WorkspaceDiskCost['hostSource'];
  try {
    hostBytes = await measureHostBytes(project, siblings, exec, unsharedBytes);
    hostSource = 'measured';
  } catch (error) {
    warnSeed('host bytes', project, error, SEED_HOST_DISK_COST_BYTES);
    hostBytes = SEED_HOST_DISK_COST_BYTES;
    hostSource = 'seed';
  }

  if (!project.workspace?.docker?.compose_template) {
    return { hostBytes, stackBytes: 0, hostSource, stackSource: 'none' };
  }
  try {
    const stack = await measureStack(siblings, exec);
    return { hostBytes, hostSource, ...stack };
  } catch (error) {
    warnSeed('stack bytes', project, error, SEED_STACK_DISK_COST_BYTES);
    return { hostBytes, stackBytes: SEED_STACK_DISK_COST_BYTES, hostSource, stackSource: 'seed' };
  }
}

const memo = new Map<string, { at: number; promise: Promise<WorkspaceDiskCost> }>();

/**
 * Measured `{ hostBytes, stackBytes }` for one new workspace of `project`.
 * The promise is memoized per project path for DISK_COST_MEMO_TTL_MS so
 * concurrent callers share one measurement; a rejection is not memoized.
 */
export function estimateWorkspaceDiskCost(project: DiskCostProject, deps: DiskCostDeps = {}): Promise<WorkspaceDiskCost> {
  const now = deps.now ?? Date.now;
  const cached = memo.get(project.path);
  if (cached && now() - cached.at < DISK_COST_MEMO_TTL_MS) return cached.promise;

  const promise = measureWorkspaceDiskCost(project, deps);
  const entry = { at: now(), promise };
  memo.set(project.path, entry);
  promise.catch(() => {
    if (memo.get(project.path) === entry) memo.delete(project.path);
  });
  return promise;
}

/** Drop a project's memoized estimate; called right after a disk-heavy phase releases. */
export function invalidateWorkspaceDiskCostMemo(projectPath: string): void {
  memo.delete(projectPath);
}

/** Tests only. */
export function resetWorkspaceDiskCostMemo(): void {
  memo.clear();
}
