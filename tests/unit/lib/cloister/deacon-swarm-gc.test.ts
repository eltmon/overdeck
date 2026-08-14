import { afterEach, describe, expect, it, vi } from 'vitest';
import { gcMergedSlots, gcOrphanedSlots, type CoordinateSwarmSlotsDeps } from '../../../../src/lib/cloister/deacon-swarm.js';
import type { ReconciledSlotItem, SlotReconcileResult } from '../../../../src/lib/agents/slot-reconcile.js';

function slot(overrides: Partial<ReconciledSlotItem> = {}): ReconciledSlotItem {
  return {
    itemId: 'wi-1',
    slotIndex: 1,
    status: 'merged',
    branch: 'feature/pan-2203-slot-1',
    agentId: 'agent-pan-2203-slot-1',
    ...overrides,
  };
}

function deps(sessionNames: string[] = [], options: { worktreeExists?: boolean } = {}): Pick<CoordinateSwarmSlotsDeps, 'runGitCommand' | 'clearSlotAssignment' | 'listSessionNames' | 'slotWorktreeExists'> & { listSlotWorkspaceWorktrees: () => { isPolyrepo: false; nested: [] } } {
  return {
    runGitCommand: vi.fn(async (command: string, cwd: string) => {
      // Answer the aggregate-registration preflight: every slot workspace of
      // this base is a registered worktree.
      if (command === 'git worktree list --porcelain') {
        return { stdout: `worktree ${cwd}\n\nworktree ${cwd}-slot-1\n\nworktree ${cwd}-slot-4\n\nworktree ${cwd}-slot-9\n` };
      }
      // The monorepo outer workspace holds every slot branch locally.
      if (command.startsWith('git branch --list')) {
        return { stdout: `${JSON.parse(command.slice('git branch --list '.length))}\n` };
      }
      return undefined;
    }),
    clearSlotAssignment: vi.fn(),
    listSessionNames: vi.fn(async () => sessionNames),
    slotWorktreeExists: vi.fn(() => options.worktreeExists ?? true),
    // Hermetic default: treat every issue as monorepo so the real project
    // config resolver never runs in unit tests.
    listSlotWorkspaceWorktrees: () => ({ isPolyrepo: false, nested: [] }),
  };
}

