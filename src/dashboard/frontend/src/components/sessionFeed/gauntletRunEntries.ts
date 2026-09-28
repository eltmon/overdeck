/**
 * PAN-4301 run cards: one feed entry per gauntlet run — the lane conversations
 * sharing (projectKey, gauntletRun). A pure selector over `/api/conversations`
 * rows plus an explicit `now`; nothing is stored or fetched here.
 *
 * The card is dated by the run's latest notable event (a report, a failed
 * start, an end or a launch — FR-8), never by a transcript mtime
 * (`lastActivityAt`), so a working run does not jump back to "Just Now" on
 * every poll. Pending input shows in the counts and state but does not date
 * the card (D4).
 */
import { laneActivityOf, type LaneActivity } from '@overdeck/contracts';
import type { ConversationFeedRow, GauntletRunLane, GauntletRunSessionFeedEntry } from './types';

type LaneRole = GauntletRunLane['role'];

const ROLE_ORDER: readonly LaneRole[] = ['builder', 'critic', 'verifier', 'play', 'orchestrator'];

/** FR-9 activity order and labels. */
const ACTIVITY_LABELS: ReadonlyArray<readonly [LaneActivity, string]> = [
  ['needs-you', 'needs you'],
  ['failed-to-start', 'failed to start'],
  ['working', 'working'],
  ['idle', 'idle'],
  ['starting', 'starting'],
  ['stopped', 'stopped'],
];

/** A lane row: non-null `gauntletRun` and `laneKey` (the test `laneEnrichment` uses server-side). */
export function isLaneRow(row: ConversationFeedRow): boolean {
  return row.gauntletRun != null && row.laneKey != null;
}

interface LaneFacts {
  row: ConversationFeedRow;
  key: string;
  role: LaneRole;
  activity: LaneActivity;
}

interface RunEvent {
  text: string;
  at: string;
  /** FR-8 tie order: report (0) > failed start (1) > end (2) > launch (3). */
  rank: number;
}

export function groupGauntletRuns(
  lanes: readonly ConversationFeedRow[],
  allRows: readonly ConversationFeedRow[],
  now: number,
): GauntletRunSessionFeedEntry[] {
  const groups = new Map<string, { run: string; projectKey: string | null; lanes: LaneFacts[] }>();
  for (const row of lanes) {
    if (row.gauntletRun == null || row.laneKey == null) continue;
    const projectKey = row.projectKey ?? null;
    const id = runEntryId(projectKey, row.gauntletRun);
    let group = groups.get(id);
    if (!group) {
      group = { run: row.gauntletRun, projectKey, lanes: [] };
      groups.set(id, group);
    }
    group.lanes.push({ row, key: row.laneKey, role: row.laneRole ?? 'builder', activity: laneActivityOf(row, now) });
  }

  const titleById = new Map(allRows.map((row) => [row.id, row.title ?? null]));
  const entries: GauntletRunSessionFeedEntry[] = [];
  for (const [id, group] of groups) {
    const ordered = orderLanes(group.lanes);
    const latest = latestEvent(ordered);
    const orchestrator = orchestratorOf(ordered);
    entries.push({
      kind: 'gauntlet_run',
      id,
      timestamp: latest.at,
      workspaceId: null,
      issueId: null,
      run: group.run,
      projectKey: group.projectKey,
      orchestratorName: orchestrator?.name ?? null,
      orchestratorTitle: orchestrator ? titleById.get(orchestrator.id) ?? null : null,
      countsLine: countsLine(ordered),
      state: runState(ordered),
      latest: { text: latest.text, at: latest.at },
      lanes: ordered.map(toRunLane),
      laneConversationIds: ordered.map((lane) => lane.row.id),
      anyAlive: ordered.some((lane) => lane.row.sessionAlive === true),
    });
  }

  return entries.sort((a, b) => Date.parse(b.latest.at) - Date.parse(a.latest.at) || a.id.localeCompare(b.id));
}

function runEntryId(projectKey: string | null, run: string): string {
  return `gauntlet-run:${projectKey ?? '-'}:${run}`;
}

/** FR-9: role counts, then activity counts, each only when non-zero. */
function countsLine(lanes: readonly LaneFacts[]): string {
  const parts: string[] = [];
  for (const role of ROLE_ORDER) {
    const count = lanes.filter((lane) => lane.role === role).length;
    if (count > 0) parts.push(`${count} ${role}${count === 1 ? '' : 's'}`);
  }
  for (const [activity, label] of ACTIVITY_LABELS) {
    const count = lanes.filter((lane) => lane.activity === activity).length;
    if (count > 0) parts.push(`${count} ${label}`);
  }
  return parts.join(' · ');
}

