/**
 * PAN-3850 (W39, FR-26): per-patrol firing budgets.
 *
 * Patrols are alarms with budgets. Each budgeted patrol keeps a per-UTC-day tally of the actions it took,
 * persisted at `~/.overdeck/deacon/patrol-budget.json`. When a patrol's tally
 * exceeds its budget (default 50 actions/day, `patrolBudgets` in
 * cloister.toml), it is suspended for the rest of the UTC day and a
 * needs-you is emitted once that day naming the patrol. The alarm patrols
 * (Appendix C #3, #64, #70, #71, #77) are exempt by default.
 *
 * A runaway patrol used to fire unbounded recovery actions every 60s tick;
 * the budget converts "thousands of duplicate repairs" into one operator
 * signal and a silent remainder of the day.
 *
 * Since the PAN-3917 cut no patrol runs through a budget (`runBudgetedPatrol`
 * was deleted in PAN-3958 CH-8 with no caller left); `pan doctor` still reads
 * the tally file through `listPatrolBudgetRows`.
 *
 * Deviation from the PRD text: the PRD routes the needs-you through
 * `recordDeadEndNeedsYou('deacon', …)`, but that door is issue-scoped —
 * `resolveProjectFromIssueSync('deacon')` resolves nothing, so the call would
 * silently no-op. The needs-you is instead an idempotent error-level activity
 * entry (`emitActivityEntryOnce`, key `patrol-budget-exceeded:<name>:<day>`),
 * the channel deacon-level alarms already use to reach the operator feed.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { join } from 'node:path';

import { emitActivityEntryOnce } from '../activity-logger.js';
import { getOverdeckHome } from '../paths.js';
import { loadCloisterConfigSync, type PatrolBudgetsConfig } from './config.js';

/** One patrol's tally for one UTC day. */
export interface PatrolBudgetDayEntry {
  actions: number;
  suspendedAt?: string;
  suspendedReason?: string;
  needsYouEmittedAt?: string;
}

export interface PatrolBudgetState {
  version: 1;
  /** Keyed by UTC day (`YYYY-MM-DD`); days older than 8 are pruned on write. */
  days: Record<string, Record<string, PatrolBudgetDayEntry>>;
}

const DEFAULT_PATROL_ACTIONS_PER_DAY = 50;

/** Keep one week of history plus today so `pan doctor` can show recent days. */
const RETAINED_DAYS = 8;

export function patrolBudgetFilePath(): string {
  return join(getOverdeckHome(), 'deacon', 'patrol-budget.json');
}

/** UTC day key (`YYYY-MM-DD`) — the budget window resets at UTC midnight. */
export function utcDayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Tolerant read: a missing or torn file is an empty budget, never a crash. */
export function readPatrolBudgetState(filePath = patrolBudgetFilePath()): PatrolBudgetState {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch {
    return { version: 1, days: {} };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<PatrolBudgetState>;
    if (parsed && typeof parsed === 'object' && parsed.days && typeof parsed.days === 'object') {
      return { version: 1, days: parsed.days as PatrolBudgetState['days'] };
    }
  } catch {
    // fall through — torn write reads as empty
  }
  return { version: 1, days: {} };
}

function writePatrolBudgetState(state: PatrolBudgetState, filePath = patrolBudgetFilePath()): void {
  // Prune old days so the file stays bounded.
  const keys = Object.keys(state.days).sort();
  while (keys.length > RETAINED_DAYS) {
    const oldest = keys.shift();
    if (oldest) delete state.days[oldest];
  }
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    const tmp = `${filePath}.tmp-${process.pid}`;
    writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    renameSync(tmp, filePath);
  } catch (error) {
    // A dropped tally is observability loss, never a reason to fail a patrol.
    console.warn(`[patrol-budget] failed to persist state: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function resolveBudgets(config?: PatrolBudgetsConfig): PatrolBudgetsConfig {
  return config ?? loadCloisterConfigSync().patrolBudgets ?? {
    default: DEFAULT_PATROL_ACTIONS_PER_DAY,
    exempt: [],
    overrides: {},
  };
}

/**
 * Record `count` actions for a patrol on the given day. Returns the new tally.
 * Zero-action passes are free: they leave the tally untouched.
 *
 * Test seam: no production caller; tests use it to set up or observe module state (PAN-3958 CH-8).
 */
export function recordPatrolActions(name: string, count: number, now: Date = new Date()): number {
  if (count <= 0) {
    return readPatrolBudgetState().days[utcDayKey(now)]?.[name]?.actions ?? 0;
  }
  const state = readPatrolBudgetState();
  const day = utcDayKey(now);
  const dayEntries = (state.days[day] ??= {});
  const entry = (dayEntries[name] ??= { actions: 0 });
  entry.actions += count;
  writePatrolBudgetState(state);
  return entry.actions;
}

/**
 * Suspend a patrol for the rest of the UTC day and emit the needs-you once
 * per day. The idempotency key makes a second suspension attempt in the same
 * day a no-op at the event store, so the operator sees exactly one alert.
 *
 * Test seam: no production caller; tests use it to set up or observe module state (PAN-3958 CH-8).
 */
export async function suspendPatrol(name: string, reason: string, now: Date = new Date()): Promise<void> {
  const state = readPatrolBudgetState();
  const day = utcDayKey(now);
  const dayEntries = (state.days[day] ??= {});
  const entry = (dayEntries[name] ??= { actions: 0 });
  const firstSuspensionToday = entry.suspendedAt === undefined;
  entry.suspendedAt ??= now.toISOString();
  entry.suspendedReason = reason;
  writePatrolBudgetState(state);

  if (!firstSuspensionToday && entry.needsYouEmittedAt) return;
  const outcome = await emitActivityEntryOnce({
    id: `patrol-budget-exceeded:${name}:${day}`,
    source: 'cloister',
    level: 'error',
    message: `Patrol ${name} suspended for the rest of ${day}: ${reason}`,
    details: `Patrol ${name} exceeded its per-day action budget and will not run again until the next UTC day. ` +
      `Investigate why it is firing this heavily, or raise its budget via patrolBudgets.overrides in cloister.toml.`,
  });
  if (outcome === 'appended' || outcome === 'duplicate') {
    const current = readPatrolBudgetState();
    const currentEntry = current.days[day]?.[name];
    if (currentEntry) {
      currentEntry.needsYouEmittedAt = now.toISOString();
      writePatrolBudgetState(current);
    }
  }
}

/** `pan doctor` table data: today's tally, budget and suspension per patrol. */
export interface PatrolBudgetRow {
  patrol: string;
  actions: number;
  budget: number | 'exempt';
  suspended: boolean;
  suspendedReason?: string;
}

export function listPatrolBudgetRows(now: Date = new Date()): PatrolBudgetRow[] {
  const budgets = resolveBudgets();
  const state = readPatrolBudgetState();
  const today = state.days[utcDayKey(now)] ?? {};
  return Object.entries(today)
    .map(([patrol, entry]): PatrolBudgetRow => {
      const exempt = budgets.exempt.includes(patrol);
      return {
        patrol,
        actions: entry.actions,
        budget: exempt ? 'exempt' : (budgets.overrides?.[patrol] ?? budgets.default),
        suspended: !exempt && (entry.suspendedAt !== undefined || entry.actions > (budgets.overrides?.[patrol] ?? budgets.default)),
        ...(entry.suspendedReason ? { suspendedReason: entry.suspendedReason } : {}),
      };
    })
    .sort((a, b) => b.actions - a.actions || a.patrol.localeCompare(b.patrol));
}
