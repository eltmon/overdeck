/**
 * Derived issue state (PAN-3917 FR-6, W6).
 *
 * Overdeck stores no status it can derive. An issue's pipeline position is
 * computed here, at read time, from the owners of the underlying facts:
 *
 *   - the tracker owns the issue (open/closed, labels)
 *   - the plan home owns the spec (`<planHome>/.pan/specs/`)
 *   - the terminal backend owns pane liveness (`backend-inventory`)
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

import { createSettledTtlPromiseCache } from '../../../lib/concurrency.js';
import { getProjectPanPaths } from '../../../lib/pan-dir/paths.js';
import { findProjectByPathSync, resolveProjectFromIssueSync } from '../../../lib/projects.js';
import { inferProjectForgeSync } from '../../../lib/project-repos.js';
import { getBackendPanes } from './backend-inventory.js';

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
  /** Tracker state. A closed issue is `closed` whatever else is true. */
  readonly issueOpen: boolean;
  /** Tracker labels, lower-cased by the loader. */
  readonly labels: readonly string[];
  /** The issue appears in `<planHome>/.pan/parked.md`. */
  readonly parkedListed: boolean;
  /** `<planHome>/.pan/specs/*<ISSUE>*.xbrief.json` exists on main or the feature branch. */
  readonly specExists: boolean;
  /** Live panes carrying this issue's token, from `backend-inventory`. */
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
  if (!facts.issueOpen) return 'closed';
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
  if (facts.pr) derived.pr = facts.pr;
  if (facts.branch) derived.branch = facts.branch;
  return derived;
}

// ─── the async loader ────────────────────────────────────────────────────────

export interface IssueStateLoaderDeps {
  readonly now?: () => number;
  readonly panes?: readonly BackendPane[];
  /**
   * The tracker row, when the caller already holds it. Without it (and without
   * `readIssue`) the loader cannot see `closed` or the `parked` label, so a
   * caller that has the row MUST pass it.
   */
  readonly issue?: { readonly open: boolean; readonly labels: readonly string[] };
  readonly readIssue?: (issueId: string) => Promise<{ open: boolean; labels: readonly string[] } | null>;
  readonly readPr?: (issueId: string, projectPath: string, branch: string) => Promise<LoadedPr | null>;
  readonly readBranch?: (projectPath: string, branch: string) => Promise<DerivedBranchState | null>;
  readonly readPaneText?: (pane: BackendPane) => Promise<string>;
  readonly stuckAfterMs?: number;
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

/** `<planHome>/.pan/specs/` holds `<ISSUE>.xbrief.json` once the issue is planned. */
export function specExistsFor(issueId: string, projectPath: string): boolean {
  const { specsDir } = getProjectPanPaths(projectPath);
  const lower = issueId.toLowerCase();
  return existsSync(join(specsDir, `${lower}.xbrief.json`))
    || existsSync(join(specsDir, `${issueId.toUpperCase()}.xbrief.json`));
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
 * `observe` stream, which W8 owns — until then a Herdr pane reports no text and
 * `api-error` simply does not fire for it.
 */
async function readTmuxPaneText(pane: BackendPane): Promise<string> {
  if (!/^(agent|strike|planning|conv)-/.test(pane.id)) return '';
  try {
    const { capturePaneText } = await import('../../../lib/tmux.js');
    return await capturePaneText(pane.id, 40);
  } catch {
    return '';
  }
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

  const panes = deps.panes ?? (await getBackendPanes()).filter((pane) => pane.issue === issueId.toUpperCase());

  const issue = deps.issue ?? (deps.readIssue ? await deps.readIssue(issueId) : null);
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
    issueOpen: issue?.open ?? true,
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
    readonly labelsByIssue?: Readonly<Record<string, readonly string[]>>;
    readonly closedIssues?: ReadonlySet<string>;
  } = {},
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

  const panes = deps.panes ?? await getBackendPanes();
  const out = new Map<string, DerivedIssueState>();

  for (const raw of issueIds) {
    const issueId = raw.toUpperCase();
    const pr = prByIssue.get(issueId)
      ?? (gitlab ? await (deps.readPr ?? forgeReader(projectPath))(issueId, projectPath, featureBranchFor(issueId)) : null);
    const branch = pr
      ? null
      : await (deps.readBranch ?? readBranchWithGit)(projectPath, featureBranchFor(issueId));

    const facts: IssueStateFacts = {
      issueId,
      issueOpen: !deps.closedIssues?.has(issueId),
      labels: (deps.labelsByIssue?.[issueId] ?? []).map((label) => label.toLowerCase()),
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
