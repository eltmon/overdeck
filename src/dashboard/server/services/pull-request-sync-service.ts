/**
 * Pull-request sync sweep (PAN-3822).
 *
 * Links pull requests to conversations by branch and keeps each link's status
 * snapshot fresh, with no dashboard client open:
 *
 *   1. Load every non-archived conversation and group it by registered project.
 *   2. Read each project's PR list ONCE per sweep (`listRepoPullRequests`,
 *      `gh pr list --state all`, cached 30 s).
 *   3. Branch detection: a PR whose head branch equals the conversation's branch
 *      (`resolveConversationBranch`; never the default branch) becomes a
 *      `branch` link. A dismissed row blocks re-insertion. A link whose PR drops
 *      out of the listing is never deleted (the listing is capped at 200).
 *   4. Snapshot refresh: every linked PR found in the listing gets a fresh
 *      snapshot; a write (and a `conversation.pull_requests_changed` event)
 *      happens only when the snapshot changed. Merged snapshots are final.
 *
 * Boot +30 s, then every 60 s. Timers are unref()'d; a sweep never overlaps the
 * previous one. GitHub projects only in this slice; GitLab projects are skipped.
 * Started only by a primary dashboard (a peer dashboard never writes).
 */

import type { PullRequestKey, PullRequestSnapshot } from '@overdeck/contracts';

import { withConcurrencyLimit } from '../../../lib/concurrency.js';
import { resolveConversationBranch } from '../../../lib/overdeck/conversation-branch.js';
import {
  emitConversationPullRequestsChanged,
  listConversationsForPullRequestSync,
  listPullRequestLinksForConversations,
  setPullRequestLinkSnapshot,
  upsertBranchPullRequestLink,
  type PullRequestSyncConversation,
} from '../../../lib/overdeck/conversation-pull-requests.js';
import {
  forgeForProject,
  listRepoPullRequests,
  toChecksState,
  toReviewState,
  type GhPrRow,
} from '../../../lib/overdeck/derived-issue-state.js';
import { getRepoTargetBranch } from '../../../lib/project-repos.js';
import { findProjectByPath, type ProjectConfig } from '../../../lib/projects.js';

export const PR_SYNC_BOOT_DELAY_MS = 30_000;
export const PR_SYNC_INTERVAL_MS = 60_000;
const BRANCH_READ_CONCURRENCY = 8;
const LOG_PREFIX = '[pr-sync]';

let bootTimer: ReturnType<typeof setTimeout> | null = null;
let intervalTimer: ReturnType<typeof setInterval> | null = null;
let running = false;
let stopped = false;

export interface PullRequestSyncResult {
  readonly inserted: number;
  readonly updated: number;
}

