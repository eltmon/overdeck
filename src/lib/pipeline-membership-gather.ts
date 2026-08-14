import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import type { MembershipUnavailableReason } from '@overdeck/contracts';
import { Effect } from 'effect';

import type { ForgeType } from './forge.js';
import {
  listIssuesWithAnyLabelPromise,
  listOpenIssuesWithLabelsPromise,
} from './github-app.js';
import { createSettledTtlPromiseCache, withConcurrencyLimitPromise } from './concurrency.js';
import { listOpenGitLabMergeRequests, listGitLabMergedMergeRequestHeads, type GitLabMergeRequestRow } from './gitlab-merge-requests.js';
import { STALE_PIPELINE_LABELS } from './cloister/label-reconciler.js';
import { loadConfigSync } from './config.js';
import { listSpecs } from './pan-dir/specs.js';
import { readIssueRecord } from './pan-dir/record.js';
import type { IssueLensSignals } from './pipeline-membership.js';
import { getIssuePrefix, type ProjectConfig } from './projects.js';
import { getRepoForge, inferProjectForgeSync } from './project-repos.js';
import { parseIssueIdFromTextSync } from './resource-utils.js';
import { createTracker } from './tracker/factory.js';
import type { Issue, TrackerType } from './tracker/interface.js';

const execFileAsync = promisify(execFile);
const GRAPHQL_ALIAS_CHUNK_SIZE = 50;

function chunksOf<T>(values: T[]): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += GRAPHQL_ALIAS_CHUNK_SIZE) {
    chunks.push(values.slice(index, index + GRAPHQL_ALIAS_CHUNK_SIZE));
  }
  return chunks;
}

export interface PullRequestRow {
  headRefName: string;
  headRepoFullName: string;
  number?: number;
  title?: string;
  url?: string;
  state?: string;
  isDraft?: boolean;
  baseRefName?: string;
}

interface GitHubPullRequestRow {
  number: number;
  title: string;
  html_url: string;
  state: string;
  draft?: boolean;
  head: { ref: string; repo?: { full_name?: string } | null };
  base: { ref: string };
}

const OPEN_PR_CACHE_TTL_MS = 30_000;
const cachedOpenPullRequests = createSettledTtlPromiseCache<string, PullRequestRow[]>(OPEN_PR_CACHE_TTL_MS);

/** Share one short-lived repository PR snapshot across dashboard consumers. */
export function listOpenPullRequestsSnapshot(owner: string, repo: string): Promise<PullRequestRow[]> {
  const key = `${owner}/${repo}`.toLowerCase();
  return cachedOpenPullRequests(key, () => execFileAsync('gh', [
    'api', '--paginate', '--slurp', `repos/${owner}/${repo}/pulls?state=open&per_page=100`,
  ], {
    encoding: 'utf-8', timeout: 30_000, maxBuffer: 16 * 1024 * 1024,
  }).then(({ stdout }) => (JSON.parse(stdout) as GitHubPullRequestRow[][]).flat().map((pr) => ({
    number: pr.number,
    title: pr.title,
    url: pr.html_url,
    state: pr.state,
    isDraft: pr.draft ?? false,
    headRefName: pr.head.ref,
    headRepoFullName: pr.head.repo?.full_name ?? '',
    baseRefName: pr.base.ref,
  }))));
}

interface MergedHeadGraphqlResponse {
  errors?: unknown[];
  data?: {
    repository?: Record<string, {
      nodes?: Array<{ headRepository?: { name?: string; owner?: { login?: string } } | null }>;
    }>;
  };
}

