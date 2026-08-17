import { describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import { swarmDispatchCommand, type SwarmDispatchCommandDeps } from '../../../../src/cli/commands/swarm.js';
import { dispatchNextWave, type CoordinateSwarmSlotsDeps } from '../../../../src/lib/cloister/deacon-swarm.js';
import { analyzeSwarmReadiness } from '../../../../src/lib/xbrief/swarm-readiness.js';
import type { XBriefDocument, XBriefItem } from '../../../../src/lib/xbrief/types.js';

function item(id: string, files: string[], status = 'pending'): XBriefItem {
  return {
    id, title: id, status,
    metadata: {
      readiness: 'ready', files_scope: files, files_scope_confidence: 'high',
      verify_commands: ['npm run typecheck'], expected_outputs: ['typecheck passes'],
    },
  };
}

function plan(items: XBriefItem[], edges: XBriefDocument['plan']['edges'] = []): XBriefDocument {
  return {
    xBRIEFInfo: { version: '0.8' },
    plan: { id: 'PAN-3680', title: 'test', status: 'active', items, edges },
  } as XBriefDocument;
}

function deps(overrides: Record<string, unknown> = {}) {
  return {
    registeredSlotCapacityAvailable: vi.fn(() => true),
    tryReserveSwarmSlot: vi.fn(() => true),
    releaseSwarmSlot: vi.fn(),
    applyTaskOperationToPlanFile: vi.fn(async () => undefined),
    recordSlotAssignment: vi.fn(async () => undefined),
    clearSlotAssignment: vi.fn(async () => undefined),
    spawnRun: vi.fn(async () => undefined),
    shouldDispatch: vi.fn(() => true),
    readSwarmHold: vi.fn(() => undefined),
    getMaxSlotIndex: vi.fn(() => 3),
    listSlotAssignments: vi.fn(() => []),
    listSessionNames: vi.fn(async () => []),
    slotWorktreeExists: vi.fn(() => false),
    ...overrides,
  } as unknown as CoordinateSwarmSlotsDeps;
}

function reconciled() {
  return { issueId: 'PAN-3680', merged: [], inFlight: [], pending: [], branches: [], agents: [] };
}

describe('swarm dispatch gate', () => {
  it('runs one dispatch pass and refuses the pass while swarm.hold is set', async () => {
    const doc = plan([item('a', ['a.ts'])]);
    const dispatch = vi.fn(async () => ['dispatched']);
    const commandDeps = {
      resolveProjectFromIssueSync: vi.fn(() => ({ projectName: 'overdeck', projectPath: '/repo' })),
      findSpecByIssue: vi.fn(() => Effect.succeed({
        path: '/repo/spec.json', filename: 'spec.json', issueId: 'PAN-3680', document: doc, status: 'active',
      })),
      analyzeSwarmReadiness,
      ensureWorkspace: vi.fn(async () => '/workspace'),
      readSwarmHold: vi.fn(() => ({ reason: 'frozen', setBy: 'test', at: 'now' })),
      reconcileSlotState: vi.fn(async () => reconciled()),
      dispatchNextWave: dispatch,
      getFailedMergeBlocks: vi.fn(() => []),
      console: { log: vi.fn(), error: vi.fn() },
    } as unknown as SwarmDispatchCommandDeps;

    const held = await swarmDispatchCommand('PAN-3680', {}, commandDeps);
    expect(held.ok).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();

    vi.mocked(commandDeps.readSwarmHold).mockReturnValue(undefined);
    const open = await swarmDispatchCommand('PAN-3680', {}, commandDeps);
    expect(open.ok).toBe(true);
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it('never claims a dependent whose blocker is still running', async () => {
    const doc = plan(
      [item('schema', ['schema.ts'], 'running'), item('entities', ['entities.ts'])],
      [{ from: 'schema', to: 'entities', type: 'blocks' }],
    );
    const fake = deps();

    await dispatchNextWave('PAN-3680', '/workspace', doc, {
      ...reconciled(),
      merged: [{ itemId: 'schema', slotIndex: 1, status: 'merged' as const }],
    }, analyzeSwarmReadiness(doc), fake);

    expect(fake.applyTaskOperationToPlanFile).not.toHaveBeenCalled();
    expect(fake.spawnRun).not.toHaveBeenCalled();
  });

  it('serializes overlapping file scopes', async () => {
    const doc = plan([item('a', ['shared.ts']), item('b', ['shared.ts'])]);
    const fake = deps();

    const actions = await dispatchNextWave(
      'PAN-3680', '/workspace', doc, reconciled(), analyzeSwarmReadiness(doc), fake,
    );

    expect(fake.spawnRun).toHaveBeenCalledTimes(1);
    expect(actions).toContain('[swarm] deferred b for PAN-3680: files_scope overlaps a');
  });

  it('releases the claim, assignment, and capacity reservation when spawn fails', async () => {
    const doc = plan([item('a', ['a.ts'])]);
    const fake = deps({ spawnRun: vi.fn(async () => { throw new Error('spawn failed'); }) });

    await dispatchNextWave('PAN-3680', '/workspace', doc, reconciled(), analyzeSwarmReadiness(doc), fake);

    expect(fake.applyTaskOperationToPlanFile).toHaveBeenLastCalledWith(
      'PAN-3680', expect.objectContaining({ type: 'unblock', itemId: 'a' }), '/workspace',
    );
    expect(fake.clearSlotAssignment).toHaveBeenCalledWith('/workspace', 'PAN-3680', 1, 'a');
    expect(fake.releaseSwarmSlot).toHaveBeenCalledOnce();
  });

  it('rechecks the durable hold after claim and refuses to spawn', async () => {
    const doc = plan([item('a', ['a.ts'])]);
    const fake = deps({ readSwarmHold: vi.fn(() => ({ reason: 'freeze', setBy: 'test', at: 'now' })) });

    const actions = await dispatchNextWave(
      'PAN-3680', '/workspace', doc, reconciled(), analyzeSwarmReadiness(doc), fake,
    );

    expect(fake.spawnRun).not.toHaveBeenCalled();
    expect(fake.clearSlotAssignment).toHaveBeenCalled();
    expect(actions).toEqual(['[swarm] dispatch-halted a: freeze/hold active']);
  });
});
