import { describe, expect, it, vi } from 'vitest';
import { buildRealReconcileDeps, type TrainIo } from '../../../../src/lib/cloister/merge-train-deps.js';
import { reconcileStaleSiblings } from '../../../../src/lib/cloister/merge-train-reconciler.js';
import type { MergeGateResult } from '../../../../src/lib/cloister/merge-gate.js';
import type { PrFacts } from '../../../../src/lib/cloister/pr-facts.js';

const WS = '/project/workspaces/feature-pan-2';
const PR_HEAD = 'a'.repeat(40);

function facts(overrides: Partial<PrFacts> = {}): PrFacts {
  return {
    issueId: 'PAN-2', forge: 'github', url: null, number: 2, exists: true, open: true, merged: false,
    closed: false, draft: false, headSha: PR_HEAD, headBranch: 'feature/pan-2', reviewDecision: 'APPROVED',
    approved: true, approvedAtHead: true, changesRequested: false, mergeable: true, mergeableState: 'clean',
    checks: 'green', testChecks: 'green', ...overrides,
  };
}

function gate(ready: boolean, overrides: Partial<PrFacts> = {}): MergeGateResult {
  return { ready, ...(ready ? {} : { reason: 'not ready' }), facts: facts(overrides) } as MergeGateResult;
}

const NEW_HEAD = 'd'.repeat(40);
const MAIN = 'e'.repeat(40);
const FORK_POINT = 'f'.repeat(40);

/** A git double answering the rebase path; `answers` overrides by subcommand. */
function gitDouble(answers: Record<string, string | Error> = {}) {
  const calls: string[] = [];
  let rebased = false;
  const git = vi.fn(async (_cwd: string, args: string[]) => {
    const line = args.join(' ');
    calls.push(line);
    for (const [prefix, answer] of Object.entries(answers)) {
      if (line.startsWith(prefix)) {
        if (answer instanceof Error) throw answer;
        return answer;
      }
    }
    if (line === 'branch --show-current') return 'feature/pan-2\n';
    if (line.startsWith('status')) return '';
    if (line === 'rev-parse HEAD') return `${rebased ? NEW_HEAD : PR_HEAD}\n`;
    if (line === 'rev-parse origin/main') return `${MAIN}\n`;
    if (line.startsWith('rev-parse')) return `${PR_HEAD}\n`;
    if (line.startsWith('merge-base')) return `${FORK_POINT}\n`;
    if (line.startsWith('rev-list')) return '3\n';
    if (line === 'rebase origin/main') rebased = true;
    return '';
  });
  return { git, calls };
}

/** Patch-ids by base: the PR diff before the rebase, and after it. */
function patchIds(before: string, after: string) {
  return vi.fn(async (_cwd: string, base: string) => (base === FORK_POINT ? before : after));
}

function io(overrides: Partial<TrainIo> = {}): Partial<TrainIo> {
  return {
    workspacePathFor: () => WS,
    patchId: patchIds('p1', 'p2'),
    log: () => undefined,
    ...overrides,
  };
}

