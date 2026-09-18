/**
 * housekeeping-scheduler.ts — runs the Deacon's housekeeping chores off the 60 s
 * patrol tick, at `fast` / `hourly` / `daily` cadences (PAN-3894).
 *
 * The scheduler ticks every 60 s and runs a chore when
 * `now - lastRunAt >= CADENCE_MS[cadence]`. `lastRunAt` is persisted to
 * `~/.overdeck/deacon/housekeeping.json` so a cadence survives `pan reload` — a
 * bare hourly/daily `setInterval` would reset on every restart and a daily chore
 * would rarely fire on a machine that reloads several times a day (D3). A chore
 * with no recorded `lastRunAt` is due on the first tick after boot.
 *
 * Every chore runs through `runBudgetedPatrol`, so the PAN-3850 per-UTC-day
 * firing budget applies to chores exactly as it does to tick patrols. A chore
 * that throws is logged at `warn` and still gets its `lastRunAt` stamped, so a
 * broken chore retries at its cadence rather than every minute.
 *
 * This module never imports `deacon.js` (PAN-3894 D7): the four chores whose
 * functions live there arrive through `ChoreContext.deacon`, which `startDeacon`
 * supplies.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { getOverdeckHome } from '../paths.js';
import { createInFlightGuard } from './in-flight-guard.js';
import { runBudgetedPatrol } from './patrol-budget.js';
import {
  CADENCE_MS,
  HOUSEKEEPING_CHORES,
  type ChoreContext,
  type HousekeepingChore,
  type PatrolCadence,
} from './patrol-registry.js';

export const HOUSEKEEPING_SCHEDULER_TICK_MS = 60_000;

/** Chores mark warn-level action strings with this prefix (see PAN-3894 W3a). */
export const WARN_PREFIX = '[warn] ';

export function housekeepingStatePath(): string {
  return join(getOverdeckHome(), 'deacon', 'housekeeping.json');
}

export interface HousekeepingState {
  version: 1;
  /** Chore name → ISO timestamp of its last run. */
  lastRunAt: Record<string, string>;
}

const EMPTY_STATE: HousekeepingState = { version: 1, lastRunAt: {} };

/** Tolerant read: a missing, unreadable, or torn file reads as "nothing has ever run". */
export function readHousekeepingState(path: string = housekeepingStatePath()): HousekeepingState {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return { version: 1, lastRunAt: {} };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<HousekeepingState>;
    if (parsed && typeof parsed === 'object' && parsed.lastRunAt && typeof parsed.lastRunAt === 'object') {
      return { version: 1, lastRunAt: parsed.lastRunAt as Record<string, string> };
    }
  } catch {
    // fall through — torn write reads as empty
  }
  return { version: 1, lastRunAt: {} };
}

