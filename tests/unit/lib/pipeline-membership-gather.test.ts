import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import {
  gatherProjectLensSignals,
  mapPipelineProjects,
  PIPELINE_PROJECT_CONCURRENCY,
  listIssueStatesBatched,
  listMergedPullRequestHeadsBatched,
  type PipelineMembershipGatherDeps,
} from '../../../src/lib/pipeline-membership-gather.js';
import { resolvePipelineMembership } from '../../../src/lib/pipeline-membership.js';
import type { ProjectConfig } from '../../../src/lib/projects.js';

const project: ProjectConfig = {
  name: 'overdeck',
  path: '/project',
  issue_prefix: 'PAN',
  github_repo: 'eltmon/overdeck',
};

async function collectRelativeImportGraph(entry: string, visited = new Set<string>()): Promise<Set<string>> {
  if (visited.has(entry)) return visited;
  visited.add(entry);
  const source = await readFile(entry, 'utf-8');
  const imports = [...source.matchAll(/(?:import|export)\s+(?:type\s+)?(?:[^'";]+?\s+from\s+)?['"](\.[^'"]+)['"]/g)];
  for (const match of imports) {
    const specifier = match[1]!;
    const target = resolve(dirname(entry), specifier.replace(/\.js$/, '.ts'));
    await collectRelativeImportGraph(target, visited);
  }
  return visited;
}

function deps(): PipelineMembershipGatherDeps {
  return {
    listOpenIssues: vi.fn().mockResolvedValue([{ number: 1, labels: ['in-review'] }]),
    listPhaseLabeledIssues: vi.fn().mockResolvedValue([]),
    listOpenPullRequests: vi.fn().mockResolvedValue([{
      headRefName: 'feature/pan-2', headRepoFullName: 'eltmon/overdeck',
    }]),
    listMergedPullRequestHeads: vi.fn().mockResolvedValue(['feature/pan-1']),
    listIssueStates: vi.fn().mockImplementation(async (_owner, _repo, numbers: number[]) =>
      numbers.map((number) => ({ number, state: number === 4 ? 'open' as const : 'closed' as const }))),
    listTrackerIssues: vi.fn().mockResolvedValue([]),
    listSpecIssueIds: vi.fn().mockResolvedValue(['PAN-4']),
    run: vi.fn().mockImplementation(async (command, args) => {
      if (command === 'git' && args.includes('--no-merged=main')) return 'feature/pan-1\norigin/feature/pan-3\n';
      if (command === 'git') return 'feature/pan-1\norigin/feature/pan-3\n';
      throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
    }),
  };
}

describe('gatherProjectLensSignals', () => {
  it('bounds concurrent project gathers', async () => {
    const projects = Array.from({ length: 7 }, (_, index) => ({
      name: `project-${index}`, path: `/project-${index}`,
    }));
    let active = 0;
    let started = 0;
    let maxActive = 0;
    const releases: Array<() => void> = [];
    const result = mapPipelineProjects(projects, async (entry) => {
      active++;
      started++;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active--;
      return entry.name;
    });

    while (started < projects.length) {
      const release = releases.shift();
      if (release) release();
      await Promise.resolve();
    }
    while (releases.length > 0) releases.shift()!();
    await result;

    expect(maxActive).toBe(PIPELINE_PROJECT_CONCURRENCY);
  });

  it('returns the deduplicated union with every durable lens filled', async () => {
    const result = await gatherProjectLensSignals(project, deps());

    expect(result).toEqual([
      { issueId: 'PAN-1', issueOpen: true, hasOpenPr: false, hasMergedPr: true, hasConventionBranch: true, branchUnmerged: true, hasMergedBranchWork: false, phaseLabel: 'in-review', hasXbriefSpec: false, explicitlyReady: false },
      { issueId: 'PAN-2', issueOpen: false, hasOpenPr: true, hasMergedPr: false, hasConventionBranch: false, branchUnmerged: false, hasMergedBranchWork: false, phaseLabel: null, hasXbriefSpec: false, explicitlyReady: false },
      { issueId: 'PAN-3', issueOpen: false, hasOpenPr: false, hasMergedPr: false, hasConventionBranch: true, branchUnmerged: true, hasMergedBranchWork: false, phaseLabel: null, hasXbriefSpec: false, explicitlyReady: false },
      { issueId: 'PAN-4', issueOpen: true, hasOpenPr: false, hasMergedPr: false, hasConventionBranch: false, branchUnmerged: false, hasMergedBranchWork: false, phaseLabel: null, hasXbriefSpec: true, explicitlyReady: false },
    ]);
  });

  it('PAN-2887: contained branch off main first-parent line yields hasMergedBranchWork; fresh zero-ahead branch does not', async () => {
    const mocked = deps();
    mocked.listOpenIssues = vi.fn().mockResolvedValue([{ number: 7, labels: [] }, { number: 8, labels: [] }]);
    mocked.listOpenPullRequests = vi.fn().mockResolvedValue([]);
    mocked.listMergedPullRequestHeads = vi.fn().mockResolvedValue([]);
    mocked.listSpecIssueIds = vi.fn().mockResolvedValue([]);
    mocked.run = vi.fn().mockImplementation(async (command, args: string[]) => {
      if (command !== 'git') throw new Error(`Unexpected command: ${command}`);
      // feature/pan-7 tip = merge-lineage commit (bbb, NOT first-parent) → landed work.
      // feature/pan-8 tip = main's HEAD (aaa, first-parent) → fresh branch, no work.
      if (args[0] === 'rev-list') return 'aaa\nccc\n';
      if (args.includes('--no-merged=main')) return '';
      return 'bbb feature/pan-7\naaa feature/pan-8\n';
    });

    const result = await gatherProjectLensSignals(project, mocked);
    const byId = new Map(result.map((signal) => [signal.issueId, signal]));
    expect(byId.get('PAN-7')).toMatchObject({ hasConventionBranch: true, branchUnmerged: false, hasMergedBranchWork: true });
    expect(byId.get('PAN-8')).toMatchObject({ hasConventionBranch: true, branchUnmerged: false, hasMergedBranchWork: false });
  });

  it('gathers local and remote strike branches as unmerged convention branches', async () => {
    const mocked = deps();
    mocked.listOpenIssues = vi.fn().mockResolvedValue([]);
    mocked.listPhaseLabeledIssues = vi.fn().mockResolvedValue([]);
    mocked.listOpenPullRequests = vi.fn().mockResolvedValue([]);
    mocked.listMergedPullRequestHeads = vi.fn().mockResolvedValue([]);
    mocked.listIssueStates = vi.fn().mockResolvedValue([
      { number: 20, state: 'open' },
      { number: 21, state: 'closed' },
    ]);
    mocked.listSpecIssueIds = vi.fn().mockResolvedValue([]);
    mocked.run = vi.fn().mockImplementation(async (command, args) => {
      if (command === 'git' && args.includes('--no-merged=main')) {
        return 'strike/pan-20\norigin/strike/pan-21\n';
      }
      if (command === 'git') return 'strike/pan-20\norigin/strike/pan-21\n';
      throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
    });

    const result = await gatherProjectLensSignals(project, mocked);

    expect(mocked.run).toHaveBeenCalledWith('git', [
      'for-each-ref',
      '--format=%(objectname) %(refname:short)',
      'refs/heads/feature/*',
      'refs/remotes/origin/feature/*',
      'refs/heads/strike/*',
      'refs/remotes/origin/strike/*',
    ], project.path);
    expect(mocked.run).toHaveBeenCalledWith('git', ['rev-list', '--first-parent', 'main'], project.path);
    expect(mocked.run).toHaveBeenCalledWith('git', [
      'for-each-ref',
      '--no-merged=main',
      '--format=%(refname:short)',
      'refs/heads/feature/*',
      'refs/remotes/origin/feature/*',
      'refs/heads/strike/*',
      'refs/remotes/origin/strike/*',
    ], project.path);
    expect(mocked.listMergedPullRequestHeads).toHaveBeenCalledWith(
      'eltmon',
      'overdeck',
      ['strike/pan-20', 'feature/pan-20', 'strike/pan-21', 'feature/pan-21'],
    );
    expect(result).toEqual([
      { issueId: 'PAN-20', issueOpen: true, hasOpenPr: false, hasMergedPr: false, hasConventionBranch: true, branchUnmerged: true, hasMergedBranchWork: false, phaseLabel: null, hasVbriefSpec: false, explicitlyReady: false },
      { issueId: 'PAN-21', issueOpen: false, hasOpenPr: false, hasMergedPr: false, hasConventionBranch: true, branchUnmerged: true, hasMergedBranchWork: false, phaseLabel: null, hasVbriefSpec: false, explicitlyReady: false },
    ]);
    expect(resolvePipelineMembership(result[0]!)).toMatchObject({
      bucket: 'planned_backlog',
      inPipeline: true,
    });
    expect(resolvePipelineMembership(result[1]!)).toMatchObject({
      bucket: 'clean_terminal',
      inPipeline: false,
    });
  });

  it('does not emit strike refs whose number belongs to a pull request', async () => {
    const mocked = deps();
    mocked.listOpenIssues = vi.fn().mockResolvedValue([]);
    mocked.listPhaseLabeledIssues = vi.fn().mockResolvedValue([]);
    mocked.listOpenPullRequests = vi.fn().mockResolvedValue([]);
    mocked.listMergedPullRequestHeads = vi.fn().mockResolvedValue([]);
    mocked.listIssueStates = vi.fn().mockResolvedValue([{ number: 2879, state: 'open' }]);
    mocked.listSpecIssueIds = vi.fn().mockResolvedValue([]);
    mocked.run = vi.fn().mockResolvedValue('strike/pan-2879\nstrike/pan-2778\n');

    await expect(gatherProjectLensSignals(project, mocked)).resolves.toEqual([
      { issueId: 'PAN-2879', issueOpen: true, hasOpenPr: false, hasMergedPr: false, hasConventionBranch: true, branchUnmerged: true, hasMergedBranchWork: false, phaseLabel: null, hasVbriefSpec: false, explicitlyReady: false },
    ]);
  });

  it('classifies an open same-repository strike PR as in flight', async () => {
    const mocked = deps();
    mocked.listOpenIssues = vi.fn().mockResolvedValue([{ number: 22, labels: [] }]);
    mocked.listPhaseLabeledIssues = vi.fn().mockResolvedValue([]);
    mocked.listOpenPullRequests = vi.fn().mockResolvedValue([{
      headRefName: 'strike/pan-22', headRepoFullName: 'eltmon/overdeck',
    }]);
    mocked.listMergedPullRequestHeads = vi.fn().mockResolvedValue([]);
    mocked.listSpecIssueIds = vi.fn().mockResolvedValue([]);
    mocked.run = vi.fn().mockResolvedValue('');

    const result = await gatherProjectLensSignals(project, mocked);

    expect(result).toEqual([{
      issueId: 'PAN-22',
      issueOpen: true,
      hasOpenPr: true,
      hasMergedPr: false,
      hasConventionBranch: false,
      branchUnmerged: false, hasMergedBranchWork: false,
      phaseLabel: null,
      hasVbriefSpec: false,
      explicitlyReady: false,
    }]);
    expect(resolvePipelineMembership(result[0]!)).toMatchObject({
      bucket: 'in_flight',
      inPipeline: true,
    });
  });

  it('uses a merged strike PR as the oracle after its branch is deleted', async () => {
    const mocked = deps();
    mocked.listOpenIssues = vi.fn().mockResolvedValue([{ number: 23, labels: [] }]);
    mocked.listPhaseLabeledIssues = vi.fn().mockResolvedValue([]);
    mocked.listOpenPullRequests = vi.fn().mockResolvedValue([]);
    mocked.listMergedPullRequestHeads = vi.fn().mockResolvedValue(['strike/pan-23']);
    mocked.listSpecIssueIds = vi.fn().mockResolvedValue([]);
    mocked.run = vi.fn().mockResolvedValue('');

    const result = await gatherProjectLensSignals(project, mocked);

    expect(mocked.listMergedPullRequestHeads).toHaveBeenCalledWith(
      'eltmon',
      'overdeck',
      ['feature/pan-23', 'strike/pan-23'],
    );
    expect(result).toEqual([{
      issueId: 'PAN-23',
      issueOpen: true,
      hasOpenPr: false,
      hasMergedPr: true,
      hasConventionBranch: false,
      branchUnmerged: false, hasMergedBranchWork: false,
      phaseLabel: null,
      hasVbriefSpec: false,
      explicitlyReady: false,
    }]);
    expect(resolvePipelineMembership(result[0]!)).toMatchObject({
      bucket: 'post_merge_limbo',
      inPipeline: true,
    });
  });

  it('finds a merged strike PR when a feature branch ref still exists', async () => {
    const mocked = deps();
    mocked.listOpenIssues = vi.fn().mockResolvedValue([{ number: 24, labels: [] }]);
    mocked.listPhaseLabeledIssues = vi.fn().mockResolvedValue([]);
    mocked.listOpenPullRequests = vi.fn().mockResolvedValue([]);
    mocked.listMergedPullRequestHeads = vi.fn().mockResolvedValue(['strike/pan-24']);
    mocked.listSpecIssueIds = vi.fn().mockResolvedValue([]);
    mocked.run = vi.fn().mockImplementation(async (command, args) => {
      if (command === 'git' && args.includes('--no-merged=main')) return 'feature/pan-24\n';
      if (command === 'git') return 'feature/pan-24\n';
      throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
    });

    const result = await gatherProjectLensSignals(project, mocked);

    expect(mocked.listMergedPullRequestHeads).toHaveBeenCalledWith(
      'eltmon',
      'overdeck',
      ['feature/pan-24', 'strike/pan-24'],
    );
    expect(result).toEqual([{
      issueId: 'PAN-24',
      issueOpen: true,
      hasOpenPr: false,
      hasMergedPr: true,
      hasConventionBranch: true,
      branchUnmerged: true, hasMergedBranchWork: false,
      phaseLabel: null,
      hasVbriefSpec: false,
      explicitlyReady: false,
    }]);
    expect(resolvePipelineMembership(result[0]!)).toMatchObject({
      bucket: 'post_merge_limbo',
      inPipeline: true,
    });
  });

  it('lists all PRs through one paginated dependency regardless of candidate count', async () => {
    const mocked = deps();
    await gatherProjectLensSignals(project, mocked);
    expect(mocked.listOpenPullRequests).toHaveBeenCalledOnce();
    expect(mocked.listOpenPullRequests).toHaveBeenCalledWith('eltmon', 'overdeck');
    expect(mocked.listMergedPullRequestHeads).toHaveBeenCalledWith(
      'eltmon',
      'overdeck',
      expect.arrayContaining(['feature/pan-1', 'feature/pan-2', 'feature/pan-3', 'feature/pan-4']),
    );
    expect(mocked.run).not.toHaveBeenCalledWith('gh', expect.anything(), expect.anything());
  });

  it('gathers tracker, branch, and spec lenses for a non-GitHub polyrepo', async () => {
    const mocked = deps();
    mocked.listTrackerIssues = vi.fn().mockResolvedValue([
      { issueId: 'MIN-1', state: 'open', labels: ['in-progress'] },
      { issueId: 'MIN-2', state: 'closed', labels: [] },
      { issueId: 'MIN-3', state: 'closed', labels: [] },
    ]);
    mocked.listSpecIssueIds = vi.fn().mockResolvedValue(['MIN-3']);
    mocked.run = vi.fn().mockImplementation(async (_command, args, cwd) => {
      if (cwd === '/myn/frontend') {
        return args.includes('--no-merged=main') ? 'feature/min-2\n' : 'feature/min-2\n';
      }
      if (cwd === '/myn/api') return '';
      throw new Error(`Unexpected repository: ${cwd}`);
    });
    const mixedTrackerProject: ProjectConfig = {
      name: 'mind-your-now',
      path: '/myn',
      issue_prefix: 'MIN',
      gitlab_repo: 'eltmon/mind-your-now',
      workspace: {
        type: 'polyrepo',
        repos: [
          { name: 'fe', path: 'frontend' },
          { name: 'api', path: 'api' },
        ],
      },
    };

    await expect(gatherProjectLensSignals(mixedTrackerProject, mocked)).resolves.toEqual([
      { issueId: 'MIN-1', issueOpen: true, hasOpenPr: false, hasMergedPr: false, hasConventionBranch: false, branchUnmerged: false, hasMergedBranchWork: false, phaseLabel: 'in-progress', hasVbriefSpec: false, explicitlyReady: false },
      { issueId: 'MIN-2', issueOpen: false, hasOpenPr: false, hasMergedPr: false, hasConventionBranch: true, branchUnmerged: true, hasMergedBranchWork: false, phaseLabel: null, hasVbriefSpec: false, explicitlyReady: false },
      { issueId: 'MIN-3', issueOpen: false, hasOpenPr: false, hasMergedPr: false, hasConventionBranch: false, branchUnmerged: false, hasMergedBranchWork: false, phaseLabel: null, hasVbriefSpec: true, explicitlyReady: false },
    ]);
    expect(mocked.listTrackerIssues).toHaveBeenCalledWith(mixedTrackerProject);
    expect(mocked.listOpenIssues).not.toHaveBeenCalled();
    expect(mocked.listOpenPullRequests).not.toHaveBeenCalled();
    expect(mocked.listMergedPullRequestHeads).not.toHaveBeenCalled();
    expect(mocked.listIssueStates).not.toHaveBeenCalled();
    expect(mocked.run).toHaveBeenCalledTimes(6);
  });

  it('rejects GitHub projects without an issue prefix', async () => {
    await expect(gatherProjectLensSignals({ ...project, issue_prefix: undefined }, deps()))
      .rejects.toThrow('Missing issue_prefix');
  });

  it('ignores foreign refs, specs, and fork pull requests', async () => {
    const mocked = deps();
    mocked.listOpenIssues = vi.fn().mockResolvedValue([]);
    mocked.listPhaseLabeledIssues = vi.fn().mockResolvedValue([]);
    mocked.listOpenPullRequests = vi.fn().mockResolvedValue([
      { headRefName: 'feature/pan-2', headRepoFullName: 'someone/overdeck' },
      { headRefName: 'feature/krux-3', headRepoFullName: 'eltmon/overdeck' },
    ]);
    mocked.listSpecIssueIds = vi.fn().mockResolvedValue(['KRUX-4']);
    mocked.run = vi.fn().mockResolvedValue('feature/krux-5\nstrike/krux-9\n');

    await expect(gatherProjectLensSignals(project, mocked)).resolves.toEqual([]);
  });

  it('resolves issue states with one bulk dependency call', async () => {
    const mocked = deps();
    mocked.listOpenIssues = vi.fn().mockResolvedValue([]);
    mocked.listOpenPullRequests = vi.fn().mockResolvedValue([]);
    mocked.listMergedPullRequestHeads = vi.fn().mockResolvedValue([]);
    mocked.listSpecIssueIds = vi.fn().mockResolvedValue(
      Array.from({ length: 40 }, (_, index) => `PAN-${index + 1}`),
    );
    mocked.listIssueStates = vi.fn().mockImplementation(async (_owner, _repo, numbers: number[]) =>
      numbers.map((number) => ({ number, state: 'closed' as const })));

    await gatherProjectLensSignals(project, mocked);

    expect(mocked.listIssueStates).toHaveBeenCalledOnce();
    expect(mocked.listIssueStates).toHaveBeenCalledWith('eltmon', 'overdeck', expect.arrayContaining([1, 40]));
    expect(mocked.listMergedPullRequestHeads).toHaveBeenCalledOnce();
    expect(mocked.listMergedPullRequestHeads).toHaveBeenCalledWith(
      'eltmon',
      'overdeck',
      expect.arrayContaining(['feature/pan-1', 'feature/pan-40']),
    );
  });

  it('checks merged PR history only for active candidate heads', async () => {
    const mocked = deps();
    mocked.listOpenIssues = vi.fn().mockResolvedValue([]);
    mocked.listOpenPullRequests = vi.fn().mockResolvedValue([]);
    mocked.listSpecIssueIds = vi.fn().mockResolvedValue(['PAN-10', 'PAN-11']);
    mocked.run = vi.fn().mockResolvedValue('');
    mocked.listMergedPullRequestHeads = vi.fn().mockResolvedValue([]);

    await gatherProjectLensSignals(project, mocked);

    expect(mocked.listMergedPullRequestHeads).toHaveBeenCalledOnce();
    expect(mocked.listMergedPullRequestHeads).toHaveBeenCalledWith(
      'eltmon',
      'overdeck',
      ['feature/pan-10', 'strike/pan-10', 'feature/pan-11', 'strike/pan-11'],
    );
  });

  it('resolves merged PR heads in fixed-size project-scoped GraphQL chunks', async () => {
    const heads = Array.from({ length: 120 }, (_, index) => `feature/pan-${index + 1}`);
    const runGraphql = vi.fn().mockImplementation(async (query: string) => JSON.stringify({
      data: { repository: Object.fromEntries(
        [...query.matchAll(/(h\d+): pullRequests/g)].map((match, index) => [match[1], {
          nodes: index === 0
            ? [{ headRepository: { name: 'overdeck', owner: { login: 'eltmon' } } }]
            : [],
        }]),
      ) },
    }));

    const merged = await listMergedPullRequestHeadsBatched('eltmon', 'overdeck', heads, runGraphql);

    expect(merged).toEqual(['feature/pan-1', 'feature/pan-51', 'feature/pan-101']);
    expect(runGraphql).toHaveBeenCalledTimes(3);
    expect(runGraphql.mock.calls.map(([query]) => query.match(/pullRequests\(/g)?.length))
      .toEqual([50, 50, 20]);
  });

  it('does not attribute a fork PR with a colliding head name to the project', async () => {
    const runGraphql = vi.fn().mockResolvedValue(JSON.stringify({
      data: { repository: {
        h0: { nodes: [{ headRepository: { name: 'overdeck', owner: { login: 'someone-else' } } }] },
      } },
    }));

    await expect(listMergedPullRequestHeadsBatched(
      'eltmon', 'overdeck', ['feature/pan-12'], runGraphql,
    )).resolves.toEqual([]);
  });

  it('matches merged PR repository identity without case sensitivity', async () => {
    const runGraphql = vi.fn().mockResolvedValue(JSON.stringify({
      data: { repository: {
        h0: { nodes: [{ headRepository: { name: 'overdeck', owner: { login: 'eltmon' } } }] },
      } },
    }));

    await expect(listMergedPullRequestHeadsBatched(
      'EltMon', 'OverDeck', ['feature/pan-12'], runGraphql,
    )).resolves.toEqual(['feature/pan-12']);
  });

  it('resolves every candidate issue state in one project-scoped GraphQL call', async () => {
    const runGraphql = vi.fn().mockResolvedValue(JSON.stringify({
      data: { repository: { i0: { state: 'OPEN' }, i1: { state: 'CLOSED' } } },
    }));

    await expect(listIssueStatesBatched('eltmon', 'overdeck', [10, 11], runGraphql)).resolves.toEqual([
      { number: 10, state: 'open' },
      { number: 11, state: 'closed' },
    ]);
    expect(runGraphql).toHaveBeenCalledOnce();
  });

  it('skips numbers that are not issues instead of failing the batch (PR-numbered strike branch)', async () => {
    // strike/pan-2778 pointed at a PR number: GraphQL resolves that alias to
    // null and reports a per-field error, but the other aliases stay usable.
    // One bad number must not zero out membership for the whole project.
    const runGraphql = vi.fn().mockResolvedValue(JSON.stringify({
      data: { repository: { i0: { state: 'OPEN' }, i1: null } },
      errors: [{ message: 'Could not resolve to an Issue with the number of 2778.' }],
    }));

    await expect(listIssueStatesBatched('eltmon', 'overdeck', [10, 2778], runGraphql)).resolves.toEqual([
      { number: 10, state: 'open' },
    ]);
  });

  it('resolves issue states in fixed-size project-scoped GraphQL chunks', async () => {
    const numbers = Array.from({ length: 101 }, (_, index) => index + 1);
    const runGraphql = vi.fn().mockImplementation(async (query: string) => JSON.stringify({
      data: { repository: Object.fromEntries(
        [...query.matchAll(/(i\d+): issue/g)].map((match) => [match[1], { state: 'CLOSED' }]),
      ) },
    }));

    const states = await listIssueStatesBatched('eltmon', 'overdeck', numbers, runGraphql);

    expect(states).toHaveLength(101);
    expect(runGraphql).toHaveBeenCalledTimes(3);
    expect(runGraphql.mock.calls.map(([query]) => query.match(/issue\(/g)?.length))
      .toEqual([50, 50, 1]);
  });

  it('preserves the explicit ready label as a durable membership lens', async () => {
    const mocked = deps();
    mocked.listOpenIssues = vi.fn().mockResolvedValue([{ number: 12, labels: ['ready'] }]);
    mocked.listOpenPullRequests = vi.fn().mockResolvedValue([]);
    mocked.listMergedPullRequestHeads = vi.fn().mockResolvedValue([]);
    mocked.listSpecIssueIds = vi.fn().mockResolvedValue([]);
    mocked.run = vi.fn().mockResolvedValue('');

    const [signal] = await gatherProjectLensSignals(project, mocked);

    expect(signal).toMatchObject({ issueId: 'PAN-12', issueOpen: true, explicitlyReady: true });
    expect(resolvePipelineMembership(signal!).inPipeline).toBe(true);
  });

  it('gathers closed phase-label-only drift as clean terminal', async () => {
    const mocked = deps();
    mocked.listOpenIssues = vi.fn().mockResolvedValue([]);
    mocked.listPhaseLabeledIssues = vi.fn().mockResolvedValue([
      { number: 13, state: 'closed', labels: ['in-review'] },
    ]);
    mocked.listOpenPullRequests = vi.fn().mockResolvedValue([]);
    mocked.listMergedPullRequestHeads = vi.fn().mockResolvedValue([]);
    mocked.listSpecIssueIds = vi.fn().mockResolvedValue([]);
    mocked.run = vi.fn().mockResolvedValue('');

    const [signal] = await gatherProjectLensSignals(project, mocked);

    expect(resolvePipelineMembership(signal!)).toMatchObject({
      issueId: 'PAN-13', inPipeline: false, bucket: 'clean_terminal', labelDrift: 'stale_present',
    });
  });

  it('rejects partial GraphQL responses instead of synthesizing negative signals', async () => {
    const partial = vi.fn().mockResolvedValue(JSON.stringify({
      data: { repository: {} }, errors: [{ message: 'partial' }],
    }));

    await expect(listMergedPullRequestHeadsBatched(
      'eltmon', 'overdeck', ['feature/pan-1'], partial,
    )).rejects.toThrow('Incomplete merged-PR GraphQL response');
    // Per-field errors with data present are tolerated (see the PR-numbered
    // strike-branch test), but an alias absent from the response still rejects —
    // a missing answer is never synthesized into a negative signal.
    await expect(listIssueStatesBatched('eltmon', 'overdeck', [1], partial))
      .rejects.toThrow('Missing issue-state alias i0');
  });

  it('accepts an explicit null issue alias but rejects an omitted alias', async () => {
    const explicitNull = vi.fn().mockResolvedValue(JSON.stringify({
      data: { repository: { i0: null } },
    }));
    const omitted = vi.fn().mockResolvedValue(JSON.stringify({ data: { repository: {} } }));

    await expect(listIssueStatesBatched('eltmon', 'overdeck', [404], explicitNull)).resolves.toEqual([]);
    await expect(listIssueStatesBatched('eltmon', 'overdeck', [404], omitted))
      .rejects.toThrow('Missing issue-state alias i0');
  });

  it('lets the resolver correct squash lineage using the merged-PR oracle', async () => {
    const result = await gatherProjectLensSignals(project, deps());
    expect(resolvePipelineMembership(result.find((signal) => signal.issueId === 'PAN-1')!).bucket)
      .toBe('post_merge_limbo');
  });

  it('keeps forbidden disposable-state and synchronous process imports out of the gatherer', async () => {
    const entry = fileURLToPath(new URL('../../../src/lib/pipeline-membership-gather.ts', import.meta.url));
    const graph = await collectRelativeImportGraph(entry);
    const forbiddenModule = /\/database\/|review-status|agent-state|tmux/;
    expect([
      '/repo/src/lib/database/agents-db.ts',
      '/repo/src/lib/review-status-normalize.ts',
      '/repo/src/lib/overdeck/agent-state-sync.ts',
      '/repo/src/lib/runtimes/tmux-cli.ts',
    ].every((path) => forbiddenModule.test(path))).toBe(true);
    expect([...graph].filter((path) => forbiddenModule.test(path))).toEqual([]);

    const source = await readFile(entry, 'utf-8');
    expect(source).not.toMatch(/execSync|spawnSync/);
  });
});
