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
import { resolveProjectReposForIssue, type ResolvedProjectRepo } from '../project-repos.js';
import { parseUatVerdict } from './uat-verdict-marker.js';
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
  /**
   * #3853: `true` only when the approval is proven to stand on the exact head
   * commit: an approval marker whose `sha=` names the head. Anything else,
   * including every forge approval (its review commit is read on the verdict
   * path only, `forgeApprovalAtHead`) and every GitLab MR, is left unset:
   * not proven. The verdict guard refuses a rejection only on proof.
   */
  approvedAtHead?: boolean;
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

export { formatUatMarker, parseUatVerdict } from './uat-verdict-marker.js';

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
  resolveRepos?: typeof resolveProjectReposForIssue;
  listGitLabMrs?: typeof listOpenGitLabMergeRequests;
  viewGitLabMr?: (projectPath: string, iid: number) => Promise<GitLabMrView>;
  /**
   * The GitHub logins Overdeck posts verdict comments as (the `gh` user, the
   * GitHub App bot). Read only when a verdict marker comes from an author
   * whose association alone does not make it trusted.
   */
  overdeckLogins?: () => Promise<readonly string[]>;
}

export interface PrFactsOptions {
  /**
   * #4016: read the PR on this head branch first (a strike landing reads
   * `strike/<issue>`), so an open feature PR cannot stand in for it.
   */
  preferBranch?: string;
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

/**
 * #3853: the marker names the commit it judged (`sha=`), the way the UAT
 * marker does, so a reader can tie an approval to the exact head.
 */
export function formatVerdictMarker(verdict: MarkerVerdict, sha?: string | null): string {
  return `<!-- overdeck-verdict: ${verdict}${sha ? ` sha=${sha.toLowerCase()}` : ''} -->`;
}

const VERDICT_MARKER_RE = /^[ \t]*<!--[ \t]*overdeck-verdict:[ \t]*(APPROVED|CHANGES_REQUESTED)(?:[ \t]+sha=([0-9a-f]{7,40}))?[ \t]*-->[ \t]*(?:\r?\n|$)/i;

/** The verdict a comment body declares as its whole first line, or null. */
export function parseVerdictMarker(body: string | null | undefined): MarkerVerdict | null {
  return parseVerdictMarkerWithSha(body)?.verdict ?? null;
}

/** The verdict and the commit it names (null for a marker without `sha=`). */
export function parseVerdictMarkerWithSha(
  body: string | null | undefined,
): { verdict: MarkerVerdict; sha: string | null } | null {
  const match = body?.match(VERDICT_MARKER_RE);
  return match
    ? { verdict: match[1].toUpperCase() as MarkerVerdict, sha: match[2]?.toLowerCase() ?? null }
    : null;
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
function summarizeStatusCheckRollup(
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

type PrComment = NonNullable<IssuePullRequestData['comments']>[number];

/** GitHub author associations whose comments carry verdicts (#4040 review). */
const TRUSTED_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

/** The logins Overdeck posts as, lower-cased with any `[bot]` suffix dropped. */
export type TrustedAuthors = ReadonlySet<string>;

function normalizeLogin(login: string): string {
  return login.trim().toLowerCase().replace(/\[bot\]$/, '');
}

/**
 * Whether a comment may declare a verdict. The repository is public and anyone
 * can comment, so a verdict marker counts only from an author GitHub reports
 * as `OWNER`, `MEMBER` or `COLLABORATOR`, or from the identity Overdeck posts
 * verdicts as. Everything else is ignored — a pass, a failure, an approval.
 */
function isTrustedComment(comment: PrComment | undefined, trusted: TrustedAuthors): boolean {
  if (!comment) return false;
  if (TRUSTED_ASSOCIATIONS.has(normalize(comment.authorAssociation))) return true;
  const login = comment.author?.login;
  return Boolean(login) && trusted.has(normalizeLogin(login!));
}

function carriesMarker(comment: PrComment | undefined): boolean {
  return parseVerdictMarker(comment?.body) !== null || parseUatVerdict(comment?.body) !== null;
}

/**
 * The verdict declared by the newest marker comment on the PR.
 *
 * An APPROVED marker older than the PR's head commit does not count: a stale
 * approval must never merge commits it never saw. A stale CHANGES_REQUESTED
 * still counts — rework stays owed until a newer verdict says otherwise.
 */
function markerVerdictFromComments(pr: IssuePullRequestData, trusted: TrustedAuthors): MarkerVerdict | null {
  const comments = pr.comments ?? [];
  for (let index = comments.length - 1; index >= 0; index -= 1) {
    if (!isTrustedComment(comments[index], trusted)) continue;
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
 * #4036: the newest UAT verdict, from a trusted author, that applies to the
 * PR's current head.
 *
 * Only the `overdeck-uat` marker counts. It carries the commit UAT exercised,
 * so it applies when that commit is the head. A marker posted without a commit
 * (the PR head was unreadable) applies when it is at least as new as the head
 * commit, the dating the approval marker uses. A verdict comment posted before
 * the marker existed declares nothing: it reads as no verdict.
 */
function uatVerdictAtHead(pr: IssuePullRequestData, trusted: TrustedAuthors): UatVerdict | null {
  const comments = pr.comments ?? [];
  const head = pr.headRefOid ?? null;
  const headAt = headCommitTime(pr);
  for (let index = comments.length - 1; index >= 0; index -= 1) {
    if (!isTrustedComment(comments[index], trusted)) continue;
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

/**
 * #3853: whether the newest trusted verdict marker is an approval naming the
 * head commit by `sha=`. Only a sha proves it; a marker without one, or one
 * dated by its timestamp, proves nothing.
 */
function approvalMarkerAtHead(pr: IssuePullRequestData, trusted: TrustedAuthors): boolean {
  const head = pr.headRefOid;
  if (!head) return false;
  const comments = pr.comments ?? [];
  for (let index = comments.length - 1; index >= 0; index -= 1) {
    if (!isTrustedComment(comments[index], trusted)) continue;
    const marker = parseVerdictMarkerWithSha(comments[index]?.body);
    if (!marker) continue;
    return marker.verdict === 'APPROVED' && marker.sha !== null && sameCommit(marker.sha, head);
  }
  return false;
}

function gitHubFacts(issueId: string, pr: IssuePullRequestData, trusted: TrustedAuthors = new Set()): PrFacts {
  const state = normalize(pr.state);
  const merged = state === 'MERGED' || Boolean(pr.mergedAt);
  const mergeable = normalize(pr.mergeable);
  const decision = normalize(pr.reviewDecision);
  const forgeDecision = decision === 'APPROVED' || decision === 'CHANGES_REQUESTED' ? decision : null;
  // Only consult the marker when the forge itself reached no decision.
  const effective: PrReviewDecision = forgeDecision
    ?? markerVerdictFromComments(pr, trusted)
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
    // #3853: proven only by a marker naming the head. A forge approval's
    // review commit is read on the verdict path alone (`forgeApprovalAtHead`).
    ...(effective === 'APPROVED' && forgeDecision === null && approvalMarkerAtHead(pr, trusted)
      ? { approvedAtHead: true }
      : {}),
    changesRequested: effective === 'CHANGES_REQUESTED',
    mergeable: mergeable === 'MERGEABLE' ? true : mergeable === 'CONFLICTING' ? false : null,
    mergeableState: pr.mergeable ? pr.mergeable.toLowerCase() : null,
    checks: summarizeStatusCheckRollup(pr.statusCheckRollup),
    testChecks: summarizeTestChecks(pr.statusCheckRollup),
    testCheckFailures: listFailedTestChecks(pr.statusCheckRollup),
    testJobSucceeded: testJobSucceeded(pr.statusCheckRollup),
    uatVerdict: uatVerdictAtHead(pr, trusted),
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
  // `skipped` is green, as the board reads it (`toChecksStateFromPipeline`):
  // a pipeline whose jobs all skipped is not one that will ever finish.
  if (status === 'success' || status === 'manual' || status === 'skipped') return 'green';
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

export async function getPrFacts(
  issueId: string,
  deps: PrFactsDeps = {},
  options: PrFactsOptions = {},
): Promise<PrFacts> {
  const cacheable = Object.keys(deps).length === 0 && !options.preferBranch;
  const key = issueId.toUpperCase();
  if (cacheable) {
    const hit = prFactsCache.get(key);
    if (hit && Date.now() - hit.at < PR_FACTS_TTL_MS) return hit.facts;
  }
  const facts = await readPrFacts(issueId, deps, options);
  // An error is a lookup failure, not an answer — never cache it.
  if (cacheable && !facts.error) prFactsCache.set(key, { at: Date.now(), facts });
  return facts;
}

/**
 * The logins Overdeck posts verdicts as: the authenticated `gh` user and, when
 * the GitHub App is configured, its bot. Resolved once per process; an empty
 * answer (gh unreachable) is not cached, so the next read tries again.
 */
let overdeckLoginsPromise: Promise<readonly string[]> | null = null;

async function readOverdeckLogins(): Promise<readonly string[]> {
  const logins: string[] = [];
  try {
    const { stdout } = await execFileAsync('gh', ['api', 'user', '--jq', '.login'], {
      encoding: 'utf-8', timeout: 15_000,
    });
    if (stdout.trim()) logins.push(stdout.trim());
  } catch {
    // Not authenticated as a user (or offline): association alone decides.
  }
  try {
    const { getBotIdentity, isGitHubAppConfigured } = await import('../github-app.js');
    if (isGitHubAppConfigured()) logins.push(getBotIdentity().name);
  } catch {
    // No app configuration readable.
  }
  return logins;
}

async function defaultOverdeckLogins(): Promise<readonly string[]> {
  overdeckLoginsPromise ??= readOverdeckLogins();
  const logins = await overdeckLoginsPromise;
  if (logins.length === 0) overdeckLoginsPromise = null;
  return logins;
}

/** Resolve Overdeck's own logins only when some marker's author needs it. */
async function trustedAuthorsFor(pr: IssuePullRequestData, deps: PrFactsDeps): Promise<TrustedAuthors> {
  const needsIdentity = (pr.comments ?? []).some((comment) => (
    carriesMarker(comment) && !TRUSTED_ASSOCIATIONS.has(normalize(comment.authorAssociation))
  ));
  if (!needsIdentity) return new Set();
  try {
    return new Set((await (deps.overdeckLogins ?? defaultOverdeckLogins)()).map(normalizeLogin));
  } catch {
    return new Set();
  }
}

async function readPrFacts(issueId: string, deps: PrFactsDeps, options: PrFactsOptions = {}): Promise<PrFacts> {
  const fetchGitHubPr = deps.fetchGitHubPr ?? fetchIssuePullRequest;
  try {
    const gh = await fetchGitHubPr(issueId, options.preferBranch ? { preferBranch: options.preferBranch } : {});
    if (gh.pr) return gitHubFacts(issueId, gh.pr, await trustedAuthorsFor(gh.pr, deps));
    if (gh.error) return emptyPrFacts(issueId, gh.error);
  } catch (cause) {
    return emptyPrFacts(issueId, `GitHub PR lookup failed: ${cause instanceof Error ? cause.message : String(cause)}`);
  }

  const resolveRepos = deps.resolveRepos ?? resolveProjectReposForIssue;
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
    if (!projectPath) return gitLabFacts(issueId, row, null);
    try {
      return gitLabFacts(issueId, row, await viewGitLabMr(projectPath, row.iid));
    } catch (cause) {
      // Without the MR view there is no approval, pipeline or mergeability to
      // judge. Keep the row's identity but say why, so a refusal names the
      // lookup failure instead of a missing approval.
      return {
        ...gitLabFacts(issueId, row, null),
        error: `GitLab MR view failed for !${row.iid}: ${cause instanceof Error ? cause.message : String(cause)}`,
      };
    }
  } catch (cause) {
    return emptyPrFacts(issueId, `GitLab MR lookup failed: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

/** A PR's head and its reviews, each with the commit it judged, from one read. */
export interface GitHubReviewsAtHead {
  headRefOid?: string | null;
  reviews?: ReadonlyArray<{ state?: string; commit?: { oid?: string } | null }> | null;
}

export type ReadGitHubReviews = (repo: string, number: number) => Promise<GitHubReviewsAtHead>;

async function defaultReadGitHubReviews(repo: string, number: number): Promise<GitHubReviewsAtHead> {
  const { stdout } = await execFileAsync(
    'gh',
    [
      'pr', 'view', String(number), '--repo', repo, '--json', 'headRefOid,reviews',
      '--jq', '{headRefOid, reviews: [.reviews[] | {state, commit: {oid: .commit.oid}}]}',
    ],
    { encoding: 'utf-8', timeout: 30_000, maxBuffer: 8 * 1024 * 1024 },
  );
  return JSON.parse(stdout) as GitHubReviewsAtHead;
}

/**
 * #3853: whether a GitHub review approved the exact head commit, by the
 * review's `commit.oid` (`latestReviews` reports that oid empty; `reviews`
 * does not). Only the verdict guard asks, and only for an agent's rejection,
 * so the shared `gh pr view` field list every PR read uses stays as it is.
 *
 * The head is re-read in the same call: a push between the PR read and this
 * one leaves the approval unproven rather than proven against a stale head.
 *
 * `true` is proof. `false` means the reviews were read and none approved the
 * head, an empty list included. `undefined` means it could not be told: not
 * GitHub, no head, the head moved, or the read failed. Only `true` lets the
 * guard refuse.
 */
export async function forgeApprovalAtHead(
  facts: Pick<PrFacts, 'forge' | 'url' | 'number' | 'headSha'>,
  readReviews: ReadGitHubReviews = defaultReadGitHubReviews,
): Promise<boolean | undefined> {
  if (facts.forge !== 'github' || !facts.headSha || !facts.number) return undefined;
  const repo = facts.url?.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/\d+/);
  if (!repo) return undefined;
  const head = facts.headSha.toLowerCase();
  try {
    const read = await readReviews(`${repo[1]}/${repo[2]}`, facts.number);
    if (read.headRefOid?.toLowerCase() !== head) return undefined;
    return (read.reviews ?? []).some((review) => (
      normalize(review.state) === 'APPROVED' && review.commit?.oid?.toLowerCase() === head
    ));
  } catch {
    return undefined;
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

export interface LatestPrReview {
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | string;
  /** The commit the reviewer reviewed. */
  commitId: string | null;
  submittedAt: string | null;
  author: string | null;
}
