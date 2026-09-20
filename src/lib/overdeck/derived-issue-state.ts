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
import { findSpecByIssueSync } from '../xbrief/io.js';
import { findProjectByPathSync, resolveProjectFromIssueSync } from '../projects.js';
import { inferProjectForgeSync } from '../project-repos.js';

const execFileAsync = promisify(execFile);

/** How long a repo's PR listing is served before the forge is read again. */
export const PR_CACHE_TTL_MS = 30_000;

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
    if (pr.reviewState === 'approved' && pr.checks === 'green' && pr.mergeable === true) return 'ready';
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
}

/** The tracker's answer for one issue. */
export interface TrackerIssueFacts {
  readonly open: boolean;
  readonly labels: readonly string[];
}

/** What a forge read returns: the PR facts plus whether it merged. */
export interface LoadedPr extends DerivedPrState {
  readonly merged: boolean;
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

interface GhPrRow {
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
}

const GH_PR_FIELDS = 'number,url,title,state,mergedAt,mergeable,headRefName,isDraft,reviewDecision,reviewRequests,statusCheckRollup';

/** One `gh pr list` per repo, cached briefly — the batch door's forge read. */
const cachedRepoPullRequests = createSettledTtlPromiseCache<string, readonly GhPrRow[]>(PR_CACHE_TTL_MS);

export async function listRepoPullRequests(projectPath: string): Promise<readonly GhPrRow[]> {
  return cachedRepoPullRequests(projectPath, async () => {
    try {
      const { stdout } = await execFileAsync('gh', [
        'pr', 'list', '--state', 'all', '--limit', '200', '--json', GH_PR_FIELDS,
      ], { cwd: projectPath, encoding: 'utf-8', timeout: 20_000 });
      return JSON.parse(stdout || '[]') as GhPrRow[];
    } catch {
      return [];
    }
  });
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
  const project = findProjectByPathSync(projectPath);
  if (!project) return 'github';
  return inferProjectForgeSync(project) ?? 'github';
}

function forgeReader(projectPath: string) {
  return forgeForProject(projectPath) === 'gitlab' ? readMrWithGlab : readPrWithGh;
}

async function runGit(projectPath: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd: projectPath, encoding: 'utf-8', timeout: 15_000 });
    return stdout.trim();
  } catch {
    return null;
  }
}

/** Three git execs for ONE branch — the single-issue door's read. */
async function readBranchWithGit(projectPath: string, branch: string): Promise<DerivedBranchState | null> {
  const run = (args: string[]) => runGit(projectPath, args);
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

/** Every local feature branch of one repo, keyed by branch name (`feature/pan-1`). */
export type FeatureBranchMap = ReadonlyMap<string, DerivedBranchState>;

const FEATURE_REF_PREFIXES = ['refs/heads/feature/', 'refs/remotes/origin/feature/'];
const FOR_EACH_REF_OPTS = { encoding: 'utf-8', timeout: 15_000, maxBuffer: 16 * 1024 * 1024 } as const;

/**
 * One `git for-each-ref` per repo, in place of three execs per issue. Local
 * `refs/heads/feature/*` rows become entries; `refs/remotes/origin/feature/*`
 * rows only decide `pushed`. A remote-only branch derives no entry — parity
 * with `readBranchWithGit`, whose `rev-list origin/main..feature/x` fails when
 * no local ref exists. Any failure other than an old git means the project has
 * no branch facts (not a repo, no `origin/main`), which is an empty map.
 */
export async function listFeatureBranchesWithGit(projectPath: string): Promise<FeatureBranchMap> {
  const format = '%(refname) %(objectname) %(ahead-behind:origin/main)';
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(
      'git', ['for-each-ref', `--format=${format}`, ...FEATURE_REF_PREFIXES],
      { cwd: projectPath, ...FOR_EACH_REF_OPTS },
    ));
  } catch (error) {
    // Verified on git 2.43 (2026-09-19): an unsupported format atom prints
    // `fatal: unknown field name: <atom>`; a missing base prints
    // `fatal: failed to find 'origin/main'`. Only the first means "old git"
    // (`ahead-behind` needs ≥ 2.41); the second means there are no facts.
    const stderr = String((error as { stderr?: unknown }).stderr ?? '');
    if (!/unknown field name/.test(stderr)) return new Map();
    return listFeatureBranchesWithoutAheadBehind(projectPath);
  }
  return parseFeatureBranchRefs(stdout);
}

/**
 * Pure. `refs/heads/feature/x <sha> [<ahead> <behind>]` lines → the map. A
 * line without the ahead/behind columns (the fallback's plain listing) gets
 * `aheadOfMain: 0`, which the fallback overlays from `rev-list`.
 */
export function parseFeatureBranchRefs(stdout: string): FeatureBranchMap {
  const local = new Map<string, { sha: string; aheadOfMain: number }>();
  const remote = new Map<string, string>();
  for (const line of stdout.split('\n')) {
    const [ref, sha, ahead] = line.trim().split(/\s+/);
    if (!ref || !sha) continue;
    if (ref.startsWith('refs/heads/feature/')) {
      local.set(ref.slice('refs/heads/'.length), { sha, aheadOfMain: Number.parseInt(ahead ?? '', 10) || 0 });
    } else if (ref.startsWith('refs/remotes/origin/feature/')) {
      remote.set(ref.slice('refs/remotes/origin/'.length), sha);
    }
  }
  const out = new Map<string, DerivedBranchState>();
  for (const [name, { sha, aheadOfMain }] of local) {
    out.set(name, { name, aheadOfMain, pushed: remote.get(name) === sha });
  }
  return out;
}