function runState(lanes: readonly LaneFacts[]): GauntletRunSessionFeedEntry['state'] {
  if (lanes.some((lane) => lane.activity === 'needs-you')) return 'needs-you';
  if (lanes.some((lane) => lane.activity === 'failed-to-start'
    || lane.row.laneReport?.status === 'blocked'
    || lane.row.laneReport?.status === 'failed')) return 'failed';
  if (lanes.some((lane) => lane.activity === 'working')) return 'working';
  if (lanes.some((lane) => lane.activity === 'idle' || lane.activity === 'starting')) return 'idle';
  return 'stopped';
}

/** FR-8: the newest per-lane fact across the run; ties break report > failed start > end > launch. */
function latestEvent(lanes: readonly LaneFacts[]): RunEvent {
  // Every lane yields a launch event, and a group is never empty.
  const [first, ...rest] = lanes.flatMap(laneEvents);
  return rest.reduce((latest, event) => (isNewer(event, latest) ? event : latest), first);
}

function isNewer(candidate: RunEvent, current: RunEvent): boolean {
  const delta = Date.parse(candidate.at) - Date.parse(current.at);
  return delta > 0 || (delta === 0 && candidate.rank < current.rank);
}

function laneEvents({ row, key, role }: LaneFacts): RunEvent[] {
  const events: RunEvent[] = [];
  if (row.laneReport) {
    const iteration = row.laneIteration == null ? '' : ` i${row.laneIteration}`;
    const verdict = row.laneReport.verdict ? ` · verdict ${row.laneReport.verdict}` : '';
    events.push({ text: `${key} ${role}${iteration} reported ${row.laneReport.status}${verdict}`, at: row.laneReport.at, rank: 0 });
  }
  if (row.spawnError) events.push({ text: `${key} ${role} failed to start`, at: row.createdAt, rank: 1 });
  if (row.status === 'ended' && row.endedAt) events.push({ text: `${key} ${role} ended`, at: row.endedAt, rank: 2 });
  events.push({ text: `${key} ${role} launched`, at: row.createdAt, rank: 3 });
  return events;
}

/**
 * D8: the `parentConversationId` shared by the most lanes whose parent is not
 * itself a lane of the run; ties go to the smaller id.
 */
function orchestratorOf(lanes: readonly LaneFacts[]): { id: number; name: string | null } | null {
  const laneIds = new Set(lanes.map((lane) => lane.row.id));
  const byParent = new Map<number, { count: number; name: string | null }>();
  for (const { row } of lanes) {
    const parentId = row.parentConversationId;
    if (parentId == null || laneIds.has(parentId)) continue;
    const current = byParent.get(parentId) ?? { count: 0, name: null };
    byParent.set(parentId, { count: current.count + 1, name: current.name ?? row.parentConversationName ?? null });
  }
  let best: { id: number; count: number; name: string | null } | null = null;
  for (const [id, { count, name }] of byParent) {
    if (!best || count > best.count || (count === best.count && id < best.id)) best = { id, count, name };
  }
  return best ? { id: best.id, name: best.name } : null;
}

/**
 * FR-12: builders by key, each followed by the lanes that judge it (by
 * creation), then the rest by role order and key.
 */
function orderLanes(lanes: readonly LaneFacts[]): LaneFacts[] {
  const byCreation = (a: LaneFacts, b: LaneFacts) => Date.parse(a.row.createdAt) - Date.parse(b.row.createdAt) || a.row.id - b.row.id;
  const byKey = (a: LaneFacts, b: LaneFacts) => a.key.localeCompare(b.key) || byCreation(a, b);
  const byRoleThenKey = (a: LaneFacts, b: LaneFacts) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || byKey(a, b);

  const builders = lanes.filter((lane) => lane.role === 'builder').sort(byKey);
  const ordered: LaneFacts[] = [];
  const placed = new Set<LaneFacts>();
  for (const builder of builders) {
    ordered.push(builder);
    placed.add(builder);
    const judges = lanes
      .filter((lane) => lane.role !== 'builder' && lane.row.criticOfConversationId === builder.row.id)
      .sort(byCreation);
    for (const judge of judges) {
      ordered.push(judge);
      placed.add(judge);
    }
  }
  const rest = lanes.filter((lane) => !placed.has(lane)).sort(byRoleThenKey);
  return [...ordered, ...rest];
}

function toRunLane({ row, key, role, activity }: LaneFacts): GauntletRunLane {
  return {
    id: row.id,
    name: row.name,
    key,
    role,
    iteration: row.laneIteration ?? null,
    activity,
    report: row.laneReport
      ? { status: row.laneReport.status, at: row.laneReport.at, verdict: row.laneReport.verdict ?? null }
      : null,
    criticOfConversationId: row.criticOfConversationId ?? null,
    createdAt: row.createdAt,
  };
}
