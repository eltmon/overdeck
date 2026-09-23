/**
 * The cloister's single read door for forge pull/merge-request facts (PAN-3917).
 *
 * Overdeck stores no status it can derive. Everything the pipeline used to read
 * off a per-issue record or a `review_status` row — is it in review, were
 * changes requested, is it approved, are the checks green, can it merge, did it
 * merge — is answered here from the forge itself:
 *
 *   - GitHub: `gh pr view` through `fetchIssuePullRequest`, which already
 *     discovers the PR from `feature/<id>` / `strike/<id>` and returns
 *     `reviewDecision`, `mergeable`, `statusCheckRollup`, and `mergedAt`.
 *   - GitLab: `glab mr list` for discovery plus `glab mr view -F json` for the
 *     detailed merge status and approval count.
 *
 * Every function takes an optional dep bag so tests inject fixtures instead of
 * running a forge CLI. Nothing here writes anything anywhere.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { listOpenGitLabMergeRequests, type GitLabMergeRequestRow } from '../gitlab-merge-requests.js';
import { fetchIssuePullRequest, type IssuePullRequestData } from '../overdeck/pull-requests.js';
import { resolveProjectReposForIssueSync, type ResolvedProjectRepo } from '../project-repos.js';
import { isCiTestCheckName } from './verification-tests-mode.js';

const execFileAsync = promisify(execFile);

/** Aggregate verdict over the head commit's checks. */
export type ChecksVerdict = 'green' | 'pending' | 'red' | 'none';

/** GitHub's `reviewDecision`, normalized. GitLab maps approvals onto it. */
export type PrReviewDecision = 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;

export interface PrFacts {
  issueId: string;
  forge: 'github' | 'gitlab' | null;
  /** Web URL of the PR/MR, when one exists. */
  url: string | null;
  number: number | null;
  /** True when a PR/MR exists at all (open, closed, or merged). */
  exists: boolean;
  open: boolean;
  merged: boolean;
  closed: boolean;
  draft: boolean;
  headSha: string | null;
  headBranch: string | null;
  reviewDecision: PrReviewDecision;
  approved: boolean;
  changesRequested: boolean;
  /** null when the forge has not computed mergeability yet. */
  mergeable: boolean | null;
  mergeableState: string | null;
  checks: ChecksVerdict;
  /**
   * PAN-3965: the verdict over just the CI test job's checks (`test`, `test (22)`).
   * With `verification.tests: ci` this is the verification gate's test gate.
   * GitLab reports one pipeline verdict, not per-job checks, so it is `none` there.
   */
  testChecks: ChecksVerdict;
  /**
   * PAN-3965 (review of #3993): the CI test job's failing checks with their
   * conclusions, so a cancelled or timed-out run can be told from a real test
   * failure. Absent when the forge reports no per-check detail (GitLab).
   */
  testCheckFailures?: readonly FailedCheck[];
  /**
   * #4021: at least one CI test-job check on the head concluded `SUCCESS`.
   * `testChecks` alone reads a skipped-only test job as green; in
   * `verification.tests: ci` mode merge readiness needs a test run that passed.
   */
  testJobSucceeded?: boolean;
  /**
   * #4036: the newest browser-UAT verdict posted on the PR for the current
   * head commit, read from the verdict comments. `null` when no UAT verdict
   * applies to this head (none was posted, or the head moved since).
   */
  uatVerdict?: UatVerdict | null;
  /** Set when the forge lookup itself failed; every flag is then conservative. */
  error?: string;
}

/** A browser-UAT verdict read back from a PR comment (#4036). */
export interface UatVerdict {
  status: 'passed' | 'failed';
  /** The commit UAT exercised, from the comment's marker; null on a legacy comment. */
  sha: string | null;
  /** When the verdict comment was posted. */
  postedAt: string | null;
}

/** A failing check as the forge reported it (conclusion or status state, upper-cased). */
export interface FailedCheck {
  name: string;
  conclusion: string;
}

