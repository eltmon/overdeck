/**
 * Tests for PAN-977 swarm runtime fields on ContinueState.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import {
  readContinueState,
  writeContinueState,
  readContinueStateAsync,
  writeContinueStateAsync,
  continueFilePath,
  type ContinueState,
  type SwarmRuntime,
} from '../continue-state.js';

let TEST_DIR: string;

function freshState(issueId: string): ContinueState {
  const now = new Date().toISOString();
  return {
    version: '1',
    issueId,
    created: now,
    updated: now,
    gitState: {},
    decisions: [],
    hazards: [],
    resumePoint: null,
    beadsMapping: {},
    sessionHistory: [],
  };
}

function freshRuntime(): SwarmRuntime {
  const now = new Date().toISOString();
  return {
    model: 'test-model',
    slots: [],
    synthesisOutputs: {},
    createdAt: now,
    updatedAt: now,
  };
}

beforeEach(() => {
  TEST_DIR = mkdtempSync(`${tmpdir()}/cs-swarm-test-`);
});
afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('swarmRuntime in ContinueState', () => {
  it('round-trips swarmRuntime through sync write/read', () => {
    const state: ContinueState = { ...freshState('PAN-977'), swarmRuntime: freshRuntime() };
    writeContinueState(TEST_DIR, 'PAN-977', state);
    const read = readContinueState(TEST_DIR, 'PAN-977')!;
    expect(read.swarmRuntime).toBeDefined();
    expect(read.swarmRuntime!.model).toBe('test-model');
    expect(read.swarmRuntime!.slots).toHaveLength(0);
  });

  it('round-trips swarmRuntime through async write/read', async () => {
    const state: ContinueState = { ...freshState('PAN-977'), swarmRuntime: freshRuntime() };
    await writeContinueStateAsync(TEST_DIR, 'PAN-977', state);
    const read = await readContinueStateAsync(TEST_DIR, 'PAN-977');
    expect(read?.swarmRuntime?.model).toBe('test-model');
  });

  it('persists slot assignments', () => {
    const runtime: SwarmRuntime = {
      ...freshRuntime(),
      slots: [
        {
          slotId: 1,
          itemId: 'item-a',
          itemTitle: 'Item A',
          sessionName: 'agent-pan-977-1',
          workspace: '/tmp/ws-1',
          status: 'running',
          dispatchedAt: new Date().toISOString(),
        },
      ],
    };
    const state: ContinueState = { ...freshState('PAN-977'), swarmRuntime: runtime };
    writeContinueState(TEST_DIR, 'PAN-977', state);
    const read = readContinueState(TEST_DIR, 'PAN-977')!;
    expect(read.swarmRuntime!.slots).toHaveLength(1);
    expect(read.swarmRuntime!.slots[0]!.itemId).toBe('item-a');
    expect(read.swarmRuntime!.slots[0]!.status).toBe('running');
  });

  it('persists synthesisOutputs', () => {
    const runtime: SwarmRuntime = {
      ...freshRuntime(),
      synthesisOutputs: {
        'item-c': {
          targetItemId: 'item-c',
          writtenAt: new Date().toISOString(),
          contextUpdate: 'upstream A changed the API shape',
        },
      },
    };
    const state: ContinueState = { ...freshState('PAN-977'), swarmRuntime: runtime };
    writeContinueState(TEST_DIR, 'PAN-977', state);
    const read = readContinueState(TEST_DIR, 'PAN-977')!;
    expect(read.swarmRuntime!.synthesisOutputs['item-c']?.contextUpdate).toBe('upstream A changed the API shape');
  });

  it('survives round-trip without swarmRuntime (backwards compat)', () => {
    const state = freshState('PAN-946');
    writeContinueState(TEST_DIR, 'PAN-946', state);
    const read = readContinueState(TEST_DIR, 'PAN-946')!;
    expect(read.swarmRuntime).toBeUndefined();
  });



  it('canonicalizes lowercase and uppercase issue IDs to the same sync file', () => {
    const state: ContinueState = { ...freshState('pan-977'), swarmRuntime: freshRuntime() };
    writeContinueState(TEST_DIR, 'pan-977', state);

    expect(existsSync(continueFilePath(TEST_DIR, 'PAN-977'))).toBe(true);
    expect(existsSync(continueFilePath(TEST_DIR, 'pan-977'))).toBe(true);
    const read = readContinueState(TEST_DIR, 'PAN-977')!;
    expect(read.issueId).toBe('PAN-977');
    expect(read.swarmRuntime?.model).toBe('test-model');
  });

  it('canonicalizes lowercase and uppercase issue IDs to the same async file', async () => {
    const state: ContinueState = { ...freshState('PAN-977'), swarmRuntime: freshRuntime() };
    await writeContinueStateAsync(TEST_DIR, 'PAN-977', state);

    const read = await readContinueStateAsync(TEST_DIR, 'pan-977');
    expect(read?.issueId).toBe('PAN-977');
    expect(read?.swarmRuntime?.model).toBe('test-model');
  });

  it('async read returns null for missing file', async () => {
    const result = await readContinueStateAsync(TEST_DIR, 'PAN-NOT-EXIST');
    expect(result).toBeNull();
  });
});
