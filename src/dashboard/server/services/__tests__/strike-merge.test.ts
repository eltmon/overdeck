import { describe, expect, it, vi } from 'vitest';

import { buildStrikeMergeRequest, postStrikeMergePayload } from '../strike-merge.js';

const SHA = 'abcdef0123456789abcdef0123456789abcdef01';
const WORKSPACE = '/home/op/Projects/overdeck/workspaces/feature-pan-9-strike';

function deps(overrides: Partial<Parameters<typeof buildStrikeMergeRequest>[2]> = {}) {
  return {
    resolveProjectPath: async () => '/home/op/Projects/overdeck',
    exists: (path: string) => path === WORKSPACE,
    git: vi.fn(async (args: string[]) => (args[0] === 'rev-parse' ? SHA : '')),
    ...overrides,
  };
}

/** PAN-4750: the one place a StrikeMergeRequest is built. */
describe('buildStrikeMergeRequest', () => {
  it('returns 404 without a strike workspace', async () => {
    await expect(buildStrikeMergeRequest('PAN-9', { operatorStarted: true }, deps({ exists: () => false })))
      .resolves.toEqual({ ok: false, status: 404, error: 'No strike workspace for PAN-9' });
    await expect(buildStrikeMergeRequest('PAN-9', { operatorStarted: true }, deps({ resolveProjectPath: async () => null })))
      .resolves.toEqual(expect.objectContaining({ ok: false, status: 404 }));
  });

  it('returns 409 on a git failure', async () => {
    const git = vi.fn(async () => { throw new Error("couldn't find remote ref strike/pan-9"); });
    await expect(buildStrikeMergeRequest('PAN-9', { operatorStarted: true }, deps({ git })))
      .resolves.toEqual({ ok: false, status: 409, error: "Could not read origin/strike/pan-9: couldn't find remote ref strike/pan-9" });
  });

  it('builds the exact request shape triggerMerge validates', async () => {
    const d = deps();
    await expect(buildStrikeMergeRequest('PAN-9', { operatorStarted: true }, d)).resolves.toEqual({
      ok: true,
      request: {
        kind: 'strike',
        markerHead: SHA,
        workspacePath: WORKSPACE,
        branchName: 'strike/pan-9',
        recoveryTarget: 'strike-pan-9',
        operatorStarted: true,
      },
    });
    expect(d.git).toHaveBeenNthCalledWith(1, ['fetch', 'origin', 'strike/pan-9'], WORKSPACE);
    expect(d.git).toHaveBeenNthCalledWith(2, ['rev-parse', 'origin/strike/pan-9'], WORKSPACE);
  });

  it('carries an automatic merge head instead of the operator flag', async () => {
    const built = await buildStrikeMergeRequest('PAN-9', { expectedHeadSha: SHA }, deps());
    expect(built).toEqual(expect.objectContaining({ ok: true, request: expect.objectContaining({ expectedHeadSha: SHA }) }));
    expect(built.ok && 'operatorStarted' in built.request).toBe(false);
  });
});

describe('postStrikeMergePayload', () => {
  it('merges an operator-started strike request and maps the status code', async () => {
    const triggerMerge = vi.fn(async () => ({ success: true, statusCode: 200, message: 'Merge started', outcome: 'merging' as const }));
    await expect(postStrikeMergePayload('PAN-9', { ...deps(), triggerMerge }))
      .resolves.toEqual({ status: 200, body: { success: true, message: 'Merge started', outcome: 'merging' } });
    expect(triggerMerge).toHaveBeenCalledWith('PAN-9', expect.objectContaining({ kind: 'strike', operatorStarted: true }));
  });

  it('passes a gate refusal through', async () => {
    const triggerMerge = vi.fn(async () => ({ success: false, statusCode: 400, error: 'Cannot merge: PR is a draft', refused: true }));
    await expect(postStrikeMergePayload('PAN-9', { ...deps(), triggerMerge }))
      .resolves.toEqual({ status: 400, body: { success: false, error: 'Cannot merge: PR is a draft', refused: true } });
  });

  it('does not merge when the request cannot be built', async () => {
    const triggerMerge = vi.fn();
    await expect(postStrikeMergePayload('PAN-9', { ...deps({ exists: () => false }), triggerMerge }))
      .resolves.toEqual({ status: 404, body: { success: false, error: 'No strike workspace for PAN-9' } });
    expect(triggerMerge).not.toHaveBeenCalled();
  });
});

/**
 * PAN-4750 review (CodeRabbit): the builder resolves the project exactly as
 * `triggerMerge` does, including the GitHub-config repo-prefix fallback for a
 * prefix the project registry does not know.
 */
describe('buildStrikeMergeRequest default project path', () => {
  it('uses the getProjectPath repo-prefix fallback', async () => {
    vi.resetModules();
    vi.doMock('../project-path.js', () => ({
      getProjectPath: vi.fn((_linear: string | undefined, prefix: string) => (prefix === 'KRUX' ? '/home/op/Projects/krux' : '/home/op/Projects')),
    }));
    try {
      const { buildStrikeMergeRequest: build } = await import('../strike-merge.js');
      const exists = vi.fn((path: string) => path === '/home/op/Projects/krux/workspaces/feature-krux-7-strike');
      const built = await build('KRUX-7', { operatorStarted: true }, {
        exists,
        git: async (args) => (args[0] === 'rev-parse' ? SHA : ''),
      });
      expect(built).toEqual(expect.objectContaining({
        ok: true,
        request: expect.objectContaining({ workspacePath: '/home/op/Projects/krux/workspaces/feature-krux-7-strike' }),
      }));
    } finally {
      vi.doUnmock('../project-path.js');
      vi.resetModules();
    }
  });
});
