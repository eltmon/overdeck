/**
 * What one conversation changed (PAN-5288 WI-5, PRD §6.8): the
 * `ConversationChanges` that `GET /api/conversations/:name/changes` serves.
 *
 * One full result per conversation (scope `conversation`) holds its commits
 * (conversation-change-commits.ts) and uncommitted edits
 * (conversation-change-uncommitted.ts); scopes `turn` and `uncommitted`
 * filter it. Scope `main` lists today's first-parent commits on `HEAD` with
 * who made them (project-changes.ts).
 *
 * Results are cached for 30 s while the transcript size and mtime and `HEAD`
 * are unchanged (A-D15). Every full computation also writes the totals map
 * that backs `changeTotals` on list rows.
 *
 * This module never imports conversation-reads.ts (A-D2): callers pass
 * {@link ConversationChangesDependencies}, which keeps the list service free
 * of an import cycle and lets tests inject parse results.
 */
import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { promisify } from 'node:util';

import type {
  ChangeCommit,
  ChangeScope,
  ConversationChangeTotals,
  ConversationChanges,
  UncommittedFile,
} from '@overdeck/contracts';

import { listCommitFilesAt } from '../git/attributed-commits.js';
import { localDayStartIso } from '../costs/request-digest.js';
import { listProjectsAsync } from '../projects.js';
import { listConversationCommits, listLocalShas } from './conversation-change-commits.js';
import { listUncommittedFiles } from './conversation-change-uncommitted.js';
import {
  lookupConversation,
  repoRootForDir,
  type ConversationDiffParseResult,
} from './conversation-diffs.js';
import type { LegacyConversation as Conversation } from './conversations.js';
import { byForAttribution, listBranchCommits } from './project-changes.js';

const execFileAsync = promisify(execFile);

export interface ConversationChangesDependencies {
  resolveSessionFile(conv: Conversation): Promise<string | null>;
  getCachedMessages(sessionFile: string, isSpecialist: boolean): Promise<ConversationDiffParseResult>;
  peekCachedMessages(sessionFile: string): ConversationDiffParseResult | null;
  /** Candidates for otherConversations; defaults to listConversations() in production. */
  listConversations(): Conversation[];
  /** Injectable clock for tests; production passes Date.now. */
  now(): number;
}

type ChangesResult = { status: number; body: ConversationChanges | { error: string } };

const SCOPES: ReadonlySet<string> = new Set<ChangeScope>(['conversation', 'turn', 'uncommitted', 'main']);
const CACHE_MAX = 64;
const CACHE_TTL_MS = 30_000;
const SINCE_MARGIN_MS = 10 * 60_000;
const OTHERS_MAX = 50;
const OTHERS_ENDED_WINDOW_MS = 7 * 24 * 60 * 60_000;
const MAIN_MAX_COMMITS = 200;
const TURN_PREFIX = 'conv-turn-';

interface CacheEntry {
  size: number;
  mtimeMs: number;
  head: string;
  at: number;
  body: ConversationChanges;
  /** Full shas tied to the conversation only by tool output (scope `main` needs them). */
  toolOutputOnly: Set<string>;
  /** Assistant message ids in time order, for the default turn. */
  turnOrder: string[];
}

const cache = new Map<string, CacheEntry>();
const totalsMap = new Map<string, { totals: ConversationChangeTotals; at: number }>();

function remember(key: string, entry: CacheEntry): void {
  cache.delete(key);
  cache.set(key, entry);
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

function underPath(path: string, root: string): boolean {
  const base = root.replace(/\/+$/, '');
  return path === base || path.startsWith(`${base}/`);
}

async function gitOut(repoRoot: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', repoRoot, ...args], { encoding: 'utf8' });
    return stdout.trim();
  } catch {
    return null;
  }
}

/** The tree root a conversation belongs to, from what the server knows (A-D10). */
export function rootIdForConversationRow(
  conv: Pick<Conversation, 'origin' | 'issueId' | 'workspaceId' | 'cwd'>,
  projects: Array<{ key: string; config: { path: string } }>,
): string | null {
  if (conv.origin === 'vault') return null;
  if (conv.issueId) return `issue:${conv.issueId.toUpperCase()}`;
  if (conv.workspaceId) return null;
  const project = [...projects]
    .sort((a, b) => b.config.path.length - a.config.path.length)
    .find((p) => underPath(conv.cwd, p.config.path));
  if (!project) return null;
  const workspaces = `${project.config.path.replace(/\/+$/, '')}/workspaces`;
  if (underPath(conv.cwd, workspaces)) {
    const dir = conv.cwd.slice(workspaces.length + 1).split('/')[0] ?? '';
    return dir.startsWith('feature-') && dir.length > 'feature-'.length
      ? `issue:${dir.slice('feature-'.length).toUpperCase()}`
      : null;
  }
  return `project:${project.key}`;
}

