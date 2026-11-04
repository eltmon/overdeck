/**
 * D7 iteration numbers for gauntlet lanes (.pan/drafts/pan-4223.md D7).
 *
 * Iteration = the number of distinct cwd keys among lane rows with the same
 * (run, key, role), counting in `created_at` order up to and including the row.
 * A `--reuse` respawn shares its predecessor's directory and so its iteration.
 * The cwd key is the local `cwd`, or `<environmentId>:<cwd>` for a lane on
 * another machine (PAN-4638 D-4638-5), so equal paths on two machines count twice.
 */
import type { LaneRole, LegacyConversation } from '../overdeck/conversations.js';

/** The fields D7 reads; `LaneRow` from lane-rows.ts has them. */
export interface IterationRow {
  name: string;
  cwdKey: string;
  run: string;
  key: string;
  role: LaneRole;
}

/** A local lane row in the D7 shape: its cwd key is its cwd. */
export function localIterationRow(row: LegacyConversation): IterationRow {
  return { name: row.name, cwdKey: row.cwd, run: row.gauntletRun ?? '', key: row.laneKey ?? '', role: row.laneRole ?? 'builder' };
}

/** Distinct cwd keys of one (run, key, role) group, in first-use order. */
export function distinctLaneCwds(rows: readonly Pick<IterationRow, 'cwdKey'>[]): string[] {
  const cwds: string[] = [];
  for (const row of rows) if (!cwds.includes(row.cwdKey)) cwds.push(row.cwdKey);
  return cwds;
}

/** Iteration of every lane row by conversation name. `rows` must be in `created_at` order. */
export function laneIterations(rows: readonly IterationRow[]): Map<string, number> {
  const groups = new Map<string, string[]>();
  const iterations = new Map<string, number>();
  for (const row of rows) {
    const group = `${row.run}\u0000${row.key}\u0000${row.role}`;
    const cwds = groups.get(group) ?? [];
    if (!cwds.includes(row.cwdKey)) cwds.push(row.cwdKey);
    groups.set(group, cwds);
    iterations.set(row.name, cwds.indexOf(row.cwdKey) + 1);
  }
  return iterations;
}
