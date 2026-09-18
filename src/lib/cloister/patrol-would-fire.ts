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

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

export interface WouldFireRecorderHealth {
  healthy: boolean;
  firstFailureAt?: string;
  lastFailureAt?: string;
  failureCount?: number;
  lastError?: string;
  patrol?: string;
}

/**
 * Externally observable recorder health (PAN-3848 F1). A dropped JSONL append
 * reads back as a false zero, which the soak gate could mistake for "this
 * patrol never fires" and delete a live patrol. The failure is therefore
 * recorded HERE — beside the log, not in it — where `pan doctor` reports it
 * as an error until an operator clears it.
 */
export function wouldFireRecorderHealthPath(): string {
  return join(getOverdeckHome(), 'deacon', 'would-fire.unhealthy.json');
}

/** Fail-closed: a missing marker is healthy, anything else is not. */
export function readWouldFireRecorderHealth(): WouldFireRecorderHealth {
  let raw: string;
  try {
    raw = readFileSync(wouldFireRecorderHealthPath(), 'utf8');
  } catch {
    return { healthy: true };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<WouldFireRecorderHealth>;
    return {
      healthy: false,
      ...(typeof parsed.firstFailureAt === 'string' ? { firstFailureAt: parsed.firstFailureAt } : {}),
      ...(typeof parsed.lastFailureAt === 'string' ? { lastFailureAt: parsed.lastFailureAt } : {}),
      ...(typeof parsed.failureCount === 'number' ? { failureCount: parsed.failureCount } : {}),
      ...(typeof parsed.lastError === 'string' ? { lastError: parsed.lastError } : {}),
      ...(typeof parsed.patrol === 'string' ? { patrol: parsed.patrol } : {}),
    };
  } catch {
    // A torn marker must not read as healthy.
    return { healthy: false };
  }
}

function markWouldFireRecorderUnhealthy(patrol: string, error: unknown): void {
  try {
    const path = wouldFireRecorderHealthPath();
    mkdirSync(dirname(path), { recursive: true });
    const previous = readWouldFireRecorderHealth();
    const now = new Date().toISOString();
    const marker = {
      healthy: false,
      firstFailureAt: previous.healthy ? now : (previous.firstFailureAt ?? now),
      lastFailureAt: now,
      failureCount: (previous.healthy ? 0 : (previous.failureCount ?? 0)) + 1,
      lastError: error instanceof Error ? error.message : String(error),
      patrol,
    };
    writeFileSync(path, `${JSON.stringify(marker)}\n`, 'utf8');
  } catch (markerError) {
    console.warn(`[patrol-would-fire] failed to record recorder health for ${patrol}: ${markerError instanceof Error ? markerError.message : String(markerError)}`);
  }
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
    // A dropped append is a false zero in the soak evidence, not a quiet
    // skip: mark the recorder unhealthy. Deliberately NOT cleared on the next
    // success — a later success cannot un-taint the counts already lost, so
    // the marker stands until an operator removes it (see `pan doctor`).
    markWouldFireRecorderUnhealthy(patrol, error);
  }
}

/**
 * Per-patrol would-fire counts since `sinceIso` (inclusive), split by the
 * shadow mode RECORDED WITH EACH ENTRY — not the mode of the reading process
 * (PAN-3848 F3). `pan doctor` runs in its own environment, which can differ
 * from the daemon's; the per-entry flag is the only trustworthy mode signal.
 * Entries without a boolean flag predate nothing (the flag has always been
 * written) but are counted as live: for a deletion gate, an unknown firing
 * must block, never vanish. Unparseable lines are skipped — a torn write must
 * not break the doctor table.
 */
export interface WouldFireModeCounts {
  shadow: Record<string, number>;
  normal: Record<string, number>;
}

export function readWouldFireCounts(sinceIso?: string): WouldFireModeCounts {
  let raw: string;
  try {
    raw = readFileSync(wouldFireLogPath(), 'utf8');
  } catch {
    return { shadow: {}, normal: {} };
  }
  const counts: WouldFireModeCounts = { shadow: {}, normal: {} };
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
    const bucket = entry.shadow === true ? counts.shadow : counts.normal;
    bucket[entry.patrol] = (bucket[entry.patrol] ?? 0) + 1;
  }
  return counts;
}

/**
 * Patrols with BOTH shadow and live firings in the window (PAN-3848 F3). A
 * mixed patrol's zeroes prove nothing about either mode, so its soak evidence
 * is invalid until the window holds a single mode again.
 */
export function findMixedWouldFireModes(sinceIso?: string): string[] {
  const counts = readWouldFireCounts(sinceIso);
  return Object.keys(counts.shadow).filter((patrol) => (counts.normal[patrol] ?? 0) > 0).sort();
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
