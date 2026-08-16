/**
 * PAN-2372 WI-3 / FR-4, FR-5: a slot's `pan done` writes a durable
 * slot-completion marker and verifies it persisted BEFORE touching runtime state.
 *
 * completeSlotWork is the unit. Boundary mocks isolate it:
 *  - agents.js: saveAgentStateSync (dynamic) + saveAgentRuntimeState (static)
 *  - activity-logger.js: emitActivityEntrySync
 *  - deacon-swarm-record.js: persistAndVerifySwarmSlotCompletion (boolean — the
 *    write+read-back confirm; returning false drives the FR-5 refuse-and-exit).
 *
 * The door-level persistence mechanics (the actual read-modify-write,
 * statusOverrides preservation) are covered separately in
 * tests/unit/lib/cloister/deacon-swarm-slot-completion.test.ts.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  saveAgentStateSync: vi.fn(),
  saveAgentRuntimeState: vi.fn(),
  emitActivityEntrySync: vi.fn(),
  persistAndVerifySwarmSlotCompletion: vi.fn(),
}));

vi.mock('../../../../src/lib/agents.js', async (importActual) => {
  const actual = await importActual<typeof import('../../../../src/lib/agents.js')>();
  return {
    ...actual,
    saveAgentStateSync: mocks.saveAgentStateSync,
    saveAgentRuntimeState: mocks.saveAgentRuntimeState,
  };
});

vi.mock('../../../../src/lib/activity-logger.js', async (importActual) => {
  const actual = await importActual<typeof import('../../../../src/lib/activity-logger.js')>();
  return { ...actual, emitActivityEntrySync: mocks.emitActivityEntrySync };
});

vi.mock('../../../../src/lib/cloister/deacon-swarm-record.js', () => ({
  persistAndVerifySwarmSlotCompletion: mocks.persistAndVerifySwarmSlotCompletion,
}));

import { completeSlotWork, parseSlotAgentId } from '../../../../src/cli/commands/done.js';
import type { PanIssueSwarmSlotCompletion } from '../../../../src/lib/pan-dir/record.js';

type SlotCtx = Parameters<typeof completeSlotWork>[1];

// Both record door functions are mocked in this file, so the workspace path is
// never touched on disk — a plain sentinel keeps the test hermetic.
const FAKE_WORKSPACE = '/tmp/pan-done-slot-workspace';

function makeSlot(overrides: Partial<SlotCtx> = {}): SlotCtx {
  return {
    agentId: 'agent-pan-2372-slot-1',
    agentState: null,
    slotIndex: 1,
    slotItemId: 'wi-1',
    workspacePath: FAKE_WORKSPACE,
    ...overrides,
  } as SlotCtx;
}

describe('PAN-3682 slot id normalization', () => {
  it.each([
    'MIN-888-SLOT-1',
    'min-888-slot-1',
    'agent-MIN-888-SLOT-1',
    'agent-min-888-slot-1',
  ])('normalizes %s before issue and project resolution', (input) => {
    expect(parseSlotAgentId(input)).toEqual({
      issueId: 'MIN-888',
      agentId: 'agent-min-888-slot-1',
      slotIndex: 1,
    });
  });

  it.each([
    'MIN-888',
    'MIN-888-SLOT-0',
    'MIN-888-SLOT-x',
    'MIN-888-SLOT-1-extra',
  ])('rejects non-slot input %s', (input) => {
    expect(parseSlotAgentId(input)).toBeNull();
  });
});

describe('PAN-2372 WI-3 completeSlotWork durable marker (FR-4, FR-5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: the marker persisted and was observable on read-back.
    mocks.persistAndVerifySwarmSlotCompletion.mockReturnValue(true);
  });

  it('writes the marker with slotIndex/itemId/agentId/ISO completedAt before runtime state (AC1, FR-4)', async () => {
    const slot = makeSlot();
    await completeSlotWork('PAN-2372', slot);

    expect(mocks.persistAndVerifySwarmSlotCompletion).toHaveBeenCalledTimes(1);
    const [workspaceArg, issueArg, completion] = mocks.persistAndVerifySwarmSlotCompletion.mock.calls[0] as [
      string, string, PanIssueSwarmSlotCompletion,
    ];
    expect(workspaceArg).toBe(FAKE_WORKSPACE);
    expect(issueArg).toBe('PAN-2372');
    expect(completion).toEqual({
      slotIndex: 1,
      itemId: 'wi-1',
      agentId: 'agent-pan-2372-slot-1',
      completedAt: expect.any(String),
    });
    // completedAt is a valid ISO-8601 timestamp.
    expect(() => new Date(completion.completedAt).toISOString()).not.toThrow();

    // Runtime state was written, and the marker write happened first.
    expect(mocks.saveAgentRuntimeState).toHaveBeenCalledTimes(1);
    expect(mocks.persistAndVerifySwarmSlotCompletion.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.saveAgentRuntimeState.mock.invocationCallOrder[0]);
  });

  it('writes the marker even when agentState is null and skips agent-state save (AC3)', async () => {
    const slot = makeSlot({ agentState: null });
    await completeSlotWork('PAN-2372', slot);

    expect(mocks.persistAndVerifySwarmSlotCompletion).toHaveBeenCalledTimes(1);
    expect(mocks.saveAgentStateSync).not.toHaveBeenCalled();
    expect(mocks.saveAgentRuntimeState).toHaveBeenCalledTimes(1);
  });

  it('saves agent state when agentState is present, after the marker persists', async () => {
    const slot = makeSlot({ agentState: { id: 'agent-pan-2372-slot-1' } as never });
    await completeSlotWork('PAN-2372', slot);

    expect(mocks.saveAgentStateSync).toHaveBeenCalledTimes(1);
    expect(mocks.persistAndVerifySwarmSlotCompletion.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.saveAgentStateSync.mock.invocationCallOrder[0]);
  });

  it('exits non-zero and writes NO runtime state when the marker did not persist (AC2, FR-5)', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: number) => {
      throw new Error(`EXIT_${code ?? 0}`);
    });
    // The marker did not persist (the literal bug: slot done without recording).
    mocks.persistAndVerifySwarmSlotCompletion.mockReturnValue(false);

    const slot = makeSlot();

    await expect(completeSlotWork('PAN-2372', slot)).rejects.toThrow('EXIT_1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    // No agent-state, runtime-state, or activity write may fire when completion
    // did not persist — the slot must remain "not done" from the coordinator's
    // view so a re-run can retry.
    expect(mocks.saveAgentStateSync).not.toHaveBeenCalled();
    expect(mocks.saveAgentRuntimeState).not.toHaveBeenCalled();
    expect(mocks.emitActivityEntrySync).not.toHaveBeenCalled();

    exitSpy.mockRestore();
  });
});
