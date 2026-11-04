/**
 * PAN-4655: settle operator conversations nobody has touched for
 * `conversations.auto_settle_idle_days` days (settle reason 'idle').
 *
 * One pass groups the operator list by display root (the Command Deck D27
 * rule), drops groups on cheap facts first (settled, snoozed, reset, released,
 * fork in progress, recent create/attach), then reads liveness, the
 * pending-input feed, and each member's transcript tail. Only roots are
 * written, through the guarded settleIdleConversation() door, so an operator
 * unsettle that lands mid-sweep wins. The dashboard host is
 * src/dashboard/server/services/conversation-idle-settle-service.ts.
 */
import { stat } from 'node:fs/promises';
import { scanPendingInputs } from '../agent-enrichment.js';
import { withConcurrencyLimit } from '../concurrency.js';
import { getConversationsAutoSettleIdleDays } from './control-settings.js';
import { isAgentConversationName, listConversations, type LegacyConversation } from './conversations.js';
import { listIdleClocks, settleIdleConversation, type IdleClock } from './conversation-triage-store.js';

export const DAY_MS = 86_400_000;

const MAX_PARENT_HOPS = 64;
const TRANSCRIPT_READ_CONCURRENCY = 8;

interface GroupableRow {
  id: number;
  parentConversationId: number | null;
  criticOfConversationId: number | null;
}

/** D27 display parent among `ids`, else null (mirrors CommandDeck/conversation-tree.ts displayParentId). */
export function displayParentIdOf(row: GroupableRow, ids: ReadonlySet<number>): number | null {
  const builderId = row.criticOfConversationId;
  if (builderId !== null && builderId !== row.id && ids.has(builderId)) return builderId;
  const parentId = row.parentConversationId;
  if (parentId !== null && parentId !== row.id && ids.has(parentId)) return parentId;
  return null;
}

/** Root id → members (root first). A parent chain longer than 64 or a cycle makes the row its own root. */
export function groupByDisplayRoot<T extends GroupableRow>(rows: readonly T[]): Map<number, T[]> {
  const byId = new Map<number, T>();
  for (const row of rows) if (!byId.has(row.id)) byId.set(row.id, row);
  const ids = new Set(byId.keys());

  const rootOf = (row: T): number => {
    const seen = new Set<number>([row.id]);
    let current = row;
    for (let hops = 0; hops < MAX_PARENT_HOPS; hops++) {
      const parentId = displayParentIdOf(current, ids);
      if (parentId === null) return current.id;
      if (seen.has(parentId)) return row.id;
      seen.add(parentId);
      current = byId.get(parentId)!;
    }
    return row.id;
  };

  const groups = new Map<number, T[]>();
  for (const row of byId.values()) {
    const rootId = rootOf(row);
    const members = groups.get(rootId) ?? [];
    if (rootId === row.id) members.unshift(row);
    else members.push(row);
    groups.set(rootId, members);
  }
  return groups;
}

/**
 * D2: the modified time when it is at or before the cutoff (no record can be
 * newer than the file); else the last user/assistant record time in the tail,
 * because Claude Code touches a running transcript without writing a record
 * (PAN-4515); else the modified time. Null when the file cannot be read.
 */
export async function readTranscriptLastActivityMs(path: string, cutoffMs: number): Promise<number | null> {
  let mtimeMs: number;
  try {
    mtimeMs = (await stat(path)).mtimeMs;
  } catch {
    return null;
  }
  if (mtimeMs <= cutoffMs) return mtimeMs;
  const { lastRecordAt } = await scanPendingInputs(path);
  const recordMs = lastRecordAt ? Date.parse(lastRecordAt) : NaN;
  return Number.isFinite(recordMs) ? recordMs : mtimeMs;
}

export interface IdleSettleDeps {
  now?: () => number;
  idleDays?: () => number;
  listRows?: () => LegacyConversation[];
  listIdleClocks?: () => Map<string, IdleClock>;
  /** Live terminal session names; null when the backend did not answer. */
  listLiveSessions: () => Promise<ReadonlySet<string> | null>;
  /** Names waiting on the operator (pending-input feed); null when the feed failed. */
  listWaitingNames: (live: ReadonlySet<string>) => Promise<ReadonlySet<string> | null>;
  resolveTranscript: (conv: LegacyConversation) => Promise<string | null>;
  lastActivityMs?: (path: string, cutoffMs: number) => Promise<number | null>;
  settle?: (name: string, cutoffMs: number, nowMs: number) => boolean;
  log?: (line: string) => void;
}

function isAtOrBefore(iso: string | null, cutoffMs: number): boolean {
  if (iso === null) return true;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) && ms <= cutoffMs;
}

function isCandidateGroup(members: readonly LegacyConversation[], clock: IdleClock | undefined, cutoffMs: number): boolean {
  const root = members[0]!;
  if (isAgentConversationName(root.name) || root.releasedTo) return false;
  if (!clock || clock.settledAtMs !== null) return false;
  if (clock.snoozedUntilMs !== null && clock.snoozedUntilMs > cutoffMs) return false;
  if (clock.idleResetAtMs !== null && clock.idleResetAtMs > cutoffMs) return false;
  return members.every(
    (member) =>
      isAtOrBefore(member.createdAt, cutoffMs) &&
      isAtOrBefore(member.lastAttachedAt, cutoffMs) &&
      !(member.forkStatus && member.forkStatus !== 'failed'),
  );
}

/** One pass. Returns the names it settled. */
export async function sweepIdleConversations(deps: IdleSettleDeps): Promise<string[]> {
  const days = (deps.idleDays ?? getConversationsAutoSettleIdleDays)();
  if (days <= 0) return [];

  const log = deps.log ?? ((line: string) => console.log(line));
  const nowMs = (deps.now ?? Date.now)();
  const cutoffMs = nowMs - days * DAY_MS;

  const rows = (deps.listRows ?? (() => listConversations()))();
  const clocks = (deps.listIdleClocks ?? listIdleClocks)();
  const candidates = [...groupByDisplayRoot(rows).values()].filter((members) =>
    isCandidateGroup(members, clocks.get(members[0]!.name), cutoffMs),
  );
  if (candidates.length === 0) return [];

  const live = await deps.listLiveSessions();
  if (live === null) {
    log('[idle-settle] terminal sessions could not be listed; skipping this sweep');
    return [];
  }
  const waiting = await deps.listWaitingNames(live);
  if (waiting === null) {
    log('[idle-settle] pending-input feed failed; skipping this sweep');
    return [];
  }

  const lastActivityMs = deps.lastActivityMs ?? readTranscriptLastActivityMs;
  const settle = deps.settle ?? settleIdleConversation;
  const settled: string[] = [];
  const idleGroups = candidates.filter((members) => !members.some((member) => waiting.has(member.name)));

  await withConcurrencyLimit(
    idleGroups.map((members) => async () => {
      for (const member of members) {
        const path = await deps.resolveTranscript(member);
        if (path === null) {
          if (live.has(member.tmuxSession)) return;
          continue;
        }
        const activity = await lastActivityMs(path, cutoffMs);
        if (activity !== null && activity > cutoffMs) return;
      }
      const root = members[0]!;
      if (settle(root.name, cutoffMs, nowMs)) settled.push(root.name);
    }),
    TRANSCRIPT_READ_CONCURRENCY,
  );
  return settled;
}
