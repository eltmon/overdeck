/**
 * Disk-floor admission for lane launches (PAN-5094). A lane's worktree is a
 * disk-heavy phase like a workspace start (PAN-4961): both lane doors admit it
 * with reserveDiskFloor at the lane's lanes root. A successful launch holds the
 * lease through the install window (the door does not await the lane's work); a
 * failed one releases it at once. All work is async (the doors run in the
 * dashboard server).
 */
import { readdir, realpath, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { previewDiskFloor, readAvailableBytes, reserveDiskFloor, type DiskReservation } from '../disk-floor.js';
import type { LaneRole } from '../overdeck/conversations.js';
import { listProjectsAsync } from '../projects.js';
import { estimateWorkspaceDiskCost } from '../workspace/disk-cost.js';
import { resolveLaneConfig, type LaneConfig } from './config.js';
import { listAllLaneRows } from './lane-rows.js';
import { LaneLaunchError } from './types.js';

export const LANE_DISK_LOW_CODE = 'disk-low';
const GIB = 1024 ** 3;
/** D3: the least one new lane worktree reserves, for projects with no installed workspace to sample. */
export const LANE_WORKTREE_MIN_BYTES = 2 * GIB;
/** D6/FR-5: how long a launched lane's lease keeps counting (checkout plus dependency install). */
export const LANE_DISK_HOLD_MS = 15 * 60_000;

/** Test seams; production callers use the defaults. */
export interface LaneDiskDeps {
  /** Free bytes on the filesystem holding `path`. Default readAvailableBytes. */
  read?: (path: string) => Promise<number>;
  /** The reservation ledger directory. Default ~/.overdeck/disk-reservations. */
  ledgerDir?: string;
  /** Bytes one new lane worktree adds. Default laneWorktreeBytes. */
  estimate?: (config: LaneConfig) => Promise<number>;
}

/**
 * D3: a new lane worktree costs what a workspace's host phase costs (tracked
 * files plus an install), and never less than LANE_WORKTREE_MIN_BYTES: the
 * workspace estimate counts a missing node_modules sample as 0.
 */
export async function laneWorktreeBytes(
  config: LaneConfig,
  estimateWorkspace: typeof estimateWorkspaceDiskCost = estimateWorkspaceDiskCost,
): Promise<number> {
  const project = (await listProjectsAsync()).find((candidate) => candidate.key === config.projectKey)?.config
    ?? { path: config.projectPath };
  return Math.max((await estimateWorkspace(project)).hostBytes, LANE_WORKTREE_MIN_BYTES);
}

/** D4: --reuse and play create no worktree, so they reserve nothing but are still checked. */
export async function laneLaunchBytes(
  input: { config: LaneConfig; role: LaneRole; reuse: boolean },
  deps: LaneDiskDeps = {},
): Promise<number> {
  if (input.reuse || input.role === 'play') return 0;
  return (deps.estimate ?? laneWorktreeBytes)(input.config);
}

/** FR-1/FR-2: admit a lane launch or throw LaneLaunchError(507, …, 'disk-low'). --force never reaches here (D5). */
export async function admitLaneDisk(
  input: { config: LaneConfig; lanesRoot: string; role: LaneRole; reuse: boolean; label: string },
  deps: LaneDiskDeps = {},
): Promise<DiskReservation> {
  const bytes = await laneLaunchBytes(input, deps);
  const admission = await reserveDiskFloor(
    { path: input.lanesRoot, bytes, label: input.label },
    { ...(deps.read ? { read: deps.read } : {}), ...(deps.ledgerDir ? { ledgerDir: deps.ledgerDir } : {}) },
  );
  if (!admission.ok) throw new LaneLaunchError(507, admission.error, LANE_DISK_LOW_CODE);
  return admission.reservation;
}

/** FR-5: keep a launched lane's lease counting through its install window, then release it. */
export function holdLaneDisk(reservation: DiskReservation, holdMs: number = LANE_DISK_HOLD_MS): void {
  const timer = setTimeout(() => {
    void reservation.release().catch(() => undefined);
  }, holdMs);
  timer.unref?.();
}

export interface LaneDiskCheck {
  path: string;
  /** Bytes the next lane would add (0 without a project). */
  bytes: number;
  /** null when statfs failed (admission admits then). */
  availableBytes: number | null;
  /** Refusal text; null when there is room. */
  refusal: string | null;
  /** Directories under the lanes root no lane row uses (only with a project). */
  unregistered: string[];
}

export interface LaneDiskCheckDeps extends LaneDiskDeps {
  resolveConfig?: (project: string) => Promise<LaneConfig>;
  /** cwd of every local lane row, archived included. Default from listAllLaneRows({}). */
  laneCwds?: () => Promise<string[]>;
}

async function pathExists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false);
}

async function defaultLaneCwds(): Promise<string[]> {
  return (await listAllLaneRows({})).filter((row) => row.local).map((row) => row.cwd);
}

/** D13: directories under `lanesRoot` no lane row (archived included) has as its cwd; a missing root lists nothing. */
async function unregisteredLaneDirs(lanesRoot: string, laneCwds: () => Promise<string[]>): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(lanesRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const cwds = await laneCwds();
  const realCwds = new Set(await Promise.all(cwds.map((cwd) => realpath(cwd).catch(() => cwd))));
  const result: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dirPath = join(lanesRoot, entry.name);
    const real = await realpath(dirPath).catch(() => dirPath);
    if (!realCwds.has(real)) result.push(dirPath);
  }
  return result;
}

/** FR-9: the floor check the gauntlet skill runs before a launch wave or a self-made worktree. */
export async function checkLaneDisk(input: { project?: string; path?: string }, deps: LaneDiskCheckDeps = {}): Promise<LaneDiskCheck> {
  const read = deps.read ?? readAvailableBytes;
  let path: string;
  let bytes = 0;
  let unregistered: string[] = [];
  if (input.project) {
    const config = await (deps.resolveConfig ?? resolveLaneConfig)(input.project);
    path = (await pathExists(config.lanesRoot)) ? config.lanesRoot : config.projectPath;
    bytes = await (deps.estimate ?? laneWorktreeBytes)(config);
    unregistered = await unregisteredLaneDirs(config.lanesRoot, deps.laneCwds ?? defaultLaneCwds);
  } else {
    path = resolve(input.path ?? process.cwd());
  }
  // CodeRabbit (PR #5098): read once and reuse it for both the floor decision and the
  // reported availableBytes, so they never disagree (a second read could fail or differ).
  let availableBytes: number | null;
  try {
    availableBytes = await read(path);
  } catch {
    availableBytes = null;
  }
  const refusal = await previewDiskFloor(
    { path, bytes },
    {
      read: async () => {
        if (availableBytes === null) throw new Error('read failed');
        return availableBytes;
      },
      ...(deps.ledgerDir ? { ledgerDir: deps.ledgerDir } : {}),
    },
  );
  return { path, bytes, availableBytes, refusal, unregistered };
}
