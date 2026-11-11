/**
 * PAN-5094: superseded lanes that `pan lane reap` can remove now. The unit is
 * the iteration group (one directory; several rows only after --reuse), so a
 * group is reapable only when none of its rows is live. Orchestrator lanes are
 * never reapable here: archiving one orphans the lanes it launched.
 */
import type { LaneActivity } from '@overdeck/contracts';

import type { LaneRole } from '../overdeck/conversations.js';

export interface ReapableRow {
  name: string;
  run: string;
  key: string;
  role: LaneRole;
  iteration: number;
  createdAt: string;
  archived: boolean;
  activity: LaneActivity;
  /** The lane filed at least one report. */
  reported: boolean;
}

const LIVE: ReadonlySet<LaneActivity> = new Set(['working', 'needs-you', 'starting']);

/** Lane name → name of the newest lane of the highest iteration, for every reapable lane. */
export function supersededLanes(rows: readonly ReapableRow[]): Map<string, string> {
  const groups = new Map<string, ReapableRow[]>();
  for (const row of rows) {
    if (row.role === 'orchestrator') continue;
    const id = `${row.run}\u0000${row.key}\u0000${row.role}`;
    groups.set(id, [...(groups.get(id) ?? []), row]);
  }
  const result = new Map<string, string>();
  for (const group of groups.values()) {
    const top = Math.max(...group.map((row) => row.iteration));
    const newest = group
      .filter((row) => row.iteration === top)
      .reduce((a, b) => (Date.parse(b.createdAt) >= Date.parse(a.createdAt) ? b : a));
    for (const iteration of new Set(group.map((row) => row.iteration))) {
      if (iteration >= top) continue;
      const members = group.filter((row) => row.iteration === iteration);
      const open = members.filter((row) => !row.archived);
      if (open.length === 0 || open.some((row) => LIVE.has(row.activity))) continue;
      if (!members.some((row) => row.reported) && open.some((row) => row.activity === 'idle')) continue;
      for (const row of open) result.set(row.name, newest.name);
    }
  }
  return result;
}
