import { describe, expect, it } from 'vitest';
import { memberSpecRoots, type MemberSpecRootDeps } from '../uat-member-spec-roots.js';
import type { UatGeneration } from '../../../../lib/overdeck/merge-types.js';

type Chain = ReadonlyArray<Pick<UatGeneration, 'worktreePath' | 'cleanedAt' | 'members'>>;

function member(issueId: string): UatGeneration['members'][number] {
  return { issueId, title: issueId, branch: `feature/${issueId.toLowerCase()}`, headSha: 'deadbeef', mergeOrder: 1 };
}

function depsWithExisting(existing: ReadonlySet<string>, workspacePath: string | null = null): MemberSpecRootDeps {
  return {
    exists: (path) => existing.has(path),
    featureWorkspacePath: () => workspacePath,
  };
}

describe('memberSpecRoots', () => {
  it('puts the newest live batch worktree first', () => {
    const genB: Chain[number] = { worktreePath: '/gens/genB', cleanedAt: null, members: [member('PAN-1')] };
    const genA: Chain[number] = { worktreePath: '/gens/genA', cleanedAt: null, members: [member('PAN-1')] };
    const roots = memberSpecRoots('PAN-1', [genB, genA], '/repos/overdeck', depsWithExisting(new Set(['/gens/genB', '/gens/genA'])));
    expect(roots[0]).toBe('/gens/genB');
  });

  it('skips cleaned and missing batch worktrees', () => {
    const genB: Chain[number] = { worktreePath: '/gens/genB', cleanedAt: '2026-11-01T00:00:00Z', members: [member('PAN-1')] };
    const genA: Chain[number] = { worktreePath: '/gens/genA', cleanedAt: null, members: [member('PAN-1')] };
    const roots = memberSpecRoots('PAN-1', [genB, genA], '/repos/overdeck', depsWithExisting(new Set()));
    expect(roots).not.toContain('/gens/genB');
    expect(roots).not.toContain('/gens/genA');
  });

  it('adds the feature workspace only when it exists', () => {
    const chain: Chain = [];
    const withoutWorkspace = memberSpecRoots(
      'PAN-1',
      chain,
      '/repos/overdeck',
      depsWithExisting(new Set(), '/workspaces/feature-pan-1'),
    );
    expect(withoutWorkspace).toEqual(['/repos/overdeck']);

    const withWorkspace = memberSpecRoots(
      'PAN-1',
      chain,
      '/repos/overdeck',
      depsWithExisting(new Set(['/workspaces/feature-pan-1']), '/workspaces/feature-pan-1'),
    );
    expect(withWorkspace).toEqual(['/workspaces/feature-pan-1', '/repos/overdeck']);
  });

  it('always ends with the project root, even when it does not exist', () => {
    const roots = memberSpecRoots('PAN-1', [], '/repos/overdeck', depsWithExisting(new Set()));
    expect(roots).toEqual(['/repos/overdeck']);
  });

  it('drops duplicate roots', () => {
    const roots = memberSpecRoots(
      'PAN-1',
      [],
      '/repos/overdeck',
      depsWithExisting(new Set(['/repos/overdeck']), '/repos/overdeck'),
    );
    expect(roots).toEqual(['/repos/overdeck']);
  });
});
