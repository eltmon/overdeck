import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import { swarmMergeCommand, type SwarmMergeCommandDeps } from '../../../../src/cli/commands/swarm.js';
import type { XBriefDocument } from '../../../../src/lib/xbrief/types.js';

const doc = {
  xBRIEFInfo: { version: '0.8' },
  plan: {
    id: 'PAN-3680', title: 'test', status: 'active', edges: [],
    items: [{ id: 'schema', title: 'schema', status: 'running' }],
  },
} as XBriefDocument;

function deps(lifecycle: 'running' | 'ready-to-merge'): SwarmMergeCommandDeps {
  return {
    resolveProjectFromIssueSync: vi.fn(() => ({ projectName: 'overdeck', projectPath: '/repo' })),
    findSpecByIssue: vi.fn(() => Effect.succeed({
      path: '/repo/spec.json', filename: 'spec.json', issueId: 'PAN-3680', document: doc, status: 'active',
    })),
    ensureWorkspace: vi.fn(async () => '/workspace'),
    readSwarmHold: vi.fn(() => undefined),
    reconcileSlotState: vi.fn(async () => ({
      issueId: 'PAN-3680', merged: [], pending: [], branches: [], agents: [],
      inFlight: [{
        itemId: 'schema', slotIndex: 1, status: 'in_flight',
        branch: 'feature/pan-3680-slot-1', agentId: 'agent-pan-3680-slot-1',
      }],
    })),
    classifyInFlightSlots: vi.fn(async slots => slots.map(slot => ({ ...slot, lifecycle }))),
    mergeReadySlots: vi.fn(async () => ['[swarm] merged slot 1 (item schema) for PAN-3680']),
    getFailedMergeBlock: vi.fn(() => undefined),
    console: { log: vi.fn(), error: vi.fn() },
  } as unknown as SwarmMergeCommandDeps;
}

describe('swarm merge gate', () => {
  it('refuses a live slot without a durable completion signal', async () => {
    const fake = deps('running');

    const result = await swarmMergeCommand('PAN-3680', '1', {}, fake);

    expect(result.ok).toBe(false);
    expect(fake.mergeReadySlots).not.toHaveBeenCalled();
    expect(fake.console.error).toHaveBeenCalledWith(expect.stringContaining('durable completion signal'));
  });

  it('passes one completion-ready slot through the verify-and-merge door', async () => {
    const fake = deps('ready-to-merge');

    const result = await swarmMergeCommand('PAN-3680', '1', {}, fake);

    expect(result.ok).toBe(true);
    expect(fake.mergeReadySlots).toHaveBeenCalledWith(
      'PAN-3680', '/workspace', doc, [expect.objectContaining({ slotIndex: 1 })], undefined, new Set(),
    );
  });
});
