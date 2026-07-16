import { readFile } from 'node:fs/promises';

import { describe, expect, it, vi } from 'vitest';

import {
  gatherProjectLensSignals,
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

function deps(): PipelineMembershipGatherDeps {
  return {
    listOpenIssues: vi.fn().mockResolvedValue([{ number: 1, labels: ['in-review'] }]),
    getIssueState: vi.fn().mockImplementation(async (_owner, _repo, number) => ({
      state: number === 4 ? 'open' : 'closed',
    })),
    listSpecIssueIds: vi.fn().mockResolvedValue(['PAN-4']),
    run: vi.fn().mockImplementation(async (command, args) => {
      if (command === 'gh' && args.includes('open')) return JSON.stringify([{ headRefName: 'feature/pan-2' }]);
      if (command === 'gh' && args.includes('merged')) return JSON.stringify([{ headRefName: 'feature/pan-1', mergedAt: '2026-01-01' }]);
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

  it('lists merged PRs exactly once regardless of candidate count', async () => {
    const mocked = deps();
    await gatherProjectLensSignals(project, mocked);
    const mergedCalls = vi.mocked(mocked.run).mock.calls.filter(([command, args]) =>
      command === 'gh' && args.includes('merged'));
    expect(mergedCalls).toHaveLength(1);
  });

  it('lets the resolver correct squash lineage using the merged-PR oracle', async () => {
    const result = await gatherProjectLensSignals(project, deps());
    expect(resolvePipelineMembership(result.find((signal) => signal.issueId === 'PAN-1')!).bucket)
      .toBe('post_merge_limbo');
  });

  it('keeps forbidden disposable-state and synchronous process imports out of the gatherer', async () => {
    const source = await readFile(new URL('../../../src/lib/pipeline-membership-gather.ts', import.meta.url), 'utf-8');
    expect(source).not.toMatch(/review-status|agent-state|tmux|overdeck\.db|execSync|spawnSync/);
  });
});