function totalsOf(commits: ChangeCommit[], uncommitted: UncommittedFile[]): ConversationChanges['totals'] {
  const paths = new Set<string>();
  let additions = 0;
  let deletions = 0;
  for (const file of [...commits.flatMap((c) => c.files), ...uncommitted]) {
    paths.add(file.path);
    additions += file.additions;
    deletions += file.deletions;
  }
  return {
    files: paths.size,
    additions,
    deletions,
    commitsPushed: commits.filter((c) => c.pushed).length,
    commitsLocal: commits.filter((c) => !c.pushed).length,
    uncommittedFiles: uncommitted.length,
  };
}

/** A-D3: 10 minutes before the earliest of the row's start and the transcript's first record. */
function sinceFor(conv: Conversation, parsed: ConversationDiffParseResult | null): string {
  let earliest = Date.parse(conv.createdAt);
  for (const item of [...(parsed?.messages ?? []), ...(parsed?.workLog ?? [])]) {
    const ms = Date.parse(item.createdAt);
    if (Number.isFinite(ms) && (!Number.isFinite(earliest) || ms < earliest)) earliest = ms;
  }
  return new Date((Number.isFinite(earliest) ? earliest : 0) - SINCE_MARGIN_MS).toISOString();
}

function othersFor(conv: Conversation, repoRoot: string, deps: ConversationChangesDependencies) {
  return async (): Promise<Array<{ name: string; title: string; parsed: ConversationDiffParseResult }>> => {
    const now = deps.now();
    const candidates = deps.listConversations()
      .filter((c) => c.name !== conv.name && underPath(c.cwd, repoRoot))
      .filter((c) => c.endedAt === null || now - Date.parse(c.endedAt) <= OTHERS_ENDED_WINDOW_MS)
      .slice(0, OTHERS_MAX);
    const others: Array<{ name: string; title: string; parsed: ConversationDiffParseResult }> = [];
    for (const candidate of candidates) {
      const file = await deps.resolveSessionFile(candidate);
      // Cache only: a cold transcript is never parsed to name another conversation (D-5).
      const parsed = file ? deps.peekCachedMessages(file) : null;
      if (parsed) others.push({ name: candidate.name, title: candidate.title ?? candidate.name, parsed });
    }
    return others;
  };
}

async function fileStamp(sessionFile: string | null): Promise<{ size: number; mtimeMs: number }> {
  if (!sessionFile) return { size: -1, mtimeMs: -1 };
  try {
    const info = await stat(sessionFile);
    return { size: info.size, mtimeMs: info.mtimeMs };
  } catch {
    return { size: -1, mtimeMs: -1 };
  }
}

