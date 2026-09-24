/**
 * Pull-request sync sweep (PAN-3822).
 *
 * Links pull requests to conversations by branch and keeps each link's status
 * snapshot fresh, with no dashboard client open:
 *
 *   1. Load every non-archived conversation and group it by registered project.
 *   2. Read each project's PR list ONCE per sweep (`readRepoPullRequests`,
 *      `gh pr list --state all`, cached 30 s), and only when the project has a
 *      conversation with a branch to detect or a link due for refresh. A failed
 *      listing (a rate limit included) counts toward the same 3-strike backoff
 *      as the fallback reads and leaves that project's links for a later sweep.
 *   3. Branch detection: a PR whose head branch equals the conversation's branch
 *      (`resolveConversationBranch`; never the default branch) becomes a
 *      `branch` link. A dismissed row blocks re-insertion. A link whose PR drops
 *      out of the listing is never deleted (the listing is capped at 200).
 *   4. Snapshot refresh of every due linked PR: never synced or open → every
 *      sweep; closed → the 15-minute slow lane; merged → never (final).
 *      Dismissed links are not refreshed. A write (and a
 *      `conversation.pull_requests_changed` event) happens only when the
 *      snapshot changed.
 *   5. Fallback: a due linked GitHub PR no listing covered (beyond the 200-row
 *      cap, another repository, or a conversation outside every GitHub
 *      project) gets one `gh pr view`. Three failed reads in a row skip that
 *      repository for 15 minutes.
 *
 * Boot +30 s, then every 60 s. Timers are unref()'d; a sweep never overlaps the
 * previous one. GitHub only; GitLab projects and MR links are skipped.
 * Started only by a primary dashboard (a peer dashboard never writes).
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { Effect } from 'effect';
import type { PullRequestKey, PullRequestLink, PullRequestSnapshot } from '@overdeck/contracts';

import { withConcurrencyLimit } from '../../../lib/concurrency.js';
import { resolveConversationBranch } from '../../../lib/overdeck/conversation-branch.js';
import {
  archiveConversation,
  getConversationByName,
  isAgentConversationName,
} from '../../../lib/overdeck/conversations.js';
import { isConversationsAutoArchiveOnMerge } from '../../../lib/overdeck/control-settings.js';
import {
  emitConversationPullRequestsChanged,
  listConversationPullRequests,
  listConversationsForPullRequestSync,
  listPullRequestLinksForConversations,
  setPullRequestLinkSnapshot,
  upsertBranchPullRequestLink,
  type PullRequestSyncConversation,
} from '../../../lib/overdeck/conversation-pull-requests.js';
import {
  forgeForProject,
  readRepoPullRequests,
  toChecksState,
  toReviewState,
  type GhPrRow,
} from '../../../lib/overdeck/derived-issue-state.js';
import { getRepoTargetBranch } from '../../../lib/project-repos.js';
import { findProjectByPath, type ProjectConfig } from '../../../lib/projects.js';
import { listSessionNames } from '../../../lib/tmux.js';

export const PR_SYNC_BOOT_DELAY_MS = 30_000;
export const PR_SYNC_INTERVAL_MS = 60_000;
/** Closed PRs are re-read at most this often; also the per-repo backoff window. */
export const PR_SYNC_SLOW_INTERVAL_MS = 15 * 60_000;
/** Consecutive failed reads (a project listing, or `gh pr view` per repository) before it is skipped. */
export const PR_SYNC_FAILURE_THRESHOLD = 3;
const BRANCH_READ_CONCURRENCY = 8;
const LOG_PREFIX = '[pr-sync]';

const execFileAsync = promisify(execFile);
const GH_PR_VIEW_FIELDS = 'number,url,title,state,mergedAt,mergeable,headRefName,baseRefName,isDraft,reviewDecision,reviewRequests,statusCheckRollup,updatedAt,closedAt,author';

