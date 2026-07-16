import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { Effect } from 'effect';

import {
  listIssuesWithAnyLabelPromise,
  listOpenIssuesWithLabelsPromise,
} from './github-app.js';
import { withConcurrencyLimitPromise } from './concurrency.js';
import { STALE_PIPELINE_LABELS } from './cloister/label-reconciler.js';
import { listSpecs } from './pan-dir/specs.js';
import type { IssueLensSignals } from './pipeline-membership.js';
import { getIssuePrefix, type ProjectConfig } from './projects.js';
import { parseIssueIdFromTextSync } from './resource-utils.js';

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
const openPrCache = new Map<string, { expiresAt: number; value: Promise<PullRequestRow[]> }>();

/** Share one short-lived repository PR snapshot across dashboard consumers. */
export function listOpenPullRequestsSnapshot(owner: string, repo: string): Promise<PullRequestRow[]> {
  const key = `${owner}/${repo}`.toLowerCase();
  const cached = openPrCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const value = execFileAsync('gh', [
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
  })));
  openPrCache.set(key, { expiresAt: Date.now() + OPEN_PR_CACHE_TTL_MS, value });
  value.catch(() => {
    if (openPrCache.get(key)?.value === value) openPrCache.delete(key);
  });
  return value;
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
  const { stdout } = await execFileAsync('gh', ['api', 'graphql', '-f', `query=${query}`], {
    encoding: 'utf-8',
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout;
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
    mergedHeads.push(...headChunk.filter((_head, index) => repository[`h${index}`]?.nodes?.some((pr) =>
      pr.headRepository?.name === repo && pr.headRepository.owner?.login === owner)));
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
    if (response.errors?.length || !repository) throw new Error('Incomplete issue-state GraphQL response');
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

export interface PipelineMembershipGatherDeps {
  listOpenIssues(owner: string, repo: string): Promise<Array<{ number: number; labels: string[] }>>;
  listPhaseLabeledIssues(owner: string, repo: string): Promise<Array<{ number: number; state: 'open' | 'closed'; labels: string[] }>>;
  listOpenPullRequests(owner: string, repo: string): Promise<PullRequestRow[]>;
  listMergedPullRequestHeads(owner: string, repo: string, heads: string[]): Promise<string[]>;
  listIssueStates(owner: string, repo: string, numbers: number[]): Promise<Array<{ number: number; state: 'open' | 'closed' }>>;
  listSpecIssueIds(projectPath: string): Promise<string[]>;
  run(command: string, args: string[], cwd?: string): Promise<string>;
}

const defaultDeps: PipelineMembershipGatherDeps = {
  listOpenIssues: listOpenIssuesWithLabelsPromise,
  listPhaseLabeledIssues: (owner, repo) => listIssuesWithAnyLabelPromise(owner, repo, STALE_PIPELINE_LABELS),
  listOpenPullRequests: listOpenPullRequestsSnapshot,
  listMergedPullRequestHeads: listMergedPullRequestHeadsBatched,
  listIssueStates: listIssueStatesBatched,
  listSpecIssueIds: async (projectPath) =>
    (await Effect.runPromise(listSpecs(projectPath))).map((entry) => entry.issueId),
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
  if (!/(?:^|\/)feature\//.test(ref)) return null;
  const issueId = parseIssueIdFromTextSync(ref);
  return issueId?.startsWith(`${issuePrefix}-`) ? issueId : null;
}

/** Gather all durable pipeline lenses for one GitHub-backed project in batches. */
export async function gatherProjectLensSignals(
  project: ProjectConfig,
  deps: PipelineMembershipGatherDeps = defaultDeps,
): Promise<IssueLensSignals[]> {
  if (!project.github_repo) return [];
  const [owner, repo] = project.github_repo.split('/');
  if (!owner || !repo) throw new Error(`Invalid github_repo for ${project.name}: ${project.github_repo}`);
  const issuePrefix = getIssuePrefix(project)?.toUpperCase();
  if (!issuePrefix) throw new Error(`Missing issue_prefix for GitHub project ${project.name}`);

  const [openIssues, phaseLabeledIssues, openPrs, branchRefs, unmergedRefs, specIssueIds] = await Promise.all([
    deps.listOpenIssues(owner, repo),
    deps.listPhaseLabeledIssues(owner, repo),
    deps.listOpenPullRequests(owner, repo),
    deps.run('git', ['for-each-ref', '--format=%(refname:short)', 'refs/heads/feature/*', 'refs/remotes/origin/feature/*'], project.path),
    deps.run('git', ['for-each-ref', '--no-merged=main', '--format=%(refname:short)', 'refs/heads/feature/*', 'refs/remotes/origin/feature/*'], project.path),
    deps.listSpecIssueIds(project.path),
  ]);

  const refs = branchRefs.split('\n').map((ref) => ref.trim()).filter(Boolean);
  const unmerged = new Set(unmergedRefs.split('\n').map((ref) => ref.trim()).filter(Boolean));
  const candidates = new Set<string>();
  const labelsByIssue = new Map<string, string[]>();
  const knownStateByIssue = new Map<string, 'open' | 'closed'>();
  const openPrIssues = new Set<string>();
  const mergedPrIssues = new Set<string>();
  const headRefsByIssue = new Map<string, Set<string>>();
  const branchIssues = new Set<string>();
  const unmergedBranchIssues = new Set<string>();
  const specIssues = new Set(specIssueIds.map((id) => id.toUpperCase()).filter((id) => id.startsWith(`${issuePrefix}-`)));

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
    if (pr.headRepoFullName.toLowerCase() !== `${owner}/${repo}`.toLowerCase()) continue;
    const id = issueIdFromRef(pr.headRefName, issuePrefix);
    if (id) {
      candidates.add(id);
      openPrIssues.add(id);
      headRefsByIssue.set(id, new Set([...(headRefsByIssue.get(id) ?? []), pr.headRefName]));
    }
  }
  for (const ref of refs) {
    const id = issueIdFromRef(ref, issuePrefix);
    if (id) {
      candidates.add(id);
      branchIssues.add(id);
      const headRef = ref.replace(/^origin\//, '');
      headRefsByIssue.set(id, new Set([...(headRefsByIssue.get(id) ?? []), headRef]));
      if (unmerged.has(ref)) unmergedBranchIssues.add(id);
    }
  }
  for (const id of specIssues) candidates.add(id);

  const candidateHeads = [...new Set([...candidates].flatMap((id) =>
    [...(headRefsByIssue.get(id) ?? new Set([`feature/${id.toLowerCase()}`]))]))];
  const mergedHeads = new Set(await deps.listMergedPullRequestHeads(owner, repo, candidateHeads));
  for (const [id, heads] of headRefsByIssue) {
    if ([...heads].some((head) => mergedHeads.has(head))) mergedPrIssues.add(id);
  }
  for (const id of candidates) {
    if (!headRefsByIssue.has(id) && mergedHeads.has(`feature/${id.toLowerCase()}`)) mergedPrIssues.add(id);
  }

  const unknownIssueIds = [...candidates].filter((id) => !knownStateByIssue.has(id));
  const issueStates = await deps.listIssueStates(owner, repo, unknownIssueIds.map(issueNumber));
  const stateByNumber = new Map(issueStates.map((entry) => [entry.number, entry.state]));
  const issueOpen = new Map([...candidates].map((id) => [
    id,
    knownStateByIssue.get(id) === 'open' || stateByNumber.get(issueNumber(id)) === 'open',
  ]));

  return [...candidates].sort().map((id) => ({
    issueId: id,
    issueOpen: issueOpen.get(id) ?? false,
    hasOpenPr: openPrIssues.has(id),
    hasMergedPr: mergedPrIssues.has(id),
    hasConventionBranch: branchIssues.has(id),
    branchUnmerged: unmergedBranchIssues.has(id),
    phaseLabel: STALE_PIPELINE_LABELS.find((label) => labelsByIssue.get(id)?.includes(label)) ?? null,
    hasVbriefSpec: specIssues.has(id),
    explicitlyReady: labelsByIssue.get(id)?.includes('ready') ?? false,
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