describe('merge-train real deps: sibling set (PAN-4801)', () => {
  it('takes only the merged issue\'s project candidates and never the merged issue', async () => {
    const listProjectIssuesWithPr = vi.fn(async () => ['PAN-1', 'PAN-2']);
    const deps = buildRealReconcileDeps(io({ listProjectIssuesWithPr, evaluateGate: async () => gate(true) }));

    expect(await deps.getReadySiblings('PAN-1')).toEqual(['PAN-2']);
    expect(listProjectIssuesWithPr).toHaveBeenCalledWith('PAN-1');
  });

  it('keeps an approved sibling whatever the cached mergeable flag says', async () => {
    const gates: Record<string, MergeGateResult> = {
      'PAN-2': gate(true),
      'PAN-3': gate(false, { mergeable: null, mergeableState: 'unknown', checks: 'pending' }),
      'PAN-4': gate(false, { mergeable: false, mergeableState: 'dirty', checks: 'none' }),
    };
    const deps = buildRealReconcileDeps(io({
      listProjectIssuesWithPr: async () => Object.keys(gates),
      evaluateGate: async (issueId) => gates[issueId]!,
    }));

    expect(await deps.getReadySiblings('PAN-1')).toEqual(['PAN-2', 'PAN-3', 'PAN-4']);
  });

  it('drops a sibling that is not approved at its head, is a draft, has red checks or requested changes', async () => {
    const unmergeable = { mergeable: null, mergeableState: 'unknown' } as const;
    const gates: Record<string, MergeGateResult> = {
      'PAN-2': gate(false, { ...unmergeable, approvedAtHead: false }),
      'PAN-3': gate(false, { ...unmergeable, draft: true }),
      'PAN-4': gate(false, { ...unmergeable, checks: 'red' }),
      'PAN-5': gate(false, { ...unmergeable, changesRequested: true }),
      'PAN-6': gate(false, { ...unmergeable, open: false }),
      'PAN-7': gate(false, { ...unmergeable, uatVerdict: { status: 'failed' } as PrFacts['uatVerdict'] }),
      // Mergeable but refused for another reason (CI pending): not a train sibling.
      'PAN-8': gate(false, { checks: 'pending' }),
    };
    const deps = buildRealReconcileDeps(io({
      listProjectIssuesWithPr: async () => Object.keys(gates),
      evaluateGate: async (issueId) => gates[issueId]!,
    }));

    expect(await deps.getReadySiblings('PAN-1')).toEqual([]);
  });
});

describe('merge-train real deps: rebaseSibling (PAN-4801)', () => {
  it('rebases the PR head onto origin/main and pushes with a lease on that head', async () => {
    const { git, calls } = gitDouble();
    const deps = buildRealReconcileDeps(io({ git }));

    expect(await deps.rebaseSibling('PAN-2')).toEqual({ status: 'clean' });
    expect(calls).toEqual([
      'branch --show-current',
      'status --porcelain --untracked-files=no',
      'fetch origin main feature/pan-2',
      'rev-parse HEAD',
      'rev-parse refs/remotes/origin/feature/pan-2',
      'rev-list --count HEAD..origin/main',
      'rev-parse origin/main',
      'merge-base HEAD origin/main',
      'rebase origin/main',
      'rev-parse HEAD',
      `push --force-with-lease=refs/heads/feature/pan-2:${PR_HEAD} origin ${NEW_HEAD}:refs/heads/feature/pan-2`,
    ]);
    expect(git.mock.calls.every(([cwd]) => cwd === WS)).toBe(true);
  });

  it('offers to carry the approval when the PR patch-id is the same before and after the rebase', async () => {
    const { git } = gitDouble();
    const patchId = patchIds('same', 'same');
    const deps = buildRealReconcileDeps(io({ git, patchId }));

    expect(await deps.rebaseSibling('PAN-2')).toEqual({
      status: 'clean',
      carry: { from: PR_HEAD, to: NEW_HEAD, patchId: 'same' },
    });
    expect(patchId).toHaveBeenCalledWith(WS, FORK_POINT, PR_HEAD);
    expect(patchId).toHaveBeenCalledWith(WS, MAIN, NEW_HEAD);
  });

  it('offers no carry when either patch-id is empty', async () => {
    const { git } = gitDouble();
    const deps = buildRealReconcileDeps(io({ git, patchId: patchIds('', '') }));

    expect(await deps.rebaseSibling('PAN-2')).toEqual({ status: 'clean' });
  });

  it('reports up-to-date without rebasing when main has nothing new', async () => {
    const { git, calls } = gitDouble({ 'rev-list': '0\n' });
    const deps = buildRealReconcileDeps(io({ git }));

    expect(await deps.rebaseSibling('PAN-2')).toEqual({ status: 'up-to-date' });
    expect(calls).not.toContain('rebase origin/main');
  });

  it('aborts a conflicting rebase and pushes nothing', async () => {
    const { git, calls } = gitDouble({ 'rebase origin/main': new Error('CONFLICT (content)') });
    const deps = buildRealReconcileDeps(io({ git }));

    expect(await deps.rebaseSibling('PAN-2')).toEqual({ status: 'conflict' });
    expect(calls).toContain('rebase --abort');
    expect(calls.some((line) => line.startsWith('push'))).toBe(false);
  });

  it('restores the PR head and throws when the push fails, never calling it a conflict', async () => {
    const { git, calls } = gitDouble({ push: new Error('stale info') });
    const deps = buildRealReconcileDeps(io({ git }));

    await expect(deps.rebaseSibling('PAN-2')).rejects.toThrow(/push of the rebased feature\/pan-2 failed: stale info/);
    expect(calls).toContain(`reset --hard ${PR_HEAD}`);
  });

  it('throws without touching the branch when the workspace is on another branch', async () => {
    const { git, calls } = gitDouble({ 'branch --show-current': '\n' });
    const deps = buildRealReconcileDeps(io({ git }));

    await expect(deps.rebaseSibling('PAN-2')).rejects.toThrow('workspace is on a detached HEAD, not feature/pan-2');
    expect(calls).toEqual(['branch --show-current']);
  });

  it('throws without touching the branch when the workspace has uncommitted changes', async () => {
    const { git, calls } = gitDouble({ status: ' M src/a.ts\n' });
    const deps = buildRealReconcileDeps(io({ git }));

    await expect(deps.rebaseSibling('PAN-2')).rejects.toThrow('workspace has uncommitted changes');
    expect(calls.some((line) => line.startsWith('fetch') || line.startsWith('rebase'))).toBe(false);
  });

  it('throws when the workspace HEAD is not the PR head', async () => {
    const local = 'b'.repeat(40);
    const { git, calls } = gitDouble({ 'rev-parse HEAD': `${local}\n` });
    const deps = buildRealReconcileDeps(io({ git }));

    await expect(deps.rebaseSibling('PAN-2')).rejects.toThrow(
      `workspace HEAD ${local.slice(0, 12)} is not the PR head ${PR_HEAD.slice(0, 12)}`,
    );
    expect(calls).not.toContain('rebase origin/main');
  });

  it('throws when the sibling has no workspace', async () => {
    const { git } = gitDouble();
    const deps = buildRealReconcileDeps(io({ git, workspacePathFor: () => null }));

    await expect(deps.rebaseSibling('PAN-2')).rejects.toThrow('no workspace for PAN-2');
    expect(git).not.toHaveBeenCalled();
  });
});

