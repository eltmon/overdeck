/**
 * Door for pull requests linked to conversations (PAN-3822).
 *
 * One table, `conversation_pull_requests`, keyed by (conversation_id, host,
 * repository, number). This slice writes only `branch` links, from the
 * pull-request sync sweep; the `source` and `dismissed_at` columns are already
 * in place for explicit links and unlinking. Every write that changes what a
 * conversation shows emits `conversation.pull_requests_changed`.
 */

import {
  resolveEffectivePullRequest,
  type PullRequestKey,
  type PullRequestLink,
  type PullRequestLinkSource,
  type PullRequestSnapshot,
} from '@overdeck/contracts';

import { getEventStore } from '../../dashboard/server/event-store.js';
import { getOverdeckDatabase } from './infra.js';

interface LinkRow {
  conversation_name: string;
  host: string;
  repository: string;
  number: number;
  url: string;
  source: string;
  linked_at: number;
  dismissed_at: number | null;
  snapshot_json: string | null;
}

export interface PullRequestSyncConversation {
  /** conversations.id (text UUID) — the link table's foreign key. */
  readonly id: string;
  readonly name: string;
  readonly cwd: string;
  readonly issueId: string | null;
}

const LINK_SELECT = `
  SELECT c.name AS conversation_name, l.host, l.repository, l.number, l.url, l.source,
         l.linked_at, l.dismissed_at, l.snapshot_json
  FROM conversation_pull_requests l
  JOIN conversations c ON c.id = l.conversation_id`;

function parseSnapshot(json: string | null): PullRequestSnapshot | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as PullRequestSnapshot;
  } catch {
    return null;
  }
}

function rowToLink(row: LinkRow): PullRequestLink {
  return {
    host: row.host,
    repository: row.repository,
    number: row.number,
    url: row.url,
    source: row.source as PullRequestLinkSource,
    linkedAt: new Date(row.linked_at).toISOString(),
    dismissedAt: row.dismissed_at === null ? null : new Date(row.dismissed_at).toISOString(),
    snapshot: parseSnapshot(row.snapshot_json),
  };
}

/** Every non-archived conversation, operator and agent alike, for the sweep. */
export function listConversationsForPullRequestSync(): PullRequestSyncConversation[] {
  const rows = getOverdeckDatabase()
    .prepare(`SELECT id, name, cwd, issue_id FROM conversations WHERE archived_at IS NULL`)
    .all<{ id: string; name: string; cwd: string; issue_id: string | null }>();
  return rows.map((row) => ({ id: row.id, name: row.name, cwd: row.cwd, issueId: row.issue_id }));
}

/** All links for one conversation, dismissed ones included. */
export function listConversationPullRequests(conversationName: string): PullRequestLink[] {
  return getOverdeckDatabase()
    .prepare(`${LINK_SELECT} WHERE c.name = ? ORDER BY l.linked_at`)
    .all<LinkRow>(conversationName)
    .map(rowToLink);
}

/**
 * Links for a page of conversations in ONE query, grouped by conversation name.
 * The conversation list uses this to attach the effective PR to each row.
 */
export function listPullRequestLinksForConversations(
  conversationNames: readonly string[],
): Map<string, PullRequestLink[]> {
  const byName = new Map<string, PullRequestLink[]>();
  if (conversationNames.length === 0) return byName;
  const placeholders = conversationNames.map(() => '?').join(', ');
  const rows = getOverdeckDatabase()
    .prepare(`${LINK_SELECT} WHERE c.name IN (${placeholders}) ORDER BY l.linked_at`)
    .all<LinkRow>(...conversationNames);
  for (const row of rows) {
    const links = byName.get(row.conversation_name) ?? [];
    links.push(rowToLink(row));
    byName.set(row.conversation_name, links);
  }
  return byName;
}

/**
 * Insert a `branch` link when the conversation has no row for this key yet.
 * Returns false when any row exists — including a dismissed one, so the sweep
 * never resurrects a link the operator unlinked.
 */
export function upsertBranchPullRequestLink(
  conversationId: string,
  link: PullRequestKey & { url: string },
  snapshot: PullRequestSnapshot,
  now: number = Date.now(),
): boolean {
  const result = getOverdeckDatabase()
    .prepare(`
      INSERT INTO conversation_pull_requests
        (conversation_id, host, repository, number, url, source, linked_at, dismissed_at, snapshot_json)
      VALUES (?, ?, ?, ?, ?, 'branch', ?, NULL, ?)
      ON CONFLICT(conversation_id, host, repository, number) DO NOTHING
    `)
    .run(conversationId, link.host, link.repository, link.number, link.url, now, JSON.stringify(snapshot));
  return Number(result.changes) > 0;
}

function snapshotWithoutSyncTime(snapshot: PullRequestSnapshot | null): string {
  if (snapshot === null) return 'null';
  const { syncedAt: _syncedAt, ...rest } = snapshot;
  return JSON.stringify(rest);
}

/**
 * Store a fresh snapshot on every link to this PR whose stored snapshot differs
 * (ignoring `syncedAt`, so an unchanged PR causes no write and no event).
 * Returns the names of the conversations whose links changed.
 */
export function setPullRequestLinkSnapshot(key: PullRequestKey, snapshot: PullRequestSnapshot): string[] {
  const db = getOverdeckDatabase();
  const rows = db
    .prepare(`
      SELECT l.conversation_id, c.name AS conversation_name, l.snapshot_json
      FROM conversation_pull_requests l
      JOIN conversations c ON c.id = l.conversation_id
      WHERE l.host = ? AND l.repository = ? AND l.number = ?
    `)
    .all<{ conversation_id: string; conversation_name: string; snapshot_json: string | null }>(
      key.host, key.repository, key.number,
    );
  const next = snapshotWithoutSyncTime(snapshot);
  const update = db.prepare(`
    UPDATE conversation_pull_requests SET snapshot_json = ?
    WHERE conversation_id = ? AND host = ? AND repository = ? AND number = ?
  `);
  const changed: string[] = [];
  for (const row of rows) {
    if (snapshotWithoutSyncTime(parseSnapshot(row.snapshot_json)) === next) continue;
    update.run(JSON.stringify(snapshot), row.conversation_id, key.host, key.repository, key.number);
    changed.push(row.conversation_name);
  }
  return changed;
}

/** Tell connected clients a conversation's links changed. No-op outside the dashboard. */
export function emitConversationPullRequestsChanged(conversationName: string): void {
  try {
    getEventStore().emitOnly({
      type: 'conversation.pull_requests_changed',
      timestamp: new Date().toISOString(),
      payload: {
        conversationName,
        effective: resolveEffectivePullRequest(listConversationPullRequests(conversationName)),
      },
    });
  } catch {
    // Event store is uninitialized in CLI/test contexts; the stored link is enough.
  }
}
