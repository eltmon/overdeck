import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MEMBERSHIP_UNAVAILABLE_REASONS,
  type MembershipUnavailableReason,
} from '@overdeck/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  gatherIssueBranchContainment,
  gatherProjectLensSignals,
  mapPipelineProjects,
  PIPELINE_PROJECT_CONCURRENCY,
  listIssueStatesBatched,
  listMergedPullRequestHeadsBatched,
  PipelineMembershipUnavailableError,
  projectRepositories,
  resolveRepositoryDefaultBranch,
  snapshotBranchRefs,
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
    listOpenIssues: vi.fn().mockResolvedValue([
      { number: 1, labels: ['in-review'] },
      { number: 4, labels: [] },
    ]),
    listPhaseLabeledIssues: vi.fn().mockResolvedValue([]),
    listOpenPullRequests: vi.fn().mockResolvedValue([{
      headRefName: 'feature/pan-2', headRepoFullName: 'eltmon/overdeck',
    }]),
    listOpenMergeRequests: vi.fn().mockResolvedValue([]),
    listMergedPullRequestHeads: vi.fn().mockResolvedValue(['feature/pan-1']),
    listMergedMergeRequestHeads: vi.fn().mockResolvedValue([]),
    listIssueStates: vi.fn().mockImplementation(async (_owner, _repo, numbers: number[]) =>
      numbers.map((number) => ({ number, state: number === 4 ? 'open' as const : 'closed' as const }))),
    listTrackerIssues: vi.fn().mockResolvedValue([]),
    listSpecIssueIds: vi.fn().mockResolvedValue(['PAN-4']),
    hasTerminalCloseOutRecord: vi.fn().mockResolvedValue(false),
    batchHasTerminalCloseOutRecords: vi.fn().mockImplementation(async (_project, issueIds: string[]) => {
      const result = new Map<string, boolean>();
      for (const id of issueIds) {
        result.set(id, false);
      }
      return result;
    }),
    run: vi.fn().mockImplementation(async (command, args, cwd) => {
      if (command === 'git' && args[0] === 'rev-parse') return cwd;
      if (command === 'git' && args.includes('--no-merged=main')) return 'feature/pan-1\norigin/feature/pan-3\n';
      if (command === 'git') return 'feature/pan-1\norigin/feature/pan-3\n';
      throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
    }),
  };
}

describe('pipeline membership unavailability contract', () => {
  it('exports the ordered reason set used by the typed gather error', () => {
    const expectedReasons: MembershipUnavailableReason[] = [
      'missing_issue_prefix',
      'repo_unavailable',
      'default_branch_unresolved',
      'forge_unavailable',
      'tracker_unconfigured',
      'gather_failed',
    ];

    expect(MEMBERSHIP_UNAVAILABLE_REASONS).toEqual(expectedReasons);

    const error = new PipelineMembershipUnavailableError('repo_unavailable', 'msg');
    expect(error).toMatchObject({
      name: 'PipelineMembershipUnavailableError',
      reason: 'repo_unavailable',
      message: 'msg',
    });
  });
});

describe('resolveRepositoryDefaultBranch', () => {
  it('returns a verifiable configured branch without probing fallbacks', async () => {
    const run = vi.fn().mockImplementation(async (_command: string, args: string[]) => {
      if (args.at(-1) === 'refs/heads/main') return 'aaa\n';
      throw new Error(`Unexpected command: ${args.join(' ')}`);
    });

    await expect(resolveRepositoryDefaultBranch('/repo', 'main', run)).resolves.toBe('main');
    expect(run).toHaveBeenCalledOnce();
    expect(run).not.toHaveBeenCalledWith('git', expect.arrayContaining(['symbolic-ref']), '/repo');
  });

  it('throws typed default_branch_unresolved when no repository refs verify', async () => {
    const run = vi.fn().mockRejectedValue(new Error('unknown revision'));

    await expect(resolveRepositoryDefaultBranch('/repo', 'develop', run)).rejects.toMatchObject({
      reason: 'default_branch_unresolved',
      message: expect.stringMatching(/\/repo.*develop/),
    });
  });

  it('rejects an unborn symbolic HEAD whose target ref does not exist', async () => {
    const run = vi.fn().mockImplementation(async (_command: string, args: string[]) => {
      if (args[0] === 'symbolic-ref' && args.at(-1) === 'HEAD') return 'main\n';
      throw new Error('unknown revision');
    });

    await expect(resolveRepositoryDefaultBranch('/empty-repo', 'main', run)).rejects.toMatchObject({
      reason: 'default_branch_unresolved',
      message: expect.stringContaining('/empty-repo'),
    });
    expect(run).toHaveBeenCalledWith(
      'git',
      ['rev-parse', '--verify', '--quiet', 'refs/heads/main'],
      '/empty-repo',
    );
  });
});