describe('deacon-swarm merged slot GC', () => {
  afterEach(() => vi.useRealTimers());
  it('removes a merged slot worktree and slot branch', async () => {
    const fakeDeps = deps();

    await expect(gcMergedSlots('PAN-2203', '/repo/workspaces/feature-pan-2203', [slot()], fakeDeps))
      .resolves.toEqual(['[swarm] gc slot 1 (item wi-1) for PAN-2203']);

    expect(fakeDeps.runGitCommand).toHaveBeenCalledWith(
      'git worktree remove --force "/repo/workspaces/feature-pan-2203-slot-1"',
      '/repo/workspaces/feature-pan-2203',
    );
    expect(fakeDeps.runGitCommand).toHaveBeenCalledWith(
      'git branch -D "feature/pan-2203-slot-1"',
      '/repo/workspaces/feature-pan-2203',
    );
    expect(fakeDeps.clearSlotAssignment).toHaveBeenCalledWith(
      '/repo/workspaces/feature-pan-2203',
      'PAN-2203',
      1,
      'wi-1',
    );
  });

  it('preserves running and failed-merge slots', async () => {
    const fakeDeps = deps();

    await expect(gcMergedSlots('PAN-2203', '/repo/workspaces/feature-pan-2203', [
      slot({ itemId: 'wi-running', slotIndex: 2, status: 'in_flight', branch: 'feature/pan-2203-slot-2' }),
      slot({ itemId: 'wi-failed', slotIndex: 3, status: 'in_flight', branch: 'feature/pan-2203-slot-3' }),
    ], fakeDeps)).resolves.toEqual([]);

    expect(fakeDeps.runGitCommand).not.toHaveBeenCalled();
  });

  it('falls back to the conventional slot branch name when reconcile omits a branch', async () => {
    const fakeDeps = deps();

    await gcMergedSlots('PAN-2203', '/repo/workspaces/feature-pan-2203', [
      slot({ branch: undefined }),
    ], fakeDeps);

    expect(fakeDeps.runGitCommand).toHaveBeenCalledWith(
      'git branch -D "feature/pan-2203-slot-1"',
      '/repo/workspaces/feature-pan-2203',
    );
  });

  it('never destroys a slot whose agent session is alive (fresh branch misdetected as merged)', async () => {
    const fakeDeps = deps(['agent-pan-2203-slot-1']);

    await expect(gcMergedSlots('PAN-2203', '/repo/workspaces/feature-pan-2203', [slot()], fakeDeps))
      .resolves.toEqual(['[swarm] gc skipped slot 1 (item wi-1) for PAN-2203: agent session alive']);

    expect(fakeDeps.runGitCommand).not.toHaveBeenCalled();
    expect(fakeDeps.clearSlotAssignment).not.toHaveBeenCalled();
  });

  it('immediately reaps a live slot when completed item status proves the merge', async () => {
    const fakeDeps = {
      ...deps(['agent-pan-2203-slot-1']),
      stopSlotAgent: vi.fn(async () => undefined),
    };

    const actions = await gcMergedSlots('PAN-2203', '/repo/workspaces/feature-pan-2203', [
      slot({ mergedVia: 'completed-status' }),
    ], fakeDeps);

    expect(actions).toEqual([
      '[swarm] gc reaped merged agent agent-pan-2203-slot-1',
      '[swarm] gc slot 1 (item wi-1) for PAN-2203',
    ]);
    expect(fakeDeps.stopSlotAgent).toHaveBeenCalledWith('agent-pan-2203-slot-1');
    expect(fakeDeps.clearSlotAssignment).toHaveBeenCalled();
  });

  it('reaps a merged live slot after the idle threshold and frees its occupancy', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-10T12:00:00.000Z'));
    const fakeDeps = {
      ...deps(['agent-pan-2203-slot-1']),
      getAgentLastActivity: vi.fn(() => '2026-07-10T11:20:00.000Z'),
      stopSlotAgent: vi.fn(async () => undefined),
    };

    const actions = await gcMergedSlots('PAN-2203', '/repo/workspaces/feature-pan-2203', [slot()], fakeDeps);

    expect(actions).toEqual([
      '[swarm] gc reaped idle merged agent agent-pan-2203-slot-1',
      '[swarm] gc slot 1 (item wi-1) for PAN-2203',
    ]);
    expect(fakeDeps.stopSlotAgent).toHaveBeenCalledWith('agent-pan-2203-slot-1');
    expect(fakeDeps.clearSlotAssignment).toHaveBeenCalled();
  });

  it('guards by conventional agent id when reconcile lost the agentId', async () => {
    const fakeDeps = deps(['agent-pan-2203-slot-4']);

    await expect(gcMergedSlots('PAN-2203', '/repo/workspaces/feature-pan-2203', [
      slot({ slotIndex: 4, itemId: 'wi-4', branch: 'feature/pan-2203-slot-4', agentId: undefined }),
    ], fakeDeps)).resolves.toEqual(['[swarm] gc skipped slot 4 (item wi-4) for PAN-2203: agent session alive']);

    expect(fakeDeps.runGitCommand).not.toHaveBeenCalled();
  });

  it('still gcs a merged slot whose session has ended', async () => {
    const fakeDeps = deps(['agent-pan-2203-slot-9']);

    await expect(gcMergedSlots('PAN-2203', '/repo/workspaces/feature-pan-2203', [slot()], fakeDeps))
      .resolves.toEqual(['[swarm] gc slot 1 (item wi-1) for PAN-2203']);

    expect(fakeDeps.clearSlotAssignment).toHaveBeenCalledWith(
      '/repo/workspaces/feature-pan-2203',
      'PAN-2203',
      1,
      'wi-1',
    );
  });

  it('skips the worktree remove when no worktree exists (branch-only merged slot)', async () => {
    const fakeDeps = deps([], { worktreeExists: false });

    await expect(gcMergedSlots('PAN-2203', '/repo/workspaces/feature-pan-2203', [slot()], fakeDeps))
      .resolves.toEqual(['[swarm] gc slot 1 (item wi-1) for PAN-2203']);

    expect(fakeDeps.runGitCommand).toHaveBeenCalledTimes(2);
    expect(fakeDeps.runGitCommand).toHaveBeenCalledWith(
      'git branch --list "feature/pan-2203-slot-1"',
      '/repo/workspaces/feature-pan-2203',
    );
    expect(fakeDeps.runGitCommand).toHaveBeenCalledWith(
      'git branch -D "feature/pan-2203-slot-1"',
      '/repo/workspaces/feature-pan-2203',
    );
    expect(fakeDeps.clearSlotAssignment).toHaveBeenCalled();
  });

  it('degrades a worktree-remove failure to a deferred action instead of throwing', async () => {
    const fakeDeps = deps();
    fakeDeps.runGitCommand = vi.fn(async (command: string, cwd: string) => {
      if (command.startsWith('git worktree remove')) throw new Error('worktree is dirty');
      if (command === 'git worktree list --porcelain') return { stdout: `worktree ${cwd}\n\nworktree ${cwd}-slot-1\n` };
      return undefined;
    });

    const actions = await gcMergedSlots('PAN-2203', '/repo/workspaces/feature-pan-2203', [slot()], fakeDeps);

    expect(actions).toEqual([
      '[swarm] gc deferred slot 1 (item wi-1) for PAN-2203: worktree remove failed: worktree is dirty',
    ]);
    // Exactly two calls, in order: the aggregate registration preflight, then
    // the failing remove. Nothing else mutates.
    expect(vi.mocked(fakeDeps.runGitCommand).mock.calls).toEqual([
      ['git worktree list --porcelain', '/repo/workspaces/feature-pan-2203'],
      ['git worktree remove --force "/repo/workspaces/feature-pan-2203-slot-1"', '/repo/workspaces/feature-pan-2203'],
    ]);
    expect(fakeDeps.clearSlotAssignment).not.toHaveBeenCalled();
  });

  it('keeps the assignment when the branch delete fails so reconcile still sees the slot', async () => {
    const fakeDeps = deps([], { worktreeExists: false });
    fakeDeps.runGitCommand = vi.fn(async (command: string) => {
      if (command.startsWith('git branch --list')) {
        return { stdout: `${JSON.parse(command.slice('git branch --list '.length))}\n` };
      }
      throw new Error('branch is checked out');
    });

    const actions = await gcMergedSlots('PAN-2203', '/repo/workspaces/feature-pan-2203', [slot()], fakeDeps);

    expect(actions).toEqual([
      '[swarm] gc deferred slot 1 (item wi-1) for PAN-2203: branch delete failed: branch is checked out',
    ]);
    expect(fakeDeps.clearSlotAssignment).not.toHaveBeenCalled();
  });

  it('treats an absent outer slot branch as idempotent success (polyrepo wrapper holds no slot branch)', async () => {
    const fakeDeps = deps([], { worktreeExists: false });
    fakeDeps.runGitCommand = vi.fn(async (command: string) => {
      if (command.startsWith('git branch --list')) return { stdout: '' };
      return undefined;
    });

    const actions = await gcMergedSlots('PAN-2203', '/repo/workspaces/feature-pan-2203', [slot()], fakeDeps);

    expect(actions).toEqual(['[swarm] gc slot 1 (item wi-1) for PAN-2203']);
    const commands = vi.mocked(fakeDeps.runGitCommand).mock.calls.map(([command]) => command);
    expect(commands.some(command => command.includes('branch -D'))).toBe(false);
    expect(fakeDeps.clearSlotAssignment).toHaveBeenCalled();
  });

  it('defers when the outer branch state cannot be determined', async () => {
    const fakeDeps = deps([], { worktreeExists: false });
    fakeDeps.runGitCommand = vi.fn(async () => {
      throw new Error('not a git repository');
    });

    const actions = await gcMergedSlots('PAN-2203', '/repo/workspaces/feature-pan-2203', [slot()], fakeDeps);

    expect(actions).toEqual([
      '[swarm] gc deferred slot 1 (item wi-1) for PAN-2203: branch state of feature/pan-2203-slot-1 could not be determined',
    ]);
    expect(fakeDeps.clearSlotAssignment).not.toHaveBeenCalled();
  });
});

