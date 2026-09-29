/**
 * PAN-4291 Work Item 6: the close-out merged-PR lookup resolves the tip SHA
 * first, runs the forge lookup through the metered `runGh` door, and caches a
 * negative ("no merged PR") answer for an hour per (project, branch, tip) so
 * the closed-issue reaper's every-tick poll does not re-ask GitHub for a
 * branch it already knows is unmerged.
 */

import { promisify } from 'node:util';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  tipSha: 'tip-sha-1',
  ghStdout: '[]',
  ghShouldReject: false,
  ghCalls: [] as string[][],
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();

  function execStub(..._args: unknown[]): never {
    throw new Error('exec without promisify is not expected in these tests');
  }
  (execStub as unknown as Record<PropertyKey, unknown>)[promisify.custom] =
    (command: string): Promise<{ stdout: string; stderr: string }> => {
      if (command.startsWith('git branch --list')) {
        return Promise.resolve({ stdout: 'feature/pan-x\n', stderr: '' });
      }
      if (command.startsWith('git merge-base --is-ancestor')) {
        // The branch-vs-main ancestor check always fails here, so isBranchMerged
        // falls through to the code-diff check and then the forge lookup.
        return Promise.reject(new Error('not an ancestor'));
      }
      if (command.startsWith('git diff main...')) {
        return Promise.resolve({ stdout: 'src/changed.ts\n', stderr: '' });
      }
      if (command.startsWith('git rev-parse')) {
        return Promise.resolve({ stdout: `${state.tipSha}\n`, stderr: '' });
      }
      if (command.startsWith('git log main..')) {
        return Promise.resolve({ stdout: '', stderr: '' });
      }
      return Promise.reject(new Error(`unexpected exec command: ${command}`));
    };

  function execFileStub(..._args: unknown[]): never {
    throw new Error('execFile without promisify is not expected in these tests');
  }
  (execFileStub as unknown as Record<PropertyKey, unknown>)[promisify.custom] =
    (cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> => {
      if (cmd !== 'gh') return Promise.reject(new Error(`unexpected execFile: ${cmd}`));
      state.ghCalls.push(args);
      if (state.ghShouldReject) return Promise.reject(Object.assign(new Error('gh: connection reset'), { stderr: 'connection reset' }));
      return Promise.resolve({ stdout: state.ghStdout, stderr: '' });
    };

  return { ...actual, exec: execStub, execFile: execFileStub };
});

import { isBranchMerged, resetCloseOutCacheForTests, CLOSE_OUT_NEGATIVE_TTL_MS } from '../../../src/lib/close-out.js';
import { withGitHubCaller } from '../../../src/lib/github-quota/caller-context.js';
import { flushLedgerWrites, readLedgerWindow } from '../../../src/lib/github-quota/ledger.js';

const PROJECT_PATH = '/repos/close-out-test';
const BRANCH = 'feature/pan-x';

describe('close-out negative-answer cache (PAN-4291)', () => {
  const originalHome = process.env.OVERDECK_HOME;
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'pan-close-out-cache-'));
    process.env.OVERDECK_HOME = home;
    resetCloseOutCacheForTests();
    state.tipSha = 'tip-sha-1';
    state.ghStdout = '[]';
    state.ghShouldReject = false;
    state.ghCalls.length = 0;
  });

  afterEach(async () => {
    vi.useRealTimers();
    await flushLedgerWrites();
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('execs gh once and reads unmerged from cache on the second call with the same tip SHA (AC1)', async () => {
    const first = await isBranchMerged(BRANCH, PROJECT_PATH);
    const second = await isBranchMerged(BRANCH, PROJECT_PATH);

    expect(first.status).toBe('unmerged');
    expect(second.status).toBe('unmerged');
    expect(state.ghCalls).toHaveLength(1);
  });

  it('execs gh again once the tip SHA changes, or once the TTL elapses (AC2)', async () => {
    await isBranchMerged(BRANCH, PROJECT_PATH);
    expect(state.ghCalls).toHaveLength(1);

    state.tipSha = 'tip-sha-2';
    await isBranchMerged(BRANCH, PROJECT_PATH);
    expect(state.ghCalls).toHaveLength(2);

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + CLOSE_OUT_NEGATIVE_TTL_MS + 1_000);
    await isBranchMerged(BRANCH, PROJECT_PATH);
    expect(state.ghCalls).toHaveLength(3);
  });

  it('never caches a failed gh lookup, so it execs gh again on the next call (AC3)', async () => {
    state.ghShouldReject = true;
    const first = await isBranchMerged(BRANCH, PROJECT_PATH);
    expect(first.status).toBe('unmerged');
    expect(state.ghCalls).toHaveLength(1);

    state.ghShouldReject = false;
    const second = await isBranchMerged(BRANCH, PROJECT_PATH);
    expect(second.status).toBe('unmerged');
    expect(state.ghCalls).toHaveLength(2);

    // Now cached: a third call must not exec gh again.
    await isBranchMerged(BRANCH, PROJECT_PATH);
    expect(state.ghCalls).toHaveLength(2);
  });

  it('meters the forge lookup as the withGitHubCaller context caller, on the graphql bucket (AC4)', async () => {
    await withGitHubCaller('close-out', () => isBranchMerged(BRANCH, PROJECT_PATH));
    await flushLedgerWrites();

    const calls = readLedgerWindow(Date.now()).filter((e) => e.kind === 'call');
    expect(calls).toEqual([expect.objectContaining({ caller: 'close-out', bucket: 'graphql' })]);
  });
});
