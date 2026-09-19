import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * PAN-3917 FR-11: reclaiming a merged issue's leftover `_devnet` bridge network
 * is host hygiene on a Docker resource — it is not triggered by the tracker, so
 * it runs on its own hygiene interval rather than inside the closed-issue
 * reaper (whose trigger IS the tracker).
 */

const mocks = vi.hoisted(() => ({
  exec: vi.fn(),
  getPrFacts: vi.fn(),
  reconcileMergedDockerCleanupQueue: vi.fn(),
}));

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  exec: mocks.exec,
}));

vi.mock('../pr-facts.js', () => ({ getPrFacts: mocks.getPrFacts }));

vi.mock('../merged-docker-cleanup-worker.js', () => ({
  reconcileMergedDockerCleanupQueue: mocks.reconcileMergedDockerCleanupQueue,
}));

import { reconcileMergedIssueDocker } from '../merged-docker-reconcile.js';

function dockerNetworks(stdout: string | Error) {
  mocks.exec.mockImplementation((
    _command: string,
    opts: unknown,
    callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void,
  ) => {
    const cb = typeof opts === 'function' ? opts : callback;
    if (stdout instanceof Error) cb?.(stdout, { stdout: '', stderr: '' });
    else cb?.(null, { stdout, stderr: '' });
    return { on: vi.fn() };
  });
}

describe('reconcileMergedIssueDocker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.reconcileMergedDockerCleanupQueue.mockImplementation(
      (issueIds: string[]) => issueIds.map((issueId) => `Queued merged-issue Docker cleanup for ${issueId}`),
    );
  });

  it('queues cleanup for a leaked devnet whose PR the forge says merged', async () => {
    dockerNetworks('overdeck-feature-pan-5559_devnet\nbridge\n');
    mocks.getPrFacts.mockResolvedValue({ merged: true });

    await expect(reconcileMergedIssueDocker()).resolves.toEqual([
      'Queued merged-issue Docker cleanup for PAN-5559',
    ]);
    expect(mocks.getPrFacts).toHaveBeenCalledWith('PAN-5559');
    expect(mocks.reconcileMergedDockerCleanupQueue).toHaveBeenCalledWith(['PAN-5559']);
  });

  it('ignores a leaked devnet whose PR the forge does not call merged', async () => {
    dockerNetworks('overdeck-feature-pan-5559_devnet\nbridge\n');
    mocks.getPrFacts.mockResolvedValue({ merged: false });

    await expect(reconcileMergedIssueDocker()).resolves.toEqual([]);
    expect(mocks.reconcileMergedDockerCleanupQueue).toHaveBeenCalledWith([]);
  });

  it('preserves the queue when Docker network discovery is unavailable', async () => {
    dockerNetworks(new Error('docker unavailable'));

    await expect(reconcileMergedIssueDocker()).resolves.toEqual([]);
    expect(mocks.reconcileMergedDockerCleanupQueue).not.toHaveBeenCalled();
  });

  it('leaves the queue alone when the forge lookup itself fails', async () => {
    dockerNetworks('overdeck-feature-pan-5559_devnet\n');
    mocks.getPrFacts.mockRejectedValue(new Error('gh unreachable'));

    const actions = await reconcileMergedIssueDocker();

    expect(actions[0]).toContain('Failed to resolve merged-issue Docker cleanup status');
    expect(mocks.reconcileMergedDockerCleanupQueue).not.toHaveBeenCalled();
  });
});
