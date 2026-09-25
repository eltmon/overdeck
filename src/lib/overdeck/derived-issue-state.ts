/**
 * Derived issue state (PAN-3917 FR-6).
 *
 * ONE implementation, shared by the CLI (`pan show`) and the dashboard server.
 * It lives in `lib/` because both import from here; the server service is a
 * thin adapter that feeds it the facts it already has cached.
 *
 * Overdeck stores no status it can derive. An issue's pipeline position is
 * computed here, at read time, from the owners of the underlying facts:
 *
 *   - the tracker owns the issue (open/closed, labels)
 *   - the plan home owns the spec (`<planHome>/.pan/specs/`)
 *   - the terminal backend owns pane liveness (its own `list()` inventory)
 *   - git owns the feature branch
 *   - the forge owns the PR, its review state, its checks, and mergeability
 *
 * Nothing here writes anything back.
 *
 * ## The FR-6 table
 *
 * | State             | Rule                                                            |
 * | ----------------- | --------------------------------------------------------------- |
 * | backlog           | issue open, no spec file                                          |
 * | parked            | tracker label `parked`, or listed in `.pan/parked.md`             |
 * | planned           | spec file exists                                                  |
 * | working           | a live pane whose `issue` token is this issue, or feature branch ahead of main with no PR |
 * | in-review         | PR open (any review state but changes-requested), or a reviewer pane live |
 * | changes-requested | latest PR review state is `CHANGES_REQUESTED`                     |
 * | ready             | PR approved, checks green, `mergeable` true                       |
 * | merged            | PR merged                                                         |
 * | closed            | issue closed                                                      |
 *
 * The rows overlap — an open issue can have a spec, a live pane, and an
 * approved PR all at once — so they resolve in one fixed precedence, highest
 * first (`ISSUE_STATE_PRECEDENCE` in `@overdeck/contracts`):
 *
 *   closed > merged > ready > changes-requested > in-review > working >
 *   parked > planned > backlog
 *
 * That precedence is what makes the W1 parked note work: an open PR with a
 * review requested or checks pending lands on `in-review`, which outranks
 * `parked`, so the pipeline owning the next move is never reported as parked.
 *
 * ## Attention
 *
 * Orthogonal to the state, and resolved in its own precedence:
 * `needs-you` > `api-error` > `stuck`. A blocked pane is a question addressed
 * to the operator and outranks an inferred stall.
 */

import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type {
  BackendPane,
  DerivedBranchState,
  DerivedIssueState,
  DerivedPrState,
  IssueAttention,
  IssueState,
  PrChecksState,
  PrReviewState,
} from '@overdeck/contracts';

import { isUnsupported } from '../terminal-backends/types.js';
import type { BackendAgentSnapshot, TerminalBackend } from '../terminal-backends/types.js';
import { createSettledTtlPromiseCache } from '../concurrency.js';
import { getProjectPanPaths } from '../pan-dir/paths.js';
import { findSpecByIssue } from '../xbrief/io.js';
import { findProjectByPath, resolveProjectFromIssueSync } from '../projects.js';
import { inferProjectForge } from '../project-repos.js';
import { cachedApprovalAtHead } from '../cloister/approval-at-head.js';

const execFileAsync = promisify(execFile);

/** How long a repo's PR listing is served before the forge is read again. */
export const PR_CACHE_TTL_MS = 30_000;

/**
 * How old a settled PR listing may be and still answer a board read while a
 * refresh runs behind it (PAN-3925). One `gh pr list --state all` with
 * `statusCheckRollup` takes ~11s on a busy repo, so a hard TTL expiry made
 * every read after it wait for the forge.
 */
export const PR_LISTING_MAX_STALE_MS = 2 * 60_000;

/** Idle for this long with unpushed commits is `stuck`. */
export const DEFAULT_STUCK_AFTER_MS = 20 * 60_000;

/** Pane text that means the provider, not the agent, is the problem. */
const API_ERROR_PATTERNS = [
  /\b429\b/,
  /rate.?limit/i,
  /overloaded_error/i,
  /api error/i,
  /provider (?:error|failure)/i,
  /upstream connect error/i,
];

// ─── the snapshot the pure function reads ────────────────────────────────────

/**
 * Every fact `deriveIssueState` needs, already extracted. The loader below
 * fills one of these; tests construct one directly.
 */
