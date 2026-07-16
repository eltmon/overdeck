import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { Effect } from 'effect';

import {
  listOpenIssuesWithLabelsPromise,
} from './github-app.js';
import { STALE_PIPELINE_LABELS } from './cloister/label-reconciler.js';
import { listSpecs } from './pan-dir/specs.js';
import type { IssueLensSignals } from './pipeline-membership.js';
import type { ProjectConfig } from './projects.js';
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

interface PullRequestRow {
  headRefName: string;
}

interface GitHubPullRequestRow {
  head: { ref: string };
}

interface MergedHeadGraphqlResponse {
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
    const repository = response.data?.repository ?? {};
    mergedHeads.push(...headChunk.filter((_head, index) => repository[`h${index}`]?.nodes?.some((pr) =>
      pr.headRepository?.name === repo && pr.headRepository.owner?.login === owner)));
  }
  return mergedHeads;
}

interface IssueStateGraphqlResponse {
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
    const repository = response.data?.repository ?? {};
    states.push(...numberChunk.map((number, index) => ({
      number,
      state: repository[`i${index}`]?.state === 'OPEN' ? 'open' as const : 'closed' as const,
    })));
  }
  return states;
}

export interface PipelineMembershipGatherDeps {
  listOpenIssues(owner: string, repo: string): Promise<Array<{ number: number; labels: string[] }>>;
  listOpenPullRequests(owner: string, repo: string): Promise<PullRequestRow[]>;
  listMergedPullRequestHeads(owner: string, repo: string, heads: string[]): Promise<string[]>;
  listIssueStates(owner: string, repo: string, numbers: number[]): Promise<Array<{ number: number; state: 'open' | 'closed' }>>;
  listSpecIssueIds(projectPath: string): Promise<string[]>;
  run(command: string, args: string[], cwd?: string): Promise<string>;
}

const defaultDeps: PipelineMembershipGatherDeps = {
  listOpenIssues: listOpenIssuesWithLabelsPromise,
  listOpenPullRequests: async (owner, repo) => {
    const { stdout } = await execFileAsync('gh', [
      'api',
      '--paginate',
      '--slurp',
      `repos/${owner}/${repo}/pulls?state=open&per_page=100`,
    ], {
      encoding: 'utf-8',
      timeout: 30_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    return (JSON.parse(stdout) as GitHubPullRequestRow[][]).flat().map((pr) => ({
      headRefName: pr.head.ref,
    }));
  },
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

function issueIdFromRef(ref: string): string | null {
  if (!/(?:^|\/)feature\//.test(ref)) return null;
  return parseIssueIdFromTextSync(ref);
}

/** Gather all durable pipeline lenses for one GitHub-backed project in batches. */
export async function gatherProjectLensSignals(
  project: ProjectConfig,
  deps: PipelineMembershipGatherDeps = defaultDeps,
): Promise<IssueLensSignals[]> {
  if (!project.github_repo) return [];
  const [owner, repo] = project.github_repo.split('/');
  if (!owner || !repo) throw new Error(`Invalid github_repo for ${project.name}: ${project.github_repo}`);

  const [openIssues, openPrs, branchRefs, unmergedRefs, specIssueIds] = await Promise.all([
    deps.listOpenIssues(owner, repo),
    deps.listOpenPullRequests(owner, repo),
    deps.run('git', ['for-each-ref', '--format=%(refname:short)', 'refs/heads/feature/*', 'refs/remotes/origin/feature/*'], project.path),
    deps.run('git', ['for-each-ref', '--no-merged=main', '--format=%(refname:short)', 'refs/heads/feature/*', 'refs/remotes/origin/feature/*'], project.path),
    deps.listSpecIssueIds(project.path),
  ]);

  const refs = branchRefs.split('\n').map((ref) => ref.trim()).filter(Boolean);
  const unmerged = new Set(unmergedRefs.split('\n').map((ref) => ref.trim()).filter(Boolean));
  const candidates = new Set<string>();
  const labelsByIssue = new Map<string, string[]>();
  const openPrIssues = new Set<string>();
  const mergedPrIssues = new Set<string>();
  const headRefsByIssue = new Map<string, Set<string>>();
  const branchIssues = new Set<string>();
  const unmergedBranchIssues = new Set<string>();
  const specIssues = new Set(specIssueIds.map((id) => id.toUpperCase()));

  for (const issue of openIssues) {
    const id = `${project.issue_prefix?.toUpperCase() ?? ''}-${issue.number}`;
    candidates.add(id);
    labelsByIssue.set(id, issue.labels);
  }
  for (const pr of openPrs) {
    const id = issueIdFromRef(pr.headRefName);
    if (id) {
      candidates.add(id);
      openPrIssues.add(id);
      headRefsByIssue.set(id, new Set([...(headRefsByIssue.get(id) ?? []), pr.headRefName]));
    }
  }
  for (const ref of refs) {
    const id = issueIdFromRef(ref);
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

  const unknownIssueIds = [...candidates].filter((id) => !labelsByIssue.has(id));
  const issueStates = await deps.listIssueStates(owner, repo, unknownIssueIds.map(issueNumber));
  const stateByNumber = new Map(issueStates.map((entry) => [entry.number, entry.state]));
  const issueOpen = new Map([...candidates].map((id) => [
    id,
    labelsByIssue.has(id) || stateByNumber.get(issueNumber(id)) === 'open',
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
