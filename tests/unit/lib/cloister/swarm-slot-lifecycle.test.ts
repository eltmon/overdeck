import { describe, expect, it } from 'vitest';

import { isTerminalSwarmSlotAgent } from '../../../../src/lib/cloister/swarm-slot-lifecycle.js';
import type { PanIssueRecord } from '../../../../src/lib/pan-dir/record.js';
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

describe('terminal swarm slot lifecycle', () => {
  it('retires stale stopped ownership when the canonical item is completed', () => {
    const record = {
      statusOverrides: { 'sync-schema-foundation': 'completed' },
      swarm: {
        slotAssignments: [{
          slotIndex: 1,
          itemId: 'sync-schema-foundation',
          agentId: agent.id,
          branch: 'feature/min-888-slot-1',
        }],
      },
    } as PanIssueRecord;

    expect(isTerminalSwarmSlotAgent(agent, () => plan, () => record)).toBe(true);
  });

  it('retires the live state shape by resolving the slot and item from durable ownership', () => {
    const record = {
      statusOverrides: { 'sync-schema-foundation': 'completed' },
      swarm: {
        slotAssignments: [{
          slotIndex: 1,
          itemId: 'sync-schema-foundation',
          agentId: liveAgentWithoutEmbeddedSlotMetadata.id,
          branch: 'feature/min-888-slot-1',
        }],
      },
    } as PanIssueRecord;

    expect(isTerminalSwarmSlotAgent(
      liveAgentWithoutEmbeddedSlotMetadata,
      () => plan,
      () => record,
    )).toBe(true);
  });

  it('does not retire ownership while the canonical item remains in flight', () => {
    const record = {
      statusOverrides: { 'sync-schema-foundation': 'running' },
      swarm: { slotAssignments: [{ slotIndex: 1, itemId: 'sync-schema-foundation' }] },
    } as PanIssueRecord;

    expect(isTerminalSwarmSlotAgent(agent, () => plan, () => record)).toBe(false);
  });
});
