/**
 * Merge linked machines' cached conversations into the local list (PAN-4650
 * WI-4, FR-2, D-4650-3). Pure: the caller reads the rows, links and presence.
 *
 * One row per conversation, by precedence: a local row (a released one
 * included) beats a linked row, which beats a vault copy.
 * - A linked row whose native session id matches a local row is dropped.
 * - A linked row of an environment with no active link, of a hidden machine,
 *   or released to this machine is dropped.
 * - Of linked rows sharing a session id (a pull between two linked machines),
 *   the unreleased one is kept.
 * - The owner names the vault record it settles each conversation into
 *   (`vaultId`); the viewer's saved copy of it is the browse row
 *   `vault-<vaultId>`. A saved copy whose conversation is listed (locally or
 *   as a linked row) is dropped, and a kept linked row carries its name as
 *   `savedCopyName`. Saved copies of hidden or unlinked machines stay.
 * - PAN-4638 FR-8: a kept linked row of a gauntlet lane this machine launched
 *   on that machine (a remote lane stand-in) carries the lane facts — parent,
 *   run, key, role, critic link — and home's project key, so the Command Deck
 *   nests it under its orchestrator and the Awareness rail counts it in the run.
 * - PAN-5000: a linked row with no title, or a title that is only a file
 *   path (e.g. an attachment path), shows `linkedRowTitle`'s fallback instead
 *   of leaking the owner's list name or a filesystem path into the UI.
 */
import { linkedConversationName, type LinkState, type SharedConversationRow } from '@overdeck/contracts';

import type { MachineLink } from '../anywhere/link-store.js';
import type { LaneRole } from './conversations.js';
import { EMPTY_CONVERSATION_TRIAGE } from './conversation-triage-store.js';
import { VAULT_BROWSE_PREFIX } from './conversation-vault-rows.js';
import { linkedRowTitle } from './linked-conversation-title.js';
import type { LinkedConversationRecord } from './linked-conversations.js';

export interface LinkPresence {
  state: LinkState;
  lastSeenAt: string | null;
}

/** The fields of a list row the merge reads; every other field passes through. */
type ListRow = Record<string, unknown> & { name: string; claudeSessionId?: string | null };

export interface MergeConversationRowsInput {
  local: readonly ListRow[];
  vaultCopies: readonly ListRow[];
  linked: readonly LinkedConversationRecord[];
  links: readonly MachineLink[];
  selfEnvironmentId: string | null;
  presence: (link: MachineLink) => LinkPresence;
  /** PAN-4638: unarchived remote lane stand-ins, keyed `<environmentId>\u0000<name>`. */
  remoteLanes?: ReadonlyMap<string, RemoteLaneEntry>;
}

/** The stand-in facts a remote lane's linked row is stamped with. */
export interface RemoteLaneEntry {
  parentName: string;
  run: string;
  key: string;
  role: LaneRole;
  criticOfName: string | null;
  projectKey: string;
}

export function remoteLaneKey(environmentId: string, name: string): string {
  return `${environmentId}\u0000${name}`;
}

/** A linked row in the shape of an enriched list row, with the D-4650-3 fields. */
function linkedListRow(
  record: LinkedConversationRecord,
  link: MachineLink,
  presence: LinkPresence,
  savedCopy: ListRow | null,
): Record<string, unknown> {
  const row: SharedConversationRow = record.row;
  return {
    id: -record.id,
    name: linkedConversationName(record.environmentId, row.name),
    tmuxSession: row.tmuxSession ?? '',
    status: row.status,
    cwd: row.cwd ?? '',
    issueId: row.issueId,
    createdAt: row.createdAt,
    endedAt: row.status === 'ended' ? row.lastActivityAt : null,
    lastAttachedAt: null,
    lastActivityAt: row.lastActivityAt,
    claudeSessionId: row.nativeSessionId,
    title: linkedRowTitle(row.title),
    model: row.model,
    harness: row.harness,
    projectKey: row.projectKey,
    archivedAt: null,
    totalCost: 0, totalTokens: 0, sessionAlive: row.sessionAlive, isWorking: row.isWorking, currentTool: null,
    isFavorited: false, compacting: false, contextUsage: null, branch: null, isWorktree: false,
    pullRequest: null, pullRequestCount: 0, pendingInputCount: 0, pendingInputKinds: [],
    transcriptMissing: false, needsTerminal: false, providerError: null, vaultContinuity: null,
    ...EMPTY_CONVERSATION_TRIAGE,
    gitOrigin: row.gitOrigin,
    pullable: row.pullable,
    pulledFrom: row.pulledFrom ?? null,
    origin: 'linked',
    environmentId: record.environmentId,
    remoteName: row.name,
    machineLabel: link.label,
    machineState: presence.state,
    machineLastSeenAt: presence.lastSeenAt ?? record.cachedAt,
    savedCopyName: savedCopy?.name ?? null,
    /** When the saved copy was last settled (the row shows "offline · saved HH:MM"). */
    savedCopyAt: (savedCopy?.endedAt as string | null | undefined) ?? null,
    releasedTo: row.releasedTo,
    spawnError: row.spawnError ?? null,
  };
}