/** Key + canonical URL from a GitHub PR URL, or null for anything else. */
export function githubPullRequestKeyFromUrl(url: string): (PullRequestKey & { url: string }) | null {
  const match = /^https?:\/\/([^/]+)\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:[/?#].*)?$/i.exec(url.trim());
  if (!match) return null;
  const host = match[1]!.toLowerCase();
  const repository = `${match[2]}/${match[3]}`.toLowerCase();
  const number = Number(match[4]);
  return { host, repository, number, url: `https://${host}/${repository}/pull/${number}` };
}

/** One `gh pr list` row → the stored snapshot. */
export function snapshotFromGhRow(row: GhPrRow, syncedAt: string): PullRequestSnapshot {
  const upperState = (row.state ?? '').toUpperCase();
  const state = row.mergedAt || upperState === 'MERGED' ? 'merged' : upperState === 'CLOSED' ? 'closed' : 'open';
  return {
    state,
    isDraft: row.isDraft === true,
    title: row.title ?? '',
    headBranch: row.headRefName ?? null,
    baseBranch: row.baseRefName ?? null,
    reviewState: toReviewState(row.reviewDecision, (row.reviewRequests?.length ?? 0) > 0),
    checks: toChecksState(row.statusCheckRollup),
    mergeable: row.mergeable === 'MERGEABLE' ? true : row.mergeable === 'CONFLICTING' ? false : null,
    additions: null,
    deletions: null,
    changedFiles: null,
    author: row.author?.login ?? null,
    updatedAt: row.updatedAt ?? null,
    mergedAt: row.mergedAt ?? null,
    closedAt: row.closedAt ?? null,
    syncedAt,
  };
}

function keyString(key: PullRequestKey): string {
  return `${key.host}/${key.repository}#${key.number}`;
}

async function syncProject(
  project: ProjectConfig,
  conversations: readonly PullRequestSyncConversation[],
  syncedAt: string,
  changedNames: Set<string>,
): Promise<PullRequestSyncResult> {
  const rows = await listRepoPullRequests(project.path);
  if (rows.length === 0) return { inserted: 0, updated: 0 };

  const byKey = new Map<string, { key: PullRequestKey & { url: string }; row: GhPrRow }>();
  const byHead = new Map<string, Array<{ key: PullRequestKey & { url: string }; row: GhPrRow }>>();
  for (const row of rows) {
    const key = row.url ? githubPullRequestKeyFromUrl(row.url) : null;
    if (!key) continue;
    const entry = { key, row };
    byKey.set(keyString(key), entry);
    if (row.headRefName) {
      const list = byHead.get(row.headRefName) ?? [];
      list.push(entry);
      byHead.set(row.headRefName, list);
    }
  }

  // Branch detection.
  const defaultBranch = getRepoTargetBranch(undefined, project);
  const branches = await withConcurrencyLimit(
    conversations.map((conversation) => () => resolveConversationBranch(conversation, defaultBranch)),
    BRANCH_READ_CONCURRENCY,
  );
  let inserted = 0;
  conversations.forEach((conversation, index) => {
    const branch = branches[index];
    if (!branch) return;
    for (const { key, row } of byHead.get(branch) ?? []) {
      if (upsertBranchPullRequestLink(conversation.id, key, snapshotFromGhRow(row, syncedAt))) {
        inserted += 1;
        changedNames.add(conversation.name);
      }
    }
  });

  // Snapshot refresh — one write pass per distinct linked PR in the listing.
  const links = listPullRequestLinksForConversations(conversations.map((conversation) => conversation.name));
  const refreshed = new Set<string>();
  let updated = 0;
  for (const conversationLinks of links.values()) {
    for (const link of conversationLinks) {
      const id = keyString(link);
      if (refreshed.has(id)) continue;
      refreshed.add(id);
      if (link.snapshot?.state === 'merged') continue;
      const entry = byKey.get(id);
      if (!entry) continue;
      const changed = setPullRequestLinkSnapshot(link, snapshotFromGhRow(entry.row, syncedAt));
      updated += changed.length;
      for (const name of changed) changedNames.add(name);
    }
  }
  return { inserted, updated };
}

/** One full sweep. Exported for tests and for a future forced refresh. */
export async function runPullRequestSyncOnce(now: number = Date.now()): Promise<PullRequestSyncResult> {
  const syncedAt = new Date(now).toISOString();
  const groups = new Map<string, { project: ProjectConfig; conversations: PullRequestSyncConversation[] }>();
  for (const conversation of listConversationsForPullRequestSync()) {
    const project = findProjectByPath(conversation.cwd);
    if (!project || forgeForProject(project.path) !== 'github') continue;
    const group = groups.get(project.path) ?? { project, conversations: [] };
    group.conversations.push(conversation);
    groups.set(project.path, group);
  }

  const changedNames = new Set<string>();
  let inserted = 0;
  let updated = 0;
  for (const { project, conversations } of groups.values()) {
    try {
      const result = await syncProject(project, conversations, syncedAt, changedNames);
      inserted += result.inserted;
      updated += result.updated;
    } catch (error) {
      console.warn(`${LOG_PREFIX} sweep failed for ${project.path}:`, error);
    }
  }
  for (const name of changedNames) emitConversationPullRequestsChanged(name);
  return { inserted, updated };
}

async function runGuarded(trigger: string): Promise<void> {
  if (running || stopped) return;
  running = true;
  try {
    const result = await runPullRequestSyncOnce();
    if (result.inserted > 0 || result.updated > 0) {
      console.log(`${LOG_PREFIX} ${trigger} sweep: ${result.inserted} linked, ${result.updated} refreshed`);
    }
  } catch (error) {
    console.warn(`${LOG_PREFIX} ${trigger} sweep failed:`, error);
  } finally {
    running = false;
  }
}

export function startPullRequestSyncService(): void {
  if (bootTimer !== null || intervalTimer !== null) return;
  stopped = false;
  bootTimer = setTimeout(() => {
    bootTimer = null;
    void runGuarded('boot');
    intervalTimer = setInterval(() => {
      void runGuarded('interval');
    }, PR_SYNC_INTERVAL_MS);
    if (typeof intervalTimer.unref === 'function') intervalTimer.unref();
  }, PR_SYNC_BOOT_DELAY_MS);
  if (typeof bootTimer.unref === 'function') bootTimer.unref();
}

export function stopPullRequestSyncService(): void {
  if (bootTimer !== null) {
    clearTimeout(bootTimer);
    bootTimer = null;
  }
  if (intervalTimer !== null) {
    clearInterval(intervalTimer);
    intervalTimer = null;
  }
  stopped = true;
}