export interface IssueStateFacts {
  readonly issueId: string;
  /**
   * Tracker state. A closed issue is `closed` whatever else is true. `null`
   * means no tracker answered — never the same thing as open, so the closed
   * row simply cannot be claimed and the answer says so (`trackerUnknown`).
   */
  readonly issueOpen: boolean | null;
  /** Tracker labels, lower-cased by the loader. */
  readonly labels: readonly string[];
  /** The issue appears in `<planHome>/.pan/parked.md`. */
  readonly parkedListed: boolean;
  /** `<planHome>/.pan/specs/*<ISSUE>*.xbrief.json` exists on main or the feature branch. */
  readonly specExists: boolean;
  /** Live panes carrying this issue's token, from the terminal backend. */
  readonly panes: readonly BackendPane[];
  readonly branch?: DerivedBranchState;
  readonly pr?: DerivedPrState;
  /**
   * #4066 review: the merge gate's approval answer for the PR's current head
   * (`approvalProvenAtHead`, cached per head by the gate). Only `true`
   * derives `ready`; unknown never does.
   */
  readonly prApprovedAtHead?: boolean;
  /** The PR merged. Carried separately: a merged PR reports no review state. */
  readonly prMerged: boolean;
  /** A pane printed provider-failure text (429, overloaded, upstream error). */
  readonly apiError: boolean;
  readonly now: number;
  /** Override for `DEFAULT_STUCK_AFTER_MS`. */
  readonly stuckAfterMs?: number;
}

// ─── the pure function ───────────────────────────────────────────────────────

function isLive(pane: BackendPane): boolean {
  return pane.state !== 'exited' && pane.state !== 'done';
}

function deriveState(facts: IssueStateFacts): IssueState {
  if (facts.issueOpen === false) return 'closed';
  if (facts.prMerged) return 'merged';

  const pr = facts.pr;
  const livePanes = facts.panes.filter(isLive);

  if (pr) {
    // #4066 review: `ready` is the merge gate's own approval rule, read from
    // the gate's cached answer for this head, never the forge's
    // `reviewDecision` (empty without branch protection, and stale on a push).
    if (
      facts.prApprovedAtHead === true && pr.reviewState !== 'changes-requested'
      && pr.checks === 'green' && pr.mergeable === true
    ) {
      return 'ready';
    }
    if (pr.reviewState === 'changes-requested') return 'changes-requested';
    // Any other open PR is in review. GitHub reports no review decision when
    // branch protection does not require one, or once a reviewer is removed —
    // the issue is still the pipeline's move, never parked (the W1 note).
    return 'in-review';
  }
  if (livePanes.some((pane) => pane.role === 'review' || pane.role === 'test' || pane.role === 'uat')) {
    return 'in-review';
  }

  if (livePanes.length > 0) return 'working';
  if (facts.branch && facts.branch.aheadOfMain > 0) return 'working';

  if (facts.labels.includes('parked') || facts.parkedListed) return 'parked';
  if (facts.specExists) return 'planned';
  return 'backlog';
}

function deriveAttention(facts: IssueStateFacts): IssueAttention | undefined {
  const livePanes = facts.panes.filter(isLive);

  // An unanswered AskUserQuestion or a permission prompt: the backend reports
  // the pane as `blocked`.
  if (livePanes.some((pane) => pane.state === 'blocked')) return 'needs-you';

  if (facts.apiError) return 'api-error';

  const stuckAfterMs = facts.stuckAfterMs ?? DEFAULT_STUCK_AFTER_MS;
  const unpushedWork = facts.branch !== undefined
    && facts.branch.aheadOfMain > 0
    && !facts.branch.pushed;
  if (!unpushedWork) return undefined;
  const idled = livePanes.some((pane) => (
    pane.state === 'idle'
    && pane.stateSince !== undefined
    && facts.now - pane.stateSince > stuckAfterMs
  ));
  return idled ? 'stuck' : undefined;
}

/** The FR-6 table, as a pure function over an extracted snapshot. */
export function deriveIssueState(facts: IssueStateFacts): DerivedIssueState {
  const attention = deriveAttention(facts);
  const derived: { -readonly [K in keyof DerivedIssueState]: DerivedIssueState[K] } = {
    issueId: facts.issueId,
    state: deriveState(facts),
  };
  if (attention) derived.attention = attention;
  if (facts.issueOpen === null) derived.trackerUnknown = true;
  if (facts.pr) derived.pr = facts.pr;
  if (facts.branch) derived.branch = facts.branch;
  return derived;
}

// ─── the async loader ────────────────────────────────────────────────────────