export function mergeConversationRows(input: MergeConversationRowsInput): Array<Record<string, unknown>> {
  const localSessions = new Set(input.local.map((row) => row.claudeSessionId).filter((id): id is string => !!id));
  const activeLinks = new Map(input.links.filter((link) => link.revokedAt === null).map((link) => [link.environmentId, link]));
  const claimedVaultIds = new Set<string>();

  const candidates: Array<{ record: LinkedConversationRecord; link: MachineLink }> = [];
  for (const record of input.linked) {
    const { nativeSessionId, vaultId, releasedTo } = record.row;
    if (nativeSessionId && localSessions.has(nativeSessionId)) {
      if (vaultId) claimedVaultIds.add(vaultId);
      continue;
    }
    const link = activeLinks.get(record.environmentId);
    if (!link || link.hidden === true) continue;
    if (input.selfEnvironmentId !== null && releasedTo === input.selfEnvironmentId) continue;
    candidates.push({ record, link });
  }

  // A pull between two linked machines lists the session on both: keep the current owner's row.
  const bySession = new Map<string, { record: LinkedConversationRecord; link: MachineLink }>();
  const kept: Array<{ record: LinkedConversationRecord; link: MachineLink }> = [];
  for (const candidate of candidates) {
    const session = candidate.record.row.nativeSessionId;
    if (!session) {
      kept.push(candidate);
      continue;
    }
    const previous = bySession.get(session);
    if (!previous || (previous.record.row.releasedTo !== null && candidate.record.row.releasedTo === null)) {
      bySession.set(session, candidate);
    }
  }
  kept.push(...bySession.values());
  kept.sort((a, b) => a.record.id - b.record.id);

  const vaultCopiesByName = new Map(input.vaultCopies.map((row) => [row.name, row]));
  const localIds = new Map(input.local.map((row) => [row.name, typeof row['id'] === 'number' ? row['id'] : null]));
  // A remote critic may judge a builder on any machine: its linked row id by the owner's name.
  const linkedIds = new Map(kept.map(({ record }) => [record.row.name, -record.id]));
  const linkedRows = kept.map(({ record, link }) => {
    const vaultId = record.row.vaultId;
    if (vaultId) claimedVaultIds.add(vaultId);
    const savedCopy = vaultId ? vaultCopiesByName.get(`${VAULT_BROWSE_PREFIX}${vaultId}`) ?? null : null;
    const row = linkedListRow(record, link, input.presence(link), savedCopy);
    const lane = input.remoteLanes?.get(remoteLaneKey(record.environmentId, record.row.name));
    if (!lane) return row;
    const criticOf = lane.criticOfName === null ? null : (localIds.get(lane.criticOfName) ?? linkedIds.get(lane.criticOfName) ?? null);
    return {
      ...row,
      projectKey: lane.projectKey,
      parentConversationId: localIds.get(lane.parentName) ?? null,
      parentConversationName: lane.parentName,
      gauntletRun: lane.run,
      laneKey: lane.key,
      laneRole: lane.role,
      criticOfConversationId: criticOf,
    };
  });

  const vaultCopies = input.vaultCopies.filter((row) => !claimedVaultIds.has(row.name.slice(VAULT_BROWSE_PREFIX.length)));
  return [...input.local, ...linkedRows, ...vaultCopies];
}
