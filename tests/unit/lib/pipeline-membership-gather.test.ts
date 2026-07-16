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
      { issueId: 'PAN-1', issueOpen: true, hasOpenPr: false, hasMergedPr: true, hasConventionBranch: true, branchUnmerged: true, phaseLabel: 'in-review', hasVbriefSpec: false, explicitlyReady: false },
      { issueId: 'PAN-2', issueOpen: false, hasOpenPr: true, hasMergedPr: false, hasConventionBranch: false, branchUnmerged: false, phaseLabel: null, hasVbriefSpec: false, explicitlyReady: false },
      { issueId: 'PAN-3', issueOpen: false, hasOpenPr: false, hasMergedPr: false, hasConventionBranch: true, branchUnmerged: true, phaseLabel: null, hasVbriefSpec: false, explicitlyReady: false },
      { issueId: 'PAN-4', issueOpen: true, hasOpenPr: false, hasMergedPr: false, hasConventionBranch: false, branchUnmerged: false, phaseLabel: null, hasVbriefSpec: true, explicitlyReady: false },
    ]);
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

  it('returns no membership for a non-GitHub project without probing GitHub or git', async () => {
    const mocked = deps();
    const mixedTrackerProject = { ...project, github_repo: undefined };

    await expect(gatherProjectLensSignals(mixedTrackerProject, mocked)).resolves.toEqual([]);
    expect(mocked.listOpenIssues).not.toHaveBeenCalled();
    expect(mocked.listOpenPullRequests).not.toHaveBeenCalled();
    expect(mocked.listMergedPullRequestHeads).not.toHaveBeenCalled();
    expect(mocked.run).not.toHaveBeenCalled();
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
    mocked.run = vi.fn().mockResolvedValue('feature/krux-5\n');

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
      ['feature/pan-10', 'feature/pan-11'],
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
    await expect(listIssueStatesBatched('eltmon', 'overdeck', [1], partial))
      .rejects.toThrow('Incomplete issue-state GraphQL response');
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
