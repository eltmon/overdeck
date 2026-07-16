import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { Effect } from 'effect';

import { getIssueStatePromise, listOpenIssuesWithLabelsPromise } from './github-app.js';
import { STALE_PIPELINE_LABELS } from './cloister/label-reconciler.js';
import { listSpecs } from './pan-dir/specs.js';
import type { IssueLensSignals } from './pipeline-membership.js';
import type { ProjectConfig } from './projects.js';
import { parseIssueIdFromTextSync } from './resource-utils.js';

const execFileAsync = promisify(execFile);

interface PullRequestRow {
  headRefName: string;
  mergedAt?: string | null;
}

export interface PipelineMembershipGatherDeps {
  listOpenIssues(owner: string, repo: string): Promise<Array<{ number: number; labels: string[] }>>;
  getIssueState(owner: string, repo: string, number: number): Promise<{ state: 'open' | 'closed' }>;
  listSpecIssueIds(projectPath: string): Promise<string[]>;
  run(command: string, args: string[], cwd?: string): Promise<string>;
}

const defaultDeps: PipelineMembershipGatherDeps = {
  listOpenIssues: listOpenIssuesWithLabelsPromise,
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

/** Gather all durable pipeline lenses for one GitHub-backed project in batches. */
export async function gatherProjectLensSignals(
  project: ProjectConfig,
  deps: PipelineMembershipGatherDeps = defaultDeps,
): Promise<IssueLensSignals[]> {
  if (!project.github_repo) throw new Error(`Project ${project.name} has no github_repo`);
  const [owner, repo] = project.github_repo.split('/');
  if (!owner || !repo) throw new Error(`Invalid github_repo for ${project.name}: ${project.github_repo}`);

  const [openIssues, openPrJson, mergedPrJson, branchRefs, unmergedRefs, specIssueIds] = await Promise.all([
    deps.listOpenIssues(owner, repo),
    deps.run('gh', ['pr', 'list', '--repo', project.github_repo, '--state', 'open', '--limit', '500', '--json', 'headRefName']),
    deps.run('gh', ['pr', 'list', '--repo', project.github_repo, '--state', 'merged', '--limit', '500', '--json', 'headRefName,mergedAt']),
    deps.run('git', ['for-each-ref', '--format=%(refname:short)', 'refs/heads/feature/*', 'refs/remotes/origin/feature/*'], project.path),
    deps.run('git', ['for-each-ref', '--no-merged=main', '--format=%(refname:short)', 'refs/heads/feature/*', 'refs/remotes/origin/feature/*'], project.path),
    deps.listSpecIssueIds(project.path),
  ]);

  const openPrs = JSON.parse(openPrJson) as PullRequestRow[];
  const mergedPrs = JSON.parse(mergedPrJson) as PullRequestRow[];
  const refs = branchRefs.split('\n').map((ref) => ref.trim()).filter(Boolean);
  const unmerged = new Set(unmergedRefs.split('\n').map((ref) => ref.trim()).filter(Boolean));
  const candidates = new Set<string>();
  const labelsByIssue = new Map<string, string[]>();
  const openPrIssues = new Set<string>();
  const mergedPrIssues = new Set<string>();
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
    }
  }
  for (const pr of mergedPrs) {
    const id = issueIdFromRef(pr.headRefName);
    if (id) mergedPrIssues.add(id);
  }
  for (const ref of refs) {
    const id = issueIdFromRef(ref);
    if (id) {
      candidates.add(id);
      branchIssues.add(id);
      if (unmerged.has(ref)) unmergedBranchIssues.add(id);
    }
  }
  for (const id of specIssues) candidates.add(id);

  const openIssueIds = new Set(labelsByIssue.keys());
  const issueOpenEntries = await Promise.all([...candidates].map(async (id) => [
    id,
    openIssueIds.has(id) || (await deps.getIssueState(owner, repo, issueNumber(id))).state === 'open',
  ] as const));
  const issueOpen = new Map(issueOpenEntries);

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