let bootTimer: ReturnType<typeof setTimeout> | null = null;
let intervalTimer: ReturnType<typeof setInterval> | null = null;
let running = false;
let stopped = false;
// In-memory sweep bookkeeping (cleared on stop; a restart just re-reads once).
/** PR key → when this process last read it from the forge (ms). */
const lastReadAt = new Map<string, number>();
/** `host/owner/repo` (`gh pr view`) or project path (listing) → consecutive failed reads and the backoff deadline. */
const repoFailures = new Map<string, { count: number; skipUntil: number }>();

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

/** One sweep's shared bookkeeping. */
interface SweepContext {
  readonly now: number;
  readonly syncedAt: string;
  readonly changedNames: Set<string>;
  /** PR keys already handled this sweep (refreshed, or not due). */
  readonly handled: Set<string>;
  /** Conversations with a link that went from open to merged/closed this sweep. */
  readonly settled: Set<string>;
}

/**
 * Whether a link's snapshot should be re-read this sweep: never synced →
 * yes; open → every sweep; closed → the slow lane (15 min since this process
 * last read it, or since its stored `syncedAt`); merged → never. Dismissed
 * links are not refreshed.
 */
function isDue(link: PullRequestLink, now: number): boolean {
  if (link.dismissedAt !== null) return false;
  const snapshot = link.snapshot;
  if (snapshot === null) return true;
  if (snapshot.state === 'merged') return false;
  if (snapshot.state === 'open') return true;
  const lastRead = lastReadAt.get(keyString(link)) ?? (Date.parse(snapshot.syncedAt) || 0);
  return now - lastRead >= PR_SYNC_SLOW_INTERVAL_MS;
}

function applySnapshot(link: PullRequestLink, row: GhPrRow, ctx: SweepContext): number {
  lastReadAt.set(keyString(link), ctx.now);
  const snapshot = snapshotFromGhRow(row, ctx.syncedAt);
  const changed = setPullRequestLinkSnapshot(link, snapshot);
  // Only an observed open → merged/closed transition counts (a first read of an
  // already-settled PR does not), so auto-archive can't fire on a fresh link.
  const settledNow = snapshot.state !== 'open' && link.snapshot?.state === 'open';
  for (const name of changed) {
    ctx.changedNames.add(name);
    if (settledNow) ctx.settled.add(name);
  }
  return changed.length;
}

/**
 * `conversations.auto_archive_on_merge` (default off): archive an operator
 * conversation whose PR just settled when every live link is now merged or
 * closed and no terminal session is alive. Acting only on the transition makes
 * it happen at most once, so an operator who unarchives is left alone. Agent
 * conversations belong to the pipeline and are never archived here; nothing is
 * ever stopped.
 */
async function autoArchiveSettledConversations(
  ctx: SweepContext,
  listLiveSessions: () => Promise<readonly string[]>,
): Promise<string[]> {
  const candidates = [...ctx.settled].filter((name) => !isAgentConversationName(name));
  if (candidates.length === 0 || !isConversationsAutoArchiveOnMerge()) return [];
  const live = new Set(await listLiveSessions());
  const archived: string[] = [];
  for (const name of candidates) {
    const conversation = getConversationByName(name);
    if (!conversation || conversation.archivedAt || live.has(conversation.tmuxSession)) continue;
    const links = listConversationPullRequests(name).filter((link) => link.dismissedAt === null);
    if (links.length === 0 || links.some((link) => link.snapshot?.state !== 'merged' && link.snapshot?.state !== 'closed')) continue;
    archiveConversation(name);
    archived.push(name);
  }
  if (archived.length > 0) console.log(`${LOG_PREFIX} auto-archived ${archived.length} conversation(s) whose PRs settled`);
  return archived;
}

