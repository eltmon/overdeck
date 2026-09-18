/**
 * A transient `ps` failure must not prune the process subtree below the
 * unreadable pid (PAN-3849 findings round: both catch blocks in the pid probe
 * skipped the `pgrep` child lookup, so a healthy harness below a
 * temporarily-unreadable pane root read as absent).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const childProcess = vi.hoisted(() => ({
  exec: vi.fn(),
  execFileSync: vi.fn(),
}));
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, exec: childProcess.exec, execFileSync: childProcess.execFileSync };
});
vi.mock('../../runtimes/behavior.js', () => ({
  getHarnessBehavior: () => ({ processNames: ['harness-proc'] }),
}));

import {
  findAgentRuntimePidInSubtree,
  findAgentRuntimePidInSubtreeSync,
} from '../runtime-pid-probe.js';

// Tree under test: 100 (bash, ps TRANSIENTLY fails) -> 101 (harness-proc).
// NOTE: the probe promisifies the mocked `exec`, and a bare vi.fn() has no
// custom-promisify hook, so the promisified mock resolves with the single
// callback value — pass `{ stdout }` objects to match the probe's
// destructuring.
type ExecCallback = (err: Error | null, stdout: unknown, stderr: unknown) => void;
function mockAsyncTree(): void {
  childProcess.exec.mockImplementation((cmd: string, callback: ExecCallback) => {
    if (cmd === 'ps -p 100 -o comm=') {
      callback(new Error('ps: transient failure'), '', '');
      return;
    }
    if (cmd === 'ps -p 101 -o comm=') {
      callback(null, { stdout: 'harness-proc\n' }, '');
      return;
    }
    if (cmd === 'pgrep -P 100') {
      callback(null, { stdout: '101\n' }, '');
      return;
    }
    const err = new Error('pgrep: no children') as Error & { code?: number };
    err.code = 1;
    callback(err, '', '');
  });
}

function mockSyncTree(): void {
  childProcess.execFileSync.mockImplementation((cmd: string, args?: readonly string[]) => {
    if (cmd === 'ps' && args?.[1] === '100') throw new Error('ps: transient failure');
    if (cmd === 'ps' && args?.[1] === '101') return 'harness-proc\n';
    // Real `ps -p <gone>` exits 1 — a cleanly observed absence, not a probe
    // failure.
    if (cmd === 'ps') {
      const gone = new Error('ps: no such process') as Error & { status?: number };
      gone.status = 1;
      throw gone;
    }
    if (cmd === 'pgrep' && args?.[1] === '100') return '101\n';
    const err = new Error('pgrep: no children') as Error & { code?: number };
    err.code = 1;
    throw err;
  });
}

describe('findAgentRuntimePidInSubtree (async)', () => {
  beforeEach(() => {
    childProcess.exec.mockReset();
    mockAsyncTree();
  });

  it('walks below a pid whose identity lookup fails transiently', async () => {
    await expect(findAgentRuntimePidInSubtree('100')).resolves.toBe(101);
  });

  it('still returns null when the failed pid has no children', async () => {
    await expect(findAgentRuntimePidInSubtree('999')).resolves.toBeNull();
  });

  it('returns indeterminate when the probe execs fail without a clean status', async () => {
    childProcess.exec.mockReset();
    childProcess.exec.mockImplementation((cmd: string, callback: ExecCallback) => {
      callback(new Error('exec: broken pipe'), '', '');
    });
    await expect(findAgentRuntimePidInSubtree('100')).resolves.toBe('indeterminate');
  });

  it('returns indeterminate for a non-numeric root pid', async () => {
    await expect(findAgentRuntimePidInSubtree('???')).resolves.toBe('indeterminate');
    expect(childProcess.exec).not.toHaveBeenCalled();
  });
});

describe('findAgentRuntimePidInSubtreeSync', () => {
  beforeEach(() => {
    childProcess.execFileSync.mockReset();
    mockSyncTree();
  });

  it('walks below a pid whose identity lookup fails transiently', () => {
    expect(findAgentRuntimePidInSubtreeSync('100')).toBe(101);
  });

  it('still returns null when the failed pid has no children', () => {
    expect(findAgentRuntimePidInSubtreeSync('999')).toBeNull();
  });

  it('returns indeterminate when ps fails beyond "pid gone" (status 1)', () => {
    childProcess.execFileSync.mockReset();
    childProcess.execFileSync.mockImplementation((cmd: string, args?: readonly string[]) => {
      if (cmd === 'ps' && args?.[1] === '100') throw new Error('ps: /proc unreadable');
      if (cmd === 'pgrep') {
        const broken = new Error('pgrep: boom') as Error & { status?: number };
        broken.status = 2;
        throw broken;
      }
      throw new Error(`unexpected probe exec: ${cmd}`);
    });
    expect(findAgentRuntimePidInSubtreeSync('100')).toBe('indeterminate');
  });

  it('returns indeterminate when pgrep fails beyond "no children"', () => {
    childProcess.execFileSync.mockReset();
    childProcess.execFileSync.mockImplementation((cmd: string, args?: readonly string[]) => {
      if (cmd === 'ps') return 'bash\n';
      const broken = new Error('pgrep: boom') as Error & { status?: number };
      broken.status = 2;
      throw broken;
    });
    expect(findAgentRuntimePidInSubtreeSync('100')).toBe('indeterminate');
  });

  it('returns indeterminate for a non-numeric root pid', () => {
    childProcess.execFileSync.mockReset();
    expect(findAgentRuntimePidInSubtreeSync('???')).toBe('indeterminate');
    expect(childProcess.execFileSync).not.toHaveBeenCalled();
  });
});