async function runGitHubGraphql(query: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('gh', ['api', 'graphql', '-f', `query=${query}`], {
      encoding: 'utf-8',
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    // gh exits non-zero when the GraphQL envelope carries per-field errors
    // (e.g. `issue(number: N)` where N is a PR — strike branches can point at
    // PR numbers), but it still prints the full response with partial data to
    // stdout. Surface that envelope so callers can use the resolvable fields
    // instead of failing the whole gather (the zero-membership regression).
    const stdout = (error as { stdout?: string }).stdout;
    if (typeof stdout === 'string' && stdout.length > 0) {
      try {
        const parsed = JSON.parse(stdout) as { data?: unknown };
        if (parsed.data !== undefined && parsed.data !== null) return stdout;
      } catch {
        // stdout is not a GraphQL envelope — fall through to the original error
      }
    }
    throw error;
  }
}

export async function listMergedPullRequestHeadsBatched(
  owner: string,
  repo: string,
  heads: string[],
  runGraphql: (query: string) => Promise<string> = runGitHubGraphql,
): Promise<string[]> {
  if (heads.length === 0) return [];
  const mergedHeads: string[] = [];
  for (const headChunk of chunksOf(heads)) {
    const fields = headChunk.map((head, index) =>
      `h${index}: pullRequests(states: MERGED, headRefName: ${JSON.stringify(head)}, first: 10) { nodes { headRepository { name owner { login } } } }`);
    const query = `query { repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(repo)}) { ${fields.join(' ')} } }`;
    const response = JSON.parse(await runGraphql(query)) as MergedHeadGraphqlResponse;
    const repository = response.data?.repository;
    if (response.errors?.length || !repository) throw new Error('Incomplete merged-PR GraphQL response');
    for (let index = 0; index < headChunk.length; index++) {
      if (!Array.isArray(repository[`h${index}`]?.nodes)) throw new Error(`Missing merged-PR alias h${index}`);
    }
    const normalizedOwner = owner.toLowerCase();
    const normalizedRepo = repo.toLowerCase();
    mergedHeads.push(...headChunk.filter((_head, index) => repository[`h${index}`]?.nodes?.some((pr) =>
      pr.headRepository?.name?.toLowerCase() === normalizedRepo
      && pr.headRepository.owner?.login?.toLowerCase() === normalizedOwner)));
  }
  return mergedHeads;
}

interface IssueStateGraphqlResponse {
  errors?: unknown[];
  data?: { repository?: Record<string, { state?: 'OPEN' | 'CLOSED' } | null> };
}

export async function listIssueStatesBatched(
  owner: string,
  repo: string,
  numbers: number[],
  runGraphql: (query: string) => Promise<string> = runGitHubGraphql,
): Promise<Array<{ number: number; state: 'open' | 'closed' }>> {
  if (numbers.length === 0) return [];
  const states: Array<{ number: number; state: 'open' | 'closed' }> = [];
  for (const numberChunk of chunksOf(numbers)) {
    const fields = numberChunk.map((number, index) => `i${index}: issue(number: ${number}) { state }`);
    const query = `query { repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(repo)}) { ${fields.join(' ')} } }`;
    const response = JSON.parse(await runGraphql(query)) as IssueStateGraphqlResponse;
    const repository = response.data?.repository;
    // Per-field errors (a number that resolves to a PR or deleted issue) leave
    // usable partial data: the unresolvable alias comes back null and is skipped
    // below. Only a response with no repository data at all is fatal.
    if (!repository) throw new Error('Incomplete issue-state GraphQL response');
    for (let index = 0; index < numberChunk.length; index++) {
      const alias = `i${index}`;
      if (!Object.prototype.hasOwnProperty.call(repository, alias)) throw new Error(`Missing issue-state alias ${alias}`);
      const state = repository[alias]?.state;
      if (repository[alias] !== null && state !== 'OPEN' && state !== 'CLOSED') {
        throw new Error(`Invalid issue-state alias ${alias}`);
      }
    }
    states.push(...numberChunk.flatMap((number, index) => {
      const row = repository[`i${index}`];
      return row === null ? [] : [{
        number,
        state: row?.state === 'OPEN' ? 'open' as const : 'closed' as const,
      }];
    }));
  }
  return states;
}

export interface ProjectTrackerIssueRow {
  issueId: string;
  state: 'open' | 'closed';
  labels: string[];
}

function resolveProjectTrackerType(project: ProjectConfig): TrackerType {
  if (project.tracker) return project.tracker;
  if (project.rally_project) return 'rally';
  if (project.github_repo) return 'github';
  if (getIssuePrefix(project)) return 'linear';
  if (project.gitlab_repo) return 'gitlab';
  throw new PipelineMembershipUnavailableError(
    'tracker_unconfigured',
    `Cannot resolve tracker for ${project.name}`,
  );
}

async function listProjectTrackerIssues(project: ProjectConfig): Promise<ProjectTrackerIssueRow[]> {
  const trackerType = resolveProjectTrackerType(project);

  const issuePrefix = getIssuePrefix(project)?.toUpperCase();
  if (!issuePrefix) {
    throw new PipelineMembershipUnavailableError(
      'missing_issue_prefix',
      `Missing issue_prefix for project ${project.name}`,
    );
  }
  const trackerConfig = loadConfigSync().trackers[trackerType];
  const tracker = createTracker({
    type: trackerType,
    apiKeyEnv: trackerConfig && 'api_key_env' in trackerConfig
      ? trackerConfig.api_key_env
      : undefined,
    tokenEnv: trackerConfig && 'token_env' in trackerConfig
      ? trackerConfig.token_env
      : undefined,
    team: issuePrefix,
    owner: project.github_repo?.split('/')[0],
    repo: project.github_repo?.split('/')[1],
    projectId: project.gitlab_repo,
    server: trackerType === 'rally' && trackerConfig && 'server' in trackerConfig
      ? trackerConfig.server
      : undefined,
    workspace: trackerType === 'rally' && trackerConfig && 'workspace' in trackerConfig
      ? trackerConfig.workspace
      : undefined,
    project: project.rally_project,
  });
  const issues = await Effect.runPromise(tracker.listIssues({
    team: issuePrefix,
    includeClosed: true,
  }));

  return issues.flatMap((issue: Issue) => {
    const issueId = issue.ref.toUpperCase();
    if (!issueId.startsWith(`${issuePrefix}-`)) return [];
    return [{
      issueId,
      state: issue.state === 'closed' ? 'closed' as const : 'open' as const,
      labels: issue.labels,
    }];
  });
}

export class PipelineMembershipUnavailableError extends Error {
  public readonly reason: MembershipUnavailableReason;

  constructor(reason: MembershipUnavailableReason, message: string) {
    super(message);
    this.name = 'PipelineMembershipUnavailableError';
    this.reason = reason;
  }
}

async function withUnavailableReason<T>(
  reason: MembershipUnavailableReason,
  operation: () => Promise<T>,
  context?: string,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof PipelineMembershipUnavailableError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new PipelineMembershipUnavailableError(
      reason,
      context ? `${context}: ${message}` : message,
    );
  }
}