function writeHousekeepingState(state: HousekeepingState, path: string): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp-${process.pid}`;
    writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    renameSync(tmp, path);
  } catch (err) {
    console.warn(`[deacon] Failed to persist housekeeping due-times: ${(err as Error).message}`);
  }
}

export function isChoreDue(chore: HousekeepingChore, state: HousekeepingState, nowMs: number): boolean {
  const last = state.lastRunAt[chore.name];
  if (!last) return true;
  const lastMs = Date.parse(last);
  if (!Number.isFinite(lastMs)) return true;
  return nowMs - lastMs >= CADENCE_MS[chore.cadence];
}

export type HousekeepingLogLevel = 'info' | 'warn' | 'action' | 'error';

export interface HousekeepingDeps {
  /** The four deacon-resident chore functions, supplied by startDeacon (D7). */
  context: ChoreContext;
  chores?: readonly HousekeepingChore[];
  now?: () => number;
  isPaused?: () => Promise<boolean>;
  log: (level: HousekeepingLogLevel, message: string) => void;
  runBudgeted?: typeof runBudgetedPatrol;
  statePath?: string;
}

/**
 * The default pause check imports `control-settings` lazily so that `pan doctor`,
 * which imports this module only to list cadences, does not pull the SQLite
 * app-settings module into its static graph.
 */
async function defaultIsPaused(): Promise<boolean> {
  const { isDeaconGloballyPaused } = await import('../overdeck/control-settings.js');
  return isDeaconGloballyPaused();
}

/** True while the scheduler is inside a paused span, so the skip is logged once per span. */
let hasLoggedPauseSkip = false;

/** One scheduler pass. Exported for tests; production drives it from the interval. */
export async function runHousekeepingTick(deps: HousekeepingDeps): Promise<string[]> {
  const now = deps.now ?? (() => Date.now());
  const isPaused = deps.isPaused ?? defaultIsPaused;
  const chores = deps.chores ?? HOUSEKEEPING_CHORES;
  const runBudgeted = deps.runBudgeted ?? runBudgetedPatrol;
  const statePath = deps.statePath ?? housekeepingStatePath();

  if (await isPaused()) {
    if (!hasLoggedPauseSkip) {
      hasLoggedPauseSkip = true;
      deps.log('info', 'Housekeeping scheduler paused (deacon globally paused) — skipping chores');
    }
    return [];
  }
  hasLoggedPauseSkip = false;

  const state = readHousekeepingState(statePath);
  const collected: string[] = [];

  for (const chore of chores) {
    const nowMs = now();
    if (!isChoreDue(chore, state, nowMs)) continue;

    try {
      const actions = await runBudgeted(chore.name, () => chore.run(deps.context));
      for (const action of actions) {
        collected.push(action);
        // A chore that used to log at warn on the tick marks those lines with a
        // '[warn] ' prefix (PAN-3894 W3a, perProjectSpecialistPatrol); strip it
        // and log at that level so moving a chore off the tick does not silently
        // demote its warnings to routine actions.
        if (action.startsWith(WARN_PREFIX)) deps.log('warn', action.slice(WARN_PREFIX.length));
        else deps.log('action', action);
      }
    } catch (err) {
      deps.log('warn', `Housekeeping chore ${chore.name} failed: ${(err as Error).message}`);
    }
    // Stamped even when the chore threw, so a broken chore retries at its
    // cadence instead of on every scheduler tick.
    state.lastRunAt[chore.name] = new Date(nowMs).toISOString();
    writeHousekeepingState(state, statePath);
  }

  return collected;
}

const schedulerGuard = createInFlightGuard();
let schedulerInterval: ReturnType<typeof setInterval> | null = null;

export function startHousekeepingScheduler(deps: HousekeepingDeps): void {
  if (schedulerInterval) {
    console.log('[deacon] Housekeeping scheduler already running — ignoring duplicate start');
    return;
  }
  schedulerInterval = setInterval(() => {
    schedulerGuard.run(
      'housekeeping',
      async () => { await runHousekeepingTick(deps); },
      (err) => deps.log('warn', `Housekeeping scheduler tick failed: ${(err as Error).message}`),
    );
  }, HOUSEKEEPING_SCHEDULER_TICK_MS);
  schedulerInterval.unref?.();
}

export function stopHousekeepingScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
  hasLoggedPauseSkip = false;
}

export interface HousekeepingRow {
  name: string;
  cadence: PatrolCadence;
  trigger?: string;
  lastRunAt: string | null;
  nextDueAt: string | null;
}

/** `pan doctor` table data: every chore with its cadence, last run and next due time. */
export function listHousekeepingRows(
  nowMs: number = Date.now(),
  statePath: string = housekeepingStatePath(),
  chores: readonly HousekeepingChore[] = HOUSEKEEPING_CHORES,
): HousekeepingRow[] {
  const state = readHousekeepingState(statePath);
  return chores.map((chore) => {
    const last = state.lastRunAt[chore.name];
    const lastMs = last ? Date.parse(last) : NaN;
    const known = Number.isFinite(lastMs);
    return {
      name: chore.name,
      cadence: chore.cadence,
      ...(chore.trigger ? { trigger: chore.trigger } : {}),
      lastRunAt: known ? new Date(lastMs).toISOString() : null,
      nextDueAt: known ? new Date(lastMs + CADENCE_MS[chore.cadence]).toISOString() : null,
    };
  });
}

/** Test-only: clear the module-level pause-log latch and interval. */
export function resetHousekeepingSchedulerForTests(): void {
  stopHousekeepingScheduler();
}

export { EMPTY_STATE as HOUSEKEEPING_EMPTY_STATE };
