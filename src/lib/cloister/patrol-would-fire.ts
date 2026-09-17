/**
 * PAN-3848 (W30, FR-22): would-have-fired counters for the patrol soak.
 *
 * Every patrol slated for deletion in Phase 3 runs through
 * `runShadowablePatrol`: it detects as always, and each action it takes (or
 * would take) is counted here — appended to
 * `~/.overdeck/deacon/would-fire.jsonl` and kept in an in-memory counter.
 * When `OVERDECK_PATROL_SHADOW=1` is set (the soak), the patrol detects but
 * does not act, so a week of zeros proves the state the patrol repaired is
 * unreachable and the deletion is safe. `pan doctor` prints the 7-day table.
 */

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { join } from 'node:path';

import { getOverdeckHome } from '../paths.js';

export interface WouldFireEntry {
  ts: string;
  patrol: string;
  issueId?: string;
  shadow: boolean;
}

/** Options bag for shadow-aware patrols (PAN-3848 W30). */
export interface PatrolShadowOptions {
  /** Shadow mode (the soak): detect and count, but never act. */
  shadow?: boolean;
}

const inMemoryCounts = new Map<string, number>();

export function isPatrolShadowMode(): boolean {
  return process.env.OVERDECK_PATROL_SHADOW === '1';
}

export function wouldFireLogPath(): string {
  return join(getOverdeckHome(), 'deacon', 'would-fire.jsonl');
}

/**
 * Record one would-have-fired event for a patrol. Best-effort: the counter is
 * observability, never a reason to fail a patrol.
 */
export function recordWouldFire(patrol: string, issueId?: string): void {
  inMemoryCounts.set(patrol, (inMemoryCounts.get(patrol) ?? 0) + 1);
  try {
    const path = wouldFireLogPath();
    mkdirSync(dirname(path), { recursive: true });
    const entry: WouldFireEntry = {
      ts: new Date().toISOString(),
      patrol,
      ...(issueId ? { issueId } : {}),
      shadow: isPatrolShadowMode(),
    };
    appendFileSync(path, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch (error) {
    console.warn(`[patrol-would-fire] failed to append ${patrol}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Per-patrol would-fire counts since `sinceIso` (inclusive). Unparseable lines
 * are skipped — a torn write must not break the doctor table.
 */
export function readWouldFireCounts(sinceIso?: string): Record<string, number> {
  let raw: string;
  try {
    raw = readFileSync(wouldFireLogPath(), 'utf8');
  } catch {
    return {};
  }
  const counts: Record<string, number> = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry: WouldFireEntry;
    try {
      entry = JSON.parse(trimmed) as WouldFireEntry;
    } catch {
      continue;
    }
    if (typeof entry.patrol !== 'string' || typeof entry.ts !== 'string') continue;
    if (sinceIso && entry.ts < sinceIso) continue;
    counts[entry.patrol] = (counts[entry.patrol] ?? 0) + 1;
  }
  return counts;
}

/** Test hook: the process-local counts, without touching the JSONL file. */
export function getInMemoryWouldFireCounts(): Record<string, number> {
  return Object.fromEntries(inMemoryCounts);
}

/** Test hook: reset the process-local counters. */
export function resetInMemoryWouldFireCounts(): void {
  inMemoryCounts.clear();
}

/**
 * Run one patrol through the would-fire counter (PAN-3848 W30). The patrol
 * receives `shadow`: when shadow mode is on, it must detect as usual but gate
 * every state-changing action behind `if (!shadow)`, calling
 * `recordWouldFire(<patrol>, issueId)` at each action site instead. (Counting
 * happens at the action site, not here, because patrols mix real actions with
 * diagnostic strings in their return values.) In shadow mode the returned
 * strings are logged as would-have-acted lines and NOT merged into the
 * deacon's real action log.
 */
export async function runShadowablePatrol(
  patrol: string,
  fn: (shadow: boolean) => Promise<string[]>,
): Promise<string[]> {
  const shadow = isPatrolShadowMode();
  const actions = await fn(shadow);
  if (!shadow) return actions;
  for (const action of actions) {
    console.log(`[deacon] ${patrol} (shadow, no action taken): ${action}`);
  }
  return [];
}
