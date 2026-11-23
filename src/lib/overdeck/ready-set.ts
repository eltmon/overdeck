/**
 * The project's ready set (PAN-3917 FR-9): the open PRs that are approved,
 * green and mergeable, by issue. Batches are assembled from it and the merge
 * queue orders it.
 *
 * Moved out of `derived-issue-state.ts` (PAN-4753 WI-4) so the GitLab and
 * polyrepo readers can grow here without pushing that file past its size cap.
 * This module imports from `derived-issue-state.ts`, never the reverse; the
 * server adapter (`services/derived-issue-state.ts`) re-exports it.
 *
 * Three project shapes (PAN-3657, FR-8):
 *   - **GitHub monorepo**: the cached open `gh pr list` rows, judged on the
 *     row itself (review decision, check rollup, mergeability). Unchanged.
 *   - **GitLab monorepo**: the cached MR listing (every open MR, recent merged). It has
 *     no approval and no pipeline (GitLab's list endpoint omits `approved` and
 *     `head_pipeline`), so each open, non-draft, conflict-free MR is judged by
 *     its own facts: `glab mr view` for the pipeline and mergeability, and the
 *     approvals endpoint for a named approver (`readGitLabMrFacts`), cached
 *     per MR head for a minute.
 *   - **Polyrepo**: every writable member repo, each with its own forge and
 *     branch prefix. An issue is ready when every open PR/MR for it, across
 *     the member repos, is ready. A GitHub member row is judged on its
 *     listing when the forge decided (`reviewDecision`); otherwise, since
 *     branch protection is usually off, by its own facts
 *     (`readGitHubMemberReadyFacts`: a forge decision, a trusted dated
 *     marker, or a standing review at head), cached per PR head for a
 *     minute (PAN-5638).
 *
 * A GitLab or polyrepo read that fails throws {@link ReadySetUnavailableError}.
 * It never reads as "not ready": the reconciler treats an empty ready set as
 * authoritative and would invalidate a live batch, so an outage must skip the
 * tick instead, and the queue route reports the project's error.
 */
import type { PrFacts } from '../cloister/pr-facts.js';
import { createSettledTtlPromiseCache } from '../concurrency.js';
import type { ForgeType } from '../forge.js';
import { resolveConfiguredRepos } from '../project-repos.js';
import { findProjectByPath, type ProjectConfig } from '../projects.js';
import {
  forgeForProject,
  issueIdFromBranch,
  prFromGhRow,
  readRepoMergeRequests,
  type GlabMrRow,
} from './derived-issue-state.js';
import { type GhPrRow, readOpenRepoPullRequests, readRepoPullRequests } from './pr-listing.js';

export { issueIdFromBranch };

/** One issue whose PR is ready to merge: approved, green, and mergeable. */
export interface ReadyIssue {
  readonly issueId: string;
  readonly title: string;
  readonly pr?: number;
}

/** A forge read the ready set depends on failed; the set is unknown, never empty. */
export class ReadySetUnavailableError extends Error {
  constructor(readonly repoPath: string, detail: string) {
    super(`ready set unavailable for ${repoPath}: ${detail}`);
    this.name = 'ReadySetUnavailableError';
  }
}

/** One writable repo the ready set reads: the project itself, or a polyrepo member. */
export interface ReadySetRepo {
  readonly repoKey: string;
  readonly repoPath: string;
  readonly forge: ForgeType;
  /** The repo's issue-branch prefix (`feature/`). */
  readonly branchPrefix: string;
}

export interface ReadySetDeps {
  /** GitHub monorepo: the open PR rows (today's dep; a failed read is empty). */
  readonly listPullRequests?: (projectPath: string) => Promise<readonly GhPrRow[]>;
  /** A GitHub repo's open rows, null when the read failed. */
  readonly readOpenPullRequests?: (repoPath: string) => Promise<readonly GhPrRow[] | null>;
  /** A GitHub repo's rows of every state, null when the read failed. */
  readonly readAllPullRequests?: (repoPath: string) => Promise<readonly GhPrRow[] | null>;
  /** A GitLab repo's open (every page) and recently merged MR rows, null when the read failed. */
  readonly readMergeRequests?: (repoPath: string) => Promise<readonly GlabMrRow[] | null>;
  /** One GitLab MR's facts (view + approvals); cached per MR head here. */
  readonly gitlabMrFacts?: (issueId: string, row: GlabMrRow) => Promise<PrFacts>;
  /** One GitHub member PR's facts, a standing review of the head folded in (PAN-5638); cached per PR head here. */
  readonly githubPrFacts?: (issueId: string, row: GhPrRow) => Promise<PrFacts>;
  readonly projectConfig?: (projectPath: string) => ProjectConfig | null | undefined;
  readonly forgeOf?: (projectPath: string) => ForgeType;
  /** A polyrepo project's writable member repos. */
  readonly memberRepos?: (projectPath: string, config: ProjectConfig) => readonly ReadySetRepo[];
}