export interface PrFactsDeps {
  fetchGitHubPr?: typeof fetchIssuePullRequest;
  resolveRepos?: typeof resolveProjectReposForIssueSync;
  listGitLabMrs?: typeof listOpenGitLabMergeRequests;
  viewGitLabMr?: (projectPath: string, iid: number) => Promise<GitLabMrView>;
}

export interface GitLabMrView {
  iid?: number;
  state?: string;
  draft?: boolean;
  web_url?: string;
  sha?: string;
  source_branch?: string;
  detailed_merge_status?: string;
  merge_status?: string;
  has_conflicts?: boolean;
  approvals_before_merge?: number | null;
  approved?: boolean;
  head_pipeline?: { status?: string } | null;
  pipeline?: { status?: string } | null;
}

/**
 * The machine marker a verdict comment carries when the forge refuses a review.
 *
 * GitHub will not let an account approve or request changes on its own pull
 * request, so on a single-account install every `gh pr review` is rejected and
 * `reviewDecision` stays empty forever. `pr-review-verdict` then posts the
 * verdict as a PR comment whose first line is this marker, and the GitHub
 * branch below reads it back. A real forge review decision always wins.
 */
export type MarkerVerdict = 'APPROVED' | 'CHANGES_REQUESTED';

export function formatVerdictMarker(verdict: MarkerVerdict): string {
  return `<!-- overdeck-verdict: ${verdict} -->`;
}

const VERDICT_MARKER_RE = /^\s*<!--\s*overdeck-verdict:\s*(APPROVED|CHANGES_REQUESTED)\s*-->/i;

/** The verdict a comment body declares in its first line, or null. */
export function parseVerdictMarker(body: string | null | undefined): MarkerVerdict | null {
  const match = body?.match(VERDICT_MARKER_RE);
  return match ? (match[1].toUpperCase() as MarkerVerdict) : null;
}

/**
 * The machine marker a UAT verdict comment carries (#4036): the outcome and the
 * commit UAT exercised (`--tested-sha`, else the PR head when the verdict was
 * posted). Merge readiness reads it back to tell a failure at the current head
 * from one a later push already superseded.
 */
export function formatUatMarker(status: 'passed' | 'failed', sha?: string | null): string {
  return `<!-- overdeck-uat: ${status}${sha ? ` sha=${sha.toLowerCase()}` : ''} -->`;
}

const UAT_MARKER_RE = /<!--\s*overdeck-uat:\s*(passed|failed)(?:\s+sha=([0-9a-f]{7,40}))?\s*-->/i;
/** A verdict comment posted before the marker existed: `**uat verdict: failed**` / `**browser UAT: failed**`. */
const LEGACY_UAT_RE = /\*\*(?:uat verdict|browser UAT):\s*(passed|failed)\*\*/i;

/** The UAT outcome (and the commit it is anchored on) a comment body declares, or null. */
export function parseUatVerdict(
  body: string | null | undefined,
): { status: 'passed' | 'failed'; sha: string | null } | null {
  if (!body) return null;
  const marker = body.match(UAT_MARKER_RE);
  if (marker) {
    return { status: marker[1].toLowerCase() as 'passed' | 'failed', sha: marker[2]?.toLowerCase() ?? null };
  }
  const legacy = body.match(LEGACY_UAT_RE);
  return legacy ? { status: legacy[1].toLowerCase() as 'passed' | 'failed', sha: null } : null;
}

export function emptyPrFacts(issueId: string, error?: string): PrFacts {
  return {
    issueId: issueId.toUpperCase(),
    forge: null,
    url: null,
    number: null,
    exists: false,
    open: false,
    merged: false,
    closed: false,
    draft: false,
    headSha: null,
    headBranch: null,
    reviewDecision: null,
    approved: false,
    changesRequested: false,
    mergeable: null,
    mergeableState: null,
    checks: 'none',
    testChecks: 'none',
    testJobSucceeded: false,
    uatVerdict: null,
    ...(error ? { error } : {}),
  };
}

