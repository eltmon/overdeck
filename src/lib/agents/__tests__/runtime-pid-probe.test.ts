/**
 * A transient `ps` failure must not prune the process subtree below the
 * unreadable pid (PAN-3849 findings round: both catch blocks in the pid probe
 * skipped the `pgrep` child lookup, so a healthy harness below a
 * temporarily-unreadable pane root read as absent).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const childProcess = vi.hoisted(() => ({
  exec: vi.fn(),
}));
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, exec: childProcess.exec };
});
vi.mock('../../runtimes/behavior.js', () => ({
  getHarnessBehavior: () => ({ processNames: ['harness-proc'] }),
}));

import { findAgentRuntimePidInSubtree } from '../runtime-pid-probe.js';

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