/** A row reduced to what readiness needs, from either forge. */
interface IssueRow {
  readonly issueId: string;
  readonly title: string | null;
  readonly number: number;
  readonly merged: boolean;
  readonly ready: () => Promise<boolean>;
}

const MEMBER_FACTS_TTL_MS = 60_000;
/** Keyed `<repoPath>|<iid>|<sha>`: a push re-reads. A failed read is not kept. */
const gitlabMrFactsCache = createSettledTtlPromiseCache<string, PrFacts>(
  MEMBER_FACTS_TTL_MS,
  () => Date.now(),
  (facts) => (facts.error ? 0 : MEMBER_FACTS_TTL_MS),
);

/** Keyed `<repoPath>|<number>|<headRefOid>`: a push re-reads. A failed read is not kept. */
const githubPrFactsCache = createSettledTtlPromiseCache<string, PrFacts>(
  MEMBER_FACTS_TTL_MS,
  () => Date.now(),
  (facts) => (facts.error ? 0 : MEMBER_FACTS_TTL_MS),
);

/** Test seam. */
export function _resetReadySetCacheForTests(): void {
  gitlabMrFactsCache.invalidate(undefined, { includeInFlight: true });
  githubPrFactsCache.invalidate(undefined, { includeInFlight: true });
}

/** `<prefix><issue>` → the upper-cased issue id; anything else has none. */
function issueIdForBranch(branch: string | undefined, prefix: string): string | null {
  if (!branch || !branch.toLowerCase().startsWith(prefix.toLowerCase())) return null;
  const rest = branch.slice(prefix.length);
  return /^[a-z]+-\d+$/i.test(rest) ? rest.toUpperCase() : null;
}

const BRANCH_SENTINEL = 'ready-0';

/** A polyrepo project's configured writable member repos, with each one's forge and branch prefix. */
export function memberReposForProject(projectPath: string, config: ProjectConfig): ReadySetRepo[] {
  return resolveConfiguredRepos(config.name ?? '', projectPath, config, BRANCH_SENTINEL)
    .filter((repo) => repo.required)
    .map((repo) => ({
      repoKey: repo.repoKey,
      repoPath: repo.repoPath,
      forge: repo.forge,
      branchPrefix: repo.sourceBranch.slice(0, -BRANCH_SENTINEL.length),
    }));
}

async function defaultGitlabMrFacts(issueId: string, row: GlabMrRow): Promise<PrFacts> {
  const { readGitLabMrFacts } = await import('../cloister/pr-facts.js');
  return readGitLabMrFacts(issueId, { ...row, source_branch: row.source_branch ?? '' });
}

async function defaultGithubPrFacts(issueId: string, row: GhPrRow): Promise<PrFacts> {
  const { readGitHubMemberReadyFacts } = await import('../cloister/github-member-pr-facts.js');
  return readGitHubMemberReadyFacts(issueId, row.url ?? '');
}

async function githubRows(repo: ReadySetRepo, deps: ReadySetDeps, scope: 'open' | 'all'): Promise<IssueRow[]> {
  const read = scope === 'open'
    ? deps.readOpenPullRequests ?? readOpenRepoPullRequests
    : deps.readAllPullRequests ?? readRepoPullRequests;
  const rows = await read(repo.repoPath);
  if (rows === null) throw new ReadySetUnavailableError(repo.repoPath, 'the GitHub PR listing could not be read');
  const readFacts = deps.githubPrFacts ?? defaultGithubPrFacts;
  return rows.flatMap((row) => {
    const issueId = issueIdForBranch(row.headRefName, repo.branchPrefix);
    const pr = issueId ? prFromGhRow(row) : null;
    if (!issueId || !pr) return [];
    const ready = async (): Promise<boolean> => {
      // The listing rules a row out, and rules it in on a forge decision.
      if (row.isDraft || pr.checks !== 'green' || pr.mergeable !== true) return false;
      if (pr.reviewState === 'approved') return true;
      if (pr.reviewState === 'changes-requested') return false;
      // PAN-5638: without branch protection GitHub reports no decision, and a
      // self-authored PR's verdict is a marker comment. Read the PR's own facts.
      const key = `${repo.repoPath}|${pr.number}|${row.headRefOid ?? ''}`;
      const facts = await githubPrFactsCache(key, () => readFacts(issueId, row));
      // An unread approval is never an approval (C3): the set is unknown.
      if (facts.error) throw new ReadySetUnavailableError(repo.repoPath, facts.error);
      // A push between the listing and the read: judge the new head next tick.
      if (facts.headSha && row.headRefOid && facts.headSha.toLowerCase() !== row.headRefOid.toLowerCase()) return false;
      // The facts read runs after the listing; require checks and mergeability
      // on the fresh read too, the same condition the listing gate above and
      // the GitLab path below both require (FR-9).
      return facts.open && !facts.draft && !facts.changesRequested && facts.approved
        && facts.checks === 'green' && facts.mergeable === true;
    };
    return [{ issueId, title: row.title ?? null, number: pr.number, merged: pr.merged, ready }];
  });
}

