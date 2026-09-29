import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  readSwarmSlotState,
  swarmSlotStatePath,
  updateSwarmSlotState,
} from '../swarm-slot-store.js';

let TEST_DIR: string;
const issueId = 'PAN-3';

function baseWorkspace(): string {
  return join(TEST_DIR, 'workspaces', 'feature-pan-3');
}

function slotWorkspace(): string {
  return join(TEST_DIR, 'workspaces', 'feature-pan-3-slot-2');
}

beforeEach(() => {
  TEST_DIR = mkdtempSync(join(tmpdir(), 'swarm-slot-store-'));
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('swarmSlotStatePath (PAN-4225)', () => {
  it('ac1: resolves the base workspace ledger from the base path and from a slot sibling', () => {
    const expected = join(baseWorkspace(), '.pan', 'continues', 'PAN-3.slots.json');

    expect(swarmSlotStatePath(baseWorkspace(), issueId)).toBe(expected);
    expect(swarmSlotStatePath(slotWorkspace(), issueId)).toBe(expected);
  });

  it('ac2: updateSwarmSlotState and readSwarmSlotState round-trip through that file', async () => {
    await updateSwarmSlotState(baseWorkspace(), issueId, (current) => ({
      ...current,
      finalizedAt: '2026-09-29T00:00:00.000Z',
    }));

    const state = readSwarmSlotState(slotWorkspace(), issueId);
    expect(state?.finalizedAt).toBe('2026-09-29T00:00:00.000Z');
    expect(existsSync(swarmSlotStatePath(baseWorkspace(), issueId))).toBe(true);
  });

  it('ac3: writes nothing under the primary checkout .pan', async () => {
    await updateSwarmSlotState(baseWorkspace(), issueId, (current) => ({
      ...current,
      finalizedAt: '2026-09-29T00:00:00.000Z',
    }));

    expect(existsSync(join(TEST_DIR, '.pan'))).toBe(false);
  });
});