/**
 * The git < 2.41 path: a plain listing, then one `rev-list --count` per LOCAL
 * feature branch — bounded by branch count, not issue count. A branch whose
 * `rev-list` fails is dropped, never reported as `aheadOfMain: 0`.
 */
async function listFeatureBranchesWithoutAheadBehind(projectPath: string): Promise<FeatureBranchMap> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(
      'git', ['for-each-ref', '--format=%(refname) %(objectname)', ...FEATURE_REF_PREFIXES],
      { cwd: projectPath, ...FOR_EACH_REF_OPTS },
    ));
  } catch {
    return new Map();
  }
  const out = new Map<string, DerivedBranchState>();
  for (const [name, entry] of parseFeatureBranchRefs(stdout)) {
    const ahead = await runGit(projectPath, ['rev-list', '--count', `origin/main..${name}`]);
    if (ahead === null) continue;
    out.set(name, { ...entry, aheadOfMain: Number.parseInt(ahead, 10) || 0 });
  }
  return out;
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
    if (findSpecByIssueSync(root, issueId) !== null) return true;
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
    const { capturePaneText } = await import('../tmux.js');
    return await capturePaneText(pane.id, 40);
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
  const { resolveTerminalBackend } = await import('../terminal-backends/registry.js');

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
    // The selected backend could not answer — tmux still owns whatever sessions
    // are running, so its inventory is the fallback (`launch.js` registered it).
    if (backend.name === 'tmux') return [];
    return (await read(resolveTerminalBackend('tmux'))) ?? [];
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
  const { resolveGitHubIssueSync } = await import('../tracker-utils.js');
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
  const gh = resolveGitHubIssueSync(issueId);

  const order = [trackers.primary, ...(trackers.secondary ? [trackers.secondary] : [])];
  for (const type of order) {
    try {
      if (type === 'github' && !gh.isGitHub) continue;
      const tracker = type === 'github' && gh.isGitHub
        ? createTracker({ ...trackers.github, type: 'github', owner: gh.owner, repo: gh.repo })
        : createTrackerFromConfig(trackers, type);
      const issue = await Effect.runPromise(tracker.getIssue(issueId));
      return { open: issue.state !== 'closed', labels: issue.labels ?? [] };
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
    if (pr.reviewState !== 'approved' || pr.checks !== 'green' || pr.mergeable !== true) continue;
    ready.push({ issueId, title: row.title ?? issueId, pr: pr.number });
  }
  return ready;
}

// ─── the batch door ──────────────────────────────────────────────────────────

export interface BatchLoaderDeps extends IssueStateLoaderDeps {
  /**
   * The tracker rows the caller already holds, by upper-cased issue id. A
   * missing (or `null`) entry is unknown — never assumed open.
   */
  readonly issues?: Readonly<Record<string, TrackerIssueFacts | null>>;
  /** One branch listing per project. Wins over `readBranch` when both are given. */
  readonly readBranches?: (projectPath: string) => Promise<FeatureBranchMap>;
}

/**
 * Derive many issues at once. One forge listing per repo (cached), one backend
 * inventory read, one branch listing per repo, and a spec `existsSync` per
 * issue. The branch row is consulted only for issues with no PR — that row is
 * the only one needing `aheadOfMain`.
 *
 * Every board-shaped route uses this. Calling `getDerivedIssueState` in a loop
 * would issue one `gh` and three `git` invocations per issue.
 */
export async function loadIssueStatesForProject(
  projectPath: string,
  issueIds: readonly string[],
  deps: BatchLoaderDeps = {},
): Promise<Map<string, DerivedIssueState>> {
  const now = (deps.now ?? Date.now)();
  const gitlab = forgeForProject(projectPath) === 'gitlab';
  const rows = gitlab ? [] : await listRepoPullRequests(projectPath);
  const prByIssue = new Map<string, LoadedPr>();
  if (!gitlab) {
    for (const row of rows) {
      const issueId = issueIdFromBranch(row.headRefName);
      const pr = issueId ? prFromGhRow(row) : null;
      if (issueId && pr) prByIssue.set(issueId, pr);
    }
  }

  const panes = deps.panes ?? await listPanesWithBackend(now);
  // A caller-supplied per-issue `readBranch` keeps the old path (test seams);
  // otherwise one listing serves every PR-less issue.
  const branches = deps.readBranches
    ? await deps.readBranches(projectPath)
    : deps.readBranch ? null : await listFeatureBranchesWithGit(projectPath);
  const out = new Map<string, DerivedIssueState>();

  for (const raw of issueIds) {
    const issueId = raw.toUpperCase();
    const branchName = featureBranchFor(issueId);
    const pr = prByIssue.get(issueId)
      ?? (gitlab ? await (deps.readPr ?? forgeReader(projectPath))(issueId, projectPath, branchName) : null);
    const branch = pr
      ? null
      : branches
        ? branches.get(branchName) ?? null
        : deps.readBranch
          ? await deps.readBranch(projectPath, branchName)
          : null;

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
      ...(deps.stuckAfterMs !== undefined ? { stuckAfterMs: deps.stuckAfterMs } : {}),
    };
    out.set(issueId, deriveIssueState(facts));
  }
  return out;
}
