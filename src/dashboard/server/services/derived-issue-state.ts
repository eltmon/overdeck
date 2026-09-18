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
 * | in-review         | PR open and review requested, or a reviewer pane live             |
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

import { getProjectPanPaths } from '../../../lib/pan-dir/paths.js';
import { resolveProjectFromIssueSync } from '../../../lib/projects.js';
import { getBackendPanes } from './backend-inventory.js';

const execFileAsync = promisify(execFile);

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
    if (pr.reviewState === 'review-requested') return 'in-review';
  }
  if (livePanes.some((pane) => pane.role === 'review' || pane.role === 'test' || pane.role === 'uat')) {
    return 'in-review';
  }

  if (livePanes.length > 0) return 'working';
  if (!pr && facts.branch && facts.branch.aheadOfMain > 0) return 'working';

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
}

async function readPrWithGh(_issueId: string, projectPath: string, branch: string): Promise<LoadedPr | null> {
  let stdout = '';
  try {
    ({ stdout } = await execFileAsync('gh', [
      'pr', 'list',
      '--head', branch,
      '--state', 'all',
      '--limit', '1',
      '--json', 'number,url,state,mergedAt,mergeable,reviewDecision,reviewRequests,statusCheckRollup',
    ], { cwd: projectPath, encoding: 'utf-8', timeout: 15_000 }));
  } catch {
    return null;
  }
  let rows: GhPrRow[] = [];
  try { rows = JSON.parse(stdout || '[]') as GhPrRow[]; } catch { return null; }
  const row = rows[0];
  if (!row || typeof row.number !== 'number') return null;

  return {
    url: row.url ?? '',
    number: row.number,
    reviewState: toReviewState(row.reviewDecision, (row.reviewRequests?.length ?? 0) > 0),
    checks: toChecksState(row.statusCheckRollup),
    mergeable: row.mergeable === 'MERGEABLE' ? true : row.mergeable === 'CONFLICTING' ? false : null,
    merged: Boolean(row.mergedAt),
  };
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

  const issue = deps.readIssue ? await deps.readIssue(issueId) : null;
  const branch = await (deps.readBranch ?? readBranchWithGit)(projectPath, branchName);
  const pr = await (deps.readPr ?? readPrWithGh)(issueId, projectPath, branchName);

  let apiError = false;
  if (deps.readPaneText) {
    for (const pane of panes) {
      if (paneLooksLikeApiError(await deps.readPaneText(pane))) { apiError = true; break; }
    }
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

interface GhOpenPrRow extends GhPrRow {
  title?: string;
  headRefName?: string;
  isDraft?: boolean;
}

/** `feature/pan-3917` → `PAN-3917`. Anything else has no issue. */
export function issueIdFromBranch(branch: string | undefined): string | null {
  const match = /^feature\/([a-z]+-\d+)$/i.exec(branch ?? '');
  return match?.[1] ? match[1].toUpperCase() : null;
}

/**
 * The project's ready set, in one forge read. This replaces the review-status
 * record scan: readiness is approvals plus green checks plus forge
 * mergeability, and nothing else (FR-9, D3).
 */
export async function listReadyIssuesForProject(
  projectPath: string,
  deps: { readonly listOpenPrs?: (projectPath: string) => Promise<readonly GhOpenPrRow[]> } = {},
): Promise<ReadyIssue[]> {
  const rows = await (deps.listOpenPrs ?? listOpenPrsWithGh)(projectPath);
  const ready: ReadyIssue[] = [];
  for (const row of rows) {
    if (row.isDraft) continue;
    const issueId = issueIdFromBranch(row.headRefName);
    if (!issueId || typeof row.number !== 'number') continue;
    if (toReviewState(row.reviewDecision, false) !== 'approved') continue;
    if (toChecksState(row.statusCheckRollup) !== 'green') continue;
    if (row.mergeable !== 'MERGEABLE') continue;
    ready.push({ issueId, title: row.title ?? issueId, pr: row.number });
  }
  return ready;
}

async function listOpenPrsWithGh(projectPath: string): Promise<readonly GhOpenPrRow[]> {
  try {
    const { stdout } = await execFileAsync('gh', [
      'pr', 'list',
      '--state', 'open',
      '--limit', '200',
      '--json', 'number,title,url,headRefName,isDraft,mergeable,reviewDecision,statusCheckRollup',
    ], { cwd: projectPath, encoding: 'utf-8', timeout: 20_000 });
    return JSON.parse(stdout || '[]') as GhOpenPrRow[];
  } catch {
    return [];
  }
}