describe('merge-train real deps: follow-up (PAN-4801)', () => {
  it('asks the guarded review door to re-review a rebased sibling', async () => {
    const requester = vi.fn(async () => ({ kind: 'started' as const, autoRequeueCount: 1 }));
    const deps = buildRealReconcileDeps(io({ reviewRequester: () => requester }));

    await deps.reDispatchVerification('PAN-2');

    expect(requester).toHaveBeenCalledWith('PAN-2', {
      source: 'merge-train',
      message: 'the merge train rebased this branch onto main; re-review the new head',
    });
  });

  it('logs a review request the door refused', async () => {
    const log = vi.fn();
    const requester = vi.fn(async () => ({ kind: 'circuit-breaker' as const, autoRequeueCount: 25 }));
    const deps = buildRealReconcileDeps(io({ log, reviewRequester: () => requester }));

    await deps.reDispatchVerification('PAN-2');

    expect(log).toHaveBeenCalledWith('[merge-train] PAN-2: re-review after the rebase not started (circuit-breaker)');
  });

  it('fails the sibling when no guarded review door is registered', async () => {
    const deps = buildRealReconcileDeps(io({ reviewRequester: () => null }));

    await expect(deps.reDispatchVerification('PAN-2')).rejects.toThrow('no guarded review door in this process');
  });

  it('leaves a conflict to the conflict-repair patrol instead of starting a second agent', async () => {
    const log = vi.fn();
    const deps = buildRealReconcileDeps(io({ log }));

    await deps.dispatchConflictResolver('PAN-2', 'PAN-1');

    expect(log).toHaveBeenCalledWith(
      '[merge-train] PAN-2 conflicts with main after PAN-1; the conflict-repair patrol routes it to the work agent',
    );
  });
});

