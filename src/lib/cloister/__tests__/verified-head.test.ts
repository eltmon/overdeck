import { describe, expect, it, vi } from 'vitest';

import { primaryShaFromAnchor, readPrimaryHead8 } from '../verified-head.js';
import type { HeadAnchor } from '../../git-utils.js';

describe('primaryShaFromAnchor', () => {
  it('returns undefined for an undefined anchor', () => {
    expect(primaryShaFromAnchor(undefined, 'api')).toBeUndefined();
  });

  it('returns the plain sha for a monorepo anchor', () => {
    const sha = 'a'.repeat(40);
    expect(primaryShaFromAnchor(sha as HeadAnchor, 'api')).toBe(sha);
  });

  it('resolves the primary repo sha out of a composite polyrepo anchor', () => {
    const feSha = 'a'.repeat(40);
    const apiSha = 'b'.repeat(40);
    const anchor = `fe@${feSha} api@${apiSha}` as HeadAnchor;
    expect(primaryShaFromAnchor(anchor, 'api')).toBe(apiSha);
  });

  it('falls back to the first value when the primary repo key is missing', () => {
    const feSha = 'a'.repeat(40);
    const apiSha = 'b'.repeat(40);
    const anchor = `fe@${feSha} api@${apiSha}` as HeadAnchor;
    expect(primaryShaFromAnchor(anchor, undefined)).toBe(feSha);
    expect(primaryShaFromAnchor(anchor, 'missing')).toBe(feSha);
  });
});

describe('readPrimaryHead8', () => {
  it('returns undefined when the workspace snapshot throws', async () => {
    vi.doMock('../../git-utils.js', () => ({
      snapshotWorkspaceHeads: vi.fn().mockRejectedValue(new Error('boom')),
    }));
    vi.resetModules();
    const { readPrimaryHead8: reload } = await import('../verified-head.js');
    await expect(reload('PAN-1', '/tmp/workspace')).resolves.toBeUndefined();
    vi.doUnmock('../../git-utils.js');
    vi.resetModules();
  });

  it('slices the resolved primary sha to 8 characters', async () => {
    const apiSha = 'b'.repeat(40);
    vi.doMock('../../git-utils.js', async () => ({
      ...(await vi.importActual<typeof import('../../git-utils.js')>('../../git-utils.js')),
      snapshotWorkspaceHeads: vi.fn().mockResolvedValue(`fe@${'a'.repeat(40)} api@${apiSha}`),
    }));
    vi.doMock('../../project-repos.js', () => ({
      resolveWorkspaceRepoRoots: vi.fn().mockReturnValue([{ repoKey: 'api' }]),
    }));
    vi.resetModules();
    const { readPrimaryHead8: reload } = await import('../verified-head.js');
    await expect(reload('PAN-1', '/tmp/workspace')).resolves.toBe(apiSha.slice(0, 8));
    vi.doUnmock('../../git-utils.js');
    vi.doUnmock('../../project-repos.js');
    vi.resetModules();
  });
});