async function fullResult(
  conv: Conversation,
  repoRoot: string,
  deps: ConversationChangesDependencies,
): Promise<CacheEntry> {
  const sessionFile = await deps.resolveSessionFile(conv);
  const stamp = await fileStamp(sessionFile);
  const head = (await gitOut(repoRoot, ['rev-parse', 'HEAD'])) ?? '';
  const now = deps.now();
  const cached = cache.get(conv.name);
  if (cached && cached.size === stamp.size && cached.mtimeMs === stamp.mtimeMs && cached.head === head && now - cached.at < CACHE_TTL_MS) {
    return cached;
  }

  const parsed = sessionFile && stamp.size >= 0
    ? await deps.getCachedMessages(sessionFile, false).catch(() => null)
    : null;
  const { commits, toolOutputOnly } = await listConversationCommits({
    repoRoot,
    sessionName: conv.tmuxSession,
    since: sinceFor(conv, parsed),
    parsed,
  });
  const uncommitted = parsed
    ? await listUncommittedFiles({ repoRoot, cwd: conv.cwd, parsed, others: othersFor(conv, repoRoot, deps) })
    : [];
  const abbrev = await gitOut(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const body: ConversationChanges = {
    conversation: conv.name,
    repoRoot,
    rootId: rootIdForConversationRow(conv, await listProjectsAsync()),
    branch: abbrev && abbrev !== 'HEAD' ? abbrev : null,
    scope: 'conversation',
    uncommitted,
    commits,
    totals: totalsOf(commits, uncommitted),
  };
  const turnOrder = [...(parsed?.messages ?? [])]
    .filter((m) => m.role === 'assistant')
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    .map((m) => m.id);
  const entry: CacheEntry = { ...stamp, head, at: now, body, toolOutputOnly, turnOrder };
  remember(conv.name, entry);
  const { files, additions, deletions, uncommittedFiles, commitsLocal } = body.totals;
  totalsMap.set(conv.name, { totals: { files, additions, deletions, uncommittedFiles, commitsLocal }, at: now });
  return entry;
}

function turnResult(entry: CacheEntry, requested: string | undefined): ConversationChanges {
  const { body } = entry;
  let turnId = requested?.startsWith(TURN_PREFIX) ? requested.slice(TURN_PREFIX.length) : requested;
  if (!turnId) {
    // Default: the last turn (in transcript order) that has a commit or an uncommitted file.
    const touched = new Set([
      ...body.commits.flatMap((c) => (c.turnId ? [c.turnId] : [])),
      ...body.uncommitted.flatMap((f) => f.turnIds),
    ]);
    const rank = (id: string): number => entry.turnOrder.indexOf(id);
    turnId = [...touched].sort((a, b) => rank(a) - rank(b)).pop();
  }
  const commits = turnId ? body.commits.filter((c) => c.turnId === turnId) : [];
  const uncommitted = turnId ? body.uncommitted.filter((f) => f.turnIds.includes(turnId)) : [];
  return {
    ...body,
    scope: 'turn',
    ...(turnId ? { turnId } : {}),
    commits,
    uncommitted,
    totals: totalsOf(commits, uncommitted),
  };
}

async function mainResult(conv: Conversation, repoRoot: string, entry: CacheEntry, deps: ConversationChangesDependencies): Promise<ConversationChanges> {
  const key = `${conv.name}\0main`;
  const now = deps.now();
  const cached = cache.get(key);
  if (cached && cached.head === entry.head && now - cached.at < CACHE_TTL_MS) return cached.body;

  const own = new Map(entry.body.commits.map((c) => [c.sha, c]));
  const local = await listLocalShas(repoRoot);
  const commits: ChangeCommit[] = [];
  for (const commit of await listBranchCommits(repoRoot, 'HEAD', localDayStartIso(now), MAIN_MAX_COMMITS)) {
    const toolOutputOnly = entry.toolOutputOnly.has(commit.sha);
    const isThisConversation =
      own.has(commit.sha) ||
      (commit.attribution?.source === 'conversation' && commit.attribution.value === conv.tmuxSession);
    const turnId = own.get(commit.sha)?.turnId;
    commits.push({
      sha: commit.sha,
      shortSha: commit.sha.slice(0, 7),
      subject: commit.subject,
      authoredAt: commit.authoredAt,
      pushed: local.hasUpstream && !local.shas.has(commit.sha),
      attribution: toolOutputOnly ? 'tool-output' : 'trailer',
      files: await listCommitFilesAt(repoRoot, commit.sha),
      ...(turnId ? { turnId } : {}),
      by: toolOutputOnly
        ? { kind: 'conversation', id: conv.name, title: conv.title ?? conv.name, isThisConversation: true }
        : { ...byForAttribution(commit.attribution), isThisConversation },
    });
  }
  const body: ConversationChanges = { ...entry.body, scope: 'main', commits, uncommitted: [], totals: totalsOf(commits, []) };
  remember(key, { ...entry, at: now, body });
  return body;
}

/** `GET /api/conversations/:name/changes` (FR-1, FR-4, FR-5). */
export async function getConversationChanges(
  name: string,
  opts: { scope: ChangeScope; turnId?: string },
  deps: ConversationChangesDependencies,
): Promise<ChangesResult> {
  const conv = lookupConversation(name);
  if (!conv) return { status: 404, body: { error: 'Conversation not found' } };
  if (!SCOPES.has(opts.scope)) return { status: 400, body: { error: 'Invalid scope' } };

  const repoRoot = await repoRootForDir(conv.cwd);
  if (!repoRoot) {
    // A-D9: a cwd outside any repository has nothing to report.
    return {
      status: 200,
      body: {
        conversation: conv.name,
        repoRoot: conv.cwd,
        rootId: rootIdForConversationRow(conv, await listProjectsAsync()),
        branch: null,
        scope: opts.scope,
        uncommitted: [],
        commits: [],
        totals: totalsOf([], []),
      },
    };
  }

  const entry = await fullResult(conv, repoRoot, deps);
  switch (opts.scope) {
    case 'conversation':
      return { status: 200, body: entry.body };
    case 'turn':
      return { status: 200, body: turnResult(entry, opts.turnId) };
    case 'uncommitted': {
      const uncommitted = entry.body.uncommitted;
      return { status: 200, body: { ...entry.body, scope: 'uncommitted', commits: [], totals: totalsOf([], uncommitted) } };
    }
    default:
      return { status: 200, body: await mainResult(conv, repoRoot, entry, deps) };
  }
}

/** The latest totals computed for `name`, or null; never computes (A-D16). */
export function getChangeTotals(name: string): { totals: ConversationChangeTotals; at: number } | null {
  return totalsMap.get(name) ?? null;
}

// ─── changeTotals on list rows (WI-7, A-D16) ──────────────────────────────────

const ACTIVE_WINDOW_MS = 24 * 60 * 60_000;
const BACKGROUND_MAX_RUNNING = 2;
const BACKGROUND_MAX_SCHEDULED_PER_CALL = 20;

const backgroundQueue: Array<{ name: string; compute: (name: string) => Promise<unknown> }> = [];
const backgroundPending = new Set<string>();
let backgroundRunning = 0;
let idleWaiters: Array<() => void> = [];

function pumpBackground(): void {
  while (backgroundRunning < BACKGROUND_MAX_RUNNING && backgroundQueue.length > 0) {
    const job = backgroundQueue.shift()!;
    backgroundRunning++;
    let run: Promise<unknown>;
    try {
      run = job.compute(job.name);
    } catch (error) {
      run = Promise.reject(error);
    }
    void run
      .catch((error: unknown) => {
        console.warn(`[conversation-changes] background totals for ${job.name} failed:`, error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        backgroundRunning--;
        backgroundPending.delete(job.name);
        pumpBackground();
        if (backgroundRunning === 0 && backgroundQueue.length === 0) {
          const waiters = idleWaiters;
          idleWaiters = [];
          for (const resolve of waiters) resolve();
        }
      });
  }
}

function activityMs(row: { lastActivityAt?: unknown; lastAttachedAt?: unknown; createdAt?: unknown }): number {
  for (const value of [row.lastActivityAt, row.lastAttachedAt, row.createdAt]) {
    if (typeof value === 'string' && value !== '') return Date.parse(value);
  }
  return Number.NaN;
}

/**
 * Copies of `rows` with `changeTotals` from the totals map for rows active
 * in the last 24 h. Never computes in the caller's path: rows whose entry is
 * missing or older than 30 s are queued for a background computation (at
 * most 2 running, at most 20 queued per call, deduplicated by name). Input
 * rows are never mutated, and Session Vault copies are skipped.
 */
export function stampChangeTotals<T extends { name: string; origin?: unknown; lastActivityAt?: unknown; lastAttachedAt?: unknown; createdAt?: unknown }>(
  rows: readonly T[],
  deps: ConversationChangesDependencies,
  compute: (name: string) => Promise<unknown> = (name) => getConversationChanges(name, { scope: 'conversation' }, deps),
): Array<T & { changeTotals?: ConversationChangeTotals }> {
  const now = deps.now();
  let scheduled = 0;
  const stamped = rows.map((row): T & { changeTotals?: ConversationChangeTotals } => {
    if (row.origin === 'vault') return row;
    const activity = activityMs(row);
    if (!Number.isFinite(activity) || now - activity > ACTIVE_WINDOW_MS) return row;
    const entry = totalsMap.get(row.name);
    if ((!entry || now - entry.at >= CACHE_TTL_MS) && !backgroundPending.has(row.name) && scheduled < BACKGROUND_MAX_SCHEDULED_PER_CALL) {
      backgroundPending.add(row.name);
      backgroundQueue.push({ name: row.name, compute });
      scheduled++;
    }
    return entry ? { ...row, changeTotals: entry.totals } : row;
  });
  if (scheduled > 0) pumpBackground();
  return stamped;
}

/** Resolves when no background totals computation is queued or running. */
export function whenChangeTotalsIdle(): Promise<void> {
  if (backgroundRunning === 0 && backgroundQueue.length === 0) return Promise.resolve();
  return new Promise((resolve) => idleWaiters.push(resolve));
}

export function resetConversationChangesCachesForTests(): void {
  cache.clear();
  totalsMap.clear();
}
