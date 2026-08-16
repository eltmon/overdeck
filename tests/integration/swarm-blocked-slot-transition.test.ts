import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ensureRegisteredSlotWorktree } from '../../src/lib/agents/registered-slot-spawn.js';
import { resolveRegisteredSlotSpawn, type SpawnRunOptions } from '../../src/lib/agents/spawn-prep.js';
import type { SlotReconcileResult } from '../../src/lib/agents/slot-reconcile.js';
import { defaultIsSlotBranchPushed } from '../../src/lib/cloister/swarm-blocked-slot.js';
import { clearReleasedBlockedSwarmSlot, createMinimalIssueRecord } from '../../src/lib/cloister/deacon-swarm-record.js';
import { dispatchNextWave, recordSlotAssignment, releaseBlockedSlots } from '../../src/lib/cloister/deacon-swarm.js';
import { readIssueRecordForWorkspaceSync, writeIssueRecordForWorkspaceSync } from '../../src/lib/pan-dir/record.js';
import { analyzeSwarmReadiness } from '../../src/lib/xbrief/swarm-readiness.js';
import type { XBriefDocument, XBriefItem } from '../../src/lib/xbrief/types.js';
import { cleanupGitRecordRoot, initGitRecordRoot, removeGitRecordRemote } from '../helpers/git-record-fixture.js';

vi.mock('../../src/lib/projects.js', () => ({
  listProjectsSync: vi.fn(() => []),
  findProjectByPathSync: vi.fn(() => null),
  resolveProjectFromIssueSync: vi.fn(() => null),
}));

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function planItem(id: string, status: XBriefItem['status']): XBriefItem {
  return {
    id,
    title: id,
    status,
    metadata: {
      readiness: 'ready',
      files_scope: [`src/${id}.ts`],
      files_scope_confidence: 'high',
      verify_commands: ['npm run typecheck'],
      expected_outputs: ['typecheck completes without errors'],
    },
  };
}

function plan(items: XBriefItem[]): XBriefDocument {
  return {
    xBRIEFInfo: {
      version: '0.6',
      created: '2026-08-14T00:00:00.000Z',
      updated: '2026-08-14T00:00:00.000Z',
      author: 'test',
      description: 'blocked slot transition',
    },
    plan: {
      id: 'pan-2203',
      title: 'blocked slot transition',
      status: 'active',
      created: '2026-08-14T00:00:00.000Z',
      updated: '2026-08-14T00:00:00.000Z',
      items,
      edges: [],
    },
  };
}