async function syncProject(
  project: ProjectConfig,
  conversations: readonly PullRequestSyncConversation[],
  ctx: SweepContext,
): Promise<PullRequestSyncResult> {
  const defaultBranch = getRepoTargetBranch(undefined, project);
  const branches = await withConcurrencyLimit(
    conversations.map((conversation) => () => resolveConversationBranch(conversation, defaultBranch)),
    BRANCH_READ_CONCURRENCY,
  );
  const links = listPullRequestLinksForConversations(conversations.map((conversation) => conversation.name));
  const linkList = [...links.values()].flat();
  // Nothing to detect and nothing due: skip the forge read entirely.
  if (!branches.some(Boolean) && !linkList.some((link) => isDue(link, ctx.now))) return { inserted: 0, updated: 0 };

  // A failed or backed-off listing leaves this project's links for the next
  // sweep instead of cascading into one `gh pr view` each (same forge, same
  // rate limit).
  const skipLinks = (): PullRequestSyncResult => {
    for (const link of linkList) ctx.handled.add(keyString(link));
    return { inserted: 0, updated: 0 };
  };
  if (repoInBackoff(project.path, ctx.now)) return skipLinks();
  const rows = await readRepoPullRequests(project.path);
  if (rows === null) {
    recordRepoFailure(project.path, ctx.now);
    return skipLinks();
  }
  repoFailures.delete(project.path);
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
  let inserted = 0;
  conversations.forEach((conversation, index) => {
    const branch = branches[index];
    if (!branch) return;
    for (const { key, row } of byHead.get(branch) ?? []) {
      if (upsertBranchPullRequestLink(conversation.id, key, snapshotFromGhRow(row, ctx.syncedAt))) {
        inserted += 1;
        lastReadAt.set(keyString(key), ctx.now);
        ctx.changedNames.add(conversation.name);
      }
    }
  });

  // Snapshot refresh from the listing — one write pass per distinct due PR.
  // PRs not in the listing are left for the `gh pr view` fallback pass.
  // Re-read: branch detection may have just inserted links.
  const refreshed = listPullRequestLinksForConversations(conversations.map((conversation) => conversation.name));
  let updated = 0;
  for (const conversationLinks of refreshed.values()) {
    for (const link of conversationLinks) {
      const id = keyString(link);
      const entry = byKey.get(id);
      if (!entry || ctx.handled.has(id)) continue;
      ctx.handled.add(id);
      if (isDue(link, ctx.now)) updated += applySnapshot(link, entry.row, ctx);
    }
  }
  return { inserted, updated };
}

function repoInBackoff(repo: string, now: number): boolean {
  const failures = repoFailures.get(repo);
  return failures !== undefined && failures.skipUntil > now;
}

function recordRepoFailure(repo: string, now: number): void {
  const count = (repoFailures.get(repo)?.count ?? 0) + 1;
  const backingOff = count >= PR_SYNC_FAILURE_THRESHOLD;
  repoFailures.set(repo, { count: backingOff ? 0 : count, skipUntil: backingOff ? now + PR_SYNC_SLOW_INTERVAL_MS : 0 });
  if (backingOff) {
    console.warn(`${LOG_PREFIX} ${repo}: ${PR_SYNC_FAILURE_THRESHOLD} failed reads in a row; skipping it for 15 min`);
  }
}

/**
 * Fallback for linked GitHub PRs no project listing covered this sweep: PRs
 * beyond the 200-row listing, in another repository than the project's, or on
 * a conversation outside every GitHub project. One `gh pr view` per distinct
 * due PR, at most once per sweep. After 3 consecutive failed reads a
 * repository is skipped for 15 minutes.
 */