describe('snapshotBranchRefs', () => {
  const refPatterns = ['refs/heads/feature/*'];

  it('throws typed repo_unavailable when git rejects the configured path', async () => {
    const run = vi.fn().mockRejectedValue(new Error('not a git repository'));

    await expect(snapshotBranchRefs('/missing/repo', 'main', refPatterns, run)).rejects.toMatchObject({
      name: 'PipelineMembershipUnavailableError',
      reason: 'repo_unavailable',
      message: expect.stringContaining('/missing/repo'),
    });
  });

  it('throws typed repo_unavailable when git resolves an unrelated parent repository', async () => {
    const run = vi.fn().mockResolvedValue('/other/repo\n');

    await expect(snapshotBranchRefs('/expected/repo', 'main', refPatterns, run)).rejects.toMatchObject({
      reason: 'repo_unavailable',
      message: expect.stringContaining('/expected/repo'),
    });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('falls through a dangling origin HEAD to a verifiable current branch', async () => {
    const run = vi.fn().mockImplementation(async (_command: string, args: string[]) => {
      if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return '/master-only\n';
      if (args[0] === 'rev-parse' && args.at(-1) === 'refs/heads/master') return 'aaa\n';
      if (args[0] === 'rev-parse') throw new Error('unknown revision');
      if (args[0] === 'symbolic-ref' && args.at(-1) === 'refs/remotes/origin/HEAD') {
        return 'origin/main\n';
      }
      if (args[0] === 'symbolic-ref' && args.at(-1) === 'HEAD') return 'master\n';
      if (args[0] === 'rev-list') return 'aaa\n';
      return '';
    });

    await snapshotBranchRefs('/master-only', 'main', refPatterns, run);

    expect(run).toHaveBeenCalledWith(
      'git',
      ['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/main'],
      '/master-only',
    );
    expect(run).toHaveBeenCalledWith(
      'git',
      ['rev-parse', '--verify', '--quiet', 'refs/heads/master'],
      '/master-only',
    );
    expect(run).toHaveBeenCalledWith('git', ['rev-list', '--first-parent', 'master'], '/master-only');
    expect(run).toHaveBeenCalledWith('git', expect.arrayContaining(['--no-merged=master']), '/master-only');
  });

  it('gathers branch refs after the configured path matches the git toplevel', async () => {
    const run = vi.fn().mockImplementation(async (_command: string, args: string[]) => {
      if (args[0] === 'rev-parse') return '/expected/repo\n';
      if (args.includes('--no-merged=main')) return 'feature/pan-2\n';
      if (args[0] === 'rev-list') return 'aaa\n';
      return 'bbb feature/pan-1\n';
    });

    await expect(snapshotBranchRefs('/expected/repo', 'main', refPatterns, run)).resolves.toEqual({
      refs: 'bbb feature/pan-1\n',
      unmergedRefs: 'feature/pan-2\n',
      firstParentShas: 'aaa\n',
    });
    expect(run).toHaveBeenCalledWith('git', ['rev-parse', '--show-toplevel'], '/expected/repo');
    expect(run).toHaveBeenCalledWith('git', [
      'for-each-ref', '--format=%(objectname) %(refname:short)', ...refPatterns,
    ], '/expected/repo');
    expect(run).toHaveBeenCalledWith('git', [
      'for-each-ref', '--no-merged=main', '--format=%(refname:short)', ...refPatterns,
    ], '/expected/repo');
    expect(run).toHaveBeenCalledWith('git', ['rev-list', '--first-parent', 'main'], '/expected/repo');
  });
});

describe('gatherIssueBranchContainment', () => {
  it('classifies merged work, pointers, and unmerged feature and strike refs', async () => {
    const run = vi.fn().mockImplementation(async (command: string, args: string[], cwd?: string) => {
      expect(command).toBe('git');
      expect(cwd).toBe(project.path);
      if (args[0] === 'rev-parse') return cwd;
      if (args[0] === 'rev-list') return 'aaa\n';
      if (args.includes('--no-merged=main')) return 'strike/pan-3109\norigin/strike/pan-3109\n';
      return [
        'bbb feature/pan-3109',
        'aaa origin/feature/pan-3109',
        'ccc strike/pan-3109',
        'ddd origin/strike/pan-3109',
      ].join('\n');
    });

    await expect(gatherIssueBranchContainment(project, 'PAN-3109', run)).resolves.toEqual({
      mergedWorkRefs: ['/project:feature/pan-3109'],
      mergedWorkHeads: [{ ref: '/project:feature/pan-3109', head: 'bbb' }],
      pointerRefs: ['/project:origin/feature/pan-3109'],
      unmergedRefs: ['/project:strike/pan-3109', '/project:origin/strike/pan-3109'],
    });
    expect(run).toHaveBeenCalledWith('git', [
      'for-each-ref',
      '--format=%(objectname) %(refname:short)',
      'refs/heads/feature/pan-3109',
      'refs/remotes/origin/feature/pan-3109',
      'refs/heads/strike/pan-3109',
      'refs/remotes/origin/strike/pan-3109',
    ], project.path);
  });

  it('aggregates polyrepo refs using each repository default branch', async () => {
    const polyrepoProject: ProjectConfig = {
      name: 'mind-your-now',
      path: '/myn',
      issue_prefix: 'MIN',
      workspace: {
        type: 'polyrepo',
        default_branch: 'develop',
        repos: [
          { name: 'fe', path: 'frontend', default_branch: 'main' },
          { name: 'api', path: 'api' },
        ],
      },
    };
    const run = vi.fn().mockImplementation(async (_command: string, args: string[], cwd?: string) => {
      if (args[0] === 'rev-parse') return cwd;
      if (args[0] === 'rev-list') return cwd === '/myn/frontend' ? 'front-main\n' : 'api-main\n';
      if (args.some((arg) => arg.startsWith('--no-merged='))) return '';
      if (cwd === '/myn/frontend') return 'front-merge feature/min-873\n';
      if (cwd === '/myn/api') return 'api-main feature/min-873\n';
      throw new Error(`Unexpected repository: ${cwd}`);
    });

    await expect(gatherIssueBranchContainment(polyrepoProject, 'MIN-873', run)).resolves.toEqual({
      mergedWorkRefs: ['/myn/frontend:feature/min-873'],
      mergedWorkHeads: [{ ref: '/myn/frontend:feature/min-873', head: 'front-merge' }],
      pointerRefs: ['/myn/api:feature/min-873'],
      unmergedRefs: [],
    });
    expect(run).toHaveBeenCalledWith('git', ['rev-list', '--first-parent', 'main'], '/myn/frontend');
    expect(run).toHaveBeenCalledWith('git', ['rev-list', '--first-parent', 'develop'], '/myn/api');
    expect(run).toHaveBeenCalledWith('git', expect.arrayContaining([
      '--no-merged=main',
      'refs/remotes/origin/strike/min-873',
    ]), '/myn/frontend');
    expect(run).toHaveBeenCalledWith('git', expect.arrayContaining([
      '--no-merged=develop',
      'refs/remotes/origin/strike/min-873',
    ]), '/myn/api');
  });

  it('classifies git snapshot failures as repo_unavailable', async () => {
    const run = vi.fn().mockRejectedValue(new Error('git unavailable'));

    await expect(gatherIssueBranchContainment(project, 'PAN-3109', run)).rejects.toMatchObject({
      reason: 'repo_unavailable',
      message: expect.stringContaining(project.path),
    });
  });
});

describe('projectRepositories', () => {
  it('resolves forge for monorepo with gitlab_repo set and no github_repo', () => {
    const monoGitLabProject: ProjectConfig = {
      name: 'test',
      path: '/test',
      issue_prefix: 'TEST',
      gitlab_repo: 'test/test',
    };

    const repos = projectRepositories(monoGitLabProject);
    expect(repos).toHaveLength(1);
    expect(repos[0]).toMatchObject({
      path: '/test',
      defaultBranch: 'main',
      forge: 'gitlab',
    });
  });

  it('resolves per-repo forge for polyrepo with mixed remotes', () => {
    const polyrepoProject: ProjectConfig = {
      name: 'test',
      path: '/test',
      issue_prefix: 'TEST',
      gitlab_repo: 'test/test',
      workspace: {
        type: 'polyrepo',
        repos: [
          { name: 'fe', path: 'frontend', remote: 'github' },
          { name: 'api', path: 'api' },
        ],
      },
    };

    const repos = projectRepositories(polyrepoProject);
    expect(repos).toHaveLength(2);
    expect(repos[0]).toMatchObject({
      path: '/test/frontend',
      defaultBranch: 'main',
      forge: 'github',
      repoKey: 'fe',
    });
    expect(repos[1]).toMatchObject({
      path: '/test/api',
      defaultBranch: 'main',
      forge: 'gitlab',
      repoKey: 'api',
    });
  });
});

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
      { issueId: 'PAN-1', issueOpen: true, hasOpenPr: false, hasMergedPr: true, hasConventionBranch: true, branchUnmerged: true, hasMergedBranchWork: false, phaseLabel: 'in-review', hasXbriefSpec: false, explicitlyReady: false, hasTerminalCloseOut: false },
      { issueId: 'PAN-2', issueOpen: false, hasOpenPr: true, hasMergedPr: false, hasConventionBranch: false, branchUnmerged: false, hasMergedBranchWork: false, phaseLabel: null, hasXbriefSpec: false, explicitlyReady: false, hasTerminalCloseOut: false },
      { issueId: 'PAN-3', issueOpen: false, hasOpenPr: false, hasMergedPr: false, hasConventionBranch: true, branchUnmerged: true, hasMergedBranchWork: false, phaseLabel: null, hasXbriefSpec: false, explicitlyReady: false, hasTerminalCloseOut: false },
      { issueId: 'PAN-4', issueOpen: true, hasOpenPr: false, hasMergedPr: false, hasConventionBranch: false, branchUnmerged: false, hasMergedBranchWork: false, phaseLabel: null, hasXbriefSpec: true, explicitlyReady: false, hasTerminalCloseOut: false },
    ]);
  });

  it('PAN-2887: contained branch off main first-parent line yields hasMergedBranchWork; fresh zero-ahead branch does not', async () => {
    const mocked = deps();
    mocked.listOpenIssues = vi.fn().mockResolvedValue([{ number: 7, labels: [] }, { number: 8, labels: [] }]);
    mocked.listOpenPullRequests = vi.fn().mockResolvedValue([]);
    mocked.listMergedPullRequestHeads = vi.fn().mockResolvedValue([]);
    mocked.listSpecIssueIds = vi.fn().mockResolvedValue([]);
    mocked.run = vi.fn().mockImplementation(async (command, args: string[], cwd?: string) => {
      if (command !== 'git') throw new Error(`Unexpected command: ${command}`);
      if (args[0] === 'rev-parse') return cwd;
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
    mocked.run = vi.fn().mockImplementation(async (command, args, cwd) => {
      if (command === 'git' && args[0] === 'rev-parse') return cwd;
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
      ['strike/pan-20', 'feature/pan-20'],
    );
    expect(result).toEqual([
      { issueId: 'PAN-20', issueOpen: true, hasOpenPr: false, hasMergedPr: false, hasConventionBranch: true, branchUnmerged: true, hasMergedBranchWork: false, phaseLabel: null, hasXbriefSpec: false, explicitlyReady: false, hasTerminalCloseOut: false },
      { issueId: 'PAN-21', issueOpen: false, hasOpenPr: false, hasMergedPr: false, hasConventionBranch: true, branchUnmerged: true, hasMergedBranchWork: false, phaseLabel: null, hasXbriefSpec: false, explicitlyReady: false, hasTerminalCloseOut: false },
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
    mocked.run = vi.fn().mockImplementation(async (_command, args, cwd) =>
      args[0] === 'rev-parse' ? cwd : 'strike/pan-2879\nstrike/pan-2778\n');

    await expect(gatherProjectLensSignals(project, mocked)).resolves.toEqual([
      { issueId: 'PAN-2879', issueOpen: true, hasOpenPr: false, hasMergedPr: false, hasConventionBranch: true, branchUnmerged: true, hasMergedBranchWork: false, phaseLabel: null, hasXbriefSpec: false, explicitlyReady: false, hasTerminalCloseOut: false },
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
    mocked.run = vi.fn().mockImplementation(async (_command, args, cwd) =>
      args[0] === 'rev-parse' ? cwd : '');

    const result = await gatherProjectLensSignals(project, mocked);

    expect(result).toEqual([{
      issueId: 'PAN-22',
      issueOpen: true,
      hasOpenPr: true,
      hasMergedPr: false,
      hasConventionBranch: false,
      branchUnmerged: false, hasMergedBranchWork: false,
      phaseLabel: null,
      hasXbriefSpec: false,
      explicitlyReady: false,
      hasTerminalCloseOut: false,
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
    mocked.run = vi.fn().mockImplementation(async (_command, args, cwd) =>
      args[0] === 'rev-parse' ? cwd : '');

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
      hasXbriefSpec: false,
      explicitlyReady: false,
      hasTerminalCloseOut: false,
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
    mocked.run = vi.fn().mockImplementation(async (command, args, cwd) => {
      if (command === 'git' && args[0] === 'rev-parse') return cwd;
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
      hasXbriefSpec: false,
      explicitlyReady: false,
      hasTerminalCloseOut: false,
    }]);
    expect(resolvePipelineMembership(result[0]!)).toMatchObject({
      bucket: 'post_merge_limbo',
      inPipeline: true,
    });
  });

  it('lists open PRs once and checks merged history only for open candidates', async () => {
    const mocked = deps();
    await gatherProjectLensSignals(project, mocked);
    expect(mocked.listOpenPullRequests).toHaveBeenCalledOnce();
    expect(mocked.listOpenPullRequests).toHaveBeenCalledWith('eltmon', 'overdeck');
    expect(mocked.listMergedPullRequestHeads).toHaveBeenCalledWith(
      'eltmon',
      'overdeck',
      ['feature/pan-1', 'strike/pan-1', 'feature/pan-4', 'strike/pan-4'],
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
      if (args[0] === 'rev-parse') return cwd;
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
      { issueId: 'MIN-1', issueOpen: true, hasOpenPr: false, hasMergedPr: false, hasConventionBranch: false, branchUnmerged: false, hasMergedBranchWork: false, phaseLabel: 'in-progress', hasXbriefSpec: false, explicitlyReady: false, hasTerminalCloseOut: false },
      { issueId: 'MIN-2', issueOpen: false, hasOpenPr: false, hasMergedPr: false, hasConventionBranch: true, branchUnmerged: true, hasMergedBranchWork: false, phaseLabel: null, hasXbriefSpec: false, explicitlyReady: false, hasTerminalCloseOut: false },
      { issueId: 'MIN-3', issueOpen: false, hasOpenPr: false, hasMergedPr: false, hasConventionBranch: false, branchUnmerged: false, hasMergedBranchWork: false, phaseLabel: null, hasXbriefSpec: true, explicitlyReady: false, hasTerminalCloseOut: false },
    ]);
    expect(mocked.listTrackerIssues).toHaveBeenCalledWith(mixedTrackerProject);
    expect(mocked.listOpenIssues).not.toHaveBeenCalled();
    expect(mocked.listOpenPullRequests).not.toHaveBeenCalled();
    expect(mocked.listMergedPullRequestHeads).not.toHaveBeenCalled();
    expect(mocked.listIssueStates).not.toHaveBeenCalled();
    expect(mocked.run).toHaveBeenCalledTimes(10);
  });

  it('uses the configured Linear tracker when code is hosted on GitHub', async () => {
    const mocked = deps();
    mocked.listTrackerIssues = vi.fn().mockResolvedValue([
      { issueId: 'LEX-1', state: 'open', labels: ['in-progress'] },
    ]);
    mocked.listOpenIssues = vi.fn().mockRejectedValue(new Error('GitHub issues must not be queried'));
    mocked.listPhaseLabeledIssues = vi.fn().mockRejectedValue(new Error('GitHub issue labels must not be queried'));
    mocked.listOpenPullRequests = vi.fn().mockResolvedValue([{
      headRefName: 'feature/lex-1', headRepoFullName: 'eltmon/lexerra',
    }]);
    mocked.listMergedPullRequestHeads = vi.fn().mockResolvedValue([]);
    mocked.listSpecIssueIds = vi.fn().mockResolvedValue([]);
    mocked.run = vi.fn().mockImplementation(async (_command, args, cwd) =>
      args[0] === 'rev-parse' ? cwd : '');
    const linearTrackerWithGitHubCode: ProjectConfig = {
      name: 'lexerra',
      path: '/lexerra',
      issue_prefix: 'LEX',
      tracker: 'linear',
      github_repo: 'eltmon/lexerra',
    };

    await expect(gatherProjectLensSignals(linearTrackerWithGitHubCode, mocked)).resolves.toEqual([{
      issueId: 'LEX-1',
      issueOpen: true,
      hasOpenPr: true,
      hasMergedPr: false,
      hasConventionBranch: false,
      branchUnmerged: false,
      hasMergedBranchWork: false,
      phaseLabel: 'in-progress',
      hasXbriefSpec: false,
      explicitlyReady: false,
      hasTerminalCloseOut: false,
    }]);
    expect(mocked.listTrackerIssues).toHaveBeenCalledWith(linearTrackerWithGitHubCode);
    expect(mocked.listOpenIssues).not.toHaveBeenCalled();
    expect(mocked.listPhaseLabeledIssues).not.toHaveBeenCalled();
    expect(mocked.listOpenPullRequests).toHaveBeenCalledWith('eltmon', 'lexerra');
    expect(mocked.listIssueStates).not.toHaveBeenCalled();
  });

  it('names the resolved tracker when its issue query fails', async () => {
    const mocked = deps();
    mocked.listTrackerIssues = vi.fn().mockRejectedValue(new Error('Linear API unavailable'));
    const linearTrackerWithGitHubCode: ProjectConfig = {
      name: 'lexerra',
      path: '/lexerra',
      issue_prefix: 'LEX',
      tracker: 'linear',
      github_repo: 'eltmon/lexerra',
    };

    await expect(gatherProjectLensSignals(linearTrackerWithGitHubCode, mocked)).rejects.toMatchObject({
      reason: 'forge_unavailable',
      message: 'Resolved linear tracker for lexerra: Linear API unavailable',
    });
  });

  it('classifies a missing GitHub issue prefix', async () => {
    await expect(gatherProjectLensSignals({ ...project, issue_prefix: undefined }, deps()))
      .rejects.toMatchObject({
        reason: 'missing_issue_prefix',
        message: expect.stringContaining(project.name),
      });
  });

  it('classifies a path-only project (no tracker configured) as tracker_unconfigured', async () => {
    const pathOnlyProject: ProjectConfig = {
      name: 'papers-please',
      path: '/projects/papers-please',
    };
    await expect(gatherProjectLensSignals(pathOnlyProject, deps()))
      .rejects.toMatchObject({
        reason: 'tracker_unconfigured',
        message: expect.stringContaining('papers-please'),
      });
  });

  it('classifies a project with tracker but no prefix as missing_issue_prefix (tracker precedence)', async () => {
    const trackerProjectNoPrefix: ProjectConfig = {
      name: 'puzzdom',
      path: '/projects/puzzdom',
      gitlab_repo: 'puzzdom/puzzdom',
    };
    await expect(gatherProjectLensSignals(trackerProjectNoPrefix, deps()))
      .rejects.toMatchObject({
        reason: 'missing_issue_prefix',
        message: expect.stringContaining('puzzdom'),
      });
  });

  it('classifies forge lens failures without parsing their messages', async () => {
    const mocked = deps();
    mocked.listOpenIssues = vi.fn().mockRejectedValue(new Error('HTTP 404'));

    await expect(gatherProjectLensSignals(project, mocked)).rejects.toMatchObject({
      reason: 'forge_unavailable',
      message: 'Resolved github tracker for overdeck: HTTP 404',
    });
  });

  it('classifies spec lens failures as gather_failed', async () => {
    const mocked = deps();
    mocked.listSpecIssueIds = vi.fn().mockRejectedValue(new Error('spec read failed'));

    await expect(gatherProjectLensSignals(project, mocked)).rejects.toMatchObject({
      reason: 'gather_failed',
      message: 'spec read failed',
    });
  });

  it('preserves typed repository failures from the branch lens', async () => {
    const mocked = deps();
    mocked.run = vi.fn().mockRejectedValue(
      new PipelineMembershipUnavailableError('repo_unavailable', 'repository missing'),
    );

    await expect(gatherProjectLensSignals(project, mocked)).rejects.toMatchObject({
      reason: 'repo_unavailable',
      message: 'repository missing',
    });
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
    mocked.run = vi.fn().mockImplementation(async (_command, args, cwd) =>
      args[0] === 'rev-parse' ? cwd : 'feature/krux-5\nstrike/krux-9\n');

    await expect(gatherProjectLensSignals(project, mocked)).resolves.toEqual([]);
  });

  it('gathers GitLab open MRs for non-GitHub polyrepo and sets hasOpenPr', async () => {
    const mocked = deps();
    mocked.listTrackerIssues = vi.fn().mockResolvedValue([
      { issueId: 'MIN-864', state: 'open', labels: [] },
    ]);
    mocked.listOpenMergeRequests = vi.fn().mockResolvedValue([
      { source_branch: 'feature/min-864', web_url: 'https://gitlab.com/test/mr/1' } as any,
    ]);
    mocked.run = vi.fn().mockImplementation(async (_command, args, cwd) =>
      args[0] === 'rev-parse' ? cwd : '');
    const gitlabPolyrepo: ProjectConfig = {
      name: 'mind-your-now',
      path: '/myn',
      issue_prefix: 'MIN',
      gitlab_repo: 'test/test',
      workspace: {
        type: 'polyrepo',
        repos: [
          { name: 'fe', path: 'frontend' },
          { name: 'api', path: 'api' },
        ],
      },
    };

    const result = await gatherProjectLensSignals(gitlabPolyrepo, mocked);

    expect(result).toContainEqual(expect.objectContaining({
      issueId: 'MIN-864',
      issueOpen: true,
      hasOpenPr: true,
    }));
    // Verify the GitLab query was called for each repo
    expect(mocked.listOpenMergeRequests).toHaveBeenCalledTimes(2);
  });

  it('classifies closed issue with open GitLab MR as zombie_pr', async () => {
    const mocked = deps();
    mocked.listTrackerIssues = vi.fn().mockResolvedValue([
      { issueId: 'MIN-999', state: 'closed', labels: [] },
    ]);
    mocked.listOpenMergeRequests = vi.fn().mockResolvedValue([
      { source_branch: 'feature/min-999', web_url: 'https://gitlab.com/test/mr/99' } as any,
    ]);
    mocked.run = vi.fn().mockImplementation(async (_command, args, cwd) =>
      args[0] === 'rev-parse' ? cwd : '');
    const gitlabPolyrepo: ProjectConfig = {
      name: 'test',
      path: '/test',
      issue_prefix: 'MIN',
      gitlab_repo: 'test/test',
      workspace: {
        type: 'polyrepo',
        repos: [{ name: 'api', path: 'api' }],
      },
    };

    const result = await gatherProjectLensSignals(gitlabPolyrepo, mocked);

    const issue = result.find((r) => r.issueId === 'MIN-999');
    expect(issue).toMatchObject({
      issueOpen: false,
      hasOpenPr: true,
    });
    // Verify zombie_pr through resolvePipelineMembership (hasOpenPr + closed)
    const membership = resolvePipelineMembership(issue!);
    expect(membership).toEqual(expect.objectContaining({
      bucket: 'zombie_pr',
    }));
  });

  it('rejects when GitLab MR dep fails with forge_unavailable', async () => {
    const mocked = deps();
    mocked.listOpenMergeRequests = vi.fn().mockRejectedValue(new Error('glab unavailable'));
    const gitlabProject: ProjectConfig = {
      name: 'test',
      path: '/test',
      issue_prefix: 'TEST',
      gitlab_repo: 'test/test',
    };

    await expect(gatherProjectLensSignals(gitlabProject, mocked)).rejects.toMatchObject({
      reason: 'forge_unavailable',
      message: expect.stringContaining('glab unavailable'),
    });
  });

  it('sets hasMergedPr for open GitLab issues with merged MRs, yielding post_merge_limbo', async () => {
    const mocked = deps();
    mocked.listTrackerIssues = vi.fn().mockResolvedValue([
      { issueId: 'MIN-896', state: 'open', labels: [] },
    ]);
    mocked.listOpenMergeRequests = vi.fn().mockResolvedValue([]);
    mocked.listMergedMergeRequestHeads = vi.fn().mockResolvedValue(['feature/min-896']);
    mocked.run = vi.fn().mockImplementation(async (_command, args, cwd) =>
      args[0] === 'rev-parse' ? cwd : '');
    const gitlabPolyrepo: ProjectConfig = {
      name: 'test',
      path: '/test',
      issue_prefix: 'MIN',
      gitlab_repo: 'test/test',
      workspace: {
        type: 'polyrepo',
        repos: [
          { name: 'fe', path: 'frontend' },
          { name: 'api', path: 'api' },
        ],
      },
    };

    const result = await gatherProjectLensSignals(gitlabPolyrepo, mocked);

    const issue = result.find((r) => r.issueId === 'MIN-896');
    expect(issue).toMatchObject({
      issueOpen: true,
      hasMergedPr: true,
    });
    // Verify post_merge_limbo classification
    const membership = resolvePipelineMembership(issue!);
    expect(membership).toEqual(expect.objectContaining({
      bucket: 'post_merge_limbo',
    }));
    // PAN-3267: one call per GitLab repo carrying every convention head, not one
    // call per (repo × head) — the per-head fan-out stalled membership refresh
    // and failed it outright somewhere in the fan-out on every cycle.
    expect(mocked.listMergedMergeRequestHeads).toHaveBeenCalledTimes(2);
    expect(mocked.listMergedMergeRequestHeads).toHaveBeenCalledWith('/test/frontend', ['feature/min-896', 'strike/min-896']);
    expect(mocked.listMergedMergeRequestHeads).toHaveBeenCalledWith('/test/api', ['feature/min-896', 'strike/min-896']);
  });

  it('limits merged-MR lookups to five concurrent calls across GitLab repos', async () => {
    // PAN-3267: lookups are one-per-repo now, so the concurrency cap only binds
    // once a project has more GitLab repos than the limit.
    const mocked = deps();
    mocked.listTrackerIssues = vi.fn().mockResolvedValue([
      { issueId: 'MIN-1', state: 'open', labels: [] },
      { issueId: 'MIN-2', state: 'open', labels: [] },
      { issueId: 'MIN-3', state: 'open', labels: [] },
    ]);
    mocked.listOpenMergeRequests = vi.fn().mockResolvedValue([]);
    mocked.run = vi.fn().mockImplementation(async (_command, args, cwd) =>
      args[0] === 'rev-parse' ? cwd : '');

    let active = 0;
    let maxActive = 0;
    let releaseLookups = () => {};
    const lookupGate = new Promise<void>((resolve) => { releaseLookups = resolve; });
    let signalFiveStarted = () => {};
    const fiveStarted = new Promise<void>((resolve) => { signalFiveStarted = resolve; });
    mocked.listMergedMergeRequestHeads = vi.fn().mockImplementation(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      if (active === 5) signalFiveStarted();
      await lookupGate;
      active--;
      return [];
    });

    const gitlabPolyrepo: ProjectConfig = {
      name: 'test',
      path: '/test',
      issue_prefix: 'MIN',
      gitlab_repo: 'test/test',
      workspace: {
        type: 'polyrepo',
        repos: [
          { name: 'r1', path: 'r1' },
          { name: 'r2', path: 'r2' },
          { name: 'r3', path: 'r3' },
          { name: 'r4', path: 'r4' },
          { name: 'r5', path: 'r5' },
          { name: 'r6', path: 'r6' },
          { name: 'r7', path: 'r7' },
          { name: 'docs', path: 'docs', remote: 'github' },
        ],
      },
    };

    const gatherPromise = gatherProjectLensSignals(gitlabPolyrepo, mocked);
    await fiveStarted;

    expect(active).toBe(5);
    expect(maxActive).toBe(5);
    releaseLookups();
    await gatherPromise;

    // One lookup per GitLab repo — the github-remote repo is never queried.
    expect(mocked.listMergedMergeRequestHeads).toHaveBeenCalledTimes(7);
    expect(maxActive).toBe(5);
    expect(mocked.listMergedMergeRequestHeads).not.toHaveBeenCalledWith('/test/docs', expect.any(Array));
  });

  it('does not query merged MRs for closed issues (they\'re already terminal)', async () => {
    const mocked = deps();
    mocked.listOpenIssues = vi.fn().mockResolvedValue([]);
    mocked.listTrackerIssues = vi.fn().mockResolvedValue([
      { issueId: 'MIN-908', state: 'closed', labels: ['in-review'] },
    ]);
    mocked.listOpenMergeRequests = vi.fn().mockResolvedValue([]);
    mocked.listMergedMergeRequestHeads = vi.fn().mockResolvedValue([]);
    mocked.run = vi.fn().mockImplementation(async (_command, args, cwd) =>
      args[0] === 'rev-parse' ? cwd : '');
    const gitlabProject: ProjectConfig = {
      name: 'test',
      path: '/test',
      issue_prefix: 'MIN',
      gitlab_repo: 'test/test',
    };

    const result = await gatherProjectLensSignals(gitlabProject, mocked);

    const issue = result.find((r) => r.issueId === 'MIN-908');
    expect(issue).toMatchObject({
      issueOpen: false,
      hasMergedPr: false,
    });
    // Closed issues are terminal regardless of merged-PR state
    const membership = resolvePipelineMembership(issue!);
    expect(membership).toEqual(expect.objectContaining({
      bucket: 'clean_terminal',
    }));
  });

  it('unions merged MRs across polyrepo repos (multiple repos in merge set)', async () => {
    const mocked = deps();
    mocked.listTrackerIssues = vi.fn().mockResolvedValue([
      { issueId: 'MIN-900', state: 'open', labels: [] },
    ]);
    mocked.listOpenMergeRequests = vi.fn().mockResolvedValue([]);
    // Only return merged for the api repo, not fe
    mocked.listMergedMergeRequestHeads = vi.fn().mockImplementation(async (repoPath: string) => {
      if (repoPath.includes('api')) {
        return ['feature/min-900'];
      }
      return [];
    });
    mocked.run = vi.fn().mockImplementation(async (_command, args, cwd) =>
      args[0] === 'rev-parse' ? cwd : '');
    const gitlabPolyrepo: ProjectConfig = {
      name: 'test',
      path: '/test',
      issue_prefix: 'MIN',
      gitlab_repo: 'test/test',
      workspace: {
        type: 'polyrepo',
        repos: [
          { name: 'fe', path: 'frontend' },
          { name: 'api', path: 'api' },
        ],
      },
    };

    const result = await gatherProjectLensSignals(gitlabPolyrepo, mocked);

    // Even though only api repo returned merged, the union should mark it as merged
    const issue = result.find((r) => r.issueId === 'MIN-900');
    expect(issue).toMatchObject({
      hasMergedPr: true,
    });
  });

  it('does not query merged MRs for github repos in polyrepo', async () => {
    const mocked = deps();
    mocked.listTrackerIssues = vi.fn().mockResolvedValue([
      { issueId: 'TEST-1', state: 'open', labels: [] },
    ]);
    // This config is a polyrepo with one gitlab repo and other repos with different forges
    const mixedPolyrepo: ProjectConfig = {
      name: 'test',
      path: '/test',
      issue_prefix: 'TEST',
      gitlab_repo: 'gitlab/test',
      workspace: {
        type: 'polyrepo',
        repos: [
          { name: 'fe', path: 'frontend', remote: 'github' },
          { name: 'api', path: 'api' },
        ],
      },
    };

    mocked.listOpenMergeRequests = vi.fn().mockResolvedValue([]);
    mocked.listMergedMergeRequestHeads = vi.fn().mockResolvedValue([]);
    mocked.run = vi.fn().mockImplementation(async (_command, args, cwd) =>
      args[0] === 'rev-parse' ? cwd : '');

    await gatherProjectLensSignals(mixedPolyrepo, mocked);

    // Only the api repo (GitLab forge) is queried, once, carrying both convention heads.
    expect(mocked.listMergedMergeRequestHeads).toHaveBeenCalledTimes(1);
    expect(mocked.listMergedMergeRequestHeads).toHaveBeenCalledWith('/test/api', ['feature/test-1', 'strike/test-1']);
    expect(mocked.listMergedMergeRequestHeads).not.toHaveBeenCalledWith('/test/frontend', expect.any(Array));
  });

  it('does not query issue states or merged history for closed spec-only candidates', async () => {
    const mocked = deps();
    mocked.listOpenIssues = vi.fn().mockResolvedValue([]);
    mocked.listOpenPullRequests = vi.fn().mockResolvedValue([]);
    mocked.listMergedPullRequestHeads = vi.fn().mockResolvedValue([]);
    mocked.listSpecIssueIds = vi.fn().mockResolvedValue(
      Array.from({ length: 40 }, (_, index) => `PAN-${index + 1}`),
    );
    mocked.run = vi.fn().mockImplementation(async (_command, args, cwd) =>
      args[0] === 'rev-parse' ? cwd : '');

    await expect(gatherProjectLensSignals(project, mocked)).resolves.toEqual([]);

    expect(mocked.listIssueStates).not.toHaveBeenCalled();
    expect(mocked.listMergedPullRequestHeads).toHaveBeenCalledWith('eltmon', 'overdeck', []);
  });

  it('checks merged PR history only for active candidate heads', async () => {
    const mocked = deps();
    mocked.listOpenIssues = vi.fn().mockResolvedValue([
      { number: 10, labels: [] },
      { number: 11, labels: [] },
    ]);
    mocked.listOpenPullRequests = vi.fn().mockResolvedValue([]);
    mocked.listSpecIssueIds = vi.fn().mockResolvedValue(['PAN-10', 'PAN-11']);
    mocked.run = vi.fn().mockImplementation(async (_command, args, cwd) =>
      args[0] === 'rev-parse' ? cwd : '');
    mocked.listMergedPullRequestHeads = vi.fn().mockResolvedValue([]);

    await gatherProjectLensSignals(project, mocked);

    expect(mocked.listIssueStates).not.toHaveBeenCalled();
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

  it('probes terminal close-out records only for closed issues with open PRs', async () => {
    const mocked = deps();
    mocked.listOpenIssues = vi.fn().mockResolvedValue([
      { number: 30, labels: [] }, // PAN-30 is open, no open PR
    ]);
    mocked.listOpenPullRequests = vi.fn().mockResolvedValue([
      { headRefName: 'feature/pan-31', headRepoFullName: 'eltmon/overdeck' },
    ]);
    mocked.listPhaseLabeledIssues = vi.fn().mockResolvedValue([
      { number: 31, state: 'closed', labels: [] }, // PAN-31 is closed, has open PR
      { number: 32, state: 'closed', labels: [] }, // PAN-32 is closed, no open PR
    ]);
    mocked.listIssueStates = vi.fn().mockResolvedValue([
      { number: 31, state: 'closed' },
      { number: 32, state: 'closed' },
    ]);
    mocked.listMergedPullRequestHeads = vi.fn().mockResolvedValue([]);
    mocked.listSpecIssueIds = vi.fn().mockResolvedValue([]);
    mocked.batchHasTerminalCloseOutRecords = vi.fn().mockResolvedValue(new Map([['PAN-31', false]]));
    mocked.run = vi.fn().mockImplementation(async (_command, args, cwd) =>
      args[0] === 'rev-parse' ? cwd : '');

    const result = await gatherProjectLensSignals(project, mocked);

    // Batch probe should be called with only PAN-31 (closed + open PR), not PAN-30 (open) or PAN-32 (closed, no PR)
    expect(mocked.batchHasTerminalCloseOutRecords).toHaveBeenCalledTimes(1);
    expect(mocked.batchHasTerminalCloseOutRecords).toHaveBeenCalledWith(project, ['PAN-31']);
  });

  it('closed + open PR + hasTerminalCloseOut true → clean_terminal with residue reason', async () => {
    const mocked = deps();
    mocked.listOpenIssues = vi.fn().mockResolvedValue([]);
    mocked.listPhaseLabeledIssues = vi.fn().mockResolvedValue([
      { number: 33, state: 'closed', labels: [] },
    ]);
    mocked.listOpenPullRequests = vi.fn().mockResolvedValue([
      { headRefName: 'feature/pan-33', headRepoFullName: 'eltmon/overdeck' },
    ]);
    mocked.listIssueStates = vi.fn().mockResolvedValue([
      { number: 33, state: 'closed' },
    ]);
    mocked.listMergedPullRequestHeads = vi.fn().mockResolvedValue([]);
    mocked.listSpecIssueIds = vi.fn().mockResolvedValue([]);
    mocked.batchHasTerminalCloseOutRecords = vi.fn().mockResolvedValue(new Map([['PAN-33', true]])); // L7-record true
    mocked.run = vi.fn().mockImplementation(async (_command, args, cwd) =>
      args[0] === 'rev-parse' ? cwd : '');

    const [signal] = await gatherProjectLensSignals(project, mocked);

    expect(signal).toMatchObject({ issueId: 'PAN-33', issueOpen: false, hasOpenPr: true, hasTerminalCloseOut: true });
    expect(resolvePipelineMembership(signal!)).toMatchObject({
      bucket: 'clean_terminal', inPipeline: false,
    });
  });

  it('closed + open PR without terminal close-out record → zombie_pr (FR-2 unchanged)', async () => {
    const mocked = deps();
    mocked.listOpenIssues = vi.fn().mockResolvedValue([]);
    mocked.listPhaseLabeledIssues = vi.fn().mockResolvedValue([
      { number: 34, state: 'closed', labels: [] },
    ]);
    mocked.listOpenPullRequests = vi.fn().mockResolvedValue([
      { headRefName: 'feature/pan-34', headRepoFullName: 'eltmon/overdeck' },
    ]);
    mocked.listIssueStates = vi.fn().mockResolvedValue([
      { number: 34, state: 'closed' },
    ]);
    mocked.listMergedPullRequestHeads = vi.fn().mockResolvedValue([]);
    mocked.listSpecIssueIds = vi.fn().mockResolvedValue([]);
    mocked.batchHasTerminalCloseOutRecords = vi.fn().mockResolvedValue(new Map([['PAN-34', false]])); // L7-record false
    mocked.run = vi.fn().mockImplementation(async (_command, args, cwd) =>
      args[0] === 'rev-parse' ? cwd : '');

    const [signal] = await gatherProjectLensSignals(project, mocked);

    expect(signal).toMatchObject({ issueId: 'PAN-34', issueOpen: false, hasOpenPr: true, hasTerminalCloseOut: false });
    expect(resolvePipelineMembership(signal!)).toMatchObject({
      bucket: 'zombie_pr', inPipeline: true,
    });
  });

  it('preserves the explicit ready label as a durable membership lens', async () => {
    const mocked = deps();
    mocked.listOpenIssues = vi.fn().mockResolvedValue([{ number: 12, labels: ['ready'] }]);
    mocked.listOpenPullRequests = vi.fn().mockResolvedValue([]);
    mocked.listMergedPullRequestHeads = vi.fn().mockResolvedValue([]);
    mocked.listSpecIssueIds = vi.fn().mockResolvedValue([]);
    mocked.run = vi.fn().mockImplementation(async (_command, args, cwd) =>
      args[0] === 'rev-parse' ? cwd : '');

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
    mocked.run = vi.fn().mockImplementation(async (_command, args, cwd) =>
      args[0] === 'rev-parse' ? cwd : '');

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

  it('respects global concurrency limit of 5 for merged-MR lookups across multiple repos', async () => {
    let maxConcurrentCalls = 0;
    const callTimings: Array<{ start: number; end: number }> = [];

    const mocked = deps();
    mocked.listTrackerIssues = vi.fn().mockResolvedValue(
      // 10 open issues → 10 × 2 = 20 candidate heads
      Array.from({ length: 10 }, (_, i) => ({
        issueId: `MIN-${i + 1}`,
        state: 'open',
        labels: [],
      })),
    );
    mocked.listOpenMergeRequests = vi.fn().mockResolvedValue([]);
    mocked.listMergedMergeRequestHeads = vi.fn().mockImplementation(async () => {
      const startTime = Date.now();
      const currentIndex = callTimings.length;
      callTimings[currentIndex] = { start: startTime, end: 0 };

      // Count concurrent calls at this start time
      const concurrentNow = callTimings.filter((t) => t.start <= startTime && (t.end === 0 || t.end > startTime)).length;
      maxConcurrentCalls = Math.max(maxConcurrentCalls, concurrentNow);

      // Simulate a quick async operation (5ms)
      await new Promise((r) => setTimeout(r, 5));
      callTimings[currentIndex].end = Date.now();
      return [];
    });
    mocked.run = vi.fn().mockImplementation(async (_command, args, cwd) =>
      args[0] === 'rev-parse' ? cwd : '');

    const gitlabPolyrepo: ProjectConfig = {
      name: 'test',
      path: '/test',
      issue_prefix: 'MIN',
      gitlab_repo: 'test/test',
      workspace: {
        type: 'polyrepo',
        repos: [
          { name: 'api', path: '/test/api' },
          { name: 'services', path: '/test/services' },
          { name: 'workers', path: '/test/workers' },
        ],
      },
    };

    await gatherProjectLensSignals(gitlabPolyrepo, mocked);

    // PAN-3267: 10 issues × 2 convention heads = 20 heads, but they ride one
    // lookup per repo — 3 calls, not the 60 (repo, head) pairs this used to cost.
    expect(mocked.listMergedMergeRequestHeads).toHaveBeenCalledTimes(3);
    expect(mocked.listMergedMergeRequestHeads).toHaveBeenCalledWith(
      '/test/test/api', // this fixture's repo.path is absolute, so it joins under project.path
      expect.arrayContaining(['feature/min-1', 'strike/min-1', 'feature/min-10', 'strike/min-10']),
    );
    // Concurrency limit is 5, so max concurrent calls should not exceed 5
    expect(maxConcurrentCalls).toBeLessThanOrEqual(5);
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
