import { describe, expect, it } from 'vitest';

import { agentSnapshotFromOverdeck } from '../read-model.js';

function agent(id: string, role: 'work' | 'plan' | 'strike') {
  return {
    id,
    issueId: 'PAN-3950',
    role,
    status: 'stopped',
    workspace: '/repo/workspaces/feature-pan-3950',
    sessionId: null,
    harness: 'claude-code',
    model: 'claude',
    hostOverride: null,
    deliveryMethod: null,
    startedAt: null,
    lastResumeAt: null,
    stoppedByUser: null,
    kickoffDelivered: null,
    paused: null,
    pausedReason: null,
    troubled: null,
    channelsEnabled: null,
    consecutiveFailures: 0,
    firstFailureInRunAt: null,
    lastFailureNextRetryAt: null,
    updatedAt: new Date('2026-09-20T00:00:00.000Z'),
  } as Parameters<typeof agentSnapshotFromOverdeck>[0];
}

describe('read model durable agent source', () => {
  it('keeps work, planning, and strike roles at parity after they stop', () => {
    const snapshots = [
      agentSnapshotFromOverdeck(agent('agent-pan-3950', 'work')),
      agentSnapshotFromOverdeck(agent('planning-pan-3950', 'plan')),
      agentSnapshotFromOverdeck(agent('strike-pan-3950', 'strike')),
    ];

    expect(snapshots.map(({ id, role, status }) => ({ id, role, status }))).toEqual([
      { id: 'agent-pan-3950', role: 'work', status: 'stopped' },
      { id: 'planning-pan-3950', role: 'plan', status: 'stopped' },
      { id: 'strike-pan-3950', role: 'strike', status: 'stopped' },
    ]);
  });
});
