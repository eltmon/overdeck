/**
 * PAN-3848 (W23): the state git lock is keyed per issue — same (gitRoot,
 * issueId) serializes, different issues on the same gitRoot run concurrently.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { stateGitLockPath, stateRepoLockPath, withStateGitLock, withStateRepoLock } from '../../../../src/lib/pan-dir/state-git-lock.js';

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

describe('withStateRepoLock (PAN-3848 F7)', () => {
  let home: string;
  let gitRoot: string;
  const originalHome = process.env.OVERDECK_HOME;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'pan-state-repo-lock-'));
    process.env.OVERDECK_HOME = home;
    gitRoot = join(home, 'state', 'project');
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('keys the lock path on the git root alone, independent of the issue', () => {
    const a = stateRepoLockPath(gitRoot);
    expect(a).toBe(stateRepoLockPath(gitRoot));
    expect(a).toContain('locks/state-git');
    expect(a).not.toBe(stateRepoLockPath(join(home, 'state', 'other')));
    // Distinct from any per-issue lock path on the same root.
    expect(a).not.toBe(stateGitLockPath(gitRoot, 'PAN-1'));
  });

  it('serializes two operations on the same git root', async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstEntered = new Promise<void>((resolve) => {
      void withStateRepoLock(gitRoot, 'w1', async () => {
        order.push('first-enter');
        resolve();
        await new Promise<void>((resolveGate) => {
          releaseFirst = resolveGate;
        });
        order.push('first-exit');
      });
    });

    await firstEntered;
    const second = withStateRepoLock(gitRoot, 'w2', async () => {
      order.push('second-enter');
    });
    for (let turn = 0; turn < 50; turn += 1) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    expect(order).toEqual(['first-enter']);

    releaseFirst();
    await second;
    expect(order).toEqual(['first-enter', 'first-exit', 'second-enter']);
  });

  it('runs operations for different git roots concurrently', async () => {
    const order: string[] = [];
    let releaseA!: () => void;
    const aEntered = new Promise<void>((resolve) => {
      void withStateRepoLock(gitRoot, 'w1', async () => {
        order.push('a-enter');
        resolve();
        await new Promise<void>((resolveGate) => {
          releaseA = resolveGate;
        });
        order.push('a-exit');
      });
    });

    await aEntered;
    const b = withStateRepoLock(join(home, 'state', 'other'), 'w2', async () => {
      order.push('b-enter');
    });
    await b;
    expect(order).toEqual(['a-enter', 'b-enter']);

    releaseA();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(order).toEqual(['a-enter', 'b-enter', 'a-exit']);
  });

  it('excludes a holder in another process (PAN-3848 F7)', async () => {
    const execFileAsync = promisify(execFile);
    const tsxPath = join(process.cwd(), 'node_modules', '.bin', 'tsx');
    const rendezvous = join(home, 'child-acquired');
    const modulePath = join(process.cwd(), 'src', 'lib', 'pan-dir', 'state-git-lock.ts');
    const childScript = [
      `Promise.all([import('node:fs'), import(${JSON.stringify(modulePath)})])`,
      `.then(([{ appendFileSync }, { withStateRepoLock }]) => withStateRepoLock(`,
      `${JSON.stringify(gitRoot)}, 'f7-child', async () => {`,
      `appendFileSync(${JSON.stringify(rendezvous)}, 'child-acquired\\n'); }))`,
      `.then(() => process.exit(0), (error) => { console.error(error); process.exit(1); });`,
    ].join('\n');

    let releaseParent!: () => void;
    const parentEntered = new Promise<void>((resolve) => {
      void withStateRepoLock(gitRoot, 'f7-parent', async () => {
        resolve();
        await new Promise<void>((resolveGate) => {
          releaseParent = resolveGate;
        });
      });
    });
    await parentEntered;

    const child = execFileAsync(tsxPath, ['-e', childScript], { timeout: 60_000 });
    try {
      // While the parent holds the repo lock, the child must not acquire it.
      // Poll briefly: the guarantee is lock semantics, not timing — the child
      // cannot proceed until the parent releases, however slow scheduling is.
      for (let turn = 0; turn < 20; turn += 1) {
        await new Promise<void>((resolve) => setTimeout(resolve, 25));
        expect(existsSync(rendezvous)).toBe(false);
      }
    } finally {
      releaseParent();
    }
    await child;
    expect(readFileSync(rendezvous, 'utf8')).toContain('child-acquired');
  });
});