export interface PipelineMembershipGatherDeps {
  listOpenIssues(owner: string, repo: string): Promise<Array<{ number: number; labels: string[] }>>;
  listPhaseLabeledIssues(owner: string, repo: string): Promise<Array<{ number: number; state: 'open' | 'closed'; labels: string[] }>>;
  listOpenPullRequests(owner: string, repo: string): Promise<PullRequestRow[]>;
  listOpenMergeRequests(repoPath: string): Promise<GitLabMergeRequestRow[]>;
  listMergedPullRequestHeads(owner: string, repo: string, heads: string[]): Promise<string[]>;
  listMergedMergeRequestHeads(repoPath: string, heads: string[]): Promise<string[]>;
  listIssueStates(owner: string, repo: string, numbers: number[]): Promise<Array<{ number: number; state: 'open' | 'closed' }>>;
  listTrackerIssues(project: ProjectConfig): Promise<ProjectTrackerIssueRow[]>;
  listSpecIssueIds(projectPath: string): Promise<string[]>;
  hasTerminalCloseOutRecord(project: ProjectConfig, issueId: string): Promise<boolean>;
  batchHasTerminalCloseOutRecords(project: ProjectConfig, issueIds: string[]): Promise<Map<string, boolean>>;
  run(command: string, args: string[], cwd?: string): Promise<string>;
}