describe('deacon-swarm merged slot GC (polyrepo, PAN-3686)', () => {
  const workspacePath = '/myn/workspaces/feature-min-888';
  const slotWorkspace = `${workspacePath}-slot-2`;
  const slotBranch = 'feature/min-888-slot-2';
  const nested = [
    { repoKey: 'fe', dir: `${slotWorkspace}/fe`, parentRepo: '/myn/frontend', featureBranch: 'feature/min-888' },
    { repoKey: 'api', dir: `${slotWorkspace}/api`, parentRepo: '/myn/api', featureBranch: 'feature/min-888' },
  ];
  const baseRoots = [
    { repoKey: 'fe', dir: `${workspacePath}/fe`, sourceBranch: 'feature/min-888', targetBranch: 'main', isPolyrepo: true },
    { repoKey: 'api', dir: `${workspacePath}/api`, sourceBranch: 'feature/min-888', targetBranch: 'main', isPolyrepo: true },
  ];

  function polyrepoDeps(options: {
    aheadByRepo?: Record<string, string>;
    aheadThrows?: boolean;
    dirtyByRepo?: Record<string, string>;
    rootRemoveError?: string;
    nestedRemoveErrorRepo?: string;
    unregisteredRepo?: string;
    aggregateRegistered?: boolean;
    worktreeListThrows?: boolean;
    /** Repo whose `git merge --no-ff` into the base feature checkout fails. */
    mergeFailsRepo?: string;
    /** Repo whose `git push origin` from the base feature checkout fails. */
    pushFailsRepo?: string;
    /** Repo whose base feature checkout has tracked local modifications. */
    dirtyBaseByRepo?: Record<string, string>;
    /** Unpushed origin..feature commit count per repo (checked in the base checkout). */
    unpushedByRepo?: Record<string, string>;
    /** When false, a merge does not reduce the ahead count (verification fails). */
    mergeSticks?: boolean;
    /** Whether the outer wrapper holds a local slot branch (polyrepo: usually not). */
    outerBranchPresent?: boolean;
    /** Base feature-workspace roots override (e.g. to simulate a missing checkout). */
    featureRoots?: typeof baseRoots;
  } = {}) {
    const removeDirectory = vi.fn(async () => undefined);
    // Stateful ahead counts: a successful merge into a repo's base checkout
    // drops that repo's count to 0 (unless mergeSticks disables it).
    const ahead = new Map(Object.entries(options.aheadByRepo ?? {}));
    const fakeDeps = {
      runGitCommand: vi.fn(async (command: string, cwd: string) => {
        if (command.startsWith('git rev-list --count')) {
          if (options.aheadThrows) throw new Error('unknown revision');
          // Slot ancestry counts run in the parent repo; the unpushed
          // origin..feature count runs in the base feature checkout.
          const baseRoot = baseRoots.find(r => r.dir === cwd);
          if (baseRoot && command.includes('origin/')) {
            return { stdout: `${options.unpushedByRepo?.[baseRoot.repoKey] ?? '0'}\n` };
          }
          const repo = nested.find(wt => wt.parentRepo === cwd);
          return { stdout: `${ahead.get(repo?.repoKey ?? '') ?? '0'}\n` };
        }
        if (command.startsWith('git push origin')) {
          const root = baseRoots.find(r => r.dir === cwd);
          if (root?.repoKey === options.pushFailsRepo) throw new Error('failed to push some refs');
          return undefined;
        }
        if (command.startsWith('git merge --no-ff')) {
          const root = baseRoots.find(r => r.dir === cwd);
          if (root?.repoKey === options.mergeFailsRepo) throw new Error('CONFLICT (content): merge conflict');
          if (root && options.mergeSticks !== true) ahead.set(root.repoKey, '0');
          return undefined;
        }
        if (command === 'git merge --abort') return undefined;
        if (command.startsWith('git branch --list')) {
          return { stdout: options.outerBranchPresent === false ? '' : `${slotBranch}\n` };
        }
        if (command.startsWith('git status --porcelain')) {
          const baseRoot = baseRoots.find(r => r.dir === cwd);
          if (baseRoot) return { stdout: options.dirtyBaseByRepo?.[baseRoot.repoKey] ?? '' };
          const repo = nested.find(wt => wt.dir === cwd);
          return { stdout: options.dirtyByRepo?.[repo?.repoKey ?? ''] ?? '' };
        }
        if (command === 'git worktree list --porcelain') {
          if (options.worktreeListThrows) throw new Error('worktree list failed');
          if (cwd === workspacePath) {
            const lines = [`worktree ${workspacePath}`, ''];
            if (options.aggregateRegistered !== false) lines.push(`worktree ${slotWorkspace}`, '');
            return { stdout: lines.join('\n') };
          }
          const repo = nested.find(wt => wt.parentRepo === cwd);
          const lines = [`worktree ${cwd}`, ''];
          if (repo && repo.repoKey !== options.unregisteredRepo) lines.push(`worktree ${repo.dir}`, '');
          return { stdout: lines.join('\n') };
        }
        if (command.startsWith('git worktree remove')) {
          if (command.includes(JSON.stringify(slotWorkspace)) && options.rootRemoveError) {
            throw new Error(options.rootRemoveError);
          }
          const failing = nested.find(wt => wt.repoKey === options.nestedRemoveErrorRepo);
          if (failing && command.includes(JSON.stringify(failing.dir))) {
            throw new Error('nested worktree is locked');
          }
          return undefined;
        }
        return undefined;
      }),
      clearSlotAssignment: vi.fn(),
      listSessionNames: vi.fn(async () => [] as string[]),
      slotWorktreeExists: vi.fn(() => true),
      listSlotWorkspaceWorktrees: () => ({ isPolyrepo: true, nested }),
      listFeatureWorkspaceRepoRoots: () => options.featureRoots ?? baseRoots,
      removeDirectory,
    };
    return fakeDeps;
  }

  const polySlot = () => slot({
    itemId: 'wi-36',
    slotIndex: 2,
    branch: slotBranch,
    agentId: 'agent-min-888-slot-2',
  });

  it('detaches every nested worktree in its parent repo before removing the aggregate root', async () => {
    const fakeDeps = polyrepoDeps();

    const actions = await gcMergedSlots('MIN-888', workspacePath, [polySlot()], fakeDeps);

    expect(actions).toEqual(['[swarm] gc slot 2 (item wi-36) for MIN-888']);
    const calls = vi.mocked(fakeDeps.runGitCommand).mock.calls.map(([command, cwd]) => `${command} @ ${cwd}`);
    const rootRemoveIndex = calls.findIndex(c => c.startsWith(`git worktree remove --force ${JSON.stringify(slotWorkspace)}`));
    for (const wt of nested) {
      expect(fakeDeps.runGitCommand).toHaveBeenCalledWith(
        `git worktree remove --force ${JSON.stringify(wt.dir)}`,
        wt.parentRepo,
      );
      expect(fakeDeps.runGitCommand).toHaveBeenCalledWith(
        `git branch -D ${JSON.stringify(slotBranch)}`,
        wt.parentRepo,
      );
      const nestedRemoveIndex = calls.findIndex(c => c.startsWith(`git worktree remove --force ${JSON.stringify(wt.dir)}`));
      expect(nestedRemoveIndex).toBeGreaterThanOrEqual(0);
      expect(nestedRemoveIndex).toBeLessThan(rootRemoveIndex);
    }
    expect(rootRemoveIndex).toBeGreaterThanOrEqual(0);
    expect(fakeDeps.runGitCommand).toHaveBeenCalledWith(
      `git branch -D ${JSON.stringify(slotBranch)}`,
      workspacePath,
    );
    expect(fakeDeps.clearSlotAssignment).toHaveBeenCalledWith(workspacePath, 'MIN-888', 2, 'wi-36');
  });

  it('merges every unmerged nested slot branch before reaping, with no outer slot branch (PAN-3695)', async () => {
    const fakeDeps = {
      ...polyrepoDeps({ aheadByRepo: { api: '3', fe: '2' }, outerBranchPresent: false }),
      listSessionNames: vi.fn(async () => ['agent-min-888-slot-2']),
      stopSlotAgent: vi.fn(async () => undefined),
    };

    const actions = await gcMergedSlots('MIN-888', workspacePath, [
      { ...polySlot(), mergedVia: 'completed-status' as const },
    ], fakeDeps);

    // Both nested branches merged through their base feature-workspace checkouts.
    expect(fakeDeps.runGitCommand).toHaveBeenCalledWith(
      `git merge --no-ff ${JSON.stringify(slotBranch)}`,
      `${workspacePath}/api`,
    );
    expect(fakeDeps.runGitCommand).toHaveBeenCalledWith(
      `git merge --no-ff ${JSON.stringify(slotBranch)}`,
      `${workspacePath}/fe`,
    );
    // Ancestry verification ran per repo AFTER the merge (rev-list before + after).
    const revListCalls = vi.mocked(fakeDeps.runGitCommand).mock.calls
      .filter(([command]) => command.startsWith('git rev-list --count'));
    expect(revListCalls.filter(([, cwd]) => cwd === '/myn/api')).toHaveLength(2);
    expect(revListCalls.filter(([, cwd]) => cwd === '/myn/frontend')).toHaveLength(2);
    // Every merge precedes every removal and the reap — nothing is reaped early.
    const calls = vi.mocked(fakeDeps.runGitCommand).mock.calls.map(([command]) => command);
    const lastMerge = Math.max(...calls
      .map((command, index) => command.startsWith('git merge --no-ff') ? index : -1));
    const firstRemove = calls.findIndex(command => command.includes('worktree remove') || command.includes('branch -D'));
    expect(lastMerge).toBeGreaterThanOrEqual(0);
    expect(firstRemove).toBeGreaterThan(lastMerge);
    // Each verified merge is pushed to origin before any removal.
    expect(fakeDeps.runGitCommand).toHaveBeenCalledWith('git push origin "feature/min-888"', `${workspacePath}/api`);
    expect(fakeDeps.runGitCommand).toHaveBeenCalledWith('git push origin "feature/min-888"', `${workspacePath}/fe`);
    const lastPush = Math.max(...calls
      .map((command, index) => command.startsWith('git push origin') ? index : -1));
    expect(lastPush).toBeGreaterThan(lastMerge);
    expect(firstRemove).toBeGreaterThan(lastPush);
    expect(fakeDeps.stopSlotAgent).toHaveBeenCalledWith('agent-min-888-slot-2');
    const stopOrder = fakeDeps.stopSlotAgent.mock.invocationCallOrder[0];
    const lastMergeOrder = vi.mocked(fakeDeps.runGitCommand).mock.invocationCallOrder[lastMerge];
    expect(stopOrder).toBeGreaterThan(lastMergeOrder);
    // The absent outer slot branch is an idempotent success: no branch -D in
    // the wrapper, yet the slot still frees.
    expect(calls.some(command => command.includes('branch -D') )).toBe(true); // nested repos only
    expect(vi.mocked(fakeDeps.runGitCommand).mock.calls
      .some(([command, cwd]) => command.includes('branch -D') && cwd === workspacePath)).toBe(false);
    expect(actions).toContain('[swarm] gc slot 2 (item wi-36) for MIN-888');
    expect(fakeDeps.clearSlotAssignment).toHaveBeenCalledWith(workspacePath, 'MIN-888', 2, 'wi-36');
  });

  it('keeps a partially-merged slot unmerged and retryable when one nested merge fails (PAN-3695)', async () => {
    const fakeDeps = {
      ...polyrepoDeps({ aheadByRepo: { api: '3', fe: '2' }, mergeFailsRepo: 'fe' }),
      stopSlotAgent: vi.fn(async () => undefined),
    };

    const actions = await gcMergedSlots('MIN-888', workspacePath, [polySlot()], fakeDeps);

    expect(actions).toHaveLength(1);
    expect(actions[0]).toContain('nested merge incomplete');
    expect(actions[0]).toContain('fe');
    expect(actions[0]).toContain('did not merge cleanly');
    // The failed merge is aborted in the fe base checkout; the successful api
    // merge is preserved (no rollback), and nothing is removed or reaped.
    expect(fakeDeps.runGitCommand).toHaveBeenCalledWith('git merge --abort', `${workspacePath}/fe`);
    expect(fakeDeps.runGitCommand).toHaveBeenCalledWith(
      `git merge --no-ff ${JSON.stringify(slotBranch)}`,
      `${workspacePath}/api`,
    );
    const commands = vi.mocked(fakeDeps.runGitCommand).mock.calls.map(([command]) => command);
    expect(commands.some(command => command.includes('worktree remove') || command.includes('branch -D'))).toBe(false);
    expect(commands.some(command => command.includes('reset'))).toBe(false);
    expect(fakeDeps.removeDirectory).not.toHaveBeenCalled();
    expect(fakeDeps.clearSlotAssignment).not.toHaveBeenCalled();
    expect(fakeDeps.stopSlotAgent).not.toHaveBeenCalled();

    // Retry: the already-merged api repo is not re-merged; the failed fe repo is.
    vi.mocked(fakeDeps.runGitCommand).mockClear();
    const retryDeps = {
      ...polyrepoDeps({ aheadByRepo: { fe: '2' } }),
      stopSlotAgent: fakeDeps.stopSlotAgent,
    };
    const retryActions = await gcMergedSlots('MIN-888', workspacePath, [polySlot()], retryDeps);
    expect(retryDeps.runGitCommand).not.toHaveBeenCalledWith(
      `git merge --no-ff ${JSON.stringify(slotBranch)}`,
      `${workspacePath}/api`,
    );
    expect(retryDeps.runGitCommand).toHaveBeenCalledWith(
      `git merge --no-ff ${JSON.stringify(slotBranch)}`,
      `${workspacePath}/fe`,
    );
    expect(retryActions).toContain('[swarm] gc slot 2 (item wi-36) for MIN-888');
  });

  it('verifies ancestry for every changed nested repo before completing the slot (PAN-3695)', async () => {
    // The merge command exits 0 but the slot head never lands — verification
    // must catch it and keep the slot occupied.
    const fakeDeps = polyrepoDeps({ aheadByRepo: { api: '3' }, mergeSticks: true });

    const actions = await gcMergedSlots('MIN-888', workspacePath, [polySlot()], fakeDeps);

    expect(actions).toHaveLength(1);
    expect(actions[0]).toContain('api');
    expect(actions[0]).toContain('ancestry verification failed');
    expect(actions[0]).toContain('3 commit(s)');
    const commands = vi.mocked(fakeDeps.runGitCommand).mock.calls.map(([command]) => command);
    expect(commands.some(command => command.includes('worktree remove') || command.includes('branch -D'))).toBe(false);
    expect(fakeDeps.removeDirectory).not.toHaveBeenCalled();
    expect(fakeDeps.clearSlotAssignment).not.toHaveBeenCalled();
  });

  it('refuses to merge into a dirty base feature checkout, then retries once clean (PAN-3695)', async () => {
    const fakeDeps = {
      ...polyrepoDeps({ aheadByRepo: { api: '3' }, dirtyBaseByRepo: { api: ' M src/hot.ts\n' } }),
      stopSlotAgent: vi.fn(async () => undefined),
    };

    const actions = await gcMergedSlots('MIN-888', workspacePath, [polySlot()], fakeDeps);

    expect(actions).toHaveLength(1);
    expect(actions[0]).toContain('nested merge incomplete');
    expect(actions[0]).toContain('api');
    expect(actions[0]).toContain('base feature checkout');
    expect(actions[0]).toContain('uncommitted changes');
    const commands = vi.mocked(fakeDeps.runGitCommand).mock.calls.map(([command]) => command);
    expect(commands.some(command => command.includes('git merge'))).toBe(false);
    expect(commands.some(command => command.includes('worktree remove') || command.includes('branch -D'))).toBe(false);
    expect(fakeDeps.removeDirectory).not.toHaveBeenCalled();
    expect(fakeDeps.clearSlotAssignment).not.toHaveBeenCalled();
    expect(fakeDeps.stopSlotAgent).not.toHaveBeenCalled();

    // Retry with a clean base: the merge, verification, and push all run.
    const retryDeps = polyrepoDeps({ aheadByRepo: { api: '3' } });
    const retryActions = await gcMergedSlots('MIN-888', workspacePath, [polySlot()], retryDeps);
    expect(retryDeps.runGitCommand).toHaveBeenCalledWith(
      `git merge --no-ff ${JSON.stringify(slotBranch)}`,
      `${workspacePath}/api`,
    );
    expect(retryDeps.runGitCommand).toHaveBeenCalledWith('git push origin "feature/min-888"', `${workspacePath}/api`);
    expect(retryActions).toContain('[swarm] gc slot 2 (item wi-36) for MIN-888');
  });

  it('keeps the slot retryable when the push after a verified merge fails (PAN-3695)', async () => {
    const fakeDeps = {
      ...polyrepoDeps({ aheadByRepo: { api: '3' }, pushFailsRepo: 'api' }),
      stopSlotAgent: vi.fn(async () => undefined),
    };

    const actions = await gcMergedSlots('MIN-888', workspacePath, [polySlot()], fakeDeps);

    expect(actions).toHaveLength(1);
    expect(actions[0]).toContain('nested merge incomplete');
    expect(actions[0]).toContain('api');
    expect(actions[0]).toContain('push to origin failed');
    const commands = vi.mocked(fakeDeps.runGitCommand).mock.calls.map(([command]) => command);
    expect(commands.some(command => command.includes('worktree remove') || command.includes('branch -D'))).toBe(false);
    expect(fakeDeps.removeDirectory).not.toHaveBeenCalled();
    expect(fakeDeps.clearSlotAssignment).not.toHaveBeenCalled();
    expect(fakeDeps.stopSlotAgent).not.toHaveBeenCalled();

    // Retry: the local merge is already an ancestor, but the unpushed count
    // proves remote durability is still owed — push is retried, then GC frees.
    const retryDeps = polyrepoDeps({ unpushedByRepo: { api: '4' } });
    const retryActions = await gcMergedSlots('MIN-888', workspacePath, [polySlot()], retryDeps);
    expect(retryDeps.runGitCommand).not.toHaveBeenCalledWith(
      `git merge --no-ff ${JSON.stringify(slotBranch)}`,
      `${workspacePath}/api`,
    );
    expect(retryDeps.runGitCommand).toHaveBeenCalledWith('git push origin "feature/min-888"', `${workspacePath}/api`);
    expect(retryActions).toContain('[swarm] gc slot 2 (item wi-36) for MIN-888');
  });

  it('fails an already-merged-local repo whose base checkout is missing — remote durability unverifiable (PAN-3695)', async () => {
    const fakeDeps = polyrepoDeps({
      featureRoots: baseRoots.filter(root => root.repoKey !== 'api'),
    });

    const actions = await gcMergedSlots('MIN-888', workspacePath, [polySlot()], fakeDeps);

    expect(actions).toHaveLength(1);
    expect(actions[0]).toContain('nested merge incomplete');
    expect(actions[0]).toContain('api');
    expect(actions[0]).toContain('no base feature-workspace checkout');
    const commands = vi.mocked(fakeDeps.runGitCommand).mock.calls.map(([command]) => command);
    expect(commands.some(command => command.includes('worktree remove') || command.includes('branch -D'))).toBe(false);
    expect(fakeDeps.removeDirectory).not.toHaveBeenCalled();
    expect(fakeDeps.clearSlotAssignment).not.toHaveBeenCalled();
  });

  it('preserves a slot when a nested merge state cannot be determined', async () => {
    const fakeDeps = polyrepoDeps({ aheadThrows: true });

    const actions = await gcMergedSlots('MIN-888', workspacePath, [polySlot()], fakeDeps);

    expect(actions).toHaveLength(1);
    expect(actions[0]).toContain('could not be determined');
    const commands = vi.mocked(fakeDeps.runGitCommand).mock.calls.map(([command]) => command);
    expect(commands.some(command => command.includes('worktree remove') || command.includes('branch -D'))).toBe(false);
    expect(fakeDeps.removeDirectory).not.toHaveBeenCalled();
    expect(fakeDeps.clearSlotAssignment).not.toHaveBeenCalled();
  });

  it('preserves a slot whose nested worktree has uncommitted tracked changes', async () => {
    const fakeDeps = polyrepoDeps({ dirtyByRepo: { fe: ' M src/app.ts\n' } });

    const actions = await gcMergedSlots('MIN-888', workspacePath, [polySlot()], fakeDeps);

    expect(actions).toHaveLength(1);
    expect(actions[0]).toContain('uncommitted changes');
    const commands = vi.mocked(fakeDeps.runGitCommand).mock.calls.map(([command]) => command);
    expect(commands.some(command => command.includes('worktree remove') || command.includes('branch -D'))).toBe(false);
    expect(fakeDeps.removeDirectory).not.toHaveBeenCalled();
    expect(fakeDeps.clearSlotAssignment).not.toHaveBeenCalled();
  });

  it('preserves a slot whose nested worktree contains an untracked user file', async () => {
    const fakeDeps = polyrepoDeps({ dirtyByRepo: { fe: '?? notes-wip.ts\n' } });

    const actions = await gcMergedSlots('MIN-888', workspacePath, [polySlot()], fakeDeps);

    expect(actions).toHaveLength(1);
    expect(actions[0]).toContain('uncommitted changes');
    const commands = vi.mocked(fakeDeps.runGitCommand).mock.calls.map(([command]) => command);
    expect(commands.some(command => command.includes('worktree remove') || command.includes('branch -D'))).toBe(false);
    expect(fakeDeps.removeDirectory).not.toHaveBeenCalled();
    expect(fakeDeps.clearSlotAssignment).not.toHaveBeenCalled();
  });

  it('treats an empty rev-list stdout as unknown merge state, never as merged', async () => {
    const fakeDeps = polyrepoDeps();
    vi.mocked(fakeDeps.runGitCommand).mockImplementation(async (command: string) => {
      if (command.startsWith('git rev-list --count')) return undefined;
      if (command.startsWith('git status --porcelain')) return { stdout: '' };
      return undefined;
    });

    const actions = await gcMergedSlots('MIN-888', workspacePath, [polySlot()], fakeDeps);

    expect(actions).toHaveLength(1);
    expect(actions[0]).toContain('could not be determined');
    const commands = vi.mocked(fakeDeps.runGitCommand).mock.calls.map(([command]) => command);
    expect(commands.some(command => command.includes('worktree remove') || command.includes('branch -D'))).toBe(false);
    expect(fakeDeps.removeDirectory).not.toHaveBeenCalled();
    expect(fakeDeps.clearSlotAssignment).not.toHaveBeenCalled();
  });

  it('defers without clearing the assignment when a nested worktree remove fails', async () => {
    const fakeDeps = polyrepoDeps({ nestedRemoveErrorRepo: 'api' });

    const actions = await gcMergedSlots('MIN-888', workspacePath, [polySlot()], fakeDeps);

    expect(actions.some(action => action.includes('nested worktree remove failed in api'))).toBe(true);
    // The failure escaped preflight after fe was already detached; the defer
    // reason must record the partial state.
    expect(actions.some(action => action.includes('already detached: fe'))).toBe(true);
    expect(fakeDeps.clearSlotAssignment).not.toHaveBeenCalled();
    const commands = vi.mocked(fakeDeps.runGitCommand).mock.calls.map(([command]) => command);
    expect(commands.some(command => command.includes(JSON.stringify(slotWorkspace)))).toBe(false);
  });

  it('removes nothing when a nested worktree fails the registration preflight', async () => {
    const fakeDeps = polyrepoDeps({ unregisteredRepo: 'api' });

    const actions = await gcMergedSlots('MIN-888', workspacePath, [polySlot()], fakeDeps);

    expect(actions).toHaveLength(1);
    expect(actions[0]).toContain('not registered');
    expect(actions[0]).toContain('api');
    // Zero removals: no worktree remove, no branch delete, no directory rm.
    const commands = vi.mocked(fakeDeps.runGitCommand).mock.calls.map(([command]) => command);
    expect(commands.some(command => command.includes('worktree remove') || command.includes('branch -D'))).toBe(false);
    expect(fakeDeps.removeDirectory).not.toHaveBeenCalled();
    expect(fakeDeps.clearSlotAssignment).not.toHaveBeenCalled();
  });

  it('removes nothing when the aggregate registration cannot be determined', async () => {
    const fakeDeps = polyrepoDeps({ worktreeListThrows: true });

    const actions = await gcMergedSlots('MIN-888', workspacePath, [polySlot()], fakeDeps);

    expect(actions).toHaveLength(1);
    expect(actions[0]).toContain('could not be determined');
    const commands = vi.mocked(fakeDeps.runGitCommand).mock.calls.map(([command]) => command);
    expect(commands.some(command => command.includes('worktree remove') || command.includes('branch -D'))).toBe(false);
    expect(fakeDeps.removeDirectory).not.toHaveBeenCalled();
    expect(fakeDeps.clearSlotAssignment).not.toHaveBeenCalled();
  });

  it('removes a preflight-unregistered aggregate root as a plain directory without a git attempt', async () => {
    const fakeDeps = polyrepoDeps({ aggregateRegistered: false });

    const actions = await gcMergedSlots('MIN-888', workspacePath, [polySlot()], fakeDeps);

    expect(actions).toEqual(['[swarm] gc slot 2 (item wi-36) for MIN-888']);
    // The aggregate git-remove is never attempted — preflight already routed
    // to the plain-directory removal.
    const commands = vi.mocked(fakeDeps.runGitCommand).mock.calls.map(([command]) => command);
    expect(commands.some(command => command.includes(JSON.stringify(slotWorkspace)) && command.includes('worktree remove'))).toBe(false);
    expect(fakeDeps.removeDirectory).toHaveBeenCalledWith(slotWorkspace);
    expect(fakeDeps.clearSlotAssignment).toHaveBeenCalledWith(workspacePath, 'MIN-888', 2, 'wi-36');
  });

  it('removes an unregistered aggregate root as a plain directory after nested detach', async () => {
    const fakeDeps = polyrepoDeps({ rootRemoveError: `fatal: '${slotWorkspace}' is not a working tree` });

    const actions = await gcMergedSlots('MIN-888', workspacePath, [polySlot()], fakeDeps);

    expect(actions).toEqual(['[swarm] gc slot 2 (item wi-36) for MIN-888']);
    expect(fakeDeps.removeDirectory).toHaveBeenCalledWith(slotWorkspace);
    expect(fakeDeps.clearSlotAssignment).toHaveBeenCalledWith(workspacePath, 'MIN-888', 2, 'wi-36');
  });
});

