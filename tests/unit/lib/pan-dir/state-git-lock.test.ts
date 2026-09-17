/**
 * PAN-3848 (W23): the state git lock is keyed per issue — same (gitRoot,
 * issueId) serializes, different issues on the same gitRoot run concurrently.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { stateGitLockPath, withStateGitLock } from '../../../../src/lib/pan-dir/state-git-lock.js';

describe('stateGitLockPath (PAN-3848 W23)', () => {
  let home: string;
  const originalHome = process.env.OVERDECK_HOME;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'pan-state-git-lock-'));
    process.env.OVERDECK_HOME = home;
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('keys the lock path on the git root and the uppercase issue id', () => {
    const root = join(home, 'state', 'project');
    const a = stateGitLockPath(root, 'PAN-3848');
    const b = stateGitLockPath(root, 'pan-3848');
    const other = stateGitLockPath(root, 'PAN-9999');
    const otherRoot = stateGitLockPath(join(home, 'elsewhere'), 'PAN-3848');

    expect(a).toBe(b);
    expect(a).not.toBe(other);
    expect(a).not.toBe(otherRoot);
    expect(a).toContain('locks/state-git');
  });
});

describe('withStateGitLock (PAN-3848 W23)', () => {
  let home: string;
  let gitRoot: string;
  const originalHome = process.env.OVERDECK_HOME;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'pan-state-git-lock-'));
    process.env.OVERDECK_HOME = home;
    gitRoot = join(home, 'state', 'project');
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(home, { recursive: true, force: true });
  });

  function lockOptions(issueId: string) {
    return { writerId: `test-${issueId}`, recordPath: join(gitRoot, 'records', `${issueId.toLowerCase()}.json`) };
  }

  it('serializes two operations on the same issue', async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstEntered = new Promise<void>((resolve) => {
      void withStateGitLock(gitRoot, 'PAN-1', 'w1', lockOptions('PAN-1').recordPath, async () => {
        order.push('first-enter');
        resolve();
        await new Promise<void>((resolveGate) => {
          releaseFirst = resolveGate;
        });
        order.push('first-exit');
      });
    });

    await firstEntered;
    const second = withStateGitLock(gitRoot, 'pan-1', 'w2', lockOptions('PAN-1').recordPath, async () => {
      order.push('second-enter');
    });
    // Give the second operation real event-loop turns: it must NOT enter while
    // the first holds the lock.
    for (let turn = 0; turn < 50; turn += 1) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    expect(order).toEqual(['first-enter']);

    releaseFirst();
    await second;
    expect(order).toEqual(['first-enter', 'first-exit', 'second-enter']);
  });

  it('runs operations for different issues on the same git root concurrently', async () => {
    const order: string[] = [];
    let releaseA!: () => void;
    const aEntered = new Promise<void>((resolve) => {
      void withStateGitLock(gitRoot, 'PAN-1', 'w1', lockOptions('PAN-1').recordPath, async () => {
        order.push('a-enter');
        resolve();
        await new Promise<void>((resolveGate) => {
          releaseA = resolveGate;
        });
        order.push('a-exit');
      });
    });

    await aEntered;
    const b = withStateGitLock(gitRoot, 'PAN-2', 'w2', lockOptions('PAN-2').recordPath, async () => {
      order.push('b-enter');
    });
    await b;
    expect(order).toEqual(['a-enter', 'b-enter']);

    releaseA();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(order).toEqual(['a-enter', 'b-enter', 'a-exit']);
  });
});
