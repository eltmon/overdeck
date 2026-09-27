/**
 * D7 iteration numbers for gauntlet lanes (.pan/drafts/pan-4223.md D7).
 *
 * Iteration = the number of distinct `cwd` values among lane rows with the same
 * (run, key, role), counting in `created_at` order up to and including the row.
 * A `--reuse` respawn shares its predecessor's directory and so its iteration.
 */
import type { LegacyConversation } from '../overdeck/conversations.js';

type LaneRow = Pick<LegacyConversation, 'name' | 'cwd' | 'gauntletRun' | 'laneKey' | 'laneRole'>;

/** Distinct working directories of one (run, key, role) group, in first-use order. */
export function distinctLaneCwds(rows: readonly Pick<LegacyConversation, 'cwd'>[]): string[] {
  const cwds: string[] = [];
  for (const row of rows) if (!cwds.includes(row.cwd)) cwds.push(row.cwd);
  return cwds;
}

/** Iteration of every lane row by conversation name. `rows` must be in `created_at` order. */
export function laneIterations(rows: readonly LaneRow[]): Map<string, number> {
  const groups = new Map<string, string[]>();
  const iterations = new Map<string, number>();
  for (const row of rows) {
    const group = `${row.gauntletRun}\u0000${row.laneKey}\u0000${row.laneRole}`;
    const cwds = groups.get(group) ?? [];
    if (!cwds.includes(row.cwd)) cwds.push(row.cwd);
    groups.set(group, cwds);
    iterations.set(row.name, cwds.indexOf(row.cwd) + 1);
  }
  return iterations;
}