async function refreshUnlistedLinks(
  conversations: readonly PullRequestSyncConversation[],
  ctx: SweepContext,
  readPullRequest: (key: PullRequestKey) => Promise<GhPrRow | null>,
): Promise<number> {
  const links = listPullRequestLinksForConversations(conversations.map((conversation) => conversation.name));
  let updated = 0;
  for (const conversationLinks of links.values()) {
    for (const link of conversationLinks) {
      const id = keyString(link);
      if (ctx.handled.has(id) || !isDue(link, ctx.now) || !/\/pull\/\d+$/.test(link.url)) continue;
      ctx.handled.add(id);
      const repo = `${link.host}/${link.repository}`;
      if (repoInBackoff(repo, ctx.now)) continue;
      const row = await readPullRequest(link);
      if (!row) {
        recordRepoFailure(repo, ctx.now);
        continue;
      }
      repoFailures.delete(repo);
      updated += applySnapshot(link, row, ctx);
    }
  }
  return updated;
}

/** `gh pr view` for one PR by key; null when the read fails. */
async function readGithubPullRequest(key: PullRequestKey): Promise<GhPrRow | null> {
  try {
    const { stdout } = await execFileAsync('gh', [
      'pr', 'view', String(key.number), '--repo', `${key.host}/${key.repository}`, '--json', GH_PR_VIEW_FIELDS,
    ], { encoding: 'utf-8', timeout: 20_000 });
    return JSON.parse(stdout) as GhPrRow;
  } catch {
    return null;
  }
}

/**
 * Forced refresh right after an explicit link, outside the sweep schedule, so
 * the badge fills in within seconds, including PRs outside the 200-row listing.
 * GitHub PRs only; one `gh pr view`. Writes the snapshot and returns the
 * conversations whose link changed (no event: the caller emits).
 */
export async function refreshPullRequestLinkNow(
  link: PullRequestLink,
  readPullRequest: (key: PullRequestKey) => Promise<GhPrRow | null> = readGithubPullRequest,
  now: number = Date.now(),
): Promise<string[]> {
  if (!/\/pull\/\d+$/.test(link.url)) return [];
  const row = await readPullRequest(link);
  if (!row) return [];
  lastReadAt.set(keyString(link), now);
  return setPullRequestLinkSnapshot(link, snapshotFromGhRow(row, new Date(now).toISOString()));
}

/**
 * One full sweep. Exported for tests; `readPullRequest` is the `gh pr view`
 * fallback and `listLiveSessions` the terminal sessions auto-archive checks.
 */
export async function runPullRequestSyncOnce(
  now: number = Date.now(),
  readPullRequest: (key: PullRequestKey) => Promise<GhPrRow | null> = readGithubPullRequest,
  listLiveSessions: () => Promise<readonly string[]> = () => Effect.runPromise(listSessionNames()),
): Promise<PullRequestSyncResult> {
  const ctx: SweepContext = {
    now, syncedAt: new Date(now).toISOString(), changedNames: new Set(), handled: new Set(), settled: new Set(),
  };
  const conversations = listConversationsForPullRequestSync();
  const groups = new Map<string, { project: ProjectConfig; conversations: PullRequestSyncConversation[] }>();
  for (const conversation of conversations) {
    const project = findProjectByPath(conversation.cwd);
    if (!project || forgeForProject(project.path) !== 'github') continue;
    const group = groups.get(project.path) ?? { project, conversations: [] };
    group.conversations.push(conversation);
    groups.set(project.path, group);
  }

  let inserted = 0;
  let updated = 0;
  for (const { project, conversations: projectConversations } of groups.values()) {
    try {
      const result = await syncProject(project, projectConversations, ctx);
      inserted += result.inserted;
      updated += result.updated;
    } catch (error) {
      console.warn(`${LOG_PREFIX} sweep failed for ${project.path}:`, error);
    }
  }
  try {
    updated += await refreshUnlistedLinks(conversations, ctx, readPullRequest);
  } catch (error) {
    console.warn(`${LOG_PREFIX} fallback refresh failed:`, error);
  }
  try {
    await autoArchiveSettledConversations(ctx, listLiveSessions);
  } catch (error) {
    console.warn(`${LOG_PREFIX} auto-archive failed:`, error);
  }
  for (const name of ctx.changedNames) emitConversationPullRequestsChanged(name);
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
  lastReadAt.clear();
  repoFailures.clear();
}