describe('merge-train real deps: approval carry (PAN-4801)', () => {
  const carry = { from: PR_HEAD, to: NEW_HEAD, patchId: 'same' };
  const posted = { posted: true as const, forge: 'github' as const, url: null, verdict: 'approve' as const, via: 'review' as const };

  function carryIo(overrides: Partial<TrainIo> = {}) {
    const postApproval = vi.fn(async () => posted);
    const journal = vi.fn();
    const log = vi.fn();
    return {
      postApproval,
      journal,
      log,
      io: io({
        readFacts: async () => facts({ headSha: NEW_HEAD, approvedAtHead: undefined }),
        postApproval,
        journal,
        log,
        ...overrides,
      }),
    };
  }

  it('posts an approval pinned to the new head and journals both heads', async () => {
    const { io: train, postApproval, journal } = carryIo();
    const deps = buildRealReconcileDeps(train);

    expect(await deps.carryApproval!('PAN-2', carry)).toBe(true);
    expect(postApproval).toHaveBeenCalledWith(expect.objectContaining({
      issueId: 'PAN-2',
      verdict: 'approve',
      reviewedHead: NEW_HEAD,
      pinHead: NEW_HEAD,
      body: expect.stringContaining(`patch-id same`),
    }));
    expect(journal).toHaveBeenCalledWith(WS, {
      type: 'review.approval-carried',
      issueId: 'PAN-2',
      source: 'merge-train',
      data: { from: PR_HEAD, to: NEW_HEAD, patchId: 'same', via: 'review' },
    });
  });

  it('does not carry when the PR head moved past the rebased head', async () => {
    const { io: train, postApproval } = carryIo({ readFacts: async () => facts({ headSha: 'c'.repeat(40) }) });

    expect(await buildRealReconcileDeps(train).carryApproval!('PAN-2', carry)).toBe(false);
    expect(postApproval).not.toHaveBeenCalled();
  });

  it('does not carry on a non-GitHub forge', async () => {
    const { io: train, postApproval } = carryIo({ readFacts: async () => facts({ forge: 'gitlab', headSha: NEW_HEAD }) });

    expect(await buildRealReconcileDeps(train).carryApproval!('PAN-2', carry)).toBe(false);
    expect(postApproval).not.toHaveBeenCalled();
  });

  it('does not carry, and logs why, when the forge refuses the approval', async () => {
    const { io: train, journal, log } = carryIo({
      postApproval: vi.fn(async () => ({ posted: false as const, reason: 'gh api failed' })),
    });

    expect(await buildRealReconcileDeps(train).carryApproval!('PAN-2', carry)).toBe(false);
    expect(journal).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(`[merge-train] PAN-2: approval not carried to ${NEW_HEAD.slice(0, 12)}: gh api failed`);
  });

  it('end to end: an unchanged patch-id carries the approval and skips the re-review', async () => {
    const { git } = gitDouble();
    const requester = vi.fn(async () => ({ kind: 'started' as const, autoRequeueCount: 1 }));
    const { io: train, postApproval } = carryIo({
      git,
      patchId: patchIds('same', 'same'),
      listProjectIssuesWithPr: async () => ['PAN-2'],
      evaluateGate: async () => gate(true),
      reviewRequester: () => requester,
    });

    expect(await reconcileStaleSiblings('PAN-1', buildRealReconcileDeps(train))).toEqual([
      { issueId: 'PAN-2', result: 'approval-carried' },
    ]);
    expect(postApproval).toHaveBeenCalledOnce();
    expect(requester).not.toHaveBeenCalled();
  });

  it('end to end: a changed patch-id re-reviews and carries nothing', async () => {
    const { git } = gitDouble();
    const requester = vi.fn(async () => ({ kind: 'started' as const, autoRequeueCount: 1 }));
    const { io: train, postApproval } = carryIo({
      git,
      patchId: patchIds('before', 'after'),
      listProjectIssuesWithPr: async () => ['PAN-2'],
      evaluateGate: async () => gate(true),
      reviewRequester: () => requester,
    });

    expect(await reconcileStaleSiblings('PAN-1', buildRealReconcileDeps(train))).toEqual([
      { issueId: 'PAN-2', result: 'rebased' },
    ]);
    expect(postApproval).not.toHaveBeenCalled();
    expect(requester).toHaveBeenCalledWith('PAN-2', expect.objectContaining({ source: 'merge-train' }));
  });
});
