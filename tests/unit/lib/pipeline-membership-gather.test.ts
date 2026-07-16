import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import {
  gatherProjectLensSignals,
  PIPELINE_ISSUE_STATE_CONCURRENCY,
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
    listPullRequests: vi.fn().mockResolvedValue([
      { headRefName: 'feature/pan-2', mergedAt: null, state: 'open' },
      { headRefName: 'feature/pan-1', mergedAt: '2026-01-01', state: 'closed' },
    ]),
    getIssueState: vi.fn().mockImplementation(async (_owner, _repo, number) => ({
      state: number === 4 ? 'open' : 'closed',
    })),
    listSpecIssueIds: vi.fn().mockResolvedValue(['PAN-4']),
    run: vi.fn().mockImplementation(async (command, args) => {
      if (command === 'git' && args.includes('--no-merged=main')) return 'feature/pan-1\norigin/feature/pan-3\n';
      if (command === 'git') return 'feature/pan-1\norigin/feature/pan-3\n';
      throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
    }),
  };
}

describe('gatherProjectLensSignals', () => {
  it('returns the deduplicated union with every durable lens filled', async () => {
    const result = await gatherProjectLensSignals(project, deps());

    expect(result).toEqual([
      { issueId: 'PAN-1', issueOpen: true, hasOpenPr: false, hasMergedPr: true, hasConventionBranch: true, branchUnmerged: true, phaseLabel: 'in-review', hasVbriefSpec: false },
      { issueId: 'PAN-2', issueOpen: false, hasOpenPr: true, hasMergedPr: false, hasConventionBranch: false, branchUnmerged: false, phaseLabel: null, hasVbriefSpec: false },
      { issueId: 'PAN-3', issueOpen: false, hasOpenPr: false, hasMergedPr: false, hasConventionBranch: true, branchUnmerged: true, phaseLabel: null, hasVbriefSpec: false },
      { issueId: 'PAN-4', issueOpen: true, hasOpenPr: false, hasMergedPr: false, hasConventionBranch: false, branchUnmerged: false, phaseLabel: null, hasVbriefSpec: true },
    ]);
  });

  it('lists all PRs through one paginated dependency regardless of candidate count', async () => {
    const mocked = deps();
    await gatherProjectLensSignals(project, mocked);
    expect(mocked.listPullRequests).toHaveBeenCalledOnce();
    expect(mocked.listPullRequests).toHaveBeenCalledWith('eltmon', 'overdeck');
    expect(mocked.run).not.toHaveBeenCalledWith('gh', expect.anything(), expect.anything());
  });

  it('returns no membership for a non-GitHub project without probing GitHub or git', async () => {
    const mocked = deps();
    const mixedTrackerProject = { ...project, github_repo: undefined };

    await expect(gatherProjectLensSignals(mixedTrackerProject, mocked)).resolves.toEqual([]);
    expect(mocked.listOpenIssues).not.toHaveBeenCalled();
    expect(mocked.listPullRequests).not.toHaveBeenCalled();
    expect(mocked.run).not.toHaveBeenCalled();
  });

  it('bounds issue-state lookups for large candidate sets', async () => {
    const mocked = deps();
    mocked.listOpenIssues = vi.fn().mockResolvedValue([]);
    mocked.listPullRequests = vi.fn().mockResolvedValue([]);
    mocked.listSpecIssueIds = vi.fn().mockResolvedValue(
      Array.from({ length: 40 }, (_, index) => `PAN-${index + 1}`),
    );
    let active = 0;
    let maximumActive = 0;
    mocked.getIssueState = vi.fn().mockImplementation(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise<void>((resolve) => setImmediate(resolve));
      active -= 1;
      return { state: 'closed' };
    });

    await gatherProjectLensSignals(project, mocked);

    expect(maximumActive).toBeGreaterThan(1);
    expect(maximumActive).toBeLessThanOrEqual(PIPELINE_ISSUE_STATE_CONCURRENCY);
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
