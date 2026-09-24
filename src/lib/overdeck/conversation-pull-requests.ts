/**
 * Door for pull requests linked to conversations (PAN-3822).
 *
 * One table, `conversation_pull_requests`, keyed by (conversation_id, host,
 * repository, number). The pull-request sync sweep writes `branch` links; the
 * operator (dashboard, `pan conv link-pr`), agents, and the pipeline write
 * explicit links (`manual`, `agent`, `created`). Unlinking never deletes a row:
 * it sets `dismissed_at`, so the sweep cannot re-add a PR the operator removed,
 * and an explicit relink clears it. Every write that changes what a
 * conversation shows emits `conversation.pull_requests_changed`.
 */

import {
  resolveEffectivePullRequest,
  type PullRequestKey,
  type PullRequestLink,
  type PullRequestLinkedConversation,
  type PullRequestLinkSource,
  type PullRequestSnapshot,
  type PullRequestState,
  parsePullRequestRef,
} from '@overdeck/contracts';

import { getEventStore } from '../../dashboard/server/event-store.js';
import { isAgentConversationName } from './conversations.js';
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

export type ExplicitPullRequestLinkSource = Exclude<PullRequestLinkSource, 'branch'>;

/**
 * Link a PR to a conversation explicitly. Upserts: an existing row (a branch
 * link, or an earlier explicit one) takes the new source and keeps its
 * snapshot. `manual` and `agent` links clear a dismissal; a `created` link
 * from the pipeline never overrides an operator's unlink. Returns the stored
 * link, or null when the conversation does not exist.
 */
export function linkConversationPullRequest(
  conversationName: string,
  link: PullRequestKey & { url: string },
  source: ExplicitPullRequestLinkSource,
  now: number = Date.now(),
): PullRequestLink | null {
  const db = getOverdeckDatabase();
  const conversation = db
    .prepare(`SELECT id FROM conversations WHERE name = ?`)
    .get<{ id: string }>(conversationName);
  if (!conversation) return null;
  const onConflict = source === 'created'
    ? `DO UPDATE SET source = CASE WHEN dismissed_at IS NULL THEN excluded.source ELSE source END`
    : `DO UPDATE SET source = excluded.source, url = excluded.url, dismissed_at = NULL`;
  db.prepare(`
    INSERT INTO conversation_pull_requests
      (conversation_id, host, repository, number, url, source, linked_at, dismissed_at, snapshot_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)
    ON CONFLICT(conversation_id, host, repository, number) ${onConflict}
  `).run(conversation.id, link.host, link.repository, link.number, link.url, source, now);
  return findLink(conversationName, link);
}

/**
 * Unlink a PR from a conversation by dismissing its row (any source). Returns
 * `unlinked: false` when there is no live link for that key.
 */
export function unlinkConversationPullRequest(
  conversationName: string,
  key: PullRequestKey,
  now: number = Date.now(),
): { unlinked: boolean } {
  const result = getOverdeckDatabase()
    .prepare(`
      UPDATE conversation_pull_requests SET dismissed_at = ?
      WHERE conversation_id = (SELECT id FROM conversations WHERE name = ?)
        AND host = ? AND repository = ? AND number = ? AND dismissed_at IS NULL
    `)
    .run(now, conversationName, key.host, key.repository, key.number);
  return { unlinked: Number(result.changes) > 0 };
}

/**
 * The pipeline opened (or found) the PR for an issue: link it with source
 * `created` to every non-archived agent conversation for that issue, so they
 * show it without waiting for a sweep. A link that is already `created`, or
 * that the operator dismissed, is left alone. Emits one event per conversation
 * that changed and returns their names. Never throws: a failed link must not
 * fail the PR creation.
 */
export function linkCreatedPullRequestToIssueConversations(issueId: string, url: string | undefined): string[] {
  try {
    const ref = url ? parsePullRequestRef(url) : null;
    if (!ref) return [];
    const names = getOverdeckDatabase()
      .prepare(`SELECT name FROM conversations WHERE lower(issue_id) = lower(?) AND archived_at IS NULL`)
      .all<{ name: string }>(issueId)
      .map((row) => row.name)
      .filter(isAgentConversationName);
    const linked: string[] = [];
    for (const name of names) {
      const before = findLink(name, ref);
      if (before && (before.source === 'created' || before.dismissedAt !== null)) continue;
      if (!linkConversationPullRequest(name, ref, 'created')) continue;
      linked.push(name);
      emitConversationPullRequestsChanged(name);
    }
    if (linked.length > 0) {
      console.log(`[pr-link] linked #${ref.number} to ${linked.length} conversation(s) for ${issueId}`);
    }
    return linked;
  } catch (error) {
    console.warn(`[pr-link] linking the PR for ${issueId} failed:`, error);
    return [];
  }
}

/** Reverse index: the conversations with a live (non-dismissed) link to this PR. */
export function listConversationsLinkedToPullRequest(key: PullRequestKey): PullRequestLinkedConversation[] {
  return getOverdeckDatabase()
    .prepare(`
      SELECT c.rowid AS id, c.name, c.title, l.source, l.linked_at
      FROM conversation_pull_requests l
      JOIN conversations c ON c.id = l.conversation_id
      WHERE l.host = ? AND l.repository = ? AND l.number = ? AND l.dismissed_at IS NULL
      ORDER BY l.linked_at
    `)
    .all<{ id: number; name: string; title: string | null; source: string; linked_at: number }>(key.host, key.repository, key.number)
    .map((row) => ({
      id: row.id,
      name: row.name,
      title: row.title,
      source: row.source as PullRequestLinkSource,
      linkedAt: new Date(row.linked_at).toISOString(),
    }));
}

export interface PullRequestLinkRow extends PullRequestLink {
  readonly conversationId: number;
  readonly conversationName: string;
  readonly conversationTitle: string | null;
  readonly conversationCwd: string;
  readonly conversationProjectKey: string | null;
}

/**
 * Every live link across conversations, newest first, optionally narrowed to
 * one snapshot state (`open` also matches links not synced yet).
 */
export function listAllPullRequestLinks(filter: { state?: PullRequestState } = {}): PullRequestLinkRow[] {
  const rows = getOverdeckDatabase()
    .prepare(`
      SELECT c.name AS conversation_name, c.rowid AS conversation_rowid, c.title AS conversation_title,
             c.cwd AS conversation_cwd, c.project_key AS conversation_project_key,
             l.host, l.repository, l.number, l.url, l.source, l.linked_at, l.dismissed_at, l.snapshot_json
      FROM conversation_pull_requests l
      JOIN conversations c ON c.id = l.conversation_id
      WHERE l.dismissed_at IS NULL
      ORDER BY l.linked_at DESC
    `)
    .all<LinkRow & {
      conversation_rowid: number;
      conversation_title: string | null;
      conversation_cwd: string;
      conversation_project_key: string | null;
    }>();
  return rows
    .map((row) => ({
      ...rowToLink(row),
      conversationId: row.conversation_rowid,
      conversationName: row.conversation_name,
      conversationTitle: row.conversation_title,
      conversationCwd: row.conversation_cwd,
      conversationProjectKey: row.conversation_project_key,
    }))
    .filter((link) => !filter.state || (link.snapshot?.state ?? 'open') === filter.state);
}

function findLink(conversationName: string, key: PullRequestKey): PullRequestLink | null {
  const row = getOverdeckDatabase()
    .prepare(`${LINK_SELECT} WHERE c.name = ? AND l.host = ? AND l.repository = ? AND l.number = ?`)
    .get<LinkRow>(conversationName, key.host, key.repository, key.number);
  return row ? rowToLink(row) : null;
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