const defaultDeps: PipelineMembershipGatherDeps = {
  listOpenIssues: listOpenIssuesWithLabelsPromise,
  listPhaseLabeledIssues: (owner, repo) => listIssuesWithAnyLabelPromise(owner, repo, STALE_PIPELINE_LABELS),
  listOpenPullRequests: listOpenPullRequestsSnapshot,
  listOpenMergeRequests: listOpenGitLabMergeRequests,
  listMergedPullRequestHeads: listMergedPullRequestHeadsBatched,
  listMergedMergeRequestHeads: listGitLabMergedMergeRequestHeads,
  listIssueStates: listIssueStatesBatched,
  listTrackerIssues: listProjectTrackerIssues,
  listSpecIssueIds: async (projectPath) =>
    (await Effect.runPromise(listSpecs(projectPath))).map((entry) => entry.issueId),
  hasTerminalCloseOutRecord: async (project, issueId) => {
    try {
      const record = await readIssueRecord(project, issueId);
      return record?.pipeline.closedOut === true;
    } catch {
      return false;
    }
  },
  batchHasTerminalCloseOutRecords: async (project, issueIds) => {
    const result = new Map<string, boolean>();
    // Use the record read door for bounded batch reads
    const { batchReadIssueRecords } = await import('./pan-dir/record.js');
    const batchResults = await batchReadIssueRecords(project, issueIds);

    for (const id of issueIds) {
      const record = batchResults.get(id);
      result.set(id, record?.pipeline?.closedOut === true);
    }
    return result;
  },
  run: async (command, args, cwd) => {
    const { stdout } = await execFileAsync(command, args, {
      cwd,
      encoding: 'utf-8',
      timeout: 15_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    return stdout;
  },
};

function issueNumber(issueId: string): number {
  const match = issueId.match(/-(\d+)$/);
  if (!match) throw new Error(`Cannot derive GitHub issue number from ${issueId}`);
  return Number(match[1]);
}

function issueIdFromRef(ref: string, issuePrefix: string): string | null {
  if (!/(?:^|\/)(?:feature|strike)\//.test(ref)) return null;
  const issueId = parseIssueIdFromTextSync(ref);
  return issueId?.startsWith(`${issuePrefix}-`) ? issueId : null;
}

export interface ProjectRepository {
  path: string;
  defaultBranch: string;
  forge: ForgeType;
  repoKey?: string;
}

export interface IssueBranchContainment {
  unmergedRefs: string[];
  mergedWorkRefs: string[];
  pointerRefs: string[];
  mergedWorkHeads?: Array<{ ref: string; head: string }>;
}

export interface BranchRefSnapshot {
  refs: string;
  unmergedRefs: string;
  firstParentShas: string;
}

export function projectRepositories(project: ProjectConfig): ProjectRepository[] {
  if (!project.workspace?.repos?.length) {
    return [{
      path: project.path,
      defaultBranch: project.workspace?.default_branch ?? 'main',
      forge: inferProjectForgeSync(project) || 'github',
    }];
  }

  return project.workspace.repos.map((repo) => ({
    path: join(project.path, repo.path),
    defaultBranch: repo.default_branch ?? project.workspace?.default_branch ?? 'main',
    forge: getRepoForge(repo, project),
    repoKey: repo.name,
  }));
}

async function normalizeRepoPath(path: string): Promise<string> {
  return realpath(path).catch(() => resolve(path));
}

async function hasGitRef(
  repoPath: string,
  branch: string,
  run: PipelineMembershipGatherDeps['run'],
): Promise<boolean> {
  const ref = branch.startsWith('origin/')
    ? `refs/remotes/${branch}`
    : `refs/heads/${branch}`;
  try {
    await run('git', ['rev-parse', '--verify', '--quiet', ref], repoPath);
    return true;
  } catch {
    return false;
  }
}

export async function resolveRepositoryDefaultBranch(
  repoPath: string,
  configured: string | undefined,
  run: PipelineMembershipGatherDeps['run'] = defaultDeps.run,
): Promise<string> {
  if (configured) {
    if (await hasGitRef(repoPath, configured, run)) return configured;
    if (await hasGitRef(repoPath, `origin/${configured}`, run)) return `origin/${configured}`;
  }

  for (const ref of ['refs/remotes/origin/HEAD', 'HEAD']) {
    try {
      const branch = (await run('git', ['symbolic-ref', '--quiet', '--short', ref], repoPath)).trim();
      if (branch && await hasGitRef(repoPath, branch, run)) return branch;
    } catch {
      // Continue to the next source of repository truth.
    }
  }

  for (const branch of ['main', 'master', 'origin/main', 'origin/master']) {
    if (await hasGitRef(repoPath, branch, run)) return branch;
  }

  throw new PipelineMembershipUnavailableError(
    'default_branch_unresolved',
    `Could not resolve default branch for repository ${repoPath} (configured: ${configured ?? 'none'})`,
  );
}

export async function snapshotBranchRefs(
  repoPath: string,
  defaultBranch: string,
  refPatterns: string[],
  run: PipelineMembershipGatherDeps['run'] = defaultDeps.run,
): Promise<BranchRefSnapshot> {
  const unavailable = () => new PipelineMembershipUnavailableError(
    'repo_unavailable',
    `Workspace repo path is not a git repository: ${repoPath}`,
  );

  let gitTopLevel: string;
  try {
    gitTopLevel = (await run('git', ['rev-parse', '--show-toplevel'], repoPath)).trim();
  } catch (error) {
    if (error instanceof PipelineMembershipUnavailableError) throw error;
    throw unavailable();
  }

  const [normalizedRepoPath, normalizedGitTopLevel] = await Promise.all([
    normalizeRepoPath(repoPath),
    normalizeRepoPath(gitTopLevel),
  ]);
  if (normalizedRepoPath !== normalizedGitTopLevel) throw unavailable();

  const resolvedDefaultBranch = await resolveRepositoryDefaultBranch(repoPath, defaultBranch, run);
  const [refs, unmergedRefs, firstParentShas] = await Promise.all([
    run('git', ['for-each-ref', '--format=%(objectname) %(refname:short)', ...refPatterns], repoPath),
    run('git', [
      'for-each-ref', `--no-merged=${resolvedDefaultBranch}`,
      '--format=%(refname:short)',
      ...refPatterns,
    ], repoPath),
    // L2-work (PAN-2887): main's first-parent line. A contained branch whose
    // tip is ON this line has zero unique commits (fresh pointer, not landed
    // work); a contained tip OFF this line arrived via a merge — positive
    // non-PR merge evidence.
    run('git', ['rev-list', '--first-parent', resolvedDefaultBranch], repoPath),
  ]);
  return { refs, unmergedRefs, firstParentShas };
}

function parseBranchRefLine(line: string): { tipSha: string | null; ref: string } {
  // "<objectname> <refname:short>"; tolerate refname-only lines (legacy fixtures).
  const spaceIdx = line.indexOf(' ');
  return {
    tipSha: spaceIdx === -1 ? null : line.slice(0, spaceIdx),
    ref: spaceIdx === -1 ? line : line.slice(spaceIdx + 1),
  };
}

export function classifyBranchRefLine(
  line: string,
  unmergedSet: Set<string>,
  firstParentShas: Set<string>,
): 'unmerged' | 'merged-work' | 'pointer' {
  const { tipSha, ref } = parseBranchRefLine(line);
  if (unmergedSet.has(ref)) return 'unmerged';
  if (tipSha && !firstParentShas.has(tipSha)) return 'merged-work';
  return 'pointer';
}

export async function gatherIssueBranchContainment(
  project: ProjectConfig,
  issueId: string,
  run: PipelineMembershipGatherDeps['run'] = defaultDeps.run,
): Promise<IssueBranchContainment> {
  const normalizedIssueId = issueId.toLowerCase();
  const refPatterns = [
    `refs/heads/feature/${normalizedIssueId}`,
    `refs/remotes/origin/feature/${normalizedIssueId}`,
    `refs/heads/strike/${normalizedIssueId}`,
    `refs/remotes/origin/strike/${normalizedIssueId}`,
  ];
  const snapshots = await Promise.all(projectRepositories(project).map(async (repository) => ({
    repository,
    snapshot: await snapshotBranchRefs(repository.path, repository.defaultBranch, refPatterns, run),
  })));
  const result: IssueBranchContainment = { unmergedRefs: [], mergedWorkRefs: [], pointerRefs: [], mergedWorkHeads: [] };

  for (const { repository, snapshot } of snapshots) {
    const unmergedSet = new Set(snapshot.unmergedRefs.split('\n').map((ref) => ref.trim()).filter(Boolean));
    const firstParentShas = new Set(snapshot.firstParentShas.split('\n').map((sha) => sha.trim()).filter(Boolean));
    const refLines = snapshot.refs.split('\n').map((line) => line.trim()).filter(Boolean);
    for (const line of refLines) {
      const { ref, tipSha } = parseBranchRefLine(line);
      const qualifiedRef = `${repository.path}:${ref}`;
      switch (classifyBranchRefLine(line, unmergedSet, firstParentShas)) {
        case 'unmerged':
          result.unmergedRefs.push(qualifiedRef);
          break;
        case 'merged-work':
          result.mergedWorkRefs.push(qualifiedRef);
          if (tipSha) result.mergedWorkHeads!.push({ ref: qualifiedRef, head: tipSha });
          break;
        case 'pointer':
          result.pointerRefs.push(qualifiedRef);
          break;
      }
    }
  }

  return result;
}

/** Gather all durable pipeline lenses for one project in batches. */
export async function gatherProjectLensSignals(
  project: ProjectConfig,
  deps: PipelineMembershipGatherDeps = defaultDeps,
): Promise<IssueLensSignals[]> {
  const trackerType = resolveProjectTrackerType(project);
  const usesGitHubIssueTracker = trackerType === 'github';
  const trackerContext = `Resolved ${trackerType} tracker for ${project.name}`;

  const issuePrefix = getIssuePrefix(project)?.toUpperCase();
  if (!issuePrefix) {
    throw new PipelineMembershipUnavailableError(
      'missing_issue_prefix',
      `Missing issue_prefix for project ${project.name}`,
    );
  }

  const githubRepository = project.github_repo?.split('/');
  const owner = githubRepository?.[0];
  const repo = githubRepository?.[1];
  if (project.github_repo && (!owner || !repo)) {
    throw new Error(`Invalid github_repo for ${project.name}: ${project.github_repo}`);
  }

  const repositories = projectRepositories(project);
  const gitlabRepos = repositories.filter((r) => r.forge === 'gitlab');
  const branchRefPatterns = [
    'refs/heads/feature/*', 'refs/remotes/origin/feature/*',
    'refs/heads/strike/*', 'refs/remotes/origin/strike/*',
  ];
  const branchSnapshots = repositories.map((repository) =>
    snapshotBranchRefs(repository.path, repository.defaultBranch, branchRefPatterns, deps.run));

  const [trackerIssues, openIssues, phaseLabeledIssues, openPrs, openMrs, branches, specIssueIds] = await Promise.all([
    usesGitHubIssueTracker
      ? Promise.resolve([])
      : withUnavailableReason('forge_unavailable', () => deps.listTrackerIssues(project), trackerContext),
    usesGitHubIssueTracker && owner && repo
      ? withUnavailableReason('forge_unavailable', () => deps.listOpenIssues(owner, repo), trackerContext)
      : Promise.resolve([]),
    usesGitHubIssueTracker && owner && repo
      ? withUnavailableReason('forge_unavailable', () => deps.listPhaseLabeledIssues(owner, repo), trackerContext)
      : Promise.resolve([]),
    owner && repo
      ? withUnavailableReason('forge_unavailable', () => deps.listOpenPullRequests(owner, repo))
      : Promise.resolve([]),
    !(owner && repo) && gitlabRepos.length > 0
      ? withUnavailableReason('forge_unavailable', () =>
          Promise.all(gitlabRepos.map((r) => deps.listOpenMergeRequests(r.path))))
      : Promise.resolve([]),
    Promise.all(branchSnapshots),
    withUnavailableReason('gather_failed', () => deps.listSpecIssueIds(project.path)),
  ]);

  const candidates = new Set<string>();
  const labelsByIssue = new Map<string, string[]>();
  const knownStateByIssue = new Map<string, 'open' | 'closed'>();
  const openPrIssues = new Set<string>();
  const mergedPrIssues = new Set<string>();
  const headRefsByIssue = new Map<string, Set<string>>();
  const branchIssues = new Set<string>();
  const unmergedBranchIssues = new Set<string>();
  const mergedBranchWorkIssues = new Set<string>();
  const specIssues = new Set(specIssueIds
    .map((id) => id.toUpperCase())
    .filter((id) => id.startsWith(`${issuePrefix}-`)));

  for (const issue of trackerIssues) {
    const id = issue.issueId.toUpperCase();
    if (!id.startsWith(`${issuePrefix}-`)) continue;
    labelsByIssue.set(id, issue.labels);
    knownStateByIssue.set(id, issue.state);
    if (issue.state === 'open' || STALE_PIPELINE_LABELS.some((label) => issue.labels.includes(label))) {
      candidates.add(id);
    }
  }
  for (const issue of openIssues) {
    const id = `${issuePrefix}-${issue.number}`;
    candidates.add(id);
    labelsByIssue.set(id, issue.labels);
    knownStateByIssue.set(id, 'open');
  }
  for (const issue of phaseLabeledIssues) {
    const id = `${issuePrefix}-${issue.number}`;
    candidates.add(id);
    labelsByIssue.set(id, issue.labels);
    knownStateByIssue.set(id, issue.state);
  }
  for (const pr of openPrs) {
    // GitHub fork filter: only count PRs from the configured owner/repo
    if (owner && repo && pr.headRepoFullName.toLowerCase() !== `${owner}/${repo}`.toLowerCase()) continue;
    const id = issueIdFromRef(pr.headRefName, issuePrefix);
    if (id) {
      candidates.add(id);
      openPrIssues.add(id);
      headRefsByIssue.set(id, new Set([...(headRefsByIssue.get(id) ?? []), pr.headRefName]));
    }
  }
  // Process GitLab open MRs (flatten from multi-repo array)
  const gitlabMrs = openMrs.flat();
  for (const mr of gitlabMrs) {
    const id = issueIdFromRef(mr.source_branch, issuePrefix);
    if (id) {
      candidates.add(id);
      openPrIssues.add(id);
      headRefsByIssue.set(id, new Set([...(headRefsByIssue.get(id) ?? []), mr.source_branch]));
    }
  }
  for (const snapshot of branches) {
    const refLines = snapshot.refs.split('\n').map((line) => line.trim()).filter(Boolean);
    const unmerged = new Set(snapshot.unmergedRefs.split('\n').map((ref) => ref.trim()).filter(Boolean));
    const firstParentShas = new Set(snapshot.firstParentShas.split('\n').map((sha) => sha.trim()).filter(Boolean));
    for (const line of refLines) {
      const { ref } = parseBranchRefLine(line);
      const id = issueIdFromRef(ref, issuePrefix);
      if (id) {
        candidates.add(id);
        branchIssues.add(id);
        const headRef = ref.replace(/^origin\//, '');
        headRefsByIssue.set(id, new Set([...(headRefsByIssue.get(id) ?? []), headRef]));
        const classification = classifyBranchRefLine(line, unmerged, firstParentShas);
        if (classification === 'unmerged') {
          unmergedBranchIssues.add(id);
        } else if (classification === 'merged-work') {
          mergedBranchWorkIssues.add(id);
        }
      }
    }
  }
  for (const id of specIssues) candidates.add(id);

  if (usesGitHubIssueTracker && owner && repo) {
    const unknownIssueIds = [...candidates].filter((id) => !knownStateByIssue.has(id));
    const issueStateCandidates = unknownIssueIds.filter((id) =>
      openPrIssues.has(id) || branchIssues.has(id));
    const issueStateCandidateSet = new Set(issueStateCandidates);
    for (const id of unknownIssueIds) {
      // listOpenIssues is a complete paginated snapshot. A spec-only candidate
      // absent from it is closed (or no longer an issue), and either case resolves
      // terminal without another per-number GraphQL lookup.
      if (!issueStateCandidateSet.has(id)) candidates.delete(id);
    }
    const issueStates = issueStateCandidates.length > 0
      ? await withUnavailableReason(
          'forge_unavailable',
          () => deps.listIssueStates(owner, repo, issueStateCandidates.map(issueNumber)),
          trackerContext,
        )
      : [];
    const stateByNumber = new Map(issueStates.map((entry) => [entry.number, entry.state]));
    for (const id of issueStateCandidates) {
      const state = stateByNumber.get(issueNumber(id));
      if (state) knownStateByIssue.set(id, state);
      else candidates.delete(id);
    }
  }

  // Probe terminal close-out records for closed issues with open PRs (L7-record lens).
  // This is done before the expensive merged-head oracle to avoid redundant queries.
  // Only candidates that are tracker-closed AND have an open PR need probing.
  const closedCandidatesWithOpenPr = [...candidates].filter(
    (id) => knownStateByIssue.get(id) === 'closed' && openPrIssues.has(id),
  );
  const closedOutRecordIssues = new Set<string>();
  if (closedCandidatesWithOpenPr.length > 0) {
    const closedOutResults = await deps.batchHasTerminalCloseOutRecords(project, closedCandidatesWithOpenPr);
    for (const [id, hasClosedOut] of closedOutResults) {
      if (hasClosedOut) {
        closedOutRecordIssues.add(id);
      }
    }
  }

  // Closed issues resolve terminal regardless of merged-PR history (unless a PR
  // is still open, already captured above), so only open candidates need the
  // expensive merged-head oracle. This keeps historical refs/specs out of the
  // GraphQL/GitLab fan-out without changing membership semantics.
  const openCandidates = [...candidates].filter((id) => knownStateByIssue.get(id) === 'open');
  const candidateHeads = [...new Set(openCandidates.flatMap((id) => [
    ...(headRefsByIssue.get(id) ?? []),
    `feature/${id.toLowerCase()}`,
    `strike/${id.toLowerCase()}`,
  ]))];

  if (owner && repo) {
    const mergedHeads = new Set(await withUnavailableReason(
      'forge_unavailable',
      () => deps.listMergedPullRequestHeads(owner, repo, candidateHeads),
    ));
    for (const id of openCandidates) {
      const possibleHeads = [
        ...(headRefsByIssue.get(id) ?? []),
        `feature/${id.toLowerCase()}`,
        `strike/${id.toLowerCase()}`,
      ];
      if (possibleHeads.some((head) => mergedHeads.has(head))) mergedPrIssues.add(id);
    }
  } else if (gitlabRepos.length > 0) {
    // Query merged MRs from all GitLab repos with global concurrency limit (max 5 parallel queries).
    // One call per repo carrying every candidate head — passing [head] instead
    // cost one glab subprocess per (repo × head), which stalled the refresh and
    // failed it outright somewhere in the fan-out every cycle (PAN-3267).
    const allMergedHeads = await withConcurrencyLimitPromise(
      gitlabRepos.map((repo) => () =>
        withUnavailableReason('forge_unavailable', () =>
          deps.listMergedMergeRequestHeads(repo.path, candidateHeads),
        ),
      ),
      5, // Global limit of 5 concurrent glab queries across all repos
    );
    const mergedHeads = new Set(allMergedHeads.flat());
    for (const id of openCandidates) {
      const possibleHeads = [
        ...(headRefsByIssue.get(id) ?? []),
        `feature/${id.toLowerCase()}`,
        `strike/${id.toLowerCase()}`,
      ];
      if (possibleHeads.some((head) => mergedHeads.has(head))) mergedPrIssues.add(id);
    }
  }

  return [...candidates].sort().map((id) => ({
    issueId: id,
    issueOpen: knownStateByIssue.get(id) === 'open',
    hasOpenPr: openPrIssues.has(id),
    hasMergedPr: mergedPrIssues.has(id),
    hasConventionBranch: branchIssues.has(id),
    branchUnmerged: unmergedBranchIssues.has(id),
    hasMergedBranchWork: mergedBranchWorkIssues.has(id),
    phaseLabel: STALE_PIPELINE_LABELS.find((label) => labelsByIssue.get(id)?.includes(label)) ?? null,
    hasXbriefSpec: specIssues.has(id),
    explicitlyReady: labelsByIssue.get(id)?.includes('ready') ?? false,
    hasTerminalCloseOut: closedOutRecordIssues.has(id),
  }));
}

export const PIPELINE_PROJECT_CONCURRENCY = 3;

export async function mapPipelineProjects<T>(
  projects: ProjectConfig[],
  operation: (project: ProjectConfig) => Promise<T>,
): Promise<Array<{ project: ProjectConfig; value?: T; error?: unknown }>> {
  return withConcurrencyLimitPromise(projects.map((project) => async () => {
    try {
      return { project, value: await operation(project) };
    } catch (error) {
      return { project, error };
    }
  }), PIPELINE_PROJECT_CONCURRENCY);
}

export async function gatherProjectLensSignalsForProjects(
  projects: ProjectConfig[],
  gather: (project: ProjectConfig) => Promise<IssueLensSignals[]> = gatherProjectLensSignals,
): Promise<Array<{ project: ProjectConfig; signals?: IssueLensSignals[]; error?: unknown }>> {
  return (await mapPipelineProjects(projects, gather)).map(({ project, value, error }) => ({
    project, signals: value, error,
  }));
}