export interface IssueStateLoaderDeps {
  readonly now?: () => number;
  readonly panes?: readonly BackendPane[];
  /**
   * The tracker row, when the caller already holds it (the dashboard reads it
   * from its issue cache). Without it, `readIssue` runs — by default the
   * configured trackers themselves.
   */
  readonly issue?: TrackerIssueFacts;
  /** Read the tracker row. `null` means no tracker answered, NOT "open". */
  readonly readIssue?: (issueId: string) => Promise<TrackerIssueFacts | null>;
  readonly readPr?: (issueId: string, projectPath: string, branch: string) => Promise<LoadedPr | null>;
  readonly readBranch?: (projectPath: string, branch: string) => Promise<DerivedBranchState | null>;
  readonly readPaneText?: (pane: BackendPane) => Promise<string>;
  readonly stuckAfterMs?: number;
  /**
   * #4066 review: the merge gate's approval answer for an issue's PR at a head;
   * `cachedApprovalAtHead` (no forge read) by default.
   */
  readonly approvalAtHead?: (issueId: string, headSha: string | null | undefined) => boolean | undefined;
}

/** The tracker's answer for one issue. */
export interface TrackerIssueFacts {
  readonly open: boolean;
  readonly labels: readonly string[];
  /** The tracker's title, when the read carried one. */
  readonly title?: string;
}

/** What a forge read returns: the PR facts plus whether it merged. */
export interface LoadedPr extends DerivedPrState {
  readonly merged: boolean;
  /** The PR's head commit, which the approval answer is keyed by. */
  readonly headSha?: string | null;
}

function featureBranchFor(issueId: string): string {
  return `feature/${issueId.toLowerCase()}`;
}

/** `gh pr view` review decision → the contract's review state. */
export function toReviewState(reviewDecision: string | null | undefined, reviewRequested: boolean): PrReviewState {
  switch ((reviewDecision ?? '').toUpperCase()) {
    case 'APPROVED': return 'approved';
    case 'CHANGES_REQUESTED': return 'changes-requested';
    case 'REVIEW_REQUIRED': return 'review-requested';
    case 'COMMENTED': return 'commented';
    default: return reviewRequested ? 'review-requested' : 'none';
  }
}

