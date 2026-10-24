/**
 * PAN-4618 work item 5: resolveCiHead reads the CI workflow's newest push run
 * (the commit CI actually describes), falling back to the branch head when
 * the project has no such workflow or no push run of it yet.
 */
import { describe, expect, it, vi } from 'vitest';

import { resolveCiHead, type ProjectCiGhApi } from '../../../../src/lib/ci/project-ci-github.js';

describe('resolveCiHead', () => {
  it('returns the newest CI workflow run head after exactly one request', async () => {
    const ghApi = vi.fn<ProjectCiGhApi>(async () => ({ workflow_runs: [{ head_sha: 'C' }] }));

    await expect(resolveCiHead('o/r', 'main', ghApi)).resolves.toBe('C');

    expect(ghApi).toHaveBeenCalledTimes(1);
    expect(ghApi).toHaveBeenCalledWith('repos/o/r/actions/workflows/ci.yml/runs?branch=main&event=push&per_page=1');
  });

  it("returns a mixed push's bookkeeping tip as the CI head", async () => {
    const ghApi = vi.fn<ProjectCiGhApi>(async () => ({ workflow_runs: [{ head_sha: 'B' }] }));

    await expect(resolveCiHead('o/r', 'main', ghApi)).resolves.toBe('B');
  });

  it('falls back to the branch head on a 404 (no CI workflow)', async () => {
    const ghApi = vi.fn<ProjectCiGhApi>(async (path: string) => {
      if (path.includes('/actions/workflows/')) throw new Error('gh: Not Found (HTTP 404)');
      return { commit: { sha: 'branch-head' } };
    });

    await expect(resolveCiHead('o/r', 'main', ghApi)).resolves.toBe('branch-head');
  });

  it('falls back to the branch head when the workflow has no push runs yet', async () => {
    const ghApi = vi.fn<ProjectCiGhApi>(async (path: string) => {
      if (path.includes('/actions/workflows/')) return { workflow_runs: [] };
      return { commit: { sha: 'branch-head' } };
    });

    await expect(resolveCiHead('o/r', 'main', ghApi)).resolves.toBe('branch-head');
  });

  it('propagates a non-404 error from the workflow-runs call', async () => {
    const ghApi = vi.fn<ProjectCiGhApi>(async () => { throw new Error('gh: rate limited (HTTP 403)'); });

    await expect(resolveCiHead('o/r', 'main', ghApi)).rejects.toThrow('HTTP 403');
  });

  it('returns null when the branch fallback has no sha', async () => {
    const ghApi = vi.fn<ProjectCiGhApi>(async (path: string) => {
      if (path.includes('/actions/workflows/')) return { workflow_runs: [] };
      return {};
    });

    await expect(resolveCiHead('o/r', 'main', ghApi)).resolves.toBeNull();
  });
});