async function gitlabRows(repo: ReadySetRepo, deps: ReadySetDeps): Promise<IssueRow[]> {
  const rows = await (deps.readMergeRequests ?? readRepoMergeRequests)(repo.repoPath);
  if (rows === null) throw new ReadySetUnavailableError(repo.repoPath, 'the GitLab MR listing could not be read');
  const readFacts = deps.gitlabMrFacts ?? defaultGitlabMrFacts;
  return rows.flatMap((row) => {
    const issueId = issueIdForBranch(row.source_branch, repo.branchPrefix);
    const state = (row.state ?? '').toLowerCase();
    if (!issueId || typeof row.iid !== 'number' || (state !== 'opened' && state !== 'merged')) return [];
    const ready = async (): Promise<boolean> => {
      // The listing says enough to rule a row out, never to rule it in.
      if (state !== 'opened' || row.draft === true || row.has_conflicts === true) return false;
      const key = `${repo.repoPath}|${row.iid}|${row.sha ?? ''}`;
      const facts = await gitlabMrFactsCache(key, () => readFacts(issueId, row));
      // An unread approval is never an approval (C3): the set is unknown.
      if (facts.error) throw new ReadySetUnavailableError(repo.repoPath, facts.error);
      return facts.open && !facts.draft && facts.approved && facts.checks === 'green' && facts.mergeable === true;
    };
    return [{ issueId, title: row.title ?? null, number: row.iid, merged: state === 'merged', ready }];
  });
}

/** The repos the ready set reads, or null for a GitHub monorepo (today's path). */
function readySetRepos(projectPath: string, deps: ReadySetDeps): readonly ReadySetRepo[] | null {
  const config = (deps.projectConfig ?? findProjectByPath)(projectPath);
  if (config?.workspace?.type === 'polyrepo') {
    return (deps.memberRepos ?? memberReposForProject)(projectPath, config);
  }
  if ((deps.forgeOf ?? forgeForProject)(projectPath) === 'gitlab') {
    return [{ repoKey: config?.name ?? projectPath, repoPath: projectPath, forge: 'gitlab', branchPrefix: 'feature/' }];
  }
  return null;
}

/**
 * The project's ready set. GitHub monorepo: the same cached repo listing the
 * batch door uses, judged on approvals plus green checks plus forge
 * mergeability, and nothing else (FR-9, D3). GitLab and polyrepo: see the
 * module doc; a failed read throws {@link ReadySetUnavailableError}.
 */
export async function listReadyIssuesForProject(
  projectPath: string,
  deps: ReadySetDeps = {},
): Promise<ReadyIssue[]> {
  const repos = readySetRepos(projectPath, deps);
  if (repos) return readyAcrossRepos(repos, deps);

  const rows = await (deps.listPullRequests ?? (async (p) => (await readOpenRepoPullRequests(p)) ?? []))(projectPath);
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

/** Group open rows by issue across the repos; an issue is ready when every one of its rows is. */
async function readyAcrossRepos(repos: readonly ReadySetRepo[], deps: ReadySetDeps): Promise<ReadyIssue[]> {
  const byIssue = new Map<string, IssueRow[]>();
  for (const repo of repos) {
    const rows = repo.forge === 'gitlab' ? await gitlabRows(repo, deps) : await githubRows(repo, deps, 'open');
    for (const row of rows) {
      if (row.merged) continue;
      byIssue.set(row.issueId, [...(byIssue.get(row.issueId) ?? []), row]);
    }
  }
  const ready: ReadyIssue[] = [];
  for (const [issueId, rows] of byIssue) {
    let allReady = true;
    for (const row of rows) {
      if (!(await row.ready())) {
        allReady = false;
        break;
      }
    }
    if (allReady) ready.push({ issueId, title: rows[0]!.title ?? issueId, pr: rows[0]!.number });
  }
  return ready;
}

/**
 * Upper-case ids of the issues with a merged PR/MR on an issue branch in the
 * project's repos (any member repo, for a polyrepo), for the reconciler's
 * status reason (WI-3). A failed read throws.
 */
export async function mergedIssueIdsForProject(
  projectPath: string,
  deps: ReadySetDeps = {},
): Promise<Set<string>> {
  const repos = readySetRepos(projectPath, deps)
    ?? [{ repoKey: projectPath, repoPath: projectPath, forge: 'github' as const, branchPrefix: 'feature/' }];
  const ids = new Set<string>();
  for (const repo of repos) {
    const rows = repo.forge === 'gitlab' ? await gitlabRows(repo, deps) : await githubRows(repo, deps, 'all');
    for (const row of rows) if (row.merged) ids.add(row.issueId);
  }
  return ids;
}