/** `statusCheckRollup` rows → the aggregate check state. */
export function toChecksState(
  rollup: ReadonlyArray<{ status?: string; conclusion?: string | null }> | undefined,
): PrChecksState {
  const rows = rollup ?? [];
  if (rows.length === 0) return 'pending';
  if (rows.some((row) => row.conclusion && !['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(row.conclusion.toUpperCase()))) {
    return 'red';
  }
  if (rows.some((row) => row.status && row.status.toUpperCase() !== 'COMPLETED')) return 'pending';
  return 'green';
}

export interface GhPrRow {
  number?: number;
  url?: string;
  state?: string;
  mergedAt?: string | null;
  mergeable?: string;
  reviewDecision?: string | null;
  reviewRequests?: unknown[];
  statusCheckRollup?: Array<{ status?: string; conclusion?: string | null }>;
  title?: string;
  headRefName?: string;
  isDraft?: boolean;
  baseRefName?: string;
  updatedAt?: string | null;
  closedAt?: string | null;
  author?: { login?: string } | null;
  headRefOid?: string | null;
}

const GH_PR_FIELDS = 'number,url,title,state,mergedAt,mergeable,headRefName,headRefOid,baseRefName,isDraft,reviewDecision,reviewRequests,statusCheckRollup,updatedAt,closedAt,author';

/** One `gh pr list` per repo, cached briefly — the batch door's forge read. */
const cachedRepoPullRequests = createSettledTtlPromiseCache<string, readonly GhPrRow[] | null>(PR_CACHE_TTL_MS);

/** The last listing each repo answered successfully, and when (PAN-3925). */
const lastRepoPullRequests = new Map<string, { readonly rows: readonly GhPrRow[]; readonly settledAt: number }>();

/** The repo's PR listing; empty when the read failed. */
export async function listRepoPullRequests(projectPath: string): Promise<readonly GhPrRow[]> {
  return (await readRepoPullRequests(projectPath)) ?? [];
}

/**
 * The repo's PR listing, or null when the read failed (rate limit, auth,
 * network), so a caller that backs off can tell "failed" from "no PRs".
 */
export async function readRepoPullRequests(projectPath: string): Promise<readonly GhPrRow[] | null> {
  return cachedRepoPullRequests(projectPath, async () => {
    try {
      const { stdout } = await execFileAsync('gh', [
        'pr', 'list', '--state', 'all', '--limit', '200', '--json', GH_PR_FIELDS,
      ], { cwd: projectPath, encoding: 'utf-8', timeout: 20_000 });
      const rows = JSON.parse(stdout || '[]') as GhPrRow[];
      lastRepoPullRequests.set(projectPath, { rows, settledAt: Date.now() });
      return rows;
    } catch {
      return null;
    }
  });
}

/**
 * The repo's PR listing for board reads: stale-while-revalidate over
 * `listRepoPullRequests` (PAN-3925). Inside the TTL this is the cached
 * listing. Past it, the last good listing answers at once while one refresh
 * runs behind it, until that listing is older than `maxStaleMs`; then the read
 * waits for the forge. A failed refresh keeps serving the last good listing
 * inside that bound instead of an empty one. Gates that act on readiness keep
 * `listRepoPullRequests`.
 */
export async function listRepoPullRequestsStaleOk(
  projectPath: string,
  maxStaleMs: number = PR_LISTING_MAX_STALE_MS,
): Promise<readonly GhPrRow[]> {
  const fresh = listRepoPullRequests(projectPath);
  const last = lastRepoPullRequests.get(projectPath);
  if (!last || Date.now() - last.settledAt > maxStaleMs) return fresh;
  return last.rows;
}

/** A `gh` row → the PR facts, or null when the PR is closed without merging. */
export function prFromGhRow(row: GhPrRow): LoadedPr | null {
  if (typeof row.number !== 'number') return null;
  const merged = Boolean(row.mergedAt);
  // A closed-unmerged PR is not this issue's PR any more: reporting it would
  // pin the issue at `in-review` forever.
  if (!merged && (row.state ?? '').toUpperCase() !== 'OPEN') return null;
  return {
    url: row.url ?? '',
    number: row.number,
    reviewState: toReviewState(row.reviewDecision, (row.reviewRequests?.length ?? 0) > 0),
    checks: toChecksState(row.statusCheckRollup),
    mergeable: row.mergeable === 'MERGEABLE' ? true : row.mergeable === 'CONFLICTING' ? false : null,
    merged,
    headSha: row.headRefOid ?? null,
  };
}

async function readPrWithGh(_issueId: string, projectPath: string, branch: string): Promise<LoadedPr | null> {
  const rows = await listRepoPullRequests(projectPath);
  const row = rows.find((candidate) => candidate.headRefName === branch);
  return row ? prFromGhRow(row) : null;
}

// ─── GitLab ──────────────────────────────────────────────────────────────────

interface GlabMrRow {
  iid?: number;
  web_url?: string;
  state?: string;
  source_branch?: string;
  draft?: boolean;
  detailed_merge_status?: string;
  merge_status?: string;
  has_conflicts?: boolean;
  head_pipeline?: { status?: string } | null;
  approvals_required?: number;
  approved?: boolean;
  sha?: string;
}

const cachedRepoMergeRequests = createSettledTtlPromiseCache<string, readonly GlabMrRow[]>(PR_CACHE_TTL_MS);

/** GitLab pipeline status → the aggregate check state. */
export function toChecksStateFromPipeline(status: string | undefined): PrChecksState {
  switch ((status ?? '').toLowerCase()) {
    case 'success': case 'manual': case 'skipped': return 'green';
    case 'failed': case 'canceled': return 'red';
    default: return 'pending';
  }
}

export function mrFromGlabRow(row: GlabMrRow): LoadedPr | null {
  if (typeof row.iid !== 'number') return null;
  const state = (row.state ?? '').toLowerCase();
  const merged = state === 'merged';
  if (!merged && state !== 'opened') return null;
  const glabMergeability = (row.detailed_merge_status ?? row.merge_status ?? '').toLowerCase();
  return {
    url: row.web_url ?? '',
    number: row.iid,
    reviewState: row.approved ? 'approved' : (row.approvals_required ?? 0) > 0 ? 'review-requested' : 'none',
    checks: toChecksStateFromPipeline(row.head_pipeline?.status),
    mergeable: row.has_conflicts === true ? false
      : glabMergeability === 'mergeable' || glabMergeability === 'can_be_merged' ? true
      : glabMergeability ? false : null,
    merged,
    headSha: row.sha ?? null,
  };
}

async function listRepoMergeRequests(projectPath: string): Promise<readonly GlabMrRow[]> {
  return cachedRepoMergeRequests(projectPath, async () => {
    try {
      const { stdout } = await execFileAsync('glab', [
        'api', 'projects/:id/merge_requests?state=all&per_page=100',
      ], { cwd: projectPath, encoding: 'utf-8', timeout: 20_000, maxBuffer: 16 * 1024 * 1024 });
      return JSON.parse(stdout || '[]') as GlabMrRow[];
    } catch {
      return [];
    }
  });
}

async function readMrWithGlab(_issueId: string, projectPath: string, branch: string): Promise<LoadedPr | null> {
  const rows = await listRepoMergeRequests(projectPath);
  const row = rows.find((candidate) => candidate.source_branch === branch);
  return row ? mrFromGlabRow(row) : null;
}

/**
 * GitHub or GitLab, from the project's REPO configuration — never its tracker.
 * MYN's tracker is Linear while its forge is GitLab, so reading `tracker` here
 * would send every MIN issue down the `gh` path and derive it as `working`
 * forever. `inferProjectForgeSync` is the canonical resolver.
 */
export function forgeForProject(projectPath: string): 'github' | 'gitlab' {
  const project = findProjectByPath(projectPath);
  if (!project) return 'github';
  return inferProjectForge(project) ?? 'github';
}

function forgeReader(projectPath: string) {
  return forgeForProject(projectPath) === 'gitlab' ? readMrWithGlab : readPrWithGh;
}

async function readBranchWithGit(projectPath: string, branch: string): Promise<DerivedBranchState | null> {
  const run = async (args: string[]): Promise<string | null> => {
    try {
      const { stdout } = await execFileAsync('git', args, { cwd: projectPath, encoding: 'utf-8', timeout: 15_000 });
      return stdout.trim();
    } catch {
      return null;
    }
  };
  const ahead = await run(['rev-list', '--count', `origin/main..${branch}`]);
  if (ahead === null) return null;
  const remote = await run(['rev-parse', '--verify', `origin/${branch}`]);
  const local = await run(['rev-parse', '--verify', branch]);
  return {
    name: branch,
    aheadOfMain: Number.parseInt(ahead, 10) || 0,
    pushed: remote !== null && local !== null && remote === local,
  };
}

/**
 * Every local `feature/*` branch at once, for the batch door: two
 * `git for-each-ref` invocations total instead of up to three git spawns per
 * issue (PAN-3969).
 *
 * `aheadOfMain` is only ever tested as `> 0` (`deriveState`, `deriveAttention`),
 * so membership in `--no-merged=origin/main` is enough — a branch whose tip is
 * reachable from `origin/main` has zero commits ahead, and one whose tip is
 * not has at least one. Members report 1, non-members 0.
 *
 * A branch absent from the map yields `null` from the caller, exactly as
 * `readBranchWithGit` returns `null` when its `rev-list` fails. A failed
 * listing (not a git repo, no `origin/main`) degrades the same way: the empty
 * map, so every issue reads as branch-less rather than crashing the batch.
 */
async function readFeatureBranchesWithGit(projectPath: string): Promise<Map<string, DerivedBranchState>> {
  const run = async (args: string[]): Promise<string | null> => {
    try {
      const { stdout } = await execFileAsync('git', args, { cwd: projectPath, encoding: 'utf-8', timeout: 15_000 });
      return stdout;
    } catch {
      return null;
    }
  };
  const [refsOut, aheadOut] = await Promise.all([
    run(['for-each-ref', '--format=%(objectname) %(refname:short)', 'refs/heads/feature/', 'refs/remotes/origin/feature/']),
    run(['for-each-ref', '--format=%(refname:short)', '--no-merged=origin/main', 'refs/heads/feature/']),
  ]);
  const branches = new Map<string, DerivedBranchState>();
  // `rev-list origin/main..<branch>` fails per issue when `origin/main` is
  // missing, so the per-issue reader reports null for every branch; mirror
  // that here by treating a failed listing as "no branches".
  if (refsOut === null || aheadOut === null) return branches;
  const localSha = new Map<string, string>();
  const remoteSha = new Map<string, string>();
  for (const line of refsOut.split('\n')) {
    const match = /^([0-9a-f]{40}) (\S+)$/.exec(line.trim());
    if (!match) continue;
    const [, sha, ref] = match as unknown as [string, string, string];
    if (ref.startsWith('origin/')) remoteSha.set(ref.slice('origin/'.length), sha);
    else localSha.set(ref, sha);
  }
  const ahead = new Set(
    aheadOut.split('\n').map((line) => line.trim()).filter((line) => line.length > 0),
  );
  for (const [name, local] of localSha) {
    const remote = remoteSha.get(name) ?? null;
    branches.set(name, {
      name,
      aheadOfMain: ahead.has(name) ? 1 : 0,
      pushed: remote !== null && remote === local,
    });
  }
  return branches;
}

/**
 * `<planHome>/.pan/specs/` holds the issue's spec once it is planned. The
 * filename is whatever planning wrote — `PAN-1.xbrief.json`, or the dated
 * `2026-07-28-PAN-1-title.xbrief.json` — so the shared resolver reads the
 * directory rather than guessing two names. Both plan homes are checked: the
 * issue workspace's, where the planning agent writes, and the main checkout's,
 * where the promoted spec lands, so an absent workspace is not "no spec".
 */
export function specExistsFor(issueId: string, projectPath: string): boolean {
  const workspace = join(projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`);
  return [projectPath, workspace].some((root) => {
    if (findSpecByIssue(root, issueId) !== null) return true;
    const { specsDir } = getProjectPanPaths(root);
    return existsSync(join(specsDir, `${issueId.toLowerCase()}.xbrief.json`))
      || existsSync(join(specsDir, `${issueId.toUpperCase()}.xbrief.json`));
  });
}

/** `<planHome>/.pan/parked.md` is the operator's parked list. */
export function parkedListedIn(issueId: string, projectPath: string): boolean {
  const { panDir } = getProjectPanPaths(projectPath);
  try {
    const text = readFileSync(join(panDir, 'parked.md'), 'utf-8');
    return new RegExp(`\\b${issueId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text);
  } catch {
    return false;
  }
}

function paneLooksLikeApiError(text: string): boolean {
  return API_ERROR_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * The tail of a pane's output, for the `api-error` attention state.
 *
 * Only the tmux fallback can answer today: a tmux pane id IS its session name,
 * so `capture-pane` reads it directly. A Herdr pane needs the adapter's
 * `observe` stream — until then a Herdr pane reports no text and `api-error`
 * simply does not fire for it.
 */
async function readTmuxPaneText(pane: BackendPane): Promise<string> {
  // Only the tmux fallback writes the session name into BOTH `id` and
  // `terminalId`; a Herdr pane's terminalId is its own handle. Matching on the
  // id's shape would shell out to `capture-pane` for a Herdr pane whose
  // adapter happened to reuse a session-like name.
  if (pane.terminalId !== pane.id) return '';
  try {
    const { capturePane } = await import('../tmux.js');
    return await capturePane(pane.id, 40);
  } catch {
    return '';
  }
}

/**
 * One backend snapshot as the dashboard read model carries it. The pane's
 * `stateSince` is remembered across refreshes — a pane that has not changed
 * state keeps the moment it entered it, or nothing could ever look `stuck`.
 */
export function paneFromBackendSnapshot(
  snapshot: BackendAgentSnapshot,
  now: number,
  previous?: BackendPane,
): BackendPane {
  const tokens = snapshot.tokens;
  const pane: { -readonly [K in keyof BackendPane]: BackendPane[K] } = {
    id: snapshot.paneId,
    role: tokens.role ?? 'work',
    harness: tokens.harness ?? 'unknown',
    model: tokens.model ?? 'unknown',
    state: snapshot.state,
    stateSince: previous && previous.state === snapshot.state && previous.stateSince !== undefined
      ? previous.stateSince
      : now,
    terminalId: snapshot.terminalId,
  };
  if (tokens.issue) pane.issue = tokens.issue;
  if (snapshot.agentId) pane.agentId = snapshot.agentId;
  if (snapshot.cwd) pane.workspace = snapshot.cwd;
  return pane;
}

/**
 * Pane liveness from the selected terminal backend's own inventory (D10). The
 * dashboard passes its cached inventory instead; this is what the CLI uses.
 */
async function listPanesWithBackend(now: number): Promise<readonly BackendPane[]> {
  const { Effect } = await import('effect');
  const { resolveLaunchBackend } = await import('../terminal-backends/launch.js');

  const read = async (backend: TerminalBackend): Promise<readonly BackendPane[] | null> => {
    const snapshots = await Effect.runPromise(
      backend.list().pipe(Effect.catch(() => Effect.succeed(null))),
    );
    if (snapshots === null || isUnsupported(snapshots)) return null;
    return snapshots.map((snapshot) => paneFromBackendSnapshot(snapshot, now));
  };

  try {
    const backend = await resolveLaunchBackend();
    const panes = await read(backend);
    if (panes) return panes;
    // PAN-3956 D8: a Herdr host never reads tmux as a fallback inventory —
    // an unreadable Herdr is "no panes known", not whatever tmux happens to hold.
    return [];
  } catch {
    return [];
  }
}

/**
 * The tracker row, from whichever configured tracker knows this issue —
 * GitHub, Linear, GitLab or Rally, in the order the config lists them. `null`
 * when none of them answered: unknown, never "open".
 */
export async function readIssueFromTracker(issueId: string): Promise<TrackerIssueFacts | null> {
  const { loadConfigSync } = await import('../config.js');
  const { createTracker, createTrackerFromConfig } = await import('../tracker/factory.js');
  const { resolveGitHubIssue } = await import('../tracker-utils.js');
  const { Effect } = await import('effect');

  let trackers;
  try {
    trackers = loadConfigSync().trackers;
  } catch {
    return null;
  }
  if (!trackers) return null;

  // A GitHub tracker is configured with ONE owner/repo, but an issue id names
  // its repo through its prefix (PAN-, TIN-, …). Reading `PAN-1` against the
  // configured repo would answer about a different issue entirely.
  const gh = resolveGitHubIssue(issueId);

  const order = [trackers.primary, ...(trackers.secondary ? [trackers.secondary] : [])];
  for (const type of order) {
    try {
      if (type === 'github' && !gh.isGitHub) continue;
      const tracker = type === 'github' && gh.isGitHub
        ? createTracker({ ...trackers.github, type: 'github', owner: gh.owner, repo: gh.repo })
        : createTrackerFromConfig(trackers, type);
      const issue = await Effect.runPromise(tracker.getIssue(issueId));
      return { open: issue.state !== 'closed', labels: issue.labels ?? [], ...(issue.title ? { title: issue.title } : {}) };
    } catch {
      // This tracker does not know the issue (or could not be reached); the
      // next one may.
    }
  }
  return null;
}

/**
 * The single async loader: one pass over the owners, producing the snapshot
 * `deriveIssueState` reads. Every IO is injectable so tests stay offline.
 */
export async function loadIssueStateFacts(
  issueId: string,
  deps: IssueStateLoaderDeps = {},
): Promise<IssueStateFacts> {
  const now = (deps.now ?? Date.now)();
  const project = resolveProjectFromIssueSync(issueId);
  const projectPath = project?.projectPath ?? process.cwd();
  const branchName = featureBranchFor(issueId);

  const panes = deps.panes
    ?? (await listPanesWithBackend(now)).filter((pane) => pane.issue === issueId.toUpperCase());

  const issue = deps.issue ?? await (deps.readIssue ?? readIssueFromTracker)(issueId);
  const branch = await (deps.readBranch ?? readBranchWithGit)(projectPath, branchName);
  const pr = await (deps.readPr ?? forgeReader(projectPath))(issueId, projectPath, branchName);

  const readPaneText = deps.readPaneText ?? readTmuxPaneText;
  let apiError = false;
  for (const pane of panes) {
    if (pane.state === 'exited') continue;
    if (paneLooksLikeApiError(await readPaneText(pane))) { apiError = true; break; }
  }

  const facts: IssueStateFacts = {
    issueId: issueId.toUpperCase(),
    // No tracker answer is `null` — unknown — and never a silent "open".
    issueOpen: issue ? issue.open : null,
    labels: (issue?.labels ?? []).map((label) => label.toLowerCase()),
    parkedListed: parkedListedIn(issueId, projectPath),
    specExists: specExistsFor(issueId, projectPath),
    panes,
    prMerged: pr?.merged ?? false,
    apiError,
    now,
    ...(branch ? { branch } : {}),
    ...(pr ? { pr: { url: pr.url, number: pr.number, reviewState: pr.reviewState, checks: pr.checks, mergeable: pr.mergeable } } : {}),
    ...(pr && !pr.merged ? { prApprovedAtHead: (deps.approvalAtHead ?? cachedApprovalAtHead)(issueId, pr.headSha) === true } : {}),
    ...(deps.stuckAfterMs !== undefined ? { stuckAfterMs: deps.stuckAfterMs } : {}),
  };
  return facts;
}

/** Load and derive in one call. The read door every route uses. */
export async function getDerivedIssueState(
  issueId: string,
  deps: IssueStateLoaderDeps = {},
): Promise<DerivedIssueState> {
  return deriveIssueState(await loadIssueStateFacts(issueId, deps));
}

// ─── the ready set (FR-9) ────────────────────────────────────────────────────

/** One issue whose PR is ready to merge: approved, green, and mergeable. */
export interface ReadyIssue {
  readonly issueId: string;
  readonly title: string;
  readonly pr?: number;
}

/** `feature/pan-3917` → `PAN-3917`. Anything else has no issue. */
export function issueIdFromBranch(branch: string | undefined): string | null {
  const match = /^feature\/([a-z]+-\d+)$/i.exec(branch ?? '');
  return match?.[1] ? match[1].toUpperCase() : null;
}

/**
 * The project's ready set, from the same cached repo listing the batch door
 * uses. Readiness is approvals plus green checks plus forge mergeability, and
 * nothing else (FR-9, D3).
 */
export async function listReadyIssuesForProject(
  projectPath: string,
  deps: { readonly listPullRequests?: (projectPath: string) => Promise<readonly GhPrRow[]> } = {},
): Promise<ReadyIssue[]> {
  const rows = await (deps.listPullRequests ?? listRepoPullRequests)(projectPath);
  const ready: ReadyIssue[] = [];
  for (const row of rows) {
    if (row.isDraft) continue;
    const issueId = issueIdFromBranch(row.headRefName);
    if (!issueId) continue;
    const pr = prFromGhRow(row);
    if (!pr || pr.merged) continue;
    // #4066 review: this is the UAT train's candidate set, which is mostly
    // issues held for UAT. The auto-merge scheduler never runs the gate for a
    // held issue, so the gate's cached answer would empty the train; it keeps
    // the forge's own decision. It merges nothing: every merge asks the gate.
    if (pr.reviewState !== 'approved' || pr.checks !== 'green' || pr.mergeable !== true) continue;
    ready.push({ issueId, title: row.title ?? issueId, pr: pr.number });
  }
  return ready;
}

// ─── the batch door ──────────────────────────────────────────────────────────

/**
 * Derive many issues at once. One forge listing per repo (cached), one backend
 * inventory read, a spec `existsSync` per issue, and a git read only for the
 * issues that have no PR — that row is the only one needing `aheadOfMain`.
 *
 * Every board-shaped route uses this. Calling `getDerivedIssueState` in a loop
 * would issue one `gh` and two `git` invocations per issue.
 */
export async function loadIssueStatesForProject(
  projectPath: string,
  issueIds: readonly string[],
  deps: IssueStateLoaderDeps & {
    /**
     * The tracker rows the caller already holds, by upper-cased issue id. A
     * missing (or `null`) entry is unknown — never assumed open.
     */
    readonly issues?: Readonly<Record<string, TrackerIssueFacts | null>>;
    /** The repo's PR listing; `listRepoPullRequests` when omitted. */
    readonly listPullRequests?: (projectPath: string) => Promise<readonly GhPrRow[]>;
  } = {},
): Promise<Map<string, DerivedIssueState>> {
  const now = (deps.now ?? Date.now)();
  const gitlab = forgeForProject(projectPath) === 'gitlab';
  const rows = gitlab ? [] : await (deps.listPullRequests ?? listRepoPullRequests)(projectPath);
  const prByIssue = new Map<string, LoadedPr>();
  if (!gitlab) {
    for (const row of rows) {
      const issueId = issueIdFromBranch(row.headRefName);
      const pr = issueId ? prFromGhRow(row) : null;
      if (issueId && pr) prByIssue.set(issueId, pr);
    }
  }

  const panes = deps.panes ?? await listPanesWithBackend(now);
  const approvalAtHead = deps.approvalAtHead ?? cachedApprovalAtHead;
  const out = new Map<string, DerivedIssueState>();

  // PAN-3969: the default branch read is one batched `for-each-ref` pair for
  // the whole project, kicked off on the first branch-less issue (a batch
  // where every issue has a PR never touches git). The `deps.readBranch` seam
  // keeps its per-issue behavior for the tests that inject it.
  let branchMapPromise: Promise<Map<string, DerivedBranchState>> | null = null;
  const readBranchBatched = (_projectPath: string, branch: string): Promise<DerivedBranchState | null> => {
    branchMapPromise ??= readFeatureBranchesWithGit(projectPath);
    return branchMapPromise.then((branches) => branches.get(branch) ?? null);
  };

  for (const raw of issueIds) {
    const issueId = raw.toUpperCase();
    const pr = prByIssue.get(issueId)
      ?? (gitlab ? await (deps.readPr ?? forgeReader(projectPath))(issueId, projectPath, featureBranchFor(issueId)) : null);
    const branch = pr
      ? null
      : await (deps.readBranch ?? readBranchBatched)(projectPath, featureBranchFor(issueId));

    const issue = deps.issues?.[issueId] ?? null;
    const facts: IssueStateFacts = {
      issueId,
      issueOpen: issue ? issue.open : null,
      labels: (issue?.labels ?? []).map((label) => label.toLowerCase()),
      parkedListed: parkedListedIn(issueId, projectPath),
      specExists: specExistsFor(issueId, projectPath),
      panes: panes.filter((pane) => pane.issue === issueId),
      prMerged: pr?.merged ?? false,
      apiError: false,
      now,
      ...(branch ? { branch } : {}),
      ...(pr ? { pr: { url: pr.url, number: pr.number, reviewState: pr.reviewState, checks: pr.checks, mergeable: pr.mergeable } } : {}),
      ...(pr && !pr.merged ? { prApprovedAtHead: approvalAtHead(issueId, pr.headSha) === true } : {}),
      ...(deps.stuckAfterMs !== undefined ? { stuckAfterMs: deps.stuckAfterMs } : {}),
    };
    out.set(issueId, deriveIssueState(facts));
  }
  return out;
}
