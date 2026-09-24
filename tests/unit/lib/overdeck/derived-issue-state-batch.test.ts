/**
 * The batch door's branch read (PAN-3969).
 *
 * `loadIssueStatesForProject` used to run `readBranchWithGit` per issue —
 * up to three git spawns each, serially, for every issue without a PR. The
 * default path now reads every `feature/*` branch with two `git for-each-ref`
 * invocations total. These tests pin the per-issue semantics of that map
 * against what `readBranchWithGit` reported, and keep the injected
 * `deps.readBranch` seam per-issue (and git-free).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const git = vi.hoisted(() => ({
  calls: [] as string[][],
  handler: (_args: string[]): string | null => '',
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  function execFileStub(..._args: unknown[]): never {
    throw new Error('execFile without promisify is not expected in these tests');
  }
  // `derived-issue-state.ts` holds `promisify(execFile)`; the custom symbol is
  // how the mocked execFile answers with the `{ stdout, stderr }` shape the
  // real promisified execFile returns.
  (execFileStub as unknown as Record<PropertyKey, unknown>)[promisify.custom] =
    (cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> => {
      if (cmd === 'git') {
        git.calls.push(args);
        const out = git.handler(args);
        if (out === null) return Promise.reject(new Error('git exited non-zero'));
        return Promise.resolve({ stdout: out, stderr: '' });
      }
      if (cmd === 'gh') return Promise.resolve({ stdout: '[]', stderr: '' });
      return Promise.reject(new Error(`unexpected execFile: ${cmd}`));
    };
  return { ...actual, execFile: execFileStub };
});

import { loadIssueStatesForProject } from '../../../../src/lib/overdeck/derived-issue-state.js';

const sha = (ch: string) => ch.repeat(40);

/** The two listings, from the scenario map: branch → { local, remote, ahead }. */
function gitListings(scenario: Record<string, { local?: string; remote?: string; ahead?: boolean }>) {
  return (args: string[]): string | null => {
    if (args[0] !== 'for-each-ref') return null;
    if (args.includes('--no-merged=origin/main')) {
      return Object.entries(scenario)
        .filter(([, v]) => v.local && v.ahead)
        .map(([branch]) => branch)
        .join('\n') + '\n';
    }
    const lines: string[] = [];
    for (const [branch, v] of Object.entries(scenario)) {
      if (v.local) lines.push(`${v.local} ${branch}`);
      if (v.remote) lines.push(`${v.remote} origin/${branch}`);
    }
    return lines.join('\n') + '\n';
  };
}

function openIssues(ids: readonly string[]): Record<string, { open: boolean; labels: string[] }> {
  return Object.fromEntries(ids.map((id) => [id, { open: true, labels: [] }]));
}

describe('the batched branch read', () => {
  let projectPath: string;

  beforeEach(() => {
    projectPath = mkdtempSync(join(tmpdir(), 'derived-issue-state-batch-'));
    git.calls.length = 0;
  });

  afterEach(() => {
    rmSync(projectPath, { recursive: true, force: true });
  });

  it('reads every scenario with two git invocations and per-issue semantics intact', async () => {
    git.handler = gitListings({
      // PAN-1: no branch at all → null branch facts.
      'feature/pan-2': { local: sha('a'), ahead: true },                    // local-only, ahead
      'feature/pan-3': { local: sha('b'), remote: sha('b'), ahead: true },  // pushed
      'feature/pan-4': { local: sha('c'), remote: sha('d'), ahead: true },  // diverged
      'feature/pan-5': { local: sha('e') },                                 // merged → not ahead
    });

    const ids = ['PAN-1', 'PAN-2', 'PAN-3', 'PAN-4', 'PAN-5'];
    const states = await loadIssueStatesForProject(projectPath, ids, {
      now: () => 1_800_000_000_000,
      panes: [],
      issues: openIssues(ids),
    });

    // Two `for-each-ref` listings for five issues — never a per-issue rev-list.
    expect(git.calls).toHaveLength(2);
    expect(git.calls.every((args) => args[0] === 'for-each-ref')).toBe(true);

    expect(states.get('PAN-1')?.branch).toBeUndefined();
    expect(states.get('PAN-2')?.branch).toEqual({ name: 'feature/pan-2', aheadOfMain: 1, pushed: false });
    expect(states.get('PAN-3')?.branch).toEqual({ name: 'feature/pan-3', aheadOfMain: 1, pushed: true });
    expect(states.get('PAN-4')?.branch).toEqual({ name: 'feature/pan-4', aheadOfMain: 1, pushed: false });
    expect(states.get('PAN-5')?.branch).toEqual({ name: 'feature/pan-5', aheadOfMain: 0, pushed: false });

    // aheadOfMain > 0 with no PR and no panes is `working`; a merged or absent
    // branch falls through to `backlog` (no spec, no labels here).
    expect(states.get('PAN-2')?.state).toBe('working');
    expect(states.get('PAN-3')?.state).toBe('working');
    expect(states.get('PAN-4')?.state).toBe('working');
    expect(states.get('PAN-5')?.state).toBe('backlog');
    expect(states.get('PAN-1')?.state).toBe('backlog');
  });

  it('treats a failed listing as branch-less, never as a crash', async () => {
    git.handler = () => null;

    const ids = ['PAN-1', 'PAN-2'];
    const states = await loadIssueStatesForProject(projectPath, ids, {
      now: () => 1_800_000_000_000,
      panes: [],
      issues: openIssues(ids),
    });

    expect(states.get('PAN-1')?.branch).toBeUndefined();
    expect(states.get('PAN-2')?.branch).toBeUndefined();
  });

  it('keeps the injected readBranch seam per-issue and git-free', async () => {
    git.handler = () => {
      throw new Error('git must not run when readBranch is injected');
    };
    const readBranch = vi.fn(async (_projectPath: string, branch: string) => (
      branch === 'feature/pan-1' ? { name: branch, aheadOfMain: 3, pushed: true } : null
    ));

    const ids = ['PAN-1', 'PAN-2', 'PAN-3'];
    const states = await loadIssueStatesForProject(projectPath, ids, {
      now: () => 1_800_000_000_000,
      panes: [],
      issues: openIssues(ids),
      readBranch,
    });

    expect(readBranch).toHaveBeenCalledTimes(3);
    expect(git.calls).toHaveLength(0);
    expect(states.get('PAN-1')?.branch).toEqual({ name: 'feature/pan-1', aheadOfMain: 3, pushed: true });
    expect(states.get('PAN-2')?.branch).toBeUndefined();
  });
});
