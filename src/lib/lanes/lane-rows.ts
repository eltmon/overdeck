/**
 * Unified lane rows (.pan/drafts/PAN-4638.md WI-1 step 2, D-4638-5, D-4638-7).
 *
 * A run's lanes live in two places: local lanes are rows in `conversations`,
 * remote lanes are stand-ins in `~/.overdeck/remote-lanes/`. `listAllLaneRows`
 * merges both into one shape so the run rules (D7 iteration, idempotency,
 * critic pairing) see every lane of the run.
 *
 * The cwd key is what D7 groups on: two machines with the same home layout
 * produce the same path, so a remote lane's key is `<environmentId>:<cwd>`.
 */
import { getConversationByName, listLaneConversations, type LaneRole, type LegacyConversation } from '../overdeck/conversations.js';
import { listRemoteLanes, readCriticLink, type RemoteLaneFacts, type RemoteLaneFilter, type RemoteLaneMirror } from './remote-lanes.js';

/** Names the sidecar store accepts; a local row with another name has no sidecar. */
const SIDECAR_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export interface LaneRow {
  /** The local conversation id; null for a remote lane. */
  id: number | null;
  name: string;
  cwd: string;
  cwdKey: string;
  createdAt: string;
  run: string;
  key: string;
  role: LaneRole;
  parentId: number | null;
  parentName: string | null;
  criticOfName: string | null;
  title: string | null;
  model: string | null;
  harness: string | null;
  effort: string | null;
  projectKey: string | null;
  archivedAt: string | null;
  /** Null for a remote lane. */
  local: LegacyConversation | null;
  /** Null for a local lane. */
  remote: { facts: RemoteLaneFacts; mirror: RemoteLaneMirror | null } | null;
}

async function localLaneRow(row: LegacyConversation): Promise<LaneRow> {
  const role = row.laneRole ?? 'builder';
  let criticOfName = row.criticOfConversationName;
  if (criticOfName === null && (role === 'critic' || role === 'verifier') && SIDECAR_NAME_PATTERN.test(row.name)) {
    criticOfName = await readCriticLink(row.name);
  }
  return {
    id: row.id,
    name: row.name,
    cwd: row.cwd,
    cwdKey: row.cwd,
    createdAt: row.createdAt,
    run: row.gauntletRun ?? '',
    key: row.laneKey ?? '',
    role,
    parentId: row.parentConversationId,
    parentName: row.parentConversationName,
    criticOfName,
    title: row.title,
    model: row.model,
    harness: row.harness,
    effort: row.effort,
    projectKey: row.projectKey,
    archivedAt: row.archivedAt,
    local: row,
    remote: null,
  };
}

function remoteLaneRow(facts: RemoteLaneFacts, mirror: RemoteLaneMirror | null, archivedAt: string | null): LaneRow {
  return {
    id: null,
    name: facts.name,
    cwd: facts.cwd,
    cwdKey: `${facts.environmentId}:${facts.cwd}`,
    createdAt: facts.createdAt,
    run: facts.run,
    key: facts.key,
    role: facts.role,
    parentId: getConversationByName(facts.parentName)?.id ?? null,
    parentName: facts.parentName,
    criticOfName: facts.criticOfName,
    title: facts.title,
    model: facts.model,
    harness: facts.harness,
    effort: facts.effort,
    projectKey: facts.projectKey,
    archivedAt,
    local: null,
    remote: { facts, mirror },
  };
}

/**
 * Every local and remote lane that matches `filter`, archived included, in
 * `createdAt` order. The sort is stable: local rows that share a timestamp
 * keep their rowid order, and remote rows (name order) follow local ones.
 */
export async function listAllLaneRows(filter: RemoteLaneFilter = {}): Promise<LaneRow[]> {
  const local = await Promise.all(listLaneConversations(filter).map(localLaneRow));
  const remote = (await listRemoteLanes(filter)).map((lane) => remoteLaneRow(lane.facts, lane.mirror, lane.archivedAt));
  return [...local, ...remote].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
