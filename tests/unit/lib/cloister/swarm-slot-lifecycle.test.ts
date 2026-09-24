import { describe, expect, it } from 'vitest';

import { isTerminalSwarmSlotAgent } from '../../../../src/lib/cloister/swarm-slot-lifecycle.js';
import type { SwarmSlotAssignment } from '../../../../src/lib/cloister/swarm-slot-store.js';
import type { XBriefDocument } from '../../../../src/lib/xbrief/types.js';

const agent = {
  id: 'agent-min-888-slot-1',
  issueId: 'MIN-888',
  role: 'work' as const,
  workspace: '/workspaces/feature-min-888-slot-1',
  slotIndex: 1,
  slotItemId: 'sync-schema-foundation',
};

const liveAgentWithoutEmbeddedSlotMetadata = {
  id: 'agent-min-888-slot-1',
  issueId: 'MIN-888',
  role: 'work' as const,
  workspace: '/workspaces/feature-min-888-slot-1',
};

const plan = {
  plan: {
    items: [{ id: 'sync-schema-foundation', status: 'running' }],
  },
} as XBriefDocument;

const assignments: SwarmSlotAssignment[] = [{
  slotIndex: 1,
  itemId: 'sync-schema-foundation',
  agentId: agent.id,
  branch: 'feature/min-888-slot-1',
}];

describe('terminal swarm slot lifecycle (PAN-3917: continue file + slot ledger)', () => {
  it('retires stale stopped ownership when the continue file says the item completed', () => {
    expect(isTerminalSwarmSlotAgent(
      agent,
      () => plan,
      () => assignments,
      () => ({ 'sync-schema-foundation': 'completed' }),
    )).toBe(true);
  });

  it('resolves the slot and item from the ledger when the agent row carries no slot metadata', () => {
    expect(isTerminalSwarmSlotAgent(
      liveAgentWithoutEmbeddedSlotMetadata,
      () => plan,
      () => assignments,
      () => ({ 'sync-schema-foundation': 'completed' }),
    )).toBe(true);
  });

  it('does not retire ownership while the item remains in flight', () => {
    expect(isTerminalSwarmSlotAgent(
      agent,
      () => plan,
      () => assignments,
      () => ({ 'sync-schema-foundation': 'running' }),
    )).toBe(false);
  });

  it('falls back to the workspace plan when the continue file has no status for the item', () => {
    const completedPlan = {
      plan: { items: [{ id: 'sync-schema-foundation', status: 'completed' }] },
    } as XBriefDocument;
    expect(isTerminalSwarmSlotAgent(agent, () => completedPlan, () => assignments, () => ({}))).toBe(true);
  });

  it('ignores an agent with no resolvable item', () => {
    expect(isTerminalSwarmSlotAgent(
      liveAgentWithoutEmbeddedSlotMetadata,
      () => plan,
      () => [],
      () => ({}),
    )).toBe(false);
  });
});