describe('deacon-swarm orphaned slot GC', () => {
  const workspacePath = '/repo/workspaces/feature-pan-2203';

  function reconciled(overrides: Partial<SlotReconcileResult> = {}): SlotReconcileResult {
    return {
      issueId: 'PAN-2203',
      merged: [],
      inFlight: [],
      pending: [],
      branches: [],
      agents: [],
      ...overrides,
    };
  }

  function orphanDeps(options: {
    worktreeSlotIndexes?: number[];
    aheadCountByBranch?: Record<string, string>;
    sessionNames?: string[];
    slotAssignments?: Array<{ slotIndex: number; itemId: string }>;
  } = {}): Pick<CoordinateSwarmSlotsDeps, 'runGitCommand' | 'listSessionNames' | 'listSlotAssignments'> {
    return {
      runGitCommand: vi.fn(async (command: string) => {
        if (command === 'git worktree list --porcelain') {
          const lines = [`worktree ${workspacePath}`, ''];
          for (const slotIndex of options.worktreeSlotIndexes ?? []) {
            lines.push(`worktree ${workspacePath}-slot-${slotIndex}`, '');
          }
          return { stdout: lines.join('\n') };
        }
        for (const [branch, count] of Object.entries(options.aheadCountByBranch ?? {})) {
          if (command === `git rev-list --count HEAD..${JSON.stringify(branch)}`) return { stdout: `${count}\n` };
        }
        return undefined;
      }),
      listSessionNames: vi.fn(async () => options.sessionNames ?? []),
      listSlotAssignments: vi.fn(() => options.slotAssignments ?? []),
    };
  }

  it('removes an orphaned slot worktree and branch with zero commits ahead', async () => {
    const fakeDeps = orphanDeps({
      worktreeSlotIndexes: [2],
      aheadCountByBranch: { 'feature/pan-2203-slot-2': '0' },
    });

    await expect(gcOrphanedSlots('PAN-2203', workspacePath, reconciled({
      branches: [{ slotIndex: 2, branch: 'feature/pan-2203-slot-2', merged: false }],
    }), fakeDeps)).resolves.toEqual(['[swarm] gc-orphan slot 2 for PAN-2203']);

    expect(fakeDeps.runGitCommand).toHaveBeenCalledWith(
      `git worktree remove --force "${workspacePath}-slot-2"`,
      workspacePath,
    );
    expect(fakeDeps.runGitCommand).toHaveBeenCalledWith(
      'git branch -D "feature/pan-2203-slot-2"',
      workspacePath,
    );
  });

  it('preserves an orphaned branch with unmerged commits and points at pan swarm reset', async () => {
    const fakeDeps = orphanDeps({
      worktreeSlotIndexes: [2],
      aheadCountByBranch: { 'feature/pan-2203-slot-2': '3' },
    });

    const actions = await gcOrphanedSlots('PAN-2203', workspacePath, reconciled({
      branches: [{ slotIndex: 2, branch: 'feature/pan-2203-slot-2', merged: false }],
    }), fakeDeps);

    expect(actions).toHaveLength(1);
    expect(actions[0]).toContain('feature/pan-2203-slot-2');
    expect(actions[0]).toContain('3 unmerged commit(s)');
    expect(actions[0]).toContain('pan swarm reset PAN-2203');
    const commands = vi.mocked(fakeDeps.runGitCommand).mock.calls.map(([command]) => command);
    expect(commands.some(command => command.includes('worktree remove') || command.includes('branch -D'))).toBe(false);
  });

  it('preserves an orphaned branch report-only when the ahead count cannot be determined', async () => {
    const fakeDeps = orphanDeps({ worktreeSlotIndexes: [2] });
    vi.mocked(fakeDeps.runGitCommand).mockImplementation(async (command: string) => {
      if (command === 'git worktree list --porcelain') {
        return { stdout: `worktree ${workspacePath}\n\nworktree ${workspacePath}-slot-2\n` };
      }
      if (command.startsWith('git rev-list')) throw new Error('unknown revision');
      return undefined;
    });

    const actions = await gcOrphanedSlots('PAN-2203', workspacePath, reconciled({
      branches: [{ slotIndex: 2, branch: 'feature/pan-2203-slot-2', merged: false }],
    }), fakeDeps);

    expect(actions).toHaveLength(1);
    expect(actions[0]).toContain('pan swarm reset PAN-2203');
    const commands = vi.mocked(fakeDeps.runGitCommand).mock.calls.map(([command]) => command);
    expect(commands.some(command => command.includes('worktree remove') || command.includes('branch -D'))).toBe(false);
  });

  it('removes an orphaned worktree that has no local branch left', async () => {
    const fakeDeps = orphanDeps({ worktreeSlotIndexes: [4] });

    await expect(gcOrphanedSlots('PAN-2203', workspacePath, reconciled(), fakeDeps))
      .resolves.toEqual(['[swarm] gc-orphan slot 4 for PAN-2203']);

    expect(fakeDeps.runGitCommand).toHaveBeenCalledWith(
      `git worktree remove --force "${workspacePath}-slot-4"`,
      workspacePath,
    );
    const commands = vi.mocked(fakeDeps.runGitCommand).mock.calls.map(([command]) => command);
    expect(commands.some(command => command.includes('branch -D'))).toBe(false);
  });

  it('sends zero deletion commands for slots with a live agent session or a slotAssignments entry', async () => {
    const fakeDeps = orphanDeps({
      worktreeSlotIndexes: [1, 3],
      sessionNames: ['agent-pan-2203-slot-1'],
      slotAssignments: [{ slotIndex: 3, itemId: 'wi-3' }],
    });

    await expect(gcOrphanedSlots('PAN-2203', workspacePath, reconciled({
      branches: [
        { slotIndex: 1, branch: 'feature/pan-2203-slot-1', merged: false },
        { slotIndex: 3, branch: 'feature/pan-2203-slot-3', merged: false },
      ],
    }), fakeDeps)).resolves.toEqual([]);

    const commands = vi.mocked(fakeDeps.runGitCommand).mock.calls.map(([command]) => command);
    expect(commands.some(command => command.includes('worktree remove') || command.includes('branch -D'))).toBe(false);
  });

  it('skips slots handled by merged-slot GC in the same cycle', async () => {
    const fakeDeps = orphanDeps({
      aheadCountByBranch: { 'feature/pan-2203-slot-5': '0' },
    });

    await expect(gcOrphanedSlots('PAN-2203', workspacePath, reconciled({
      merged: [slot({ itemId: 'wi-5', slotIndex: 5, status: 'merged', branch: 'feature/pan-2203-slot-5' })],
      branches: [{ slotIndex: 5, branch: 'feature/pan-2203-slot-5', merged: true }],
    }), fakeDeps)).resolves.toEqual([]);

    const commands = vi.mocked(fakeDeps.runGitCommand).mock.calls.map(([command]) => command);
    expect(commands.some(command => command.includes('worktree remove') || command.includes('branch -D'))).toBe(false);
  });
});
