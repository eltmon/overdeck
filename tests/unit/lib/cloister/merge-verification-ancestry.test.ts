/**
 * Per-repo batch merge evidence must be verified once per distinct tuple, even
 * when every member of the batch asks at the same moment (PAN-3093 cycle 5).
 *
 * A positive-result cache alone does not help: each member consults it before
 * any first check has settled, so all of them miss and each spawns its own
 * `git merge-base`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const execMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:child_process')>();
  return { ...original, exec: execMock };
});

// promisify(exec) reads exec.__promisify__ when present.
Object.defineProperty(execMock, '__promisify__', { value: undefined, writable: true });

let verifyMergedBeforeLifecycle: typeof import('../../../../src/lib/cloister/merge-verification.js')['verifyMergedBeforeLifecycle'];

beforeEach(async () => {
  vi.resetModules();
  execMock.mockReset();
  ({ verifyMergedBeforeLifecycle } = await import('../../../../src/lib/cloister/merge-verification.js'));
});

afterEach(() => { vi.restoreAllMocks(); });

let shaSeq = 0;
function evidence(repoKey: string) {
  shaSeq += 1;
  return {
    repoKey,
    repoPath: `/tmp/myn/${repoKey}`,
    // Must be hex — the verifier rejects anything else as "no merge sha".
    mergeSha: `abc${shaSeq}`.padEnd(40, 'd'),
    targetBranch: 'main',
  };
}

describe('ancestry verification coalescing', () => {
  it('runs one git process per tuple when many members verify concurrently', async () => {
    // Hold every check open until all callers have arrived, which is exactly
    // the promotion fan-out: N member lifecycles, same evidence, at once.
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    execMock.mockImplementation((_cmd: string, _opts: unknown, cb: (e: unknown, r: unknown) => void) => {
      void gate.then(() => cb(null, { stdout: '', stderr: '' }));
      return undefined as never;
    });

    const repos = [evidence('fe'), evidence('api'), evidence('infra')];
    const members = Array.from({ length: 25 }, (_, i) =>
      verifyMergedBeforeLifecycle(`MIN-${900 + i}`, '/tmp/myn', 'feature/x', { verifiedMergedRepos: repos }),
    );

    release!();
    const results = await Promise.all(members);

    expect(results.every((r) => r.merged)).toBe(true);
    // 25 members x 3 repos = 75 checks without coalescing; one per tuple with it.
    expect(execMock).toHaveBeenCalledTimes(3);
  });

  it('does not cache a negative result, so a later landing can still verify', async () => {
    let shouldPass = false;
    execMock.mockImplementation((_cmd: string, _opts: unknown, cb: (e: unknown, r: unknown) => void) => {
      if (shouldPass) cb(null, { stdout: '', stderr: '' });
      else cb(new Error('not an ancestor'), null);
      return undefined as never;
    });

    const repos = [evidence('fe')];

    const first = await verifyMergedBeforeLifecycle('MIN-901', '/tmp/myn', 'feature/x', { verifiedMergedRepos: repos });
    expect(first.merged).toBe(false);

    shouldPass = true;
    const second = await verifyMergedBeforeLifecycle('MIN-901', '/tmp/myn', 'feature/x', { verifiedMergedRepos: repos });
    expect(second.merged).toBe(true);
  });
});
