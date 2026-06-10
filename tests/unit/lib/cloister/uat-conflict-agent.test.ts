/**
 * Tests for the assembly-agent conflict resolution hook (PAN-1737).
 * All I/O faked; the timebox path uses fake timers per the fake-timers rule.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildConflictAgentHook,
  buildConflictResolutionPrompt,
  DEFAULT_CONFLICT_TIMEOUT_MS,
  type ConflictAgentDeps,
} from '../../../../src/lib/cloister/uat-conflict-agent.js';
import type { ConflictContext } from '../../../../src/lib/cloister/uat-generation-engine.js';

const CTX: ConflictContext = {
  feature: { issueId: 'PAN-3', title: 'Third feature', branch: 'feature/pan-3', conflictsWith: ['PAN-1'] },
  mergedIssueIds: ['PAN-1', 'PAN-2'],
  conflictingIssueIds: ['PAN-1'],
  branchName: 'uat/pan-otter-0610',
  worktreePath: '/proj/workspaces/uat-pan-otter-0610',
};

function makeDeps(overrides: Partial<ConflictAgentDeps> = {}): ConflictAgentDeps & {
  commits: string[];
} {
  const commits: string[] = [];
  return {
    commits,
    listConflictedFiles: async () => ['src/x.ts', 'src/y.ts'],
    runAgent: async () => {},
    filesWithConflictMarkers: async () => [],
    stageAll: async () => {},
    hasUnmergedEntries: async () => false,
    commitMerge: async (_cwd, message) => { commits.push(message); },
    headSha: async () => 'resolved-sha-123',
    log: () => {},
    ...overrides,
  };
}

describe('buildConflictAgentHook — success', () => {
  it('runs the agent, verifies, commits the merge, and returns the resolution', async () => {
    const deps = makeDeps();
    const runAgent = vi.fn(deps.runAgent);
    const hook = buildConflictAgentHook({ deps: { ...deps, runAgent } });

    const result = await hook(CTX);

    expect(result).toEqual({ files: ['src/x.ts', 'src/y.ts'], commitSha: 'resolved-sha-123' });
    expect(runAgent).toHaveBeenCalledTimes(1);
    const args = runAgent.mock.calls[0]![0];
    expect(args.cwd).toBe(CTX.worktreePath);
    expect(args.timeoutMs).toBe(DEFAULT_CONFLICT_TIMEOUT_MS);
    // merge commit: standard subject (commitlint default-ignores), marker in body
    expect(deps.commits).toHaveLength(1);
    expect(deps.commits[0]).toMatch(/^Merge branch 'feature\/pan-3' into uat\/pan-otter-0610\n/);
    expect(deps.commits[0]).toContain('uat-assembly: resolve PAN-3 <-> PAN-1');
    expect(deps.commits[0]).toContain('files: src/x.ts, src/y.ts');
  });

  it('builds a prompt that names the feature, counterpart, and files, and forbids scope creep', () => {
    const prompt = buildConflictResolutionPrompt(CTX, ['src/x.ts']);
    expect(prompt).toContain('feature/pan-3');
    expect(prompt).toContain('PAN-3');
    expect(prompt).toContain('PAN-1');
    expect(prompt).toContain('src/x.ts');
    expect(prompt).toContain('Change NOTHING beyond');
    expect(prompt).toContain('Do not run git commands');
  });
});

describe('buildConflictAgentHook — failure paths all return null (never throw)', () => {
  it('agent spawn/timeout failure', async () => {
    const hook = buildConflictAgentHook({
      deps: makeDeps({ runAgent: async () => { throw new Error('ETIMEDOUT'); } }),
    });
    await expect(hook(CTX)).resolves.toBeNull();
  });

  it('conflict markers remain after the agent ran', async () => {
    const deps = makeDeps({ filesWithConflictMarkers: async () => ['src/x.ts'] });
    const hook = buildConflictAgentHook({ deps });
    await expect(hook(CTX)).resolves.toBeNull();
    expect(deps.commits).toHaveLength(0);
  });

  it('unmerged index entries remain after staging', async () => {
    const deps = makeDeps({ hasUnmergedEntries: async () => true });
    const hook = buildConflictAgentHook({ deps });
    await expect(hook(CTX)).resolves.toBeNull();
    expect(deps.commits).toHaveLength(0);
  });

  it('no unmerged paths at all (not a content conflict)', async () => {
    const deps = makeDeps({ listConflictedFiles: async () => [] });
    const runAgent = vi.fn(deps.runAgent);
    const hook = buildConflictAgentHook({ deps: { ...deps, runAgent } });
    await expect(hook(CTX)).resolves.toBeNull();
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('commit rejection', async () => {
    const hook = buildConflictAgentHook({
      deps: makeDeps({ commitMerge: async () => { throw new Error('hook rejected'); } }),
    });
    await expect(hook(CTX)).resolves.toBeNull();
  });
});

describe('timebox plumbing', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('passes the configured timeout to the runner and gives up when it fires', async () => {
    // Simulated execFile timeout: rejects when the timer fires, like child_process
    // does with the `timeout` option — no real wall-clock waiting.
    const runAgent = vi.fn(({ timeoutMs }: { timeoutMs: number }) =>
      new Promise<void>((_resolve, reject) => {
        setTimeout(() => reject(new Error('spawn claude ETIMEDOUT')), timeoutMs);
      }),
    );
    const hook = buildConflictAgentHook({ timeoutMs: 30_000, deps: makeDeps({ runAgent }) });

    const pending = hook(CTX);
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(pending).resolves.toBeNull();
    expect(runAgent.mock.calls[0]![0].timeoutMs).toBe(30_000);
  });
});