function normalize(value: string | null | undefined): string {
  return (value ?? '').toUpperCase();
}

/** Aggregate GitHub's `statusCheckRollup` into one verdict. */
export function summarizeStatusCheckRollup(
  rollup: IssuePullRequestData['statusCheckRollup'] | null | undefined,
): ChecksVerdict {
  const items = rollup ?? [];
  if (items.length === 0) return 'none';
  let pending = false;
  let failed = false;
  for (const check of items) {
    const status = normalize(check.status);
    const conclusion = normalize(check.conclusion);
    const state = normalize(check.state);
    if (status && status !== 'COMPLETED') pending = true;
    if (status === 'COMPLETED' && conclusion && !['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(conclusion)) failed = true;
    if (state === 'PENDING' || state === 'EXPECTED') pending = true;
    if (state === 'FAILURE' || state === 'ERROR') failed = true;
  }
  if (failed) return 'red';
  if (pending) return 'pending';
  return 'green';
}

/** PAN-3965 (review of #3993): the CI test job's failing checks, each with its conclusion. */
export function listFailedTestChecks(
  rollup: IssuePullRequestData['statusCheckRollup'] | null | undefined,
): FailedCheck[] {
  const failed: FailedCheck[] = [];
  for (const check of rollup ?? []) {
    if (!isCiTestCheckName(check.name)) continue;
    const status = normalize(check.status);
    const conclusion = normalize(check.conclusion);
    const state = normalize(check.state);
    if (status === 'COMPLETED' && conclusion && !['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(conclusion)) {
      failed.push({ name: check.name ?? '', conclusion });
    } else if (state === 'FAILURE' || state === 'ERROR') {
      failed.push({ name: check.name ?? '', conclusion: state });
    }
  }
  return failed;
}

/** PAN-3965: the verdict over only the CI test job's checks. */
export function summarizeTestChecks(
  rollup: IssuePullRequestData['statusCheckRollup'] | null | undefined,
): ChecksVerdict {
  return summarizeStatusCheckRollup((rollup ?? []).filter((check) => isCiTestCheckName(check.name)));
}

/**
 * #4021: true when at least one CI test-job check concluded `SUCCESS`. A
 * `SKIPPED` or `NEUTRAL` test job ran no tests, so it does not count.
 */
export function testJobSucceeded(
  rollup: IssuePullRequestData['statusCheckRollup'] | null | undefined,
): boolean {
  return (rollup ?? []).some((check) => (
    isCiTestCheckName(check.name)
    && (normalize(check.conclusion) === 'SUCCESS' || normalize(check.state) === 'SUCCESS')
  ));
}

/** Epoch ms of the PR's head commit, used to age out a stale approval marker. */
function headCommitTime(pr: IssuePullRequestData): number | null {
  const commits = pr.commits ?? [];
  if (commits.length === 0) return null;
  const head = pr.headRefOid ? commits.find((commit) => commit.oid === pr.headRefOid) : undefined;
  const chosen = head ?? commits[commits.length - 1];
  const parsed = Date.parse(chosen?.committedDate ?? chosen?.authoredDate ?? '');
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * The verdict declared by the newest marker comment on the PR.
 *
 * An APPROVED marker older than the PR's head commit does not count: a stale
 * approval must never merge commits it never saw. A stale CHANGES_REQUESTED
 * still counts — rework stays owed until a newer verdict says otherwise.
 */
function markerVerdictFromComments(pr: IssuePullRequestData): MarkerVerdict | null {
  const comments = pr.comments ?? [];
  for (let index = comments.length - 1; index >= 0; index -= 1) {
    const verdict = parseVerdictMarker(comments[index]?.body);
    if (!verdict) continue;
    if (verdict === 'APPROVED') {
      const headAt = headCommitTime(pr);
      const commentAt = Date.parse(comments[index]?.createdAt ?? '');
      if (headAt !== null && (Number.isNaN(commentAt) || commentAt < headAt)) return null;
    }
    return verdict;
  }
  return null;
}

/** True when `sha` (full or abbreviated) names the same commit as `head`. */
function sameCommit(sha: string, head: string): boolean {
  const a = sha.toLowerCase();
  const b = head.toLowerCase();
  return a.startsWith(b) || b.startsWith(a);
}

/**
 * #4036: the newest UAT verdict that applies to the PR's current head.
 *
 * A marker carries the commit UAT exercised, so it applies when that commit is
 * the head. A legacy comment carries no commit and applies when it is at least
 * as new as the head commit (the dating the approval marker uses). When the
 * head's date cannot be read, a legacy verdict is taken as current: a failure
 * then holds rather than letting untested code through.
 */
function uatVerdictAtHead(pr: IssuePullRequestData): UatVerdict | null {
  const comments = pr.comments ?? [];
  const head = pr.headRefOid ?? null;
  const headAt = headCommitTime(pr);
  for (let index = comments.length - 1; index >= 0; index -= 1) {
    const verdict = parseUatVerdict(comments[index]?.body);
    if (!verdict) continue;
    const postedAt = comments[index]?.createdAt ?? null;
    if (verdict.sha) {
      if (head && !sameCommit(verdict.sha, head)) continue;
    } else if (headAt !== null) {
      const commentAt = Date.parse(postedAt ?? '');
      if (Number.isNaN(commentAt) || commentAt < headAt) continue;
    }
    return { status: verdict.status, sha: verdict.sha, postedAt };
  }
  return null;
}

function gitHubFacts(issueId: string, pr: IssuePullRequestData): PrFacts {
  const state = normalize(pr.state);
  const merged = state === 'MERGED' || Boolean(pr.mergedAt);
  const mergeable = normalize(pr.mergeable);
  const decision = normalize(pr.reviewDecision);
  const forgeDecision = decision === 'APPROVED' || decision === 'CHANGES_REQUESTED' ? decision : null;
  // Only consult the marker when the forge itself reached no decision.
  const effective: PrReviewDecision = forgeDecision
    ?? markerVerdictFromComments(pr)
    ?? (decision === 'REVIEW_REQUIRED' ? 'REVIEW_REQUIRED' : null);
  return {
    issueId: issueId.toUpperCase(),
    forge: 'github',
    url: pr.url ?? null,
    number: pr.number ?? null,
    exists: true,
    open: state === 'OPEN' && !merged,
    merged,
    closed: state === 'CLOSED' && !merged,
    draft: pr.isDraft === true,
    headSha: pr.headRefOid ?? null,
    headBranch: pr.headRefName ?? null,
    reviewDecision: effective,
    approved: effective === 'APPROVED',
    changesRequested: effective === 'CHANGES_REQUESTED',
    mergeable: mergeable === 'MERGEABLE' ? true : mergeable === 'CONFLICTING' ? false : null,
    mergeableState: pr.mergeable ? pr.mergeable.toLowerCase() : null,
    checks: summarizeStatusCheckRollup(pr.statusCheckRollup),
    testChecks: summarizeTestChecks(pr.statusCheckRollup),
    testCheckFailures: listFailedTestChecks(pr.statusCheckRollup),
    testJobSucceeded: testJobSucceeded(pr.statusCheckRollup),
    uatVerdict: uatVerdictAtHead(pr),
  };
}

async function defaultViewGitLabMr(projectPath: string, iid: number): Promise<GitLabMrView> {
  const { stdout } = await execFileAsync(
    'glab',
    ['mr', 'view', String(iid), '-R', projectPath, '-F', 'json'],
    { encoding: 'utf-8', timeout: 30_000, maxBuffer: 8 * 1024 * 1024 },
  );
  return JSON.parse(stdout) as GitLabMrView;
}

/** Derive `projectPath` (group/subgroup/repo) from a GitLab MR web URL. */
export function parseGitLabProjectPath(url: string | undefined | null): string | null {
  if (!url) return null;
  const match = url.match(/:\/\/[^/]+\/(.+?)\/-\/merge_requests\/\d+/);
  return match ? match[1] : null;
}

function gitLabChecks(view: GitLabMrView): ChecksVerdict {
  const status = (view.head_pipeline?.status ?? view.pipeline?.status ?? '').toLowerCase();
  if (!status) return 'none';
  if (status === 'success' || status === 'manual') return 'green';
  if (status === 'failed' || status === 'canceled') return 'red';
  return 'pending';
}

function gitLabFacts(issueId: string, row: GitLabMergeRequestRow, view: GitLabMrView | null): PrFacts {
  const state = (view?.state ?? row.state ?? '').toLowerCase();
  const merged = state === 'merged';
  const detailed = view?.detailed_merge_status;
  const mergeable = view?.has_conflicts === true
    ? false
    : detailed
      ? detailed === 'mergeable' || detailed === 'not_approved'
      : view?.merge_status === 'can_be_merged'
        ? true
        : null;
  // GitLab has no "request changes" primitive; approval is the only verdict the
  // forge models. `not_approved` means the MR is otherwise mergeable but has no
  // approval yet, which is `REVIEW_REQUIRED`, not "changes requested".
  const approved = view?.approved === true || (detailed != null && detailed === 'mergeable');
  return {
    issueId: issueId.toUpperCase(),
    forge: 'gitlab',
    url: view?.web_url ?? row.web_url ?? null,
    number: view?.iid ?? row.iid ?? null,
    exists: true,
    open: state === 'opened',
    merged,
    closed: state === 'closed',
    draft: view?.draft === true || row.draft === true,
    headSha: view?.sha ?? row.sha ?? null,
    headBranch: view?.source_branch ?? row.source_branch ?? null,
    reviewDecision: approved ? 'APPROVED' : 'REVIEW_REQUIRED',
    approved,
    changesRequested: false,
    mergeable,
    mergeableState: detailed ?? view?.merge_status ?? null,
    checks: view ? gitLabChecks(view) : 'none',
    testChecks: 'none',
    testJobSucceeded: false,
    // GitLab MR notes are not read here, so no UAT verdict is observed there.
    uatVerdict: null,
  };
}

function primaryGitLabRepo(repos: readonly ResolvedProjectRepo[]): ResolvedProjectRepo | null {
  return repos.find((repo) => repo.forge === 'gitlab' && repo.required)
    ?? repos.find((repo) => repo.forge === 'gitlab')
    ?? null;
}

/**
 * Read the forge's own account of an issue's pull/merge request.
 *
 * Never throws: a failed lookup comes back as `exists: false` with `error` set,
 * so a caller that gates on `approved`/`mergeable` holds rather than acting on a
 * lookup failure.
 */
/**
 * A short-lived read cache (PAN-3917).
 *
 * Every caller that used to read a status row now asks the forge, and some of
 * them ask per agent on a loop. The cache is process-local and expires in a
 * minute: it stores nothing durable and answers nothing a fresh call would not,
 * it just stops one sweep from running `gh pr view` a dozen times for the same
 * issue. Callers with injected deps bypass it — those are tests and callers
 * that want a specific forge reader.
 */
const PR_FACTS_TTL_MS = 60_000;
const prFactsCache = new Map<string, { at: number; facts: PrFacts }>();

/** Drop the cached forge reads. Exported for tests and for `pan reload`. */
export function resetPrFactsCache(): void {
  prFactsCache.clear();
}

export async function getPrFacts(issueId: string, deps: PrFactsDeps = {}): Promise<PrFacts> {
  const cacheable = Object.keys(deps).length === 0;
  const key = issueId.toUpperCase();
  if (cacheable) {
    const hit = prFactsCache.get(key);
    if (hit && Date.now() - hit.at < PR_FACTS_TTL_MS) return hit.facts;
  }
  const facts = await readPrFacts(issueId, deps);
  // An error is a lookup failure, not an answer — never cache it.
  if (cacheable && !facts.error) prFactsCache.set(key, { at: Date.now(), facts });
  return facts;
}

async function readPrFacts(issueId: string, deps: PrFactsDeps): Promise<PrFacts> {
  const fetchGitHubPr = deps.fetchGitHubPr ?? fetchIssuePullRequest;
  try {
    const gh = await fetchGitHubPr(issueId);
    if (gh.pr) return gitHubFacts(issueId, gh.pr);
    if (gh.error) return emptyPrFacts(issueId, gh.error);
  } catch (cause) {
    return emptyPrFacts(issueId, `GitHub PR lookup failed: ${cause instanceof Error ? cause.message : String(cause)}`);
  }

  const resolveRepos = deps.resolveRepos ?? resolveProjectReposForIssueSync;
  let repo: ResolvedProjectRepo | null = null;
  try {
    repo = primaryGitLabRepo(resolveRepos(issueId) ?? []);
  } catch {
    repo = null;
  }
  if (!repo) return emptyPrFacts(issueId);

  const listGitLabMrs = deps.listGitLabMrs ?? listOpenGitLabMergeRequests;
  const viewGitLabMr = deps.viewGitLabMr ?? defaultViewGitLabMr;
  try {
    const rows = await listGitLabMrs(repo.repoPath);
    const branch = repo.sourceBranch;
    const row = rows.find((candidate) => candidate.source_branch === branch);
    if (!row?.iid) return emptyPrFacts(issueId);
    const projectPath = parseGitLabProjectPath(row.web_url);
    const view = projectPath ? await viewGitLabMr(projectPath, row.iid).catch(() => null) : null;
    return gitLabFacts(issueId, row, view);
  } catch (cause) {
    return emptyPrFacts(issueId, `GitLab MR lookup failed: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

export interface MergeReadiness {
  ready: boolean;
  /** Present when `ready` is false: the single reason that blocks the merge. */
  reason?: string;
}

/**
 * Project and issue policy the forge facts are judged against. Both default to
 * off, so a caller that passes nothing gets FR-9's approved + green + mergeable.
 * `cloister/merge-gate.ts` resolves both for an issue.
 */
export interface MergeReadinessPolicy {
  /**
   * #4021: the project runs `verification.tests: ci`, so CI is the only place
   * tests run and the CI test job must have passed on the head. Only GitHub
   * reports per-job checks; a GitLab pipeline is judged by `checks` alone.
   */
  ciTestsRequired?: boolean;
  /**
   * #4036: UAT is required for the issue (`issueHoldsForUat`: its
   * `auto-merge` / `hold-for-uat` label, else the project's
   * `auto_merge_default`, else the global `flywheel.require_uat_before_merge`),
   * so a failed UAT verdict at the current head blocks the merge.
   */
  uatRequired?: boolean;
}

/**
 * FR-9's ready set: approved + checks green + forge `mergeable`, plus the CI
 * test job (#4021) and a failed required UAT (#4036) when `policy` asks for
 * them. One reason is returned, in the order an operator would want to see it.
 */
export function evaluateMergeReadiness(facts: PrFacts, policy: MergeReadinessPolicy = {}): MergeReadiness {
  const head = facts.headSha ?? 'unknown';
  if (facts.error) return { ready: false, reason: facts.error };
  if (!facts.exists) return { ready: false, reason: 'no pull request for this issue' };
  if (facts.merged) return { ready: false, reason: 'PR is already merged' };
  if (facts.closed) return { ready: false, reason: 'PR is closed' };
  if (facts.draft) return { ready: false, reason: 'PR is a draft' };
  if (facts.changesRequested) return { ready: false, reason: 'latest review requested changes' };
  if (!facts.approved) return { ready: false, reason: 'PR is not approved' };
  // FR-9 is a positive test on both: `none` (no checks reported for the head
  // commit) and `null` (the forge has not computed mergeability yet) are the
  // absence of evidence, not evidence of readiness. Merging on either is how a
  // red or conflicting branch reaches main.
  if (facts.checks === 'red') return { ready: false, reason: `CI checks failing on PR HEAD ${head}` };
  if (facts.checks === 'pending') return { ready: false, reason: `CI checks still pending on PR HEAD ${head}` };
  if (facts.checks !== 'green') return { ready: false, reason: `no CI checks reported on PR HEAD ${head}` };
  // #4021: with tests on CI, "every present check is green" is not enough. A
  // workflow change that renames or drops the test job, or a path filter or
  // job-level `if:` that skips it, would otherwise merge code no test ran on.
  if (policy.ciTestsRequired && facts.forge === 'github' && !facts.testJobSucceeded) {
    return {
      ready: false,
      reason: facts.testChecks === 'none'
        ? `no CI test job reported on PR HEAD ${head} (verification.tests: ci)`
        : `the CI test job was skipped on PR HEAD ${head} (verification.tests: ci)`,
    };
  }
  // #4036: a failed UAT at this head is evidence the code does not work.
  if (policy.uatRequired && facts.uatVerdict?.status === 'failed') {
    return { ready: false, reason: `browser UAT failed on PR HEAD ${facts.uatVerdict.sha ?? head}` };
  }
  if (facts.mergeable !== true) {
    return {
      ready: false,
      reason: facts.mergeable === false
        ? `PR is not mergeable${facts.mergeableState ? ` (state=${facts.mergeableState})` : ''}`
        : `the forge has not computed mergeability yet${facts.mergeableState ? ` (state=${facts.mergeableState})` : ''}`,
    };
  }
  return { ready: true };
}

/** True when the issue is in review: an open PR that is neither approved nor rejected. */
export function isAwaitingReview(facts: PrFacts): boolean {
  return facts.open && !facts.approved && !facts.changesRequested;
}

export interface LatestPrReview {
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | string;
  /** The commit the reviewer reviewed. */
  commitId: string | null;
  submittedAt: string | null;
  author: string | null;
}

/**
 * The most recent non-comment review on the issue's PR.
 *
 * `reviewDecision` says what the forge concluded; this says which commit the
 * conclusion was reached against, which is how "the branch moved since the
 * review" is answered without storing a reviewed anchor.
 */
export async function getLatestPrReview(
  facts: PrFacts,
  runGh: (args: string[]) => Promise<string> = defaultRunGh,
): Promise<LatestPrReview | null> {
  if (facts.forge !== 'github' || !facts.url || !facts.number) return null;
  const match = facts.url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/\d+/);
  if (!match) return null;
  try {
    const stdout = await runGh([
      'api',
      `repos/${match[1]}/${match[2]}/pulls/${facts.number}/reviews?per_page=100`,
      '-H', 'Accept: application/vnd.github+json',
    ]);
    const reviews = JSON.parse(stdout) as Array<{
      state?: string; commit_id?: string; submitted_at?: string; user?: { login?: string };
    }>;
    const decisive = reviews.filter((review) => review.state === 'APPROVED' || review.state === 'CHANGES_REQUESTED');
    const latest = decisive[decisive.length - 1];
    if (!latest) return null;
    return {
      state: latest.state ?? 'COMMENTED',
      commitId: latest.commit_id ?? null,
      submittedAt: latest.submitted_at ?? null,
      author: latest.user?.login ?? null,
    };
  } catch {
    return null;
  }
}

async function defaultRunGh(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('gh', args, {
    encoding: 'utf-8', timeout: 20_000, maxBuffer: 8 * 1024 * 1024,
  });
  return stdout;
}
