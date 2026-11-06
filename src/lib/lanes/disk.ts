/**
 * Disk-floor admission for lane launches (PAN-5094). A lane's worktree is a
 * disk-heavy phase like a workspace start (PAN-4961): both lane doors admit it
 * with reserveDiskFloor at the lane's lanes root. A successful launch holds the
 * lease through the install window (the door does not await the lane's work); a
 * failed one releases it at once. All work is async (the doors run in the
 * dashboard server).
 */
import { reserveDiskFloor, type DiskReservation } from '../disk-floor.js';
import type { LaneRole } from '../overdeck/conversations.js';
import { listProjectsAsync } from '../projects.js';
import { estimateWorkspaceDiskCost } from '../workspace/disk-cost.js';
import type { LaneConfig } from './config.js';
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
