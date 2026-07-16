import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { Effect } from 'effect';

import {
  getIssueStatePromise,
  listOpenIssuesWithLabelsPromise,
} from './github-app.js';
import { STALE_PIPELINE_LABELS } from './cloister/label-reconciler.js';
import { listSpecs } from './pan-dir/specs.js';
import type { IssueLensSignals } from './pipeline-membership.js';
import type { ProjectConfig } from './projects.js';
import { parseIssueIdFromTextSync } from './resource-utils.js';

const execFileAsync = promisify(execFile);

interface PullRequestRow {
  headRefName: string;
}

interface GitHubPullRequestRow {
  head: { ref: string };
}

export const PIPELINE_ISSUE_STATE_CONCURRENCY = 8;
export const PIPELINE_PR_HEAD_BATCH_SIZE = 50;

interface MergedHeadGraphqlResponse {
  data?: {
    repository?: Record<string, { totalCount?: number }>;
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
  const mergedHeads: string[] = [];
  for (let start = 0; start < heads.length; start += PIPELINE_PR_HEAD_BATCH_SIZE) {
    const chunk = heads.slice(start, start + PIPELINE_PR_HEAD_BATCH_SIZE);
    const fields = chunk.map((head, index) =>
      `h${index}: pullRequests(states: MERGED, headRefName: ${JSON.stringify(head)}, first: 1) { totalCount }`);
    const query = `query { repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(repo)}) { ${fields.join(' ')} } }`;
    const response = JSON.parse(await runGraphql(query)) as MergedHeadGraphqlResponse;
    const repository = response.data?.repository ?? {};
    for (let index = 0; index < chunk.length; index += 1) {
      if ((repository[`h${index}`]?.totalCount ?? 0) > 0) mergedHeads.push(chunk[index]!);
    }
  }
  return mergedHeads;
}

export interface PipelineMembershipGatherDeps {
  listOpenIssues(owner: string, repo: string): Promise<Array<{ number: number; labels: string[] }>>;
  listOpenPullRequests(owner: string, repo: string): Promise<PullRequestRow[]>;
  listMergedPullRequestHeads(owner: string, repo: string, heads: string[]): Promise<string[]>;
  getIssueState(owner: string, repo: string, number: number): Promise<{ state: 'open' | 'closed' }>;
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
  getIssueState: getIssueStatePromise,
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

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  map: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await map(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
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

  const candidateStates = await mapWithConcurrency(
    [...candidates],
    PIPELINE_ISSUE_STATE_CONCURRENCY,
    async (id) => {
      return [
        id,
        labelsByIssue.has(id) || (await deps.getIssueState(owner, repo, issueNumber(id))).state === 'open',
      ] as const;
    },
  );
  const issueOpen = new Map(candidateStates);

  return [...candidates].sort().map((id) => ({
    issueId: id,
    issueOpen: issueOpen.get(id) ?? false,
    hasOpenPr: openPrIssues.has(id),
    hasMergedPr: mergedPrIssues.has(id),
    hasConventionBranch: branchIssues.has(id),
    branchUnmerged: unmergedBranchIssues.has(id),
    phaseLabel: STALE_PIPELINE_LABELS.find((label) => labelsByIssue.get(id)?.includes(label)) ?? null,
    hasVbriefSpec: specIssues.has(id),
  }));
}