describe('blocked swarm slot release and redispatch', () => {
  let fixtureRoot = '';
  let workspacePath = '';
  let recordRemote: string | null = null;

  afterEach(async () => {
    if (workspacePath) await cleanupGitRecordRoot(workspacePath);
    if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true });
    removeGitRecordRemote(recordRemote);
    fixtureRoot = '';
    workspacePath = '';
    recordRemote = null;
  });

  it('preserves the old remote attempt and starts the reused static agent on a clean attempt branch', async () => {
    fixtureRoot = mkdtempSync(join(tmpdir(), 'pan-blocked-slot-transition-'));
    workspacePath = join(fixtureRoot, 'feature-pan-2203');
    mkdirSync(workspacePath);
    recordRemote = initGitRecordRoot(workspacePath);

    writeIssueRecordForWorkspaceSync(workspacePath, 'PAN-2203', {
      ...createMinimalIssueRecord('PAN-2203'),
      statusOverrides: { 'wi-blocked': 'blocked' },
      swarm: {
        slotAssignments: [{
          slotIndex: 1,
          itemId: 'wi-blocked',
          agentId: 'agent-pan-2203-slot-1',
          branch: 'feature/pan-2203-slot-1',
        }],
      },
    });
    git(workspacePath, 'add', '.');
    git(workspacePath, 'commit', '-qm', 'seed blocked assignment');
    git(workspacePath, 'push', '-q');
    git(workspacePath, 'branch', 'feature/pan-2203');
    git(workspacePath, 'push', '-q', '-u', 'origin', 'feature/pan-2203');

    const slotWorkspace = `${workspacePath}-slot-1`;
    git(workspacePath, 'worktree', 'add', '-qb', 'feature/pan-2203-slot-1', slotWorkspace, 'feature/pan-2203');
    writeFileSync(join(slotWorkspace, 'blocked.txt'), 'blocked\n');
    git(slotWorkspace, 'add', 'blocked.txt');
    git(slotWorkspace, 'commit', '-qm', 'blocked attempt');
    git(slotWorkspace, 'push', '-q', '-u', 'origin', 'feature/pan-2203-slot-1');
    const blockedTip = git(slotWorkspace, 'rev-parse', 'HEAD');

    git(slotWorkspace, 'update-ref', '-d', 'refs/remotes/origin/feature/pan-2203-slot-1');
    await expect(defaultIsSlotBranchPushed(workspacePath, 'PAN-2203', 'feature/pan-2203-slot-1')).resolves.toBe(true);
    execFileSync('git', ['--git-dir', recordRemote!, 'update-ref', '-d', 'refs/heads/feature/pan-2203-slot-1']);
    await expect(defaultIsSlotBranchPushed(workspacePath, 'PAN-2203', 'feature/pan-2203-slot-1')).resolves.toBe(false);
    git(slotWorkspace, 'push', '-q', 'origin', 'refs/heads/feature/pan-2203-slot-1:refs/heads/feature/pan-2203-slot-1');

    const blockedPlan = plan([planItem('wi-blocked', 'blocked')]);
    const blockedState: SlotReconcileResult = {
      issueId: 'PAN-2203',
      merged: [],
      pending: [],
      inFlight: [{
        itemId: 'wi-blocked',
        slotIndex: 1,
        status: 'in_flight',
        branch: 'feature/pan-2203-slot-1',
        agentId: 'agent-pan-2203-slot-1',
      }],
      branches: [{ slotIndex: 1, branch: 'feature/pan-2203-slot-1', merged: false }],
      agents: [{ slotIndex: 1, agentId: 'agent-pan-2203-slot-1', status: 'stopped', slotItemId: 'wi-blocked' }],
    };
    await releaseBlockedSlots('PAN-2203', workspacePath, blockedPlan, blockedState, {
      listSessionNames: vi.fn(async () => []),
      isPaneDead: vi.fn(async () => true),
      isSlotWorktreeClean: vi.fn(async () => true),
    });

    const released = readIssueRecordForWorkspaceSync(workspacePath, 'PAN-2203')?.swarm?.releasedBlockedSlots?.['1'];
    expect(released?.archivedBranch).toMatch(/^feature\/pan-2203-slot-1-blocked-\d+$/);
    expect(released?.replacementBranch).toMatch(/^feature\/pan-2203-slot-1-attempt-\d+$/);
    expect(existsSync(released!.archivedWorktree!)).toBe(true);
    expect(git(slotWorkspace, 'rev-parse', 'HEAD')).toBe(git(workspacePath, 'rev-parse', 'feature/pan-2203'));
    expect(git(slotWorkspace, 'branch', '--show-current')).toBe(released?.replacementBranch);
    expect(git(workspacePath, 'merge-base', blockedTip, released!.replacementBranch!)).not.toBe(blockedTip);
    expect(git(workspacePath, 'rev-parse', 'feature/pan-2203-slot-1')).toBe(blockedTip);
    expect(git(workspacePath, 'rev-parse', released!.archivedBranch!)).toBe(blockedTip);
    expect(git(released!.archivedWorktree!, 'branch', '--show-current')).toBe(released?.archivedBranch);
    expect(git(released!.archivedWorktree!, 'rev-parse', 'HEAD')).toBe(blockedTip);
    expect(git(workspacePath, 'ls-remote', 'origin', 'refs/heads/feature/pan-2203-slot-1').split(/\s+/)[0]).toBe(blockedTip);
    expect(git(workspacePath, 'ls-remote', 'origin', `refs/heads/${released!.archivedBranch}`).split(/\s+/)[0]).toBe(blockedTip);

    let spawned: ReturnType<typeof resolveRegisteredSlotSpawn> = null;
    const nextPlan = plan([planItem('wi-blocked', 'blocked'), planItem('wi-next', 'pending')]);
    const actions = await dispatchNextWave(
      'PAN-2203',
      workspacePath,
      nextPlan,
      {
        ...blockedState,
        inFlight: [],
        branches: [{ slotIndex: 1, branch: released!.replacementBranch!, merged: false }],
      },
      analyzeSwarmReadiness(nextPlan),
      {
        registeredSlotCapacityAvailable: vi.fn(() => true),
        tryReserveSwarmSlot: vi.fn(() => true),
        releaseSwarmSlot: vi.fn(),
        applyTaskOperationToPlanFile: vi.fn(async () => undefined),
        recordSlotAssignment,
        clearSlotAssignment: vi.fn(async () => undefined),
        spawnRun: vi.fn(async (_issueId: string, _role: 'work', options: SpawnRunOptions) => {
          spawned = resolveRegisteredSlotSpawn('PAN-2203', workspacePath, options);
          await ensureRegisteredSlotWorktree('PAN-2203', workspacePath, spawned!);
        }),
        shouldDispatch: vi.fn(() => true),
        getMaxSlotIndex: vi.fn(() => 1),
        listSlotAssignments: vi.fn(() => []),
        listReleasedSlotIndexes: vi.fn(() => [1]),
        getReleasedSlotBranch: vi.fn(() => released?.replacementBranch),
        clearReleasedSlot: clearReleasedBlockedSwarmSlot,
        listSessionNames: vi.fn(async () => []),
        slotWorktreeExists: existsSync,
      },
    );

    expect(actions).toContain('[swarm] dispatched implementation slot 1 (item wi-next) for PAN-2203');
    expect(spawned).toEqual(expect.objectContaining({
      agentId: 'agent-pan-2203-slot-1',
      branch: released?.replacementBranch,
      workspace: slotWorkspace,
      slotItemId: 'wi-next',
    }));
    expect(readIssueRecordForWorkspaceSync(workspacePath, 'PAN-2203')?.swarm?.releasedBlockedSlots).toEqual({});
    expect(readIssueRecordForWorkspaceSync(workspacePath, 'PAN-2203')?.swarm?.slotAssignments).toEqual([
      expect.objectContaining({
        agentId: 'agent-pan-2203-slot-1',
        branch: released?.replacementBranch,
        itemId: 'wi-next',
      }),
    ]);
  });
});
