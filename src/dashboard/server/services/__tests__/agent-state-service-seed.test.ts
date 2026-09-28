import { describe, expect, it } from 'vitest';
import type { BackendPane } from '@overdeck/contracts';
import { seedRuntimeFromPanes } from '../agent-state-service.js';

function pane(overrides: Partial<BackendPane> = {}): BackendPane {
  return {
    id: 'wKZ:p3',
    role: 'work',
    harness: 'claude-code',
    model: 'unknown',
    state: 'working',
    ...overrides,
  };
}

describe('seedRuntimeFromPanes (PAN-4320)', () => {
  it('keys a Herdr-shaped live pane by agentId, not terminalId', () => {
    const p = pane({ id: 'wKZ:p3', terminalId: 'term_65c8b78d3f05a5df', agentId: 'agent-pan-4311' });
    const { seeded, liveById } = seedRuntimeFromPanes([p]);

    expect(Object.keys(seeded)).toEqual(['agent-pan-4311']);
    expect(seeded['agent-pan-4311']?.id).toBe('agent-pan-4311');
    expect(liveById['agent-pan-4311']).toBe(true);
  });

  it('reports liveById true when a live pane and an exited pane share one agent', () => {
    const exited = pane({ id: 'wKZ:p1', terminalId: 'term_a', agentId: 'agent-pan-4311', state: 'exited' });
    const live = pane({ id: 'wKZ:p2', terminalId: 'term_b', agentId: 'agent-pan-4311', state: 'working' });

    expect(seedRuntimeFromPanes([exited, live]).liveById['agent-pan-4311']).toBe(true);
    expect(seedRuntimeFromPanes([live, exited]).liveById['agent-pan-4311']).toBe(true);
  });
});
